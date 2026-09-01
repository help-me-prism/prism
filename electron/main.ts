import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type ProviderId = 'codex' | 'claude'
type ChatRequest = { prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }
type ActiveChat = { provider: ProviderId; process?: ChildProcessWithoutNullStreams; threadId?: string; turnId?: string }
type RpcResponse = { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown> }
type AppSettings = { libraryPath?: string; translationProvider: ProviderId; translationModel: string }
type ArxivPaper = { arxivId: string; title: string; authors: string[]; summary: string; published: string; updated: string; categories: string[]; pdfUrl: string; absUrl: string }
type PaperRecord = ArxivPaper & { pdfPath: string; notePath: string; translationPath: string; downloadedAt: number }
type TranslationSegment = { id: string; page: number; source: string; kind: 'text' | 'equation'; itemIndexes?: number[]; translation?: string }

const activeChats = new Map<string, ActiveChat>()
const sessionOwners = new Map<string, { sender: WebContents; sessionId: string; messageId: string }>()
const translationJobs = new Map<string, ChildProcessWithoutNullStreams>()

function findCli(name: string): string | null {
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return null
  const candidates = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return candidates.find((candidate) => process.platform !== 'win32' || candidate.toLowerCase().endsWith('.exe')) ?? candidates[0] ?? null
}

