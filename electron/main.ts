import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { accessSync, constants as fsConstants, promises as fs, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import * as tar from 'tar'
import { parseLatexStructure, type LatexStructure } from './latex.js'
import { readNoteSnapshot, saveNoteSnapshot, type NoteSaveRequest } from './notes.js'
import { deleteTemplate, listTemplates, saveTemplate, setDefaultTemplate, setFavoriteTemplate, type KnowledgeNodeType, type TemplateSaveRequest } from './templates.js'
import { applyTemplateSections, migratePaperNotes, paperNodeId, copyKnowledgeEvidence, createKnowledgeNode, deleteKnowledgeNode, restoreKnowledgeNode, listKnowledgeBacklinks, listKnowledgeNodes, readKnowledgeNode, saveKnowledgeNode, searchKnowledge, updateKnowledgeProperties, type ApplyTemplateSectionsRequest, type KnowledgeCreateRequest, type KnowledgeEvidenceCopyRequest, type KnowledgePropertyPatch } from './knowledge.js'
import { listEvidenceAnchors, listEvidenceBacklinks } from './evidence.js'
import { createKnowledgeRelation, deleteKnowledgeRelation, listKnowledgeRelations, reviewKnowledgeRelation, syncLinkRelations, updateKnowledgeRelation, type KnowledgeRelationCreateRequest, type KnowledgeRelationDeleteRequest, type KnowledgeRelationReviewRequest, type KnowledgeRelationUpdateRequest } from './relations.js'
import { listKnowledgeDataViews } from './knowledgeViews.js'
import { buildObsidianOpenUri, type ObsidianOpenRequest } from './obsidian.js'
import { rebuildResearchIndex, retrieveResearchContext, searchResearchKnowledge } from './researchSearch.js'
import { suggestKnowledge } from './knowledgeSuggestions.js'
import { readMcpOpenAnchorRequest } from './knowledgeMcp.js'
import { captureToPaperNote, ensureLinkStubs, type PaperCaptureRequest } from './capture.js'
import { listCurationQueue, mergeConcepts, promoteMemo, type MergeConceptsRequest, type PromoteMemoRequest } from './curation.js'
import { reviewModelSuggestion, runModelSuggestions, type ModelSuggestionReview } from './knowledgeAi.js'
import { listPaperCitations } from './citations.js'
import { pruneEmptySections, readChatMessages, refreshNoteDigest, titleMatcher } from './paperDigest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type ProviderId = 'codex' | 'claude'
type ChatRequest = { prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }
type ActiveChat = { provider: ProviderId; process?: ChildProcessWithoutNullStreams; threadId?: string; turnId?: string }
type RpcResponse = { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown> }
type AppSettings = { libraryPath?: string; translationProvider: ProviderId; translationModel: string; autoTranslate: boolean; knowledgeProvider?: ProviderId; knowledgeModel?: string }
type ArxivPaper = { arxivId: string; title: string; authors: string[]; summary: string; published: string; updated: string; categories: string[]; pdfUrl: string; absUrl: string; citationCount?: number }
type PaperRecord = ArxivPaper & { pdfPath: string; notePath: string; translationPath: string; sourcePath?: string; downloadedAt: number }
type TranslationSegment = { id: string; page: number; source: string; kind: 'text' | 'heading' | 'caption' | 'equation' | 'table' | 'artifact'; itemIndexes?: number[]; itemSlices?: Array<{ itemIndex: number; start: number; end: number }>; translation?: string; sourceMode?: 'latex' | 'pdf'; blockId?: string; sectionTitle?: string; paragraphContext?: string }

function normalizePdfControls(value: string) {
  return value.replace(/\u000f/g, 'ε').replace(/[\u0000-\u0008\u000b\u000c\u000e\u0010-\u001f\u007f]/g, '')
}

const activeChats = new Map<string, ActiveChat>()
const sessionOwners = new Map<string, { sender: WebContents; sessionId: string; messageId: string }>()
const translationJobs = new Map<string, ChildProcessWithoutNullStreams>()
const activeAuthProcesses = new Map<string, ChildProcessWithoutNullStreams>()

function findCli(name: string): string | null {
  const override = process.env[`PRISM_${name.toUpperCase()}_PATH`]
  if (override) {
    try { accessSync(override, fsConstants.X_OK); return override } catch { /* continue with discovery */ }
  }
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true })
  if (result.status === 0) {
    const candidates = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const discovered = candidates.find((candidate) => process.platform !== 'win32' || candidate.toLowerCase().endsWith('.exe')) ?? candidates[0]
    if (discovered) return discovered
  }
  if (process.platform === 'win32') return null
  const home = app.getPath('home')
  const candidates = [
    path.join(home, '.local', 'bin', name),
    path.join(home, '.npm-global', 'bin', name),
    path.join(home, '.claude', 'local', name),
    path.join('/opt/homebrew/bin', name),
    path.join('/usr/local/bin', name),
    path.join('/usr/bin', name),
  ]
  for (const candidate of candidates) {
    try { accessSync(candidate, fsConstants.X_OK); return candidate } catch { /* try the next standard CLI location */ }
  }
  return null
}

function buildCliEnv(): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return { ...process.env }
  const home = app.getPath('home')
  // DMG/Finder 실행 시 PATH가 /usr/bin:/bin:/usr/sbin:/sbin 수준으로 제한됨.
  // codex/claude 가 #!/usr/bin/env node 스크립트이므로 node 경로를 PATH에 직접 포함.
  const extra: string[] = [
    '/opt/homebrew/bin',   // Homebrew (Apple Silicon)
    '/opt/homebrew/sbin',
    '/usr/local/bin',      // Homebrew (Intel) / nvm system
    '/usr/bin',
    '/bin',
  ]
  // nvm 기본 버전 bin 폴더 추가 — alias가 'lts/*' 등 심볼릭일 수 있으므로 실제 디렉토리 탐색
  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node')
    const nvmVersions = readdirSync(nvmDir)
      .filter((d) => d.startsWith('v'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    if (nvmVersions.length) extra.unshift(path.join(nvmDir, nvmVersions[0], 'bin'))
  } catch { /* nvm 없음 */ }
  // volta
  const voltaBin = path.join(home, '.volta', 'bin')
  try { accessSync(voltaBin, fsConstants.X_OK); extra.unshift(voltaBin) } catch { /* volta 없음 */ }
  // nodenv
  const nodenvShims = path.join(home, '.nodenv', 'shims')
  try { accessSync(nodenvShims, fsConstants.X_OK); extra.unshift(nodenvShims) } catch { /* nodenv 없음 */ }

  const current = process.env.PATH ?? ''
  const merged = [...extra, ...current.split(':')].filter(Boolean)
  const deduped = [...new Set(merged)]
  return { ...process.env, PATH: deduped.join(':') }
}

function spawnCli(executable: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
  const env = options.env ?? buildCliEnv()
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${executable}"`, ...args], { ...options, env, stdio: ['pipe', 'pipe', 'pipe'] })
  }
  return spawn(executable, args, { ...options, env, stdio: ['pipe', 'pipe', 'pipe'] })
}

function safeSend(sender: WebContents, channel: string, payload: unknown) {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function codexModels() {
  try {
    const cachePath = path.join(app.getPath('home'), '.codex', 'models_cache.json')
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as { models?: Array<Record<string, unknown>> }
    const models = (parsed.models ?? []).filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
      .map((model) => ({ id: String(model.slug), name: String(model.display_name ?? model.slug), description: String(model.description ?? '') }))
    if (models.length) return models
  } catch { /* use portable fallbacks */ }
  return [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: '가장 강력한 Codex 모델' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: '균형 잡힌 작업용 모델' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: '빠르고 가벼운 모델' },
  ]
}

function providerInfo() {
  const cliEnv = buildCliEnv()
  const codexExecutable = findCli('codex')
  const codexLogin = codexExecutable ? spawnSync(codexExecutable, ['login', 'status'], { encoding: 'utf8', timeout: 7_000, windowsHide: true, env: cliEnv }) : undefined
  const codexAvailable = Boolean(codexExecutable && codexLogin?.status === 0)
  const codexStatus = !codexExecutable ? 'CLI를 찾지 못했습니다'
    : codexLogin?.status === 0 ? '연결됨'
      : codexLogin?.error ? '로그인 상태 확인 실패' : 'CLI 설치됨 · 로그인 필요'
  const claudeExecutable = findCli('claude')
  const claudeAuth = claudeExecutable ? spawnSync(claudeExecutable, ['auth', 'status'], { encoding: 'utf8', timeout: 7_000, windowsHide: true, env: cliEnv }) : undefined
  let claudeAvailable = false
  let claudeStatus = 'Claude CLI를 찾지 못했습니다'
  if (claudeExecutable) {
    if (claudeAuth?.status === 0) {
      try {
        const info = JSON.parse(claudeAuth.stdout) as { loggedIn?: boolean; email?: string }
        claudeAvailable = info.loggedIn === true
        claudeStatus = claudeAvailable ? `연결됨${info.email ? ` · ${info.email}` : ''}` : 'CLI 설치됨 · 로그인 필요'
      } catch { claudeStatus = '로그인 상태 확인 실패' }
    } else {
      claudeStatus = claudeAuth?.error ? '로그인 상태 확인 실패' : 'CLI 설치됨 · 로그인 필요'
    }
  }
  return [
    { id: 'codex', name: 'Codex', available: codexAvailable, status: codexStatus, models: codexModels() },
    { id: 'claude', name: 'Claude', available: claudeAvailable, status: claudeStatus, models: [
      { id: 'sonnet', name: 'Claude Sonnet', description: '속도와 성능의 균형' },
      { id: 'opus', name: 'Claude Opus', description: '가장 복잡한 연구와 추론' },
      { id: 'haiku', name: 'Claude Haiku', description: '빠르고 효율적인 응답' },
    ] },
  ]
}

