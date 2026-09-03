import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-mcp-test-'))
const vault = path.join(root, 'Research Vault')
const profile = path.join(root, 'profile')
const port = 9431
const ids = { paperA: 'paper-aaaaaaaa', paperB: 'paper-bbbbbbbb', claim: 'claim-cccccccc', conceptA: 'concept-dddddddd', conceptB: 'concept-eeeeeeee' }
const relationIds = { approved: 'relation-11111111111111111111', pending: 'relation-22222222222222222222', rejected: 'relation-33333333333333333333', concepts: 'relation-44444444444444444444' }
const anchor = { paperId: 'test.0001', paperTitle: 'Paper Alpha', anchorId: 'equation-p2-3', type: 'equation', page: 2, label: '수식1', source: 'L_simple is a denoising score matching objective.', sourceHash: 'abc', blockId: 'evidence-test-0001-equation-p2-3' }
const evidenceComment = `<!-- prism-evidence:${encodeURIComponent(JSON.stringify(anchor))} -->`

function assert(condition, message) { if (!condition) throw new Error(message) }
function note(id, type, title, body) { return `---\ntype: ${type}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: developing\nimportance: medium\nconfidence: medium\ncreated_by: user\ntemplate_id: ""\n---\n\n# ${title}\n\n${body}\n` }
async function write(relative, content) { const target = path.join(vault, ...relative.split('/')); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8') }
async function call(client, name, args) { const response = await client.callTool({ name, arguments: args }); return response }
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function waitFor(check, message, timeout = 8_000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await sleep(100) } throw new Error(message) }
async function waitForPage() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) { try { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()); const page = pages.find((item) => item.type === 'page' && item.title === 'Prism'); if (page?.webSocketDebuggerUrl) return page } catch { /* Electron is starting. */ } await sleep(120) }
  throw new Error('Electron did not expose the Prism page for MCP anchor verification.')
}
async function connectDebugger(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl); const pending = new Map(); let sequence = 0
  socket.addEventListener('message', (event) => { const message = JSON.parse(String(event.data)); if (!message.id) return; const callback = pending.get(message.id); if (!callback) return; pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result) })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  function send(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) }) }
  async function evaluate(expression) { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.text); return response.result.value }
  await send('Runtime.enable'); return { socket, evaluate }
}

await fs.mkdir(path.join(vault, '.prism', 'relations'), { recursive: true })
await write('Papers/Paper Alpha.md', note(ids.paperA, 'paper', 'Paper Alpha', `The diffusion objective predicts noise.\n\n> [!evidence] 수식 · Paper Alpha · p.2 · 수식1\n> ${anchor.source}\n${evidenceComment}\n^${anchor.blockId}`))
await write('Papers/Paper Beta.md', note(ids.paperB, 'paper', 'Paper Beta', 'A second diffusion study evaluates sample quality.'))
await write('Claims/Noise prediction claim.md', note(ids.claim, 'claim', 'Noise prediction is score matching', 'Noise prediction is equivalent to weighted score matching.'))
await write('Concepts/Reverse diffusion.md', note(ids.conceptA, 'concept', 'Reverse diffusion', 'Reverse diffusion gradually removes noise to recover a sample.'))
await write('Concepts/Denoising process.md', note(ids.conceptB, 'concept', 'Denoising process', 'A denoising process gradually removes noise to recover a sample.'))
await write('Templates/Claim - MCP draft.md', `---\ntype: template\ntemplate_id: claim-mcp-draft\nnode_type: claim\nname: "Claim - MCP draft"\n---\n\n# {{title}}\n\nDate: {{date}}\n\nProject: {{current_project}}\n\n## Evidence\n`)
await write('.prism/anchors/test.0001.json', JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [{ id: anchor.anchorId, type: 'equation', page: 2, source: anchor.source }] }, null, 2))
const pdfPath = path.join(vault, 'papers', 'test.0001', 'original.pdf'); await fs.mkdir(path.dirname(pdfPath), { recursive: true }); await fs.writeFile(pdfPath, '')
await write('.prism/library.json', JSON.stringify([{ arxivId: 'test.0001', title: 'Paper Alpha', pdfPath }], null, 2))
for (const relation of [
  { id: relationIds.approved, sourceId: ids.paperA, targetId: ids.claim, type: 'supports', creator: 'user', reviewStatus: 'approved' },
  { id: relationIds.pending, sourceId: ids.paperB, targetId: ids.claim, type: 'contradicts', creator: 'ai', reviewStatus: 'pending' },
  { id: relationIds.rejected, sourceId: ids.paperB, targetId: ids.claim, type: 'supports', creator: 'ai', reviewStatus: 'rejected' },
  { id: relationIds.concepts, sourceId: ids.conceptA, targetId: ids.conceptB, type: 'related', creator: 'user', reviewStatus: 'approved' },
]) await write(`.prism/relations/${relation.id}.json`, JSON.stringify({ ...relation, createdAt: '2026-09-03T00:00:00.000Z' }, null, 2))

