<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'
import { notify } from '../message'
import { formatDateTime } from '../format'
import { devices } from '../mock'

const store = useTestStore()

const gateFailures = computed(() => store.gateFailures())
const ready = computed(() => gateFailures.value.length === 0)

function deviceName(id: string) { return devices.find((d)=>d.id===id)?.name ?? id }

function lockBaseline() { notify(store.lockBaseline(), '基线已锁定，可导出可发布报告') }

function exportPackage() {
  const report = store.buildReport()
  if (!report.ok) { notify(report.reason, ''); return }
  const blob = new Blob([report.content], { type:'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = report.filename
  link.click()
  URL.revokeObjectURL(link.href)
  notify(null, '可发布报告已导出')
}
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">发布门禁与历史基线</p>
      <h1>基线锁定与测试报告</h1>
      <p>仅在同一设备版本下全部受影响用例通过、失败步骤均有证据、补传全部合并、变更已确认后，才能锁定基线并导出可发布报告。</p>
    </div>
    <n-space>
      <n-button :disabled="store.currentSnapshot?.status !== '待确认'" @click="notify(store.confirmCurrentSnapshot(),'设备变更已确认')">确认设备变更</n-button>
      <n-button type="primary" :disabled="!store.canLockBaseline" @click="lockBaseline">锁定发布基线</n-button>
      <n-button type="success" :disabled="!store.baselineLocked" @click="exportPackage">导出可发布报告</n-button>
    </n-space>
  </section>

  <n-alert
    :type="store.baselineLocked ? 'success' : ready ? 'success' : 'error'"
    :title="store.baselineLocked ? `${store.currentSnapshot?.label} 基线已锁定，可导出报告` : ready ? '门禁已满足，可锁定基线' : '发布门禁未通过'"
    style="margin-bottom:16px"
  >
    <ul v-if="!store.baselineLocked" class="gate-list">
      <li v-for="(failure,index) in gateFailures" :key="index">{{failure}}</li>
      <li v-if="ready">设备版本已确认、受影响用例全部通过、失败步骤证据齐全、补传已合并。</li>
    </ul>
    <span v-else>报告仅包含本设备版本（{{store.currentSnapshot?.label}}）的结果；失效旧版本执行记录数量已在报告中注明但不作为通过依据。</span>
  </n-alert>

  <div class="grid-2">
    <article class="card">
      <div class="panel-head">
        <div><h2>当前版本受影响用例门禁</h2><p>{{store.currentSnapshot?.label}} · {{store.currentSnapshot?.status}}</p></div>
        <n-tag :type="ready?'success':'error'">{{ready?'全部满足':'阻断'}}</n-tag>
      </div>
      <div v-for="item in store.affectedCases" :key="item.id" class="gate">
        <div>
          <b>{{item.id}} · {{item.name}}</b>
          <small>状态：{{store.caseStateAt(item.id)}} · 关联 {{item.routeIds.join(' / ')}}</small>
        </div>
        <n-tag :type="store.caseStateAt(item.id)==='通过'?'success':'error'">{{store.caseStateAt(item.id)}}</n-tag>
      </div>
      <n-empty v-if="!store.affectedCases.length" description="当前版本无受影响用例" />
    </article>

    <article class="card">
      <div class="panel-head"><div><h2>本版本设备差异</h2><p>回归范围由关系图自动推导</p></div><n-tag>{{store.changesOf(store.currentSnapshotId).length}} 项变更</n-tag></div>
      <div v-for="change in store.changesOf(store.currentSnapshotId)" :key="change.id" class="diff">
        <b>{{change.deviceKind}} · {{change.deviceId}} {{deviceName(change.deviceId)}}</b>
        <p>{{change.description}}</p>
        <p>影响进路：{{change.routeIds.join('、')}} · 登记 {{formatDateTime(change.occurredAt)}}</p>
      </div>
      <n-empty v-if="!store.changesOf(store.currentSnapshotId).length" description="当前版本无设备变更" />

      <n-divider />
      <h3>基线与旧版本</h3>
      <n-result
        :status="store.baselineLocked ? 'success' : 'info'"
        :title="store.baselineLocked ? `${store.currentSnapshot?.label} 已锁定` : '等待门禁全部满足'"
        :description="store.baselineLocked ? '报告与证据已按版本签章，旧版本记录归档保留。' : '设备变更未确认或用例未闭环时，只能继续执行，不能生成可发布报告。'"
      />
      <div v-for="snapshot in store.snapshots.filter((s)=>s.id!==store.currentSnapshotId)" :key="snapshot.id" class="diff">
        <b>{{snapshot.label}} · {{snapshot.status}}</b>
        <p>执行记录保留 {{store.executions.filter((e)=>e.snapshotId===snapshot.id).length}} 条，仅供追溯，不参与当前版本门禁。</p>
      </div>
    </article>
  </div>
</template>
