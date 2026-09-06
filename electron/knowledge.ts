import { randomUUID } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import { onNoteWritten, readNoteSnapshot, saveNoteSnapshot, type NoteSaveRequest, type NoteSnapshot } from './notes.js'
import { atomicWriteFile } from './atomicFile.js'
import { listTemplates, markTemplateUsed, type KnowledgeNodeType } from './templates.js'

export type KnowledgeStatus = 'inbox' | 'developing' | 'established' | 'archived'
export type KnowledgeReadingStatus = 'to_read' | 'reading' | 'read' | 'paused'
export type KnowledgeLevel = 'low' | 'medium' | 'high'
export type ClaimOrigin = 'paper' | 'mine'
export type EvidenceKind = 'theory' | 'experiment' | 'anecdote' | 'idea'
export type KnowledgeNodeRecord = {
  id: string
  title: string
  nodeType: KnowledgeNodeType
  status: KnowledgeStatus
  readingStatus?: KnowledgeReadingStatus
  importance: KnowledgeLevel
  confidence: KnowledgeLevel
  templateId?: string
  preview: string
  evidenceCount: number
  relativePath: string
  revision: string
  modifiedAt: number
  arxivId?: string
  claimOrigin?: ClaimOrigin
  evidenceKind?: EvidenceKind
  scopeDomain?: string
  scopeRegime?: string
  scopeAssumptions?: string[]
  projects?: string[]
}
export type KnowledgeCreateRequest = { title: string; nodeType: KnowledgeNodeType; templateId?: string; variables?: Record<string, string>; status?: KnowledgeStatus }
export type ApplyTemplateSectionsRequest = { nodeId: string; templateId: string; expectedRevision: string }
export type KnowledgeEvidenceCopyRequest = { sourceNodeId: string; targetNodeId: string; blockId: string; expectedTargetRevision: string }
export type KnowledgePropertyPatch = { status?: KnowledgeStatus; readingStatus?: KnowledgeReadingStatus; importance?: KnowledgeLevel; confidence?: KnowledgeLevel; claimOrigin?: ClaimOrigin; evidenceKind?: EvidenceKind | ''; scopeDomain?: string; scopeRegime?: string; scopeAssumptions?: string[]; projects?: string[] }
export type KnowledgeBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
export type KnowledgeSearchResult = { node: KnowledgeNodeRecord; excerpt: string; score: number }

const folderByType: Record<KnowledgeNodeType, string> = { paper: 'Papers', concept: 'Concepts', claim: 'Claims', insight: 'Insights', question: 'Questions', project: 'Projects' }
const nodeTypes = new Set<KnowledgeNodeType>(Object.keys(folderByType) as KnowledgeNodeType[])
const statuses = new Set<KnowledgeStatus>(['inbox', 'developing', 'established', 'archived'])
const readingStatuses = new Set<KnowledgeReadingStatus>(['to_read', 'reading', 'read', 'paused'])
const levels = new Set<KnowledgeLevel>(['low', 'medium', 'high'])
const claimOrigins = new Set<ClaimOrigin>(['paper', 'mine'])
const evidenceKinds = new Set<EvidenceKind>(['theory', 'experiment', 'anecdote', 'idea'])
const templateVariables = new Set(['authors', 'year', 'arxiv_id', 'doi', 'paper_link', 'current_project', 'selected_anchor'])
const nodeIdPattern = /^[a-z]+-[a-zA-Z0-9._-]{6,80}$/
const blockIdPattern = /^evidence-[a-zA-Z0-9_-]{1,100}$/

