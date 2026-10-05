import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  DeviceChange, DeviceSnapshot, ExecutionRecord, ExecutionStepResult,
  QueuedStep, StepResult, TestCase, TestStatus,
} from './types'
import { seedCases, seedChanges, seedExecutions, seedSnapshots } from './mock'
import { casesAffectedBy, deviceById, deviceKindOf, routesAffectedBy } from './deviceGraph'
import { hasEvidence } from './format'

const STORAGE_KEY = 'yy57-interlocking-v2'

interface PersistedDraft {
  snapshots: DeviceSnapshot[]
  changes: DeviceChange[]
  executions: ExecutionRecord[]
  queue: QueuedStep[]
  currentSnapshotId: string
  lockedSnapshotId?: string
  selectedCaseId: string
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
}

export const useTestStore = defineStore('interlocking', () => {
  // 用例模板是静态的；所有执行结果按设备快照存放，绝不挂回模板
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const snapshots = ref<DeviceSnapshot[]>(structuredClone(seedSnapshots))
  const changes = ref<DeviceChange[]>(structuredClone(seedChanges))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  const queue = ref<QueuedStep[]>([])

  const currentSnapshotId = ref('SNAP-2610')
  const lockedSnapshotId = ref<string>()
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const connection = ref<'在线' | '重连中'>('在线')
  const liveMessage = ref('执行进度已同步')

  /* ---------------- 快照版本 ---------------- */

  const currentSnapshot = computed(() => snapshots.value.find((item) => item.id === currentSnapshotId.value))
  const baselineLocked = computed(() => lockedSnapshotId.value === currentSnapshotId.value)

  function changesOf(snapshotId: string) {
    const ids = new Set(snapshots.value.find((item) => item.id === snapshotId)?.changeIds ?? [])
    return changes.value.filter((item) => ids.has(item.id))
  }

  function changedDeviceIdsOf(snapshotId: string) {
    return [...new Set(changesOf(snapshotId).map((item) => item.deviceId))]
  }

  /** 受影响进路/用例完全由 设备→进路→用例 关系图推导，任何变更都会即时重算 */
  function affectedRoutesOf(snapshotId: string) {
    return routesAffectedBy(changedDeviceIdsOf(snapshotId))
  }
  function affectedCasesOf(snapshotId: string): TestCase[] {
    return casesAffectedBy(changedDeviceIdsOf(snapshotId), cases.value)
  }

  const affectedCases = computed(() => affectedCasesOf(currentSnapshotId.value))
  const affectedRoutes = computed(() => affectedRoutesOf(currentSnapshotId.value))
  const pendingRetry = computed(() => queue.value.length)

  /**
   * 登记设备关系变更（道岔 / 信号机 / 轨道区段 / 进路关系）。
   * 当前快照尚未确认时并入当前快照；已确认则冻结旧快照并开出新快照，
   * 旧快照上的执行记录标记失效但原样保留。
   */
  function registerChange(deviceId: string, description: string): string | null {
    const device = deviceById(deviceId)
    if (!device) return '设备不存在'
    const current = currentSnapshot.value
    if (!current) return '当前没有活动设备快照'
    if (lockedSnapshotId.value === current.id) return '基线已锁定，需登记新变更后在新版本重测'

    const occurredAt = Date.now()
    const change: DeviceChange = {
      id: nextId('CHG'), deviceId, deviceKind: device.kind,
      description: description.trim() || `${device.name}关系变更`,
      occurredAt, routeIds: routesAffectedBy([deviceId]),
    }
    changes.value.push(change)

    if (current.status === '待确认') {
      current.changeIds.push(change.id)
    } else {
      // 冻结旧版本：旧执行标记 superseded，记录保留不删
      current.status = '已失效'
      current.confirmedAt ??= occurredAt
      for (const record of executions.value) {
        if (record.snapshotId === current.id && !record.superseded) {
          record.superseded = true
          record.note = '所属设备版本已被新快照取代，记录保留备查，新版本结果不回写本记录'
        }
      }
      const stamp = new Date(occurredAt)
      const label = `${stamp.toLocaleDateString('zh-CN', { month:'2-digit', day:'2-digit' })} 待确认快照`
      const snapshot: DeviceSnapshot = {
        id: nextId('SNAP'), label,
        softwareVersion: current.softwareVersion, status:'待确认',
        createdAt: occurredAt,
        // 新快照只携带本次变更；上一版本已随旧快照固化，回归范围按本快照变更重算
        changeIds:[change.id],
      }
      snapshots.value.push(snapshot)
      currentSnapshotId.value = snapshot.id
    }
    const count = affectedCasesOf(currentSnapshotId.value).length
    liveMessage.value = `已登记 ${device.name}变更，受影响用例重算为 ${count} 条；新版本确认前可继续执行但不能发布报告`
    persist()
    return null
  }

  /** 现场/版本负责人确认设备变更。确认前允许继续执行，但不允许锁定基线/导出可发布报告 */
  function confirmCurrentSnapshot(): string | null {
    const current = currentSnapshot.value
    if (!current) return '当前没有活动设备快照'
    if (current.status !== '待确认') return '当前设备版本已确认'
    if (current.changeIds.length === 0) return '当前快照没有已登记的设备变更'
    current.status = '已确认'
    current.confirmedAt = Date.now()
    liveMessage.value = `设备版本 ${current.label} 已确认，受影响用例全部通过并补齐证据后可锁定基线`
    persist()
    return null
  }

  /* ---------------- 执行记录（按快照隔离） ---------------- */

  function recordsOf(caseId: string, snapshotId: string) {
    return executions.value
      .filter((item) => item.caseId === caseId && item.snapshotId === snapshotId)
      .sort((a, b) => a.startedAt - b.startedAt)
  }

  /** 合并某用例在某快照下全部执行记录的步骤，同一步骤按发生时间取最新 */
  function stepsAt(caseId: string, snapshotId: string): ExecutionStepResult[] {
    const testCase = cases.value.find((item) => item.id === caseId)
    if (!testCase) return []
    const latest = new Map<string, ExecutionStepResult>()
    for (const record of recordsOf(caseId, snapshotId)) {
      for (const result of record.steps) {
        const prev = latest.get(result.stepId)
        if (!prev || result.recordedAt >= prev.recordedAt) latest.set(result.stepId, result)
      }
    }
    return testCase.steps
      .map((step) => latest.get(step.id))
      .filter((item): item is ExecutionStepResult => Boolean(item))
  }

  function stepStateAt(caseId: string, stepId: string, snapshotId = currentSnapshotId.value): StepResult {
    return stepsAt(caseId, snapshotId).find((item) => item.stepId === stepId)?.result ?? '未执行'
  }

  function caseStateAt(caseId: string, snapshotId = currentSnapshotId.value): TestStatus {
    const testCase = cases.value.find((item) => item.id === caseId)
    if (!testCase) return '未执行'
    const states = stepsAt(caseId, snapshotId)
    if (states.length === 0) return '未执行'
    const byStep = new Map(states.map((item) => [item.stepId, item]))
    if (testCase.steps.some((step) => byStep.get(step.id)?.result === '失败')) return '失败'
    if (testCase.steps.every((step) => byStep.get(step.id)?.result === '通过')) return '通过'
    return '执行中'
  }

  function progressOf(snapshotId: string) {
    const scope = affectedCasesOf(snapshotId)
    const total = scope.reduce((sum, item) => sum + item.steps.length, 0)
    if (total === 0) return 100
    const done = scope.reduce(
      (sum, item) => sum + item.steps.filter((step) => stepStateAt(item.id, step.id, snapshotId) !== '未执行').length,
      0,
    )
    return Math.round(done / total * 100)
  }

  const progress = computed(() => progressOf(currentSnapshotId.value))
  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))

  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  function startExecution(): string | null {
    const testCase = selectedCase.value
    const snapshot = currentSnapshot.value
    if (!testCase || !snapshot) return null
    if (baselineLocked.value) return '当前设备版本基线已锁定，不能再执行'
    const running = recordsOf(testCase.id, snapshot.id).find((item) => item.result === '执行中')
    if (running) { liveMessage.value = `用例 ${testCase.id} 已有执行中的记录 ${running.id}`; return null }
    executions.value.unshift({
      id: nextId('EX'), caseId: testCase.id, operator:'当前用户',
      startedAt: Date.now(), snapshotId: snapshot.id,
      result:'执行中', superseded: snapshot.status === '已失效', steps: [],
    })
    liveMessage.value = `已在设备版本 ${snapshot.label} 下开始执行 ${testCase.id}`
    persist()
    return null
  }

  /** 按当前设备版本重算一条执行记录的结果与完成时间 */
  function refreshRecord(record: ExecutionRecord) {
    const testCase = cases.value.find((item) => item.id === record.caseId)
    if (!testCase) return
    const latest = new Map<string, ExecutionStepResult>()
    for (const result of [...record.steps].sort((a, b) => a.recordedAt - b.recordedAt)) {
      latest.set(result.stepId, result)
    }
    const states = testCase.steps.map((step) => latest.get(step.id)?.result)
    record.result = states.some((state) => state === '失败')
      ? '失败'
      : states.every((state) => state === '通过') ? '通过' : '执行中'
    if (record.result === '通过') {
      record.finishedAt = Math.max(...record.steps.map((item) => item.recordedAt), record.startedAt)
    } else {
      record.finishedAt = undefined
    }
  }

  /** 按步骤发生时间找到当时所属的原执行记录：优先进行中/时间区间命中的记录，其次最近一条 */
  function mergeTarget(caseId: string, snapshotId: string, at: number) {
    const records = recordsOf(caseId, snapshotId)
    if (records.length === 0) return undefined
    return records.find((item) => item.startedAt <= at && (!item.finishedAt || item.finishedAt >= at))
      ?? records.filter((item) => item.startedAt <= at).at(-1)
      ?? records[0]
  }

  function recordStep(
    caseId: string, stepId: string, result: Exclude<StepResult, '未执行'>,
    actual: string, evidence?: string,
  ): string | null {
    const snapshot = currentSnapshot.value
    const testCase = cases.value.find((item) => item.id === caseId)
    const step = testCase?.steps.find((item) => item.id === stepId)
    if (!snapshot || !testCase || !step) return '用例或步骤不存在'
    if (baselineLocked.value) return '当前设备版本基线已锁定，步骤只读'
    if (result === '失败' && !hasEvidence(evidence)) return '失败步骤必须登记证据后才能记录'

    if (step.dependency) {
      // 依赖检查同时考虑已落库结果与断线暂存队列（按发生时间取最新）
      const fromRecord = stepsAt(caseId, snapshot.id).find((item) => item.stepId === step.dependency)
      const fromQueue = queue.value
        .filter((item) => item.caseId === caseId && item.snapshotId === snapshot.id && item.stepId === step.dependency)
        .at(-1)
      const depResult = fromQueue && (!fromRecord || fromQueue.recordedAt >= fromRecord.recordedAt)
        ? fromQueue.result
        : fromRecord?.result ?? '未执行'
      if (depResult !== '通过') return `前置步骤 ${step.dependency} 未通过，禁止跳过`
    }

    // 断线期间：只入补传队列，绝不直接覆盖草稿
    if (connection.value === '重连中') {
      queue.value.push({
        id: nextId('Q'), caseId, snapshotId: snapshot.id, stepId, result,
        actual, evidence, recordedAt: Date.now(), operator:'当前用户',
      })
      liveMessage.value = `断线暂存：${stepId} 已进入补传队列（${queue.value.length} 项），重连后按发生时间合并`
      persist()
      return null
    }

    const now = Date.now()
    let target = recordsOf(caseId, snapshot.id).find((item) => item.result === '执行中')
    if (!target) {
      target = {
        id: nextId('EX'), caseId, operator:'当前用户', startedAt: now,
        snapshotId: snapshot.id, result:'执行中', superseded: snapshot.status === '已失效', steps: [],
      }
      executions.value.unshift(target)
    }
    target.steps.push({ stepId, result, actual, evidence, recordedAt: Date.now(), operator:'当前用户' })
    target.steps.sort((a, b) => a.recordedAt - b.recordedAt)
    refreshRecord(target)
    liveMessage.value = `${stepId} 已实时同步到设备版本 ${snapshot.label} 的执行 ${target.id}`
    persist()
    return null
  }

  /* ---------------- 断线与补传合并 ---------------- */

  function simulateDisconnect() {
    connection.value = '重连中'
    liveMessage.value = queue.value.length
      ? `网络中断，执行步骤本地暂存（${queue.value.length} 项待补传）`
      : '网络中断，执行步骤将本地暂存，恢复后按发生时间补传'
  }

  /**
   * 重连补传：逐项找到步骤发生时所属快照的原执行记录合并；
   * 快照已失效则只写入/归档旧版本记录，绝不写入新版本执行。
   */
  function replayQueue(): string | null {
    if (queue.value.length === 0) { connection.value = '在线'; return null }
    const items = [...queue.value].sort((a, b) => a.recordedAt - b.recordedAt)
    let intoStale = 0
    for (const item of items) {
      const snapshot = snapshots.value.find((entry) => entry.id === item.snapshotId)
      const stale = !snapshot || snapshot.status === '已失效' || item.snapshotId !== currentSnapshotId.value
      if (stale) intoStale += 1

      // 按发生时间定位原执行记录；找不到才在对应（旧）快照下新建归档记录
      let target = recordsOf(item.caseId, item.snapshotId).find((entry) => entry.result === '执行中')
        ?? mergeTarget(item.caseId, item.snapshotId, item.recordedAt)
      if (!target) {
        target = {
          id: nextId('EX'), caseId: item.caseId, operator: item.operator,
          startedAt: item.recordedAt, snapshotId: item.snapshotId,
          result:'执行中', superseded: stale,
          note: stale ? '断线补传：步骤发生于已失效设备版本，仅归档旧记录，未回写当前版本' : undefined,
          steps: [],
        }
        executions.value.unshift(target)
      }
      const merged: ExecutionStepResult = {
        stepId: item.stepId, result: item.result, actual: item.actual,
        evidence: item.evidence, recordedAt: item.recordedAt, operator: item.operator, queued: true,
      }
      // 同一步骤按发生时间取最新，再按时间并回原执行记录
      const idx = target.steps.findIndex((entry) => entry.stepId === item.stepId)
      if (idx >= 0 && target.steps[idx]!.recordedAt <= item.recordedAt) target.steps[idx] = merged
      else if (idx < 0) target.steps.push(merged)
      target.steps.sort((a, b) => a.recordedAt - b.recordedAt)
      refreshRecord(target)
    }
    const count = queue.value.length
    queue.value = []
    connection.value = '在线'
    liveMessage.value = intoStale
      ? `补传完成：合并 ${count} 项，其中 ${intoStale} 项属于已失效版本，仅归档旧记录，当前版本需重测`
      : `补传完成：${count} 项步骤已按发生时间合并回原执行记录`
    persist()
    return null
  }

  function updateLiveProgress(value: number) {
    if (connection.value === '重连中') return
    liveMessage.value = value >= 100
      ? '实时同步正常：受影响用例进度 100%，等待门禁校验'
      : `实时同步：受影响用例已完成 ${value}%`
  }

  /* ---------------- 基线门禁 ---------------- */

  /** 逐条给出阻断原因；为空表示可锁定 */
  function gateFailures(snapshotId = currentSnapshotId.value): string[] {
    const failures: string[] = []
    const snapshot = snapshots.value.find((item) => item.id === snapshotId)
    if (!snapshot) return ['设备版本不存在']
    if (snapshot.status !== '已确认') failures.push('设备变更尚未确认，现场可继续执行，但不能锁定基线/发布报告')
    if (queue.value.length > 0) failures.push(`存在 ${queue.value.length} 项断线补传未合并`)
    const scope = affectedCasesOf(snapshotId)
    if (scope.length === 0) failures.push('当前版本没有受影响用例（无设备变更），无需锁定回归基线')
    for (const testCase of scope) {
      const state = caseStateAt(testCase.id, snapshotId)
      if (state !== '通过') failures.push(`${testCase.id} 状态为「${state}」，受影响用例须全部通过`)
    }
    // 该版本下所有失败步骤都必须有证据（含历史失败尝试）
    const evidenceMissing: string[] = []
    for (const record of executions.value) {
      if (record.snapshotId !== snapshotId) continue
      if (!scope.some((testCase) => testCase.id === record.caseId)) continue
      for (const step of record.steps) {
        if (step.result === '失败' && !hasEvidence(step.evidence)) evidenceMissing.push(`${record.caseId}/${step.stepId}`)
      }
    }
    if (evidenceMissing.length) failures.push(`失败步骤缺少证据：${evidenceMissing.join('、')}`)
    return failures
  }

  const canLockBaseline = computed(() => gateFailures().length === 0 && !baselineLocked.value)

  function lockBaseline(): string | null {
    if (baselineLocked.value) return '基线已锁定'
    const failures = gateFailures()
    if (failures.length) return failures[0] ?? '门禁未通过'
    lockedSnapshotId.value = currentSnapshotId.value
    liveMessage.value = `设备版本 ${currentSnapshot.value?.label} 回归基线已锁定，可导出发布报告`
    persist()
    return null
  }

  /** 可发布报告必须基于已锁定基线；未确认/未通过时返回阻断原因 */
  function buildReport(): { ok: true; content: string; filename: string } | { ok:false; reason:string } {
    const snapshot = currentSnapshot.value
    if (!snapshot) return { ok:false, reason:'当前没有活动设备版本' }
    if (lockedSnapshotId.value !== snapshot.id) {
      return { ok:false, reason: gateFailures()[0] ?? '请先锁定基线再导出可发布报告' }
    }
    const scope = affectedCasesOf(snapshot.id)
    const report = {
      station:'海州站 CS',
      snapshot: { id:snapshot.id, label:snapshot.label, softwareVersion:snapshot.softwareVersion, confirmedAt:snapshot.confirmedAt },
      deviceChanges: changesOf(snapshot.id).map((item) => ({ id:item.id, device:item.deviceId, kind:item.deviceKind, description:item.description, routes:item.routeIds })),
      affectedRoutes: affectedRoutesOf(snapshot.id),
      cases: scope.map((testCase) => ({
        id:testCase.id, name:testCase.name, status:caseStateAt(testCase.id, snapshot.id),
        steps: stepsAt(testCase.id, snapshot.id).map((step) => ({ stepId:step.stepId, result:step.result, actual:step.actual, evidence:step.evidence ?? null, recordedAt:step.recordedAt, queued:!!step.queued })),
      })),
      supersededExecutionsKept: executions.value.filter((item) => item.superseded).length,
      generatedAt:new Date().toISOString(),
    }
    return {
      ok:true,
      content: JSON.stringify(report, null, 2),
      filename: `联锁测试报告-${snapshot.id}.json`,
    }
  }

  /* ---------------- 持久化 ---------------- */

  function persist() {
    const draft: PersistedDraft = {
      snapshots: snapshots.value, changes: changes.value, executions: executions.value,
      queue: queue.value, currentSnapshotId: currentSnapshotId.value,
      lockedSnapshotId: lockedSnapshotId.value, selectedCaseId: selectedCaseId.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  }

  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const draft = JSON.parse(raw) as Partial<PersistedDraft>
      if (Array.isArray(draft.snapshots)) snapshots.value = draft.snapshots
      if (Array.isArray(draft.changes)) changes.value = draft.changes
      if (Array.isArray(draft.executions)) executions.value = draft.executions
      if (Array.isArray(draft.queue)) queue.value = draft.queue
      if (draft.currentSnapshotId) currentSnapshotId.value = draft.currentSnapshotId
      if (draft.lockedSnapshotId) lockedSnapshotId.value = draft.lockedSnapshotId
      if (draft.selectedCaseId) selectedCaseId.value = draft.selectedCaseId
      if (queue.value.length > 0) {
        connection.value = '重连中'
        liveMessage.value = `恢复草稿：${queue.value.length} 项断线暂存等待补传，执行记录未被覆盖`
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  restore()

  return {
    // 基础数据
    cases, snapshots, changes, executions, queue,
    selectedCaseId, selectedRouteIds, connection, liveMessage,
    // 快照与版本
    currentSnapshot, currentSnapshotId, lockedSnapshotId, baselineLocked,
    affectedCases, affectedRoutes, pendingRetry, progress,
    selectedCase,
    changesOf, changedDeviceIdsOf, affectedRoutesOf, affectedCasesOf,
    registerChange, confirmCurrentSnapshot,
    // 执行
    recordsOf, stepsAt, stepStateAt, caseStateAt, progressOf,
    selectCase, startExecution, recordStep,
    // 实时与补传
    simulateDisconnect, replayQueue, updateLiveProgress,
    // 门禁与报告
    gateFailures, canLockBaseline, lockBaseline, buildReport,
    persist,
  }
})
