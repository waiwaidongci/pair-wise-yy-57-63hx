export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'
export type StepResult = '未执行' | '通过' | '失败'
export type DeviceKind = '道岔' | '信号机' | '轨道区段'
export type SnapshotStatus = '待确认' | '已确认' | '已失效'

export interface StationDevice {
  id: string
  name: string
  kind: DeviceKind
  x: number
  y: number
  routeIds: string[]
}

export interface RouteRelation {
  id: string
  name: string
  color: string
  points: [number, number][]
  devices: string[]
}

/** 用例模板：步骤是模板，执行结果按设备快照存放在 ExecutionRecord 中，不挂在用例上 */
export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  steps: TestStep[]
}

/** 一次已登记的设备关系变更（道岔 / 信号机 / 轨道区段 / 进路关系） */
export interface DeviceChange {
  id: string
  deviceId: string
  deviceKind: DeviceKind
  description: string
  occurredAt: number
  /** 变更直接牵连的进路，由关系图推导，登记时固化 */
  routeIds: string[]
}

/**
 * 设备快照即版本：快照内关系不可变；
 * 新变更登记后产生新快照，旧快照标记为“已失效”，旧执行记录随旧快照保留。
 */
export interface DeviceSnapshot {
  id: string
  label: string
  softwareVersion: string
  status: SnapshotStatus
  createdAt: number
  confirmedAt?: number
  changeIds: string[]
}

/** 单步执行结果（在线直传或断线补传合并而来），按发生时间排序 */
export interface ExecutionStepResult {
  stepId: string
  result: Exclude<StepResult, '未执行'>
  actual: string
  evidence?: string
  recordedAt: number
  operator: string
  queued?: boolean
}

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  startedAt: number
  finishedAt?: number
  /** 执行所属的设备快照版本，永不改写 */
  snapshotId: string
  result: Exclude<TestStatus, '阻塞'>
  steps: ExecutionStepResult[]
  /** 快照版本失效后仅做标记，记录本身保留 */
  superseded: boolean
  note?: string
}

/** 断线期间暂存的步骤，重连后按发生时间合并回对应快照的执行记录 */
export interface QueuedStep {
  id: string
  caseId: string
  snapshotId: string
  stepId: string
  result: Exclude<StepResult, '未执行'>
  actual: string
  evidence?: string
  recordedAt: number
  operator: string
}