function safeName(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Untitled' }
function field(source: string, key: string) {
  const raw = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  if (!raw) return undefined
  try { return JSON.parse(raw) as string } catch { return raw.replace(/^['"]|['"]$/g, '') }
}
function unquote(value: string) { const trimmed = value.trim(); try { return String(JSON.parse(trimmed)) } catch { return trimmed.replace(/^['"]|['"]$/g, '') } }
/** Reads a YAML list written either as a flow list `[a, b]` or as indented `- item` lines. */
function listField(source: string, key: string) {
  const lines = source.split(/\r?\n/)
  const index = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (index < 0) return undefined
  const rest = lines[index].slice(key.length + 1).trim()
  if (rest.startsWith('[')) return rest.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)
  if (rest) return [unquote(rest)]
  const items: string[] = []
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) { const match = lines[cursor].match(/^\s+-\s*(.*)$/); if (!match) break; items.push(unquote(match[1])) }
  return items.filter(Boolean)
}
/** Replaces or removes one frontmatter field, including a block list that follows it. Empty values remove the key. */
function setFrontmatterField(body: string, key: string, value: string | string[] | undefined) {
  const lines = body.split(/\r?\n/)
  const index = lines.findIndex((line) => line.startsWith(`${key}:`))
  let end = index + 1
  if (index >= 0) while (end < lines.length && /^\s+-\s/.test(lines[end])) end += 1
  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length)
  const rendered = empty ? [] : [Array.isArray(value) ? `${key}: [${value.map((item) => JSON.stringify(item)).join(', ')}]` : `${key}: ${/^[a-z_]+$/.test(value) ? value : JSON.stringify(value)}`]
  if (index >= 0) lines.splice(index, end - index, ...rendered); else lines.push(...rendered)
  return lines.join('\n')
}
function parseNode(source: string, fallbackPaperId?: string) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) return undefined
  const nodeType = field(frontmatter[1], 'type') as KnowledgeNodeType
  // Library paper notes are identified by their arXiv folder even before the migration writes prism_id into the file.
  const id = field(frontmatter[1], 'prism_id') ?? (nodeType === 'paper' && fallbackPaperId ? paperNodeId(field(frontmatter[1], 'arxiv_id') ?? fallbackPaperId) : undefined)
  const title = field(frontmatter[1], 'title') ?? (nodeType === 'paper' && fallbackPaperId ? source.slice(frontmatter[0].length).match(/^#\s+(.+?)\s*$/m)?.[1] : undefined)
  if (!id || !title || !nodeTypes.has(nodeType)) return undefined
  const status = field(frontmatter[1], 'status') as KnowledgeStatus
  const readingStatus = field(frontmatter[1], 'reading_status') as KnowledgeReadingStatus
  const importance = field(frontmatter[1], 'importance') as KnowledgeLevel
  const confidence = field(frontmatter[1], 'confidence') as KnowledgeLevel
  const claimOrigin = field(frontmatter[1], 'claim_origin') as ClaimOrigin
  const evidenceKind = field(frontmatter[1], 'evidence_kind') as EvidenceKind
  return {
    claimOrigin: nodeType === 'claim' ? claimOrigins.has(claimOrigin) ? claimOrigin : 'paper' : undefined,
    evidenceKind: evidenceKinds.has(evidenceKind) ? evidenceKind : undefined,
    scopeDomain: field(frontmatter[1], 'scope_domain'), scopeRegime: field(frontmatter[1], 'scope_regime'),
    scopeAssumptions: listField(frontmatter[1], 'scope_assumptions'), projects: listField(frontmatter[1], 'projects'),
    id, title, nodeType,
    status: statuses.has(status) ? status : 'developing' as KnowledgeStatus,
    readingStatus: nodeType === 'paper' ? readingStatuses.has(readingStatus) ? readingStatus : 'to_read' : undefined,
    importance: levels.has(importance) ? importance : 'medium' as KnowledgeLevel,
    confidence: levels.has(confidence) ? confidence : 'medium' as KnowledgeLevel,
    templateId: field(frontmatter[1], 'template_id'),
    arxivId: field(frontmatter[1], 'arxiv_id') ?? (nodeType === 'paper' ? fallbackPaperId : undefined),
  }
}
function nodeMarkdown(input: { id: string; title: string; nodeType: KnowledgeNodeType; templateId?: string; templateVersion?: string; body: string; status?: KnowledgeStatus }) {
  return `---\ntype: ${input.nodeType}\nprism_id: ${JSON.stringify(input.id)}\ntitle: ${JSON.stringify(input.title)}\nstatus: ${input.status ?? 'developing'}\n${input.nodeType === 'paper' ? 'reading_status: to_read\n' : ''}${input.nodeType === 'claim' ? 'claim_origin: paper\n' : ''}importance: medium\nconfidence: medium\ncreated_by: user\ntemplate_id: ${JSON.stringify(input.templateId ?? '')}\ntemplate_version: ${JSON.stringify(input.templateVersion ?? '')}\ncreated_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n${input.body.replace(/^\s+/, '')}`
}
function updateFrontmatter(source: string, fields: Array<[string, string | string[] | undefined]>) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error('지식 노트의 YAML frontmatter를 찾을 수 없습니다.')
  let body = match[1]
  for (const [key, value] of fields) body = setFrontmatterField(body, key, value)
  return source.replace(match[0], () => `---\n${body}\n---`)
}
export function paperNodeId(arxivId: string) { return `paper-${arxivId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 76)}` }
function migratedPaperNote(source: string, folderName: string) {
  // Library paper notes written before knowledge nodes existed lack prism_id; add the stable identity without touching the body.
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontmatter || field(frontmatter[1], 'type') !== 'paper' || field(frontmatter[1], 'prism_id')) return undefined
  const arxivId = field(frontmatter[1], 'arxiv_id') ?? folderName
  const additions = [`prism_id: ${JSON.stringify(paperNodeId(arxivId))}`]
  if (!field(frontmatter[1], 'title')) { const heading = source.slice(frontmatter[0].length).match(/^#\s+(.+?)\s*$/m)?.[1]; additions.push(`title: ${JSON.stringify(heading ?? arxivId)}`) }
  if (!/^reading_status:/m.test(frontmatter[1])) additions.push('reading_status: to_read')
  const typeLine = frontmatter[1].match(/^type:[^\r\n]*/m)
  if (!typeLine) return undefined
  const body = frontmatter[1].replace(typeLine[0], `${typeLine[0]}\n${additions.join('\n')}`)
  const start = frontmatter[0].indexOf(frontmatter[1])
  return `${source.slice(0, start)}${body}${source.slice(start + frontmatter[1].length)}`
}
/**
 * Reading one note used to mean reading the whole vault: every list, backlink, relation and digest call
 * walked every Markdown file and hashed it. That is invisible at seven notes and fatal at two hundred, so the
 * parsed form of each file is kept in memory and only re-read when the file on disk actually changed.
 *
 * Freshness comes from two independent signals, because either one alone can lie. `mtime + size` catches the
 * editor the researcher has open beside Prism; `onNoteWritten` catches our own writes, two of which can land
 * inside the same millisecond at the same length. A cache that is wrong here shows stale text in an open
 * editor, so it is worth paying for both.
 */
type VaultFileRecord = { mtimeMs: number; size: number; snapshot: NoteSnapshot; parsed?: ReturnType<typeof parseNode> }
type NodeEntry = { filePath: string; snapshot: NoteSnapshot; parsed: NonNullable<ReturnType<typeof parseNode>> }
const vaultFiles = new Map<string, Map<string, VaultFileRecord>>()
const nodePaths = new Map<string, Map<string, string>>()
const vaultPrepared = new Set<string>()

function vaultKey(libraryPath: string) { return path.resolve(libraryPath).toLowerCase() }
function fileKey(filePath: string) { return path.resolve(filePath).toLowerCase() }
function vaultCache(libraryPath: string) {
  const key = vaultKey(libraryPath)
  const existing = vaultFiles.get(key)
  if (existing) return existing
  const created = new Map<string, VaultFileRecord>()
  vaultFiles.set(key, created)
  return created
}

/** Drops cached files. No argument clears everything; a path clears one library, or one file inside it. */
export function invalidateKnowledgeCache(libraryPath?: string, filePath?: string) {
  if (!libraryPath) { vaultFiles.clear(); nodePaths.clear(); vaultPrepared.clear(); return }
  if (!filePath) { vaultFiles.get(vaultKey(libraryPath))?.clear(); nodePaths.delete(vaultKey(libraryPath)); return }
  vaultFiles.get(vaultKey(libraryPath))?.delete(fileKey(filePath))
}
onNoteWritten((notePath) => { const key = fileKey(notePath); for (const cache of vaultFiles.values()) cache.delete(key) })

async function markdownFiles(libraryPath: string) {
  const seen = new Set<string>(); const files: Array<{ filePath: string; paperFolder?: string }> = []
  const push = (filePath: string, paperFolder?: string) => { const key = fileKey(filePath); if (!seen.has(key)) { seen.add(key); files.push({ filePath, paperFolder }) } }
  const collect = async (directory: string, paperFolder?: string) => {
    let entries: Dirent[]
    // A folder the researcher removed in Finder is simply empty, not a reason to fail every listing.
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return [] }
    for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) push(path.join(directory, entry.name), paperFolder)
    return entries
  }
  for (const folder of Object.values(folderByType)) await collect(path.join(libraryPath, folder))
  const papersDirectory = path.join(libraryPath, 'papers')
  for (const folder of await collect(papersDirectory)) {
    if (!folder.isDirectory()) continue
    await collect(path.join(papersDirectory, folder.name), folder.name)
  }
  return files
}

async function readEntry(libraryPath: string, filePath: string, paperFolder?: string) {
  const key = fileKey(filePath)
  const cache = vaultCache(libraryPath)
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try { stat = await fs.stat(filePath) } catch { cache.delete(key); return undefined }
  const cached = cache.get(key)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
  const snapshot = await readNoteSnapshot(filePath)
  const record: VaultFileRecord = { mtimeMs: stat.mtimeMs, size: stat.size, snapshot, parsed: parseNode(snapshot.content, paperFolder) }
  cache.set(key, record)
  return record
}

/** A paper note is identified by the folder it sits in, so a direct read has to recover that from the path. */
function paperFolderOf(libraryPath: string, filePath: string) {
  const parts = path.relative(libraryPath, filePath).split(path.sep)
  return parts.length === 3 && parts[0].toLowerCase() === 'papers' ? parts[1] : undefined
}

async function nodeEntries(libraryPath: string): Promise<NodeEntry[]> {
  // Seeding templates and creating the vault folders is first-run work, not per-read work.
  if (!vaultPrepared.has(vaultKey(libraryPath))) { await listTemplates(libraryPath); vaultPrepared.add(vaultKey(libraryPath)) }
  const files = await markdownFiles(libraryPath)
  const cache = vaultCache(libraryPath)
  const live = new Set<string>()
  const routes = new Map<string, string>()
  const entries: NodeEntry[] = []
  for (const { filePath, paperFolder } of files) {
    live.add(fileKey(filePath))
    const record = await readEntry(libraryPath, filePath, paperFolder)
    if (!record?.parsed) continue
    entries.push({ filePath, snapshot: record.snapshot, parsed: record.parsed })
    routes.set(record.parsed.id, filePath)
  }
  for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key)
  nodePaths.set(vaultKey(libraryPath), routes)
  return entries
}

/** Writes prism_id / reading_status into library paper notes that predate knowledge nodes. Listing never writes; call this from app startup. */
export async function migratePaperNotes(libraryPath: string) {
  const papersDirectory = path.join(libraryPath, 'papers')
  let folders: Dirent[] = []
  try { folders = await fs.readdir(papersDirectory, { withFileTypes: true }) } catch { return 0 }
  let migrated = 0
  for (const folder of folders) {
    if (!folder.isDirectory()) continue
    const directory = path.join(papersDirectory, folder.name)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const filePath = path.join(directory, entry.name)
      const next = migratedPaperNote(await fs.readFile(filePath, 'utf8'), folder.name)
      if (next) { await atomicWriteFile(filePath, next); migrated += 1 }
    }
  }
  return migrated
}
/**
 * Saving one note used to stat every file in the library to find out which one it was, which turned a sweep
 * over N notes into N² stat calls. Where a node lives changes only when files move, so the last known path is
 * tried first and the full walk is what happens when that answer is wrong.
 */
async function findNode(libraryPath: string, id: string): Promise<NodeEntry | undefined> {
  const known = nodePaths.get(vaultKey(libraryPath))?.get(id)
  if (known) {
    const record = await readEntry(libraryPath, known, paperFolderOf(libraryPath, known))
    if (record?.parsed?.id === id) return { filePath: known, snapshot: record.snapshot, parsed: record.parsed }
  }
  return (await nodeEntries(libraryPath)).find((entry) => entry.parsed.id === id)
}

function toRecord(libraryPath: string, entry: NodeEntry): KnowledgeNodeRecord {
  const { filePath, snapshot, parsed } = entry
  return { ...parsed, preview: knowledgePlainText(snapshot.content).slice(0, 240), evidenceCount: [...snapshot.content.matchAll(/<!--\s*prism-evidence:[^\s]+\s*-->/g)].length, relativePath: path.relative(libraryPath, filePath).split(path.sep).join('/'), revision: snapshot.revision, modifiedAt: snapshot.modifiedAt }
}

export async function listKnowledgeNodes(libraryPath: string): Promise<KnowledgeNodeRecord[]> {
  return (await nodeEntries(libraryPath)).map((entry) => toRecord(libraryPath, entry)).sort((left, right) => right.modifiedAt - left.modifiedAt)
}

/**
 * Everything the vault knows about itself, read once. Listing, backlinks and the digest each used to walk the
 * whole library on their own — and the digest walked it once per note, which is the same file read N³ times
 * for one window open. Anything that needs more than one of these should ask for the snapshot instead.
 */
export type VaultSnapshot = { records: KnowledgeNodeRecord[]; contents: Map<string, string>; backlinks: Map<string, KnowledgeBacklink[]> }

export async function readVaultSnapshot(libraryPath: string): Promise<VaultSnapshot> {
  const entries = await nodeEntries(libraryPath)
  const records = entries.map((entry) => toRecord(libraryPath, entry))
  const contents = new Map<string, string>()
  const backlinks = new Map<string, KnowledgeBacklink[]>()
  const byPath = new Map<string, string>()
  const byBase = new Map<string, string[]>()
  records.forEach((record, index) => {
    contents.set(record.id, entries[index].snapshot.content)
    backlinks.set(record.id, [])
    const route = record.relativePath.replace(/\.md$/i, '').toLocaleLowerCase()
    byPath.set(route, record.id)
    const base = route.split('/').at(-1)!
    byBase.set(base, [...(byBase.get(base) ?? []), record.id])
  })
  records.forEach((source, index) => {
    const content = entries[index].snapshot.content
    // One entry per source-target pair: the first link is the one whose line gets quoted, as before.
    const claimed = new Set<string>()
    for (const link of linkTargets(content)) {
      const normalized = link.target.toLocaleLowerCase()
      const exact = byPath.get(normalized)
      const targets = exact ? [exact] : normalized.includes('/') ? [] : byBase.get(normalized) ?? []
      for (const targetId of targets) {
        if (targetId === source.id || claimed.has(targetId)) continue
        claimed.add(targetId)
        const lineStart = content.lastIndexOf('\n', link.index) + 1
        const lineEnd = content.indexOf('\n', link.index)
        const excerpt = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd).replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, targetValue, alias) => alias || targetValue).trim().slice(0, 240)
        backlinks.get(targetId)!.push({ nodeId: source.id, title: source.title, nodeType: source.nodeType, relativePath: source.relativePath, excerpt })
      }
    }
  })
  for (const list of backlinks.values()) list.sort((left, right) => left.title.localeCompare(right.title))
  return { records: [...records].sort((left, right) => right.modifiedAt - left.modifiedAt), contents, backlinks }
}

