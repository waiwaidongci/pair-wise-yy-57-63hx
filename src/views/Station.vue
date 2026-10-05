<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { routes, devices } from '../mock'
import { useTestStore } from '../store'
import { notify } from '../message'

const store = useTestStore()
const canvas = ref<HTMLCanvasElement>()
const zoom = ref(1)
let ctx: CanvasRenderingContext2D | undefined
let resizeObserver: ResizeObserver | undefined

// 登记设备关系变更（道岔 / 信号机 / 轨道区段）
const changeDeviceId = ref('P-03')
const changeDescription = ref('')
const changedIds = computed(() => new Set(store.changedDeviceIdsOf(store.currentSnapshotId)))

function draw() {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  element.width = rect.width * ratio
  element.height = rect.height * ratio
  const context = element.getContext('2d')
  if (!context) return
  ctx = context
  context.scale(ratio, ratio)
  context.clearRect(0, 0, rect.width, rect.height)
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, rect.width, rect.height)
  const unitX = rect.width / 100; const unitY = rect.height / 100
  context.strokeStyle = '#e2e8f0'; context.lineWidth = 1
  for (let i=0;i<=100;i+=5) { context.beginPath(); context.moveTo(i*unitX,0); context.lineTo(i*unitX,rect.height); context.stroke(); context.beginPath(); context.moveTo(0,i*unitY); context.lineTo(rect.width,unitY*i); context.stroke() }
  context.lineCap = 'round'; context.lineJoin = 'round'

  // 当前快照下受影响进路整体描红边
  const affected = new Set(store.affectedRoutes)
  routes.forEach((route) => {
    const selected = store.selectedRouteIds.includes(route.id)
    const isAffected = affected.has(route.id)
    context.beginPath(); route.points.forEach((point,index)=>{ const x=point[0]*unitX, y=point[1]*unitY; if(index===0)context.moveTo(x,y); else context.lineTo(x,y) })
    context.strokeStyle = selected ? route.color : isAffected ? '#dc2626' : '#94a3b8'
    context.lineWidth = selected ? 7 : isAffected ? 5 : 3
    context.globalAlpha = selected || isAffected ? 1 : .42; context.stroke(); context.globalAlpha = 1
  })

  devices.forEach((device) => {
    const active = store.selectedCase?.routeIds.some((routeId) => device.routeIds.includes(routeId))
    const changed = changedIds.value.has(device.id)
    context.beginPath(); context.arc(device.x*unitX, device.y*unitY, active ? 12 : 8, 0, Math.PI*2)
    context.fillStyle = device.kind === '道岔' ? (active ? '#d97706' : '#94a3b8') : device.kind === '信号机' ? (active ? '#16a34a' : '#64748b') : (active ? '#2563eb' : '#cbd5e1'); context.fill()
    if (changed) { context.strokeStyle = '#dc2626'; context.lineWidth = 3 }
    else { context.strokeStyle = '#fff'; context.lineWidth = 3 }
    context.stroke()
    if (changed) {
      context.beginPath(); context.arc(device.x*unitX, device.y*unitY, 14, 0, Math.PI*2)
      context.strokeStyle = '#dc2626'; context.lineWidth = 1.5; context.setLineDash([4,3]); context.stroke(); context.setLineDash([])
    }
    context.fillStyle = '#0f172a'; context.font = '600 12px sans-serif'; context.fillText(device.id, device.x*unitX+17, device.y*unitY-10)
  })
}

function registerChange() {
  const error = store.registerChange(changeDeviceId.value, changeDescription.value)
  if (!error) {
    changeDescription.value = ''
    notify(null, `已登记 ${changeDeviceId.value} 变更并生成/更新设备快照，受影响用例已重算`)
    draw()
  } else {
    notify(error, '')
  }
}

function hitTest(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect(); const x=event.offsetX, y=event.offsetY
  let closest = routes[0]!; let distance = Infinity
  routes.forEach((route)=>{ route.points.forEach((point)=>{ const d=Math.hypot(point[0]/100*rect.width-x,point[1]/100*rect.height-y); if(d<distance){distance=d;closest=route} }) })
  if (distance < 45) store.selectedRouteIds = [closest.id]
}
onMounted(async()=>{ await nextTick(); draw(); resizeObserver=new ResizeObserver(draw); resizeObserver.observe(canvas.value!) })
onBeforeUnmount(()=>resizeObserver?.disconnect())
watch(()=>store.selectedCaseId, draw)
watch(()=>store.selectedRouteIds, draw, { deep:true })
watch(()=>store.currentSnapshotId, draw)
watch(()=>store.changes.length, draw)
</script>

<template>
  <section class="page-head">
    <div><p class="eyebrow">站场、进路关系与设备快照</p><h1>Canvas 站场示意</h1><p>红圈/红线为当前设备版本下的变更设备与受影响进路；登记变更会即时重算回归范围并产生新快照版本。</p></div>
    <n-space><n-button @click="zoom=Math.max(.7,zoom-.1); draw()">缩小</n-button><span>{{Math.round(zoom*100)}}%</span><n-button @click="zoom=Math.min(1.5,zoom+.1); draw()">放大</n-button></n-space>
  </section>

  <div class="station-grid">
    <article class="card canvas-card">
      <div class="canvas-head"><span>海州站 · 计算机联锁平面示意（{{store.currentSnapshot?.label}} · {{store.currentSnapshot?.status}}）</span><span>高亮：当前用例进路 ｜ 红圈：变更设备</span></div>
      <canvas ref="canvas" class="station-canvas" @click="hitTest" />
    </article>
    <aside class="card">
      <div class="panel-head"><div><h2>登记设备关系变更</h2><p>保存为新的设备快照版本</p></div></div>
      <n-form label-placement="top" size="small">
        <n-form-item label="变更设备（道岔/信号机/轨道区段）">
          <n-select v-model:value="changeDeviceId" :options="devices.map((d)=>({ label:`${d.id} ${d.name}（${d.kind}）`, value:d.id }))" />
        </n-form-item>
        <n-form-item label="变更说明">
          <n-input v-model:value="changeDescription" type="textarea" :rows="2" placeholder="例如：S-02 增加进路表示器，进路关系调整" />
        </n-form-item>
        <n-button type="error" block :disabled="store.baselineLocked" @click="registerChange">登记变更并重算受影响用例</n-button>
      </n-form>
      <n-alert v-if="store.currentSnapshot?.status === '待确认'" type="warning" class="issue" title="设备变更尚未确认" style="margin-top:10px">现场可继续执行；确认前不能锁定基线或导出可发布报告。</n-alert>

      <n-divider />
      <h3>当前快照变更影响（{{store.affectedRoutes.length}} 条进路 / {{store.affectedCases.length}} 条用例）</h3>
      <div v-for="change in store.changesOf(store.currentSnapshotId)" :key="change.id" class="diff">
        <b>{{change.deviceKind}} · {{change.deviceId}}</b>
        <p>{{change.description}}</p>
        <p>牵连进路：{{change.routeIds.join('、') || '无'}}</p>
      </div>
      <n-empty v-if="!store.changesOf(store.currentSnapshotId).length" description="当前快照无设备变更" />

      <n-divider />
      <h3>进路关系</h3>
      <button v-for="route in routes" :key="route.id" class="route-row" :class="{active:store.selectedRouteIds.includes(route.id)}" @click="store.selectedRouteIds=[route.id]">
        <i :style="{background:route.color}"></i>
        <div><b>{{route.id}} · {{route.name}}</b><small>{{route.devices.join(' → ')}}</small></div>
      </button>
    </aside>
  </div>
</template>