class CodexAppServer {
  private process?: ChildProcessWithoutNullStreams
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>()
  private ready?: Promise<void>

  ensureReady() {
    if (this.ready) return this.ready
    this.ready = this.start().catch((error) => { this.ready = undefined; throw error })
    return this.ready
  }

  private async start() {
    const executable = findCli('codex')
    if (!executable) throw new Error('Codex CLI를 찾지 못했습니다.')
    this.process = spawnCli(executable, ['app-server', '--stdio'], { cwd: app.getPath('documents'), env: { ...process.env, NO_COLOR: '1' }, windowsHide: true })
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', (chunk: string) => console.error(`Codex app-server: ${chunk.trim()}`))
    this.process.on('close', () => {
      for (const request of this.pending.values()) request.reject(new Error('Codex 연결이 종료되었습니다.'))
      this.pending.clear(); this.process = undefined; this.ready = undefined
    })
    await this.request('initialize', { clientInfo: { name: 'prism', title: 'Prism', version: app.getVersion() }, capabilities: null })
    this.notify('initialized')
  }

  private onData(chunk: string) {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { this.onMessage(JSON.parse(line) as RpcResponse) }
      catch { console.error(`Invalid Codex app-server output: ${line}`) }
    }
  }

  private onMessage(message: RpcResponse) {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? 'Codex 요청에 실패했습니다.'))
      else pending.resolve(message.result ?? {})
      return
    }
    if (!message.method || !message.params) return
    const threadId = typeof message.params.threadId === 'string' ? message.params.threadId : undefined
    const owner = threadId ? sessionOwners.get(threadId) : undefined
    if (!owner) return
    if (message.method === 'item/agentMessage/delta' && typeof message.params.delta === 'string') {
      safeSend(owner.sender, 'chat:event', { type: 'text.delta', sessionId: owner.sessionId, messageId: owner.messageId, text: message.params.delta })
    } else if (message.method === 'turn/completed') {
      activeChats.delete(owner.sessionId)
      safeSend(owner.sender, 'chat:done', { sessionId: owner.sessionId, code: 0 })
    } else if (message.method === 'error') {
      safeSend(owner.sender, 'chat:error', { sessionId: owner.sessionId, message: String(message.params.message ?? 'Codex 오류') })
    }
  }

  private write(message: unknown) {
    if (!this.process) throw new Error('Codex app-server가 실행되지 않았습니다.')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  request(method: string, params: Record<string, unknown>) {
    const id = this.nextId++
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ id, method, params })
    })
  }

  notify(method: string) { this.write({ method }) }

  async send(sender: WebContents, request: ChatRequest) {
    await this.ensureReady()
    let threadId = request.providerThreadId
    if (threadId) {
      await this.request('thread/resume', { threadId, model: request.model, cwd: app.getPath('documents'), approvalPolicy: 'never', sandbox: 'read-only', excludeTurns: true })
    } else {
      const result = await this.request('thread/start', { model: request.model, cwd: app.getPath('documents'), approvalPolicy: 'never', sandbox: 'read-only' })
      const thread = result.thread as Record<string, unknown> | undefined
      if (!thread || typeof thread.id !== 'string') throw new Error('Codex 세션 ID를 받지 못했습니다.')
      threadId = thread.id
      safeSend(sender, 'chat:event', { type: 'thread.started', sessionId: request.sessionId, providerThreadId: threadId })
    }
    sessionOwners.set(threadId, { sender, sessionId: request.sessionId, messageId: request.messageId })
    const result = await this.request('turn/start', { threadId, model: request.model, input: [{ type: 'text', text: request.prompt, text_elements: [] }] })
    const turn = result.turn as Record<string, unknown> | undefined
    activeChats.set(request.sessionId, { provider: 'codex', threadId, turnId: typeof turn?.id === 'string' ? turn.id : undefined })
  }

  async cancel(sessionId: string) {
    const active = activeChats.get(sessionId)
    if (!active?.threadId || !active.turnId) return false
    await this.request('turn/interrupt', { threadId: active.threadId, turnId: active.turnId })
    activeChats.delete(sessionId)
    return true
  }

  stop() { this.process?.kill() }
}

const codexServer = new CodexAppServer()

function sendClaude(sender: WebContents, request: ChatRequest) {
  const executable = findCli('claude')
  if (!executable) throw new Error('Claude CLI가 설치되어 있지 않습니다. 설치 후 다시 시도해 주세요.')
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--model', request.model]
  if (request.providerThreadId) args.push('--resume', request.providerThreadId)
  const child = spawnCli(executable, args, { cwd: app.getPath('documents'), env: { ...process.env, NO_COLOR: '1' }, windowsHide: true })
  activeChats.set(request.sessionId, { provider: 'claude', process: child })
  let buffer = ''; let stderr = ''; let receivedDelta = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        if (typeof event.session_id === 'string') safeSend(sender, 'chat:event', { type: 'thread.started', sessionId: request.sessionId, providerThreadId: event.session_id })
        const streamEvent = event.event as Record<string, unknown> | undefined
        const delta = streamEvent?.delta as Record<string, unknown> | undefined
        if (streamEvent?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
          receivedDelta = true
          safeSend(sender, 'chat:event', { type: 'text.delta', sessionId: request.sessionId, messageId: request.messageId, text: delta.text })
        }
        if (event.type === 'result' && !receivedDelta && typeof event.result === 'string') {
          safeSend(sender, 'chat:event', { type: 'text.delta', sessionId: request.sessionId, messageId: request.messageId, text: event.result })
        }
      } catch { /* diagnostics are reported from stderr on failure */ }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  child.on('error', (error) => safeSend(sender, 'chat:error', { sessionId: request.sessionId, message: error.message }))
  child.on('close', (code) => {
    activeChats.delete(request.sessionId)
    if (code && stderr.trim()) safeSend(sender, 'chat:error', { sessionId: request.sessionId, message: stderr.trim() })
    safeSend(sender, 'chat:done', { sessionId: request.sessionId, code })
  })
  child.stdin.end(request.prompt)
}

function sessionsPath() { return path.join(app.getPath('userData'), 'sessions.json') }
async function loadSessions() {
  try { const parsed = JSON.parse(await fs.readFile(sessionsPath(), 'utf8')); return Array.isArray(parsed) ? parsed : [] }
  catch { return [] }
}
async function saveSessions(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) throw new Error('저장할 수 없는 세션 데이터입니다.')
  const json = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(json) > 15 * 1024 * 1024) throw new Error('세션 저장 용량이 15MB를 초과했습니다.')
  await fs.mkdir(path.dirname(sessionsPath()), { recursive: true })
  await fs.writeFile(sessionsPath(), json, 'utf8')
  scheduleChatRouting()
  return true
}

/**
 * Chat is where the researcher says what they do not understand, and a note that only hears about it when
 * somebody happens to open it is a filing cabinet, not a memory. Every time a conversation settles, the
 * notes it was about catch up on their own: the papers in its context, and any concept, claim or question
 * whose name came up. Only the generated regions move, and only for free — no model runs here, so this
 * costs a few file reads and can happen in the background without asking.
 */
