<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import { notify } from '../message'
import { formatTime } from '../format'

const store = useTestStore()
const failureReason = ref('模拟 3G 占用后，S2 信号未立即关闭，联锁日志出现 126ms 延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')

const currentSteps = computed(() => store.selectedCase
  ? store.stepsAt(store.selectedCase.id, store.currentSnapshotId)
  : [])

function pendingStep() {
  return store.selectedCase?.steps.find((step) => store.stepStateAt(store.selectedCase!.id, step.id) === '未执行')
}

function failStep() {
  const step = pendingStep()
  const item = store.selectedCase
  if (!item || !step) { notify('没有待执行步骤', ''); return }
  if (!failureReason.value.trim()) { notify('失败步骤必须填写实测/失败原因', ''); return }
  if (!evidence.value.trim()) { notify('失败步骤必须登记证据（录屏/日志/截图）', ''); return }
  notify(store.recordStep(item.id, step.id, '失败', failureReason.value, evidence.value), '失败结果已记录')
}
function passStep() {
  const step = pendingStep()
  const item = store.selectedCase
  if (!item || !step) { notify('没有待执行步骤', ''); return }
  notify(store.recordStep(item.id, step.id, '通过', '预期结果一致，证据已归档'), '通过结果已记录')
}
function snapshotLabel(id: string) { return store.snapshots.find((s)=>s.id===id)?.label ?? id }
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">实时执行、证据与断线补传</p>
      <h1>回归执行记录</h1>
      <p>结果按设备快照隔离：旧版本记录失效后保留，断线步骤重连后按发生时间合并回原执行，绝不写入新版本。</p>
    </div>
    <n-space>
      <n-button @click="store.simulateDisconnect()" :disabled="store.connection==='重连中'">模拟断线</n-button>
      <n-button v-if="store.connection==='重连中'" type="warning" @click="notify(store.replayQueue(),'补传步骤已合并')">恢复并补传 {{store.pendingRetry}} 项</n-button>
      <n-button type="success" @click="passStep">记录通过</n-button>
      <n-button type="error" @click="failStep">记录失败（含证据）</n-button>
    </n-space>
  </section>

  <div class="execution-grid">
    <article class="card">
      <div class="panel-head">
        <div><h2>{{store.selectedCase?.id}} 执行面板</h2><p>{{store.selectedCase?.name}}</p></div>
        <n-space>
          <n-tag type="info">{{store.currentSnapshot?.label}} · {{store.currentSnapshot?.status}}</n-tag>
          <n-tag :type="store.connection==='在线'?'success':'warning'">{{store.connection}}</n-tag>
        </n-space>
      </div>
      <n-progress type="line" :percentage="store.progress" :height="12" />
      <n-alert :type="store.connection==='重连中'?'warning':'info'" :title="store.liveMessage" class="issue" />

      <div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="store.stepStateAt(store.selectedCase!.id, step.id)">
        <div>
          <b>{{step.id}} · {{step.action}}</b>
          <small>预期：{{step.expected}}</small>
          <template v-for="result in currentSteps.filter((r)=>r.stepId===step.id).slice(-1)" :key="result.stepId + result.recordedAt">
            <small>实测：{{result.actual}}<span v-if="result.evidence"> · 证据：{{result.evidence}}</span></small>
            <small :class="{queued:result.queued}">{{formatTime(result.recordedAt)}} · {{result.operator}}<template v-if="result.queued"> · 断线补传合并</template></small>
          </template>
        </div>
        <n-tag :type="store.stepStateAt(store.selectedCase!.id,step.id)==='通过'?'success':store.stepStateAt(store.selectedCase!.id,step.id)==='失败'?'error':'info'">
          {{store.stepStateAt(store.selectedCase!.id, step.id)}}
        </n-tag>
      </div>

      <n-form label-placement="top" style="margin-top:10px">
        <n-form-item label="失败原因 / 实测"><n-input v-model:value="failureReason" type="textarea" :rows="3" /></n-form-item>
        <n-form-item label="失败证据（录屏/日志/截图，失败步骤必填）"><n-input v-model:value="evidence" /></n-form-item>
      </n-form>
    </article>

    <aside class="card">
      <div class="panel-head"><div><h2>执行历史</h2><p>按设备快照版本归档，失败与旧版本记录不可覆盖</p></div></div>

      <div v-if="store.pendingRetry" class="queue-box">
        <b>断线补传队列（{{store.pendingRetry}}）</b>
        <div v-for="q in store.queue" :key="q.id" class="queue-item">
          <n-tag size="small" :type="q.snapshotId===store.currentSnapshotId ? 'warning' : 'default'">
            {{q.snapshotId===store.currentSnapshotId ? '当前版本' : '旧版本'}}
          </n-tag>
          <span>{{q.caseId}} / {{q.stepId}} · {{q.result}} · {{formatTime(q.recordedAt)}}</span>
        </div>
        <small>重连后按发生时间合并到各步骤所属快照的原执行记录。</small>
      </div>

      <n-timeline>
        <n-timeline-item
          v-for="record in store.executions" :key="record.id"
          :type="record.superseded ? 'warning' : record.result==='通过'?'success':record.result==='失败'?'error':'info'"
        >
          <template #title>
            {{record.caseId}} · {{record.result}}
            <n-tag v-if="record.superseded" size="small" type="warning" style="margin-left:6px">版本失效·保留</n-tag>
          </template>
          <template #default>
            <div class="record-line">{{record.operator}} · {{formatTime(record.startedAt)}}<template v-if="record.finishedAt"> → {{formatTime(record.finishedAt)}}</template></div>
            <div class="record-line">设备版本：{{snapshotLabel(record.snapshotId)}}</div>
            <div v-for="s in record.steps" :key="s.stepId + s.recordedAt" class="record-line">
              {{s.stepId}} {{s.result}}（{{formatTime(s.recordedAt)}}<template v-if="s.queued">，补传</template>）<template v-if="s.evidence"> · 证据 {{s.evidence}}</template>
            </div>
            <small v-if="record.note" class="record-note">{{record.note}}</small>
          </template>
        </n-timeline-item>
      </n-timeline>
      <n-button block @click="$router.push('/release')">前往基线与报告</n-button>
    </aside>
  </div>
</template>
