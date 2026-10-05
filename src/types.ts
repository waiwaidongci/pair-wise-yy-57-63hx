export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'

export type DeviceKind = '道岔' | '信号机' | '轨道区段'

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
  affectedBy: string[]
}

/** 设备变更项：描述某台设备在某个快照版本中发生的变化 */
export interface DeviceChange {
  deviceId: string
  description: string
}

/**
 * 设备快照：把一版站场设备关系作为一个可追溯版本。
 * 变更未确认时现场仍可执行，但不能生成可发布报告。
 */
export interface DeviceSnapshot {
  version: string
  label: string
  confirmed: boolean
  changes: DeviceChange[]
  note?: string
  createdAt: string
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: '未执行' | '通过' | '失败'
  actual?: string
  evidence?: string
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  /** 用例适用的设备快照版本 */
  version: string
  status: TestStatus
  steps: TestStep[]
  failureReason?: string
}

/**
 * 断线期间暂存的步骤结果。恢复后按 occurredAt 合并到原执行记录，
 * 不允许覆盖已有记录。
 */
export interface OfflineStep {
  id: string
  caseId: string
  stepId: string
  result: '通过' | '失败'
  actual?: string
  evidence?: string
  /** 步骤实际发生时间（ISO 时间戳），用于按时间顺序合并 */
  occurredAt: string
  operator: string
}

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  startedAt: string
  finishedAt?: string
  /** 展示用快照，如 'v26.10 / CS-LEU-09' */
  snapshot: string
  /** 绑定的设备快照版本；旧版本记录保留只读，不得回写 */
  snapshotVersion: string
  result: TestStatus
  evidence: string[]
  /** 补传的步骤记录，按发生时间合并 */
  steps?: OfflineStep[]
}