export function evidenceBlock(source: string, blockId: string) {
  const escaped = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\r?\\n\\r?\\n)(> \\[!evidence\\][^\\r\\n]*(?:\\r?\\n>[^\\r\\n]*)*\\r?\\n<!--\\s*prism-evidence:[^\\s]+\\s*-->\\r?\\n\\^${escaped})(?=\\r?\\n\\r?\\n|$)`))
  return match?.[1]
}

export async function copyKnowledgeEvidence(libraryPath: string, request: KnowledgeEvidenceCopyRequest) {
  if (!nodeIdPattern.test(request.sourceNodeId) || !nodeIdPattern.test(request.targetNodeId) || request.sourceNodeId === request.targetNodeId
    || !blockIdPattern.test(request.blockId) || !/^[a-f0-9]{64}$/.test(request.expectedTargetRevision)) throw new Error('근거 카드 복사 정보가 올바르지 않습니다.')
  const source = await readKnowledgeNode(libraryPath, request.sourceNodeId)
  const block = evidenceBlock(source.content, request.blockId)
  if (!block) throw new Error('복사할 근거 카드를 찾을 수 없습니다.')
  const target = await readKnowledgeNode(libraryPath, request.targetNodeId)
  if (target.revision !== request.expectedTargetRevision) return { saved: false as const, conflict: target }
  if (new RegExp(`^\\^${request.blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(target.content)) throw new Error('대상 노트에 이미 같은 근거 카드가 있습니다.')
  return saveKnowledgeNode(libraryPath, request.targetNodeId, { content: `${target.content.trimEnd()}\n\n${block}\n`, expectedRevision: request.expectedTargetRevision })
}