let chatRoutingTimer: NodeJS.Timeout | undefined
let chatRouting: Promise<void> = Promise.resolve()
function scheduleChatRouting() {
  if (chatRoutingTimer) clearTimeout(chatRoutingTimer)
  // Streaming saves the session on every chunk; the interesting moment is when it stops.
  chatRoutingTimer = setTimeout(() => { chatRouting = chatRouting.then(routeChatIntoNotes).catch(() => undefined) }, 4000)
}
async function routeChatIntoNotes() {
  const settings = await readSettings()
  if (!settings.libraryPath) return
  const messages = await readChatMessages(sessionsPath())
  if (!messages.length) return
  const recent = messages.slice(-40)
  const spokenAbout = new Set(recent.flatMap((message) => [...(message.paperIds ?? []), ...(message.anchors ?? []).map((anchor) => anchor.paperId)]))
  const said = recent.filter((message) => message.role === 'user').map((message) => message.text).join('\n')
  const nodes = await listKnowledgeNodes(settings.libraryPath).catch(() => [])
  const targets = nodes.filter((node) => node.nodeType === 'paper'
    ? Boolean(node.arxivId && spokenAbout.has(node.arxivId))
    : ['concept', 'claim', 'question'].includes(node.nodeType) && titleMatcher(node.title)(said))
  for (const node of targets.slice(0, 12)) {
    // One note failing — renamed, open in Obsidian, mid-edit — must not stop the others catching up.
    try { await refreshNoteDigest(settings.libraryPath, node.id, messages) } catch { /* it will catch up on the next turn */ }
  }
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json') }
async function readSettings(): Promise<AppSettings> {
  const testLibraryPath = process.env.PRISM_TEST_LIBRARY_PATH
  try {
    const value = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
    return {
      libraryPath: testLibraryPath || (typeof value.libraryPath === 'string' ? value.libraryPath : undefined),
      translationProvider: value.translationProvider === 'claude' ? 'claude' : 'codex',
      translationModel: typeof value.translationModel === 'string' ? value.translationModel : 'gpt-5.6-terra',
      autoTranslate: process.env.PRISM_TEST_DISABLE_AUTO_TRANSLATE === '1' ? false : value.autoTranslate !== false,
      knowledgeProvider: value.knowledgeProvider === 'claude' || value.knowledgeProvider === 'codex' ? value.knowledgeProvider : undefined,
      knowledgeModel: typeof value.knowledgeModel === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value.knowledgeModel) ? value.knowledgeModel : undefined,
    }
  } catch { return { libraryPath: testLibraryPath || undefined, translationProvider: 'codex', translationModel: 'gpt-5.6-terra', autoTranslate: process.env.PRISM_TEST_DISABLE_AUTO_TRANSLATE !== '1' } }
}
async function writeSettings(patch: Partial<AppSettings>) {
  const current = await readSettings()
  if (process.env.PRISM_TEST_LIBRARY_PATH) {
    try {
      const stored = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
      current.libraryPath = typeof stored.libraryPath === 'string' ? stored.libraryPath : undefined
    } catch { current.libraryPath = undefined }
  }
  const next = { ...current, ...patch }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

function libraryIndexPath(libraryPath: string) { return path.join(libraryPath, '.prism', 'library.json') }
/** library.json stores absolute paths; when the folder was moved, copied, or synced to another machine, rebase them under the current library. */
function rebasePaperRecord(libraryPath: string, record: PaperRecord): PaperRecord {
  const inside = (candidate: string | undefined) => Boolean(candidate) && !path.relative(libraryPath, candidate!).startsWith('..') && !path.isAbsolute(path.relative(libraryPath, candidate!))
  if (inside(record.pdfPath) && inside(record.notePath)) return record
  const safeId = record.arxivId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const paperDir = path.join(libraryPath, 'papers', safeId)
  return {
    ...record,
    pdfPath: inside(record.pdfPath) ? record.pdfPath : path.join(paperDir, path.basename(record.pdfPath || 'original.pdf')),
    notePath: inside(record.notePath) ? record.notePath : path.join(paperDir, path.basename(record.notePath || `${safeId}.md`)),
    translationPath: inside(record.translationPath) ? record.translationPath : path.join(paperDir, path.basename(record.translationPath || 'translation.ko.json')),
    sourcePath: record.sourcePath ? inside(record.sourcePath) ? record.sourcePath : path.join(paperDir, path.basename(record.sourcePath)) : undefined,
  }
}
async function readLibrary(): Promise<PaperRecord[]> {
  const settings = await readSettings()
  if (!settings.libraryPath) return []
  try {
    const value = JSON.parse(await fs.readFile(libraryIndexPath(settings.libraryPath), 'utf8'))
    return Array.isArray(value) ? (value as PaperRecord[]).map((record) => rebasePaperRecord(settings.libraryPath!, record)) : []
  } catch { return [] }
}
async function writeLibrary(records: PaperRecord[]) {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  const indexPath = libraryIndexPath(settings.libraryPath)
  await fs.mkdir(path.dirname(indexPath), { recursive: true })
  await fs.writeFile(indexPath, JSON.stringify(records, null, 2), 'utf8')
}

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}
function xmlTag(source: string, tag: string) {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeXml(match[1]) : ''
}
function parseArxivFeed(xml: string): ArxivPaper[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const entry = match[1]
    const absUrl = xmlTag(entry, 'id').replace(/^http:/, 'https:')
    const arxivId = absUrl.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/abs\//, '').replace(/v\d+$/, '')
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((author) => decodeXml(author[1]))
    const categories = [...entry.matchAll(/<category[^>]+term=["']([^"']+)["'][^>]*\/?>(?:<\/category>)?/gi)].map((category) => decodeXml(category[1]))
    const pdfMatch = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/pdf["'][^>]*\/?>/i)
      ?? entry.match(/<link[^>]+title=["']pdf["'][^>]+href=["']([^"']+)["'][^>]*\/?>/i)
    return {
      arxivId, title: xmlTag(entry, 'title'), authors, summary: xmlTag(entry, 'summary'),
      published: xmlTag(entry, 'published'), updated: xmlTag(entry, 'updated'), categories,
      pdfUrl: (pdfMatch?.[1] ?? `https://arxiv.org/pdf/${arxivId}`).replace(/^http:/, 'https:'), absUrl: absUrl || `https://arxiv.org/abs/${arxivId}`,
    }
  }).filter((paper) => paper.arxivId && paper.title)
}
function extractArxivId(input: string) {
  const normalized = input.trim()
  const match = normalized.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/)?((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5}))(?:v\d+)?(?:\.pdf)?$/i)
  return match?.[1]
}
let lastArxivRequest = 0
async function semanticArxivSearch(query: string): Promise<ArxivPaper[]> {
  try {
    const fields = 'title,authors,abstract,publicationDate,citationCount,externalIds,openAccessPdf'
    const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=50&fields=${encodeURIComponent(fields)}`, { headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' } })
    if (!response.ok) return []
    const body = await response.json() as { data?: Array<{ title?: string; authors?: Array<{ name?: string }>; abstract?: string; publicationDate?: string; citationCount?: number; externalIds?: { ArXiv?: string }; openAccessPdf?: { url?: string } }> }
    return (body.data ?? []).filter((paper) => paper.externalIds?.ArXiv && paper.title).map((paper) => {
      const arxivId = paper.externalIds!.ArXiv!
      return { arxivId, title: paper.title!, authors: (paper.authors ?? []).map((author) => author.name ?? '').filter(Boolean), summary: paper.abstract ?? '', published: paper.publicationDate ?? '', updated: paper.publicationDate ?? '', categories: [], pdfUrl: paper.openAccessPdf?.url ?? `https://arxiv.org/pdf/${arxivId}`, absUrl: `https://arxiv.org/abs/${arxivId}`, citationCount: paper.citationCount }
    })
  } catch { return [] }
}
async function arxivSearch(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return []
  const wait = Math.max(0, 3000 - (Date.now() - lastArxivRequest))
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  const id = extractArxivId(trimmed)
  const cleanTitle = trimmed.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim()
  const terms = cleanTitle.split(' ').filter(Boolean).slice(0, 14)
  const rankedQuery = terms.length > 1
    ? `(ti:"${cleanTitle}") OR (${terms.map((term) => `all:${term}`).join(' AND ')})`
    : `all:${cleanTitle}`
  const params = id
    ? `id_list=${encodeURIComponent(id)}`
    : `search_query=${encodeURIComponent(rankedQuery)}&start=0&max_results=20&sortBy=relevance&sortOrder=descending`
  const response = await fetch(`https://export.arxiv.org/api/query?${params}`, { headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' } })
  lastArxivRequest = Date.now()
  if (!response.ok) {
    if (!id && response.status === 429) {
      const fallback = await semanticArxivSearch(trimmed)
      if (fallback.length) return fallback
    }
    throw new Error(`arXiv 검색에 실패했습니다 (${response.status}).`)
  }
  const papers = parseArxivFeed(await response.text())
  if (id || !papers.length) return papers
  try {
    const citationResponse = await fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=title,citationCount', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Prism/0.1 local desktop research reader' },
      body: JSON.stringify({ ids: papers.map((paper) => `ARXIV:${paper.arxivId}`) }),
    })
    if (citationResponse.ok) {
      const citations = await citationResponse.json() as Array<{ citationCount?: number } | null>
      citations.forEach((entry, index) => { if (entry && Number.isFinite(entry.citationCount)) papers[index].citationCount = entry.citationCount })
    }
  } catch { /* citation popularity is a best-effort ranking signal */ }
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim()
  const wanted = normalize(trimmed)
  const wantedTokens = new Set(wanted.split(' ').filter(Boolean))
  const score = (paper: ArxivPaper) => {
    const title = normalize(paper.title)
    const titleTokens = new Set(title.split(' ').filter(Boolean))
    const overlap = [...wantedTokens].filter((token) => titleTokens.has(token)).length / Math.max(1, wantedTokens.size)
    const exact = title === wanted ? 1_000_000 : title.startsWith(wanted) ? 100_000 : title.includes(wanted) ? 20_000 : 0
    return exact + overlap * 10_000 + Math.log10((paper.citationCount ?? 0) + 1) * 500
  }
  return papers.sort((left, right) => score(right) - score(left)).slice(0, 20)
}

