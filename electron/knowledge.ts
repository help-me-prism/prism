import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readNoteSnapshot, saveNoteSnapshot, type NoteSaveRequest } from './notes.js'
import { listTemplates, type KnowledgeNodeType } from './templates.js'

export type KnowledgeStatus = 'inbox' | 'developing' | 'established' | 'archived'
export type KnowledgeLevel = 'low' | 'medium' | 'high'
export type KnowledgeNodeRecord = {
  id: string
  title: string
  nodeType: KnowledgeNodeType
  status: KnowledgeStatus
  importance: KnowledgeLevel
  confidence: KnowledgeLevel
  templateId?: string
  relativePath: string
  revision: string
  modifiedAt: number
}
export type KnowledgeCreateRequest = { title: string; nodeType: KnowledgeNodeType; templateId?: string }
export type KnowledgePropertyPatch = { status?: KnowledgeStatus; importance?: KnowledgeLevel; confidence?: KnowledgeLevel }
export type KnowledgeBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
export type KnowledgeSearchResult = { node: KnowledgeNodeRecord; excerpt: string; score: number }

const folderByType: Record<KnowledgeNodeType, string> = { paper: 'Papers', concept: 'Concepts', claim: 'Claims', insight: 'Insights', question: 'Questions' }
const nodeTypes = new Set<KnowledgeNodeType>(Object.keys(folderByType) as KnowledgeNodeType[])
const statuses = new Set<KnowledgeStatus>(['inbox', 'developing', 'established', 'archived'])
const levels = new Set<KnowledgeLevel>(['low', 'medium', 'high'])

function safeName(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Untitled' }
function field(source: string, key: string) {
  const raw = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  if (!raw) return undefined
  try { return JSON.parse(raw) as string } catch { return raw.replace(/^['"]|['"]$/g, '') }
}
function parseNode(source: string) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) return undefined
  const id = field(frontmatter[1], 'prism_id'); const title = field(frontmatter[1], 'title'); const nodeType = field(frontmatter[1], 'type') as KnowledgeNodeType
  if (!id || !title || !nodeTypes.has(nodeType)) return undefined
  const status = field(frontmatter[1], 'status') as KnowledgeStatus
  const importance = field(frontmatter[1], 'importance') as KnowledgeLevel
  const confidence = field(frontmatter[1], 'confidence') as KnowledgeLevel
  return {
    id, title, nodeType,
    status: statuses.has(status) ? status : 'developing' as KnowledgeStatus,
    importance: levels.has(importance) ? importance : 'medium' as KnowledgeLevel,
    confidence: levels.has(confidence) ? confidence : 'medium' as KnowledgeLevel,
    templateId: field(frontmatter[1], 'template_id'),
  }
}
function nodeMarkdown(input: { id: string; title: string; nodeType: KnowledgeNodeType; templateId?: string; body: string }) {
  return `---\ntype: ${input.nodeType}\nprism_id: ${JSON.stringify(input.id)}\ntitle: ${JSON.stringify(input.title)}\nstatus: developing\nimportance: medium\nconfidence: medium\ncreated_by: user\ntemplate_id: ${JSON.stringify(input.templateId ?? '')}\ncreated_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n${input.body.replace(/^\s+/, '')}`
}
function updateFrontmatter(source: string, patch: KnowledgePropertyPatch) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error('지식 노트의 YAML frontmatter를 찾을 수 없습니다.')
  let body = match[1]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const line = new RegExp(`^${key}:.*$`, 'm')
    body = line.test(body) ? body.replace(line, `${key}: ${value}`) : `${body}\n${key}: ${value}`
  }
  return source.replace(match[0], `---\n${body}\n---`)
}
async function nodeFiles(libraryPath: string) {
  await listTemplates(libraryPath)
  const results: string[] = []
  for (const folder of Object.values(folderByType)) {
    const directory = path.join(libraryPath, folder)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) results.push(path.join(directory, entry.name))
  }
  return results
}
async function findNode(libraryPath: string, id: string) {
  for (const filePath of await nodeFiles(libraryPath)) {
    const snapshot = await readNoteSnapshot(filePath); const parsed = parseNode(snapshot.content)
    if (parsed?.id === id) return { filePath, snapshot, parsed }
  }
  return undefined
}

