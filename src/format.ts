export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
}

export function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })
}

/** 判断失败步骤是否带了证据（空串/纯空格不算） */
export function hasEvidence(evidence?: string) {
  return Boolean(evidence && evidence.trim())
}
