import { createDiscreteApi } from 'naive-ui'

export const { message } = createDiscreteApi(['message'])

/** store 动作返回 null 表示成功；返回字符串为阻断原因 */
export function notify(result: string | null, success: string) {
  if (result) message.warning(result)
  else message.success(success)
}