export async function listKnowledgeNodes(libraryPath: string): Promise<KnowledgeNodeRecord[]> {
  const nodes: KnowledgeNodeRecord[] = []
  for (const filePath of await nodeFiles(libraryPath)) {
    const snapshot = await readNoteSnapshot(filePath); const parsed = parseNode(snapshot.content)
    if (parsed) nodes.push({ ...parsed, relativePath: path.relative(libraryPath, filePath).split(path.sep).join('/'), revision: snapshot.revision, modifiedAt: snapshot.modifiedAt })
  }
  return nodes.sort((left, right) => right.modifiedAt - left.modifiedAt)
}

function plainMarkdown(source: string) {
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
    const plain = plainMarkdown(snapshot.content); const normalizedBody = plain.toLocaleLowerCase(); const title = node.title.toLocaleLowerCase(); const route = `${node.nodeType} ${node.relativePath}`.toLocaleLowerCase()
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
  const nodes = await listKnowledgeNodes(libraryPath)
  const target = nodes.find((node) => node.id === targetId)
  if (!target) throw new Error('지식 노트를 찾을 수 없습니다.')
  const targetPath = target.relativePath.replace(/\.md$/i, '').toLocaleLowerCase()
  const targetBase = targetPath.split('/').at(-1)!
  const backlinks: KnowledgeBacklink[] = []
  for (const node of nodes) {
    if (node.id === targetId) continue
    const snapshot = await readKnowledgeNode(libraryPath, node.id)
    const link = linkTargets(snapshot.content).find((item) => {
      const normalized = item.target.toLocaleLowerCase()
      return normalized === targetPath || (!normalized.includes('/') && normalized === targetBase)
    })
    if (!link) continue
    const lineStart = snapshot.content.lastIndexOf('\n', link.index) + 1
    const lineEnd = snapshot.content.indexOf('\n', link.index)
    const excerpt = snapshot.content.slice(lineStart, lineEnd < 0 ? snapshot.content.length : lineEnd).replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, targetValue, alias) => alias || targetValue).trim().slice(0, 240)
    backlinks.push({ nodeId: node.id, title: node.title, nodeType: node.nodeType, relativePath: node.relativePath, excerpt })
  }
  return backlinks.sort((left, right) => left.title.localeCompare(right.title))
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
  const body = (template?.content ?? '# {{title}}\n\n').replaceAll('{{title}}', title)
  const content = nodeMarkdown({ id, title, nodeType: request.nodeType, templateId: template?.id, body })
  await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
  return { nodes: await listKnowledgeNodes(libraryPath), id }
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
  if (patch.importance !== undefined && !levels.has(patch.importance)) throw new Error('중요도 값이 올바르지 않습니다.')
  if (patch.confidence !== undefined && !levels.has(patch.confidence)) throw new Error('확신도 값이 올바르지 않습니다.')
  const allowed: KnowledgePropertyPatch = {}
  if (patch.status !== undefined) allowed.status = patch.status
  if (patch.importance !== undefined) allowed.importance = patch.importance
  if (patch.confidence !== undefined) allowed.confidence = patch.confidence
  const node = await findNode(libraryPath, id)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  return saveNoteSnapshot(node.filePath, { content: updateFrontmatter(node.snapshot.content, allowed), expectedRevision })
}

export async function deleteKnowledgeNode(libraryPath: string, id: string) {
  const node = await findNode(libraryPath, id)
  if (!node) throw new Error('지식 노트를 찾을 수 없습니다.')
  const target = path.join(libraryPath, '.prism', 'trash', 'knowledge', `${Date.now()}-${path.basename(node.filePath)}`)
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rename(node.filePath, target)
  return listKnowledgeNodes(libraryPath)
}