async function paperAutocomplete(input: string) {
  const query = input.trim().slice(0, 100)
  if (query.length < 2) return []
  try {
    const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/autocomplete?query=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' },
    })
    if (!response.ok) return []
    const data = await response.json() as { matches?: Array<{ title?: string; authorsYear?: string }> }
    return (data.matches ?? []).filter((match) => typeof match.title === 'string').slice(0, 6)
  } catch { return [] }
}

function yamlString(value: string) { return JSON.stringify(value.replace(/\r?\n/g, ' ')) }
function paperMarkdown(paper: ArxivPaper, pdfFile: string, template?: { id: string; content: string }) {
  const values: Record<string, string> = { title: paper.title, date: new Date().toISOString().slice(0, 10), authors: paper.authors.join(', '), year: paper.published.slice(0, 4), arxiv_id: paper.arxivId, doi: '', paper_link: paper.absUrl, current_project: '', selected_anchor: '' }
  const abstract = `> [!abstract]- Abstract\n> ${paper.summary.replace(/\n/g, '\n> ')}`
  let body: string
  if (template) {
    const filled = template.content.replace(/\{\{([a-z_]+)\}\}/g, (token, key: string) => values[key] ?? token).replace(/^\s+/, '')
    // Keep the template's own heading; place the abstract right after it so the reading form follows.
    body = /^#\s/.test(filled) ? filled.replace(/^(#[^\n]*\n)/, `$1\n${abstract}\n`) : `# ${paper.title}\n\n${abstract}\n\n${filled}`
    if (!/^##\s+Notes\s*$/mi.test(body)) body = `${body.trimEnd()}\n\n## Notes\n`
  } else body = `# ${paper.title}\n\n${abstract}\n\n## Notes\n`
  return `---\ntype: paper\nprism_id: ${yamlString(paperNodeId(paper.arxivId))}\narxiv_id: ${yamlString(paper.arxivId)}\ntitle: ${yamlString(paper.title)}\nauthors:\n${paper.authors.map((author) => `  - ${yamlString(author)}`).join('\n')}\npublished: ${yamlString(paper.published)}\ncategories: [${paper.categories.map(yamlString).join(', ')}]\nsource: ${yamlString(paper.absUrl)}\npdf: ${yamlString(pdfFile)}\nstatus: inbox\nreading_status: to_read\nimportance: medium\nconfidence: medium\ncreated_by: user\n${template ? `template_id: ${yamlString(template.id)}\n` : ''}created_at: ${yamlString(new Date().toISOString())}\ntags: [paper, arxiv]\n---\n\n${body.trimEnd()}\n`
}

async function downloadPaper(paper: ArxivPaper): Promise<PaperRecord> {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  const existing = (await readLibrary()).find((item) => item.arxivId === paper.arxivId)
  if (existing) return existing
  const safeId = paper.arxivId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const paperDir = path.join(settings.libraryPath, 'papers', safeId)
  const pdfPath = path.join(paperDir, 'original.pdf')
  const notePath = path.join(paperDir, `${safeId}.md`)
  const translationPath = path.join(paperDir, 'translation.ko.json')
  const sourcePath = path.join(paperDir, 'source.tar.gz')
  const response = await fetch(paper.pdfUrl, { headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`PDF 다운로드에 실패했습니다 (${response.status}).`)
  const pdf = Buffer.from(await response.arrayBuffer())
  if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('다운로드한 파일이 PDF 형식이 아닙니다.')
  await fs.mkdir(paperDir, { recursive: true })
  await fs.writeFile(pdfPath, pdf)
  let downloadedSourcePath: string | undefined
  try {
    const sourceResponse = await fetch(`https://arxiv.org/src/${paper.arxivId}`, { headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' }, redirect: 'follow' })
    if (sourceResponse.ok) {
      const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())
      await fs.writeFile(sourcePath, sourceBuffer)
      downloadedSourcePath = sourcePath
      const sourceDir = path.join(paperDir, 'source')
      await fs.mkdir(sourceDir, { recursive: true })
      try {
        await tar.x({ file: sourcePath, cwd: sourceDir, preservePaths: false, strict: true })
      } catch {
        let singleSource: string | undefined
        for (const candidate of [() => sourceBuffer.toString('utf8'), () => gunzipSync(sourceBuffer).toString('utf8')]) {
          try { const value = candidate(); if (/\\(?:documentclass|begin\s*\{document\})/.test(value)) { singleSource = value; break } } catch { /* try the other source encoding */ }
        }
        if (singleSource) await fs.writeFile(path.join(sourceDir, 'main.tex'), singleSource, 'utf8')
      }
      const structure = await parseLatexStructure(sourceDir)
      if (structure) await fs.writeFile(path.join(paperDir, 'latex-structure.json'), JSON.stringify(structure, null, 2), 'utf8')
    }
  } catch { /* source files are optional; PDF download remains usable */ }
  await fs.writeFile(path.join(paperDir, 'metadata.json'), JSON.stringify(paper, null, 2), 'utf8')
  const templates = await listTemplates(settings.libraryPath).catch(() => [])
  const template = templates.find((item) => item.nodeType === 'paper' && item.isDefault) ?? templates.find((item) => item.nodeType === 'paper')
  await fs.writeFile(notePath, paperMarkdown(paper, 'original.pdf', template), 'utf8')
  const record: PaperRecord = { ...paper, pdfPath, notePath, translationPath, sourcePath: downloadedSourcePath, downloadedAt: Date.now() }
  const library = await readLibrary()
  await writeLibrary([record, ...library])
  return record
}

async function latexStructure(record: PaperRecord): Promise<LatexStructure | null> {
  if (!record.sourcePath) return null
  const paperDir = path.dirname(record.pdfPath)
  const structurePath = path.join(paperDir, 'latex-structure.json')
  try { const cached = JSON.parse(await fs.readFile(structurePath, 'utf8')) as LatexStructure; if (cached.version === 3) return cached } catch { /* build for libraries saved before source parsing existed */ }
  const structure = await parseLatexStructure(path.join(paperDir, 'source'))
  if (structure) await fs.writeFile(structurePath, JSON.stringify(structure, null, 2), 'utf8')
  return structure
}

const figureMime = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.gif', 'image/gif'], ['.svg', 'image/svg+xml'], ['.pdf', 'application/pdf'],
])

async function paperFigures(record: PaperRecord) {
  const structure = await latexStructure(record)
  if (!structure) return []
  const sourceRoot = path.resolve(path.dirname(record.pdfPath), 'source')
  const rootDir = path.dirname(path.resolve(sourceRoot, structure.rootFile))
  const blocks = structure.blocks.filter((block) => block.kind === 'figure')
  const result: Array<{ id: string; order: number; caption?: string; sourcePath?: string; mimeType?: string; dataUrl?: string }> = []
  for (let order = 0; order < blocks.length && order < 100; order += 1) {
    const block = blocks[order]
    const requested = block.source.match(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/)?.[1]?.trim()
    const caption = block.source.match(/\\caption\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/)?.[1]?.replace(/\\[a-zA-Z]+\s*/g, ' ').replace(/[{}~]/g, ' ').replace(/\s+/g, ' ').trim()
    let sourcePath: string | undefined; let mimeType: string | undefined; let dataUrl: string | undefined
    if (requested && !requested.includes('..') && !requested.includes('\\')) {
      const raw = requested.replace(/\//g, path.sep)
      const candidates = path.extname(raw) ? [raw] : [...figureMime.keys()].map((extension) => `${raw}${extension}`)
      for (const candidate of candidates) {
        for (const base of [rootDir, sourceRoot]) {
          const resolved = path.resolve(base, candidate)
          if (!(resolved === sourceRoot || resolved.startsWith(`${sourceRoot}${path.sep}`))) continue
          try {
            const stat = await fs.stat(resolved)
            if (!stat.isFile() || stat.size > 20_000_000) continue
            const mime = figureMime.get(path.extname(resolved).toLowerCase())
            if (!mime) continue
            const bytes = await fs.readFile(resolved); sourcePath = resolved; mimeType = mime; dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
            break
          } catch { /* try another extension or base directory */ }
        }
        if (sourcePath) break
      }
    }
    result.push({ id: block.id, order, caption, sourcePath, mimeType, dataUrl })
  }
  return result
}

function parseTranslationJson(text: string): Array<{ id: string; translation: string }> {
  const object = text.match(/\[[\s\S]*\]/)?.[0]
  if (!object) throw new Error('번역 모델이 올바른 JSON을 반환하지 않았습니다.')
  const parsed = JSON.parse(object)
  if (!Array.isArray(parsed)) throw new Error('번역 결과 형식이 올바르지 않습니다.')
  return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.translation === 'string')
}

async function runTranslationCli(provider: ProviderId, model: string, prompt: string, jobKey: string) {
  const executable = findCli(provider)
  if (!executable) throw new Error(`${provider === 'codex' ? 'Codex' : 'Claude'} CLI를 찾지 못했습니다.`)
  const args = provider === 'codex'
    ? ['exec', '--json', '--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check', '--model', model, '-']
    : ['-p', '--output-format', 'json', '--permission-mode', 'plan', '--model', model]
  const child = spawnCli(executable, args, { cwd: app.getPath('documents'), env: { ...process.env, NO_COLOR: '1' }, windowsHide: true })
  translationJobs.set(jobKey, child)
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { stderr += chunk })
  child.stdin.end(prompt)
  const code = await new Promise<number | null>((resolve, reject) => { child.on('close', resolve); child.on('error', reject) })
  translationJobs.delete(jobKey)
  if (code) throw new Error(stderr.trim() || '번역 CLI 실행에 실패했습니다.')
  if (provider === 'claude') {
    const result = JSON.parse(stdout) as { result?: string }
    return result.result ?? ''
  }
  let final = ''
  for (const line of stdout.split(/\r?\n/)) {
    try { const event = JSON.parse(line) as Record<string, unknown>; const item = event.item as Record<string, unknown> | undefined; if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') final = item.text } catch { /* skip */ }
  }
  return final
}

async function translatePaper(sender: WebContents, record: PaperRecord, segments: TranslationSegment[], force = false) {
  const settings = await readSettings()
  const jobKey = record.arxivId
  if (translationJobs.has(jobKey)) throw new Error('이 논문은 이미 번역 중입니다.')
  let cache: { version: number; provider: ProviderId; model: string; sourceHash: string; segments: TranslationSegment[] } = {
    version: 1, provider: settings.translationProvider, model: settings.translationModel,
    sourceHash: createHash('sha256').update(segments.map((segment) => segment.source).join('\n')).digest('hex'), segments: [],
  }
  if (!force) try { cache = JSON.parse(await fs.readFile(record.translationPath, 'utf8')) } catch { /* first translation */ }
  const existing = new Map(cache.segments.map((segment) => [segment.id, segment]))
  const merged = segments.map((segment) => existing.get(segment.id)?.translation ? { ...segment, translation: existing.get(segment.id)?.translation } : segment)
  const translatable = (segment: TranslationSegment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.source.trim().length > 1
  const missing = merged.filter((segment) => translatable(segment) && !segment.translation)
  const totalSegments = merged.filter(translatable).length
  safeSend(sender, 'translation:progress', { arxivId: record.arxivId, completed: 0, total: 0, completedSegments: totalSegments - missing.length, totalSegments, segments: merged, force })
  const batches: TranslationSegment[][] = []
  let batch: TranslationSegment[] = []; let size = 0
  for (const segment of missing) {
    if (batch.length && size + segment.source.length > 9000) { batches.push(batch); batch = []; size = 0 }
    batch.push(segment); size += segment.source.length
  }
  if (batch.length) batches.push(batch)
  for (let index = 0; index < batches.length; index += 1) {
    const input = batches[index].map(({ id, source, sourceMode, blockId, sectionTitle, paragraphContext }) => ({ id, source, sourceMode: sourceMode ?? 'pdf', blockId, section: sectionTitle, paragraphContext }))
    const prompt = `You translate academic papers into natural, precise Korean. Translate only the value of "source". LaTeX-derived paragraphContext is read-only context for resolving terminology and sentence boundaries; never translate or return it. Never translate, rewrite, or evaluate equations, symbols, citations, variable names, figure labels, or LaTeX. Preserve technical terms when needed. Return ONLY a JSON array of objects with exactly {"id":"...","translation":"..."}, one for every input item, in the same order.\n\nINPUT:\n${JSON.stringify(input)}`
    const output = await runTranslationCli(settings.translationProvider, settings.translationModel, prompt, jobKey)
    const translated = new Map(parseTranslationJson(output).map((item) => [item.id, item.translation]))
    for (const segment of merged) if (translated.has(segment.id)) segment.translation = translated.get(segment.id)
    cache = { version: 1, provider: settings.translationProvider, model: settings.translationModel, sourceHash: createHash('sha256').update(segments.map((segment) => segment.source).join('\n')).digest('hex'), segments: merged }
    await fs.writeFile(record.translationPath, JSON.stringify(cache, null, 2), 'utf8')
    const completedSegments = merged.filter((segment) => translatable(segment) && segment.translation).length
    safeSend(sender, 'translation:progress', { arxivId: record.arxivId, completed: index + 1, total: batches.length, completedSegments, totalSegments, segments: merged, force })
  }
  for (const segment of merged) if (segment.kind === 'equation' || segment.kind === 'table' || segment.kind === 'artifact') segment.translation = segment.source
  await fs.writeFile(record.translationPath, JSON.stringify({ ...cache, segments: merged }, null, 2), 'utf8')
  safeSend(sender, 'translation:done', { arxivId: record.arxivId, segments: merged })
}

let mainWindow: BrowserWindow | undefined
let notesWindow: BrowserWindow | undefined
let mcpAnchorRequestId = ''
let mcpAnchorTimer: NodeJS.Timeout | undefined

function loadRenderer(window: BrowserWindow, view?: string) {
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) window.loadURL(view ? `${devUrl}?view=${encodeURIComponent(view)}` : devUrl)
  else window.loadFile(path.join(__dirname, '../dist/index.html'), view ? { query: { view } } : undefined)
}

function createWindow() {
  const testSize = process.env.PRISM_TEST_WINDOW_SIZE?.match(/^(\d{3,4})x(\d{3,4})$/)
  const initialWidth = testSize ? Math.max(1040, Number(testSize[1])) : 1480
  const initialHeight = testSize ? Math.max(680, Number(testSize[2])) : 920
  const window = new BrowserWindow({
    width: initialWidth, height: initialHeight, minWidth: 1040, minHeight: 680, backgroundColor: '#f5f3ee', titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../dist/icon.png'),
    titleBarOverlay: process.platform === 'win32' ? { color: '#f5f3ee', symbolColor: '#4a4945', height: 42 } : false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow = window; window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
  loadRenderer(window)
  window.webContents.on('did-fail-load', (_event, code, description) => console.error(`Renderer failed to load (${code}): ${description}`))
  window.webContents.on('preload-error', (_event, preloadPath, error) => console.error(`Preload failed (${preloadPath}):`, error))
  window.webContents.on('console-message', (_event, _level, message) => console.error(`Renderer console: ${message}`))
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer process exited:', details))
  window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' } })
}

function openNotesWindow() {
  if (notesWindow && !notesWindow.isDestroyed()) { notesWindow.show(); notesWindow.focus(); return true }
  notesWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 560, backgroundColor: '#f5f3ee', title: 'Prism Notes',
    icon: path.join(__dirname, '../dist/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  notesWindow.on('closed', () => { notesWindow = undefined })
  loadRenderer(notesWindow, 'notes')
  return true
}

async function checkMcpAnchorRequest() {
  const settings = await readSettings(); if (!settings.libraryPath) return
  const request = await readMcpOpenAnchorRequest(settings.libraryPath)
  if (!request || request.requestId === mcpAnchorRequestId) return
  mcpAnchorRequestId = request.requestId
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const notify = () => mainWindow?.webContents.send('evidence:open-requested', { paperId: request.paperId, anchorId: request.anchorId, type: request.type, page: request.page, label: request.label })
  if (mainWindow?.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', notify); else notify()
  mainWindow?.show(); mainWindow?.focus()
}

ipcMain.handle('providers:list', () => providerInfo())

ipcMain.handle('provider:login', (event, providerId: unknown) => {
  if (providerId !== 'codex' && providerId !== 'claude') throw new Error('지원하지 않는 CLI입니다.')
  const key = String(providerId)
  // 이미 로그인 진행 중이면 중복 실행 방지
  if (activeAuthProcesses.has(key)) return { success: false, message: '이미 로그인이 진행 중입니다.' }
  const executable = findCli(key)
  if (!executable) return { success: false, message: 'CLI를 찾지 못했습니다. 먼저 설치해 주세요.' }
  return new Promise<{ success: boolean; message: string }>((resolve) => {
    const loginArgs = key === 'claude' ? ['auth', 'login'] : ['login']
    const child = spawnCli(executable, loginArgs, { windowsHide: true })
    activeAuthProcesses.set(key, child)
    let output = ''
    const collect = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      safeSend(event.sender, 'provider:auth:data', { provider: providerId, text })
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const cleanup = () => { activeAuthProcesses.delete(key) }
    child.on('close', (code) => { cleanup(); resolve({ success: code === 0, message: output.trim() || (code === 0 ? '로그인 완료' : '로그인에 실패했습니다.') }) })
    child.on('error', (err) => { cleanup(); resolve({ success: false, message: err.message }) })
    // 창이 닫히면 로그인 프로세스도 정리
    event.sender.once('destroyed', () => { cleanup(); child.kill() })
  })
})

ipcMain.handle('provider:logout', (_event, providerId: unknown) => {
  if (providerId !== 'codex' && providerId !== 'claude') throw new Error('지원하지 않는 CLI입니다.')
  const key = String(providerId)
  // 로그인 진행 중이면 먼저 종료
  const existing = activeAuthProcesses.get(key)
  if (existing) { existing.kill(); activeAuthProcesses.delete(key) }
  const executable = findCli(key)
  if (!executable) return { success: false, message: 'CLI를 찾지 못했습니다.' }
  return new Promise<{ success: boolean; message: string }>((resolve) => {
    const logoutArgs = key === 'claude' ? ['auth', 'logout'] : ['logout']
    const child = spawnCli(executable, logoutArgs, { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('close', (code) => resolve({ success: code === 0, message: output.trim() || (code === 0 ? '로그아웃 완료' : '로그아웃에 실패했습니다.') }))
    child.on('error', (err) => resolve({ success: false, message: err.message }))
  })
})
ipcMain.handle('sessions:load', () => loadSessions())
ipcMain.handle('sessions:save', (_event, sessions: unknown) => saveSessions(sessions))
ipcMain.handle('settings:get', () => readSettings())
ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
  const safePatch: Partial<AppSettings> = {}
  if (patch.translationProvider === 'codex' || patch.translationProvider === 'claude') safePatch.translationProvider = patch.translationProvider
  if (typeof patch.translationModel === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(patch.translationModel)) safePatch.translationModel = patch.translationModel
  if (typeof patch.autoTranslate === 'boolean') safePatch.autoTranslate = patch.autoTranslate
  if (patch.knowledgeProvider === 'codex' || patch.knowledgeProvider === 'claude') safePatch.knowledgeProvider = patch.knowledgeProvider
  else if (patch.knowledgeProvider === null || patch.knowledgeProvider === undefined && 'knowledgeProvider' in patch) safePatch.knowledgeProvider = undefined
  if (typeof patch.knowledgeModel === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(patch.knowledgeModel)) safePatch.knowledgeModel = patch.knowledgeModel
  return writeSettings(safePatch)
})
ipcMain.handle('workspace:choose', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const options = { title: 'Prism 라이브러리 폴더 선택', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  const libraryPath = result.filePaths[0]
  await fs.mkdir(path.join(libraryPath, '.prism'), { recursive: true })
  return writeSettings({ libraryPath })
})
ipcMain.handle('library:list', async () => {
  const settings = await readSettings()
  if (settings.libraryPath) await migratePaperNotes(settings.libraryPath).catch(() => 0)
  return readLibrary()
})
ipcMain.handle('arxiv:search', (_event, input: string) => arxivSearch(String(input).slice(0, 500)))
ipcMain.handle('paper:autocomplete', (_event, input: string) => paperAutocomplete(String(input)))
ipcMain.handle('arxiv:open', (_event, arxivId: string) => {
  const id = extractArxivId(String(arxivId))
  if (!id) throw new Error('올바른 arXiv ID가 아닙니다.')
  return shell.openExternal(`https://arxiv.org/abs/${id}`)
})
ipcMain.handle('paper:download', async (_event, input: ArxivPaper) => {
  const id = extractArxivId(String(input?.arxivId ?? ''))
  if (!id) throw new Error('올바른 arXiv 논문이 아닙니다.')
  const paper: ArxivPaper = {
    arxivId: id, title: String(input.title ?? id).slice(0, 1000),
    authors: Array.isArray(input.authors) ? input.authors.map(String).slice(0, 200) : [],
    summary: String(input.summary ?? '').slice(0, 100_000), published: String(input.published ?? ''), updated: String(input.updated ?? ''),
    categories: Array.isArray(input.categories) ? input.categories.map(String).slice(0, 50) : [],
    pdfUrl: `https://arxiv.org/pdf/${id}`, absUrl: `https://arxiv.org/abs/${id}`,
    citationCount: Number.isFinite(input.citationCount) ? input.citationCount : undefined,
  }
  return downloadPaper(paper)
})
ipcMain.handle('paper:pdf', async (_event, arxivId: string) => {
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  return new Uint8Array(await fs.readFile(record.pdfPath))
})
ipcMain.handle('paper:latex-structure', async (_event, arxivId: string) => {
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  return latexStructure(record)
})
ipcMain.handle('paper:figures', async (_event, arxivId: string) => {
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  return paperFigures(record)
})
ipcMain.handle('notes:open', () => openNotesWindow())
ipcMain.handle('reader:open', async (_event, arxivId?: string) => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const target = mainWindow
  if (!target) return false
  if (typeof arxivId === 'string' && arxivId) {
    if (!/^[a-zA-Z0-9._/-]{3,60}$/.test(arxivId)) throw new Error('올바른 arXiv ID가 아닙니다.')
    const send = () => target.webContents.send('reader:open-paper', arxivId)
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send); else send()
  }
  target.show(); target.focus()
  return true
})
ipcMain.handle('paper:note:read', async (_event, arxivId: string) => {
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  return readNoteSnapshot(record.notePath)
})
ipcMain.handle('paper:note:save', async (_event, arxivId: string, request: NoteSaveRequest) => {
  if (!request || typeof request.content !== 'string' || request.content.length > 2_000_000) throw new Error('노트가 너무 큽니다.')
  if (request.force !== undefined && typeof request.force !== 'boolean') throw new Error('노트 저장 옵션이 올바르지 않습니다.')
  if (request.expectedRevision !== undefined && (typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedRevision))) throw new Error('노트 버전이 올바르지 않습니다.')
  if (request.force !== true && request.expectedRevision === undefined) throw new Error('노트 버전이 필요합니다.')
  if (request.createStubs !== undefined && typeof request.createStubs !== 'boolean') throw new Error('노트 저장 옵션이 올바르지 않습니다.')
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  const result = await saveNoteSnapshot(record.notePath, request)
  if (result.saved && request.createStubs) {
    const settings = await readSettings()
    const stubs = settings.libraryPath ? await ensureLinkStubs(settings.libraryPath, request.content).catch(() => []) : []
    return { ...result, stubs }
  }
  return result
})
ipcMain.handle('paper:note:capture', async (_event, request: PaperCaptureRequest) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.paperId !== 'string' || (request.kind !== 'evidence' && request.kind !== 'chat')) throw new Error('노트 담기 요청이 올바르지 않습니다.')
  if (request.kind === 'evidence' && (typeof request.anchorId !== 'string' || request.anchorId.length < 1 || request.anchorId.length > 300 || (request.memo !== undefined && (typeof request.memo !== 'string' || request.memo.length > 4_000)) || (request.concept !== undefined && (typeof request.concept !== 'string' || request.concept.length > 200)))) throw new Error('노트 담기 요청이 올바르지 않습니다.')
  if (request.kind === 'chat' && (typeof request.question !== 'string' || typeof request.answer !== 'string' || request.answer.length > 200_000 || typeof request.provider !== 'string' || typeof request.model !== 'string' || (request.anchors !== undefined && !Array.isArray(request.anchors)))) throw new Error('노트 담기 요청이 올바르지 않습니다.')
  const record = (await readLibrary()).find((paper) => paper.arxivId === request.paperId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  return captureToPaperNote(settings.libraryPath, { arxivId: record.arxivId, title: record.title, pdfPath: record.pdfPath, notePath: record.notePath }, request)
})
ipcMain.handle('templates:list', async () => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return listTemplates(settings.libraryPath)
})
ipcMain.handle('templates:save', async (_event, request: TemplateSaveRequest) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.name !== 'string' || typeof request.content !== 'string' || request.name.length > 200 || request.content.length > 2_000_000) throw new Error('템플릿 데이터가 올바르지 않습니다.')
  if (request.id !== undefined && (typeof request.id !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(request.id))) throw new Error('템플릿 ID가 올바르지 않습니다.')
  if (request.expectedRevision !== undefined && (typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedRevision))) throw new Error('템플릿 버전이 올바르지 않습니다.')
  return saveTemplate(settings.libraryPath, request)
})
ipcMain.handle('templates:delete', async (_event, id: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return deleteTemplate(settings.libraryPath, String(id))
})
ipcMain.handle('templates:set-default', async (_event, nodeType: KnowledgeNodeType, id: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return setDefaultTemplate(settings.libraryPath, nodeType, String(id))
})
ipcMain.handle('templates:set-favorite', async (_event, id: string, favorite: boolean) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(id) || typeof favorite !== 'boolean') throw new Error('템플릿 즐겨찾기 정보가 올바르지 않습니다.')
  return setFavoriteTemplate(settings.libraryPath, id, favorite)
})
ipcMain.handle('knowledge:list', async () => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return listKnowledgeNodes(settings.libraryPath)
})
ipcMain.handle('knowledge:search', async (_event, query: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return searchKnowledge(settings.libraryPath, String(query))
})
ipcMain.handle('research:search', async (_event, query: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return searchResearchKnowledge(settings.libraryPath, String(query))
})
ipcMain.handle('research:context', async (_event, query: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return retrieveResearchContext(settings.libraryPath, String(query))
})
ipcMain.handle('research:index:rebuild', async () => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return rebuildResearchIndex(settings.libraryPath)
})
ipcMain.handle('research:suggest', async (_event, nodeId: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof nodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(nodeId)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  return suggestKnowledge(settings.libraryPath, nodeId)
})
ipcMain.handle('research:suggest:model', async (_event, paperNodeId: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof paperNodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(paperNodeId)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  const provider = settings.knowledgeProvider; const model = settings.knowledgeModel
  if (!provider || !model) throw new Error('설정에서 지식 제안 CLI와 모델을 먼저 선택하세요.')
  const jobKey = `knowledge-${paperNodeId}-${Date.now()}`
  return runModelSuggestions(settings.libraryPath, paperNodeId, provider, model, (prompt) => runTranslationCli(provider, model, prompt, jobKey))
})
ipcMain.handle('research:suggest:model:review', async (_event, request: ModelSuggestionReview) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.paperNodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(request.paperNodeId) || typeof request.id !== 'string' || !/^model-[a-f0-9]{16}$/.test(request.id) || (request.decision !== 'accepted' && request.decision !== 'rejected')) throw new Error('제안 검토 요청이 올바르지 않습니다.')
  await reviewModelSuggestion(settings.libraryPath, request)
  return true
})
ipcMain.handle('paper:citations', async (_event, arxivId: string, options?: { refresh?: boolean }) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof arxivId !== 'string' || !/^[a-zA-Z0-9._/-]{3,60}$/.test(arxivId)) throw new Error('올바른 arXiv ID가 아닙니다.')
  if (options !== undefined && (typeof options !== 'object' || options === null || (options.refresh !== undefined && typeof options.refresh !== 'boolean'))) throw new Error('인용 조회 옵션이 올바르지 않습니다.')
  if (process.env.PRISM_TEST_LIBRARY_PATH && options?.refresh !== true) return listPaperCitations(settings.libraryPath, arxivId, { refresh: false })
  return listPaperCitations(settings.libraryPath, arxivId, { refresh: options?.refresh })
})
ipcMain.handle('paper:digest:refresh', async (_event, paperNodeId: string, options?: { useModel?: boolean }) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof paperNodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(paperNodeId)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  const messages = await readChatMessages(sessionsPath())
  const provider = settings.knowledgeProvider; const model = settings.knowledgeModel
  const useModel = options?.useModel !== false && Boolean(provider && model)
  const runPrompt = useModel && provider && model
    ? (prompt: string) => runTranslationCli(provider, model, prompt, `digest-${paperNodeId}-${Date.now()}`)
    : undefined
  return refreshNoteDigest(settings.libraryPath, paperNodeId, messages, runPrompt)
})
ipcMain.handle('knowledge:prune-empty-sections', async (_event, id: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof id !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(id)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  const result = await pruneEmptySections(settings.libraryPath, id)
  return { removed: result.removed }
})
ipcMain.handle('knowledge:links:sync', async (_event, id: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof id !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(id)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  const snapshot = await readKnowledgeNode(settings.libraryPath, id)
  const stubs = await ensureLinkStubs(settings.libraryPath, snapshot.content)
  const relations = await syncLinkRelations(settings.libraryPath, id)
  return { stubs, ...relations }
})
ipcMain.handle('knowledge:restore', async (_event, trashedRelativePath: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof trashedRelativePath !== 'string') throw new Error('복구할 항목이 올바르지 않습니다.')
  return restoreKnowledgeNode(settings.libraryPath, trashedRelativePath)
})
ipcMain.handle('knowledge:curation:list', async () => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return listCurationQueue(settings.libraryPath)
})
ipcMain.handle('knowledge:curation:promote-memo', async (_event, request: PromoteMemoRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.paperNodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(request.paperNodeId) || typeof request.blockId !== 'string' || !/^evidence-[a-zA-Z0-9_-]{1,100}$/.test(request.blockId)
    || typeof request.memo !== 'string' || request.memo.length > 4_000 || (request.nodeType !== 'claim' && request.nodeType !== 'question') || typeof request.title !== 'string' || request.title.length > 300) throw new Error('승격 요청이 올바르지 않습니다.')
  return promoteMemo(settings.libraryPath, request)
})
ipcMain.handle('knowledge:curation:merge-concepts', async (_event, request: MergeConceptsRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.sourceId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(request.sourceId) || typeof request.targetId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(request.targetId)) throw new Error('병합 요청이 올바르지 않습니다.')
  return mergeConcepts(settings.libraryPath, request)
})
ipcMain.handle('knowledge:views', async () => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return listKnowledgeDataViews(settings.libraryPath)
})
ipcMain.handle('knowledge:open-in-obsidian', async (_event, request: ObsidianOpenRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.nodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(request.nodeId)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  const node = (await listKnowledgeNodes(settings.libraryPath)).find((item) => item.id === request.nodeId)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  const uri = buildObsidianOpenUri(settings.libraryPath, node.relativePath, { heading: request.heading, blockId: request.blockId })
  if (process.env.PRISM_TEST_EXTERNAL_URL_LOG) await fs.appendFile(process.env.PRISM_TEST_EXTERNAL_URL_LOG, `${uri}\n`, 'utf8')
  else await shell.openExternal(uri)
  return true
})
ipcMain.handle('knowledge:create', async (_event, request: KnowledgeCreateRequest) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.title !== 'string' || request.title.length > 300 || typeof request.nodeType !== 'string' || (request.templateId !== undefined && typeof request.templateId !== 'string') || (request.variables !== undefined && (!request.variables || typeof request.variables !== 'object' || Array.isArray(request.variables))) || (request.status !== undefined && typeof request.status !== 'string')) throw new Error('지식 노트 정보가 올바르지 않습니다.')
  return createKnowledgeNode(settings.libraryPath, request)
})
ipcMain.handle('knowledge:apply-template-sections', async (_event, request: ApplyTemplateSectionsRequest) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.nodeId !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(request.nodeId) || typeof request.templateId !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(request.templateId) || typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedRevision)) throw new Error('템플릿 섹션 추가 정보가 올바르지 않습니다.')
  return applyTemplateSections(settings.libraryPath, request)
})
ipcMain.handle('knowledge:read', async (_event, id: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return readKnowledgeNode(settings.libraryPath, String(id))
})
ipcMain.handle('knowledge:save', async (_event, id: string, request: NoteSaveRequest) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!request || typeof request.content !== 'string' || request.content.length > 2_000_000 || typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedRevision)) throw new Error('지식 노트 저장 정보가 올바르지 않습니다.')
  if (request.createStubs !== undefined && typeof request.createStubs !== 'boolean') throw new Error('지식 노트 저장 옵션이 올바르지 않습니다.')
  const result = await saveKnowledgeNode(settings.libraryPath, String(id), request)
  if (result.saved && request.createStubs) return { ...result, stubs: await ensureLinkStubs(settings.libraryPath, request.content).catch(() => []) }
  return result
})
ipcMain.handle('knowledge:update-properties', async (_event, id: string, patch: KnowledgePropertyPatch, expectedRevision: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!patch || typeof patch !== 'object' || typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error('속성 변경 정보가 올바르지 않습니다.')
  return updateKnowledgeProperties(settings.libraryPath, String(id), patch, expectedRevision)
})
ipcMain.handle('knowledge:delete', async (_event, id: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return deleteKnowledgeNode(settings.libraryPath, String(id))
})
ipcMain.handle('knowledge:backlinks', async (_event, id: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof id !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(id)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  return listKnowledgeBacklinks(settings.libraryPath, id)
})
ipcMain.handle('knowledge:evidence:copy', async (_event, request: KnowledgeEvidenceCopyRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return copyKnowledgeEvidence(settings.libraryPath, request)
})
ipcMain.handle('knowledge:relations:list', async (_event, id: string) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return listKnowledgeRelations(settings.libraryPath, String(id))
})
ipcMain.handle('knowledge:relations:create', async (_event, request: KnowledgeRelationCreateRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return createKnowledgeRelation(settings.libraryPath, request)
})
ipcMain.handle('knowledge:relations:update', async (_event, request: KnowledgeRelationUpdateRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return updateKnowledgeRelation(settings.libraryPath, request)
})
ipcMain.handle('knowledge:relations:delete', async (_event, request: KnowledgeRelationDeleteRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return deleteKnowledgeRelation(settings.libraryPath, request)
})
ipcMain.handle('knowledge:relations:review', async (_event, request: KnowledgeRelationReviewRequest) => {
  const settings = await readSettings(); if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return reviewKnowledgeRelation(settings.libraryPath, request)
})
ipcMain.handle('evidence:list', async () => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  return listEvidenceAnchors(settings.libraryPath, await readLibrary())
})
ipcMain.handle('evidence:open', async (_event, anchor: { paperId?: unknown; anchorId?: unknown; type?: unknown; page?: unknown; label?: unknown }) => {
  const validTypes = new Set(['sentence', 'section', 'equation', 'table', 'figure', 'page'])
  if (!anchor || typeof anchor.paperId !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(anchor.paperId)
    || typeof anchor.anchorId !== 'string' || anchor.anchorId.length < 1 || anchor.anchorId.length > 300
    || typeof anchor.type !== 'string' || !validTypes.has(anchor.type)
    || !Number.isInteger(anchor.page) || Number(anchor.page) < 1 || Number(anchor.page) > 100_000
    || typeof anchor.label !== 'string' || anchor.label.length < 1 || anchor.label.length > 300) throw new Error('PDF 근거 위치가 올바르지 않습니다.')
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow?.show(); mainWindow?.focus(); mainWindow?.webContents.send('evidence:open-requested', anchor)
  return true
})
ipcMain.handle('evidence:backlinks', async (_event, anchor: { paperId?: unknown; anchorId?: unknown }) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (!anchor || typeof anchor.paperId !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(anchor.paperId) || typeof anchor.anchorId !== 'string' || anchor.anchorId.length < 1 || anchor.anchorId.length > 300) throw new Error('PDF 근거 위치가 올바르지 않습니다.')
  return listEvidenceBacklinks(settings.libraryPath, anchor.paperId, anchor.anchorId)
})
ipcMain.handle('knowledge:open-in-notes', async (_event, id: string) => {
  const settings = await readSettings()
  if (!settings.libraryPath) throw new Error('먼저 라이브러리 폴더를 선택해 주세요.')
  if (typeof id !== 'string' || !/^[a-z]+-[a-zA-Z0-9._-]{6,80}$/.test(id)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  await readKnowledgeNode(settings.libraryPath, id)
  openNotesWindow()
  const notify = () => notesWindow?.webContents.send('knowledge:open-requested', id)
  if (notesWindow?.webContents.isLoading()) notesWindow.webContents.once('did-finish-load', notify); else notify()
  notesWindow?.show(); notesWindow?.focus()
  return true
})
ipcMain.handle('paper:figure:save', async (_event, arxivId: string, figureId: string, dataUrl: string, metadata: unknown) => {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(figureId)) throw new Error('피겨 ID가 올바르지 않습니다.')
  if (typeof dataUrl !== 'string' || dataUrl.length > 30_000_000) throw new Error('피겨 이미지가 너무 큽니다.')
  const match = dataUrl.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/)
  if (!match) throw new Error('피겨 이미지 형식이 올바르지 않습니다.')
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  const figuresDir = path.join(path.dirname(record.pdfPath), 'figures')
  await fs.mkdir(figuresDir, { recursive: true })
  const imagePath = path.join(figuresDir, `${figureId}.png`)
  await fs.writeFile(imagePath, Buffer.from(match[1], 'base64'))
  await fs.writeFile(path.join(figuresDir, `${figureId}.json`), JSON.stringify({ figureId, paperId: arxivId, imagePath, ...((metadata && typeof metadata === 'object') ? metadata : {}) }, null, 2), 'utf8')
  return imagePath
})
ipcMain.handle('translation:read', async (_event, arxivId: string) => {
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  try { return JSON.parse(await fs.readFile(record.translationPath, 'utf8')) }
  catch { return null }
})
ipcMain.handle('paper:anchors:save', async (_event, arxivId: string, anchors: TranslationSegment[]) => {
  if (!Array.isArray(anchors) || anchors.length > 20_000) throw new Error('anchor 데이터가 올바르지 않습니다.')
  const settings = await readSettings()
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  const data = {
    version: 1, paperId: arxivId, generatedAt: new Date().toISOString(),
    anchors: anchors.map((segment) => ({
      id: segment.id, type: segment.kind, page: segment.page,
      source: segment.source, sourceHash: createHash('sha256').update(segment.source).digest('hex'), itemIndexes: segment.itemIndexes ?? [], itemSlices: segment.itemSlices ?? [], sourceMode: segment.sourceMode ?? 'pdf', blockId: segment.blockId, sectionTitle: segment.sectionTitle,
    })),
  }
  await fs.writeFile(path.join(path.dirname(record.pdfPath), 'anchors.json'), JSON.stringify(data, null, 2), 'utf8')
  if (settings.libraryPath) {
    const directory = path.join(settings.libraryPath, '.prism', 'anchors')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, `${arxivId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)}.json`), JSON.stringify(data, null, 2), 'utf8')
  }
  return true
})
ipcMain.handle('translation:start', async (event, arxivId: string, segments: TranslationSegment[], options?: { force?: boolean }) => {
  if (!Array.isArray(segments) || segments.length > 20_000) throw new Error('번역할 문장 데이터가 올바르지 않습니다.')
  const record = (await readLibrary()).find((paper) => paper.arxivId === arxivId)
  if (!record) throw new Error('라이브러리에 없는 논문입니다.')
  const safeSegments = segments.filter((segment) => segment && typeof segment.id === 'string' && typeof segment.source === 'string' && segment.source.length < 10_000)
    .map((segment) => ({ ...segment, source: normalizePdfControls(segment.source).trim(), paragraphContext: typeof segment.paragraphContext === 'string' ? normalizePdfControls(segment.paragraphContext).slice(0, 12_000) : undefined, sectionTitle: typeof segment.sectionTitle === 'string' ? segment.sectionTitle.slice(0, 500) : undefined, blockId: typeof segment.blockId === 'string' ? segment.blockId.slice(0, 120) : undefined, sourceMode: segment.sourceMode === 'latex' ? 'latex' as const : 'pdf' as const, itemIndexes: Array.isArray(segment.itemIndexes) ? segment.itemIndexes.filter(Number.isInteger) : [], itemSlices: Array.isArray(segment.itemSlices) ? segment.itemSlices.filter((slice) => Number.isInteger(slice?.itemIndex) && Number.isFinite(slice?.start) && Number.isFinite(slice?.end)).map((slice) => ({ itemIndex: slice.itemIndex, start: Math.max(0, Math.min(1, slice.start)), end: Math.max(0, Math.min(1, slice.end)) })) : [] }))
  void translatePaper(event.sender, record, safeSegments, options?.force === true).catch((error) => safeSend(event.sender, 'translation:error', { arxivId, message: error instanceof Error ? error.message : String(error) }))
  return { started: true }
})
ipcMain.handle('translation:cancel', (_event, arxivId: string) => {
  const child = translationJobs.get(arxivId)
  if (!child) return false
  child.kill(); translationJobs.delete(arxivId); return true
})
ipcMain.handle('chat:send', async (event, request: ChatRequest) => {
  const prompt = request.prompt?.trim()
  if (!prompt || prompt.length > 50_000) throw new Error('메시지는 1자 이상 50,000자 이하여야 합니다.')
  if (!['codex', 'claude'].includes(request.provider)) throw new Error('지원하지 않는 CLI입니다.')
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(request.model)) throw new Error('올바르지 않은 모델 이름입니다.')
  if (activeChats.has(request.sessionId)) throw new Error('이 세션은 이미 답변을 생성하고 있습니다.')
  if (request.provider === 'codex') await codexServer.send(event.sender, { ...request, prompt }); else sendClaude(event.sender, { ...request, prompt })
  return { started: true }
})
ipcMain.handle('chat:cancel', async (_event, sessionId: string) => {
  const active = activeChats.get(sessionId)
  if (!active) return false
  if (active.provider === 'codex') return codexServer.cancel(sessionId)
  active.process?.kill(); activeChats.delete(sessionId); return true
})

app.whenReady().then(() => {
  createWindow(); mcpAnchorTimer = setInterval(() => void checkMcpAnchorRequest().catch((reason) => console.error('MCP anchor request:', reason)), 800)
  void checkMcpAnchorRequest().catch((reason) => console.error('MCP anchor request:', reason))
  app.on('activate', () => { if (!mainWindow) createWindow() })
})
app.on('before-quit', () => { if (mcpAnchorTimer) { clearInterval(mcpAnchorTimer); mcpAnchorTimer = undefined } })
app.on('window-all-closed', () => {
  for (const active of activeChats.values()) active.process?.kill()
  for (const child of translationJobs.values()) child.kill()
  codexServer.stop()
  if (process.platform !== 'darwin') app.quit()
})
