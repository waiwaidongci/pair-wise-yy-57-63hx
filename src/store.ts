import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { DeviceSnapshot, ExecutionRecord, OfflineStep, TestCase, TestStep } from './types'
import { devices, routes, seedCases, seedExecutions } from './mock'

const STORAGE_KEY = 'yy57-interlocking-draft-v2'

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false })
}
function nowIso() { return new Date().toISOString() }
function offlineStepId() { return `OF-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}` }

/** 由步骤结果推导用例状态 */
function deriveStatus(item: TestCase): TestCase['status'] {
  if (item.steps.some((step) => step.result === '失败')) return '失败'
  if (item.steps.every((step) => step.result === '通过')) return '通过'
  return '执行中'
}

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  // 设备快照版本：旧版本已确认归档，当前 v26.10 的变更尚未确认
  const snapshots = ref<DeviceSnapshot[]>([
    { version:'v26.09', label:'CS-LEU-08', confirmed:true, changes:[], createdAt:'2026-09-20' },
    { version:'v26.10', label:'CS-LEU-09', confirmed:false, createdAt:'2026-10-01',
      note:'P-02 转辙机更换、T-03 绝缘节调整，跨进路影响需重测',
      changes:[
        { deviceId:'P-02', description:'P-02 转辙机更换' },
        { deviceId:'T-03', description:'T-03 绝缘节调整' },
      ] },
  ])
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')
  // 断线期间暂存的步骤，恢复后按发生时间补传合并
  const offlineQueue = ref<OfflineStep[]>([])

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })

  /** 当前设备快照版本 */
  const currentSnapshot = computed(() => snapshots.value[snapshots.value.length - 1]!)
  const snapshotVersion = computed(() => currentSnapshot.value.version)
  /** 当前版本相对上一版本的变更描述 */
  const changedDevices = computed(() => currentSnapshot.value.changes.map((change) => change.description))

  /**
   * 受影响用例：按「道岔/信号机/轨道区段 → 进路 → 用例」关系图推导，
   * 不再写死进路分支。设备变更后自动重算。
   */
  const affectedCases = computed(() => {
    const changedDeviceIds = currentSnapshot.value.changes.map((change) => change.deviceId)
    const affectedRouteIds = routes
      .filter((route) => route.devices.some((deviceId) => changedDeviceIds.includes(deviceId)))
      .map((route) => route.id)
    return cases.value.filter((item) => item.routeIds.some((routeId) => affectedRouteIds.includes(routeId)))
  })

  /** 发布门禁：同一设备版本下全部受影响用例通过、失败步骤有证据、变更已确认 */
  const releaseGate = computed(() => {
    const reasons: string[] = []
    if (!currentSnapshot.value.confirmed) {
      reasons.push('设备变更尚未确认：现场可继续执行，但不能生成可发布报告')
    }
    const unpassed = affectedCases.value.filter((item) => item.status !== '通过')
    if (unpassed.length) {
      reasons.push(`受影响用例 ${unpassed.map((item) => item.id).join('、')} 未全部通过（${unpassed.map((item) => item.status).join('、')}）`)
    }
    const failedWithoutEvidence = affectedCases.value
      .flatMap((item) => item.steps)
      .filter((step) => step.result === '失败' && !step.evidence)
    if (failedWithoutEvidence.length) {
      reasons.push(`有 ${failedWithoutEvidence.length} 个失败步骤缺少证据，失败路径必须留痕`)
    }
    return { allowed: reasons.length === 0, reasons }
  })

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cases: cases.value, executions: executions.value,
      snapshots: snapshots.value, baselineLocked: baselineLocked.value,
      offlineQueue: offlineQueue.value, pendingRetry: pendingRetry.value,
    }))
  }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const draft = JSON.parse(raw)
    if (draft.cases) cases.value = draft.cases
    if (draft.executions) executions.value = draft.executions
    if (draft.snapshots) snapshots.value = draft.snapshots
    if (typeof draft.baselineLocked === 'boolean') baselineLocked.value = draft.baselineLocked
    if (Array.isArray(draft.offlineQueue)) offlineQueue.value = draft.offlineQueue
    if (typeof draft.pendingRetry === 'number') pendingRetry.value = draft.pendingRetry
  }

  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  /** 确认设备变更：确认后发布门禁才允许锁定基线与导出报告 */
  function confirmDeviceChanges() {
    const snapshot = currentSnapshot.value
    if (snapshot.confirmed) return
    snapshot.confirmed = true
    liveMessage.value = '设备变更已确认，发布门禁解锁'
    persist()
  }

  /**
   * 取作用例在当前快照版本下的执行记录；不存在则新建。
   * 旧版本记录保留只读，绝不回写。
   */
  function ensureExecution(caseId: string, version: string): ExecutionRecord {
    let record = executions.value.find((item) => item.caseId === caseId && item.snapshotVersion === version)
    if (!record) {
      record = {
        id: `EX-${Date.now().toString().slice(-6)}`,
        caseId, operator:'当前用户', startedAt:nowTime(),
        snapshot:`${version} / ${currentSnapshot.value.label}`,
        snapshotVersion:version, result:'执行中', evidence:[], steps:[],
      }
      executions.value.unshift(record)
    }
    return record
  }

  /** 把一条步骤结果落到当前快照版本的执行记录上；断线则暂存，恢复后补传 */
  function commitStep(item: TestCase, step: TestStep, result: '通过' | '失败', actual?: string, evidence?: string) {
    const offline: OfflineStep = {
      id:offlineStepId(), caseId:item.id, stepId:step.id, result,
      actual, evidence, occurredAt:nowIso(), operator:'当前用户',
    }
    if (connection.value === '重连中') {
      // 现场继续执行，步骤暂存本地；不覆盖任何已有记录
      offlineQueue.value.push(offline)
      pendingRetry.value = offlineQueue.value.length
      liveMessage.value = `断线执行已暂存 ${offlineQueue.value.length} 项，恢复后按发生时间补传`
      return
    }
    const record = ensureExecution(item.id, snapshotVersion.value)
    record.steps = record.steps ?? []
    record.steps.push(offline)
    record.result = item.status
    if (evidence && !record.evidence.includes(evidence)) record.evidence.push(evidence)
  }

  function setStepResult(caseId: string, stepId: string, result: '通过' | '失败', actual?: string, evidence?: string) {
    if (baselineLocked.value) return
    const item = cases.value.find((entry) => entry.id === caseId)
    const step = item?.steps.find((entry) => entry.id === stepId)
    if (!item || !step) return
    if (step.dependency && item.steps.find((entry) => entry.id === step.dependency)?.result !== '通过') {
      liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过`
      return
    }
    step.result = result
    step.actual = actual ?? step.actual
    if (evidence) step.evidence = evidence
    item.status = deriveStatus(item)
    // 结果只绑定当前快照版本；旧执行记录不回写
    commitStep(item, step, result, actual, evidence)
    persist()
  }

  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    item.status = '执行中'
    const record = ensureExecution(item.id, snapshotVersion.value)
    record.result = '执行中'
    persist()
  }

  function updateLiveProgress(value: number) {
    liveMessage.value = value >= 100 ? '全部用例执行完成，等待审核锁定' : `实时同步：已完成 ${value}%`
    if (value >= 100) {
      // 只结束当前快照版本下仍在执行的记录，旧版本记录不动
      const active = executions.value.find((item) => item.result === '执行中' && item.snapshotVersion === snapshotVersion.value)
      if (active) { active.result = '失败'; active.finishedAt = nowTime() }
    }
  }

  function simulateDisconnect() { connection.value = '重连中'; pendingRetry.value = offlineQueue.value.length || 1 }

  /** 恢复网络：把断线期间暂存的步骤按发生时间合并到原执行记录，不覆盖 */
  function retry() {
    for (const offline of offlineQueue.value) {
      const record = ensureExecution(offline.caseId, snapshotVersion.value)
      record.steps = record.steps ?? []
      // 按发生时间插入到合适位置，保持时间顺序；已有记录不覆盖
      const pos = record.steps.findIndex((entry) => entry.occurredAt > offline.occurredAt)
      if (pos === -1) record.steps.push(offline)
      else record.steps.splice(pos, 0, offline)
      const item = cases.value.find((entry) => entry.id === offline.caseId)
      if (item) record.result = item.status
    }
    offlineQueue.value = []
    connection.value = '在线'
    pendingRetry.value = 0
    liveMessage.value = '断线期间执行记录已按发生时间补传合并'
    persist()
  }

  /** 锁定基线：必须通过发布门禁，否则不允许锁定 */
  function lockBaseline() {
    if (!releaseGate.value.allowed) {
      liveMessage.value = `发布门禁未通过：${releaseGate.value.reasons.join('；')}`
      return
    }
    baselineLocked.value = true
    liveMessage.value = '基线已锁定，报告可导出'
    persist()
  }

  /** 某进路关联的用例（按进路关系接回） */
  function casesForRoute(routeId: string): TestCase[] {
    return cases.value.filter((item) => item.routeIds.includes(routeId))
  }
  /** 某进路关联的执行记录（经用例-进路关系接回） */
  function executionsForRoute(routeId: string): ExecutionRecord[] {
    const caseIds = new Set(casesForRoute(routeId).map((item) => item.id))
    return executions.value.filter((item) => caseIds.has(item.caseId))
  }
  /** 某设备关联的用例（设备→进路→用例） */
  function casesForDevice(deviceId: string): TestCase[] {
    const routeIds = routes.filter((route) => route.devices.includes(deviceId)).map((route) => route.id)
    return cases.value.filter((item) => item.routeIds.some((routeId) => routeIds.includes(routeId)))
  }
  /** 执行记录是否属于历史快照版本（已失效，保留只读） */
  function isStale(record: ExecutionRecord): boolean {
    return record.snapshotVersion !== snapshotVersion.value
  }

  watch(cases, persist, { deep:true })
  restore()

  return {
    cases, executions, snapshots, selectedCaseId, selectedRouteIds, selectedCase, progress,
    baselineLocked, connection, pendingRetry, liveMessage, offlineQueue,
    currentSnapshot, snapshotVersion, changedDevices, affectedCases, releaseGate,
    selectCase, setStepResult, startExecution, updateLiveProgress,
    simulateDisconnect, retry, lockBaseline, confirmDeviceChanges,
    casesForRoute, executionsForRoute, casesForDevice, isStale,
  }
})
