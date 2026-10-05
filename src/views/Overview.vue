<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { fetchStation } from '../api'
import { useTestStore } from '../store'
import { useExecutionSocket } from '../realtime'
import { notify } from '../message'
import { formatDateTime } from '../format'
import { devices } from '../mock'

const store = useTestStore()
const { isPending } = useQuery({ queryKey:['station'], queryFn:fetchStation })
useExecutionSocket((value) => store.updateLiveProgress(value), (state) => { store.connection = state })

const stats = computed(() => [
  { label:'测试用例', value:store.cases.length, note:'关联 4 条基本进路' },
  { label:'当前版本回归进度', value:`${store.progress}%`, note:`受影响 ${store.affectedCases.length} 条用例` },
  { label:'失效旧执行', value:store.executions.filter((item)=>item.superseded).length, note:'原记录保留，不回写' },
  { label:'待补传步骤', value:store.pendingRetry, note:store.pendingRetry ? '重连后按时间合并' : '实时同步正常' },
])

function deviceName(id: string) { return devices.find((item)=>item.id===id)?.name ?? id }
function routeNames(ids: string[]) { return ids.join('、') || '—' }
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">设备快照版本与回归范围</p>
      <h1>联锁测试回归总览</h1>
      <p>设备关系一变化即生成快照版本，按道岔、信号机、轨道区段与进路关系重算受影响用例；旧版本执行保留备查。</p>
    </div>
    <n-button type="primary" @click="$router.push('/station')">登记设备变更 / 查看站场</n-button>
  </section>

  <n-spin :show="isPending">
    <div class="metrics">
      <article v-for="item in stats" :key="item.label" class="card metric">
        <span>{{item.label}}</span><strong>{{item.value}}</strong><small>{{item.note}}</small>
      </article>
    </div>

    <n-alert
      :type="store.currentSnapshot?.status === '已确认' ? (store.baselineLocked ? 'success' : 'info') : 'warning'"
      class="head-alert"
      :title="`当前设备版本：${store.currentSnapshot?.label}（${store.currentSnapshot?.status}）`"
    >
      <template #default>
        <span v-if="store.currentSnapshot?.status === '待确认'">设备变更尚未确认：现场可继续执行，但不能锁定基线或生成可发布报告。</span>
        <span v-else-if="store.baselineLocked">基线已锁定，步骤只读，可在「基线与报告」导出可发布报告。</span>
        <span v-else>设备版本已确认，受影响用例全部通过且失败步骤有证据后可锁定基线。</span>
        <n-button size="tiny" style="margin-left:12px" :disabled="store.currentSnapshot?.status !== '待确认'" @click="notify(store.confirmCurrentSnapshot(), '设备变更已确认')">确认当前版本</n-button>
      </template>
    </n-alert>

    <div class="grid-2">
      <article class="card">
        <div class="panel-head">
          <div><h2>本版本设备变更与自动推导范围</h2><p>设备 → 进路 → 用例，关系变化即时重算，不写死分支</p></div>
          <n-tag type="warning">{{store.affectedRoutes.length}} 条进路 / {{store.affectedCases.length}} 条用例</n-tag>
        </div>
        <div v-for="change in store.changesOf(store.currentSnapshotId)" :key="change.id" class="change">
          <n-tag type="error">{{change.deviceKind}}变更</n-tag>
          <div class="grow">
            <b>{{change.deviceId}} · {{deviceName(change.deviceId)}}</b>
            <small>{{change.description}}</small>
            <small>影响进路：{{routeNames(change.routeIds)}} · 登记 {{formatDateTime(change.occurredAt)}}</small>
          </div>
        </div>
        <n-empty v-if="!store.changesOf(store.currentSnapshotId).length" description="当前快照暂无登记变更" />
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>设备快照（版本）</h2><p>旧版本失效后执行记录保留</p></div></div>
        <n-timeline>
          <n-timeline-item
            v-for="snapshot in [...store.snapshots].reverse()" :key="snapshot.id"
            :type="snapshot.id === store.currentSnapshotId ? 'success' : snapshot.status === '已失效' ? 'warning' : 'info'"
            :title="`${snapshot.label} · ${snapshot.status}`"
            :content="`建立 ${formatDateTime(snapshot.createdAt)}${snapshot.changeIds.length ? ' · 变更 '+snapshot.changeIds.length+' 项' : ' · 无设备变更'}${snapshot.id === store.lockedSnapshotId ? ' · 基线已锁定' : ''}`"
          />
        </n-timeline>
      </article>
    </div>

    <article class="card" style="margin-top:16px">
      <div class="panel-head"><div><h2>当前版本受影响用例执行状态</h2><p>只统计当前设备快照下的结果，旧版本通过不抵新版本</p></div><n-tag>{{store.progress}}%</n-tag></div>
      <n-progress type="line" :percentage="store.progress" :height="12" />
      <div v-for="item in store.affectedCases" :key="item.id" class="case-row" @click="store.selectCase(item.id); $router.push('/execution')">
        <div>
          <b>{{item.id}} · {{item.name}}</b>
          <small>{{item.routeIds.join(' / ')}} · 关联步骤 {{item.steps.length}} 个</small>
        </div>
        <n-tag :type="store.caseStateAt(item.id) === '通过' ? 'success' : store.caseStateAt(item.id) === '失败' ? 'error' : 'info'">
          {{store.caseStateAt(item.id)}}
        </n-tag>
      </div>
    </article>
  </n-spin>
</template>