export function knowledgePlainText(source: string) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/<!--[^>]*-->/g, '').replace(/^\^[a-zA-Z0-9_-]+\s*$/gm, '')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, target, alias) => alias || target).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s?(?:\[![^\]]+\]\s*)?/gm, '').replace(/[*_`#$~-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
function occurrences(source: string, query: string) { let count = 0; let index = 0; while ((index = source.indexOf(query, index)) >= 0) { count += 1; index += query.length } return count }

export async function searchKnowledge(libraryPath: string, input: string): Promise<KnowledgeSearchResult[]> {
  const query = input.trim()
  if (!query || query.length > 200) throw new Error('검색어는 1자 이상 200자 이하로 입력해 주세요.')
  const normalizedQuery = query.toLocaleLowerCase()
  const results: KnowledgeSearchResult[] = []
  for (const node of await listKnowledgeNodes(libraryPath)) {
    const snapshot = await readNoteSnapshot(path.join(libraryPath, ...node.relativePath.split('/')))
    const plain = knowledgePlainText(snapshot.content); const normalizedBody = plain.toLocaleLowerCase(); const title = node.title.toLocaleLowerCase(); const route = `${node.nodeType} ${node.relativePath}`.toLocaleLowerCase()
    const bodyHits = occurrences(normalizedBody, normalizedQuery)
    let score = title === normalizedQuery ? 1000 : title.startsWith(normalizedQuery) ? 600 : title.includes(normalizedQuery) ? 350 : route.includes(normalizedQuery) ? 180 : 0
    score += Math.min(bodyHits, 10) * 20
    if (!score) continue
    const match = normalizedBody.indexOf(normalizedQuery); const start = match < 0 ? 0 : Math.max(0, match - 70); const end = match < 0 ? 180 : Math.min(plain.length, match + query.length + 110)
    const excerpt = `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
    results.push({ node, excerpt, score })
  }
  return results.sort((left, right) => right.score - left.score || right.node.modifiedAt - left.node.modifiedAt).slice(0, 100)
}

