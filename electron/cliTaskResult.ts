/** Exit zero only means the CLI process exited successfully; inspect its model
 * result before reporting success or spending a translation validation retry. */
export function readCliTaskResult(provider: string, stdout: string) {
  if (provider === 'claude') {
    const result = JSON.parse(stdout)
    if (!result || result.is_error === true || (result.subtype && result.subtype !== 'success')) throw new Error('Claude AI 작업이 실패했습니다. ' + String(result?.result ?? result?.subtype ?? '').slice(0, 1000))
    if (typeof result.result !== 'string' || !result.result.trim()) throw new Error('Claude AI 작업에 최종 응답이 없습니다.')
    return result.result
  }
  let final = '', completed = false
  for (const line of stdout.split(/\r?\n/)) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (!event || typeof event !== 'object') continue
    if (event.type === 'turn.failed') throw new Error('Codex AI 작업이 실패했습니다. ' + String(event.error?.message ?? '').slice(0, 1000))
    if (event.type === 'turn.completed') completed = true
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') final = event.item.text
  }
  if (!completed || !final.trim()) throw new Error('Codex AI 작업의 완료된 최종 응답을 확인하지 못했습니다.')
  return final
}
