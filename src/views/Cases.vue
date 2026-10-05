<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import { notify } from '../message'

const store = useTestStore()
const editMode = ref(false)
const selectedCase = computed(() => store.selectedCase)
const affectedIds = computed(() => new Set(store.affectedCases.map((item) => item.id)))

function latestStep(stepId: string) {
  return store.stepsAt(store.selectedCaseId, store.currentSnapshotId).find((item) => item.stepId === stepId)
}
function markPass(stepId: string) {
  notify(store.recordStep(store.selectedCaseId, stepId, '通过', '批量编辑确认一致'), '已记录通过')
}
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">步骤、预期与依赖</p><h1>测试用例编排</h1><p>用例是跨版本模板；步骤结果按设备快照存放，新版本下重新执行，旧版本记录归档不覆盖。</p></div>
    <n-space><n-switch v-model:value="editMode">批量编辑模式</n-switch><n-button type="primary">新增用例</n-button></n-space>
  </section>

  <div class="case-grid">
    <aside class="card case-list">
      <n-input placeholder="搜索用例、进路或设备" clearable />
      <button v-for="item in store.cases" :key="item.id" :class="{active:item.id===store.selectedCaseId}" @click="store.selectCase(item.id)">
        <div>
          <b>{{item.id}} <n-tag v-if="affectedIds.has(item.id)" size="small" type="error" style="margin-left:4px">本版本受影响</n-tag></b>
          <small>{{item.name}} · {{store.currentSnapshot?.label}} 下「{{store.caseStateAt(item.id)}}」</small>
        </div>
        <n-tag :type="store.caseStateAt(item.id)==='通过'?'success':store.caseStateAt(item.id)==='失败'?'error':'info'">{{store.caseStateAt(item.id)}}</n-tag>
      </button>
    </aside>

    <article class="card detail" v-if="selectedCase">
      <div class="panel-head">
        <div><h2>{{selectedCase.id}} · {{selectedCase.name}}</h2><p>{{selectedCase.precondition}}</p></div>
        <n-space>
          <n-tag :type="affectedIds.has(selectedCase.id) ? 'error' : 'default'">{{affectedIds.has(selectedCase.id) ? '当前版本受影响' : '当前版本不受影响'}}</n-tag>
          <n-tag type="info">{{store.currentSnapshot?.label}}</n-tag>
        </n-space>
      </div>

      <h3>当前设备版本下的步骤结果</h3>
      <div v-for="(step,index) in selectedCase.steps" :key="step.id" class="step">
        <div class="step-index">{{index+1}}</div>
        <div class="step-main">
          <div class="step-head"><b>{{step.action}}</b><n-tag :type="store.stepStateAt(selectedCase.id,step.id)==='通过'?'success':store.stepStateAt(selectedCase.id,step.id)==='失败'?'error':'info'">{{store.stepStateAt(selectedCase.id,step.id)}}</n-tag></div>
          <p>预期：{{step.expected}}</p>
          <small v-if="step.dependency">依赖步骤：{{step.dependency}}</small>
          <template v-for="result in store.stepsAt(selectedCase.id, store.currentSnapshotId).filter((r)=>r.stepId===step.id).slice(-1)" :key="result.stepId">
            <small>实测：{{result.actual}}</small>
            <small v-if="result.evidence">证据：{{result.evidence}}</small>
            <small :class="{queued:result.queued}">{{result.queued ? '断线补传 · ' : ''}}记录人 {{result.operator}}</small>
          </template>
        </div>
        <n-button v-if="editMode" size="small" @click="markPass(step.id)">标记通过</n-button>
      </div>

      <n-divider />
      <div class="dependency">
        <b>依赖图</b>
        <div class="nodes"><span v-for="step in selectedCase.steps" :key="step.id">{{step.id}}</span></div>
        <div class="lines">→ 顺序执行 · 前一步未通过时不得跳过 · 失败步骤必须挂证据</div>
      </div>
    </article>
  </div>
</template>