let client
let transport
let electron
let debuggerConnection
try {
  transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist-electron/mcpServer.js'), '--vault', vault], cwd: process.cwd(), stderr: 'pipe' })
  client = new Client({ name: 'prism-mcp-smoke', version: '1.0.0' })
  await client.connect(transport)
  const listed = await client.listTools(); const names = listed.tools.map((tool) => tool.name)
  assert(JSON.stringify(names) === JSON.stringify(['search_knowledge', 'get_claim_evidence', 'find_related_concepts', 'compare_papers', 'open_paper_anchor', 'suggest_relationships', 'create_note_draft']), `Unexpected MCP tools: ${JSON.stringify(names)}`)
  assert(listed.tools.every((tool) => tool.inputSchema?.type === 'object'), 'An MCP tool did not expose an object input schema.')
  assert(listed.tools.find((tool) => tool.name === 'search_knowledge')?.annotations?.readOnlyHint === true, 'Search was not declared read-only.')
  assert(listed.tools.find((tool) => tool.name === 'create_note_draft')?.annotations?.destructiveHint === false, 'Draft creation was not declared non-destructive.')

  const search = await call(client, 'search_knowledge', { query: 'noise removal process', limit: 5 })
  assert(!search.isError && search.structuredContent.results.some((item) => item.node.id === ids.conceptA || item.node.id === ids.conceptB), 'MCP hybrid search did not return a relevant Concept.')
  assert(search.structuredContent.results.every((item) => !path.isAbsolute(item.node.relativePath) && !item.node.relativePath.includes('\\')), 'MCP search leaked an absolute or platform-specific path.')

  const evidence = await call(client, 'get_claim_evidence', { claim_id: ids.claim })
  assert(!evidence.isError && evidence.structuredContent.relations.length === 1 && evidence.structuredContent.relations[0].id === relationIds.approved, 'Claim evidence included a pending or rejected relation.')
  assert(evidence.structuredContent.evidence.some((item) => item.anchorId === anchor.anchorId && item.source.includes('denoising score matching')), 'Claim evidence did not preserve the exact PDF source separately.')

  const related = await call(client, 'find_related_concepts', { concept_id: ids.conceptA })
  assert(!related.isError && related.structuredContent.related.some((item) => item.node.id === ids.conceptB && item.relation.id === relationIds.concepts), 'Related Concepts did not follow an approved typed relation.')
  const comparison = await call(client, 'compare_papers', { paper_ids: [ids.paperA, ids.paperB] })
  assert(!comparison.isError && comparison.structuredContent.papers.length === 2 && comparison.structuredContent.papers[0].noteExcerpt, 'Paper comparison did not return bounded source records.')
  assert(comparison.structuredContent.papers.flatMap((item) => item.relations).every((item) => item.reviewStatus === 'approved'), 'Paper comparison included an unapproved relation.')

  const suggestions = await call(client, 'suggest_relationships', { node_id: ids.conceptA })
  assert(!suggestions.isError && Array.isArray(suggestions.structuredContent.suggestions), 'Relationship suggestion did not return a structured list.')
  const invalid = await call(client, 'get_claim_evidence', { claim_id: ids.paperA })
  assert(invalid.isError && String(invalid.content?.[0]?.text).includes('Claim'), 'A wrong node type did not return a recoverable MCP tool error.')

  electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '.'], { cwd: process.cwd(), env: { ...process.env, PRISM_TEST_LIBRARY_PATH: vault, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  debuggerConnection = await connectDebugger(await waitForPage())
  await debuggerConnection.evaluate(`window.__mcpAnchors = []; window.prism.onOpenEvidenceAnchor((anchor) => window.__mcpAnchors.push(anchor))`)
  const opened = await call(client, 'open_paper_anchor', { anchor_id: anchor.anchorId, paper_id: anchor.paperId })
  assert(!opened.isError && opened.structuredContent.queued && opened.structuredContent.requestPath === '.prism/cache/mcp-open-anchor.json', 'Opening an anchor did not create a portable queue result.')
  const queued = JSON.parse(await fs.readFile(path.join(vault, '.prism', 'cache', 'mcp-open-anchor.json'), 'utf8'))
  assert(queued.anchorId === anchor.anchorId && !JSON.stringify(queued).includes(vault), 'The anchor queue was invalid or leaked an absolute path.')
  await waitFor(() => debuggerConnection.evaluate(`window.__mcpAnchors?.some((anchor) => anchor.anchorId === ${JSON.stringify(anchor.anchorId)})`), 'A running Prism app did not consume the MCP anchor queue and navigate the Reader.')

  const draft = await call(client, 'create_note_draft', { template_id: 'claim-mcp-draft', title: 'MCP generated hypothesis', variables: { current_project: 'Diffusion study' } })
  assert(!draft.isError && draft.structuredContent.node.relativePath === 'Claims/MCP generated hypothesis.md', 'Draft creation did not return a portable Markdown path.')
  const draftMarkdown = await fs.readFile(path.join(vault, 'Claims', 'MCP generated hypothesis.md'), 'utf8')
  assert(draftMarkdown.includes('created_by: ai') && draftMarkdown.includes('draft: true') && draftMarkdown.includes('Project: Diffusion study') && !draftMarkdown.includes('{{date}}'), 'The MCP draft did not preserve provenance or apply template variables.')
  const collision = await call(client, 'create_note_draft', { template_id: 'claim-mcp-draft', title: 'MCP generated hypothesis' })
  assert(collision.isError && String(collision.content?.[0]?.text).includes('이미'), 'Draft creation overwrote or renamed a colliding user path.')

  await client.close(); client = undefined
  const missingPath = path.join(root, 'missing-vault')
  const missingExit = await new Promise((resolve) => { const child = spawn(process.execPath, [path.resolve('dist-electron/mcpServer.js'), '--vault', missingPath], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk }); child.on('exit', (code) => resolve({ code, stderr })) })
  assert(missingExit.code !== 0 && missingExit.stderr.includes('Vault') && !missingExit.stderr.includes(missingPath), 'A missing Vault did not fail safely without exposing its path.')
  process.stdout.write('Knowledge MCP passed: seven stdio tools, schemas, hybrid search, approved-only evidence and relations, comparison, suggestions, live Reader anchor navigation, non-overwriting AI drafts, portable paths, and recoverable errors.\n')
} finally {
  if (client) await client.close().catch(() => undefined)
  debuggerConnection?.socket.close()
  if (electron?.exitCode === null) { electron.kill(); await new Promise((resolve) => electron.once('exit', resolve)) }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
