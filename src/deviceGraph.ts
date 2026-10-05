import { devices, routes } from './mock'
import type { DeviceKind } from './types'

export function deviceById(deviceId: string) {
  return devices.find((device) => device.id === deviceId)
}

export function deviceKindOf(deviceId: string): DeviceKind | undefined {
  return deviceById(deviceId)?.kind
}

/**
 * 按道岔、信号机、轨道区段与进路关系推导：
 * 设备关联进路（设备 → routeIds）以及进路包含设备（route.devices）任一命中即受影响。
 */
export function routesAffectedBy(deviceIds: string[]): string[] {
  const wanted = new Set(deviceIds)
  const affected = new Set<string>()
  for (const device of devices) {
    if (!wanted.has(device.id)) continue
    for (const routeId of device.routeIds) affected.add(routeId)
  }
  for (const route of routes) {
    if (route.devices.some((deviceId) => wanted.has(deviceId))) affected.add(route.id)
  }
  return [...affected]
}

/** 用例关联任一受影响进路即必须回归（不再写死进路分支） */
export function casesAffectedBy<T extends { id: string; routeIds: string[] }>(deviceIds: string[], allCases: T[]): T[] {
  const affectedRoutes = new Set(routesAffectedBy(deviceIds))
  return allCases.filter((testCase) => testCase.routeIds.some((routeId) => affectedRoutes.has(routeId)))
}

export function devicesOfRoute(routeId: string) {
  return routes.find((route) => route.id === routeId)?.devices ?? []
}