function linkTargets(source: string) {
  const searchable = source.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
  return [...searchable.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => ({
    index: match.index ?? 0,
    target: match[1].split('|', 1)[0].split('#', 1)[0].replace(/\.md$/i, '').replaceAll('\\', '/').trim(),
  }))
}

export async function listKnowledgeBacklinks(libraryPath: string, targetId: string): Promise<KnowledgeBacklink[]> {
  const backlinks = (await readVaultSnapshot(libraryPath)).backlinks.get(targetId)
  if (!backlinks) throw new Error('지식 노트를 찾을 수 없습니다.')
  return backlinks
}

export async function createKnowledgeNode(libraryPath: string, request: KnowledgeCreateRequest) {
  if (!nodeTypes.has(request.nodeType)) throw new Error('지식 노트 유형이 올바르지 않습니다.')
  const title = safeName(request.title)
  const templates = await listTemplates(libraryPath)
  const template = templates.find((item) => item.id === request.templateId && item.nodeType === request.nodeType)
    ?? templates.find((item) => item.nodeType === request.nodeType && item.isDefault)
    ?? templates.find((item) => item.nodeType === request.nodeType)
  const id = `${request.nodeType}-${randomUUID().slice(0, 12)}`
  const directory = path.join(libraryPath, folderByType[request.nodeType])
  let filePath = path.join(directory, `${title}.md`); let suffix = 2
  while (true) { try { await fs.access(filePath); filePath = path.join(directory, `${title} ${suffix}.md`); suffix += 1 } catch { break } }
  const values: Record<string, string> = { title, date: new Date().toISOString().slice(0, 10) }
  for (const [key, value] of Object.entries(request.variables ?? {})) {
    if (!templateVariables.has(key) || typeof value !== 'string' || value.length > 2_000) throw new Error('지원하지 않는 템플릿 변수이거나 값이 너무 깁니다.')
    values[key] = value
  }
  const body = (template?.content ?? '# {{title}}\n\n').replace(/\{\{([a-z_]+)\}\}/g, (token, key: string) => values[key] ?? token)
  if (request.status !== undefined && !statuses.has(request.status)) throw new Error('상태 값이 올바르지 않습니다.')
  const content = nodeMarkdown({ id, title, nodeType: request.nodeType, templateId: template?.id, templateVersion: template?.revision, body, status: request.status })
  await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
  if (template) await markTemplateUsed(libraryPath, template.id).catch(() => undefined)
  return { nodes: await listKnowledgeNodes(libraryPath), id }
}

