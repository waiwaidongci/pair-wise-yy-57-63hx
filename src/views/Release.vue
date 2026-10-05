<script setup lang="ts">
import { useTestStore } from '../store'

const store = useTestStore()
function exportPackage() {
  if (!store.baselineLocked) return
  const report = {
    station:'海州站 CS',
    snapshot:store.snapshotVersion,
    snapshotLabel:store.currentSnapshot.label,
    locked:store.baselineLocked,
    gate:store.releaseGate.allowed,
    cases:store.cases.map((item)=>({id:item.id,name:item.name,version:item.version,status:item.status,steps:item.steps.length,failureReason:item.failureReason})),
    executions:store.executions,
    generatedAt:new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'})
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download=`联锁测试报告-${store.snapshotVersion}.json`; link.click(); URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>同一设备版本下全部受影响用例通过、失败步骤有证据且变更已确认，才能锁定基线并导出可发布报告。</p></div><n-space><n-button v-if="!store.currentSnapshot.confirmed" type="warning" @click="store.confirmDeviceChanges">确认设备变更</n-button><n-button @click="exportPackage" :disabled="!store.baselineLocked">导出测试报告</n-button><n-button type="primary" :disabled="!store.releaseGate.allowed || store.baselineLocked" @click="store.lockBaseline">锁定发布基线</n-button></n-space></section>
  <n-alert :type="store.releaseGate.allowed ? 'success' : 'error'" :title="store.releaseGate.allowed ? '发布门禁已通过，可锁定基线' : '发布门禁未通过'" style="margin-bottom:16px">
    <template v-if="!store.releaseGate.allowed">
      <ul class="gate-reasons"><li v-for="reason in store.releaseGate.reasons" :key="reason">{{reason}}</li></ul>
    </template>
    <template v-else>设备快照、执行证据和失败闭环均完整，报告可导出。</template>
  </n-alert>
  <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>自动判断，不允许人工绕过</p></div><n-tag :type="store.releaseGate.allowed?'success':'error'">{{store.releaseGate.allowed?'可发布':'阻断'}}</n-tag></div><div v-for="item in store.affectedCases" :key="item.id" class="gate"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.failureReason || '执行记录完整'}}</small></div><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':'warning'">{{item.status}}</n-tag></div></article>
    <article class="card"><div class="panel-head"><div><h2>差异与影响范围</h2><p>{{store.snapshotVersion}} · 设备变更</p></div><n-tag>{{store.changedDevices.length}} 项变更</n-tag></div><div v-for="change in store.changedDevices" :key="change" class="diff"><b>{{change}}</b><p>经道岔/信号机/轨道区段-进路关系接回 {{store.affectedCases.length}} 条受影响用例，需在当前快照版本下重测。</p></div><n-divider /><h3>基线状态</h3><n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? `${store.snapshotVersion} 已锁定` : '等待门禁通过'" :description="store.baselineLocked ? '报告与证据已签章，可导出。' : '锁定后生成只读版本快照；旧版本执行记录保留不覆盖。'" /></article></div>
</template>
