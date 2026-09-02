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
