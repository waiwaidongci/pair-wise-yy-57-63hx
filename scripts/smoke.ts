// 逻辑冒烟测试：用 esbuild 直接跑 TS，mock localStorage
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'

const localStorageStub: { store: Record<string, string> } = { store: {} }
;(globalThis as any).localStorage = {
  getItem: (k: string) => localStorageStub.store[k] ?? null,
  setItem: (k: string, v: string) => { localStorageStub.store[k] = v },
  removeItem: (k: string) => { delete localStorageStub.store[k] },
}

const { useTestStore } = await import('../src/store.ts')
setActivePinia(createPinia())
const s = useTestStore()

let pass = 0, fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name) }
}

console.log('1. 初始：SNAP-2610 待确认，旧记录失效保留')
check('当前快照为 SNAP-2610', s.currentSnapshotId === 'SNAP-2610')
check('受影响用例 4 条（P-02→R01/02/03, T-03→R02/04）', s.affectedCases.length === 4)
check('受影响进路为 R-01/R-02/R-03/R-04', s.affectedRoutes.sort().join() === 'R-01,R-02,R-03,R-04')
check('当前版本下 TC-101 状态为未执行（旧版本通过不抵新版本）', s.caseStateAt('TC-101') === '未执行')
check('3 条旧执行全部 superseded 保留', s.executions.filter(e => e.superseded).length === 3)
check('未确认设备变更，门禁阻断', s.gateFailures().some(f => f.includes('尚未确认')))
check('未确认时不能锁定基线', s.lockBaseline() !== null)
check('未确认时不能导出可发布报告', s.buildReport().ok === false)

console.log('2. 现场继续执行：新版本结果写入当前快照，不动旧记录')
const old03 = s.executions.find(e => e.id === 'EX-260929-03')!
const oldStepsCount = old03.steps.length
s.selectCase('TC-101')
s.recordStep('TC-101','TS-1','通过','一致','XS-100')
s.recordStep('TC-101','TS-2','通过','一致','LG-200')
check('TC-101 当前版本通过', s.caseStateAt('TC-101') === '通过')
check('新执行挂在 SNAP-2610', s.executions.find(e => e.caseId==='TC-101' && e.snapshotId==='SNAP-2610') !== undefined)
check('旧执行 EX-260929-03 步骤数未变（不回写）', old03.steps.length === oldStepsCount)

console.log('3. 失败步骤无证据拒绝记录')
s.selectCase('TC-103')
check('缺证据的失败被拒绝', s.recordStep('TC-103','TS-5','失败','异常','') !== null)
s.recordStep('TC-103','TS-5','失败','信号未保持','VID-900')
check('带证据失败可记录，状态失败', s.caseStateAt('TC-103') === '失败')

console.log('4. 断线：步骤入补传队列不覆盖草稿；恢复后按时间合并')
s.simulateDisconnect()
s.selectCase('TC-102')
s.recordStep('TC-102','TS-3','通过','进路建立','XS-300')
s.recordStep('TC-102','TS-4','失败','S2 延迟关闭','VID-301、LG-302')
check('断线期间队列 2 项', s.queue.length === 2)
const draft = JSON.parse(localStorageStub.store['yy57-interlocking-v2']!)
check('持久化草稿含队列、执行记录未被补传污染', draft.queue.length === 2 && draft.executions.every((e: any) => e.snapshotId === 'SNAP-2610' ? !e.steps.some((x: any) => x.queued) : true))
s.replayQueue()
check('补传后队列清空', s.queue.length === 0)
check('TC-102 当前版本为失败（含失败步骤证据）', s.caseStateAt('TC-102') === '失败')
const ex102 = s.executions.find(e => e.caseId==='TC-102' && e.snapshotId==='SNAP-2610')!
check('补传步骤带 queued 标记且按时间排序', ex102.steps.every((x,i,a)=> i===0 || a[i-1]!.recordedAt<=x.recordedAt) && ex102.steps.every(x=>x.queued))
check('旧执行 EX-260929-02 未被补传改写', s.executions.find(e=>e.id==='EX-260929-02')!.steps.length === 1)

console.log('5. 跨版本：断线期间登记新变更，旧快照补传只归档旧记录')
s.simulateDisconnect()
// 对 TC-104（当前版本尚未执行）在旧/当前版本产生一个补传：先构造当前版本队列，再登记变更使快照前进
s.selectCase('TC-104')
s.recordStep('TC-104','TS-6','通过','D信号开放','XS-400')
check('队列暂存于 SNAP-2610', s.queue[0]!.snapshotId === 'SNAP-2610')
// 先确认 2610，再登记 X-01 变更 → 产生 SNAP-* 新版本，2610 失效
check('确认 2610', s.confirmCurrentSnapshot() === null)
check('登记新变更成功', s.registerChange('X-01','进站信号机增加引导表示') === null)
check('SNAP-2610 已失效', s.snapshots.find(x=>x.id==='SNAP-2610')!.status === '已失效')
check('新版本自动推导：X-01 影响 R-01/R-03', s.affectedRoutes.sort().join() === 'R-01,R-03')
check('新版本受影响用例 TC-101/TC-103', s.affectedCases.map(c=>c.id).sort().join() === 'TC-101,TC-103')
check('新版本下 TC-101 回到未执行（不继承 2610 结果）', s.caseStateAt('TC-101') === '未执行')
// 2610 上此前非失效的执行被标记
check('2610 的执行已标记 superseded 但保留', s.executions.filter(e=>e.snapshotId==='SNAP-2610').every(e=>e.superseded))
// 恢复连接：旧快照补传合并进 2610 记录，不写新版本
s.replayQueue()
const moved = s.executions.find(e=>e.caseId==='TC-104' && e.snapshotId==='SNAP-2610')!
check('旧版本补传落在 SNAP-2610 归档记录', moved && moved.superseded && moved.steps.some(x=>x.stepId==='TS-6' && x.queued))
check('新版本没有任何 TC-104 结果（绝不写回当前版本）', s.caseStateAt('TC-104') === '未执行')

console.log('6. 门禁：全部通过+证据齐全+已确认才可锁定/导出')
check('新版本已确认（登记时即待确认？）— 应为待确认并阻断', s.gateFailures().some(f=>f.includes('尚未确认')))
s.confirmCurrentSnapshot()
check('确认后 TC-101/103 未执行仍阻断', s.gateFailures().some(f=>f.includes('受影响用例须全部通过')))
// 101 通过（重测），103 失败重测为通过（历史失败有证据即可）
s.recordStep('TC-101','TS-1','通过','一致','XS-101')
s.recordStep('TC-101','TS-2','通过','一致','LG-201')
s.recordStep('TC-103','TS-5','通过','互锁恢复正常','VID-901')
check('全部受影响用例通过', s.caseStateAt('TC-101')==='通过' && s.caseStateAt('TC-103')==='通过')
check('门禁通过（历史失败步骤带证据）', s.gateFailures().length === 0)
check('锁定基线成功', s.lockBaseline() === null)
const report = s.buildReport()
check('可导出可发布报告', report.ok === true)
if (report.ok) {
  const parsed = JSON.parse(report.content)
  check('报告只含当前版本受影响用例', parsed.cases.map((c:any)=>c.id).sort().join()==='TC-101,TC-103')
  check('报告注明保留的旧执行数量', parsed.supersededExecutionsKept >= 4)
  const out = join(mkdtempSync(join(tmpdir(),'report-')), 'report.json')
  writeFileSync(out, report.content)
  console.log('    报告示例已写入', out)
}
check('锁定后步骤只读', s.recordStep('TC-101','TS-1','通过','x') !== null)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