function spawnCli(executable: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${executable}"`, ...args], { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
  }
  return spawn(executable, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
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
  const codexAvailable = Boolean(findCli('codex'))
  const claudeAvailable = Boolean(findCli('claude'))
  return [
    { id: 'codex', name: 'Codex', available: codexAvailable, status: codexAvailable ? '연결됨' : 'CLI를 찾지 못했습니다', models: codexModels() },
    { id: 'claude', name: 'Claude', available: claudeAvailable, status: claudeAvailable ? '연결됨' : 'Claude CLI 설치 필요', models: [
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
  return true
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json') }
async function readSettings(): Promise<AppSettings> {
  try {
    const value = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
    return {
      libraryPath: typeof value.libraryPath === 'string' ? value.libraryPath : undefined,
      translationProvider: value.translationProvider === 'claude' ? 'claude' : 'codex',
      translationModel: typeof value.translationModel === 'string' ? value.translationModel : 'gpt-5.6-terra',
    }
  } catch { return { translationProvider: 'codex', translationModel: 'gpt-5.6-terra' } }
}
async function writeSettings(patch: Partial<AppSettings>) {
  const current = await readSettings()
  const next = { ...current, ...patch }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

function libraryIndexPath(libraryPath: string) { return path.join(libraryPath, '.prism', 'library.json') }
async function readLibrary(): Promise<PaperRecord[]> {
  const settings = await readSettings()
  if (!settings.libraryPath) return []
  try {
    const value = JSON.parse(await fs.readFile(libraryIndexPath(settings.libraryPath), 'utf8'))
    return Array.isArray(value) ? value : []
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
async function arxivSearch(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return []
  const wait = Math.max(0, 3000 - (Date.now() - lastArxivRequest))
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  const id = extractArxivId(trimmed)
  const params = id
    ? `id_list=${encodeURIComponent(id)}`
    : `search_query=${encodeURIComponent(`all:${trimmed}`)}&start=0&max_results=12&sortBy=relevance&sortOrder=descending`
  const response = await fetch(`https://export.arxiv.org/api/query?${params}`, { headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' } })
  lastArxivRequest = Date.now()
  if (!response.ok) throw new Error(`arXiv 검색에 실패했습니다 (${response.status}).`)
  return parseArxivFeed(await response.text())
}

function yamlString(value: string) { return JSON.stringify(value.replace(/\r?\n/g, ' ')) }
function paperMarkdown(paper: ArxivPaper, pdfFile: string) {
  return `---\ntype: paper\narxiv_id: ${yamlString(paper.arxivId)}\ntitle: ${yamlString(paper.title)}\nauthors:\n${paper.authors.map((author) => `  - ${yamlString(author)}`).join('\n')}\npublished: ${yamlString(paper.published)}\ncategories: [${paper.categories.map(yamlString).join(', ')}]\nsource: ${yamlString(paper.absUrl)}\npdf: ${yamlString(pdfFile)}\ntags: [paper, arxiv]\nrelated: []\n---\n\n# ${paper.title}\n\n> [!abstract]- Abstract\n> ${paper.summary.replace(/\n/g, '\n> ')}\n\n## Notes\n\n<!-- Prism annotations are stored as block-addressable notes below. -->\n\n## Connections\n\n- Related papers:\n- Concepts:\n`
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
  const response = await fetch(paper.pdfUrl, { headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`PDF 다운로드에 실패했습니다 (${response.status}).`)
  const pdf = Buffer.from(await response.arrayBuffer())
  if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('다운로드한 파일이 PDF 형식이 아닙니다.')
  await fs.mkdir(paperDir, { recursive: true })
  await fs.writeFile(pdfPath, pdf)
  await fs.writeFile(path.join(paperDir, 'metadata.json'), JSON.stringify(paper, null, 2), 'utf8')
  await fs.writeFile(notePath, paperMarkdown(paper, 'original.pdf'), 'utf8')
  const record: PaperRecord = { ...paper, pdfPath, notePath, translationPath, downloadedAt: Date.now() }
  const library = await readLibrary()
  await writeLibrary([record, ...library])
  return record
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

async function translatePaper(sender: WebContents, record: PaperRecord, segments: TranslationSegment[]) {
  const settings = await readSettings()
  const jobKey = record.arxivId
  if (translationJobs.has(jobKey)) throw new Error('이 논문은 이미 번역 중입니다.')
  let cache: { version: number; provider: ProviderId; model: string; sourceHash: string; segments: TranslationSegment[] } = {
    version: 1, provider: settings.translationProvider, model: settings.translationModel,
    sourceHash: createHash('sha256').update(segments.map((segment) => segment.source).join('\n')).digest('hex'), segments: [],
  }
  try { cache = JSON.parse(await fs.readFile(record.translationPath, 'utf8')) } catch { /* first translation */ }
  const existing = new Map(cache.segments.map((segment) => [segment.id, segment]))
  const merged = segments.map((segment) => existing.get(segment.id)?.translation ? { ...segment, translation: existing.get(segment.id)?.translation } : segment)
  const missing = merged.filter((segment) => segment.kind === 'text' && !segment.translation && segment.source.trim().length > 1)
  const batches: TranslationSegment[][] = []
  let batch: TranslationSegment[] = []; let size = 0
  for (const segment of missing) {
    if (batch.length && size + segment.source.length > 9000) { batches.push(batch); batch = []; size = 0 }
    batch.push(segment); size += segment.source.length
  }
  if (batch.length) batches.push(batch)
  for (let index = 0; index < batches.length; index += 1) {
    const prompt = `You translate academic papers into natural, precise Korean. Translate only prose. Never translate, rewrite, or evaluate equations, symbols, citations, variable names, figure labels, or LaTeX. Preserve technical terms when needed. Return ONLY a JSON array of objects with exactly {"id":"...","translation":"..."}, one for every input item, in the same order.\n\nINPUT:\n${JSON.stringify(batches[index].map(({ id, source }) => ({ id, source })))}`
    const output = await runTranslationCli(settings.translationProvider, settings.translationModel, prompt, jobKey)
    const translated = new Map(parseTranslationJson(output).map((item) => [item.id, item.translation]))
    for (const segment of merged) if (translated.has(segment.id)) segment.translation = translated.get(segment.id)
    cache = { version: 1, provider: settings.translationProvider, model: settings.translationModel, sourceHash: createHash('sha256').update(segments.map((segment) => segment.source).join('\n')).digest('hex'), segments: merged }
    await fs.writeFile(record.translationPath, JSON.stringify(cache, null, 2), 'utf8')
    safeSend(sender, 'translation:progress', { arxivId: record.arxivId, completed: index + 1, total: batches.length, segments: merged })
  }
  for (const segment of merged) if (segment.kind === 'equation') segment.translation = segment.source
  await fs.writeFile(record.translationPath, JSON.stringify({ ...cache, segments: merged }, null, 2), 'utf8')
  safeSend(sender, 'translation:done', { arxivId: record.arxivId, segments: merged })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1040, minHeight: 680, backgroundColor: '#f5f3ee', titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#f5f3ee', symbolColor: '#4a4945', height: 42 } : false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) window.loadURL(devUrl); else window.loadFile(path.join(__dirname, '../dist/index.html'))
  window.webContents.on('did-fail-load', (_event, code, description) => console.error(`Renderer failed to load (${code}): ${description}`))
  window.webContents.on('preload-error', (_event, preloadPath, error) => console.error(`Preload failed (${preloadPath}):`, error))
  window.webContents.on('console-message', (_event, _level, message) => console.error(`Renderer console: ${message}`))
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer process exited:', details))
  window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' } })
}

ipcMain.handle('providers:list', () => providerInfo())
ipcMain.handle('sessions:load', () => loadSessions())
ipcMain.handle('sessions:save', (_event, sessions: unknown) => saveSessions(sessions))
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

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() }) })
app.on('window-all-closed', () => {
  for (const active of activeChats.values()) active.process?.kill()
  codexServer.stop()
  if (process.platform !== 'darwin') app.quit()
})
