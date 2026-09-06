import assert from 'node:assert/strict'
import { decideCodexServerRequest } from '../dist-electron/codexApproval.js'
import { rememberToolTitle } from '../dist-electron/noteContract.js'

/**
 * Codex stops at an MCP tool that writes and asks the client. Prism runs its threads on `on-request` so that
 * question reaches us at all — the old `never` refused it along with everything else — which means this
 * function is now the whole of what a conversation is allowed to do to the machine it is running on.
 */
const elicitation = (overrides = {}) => ({
  threadId: 't', turnId: 'u', serverName: 'prism', mode: 'form',
  _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: rememberToolTitle, tool_params: { node_id: 'concept-aaaaaaaa', section: 'asked', lines: ['x'] } },
  ...overrides,
})
const decide = (method, params) => decideCodexServerRequest(method, params)
const action = (params) => decide('mcpServer/elicitation/request', params).result.action

// The one thing that is approved.
assert.equal(action(elicitation()), 'accept', 'Prism refused its own memory tool.')

// Everything that is not exactly that.
assert.equal(action(elicitation({ serverName: 'somebody-else' })), 'decline', 'A tool from another MCP server was approved.')
assert.equal(action(elicitation({ _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: 'Create a Prism note draft' } })), 'decline', 'A different tool on our own server was approved.')
assert.equal(action(elicitation({ _meta: { codex_approval_kind: 'exec_command', tool_title: rememberToolTitle } })), 'decline', 'A non-tool-call approval wearing our title was approved.')
assert.equal(action(elicitation({ _meta: {} })), 'decline', 'An approval with no metadata was approved.')
assert.equal(action({ serverName: 'prism' }), 'decline', 'An approval with no metadata at all was approved.')

// Running commands and changing files stay refused, as they were under `never`.
assert.equal(decide('item/commandExecution/requestApproval', {}).result.decision, 'decline', 'Running a command was not refused.')
assert.equal(decide('item/fileChange/requestApproval', {}).result.decision, 'decline', 'Changing a file was not refused.')
assert.deepEqual(decide('item/permissions/requestApproval', {}).result, { permissions: {} }, 'Escalating permissions was not refused.')

// Silence hangs the turn, so anything unrecognised is answered with an error rather than ignored.
const unknown = decide('something/newInTheNextRelease', {})
assert(unknown.error?.code === -32601 && unknown.error.message.includes('something/newInTheNextRelease'), `An unknown server request was not answered: ${JSON.stringify(unknown)}`)

process.stdout.write('Codex approval passed: the memory tool is approved, another server\'s tool and another tool on ours are not, commands and file changes and permission escalations stay refused, and an unrecognised request is answered rather than left hanging.\n')