function headingName(line: string) { return line.replace(/^#{2,6}\s+/, '').replace(/\s+#+\s*$/, '').trim() }
function normalizedHeading(line: string) { return headingName(line).replace(/[*_`]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase() }
function missingTemplateSections(template: string, source: string, title: string) {
  const expanded = template.replace(/\{\{title\}\}/g, title).replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10))
  const lines = expanded.split(/\r?\n/); const headings: Array<{ index: number; level: number; line: string }> = []
  lines.forEach((line, index) => { const match = line.match(/^(#{2,6})\s+\S/); if (match) headings.push({ index, level: match[1].length, line }) })
  const existing = new Set([...source.matchAll(/^#{2,6}\s+.+$/gm)].map((match) => normalizedHeading(match[0])))
  const additions: string[] = []; const addedHeadings: string[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]; const key = normalizedHeading(heading.line)
    if (existing.has(key)) continue
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
    const block = lines.slice(heading.index, next?.index ?? lines.length).join('\n').trimEnd()
    additions.push(block); addedHeadings.push(headingName(heading.line))
    for (const nested of headings.filter((candidate) => candidate.index >= heading.index && candidate.index < (next?.index ?? lines.length))) existing.add(normalizedHeading(nested.line))
  }
  return { additions, addedHeadings }
}

export async function applyTemplateSections(libraryPath: string, request: ApplyTemplateSectionsRequest) {
  const node = await findNode(libraryPath, request.nodeId)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  const template = (await listTemplates(libraryPath)).find((item) => item.id === request.templateId && item.nodeType === node.parsed.nodeType)
  if (!template) throw new Error('이 노트 유형에 맞는 템플릿을 찾을 수 없습니다.')
  if (node.snapshot.revision !== request.expectedRevision) return { saved: false as const, conflict: node.snapshot }
  const missing = missingTemplateSections(template.content, node.snapshot.content, node.parsed.title)
  if (!missing.additions.length) return { saved: true as const, snapshot: node.snapshot, addedHeadings: [] }
  const result = await saveNoteSnapshot(node.filePath, { content: `${node.snapshot.content.trimEnd()}\n\n${missing.additions.join('\n\n')}\n`, expectedRevision: request.expectedRevision })
  return result.saved ? { saved: true as const, snapshot: result.snapshot, addedHeadings: missing.addedHeadings } : result
}

export async function readKnowledgeNode(libraryPath: string, id: string) {
  const node = await findNode(libraryPath, id)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  return node.snapshot
}

export async function saveKnowledgeNode(libraryPath: string, id: string, request: NoteSaveRequest) {
  const node = await findNode(libraryPath, id)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  return saveNoteSnapshot(node.filePath, request)
}

export async function updateKnowledgeProperties(libraryPath: string, id: string, patch: KnowledgePropertyPatch, expectedRevision: string) {
  if (patch.status !== undefined && !statuses.has(patch.status)) throw new Error('상태 값이 올바르지 않습니다.')
  if (patch.readingStatus !== undefined && !readingStatuses.has(patch.readingStatus)) throw new Error('읽기 상태 값이 올바르지 않습니다.')
  if (patch.importance !== undefined && !levels.has(patch.importance)) throw new Error('중요도 값이 올바르지 않습니다.')
  if (patch.confidence !== undefined && !levels.has(patch.confidence)) throw new Error('확신도 값이 올바르지 않습니다.')
  if (patch.claimOrigin !== undefined && !claimOrigins.has(patch.claimOrigin)) throw new Error('주장 출처 값이 올바르지 않습니다.')
  if (patch.evidenceKind !== undefined && patch.evidenceKind !== '' && !evidenceKinds.has(patch.evidenceKind)) throw new Error('근거 종류 값이 올바르지 않습니다.')
  const text = (value: unknown, limit: number) => { if (typeof value !== 'string' || value.length > limit) throw new Error('속성 값이 너무 길거나 올바르지 않습니다.'); return value.trim() }
  const list = (value: unknown) => { if (!Array.isArray(value) || value.length > 20) throw new Error('목록 속성이 올바르지 않습니다.'); return value.map((item) => text(item, 120)).filter(Boolean) }
  const node = await findNode(libraryPath, id)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  if (patch.readingStatus !== undefined && node.parsed.nodeType !== 'paper') throw new Error('Paper 노트에서만 읽기 상태를 바꿀 수 있습니다.')
  const claimOnly = [patch.claimOrigin, patch.evidenceKind, patch.scopeDomain, patch.scopeRegime, patch.scopeAssumptions].some((value) => value !== undefined)
  if (claimOnly && node.parsed.nodeType !== 'claim') throw new Error('Claim 노트에서만 주장 속성을 바꿀 수 있습니다.')
  const fields: Array<[string, string | string[] | undefined]> = []
  if (patch.status !== undefined) fields.push(['status', patch.status])
  if (patch.readingStatus !== undefined) fields.push(['reading_status', patch.readingStatus])
  if (patch.importance !== undefined) fields.push(['importance', patch.importance])
  if (patch.confidence !== undefined) fields.push(['confidence', patch.confidence])
  if (patch.claimOrigin !== undefined) fields.push(['claim_origin', patch.claimOrigin])
  if (patch.evidenceKind !== undefined) fields.push(['evidence_kind', patch.evidenceKind])
  if (patch.scopeDomain !== undefined) fields.push(['scope_domain', text(patch.scopeDomain, 200)])
  if (patch.scopeRegime !== undefined) fields.push(['scope_regime', text(patch.scopeRegime, 200)])
  if (patch.scopeAssumptions !== undefined) fields.push(['scope_assumptions', list(patch.scopeAssumptions)])
  if (patch.projects !== undefined) fields.push(['projects', list(patch.projects)])
  return saveNoteSnapshot(node.filePath, { content: updateFrontmatter(node.snapshot.content, fields), expectedRevision })
}

export async function deleteKnowledgeNode(libraryPath: string, id: string) {
  const node = await findNode(libraryPath, id)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  const target = path.join(libraryPath, '.prism', 'trash', 'knowledge', `${Date.now()}-${path.basename(node.filePath)}`)
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rename(node.filePath, target)
  // The trash entry is what makes the delete undoable, so hand it back to the caller.
  return { nodes: await listKnowledgeNodes(libraryPath), trashed: path.relative(libraryPath, target).split(path.sep).join('/'), title: node.parsed.title }
}

/** Puts a trashed note back where it came from. Deleting is a mistake people make, so it must be one click to undo. */
export async function restoreKnowledgeNode(libraryPath: string, trashedRelativePath: string) {
  if (!/^\.prism\/trash\/knowledge\/[^/\\]+\.md$/i.test(trashedRelativePath)) throw new Error('복구할 항목이 올바르지 않습니다.')
  const source = path.join(libraryPath, ...trashedRelativePath.split('/'))
  const content = await fs.readFile(source, 'utf8').catch(() => { throw new Error('휴지통에서 노트를 찾을 수 없습니다.') })
  const parsed = parseNode(content)
  if (!parsed) throw new Error('복구할 노트를 읽을 수 없습니다.')
  const name = path.basename(source).replace(/^\d+-/, '')
  const directory = path.join(libraryPath, folderByType[parsed.nodeType])
  await fs.mkdir(directory, { recursive: true })
  let target = path.join(directory, name); let suffix = 2
  while (true) { try { await fs.access(target); target = path.join(directory, `${name.replace(/\.md$/i, '')} ${suffix}.md`); suffix += 1 } catch { break } }
  await fs.rename(source, target)
  return { nodes: await listKnowledgeNodes(libraryPath), id: parsed.id }
}
