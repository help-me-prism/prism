import { rememberToolTitle } from './noteContract.js'

/**
 * What Prism answers when Codex asks permission.
 *
 * Codex runs a read-only MCP tool without asking and stops at one that writes, putting the question to the
 * client rather than deciding for itself. Prism used to run its threads on `never`, which refused those
 * questions before they were asked — including the one about its own memory tool, which is why a
 * conversation could look something up in the vault and never write anything down.
 *
 * So the thread runs on `on-request` and this decides. Nothing is widened by that: the only thing approved is
 * Prism's own `remember`, and everything else gets the refusal it already had. The approval names a tool by
 * its title rather than its id, which is why the title is a shared constant instead of a string written twice.
 *
 * Silence is not an option — an unanswered request leaves the turn hanging, which is what happened before,
 * when a server request coming back with an id looked like a reply to a call nobody had made.
 */
export type CodexServerReply = { result: Record<string, unknown> } | { error: { code: number; message: string } }

export function decideCodexServerRequest(method: string, params: Record<string, unknown>): CodexServerReply {
  if (method === 'mcpServer/elicitation/request') {
    const meta = (params._meta ?? {}) as Record<string, unknown>
    const ours = params.serverName === 'prism' && meta.codex_approval_kind === 'mcp_tool_call' && meta.tool_title === rememberToolTitle
    return { result: { action: ours ? 'accept' : 'decline' } }
  }
  // Granting no additional permissions is how this particular request is refused.
  if (method === 'item/permissions/requestApproval') return { result: { permissions: {} } }
  if (method.endsWith('/requestApproval')) return { result: { decision: 'decline' } }
  return { error: { code: -32601, message: `Prism은 ${method} 요청에 답하지 않습니다.` } }
}
