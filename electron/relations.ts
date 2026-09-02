import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { listKnowledgeNodes, readKnowledgeNode, saveKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'

export type KnowledgeRelationType = 'discusses' | 'supports' | 'contradicts' | 'extends' | 'uses' | 'explains' | 'evidence_for' | 'derived_from' | 'raises' | 'related'
export type KnowledgeRelationRecord = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; reviewStatus: 'pending' | 'approved' | 'rejected'; createdAt: string }
export type KnowledgeRelationView = KnowledgeRelationRecord & { direction: 'outgoing' | 'incoming'; other: Pick<KnowledgeNodeRecord, 'id' | 'title' | 'nodeType' | 'relativePath'> }
export type KnowledgeRelationCreateRequest = { sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; expectedRevision: string }
export type KnowledgeRelationDeleteRequest = { id: string; expectedRevision: string }

const relationTypes = new Set<KnowledgeRelationType>(['discusses', 'supports', 'contradicts', 'extends', 'uses', 'explains', 'evidence_for', 'derived_from', 'raises', 'related'])
const relationLabels: Record<KnowledgeRelationType, string> = { discusses: '다룸', supports: '지지함', contradicts: '반박함', extends: '확장함', uses: '사용함', explains: '설명함', evidence_for: '근거임', derived_from: '출발함', raises: '질문을 제기함', related: '관련' }
const nodeIdPattern = /^[a-z]+-[a-f0-9-]{6,80}$/
const relationIdPattern = /^relation-[a-f0-9-]{20,80}$/

function directory(libraryPath: string) { return path.join(libraryPath, '.prism', 'relations') }
function validRecord(value: unknown): value is KnowledgeRelationRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<KnowledgeRelationRecord>
  return typeof item.id === 'string' && relationIdPattern.test(item.id) && typeof item.sourceId === 'string' && nodeIdPattern.test(item.sourceId)
    && typeof item.targetId === 'string' && nodeIdPattern.test(item.targetId) && typeof item.type === 'string' && relationTypes.has(item.type as KnowledgeRelationType)
    && (item.creator === 'user' || item.creator === 'ai') && (item.reviewStatus === 'pending' || item.reviewStatus === 'approved' || item.reviewStatus === 'rejected') && typeof item.createdAt === 'string'
}
async function records(libraryPath: string) {
  let names: string[]
  try { names = (await fs.readdir(directory(libraryPath))).filter((name) => name.endsWith('.json')) } catch { return [] }
  const result: KnowledgeRelationRecord[] = []
  for (const name of names) {
    try { const value = JSON.parse(await fs.readFile(path.join(directory(libraryPath), name), 'utf8')); if (validRecord(value)) result.push(value) } catch { /* Ignore malformed relation files. */ }
  }
  return result
}
function compactNode(node: KnowledgeNodeRecord) { return { id: node.id, title: node.title, nodeType: node.nodeType, relativePath: node.relativePath } }

export async function listKnowledgeRelations(libraryPath: string, nodeId: string): Promise<KnowledgeRelationView[]> {
  const nodes = await listKnowledgeNodes(libraryPath); const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!byId.has(nodeId)) throw new Error('지식 노트를 찾을 수 없습니다.')
  const result: KnowledgeRelationView[] = []
  for (const relation of await records(libraryPath)) {
    if (relation.sourceId === nodeId && byId.has(relation.targetId)) result.push({ ...relation, direction: 'outgoing', other: compactNode(byId.get(relation.targetId)!) })
    else if (relation.targetId === nodeId && byId.has(relation.sourceId)) result.push({ ...relation, direction: 'incoming', other: compactNode(byId.get(relation.sourceId)!) })
  }
  return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
function markdownBlock(relation: KnowledgeRelationRecord, target: KnowledgeNodeRecord) {
  const metadata = encodeURIComponent(JSON.stringify({ id: relation.id, sourceId: relation.sourceId, targetId: relation.targetId, type: relation.type, creator: relation.creator, reviewStatus: relation.reviewStatus }))
  const targetPath = target.relativePath.replace(/\.md$/i, '')
  return `> [!abstract] 관계 · ${relationLabels[relation.type]}\n> [[${targetPath}|${target.title}]]\n<!-- prism-relation:${metadata} -->\n^${relation.id}`
}
function removeMarkdownBlock(source: string, relationId: string) {
  const escaped = relationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(`(?:^|\\r?\\n)> \\[!abstract\\] 관계 · [^\\r\\n]*\\r?\\n> \\[\\[[^\\r\\n]+\\]\\]\\r?\\n<!--\\s*prism-relation:[^\\s]+\\s*-->\\r?\\n\\^${escaped}(?=\\r?\\n|$)\\r?\\n?`)
  return source.replace(expression, '\n').replace(/\n{3,}/g, '\n\n')
}

export async function createKnowledgeRelation(libraryPath: string, request: KnowledgeRelationCreateRequest) {
  if (!nodeIdPattern.test(request.sourceId) || !nodeIdPattern.test(request.targetId) || request.sourceId === request.targetId) throw new Error('관계의 출발과 대상 노트가 올바르지 않습니다.')
  if (!relationTypes.has(request.type) || (request.creator !== 'user' && request.creator !== 'ai') || !/^[a-f0-9]{64}$/.test(request.expectedRevision)) throw new Error('관계 정보가 올바르지 않습니다.')
  const nodes = await listKnowledgeNodes(libraryPath); const source = nodes.find((node) => node.id === request.sourceId); const target = nodes.find((node) => node.id === request.targetId)
  if (!source || !target) throw new Error('관계를 연결할 지식 노트를 찾을 수 없습니다.')
  const existing = await records(libraryPath)
  if (existing.some((item) => item.sourceId === request.sourceId && item.targetId === request.targetId && item.type === request.type && item.reviewStatus !== 'rejected')) throw new Error('이미 같은 관계가 있습니다.')
  const relation: KnowledgeRelationRecord = { id: `relation-${randomUUID()}`, sourceId: request.sourceId, targetId: request.targetId, type: request.type, creator: request.creator, reviewStatus: request.creator === 'user' ? 'approved' : 'pending', createdAt: new Date().toISOString() }
  const snapshot = await readKnowledgeNode(libraryPath, source.id)
  if (snapshot.revision !== request.expectedRevision) return { saved: false as const, conflict: snapshot }
  let savedSnapshot = snapshot
  if (relation.reviewStatus === 'approved') {
    const saved = await saveKnowledgeNode(libraryPath, source.id, { content: `${snapshot.content.trimEnd()}\n\n${markdownBlock(relation, target)}\n`, expectedRevision: request.expectedRevision })
    if (!saved.saved) return saved
    savedSnapshot = saved.snapshot
  }
  await fs.mkdir(directory(libraryPath), { recursive: true })
  await fs.writeFile(path.join(directory(libraryPath), `${relation.id}.json`), JSON.stringify(relation, null, 2), { encoding: 'utf8', flag: 'wx' })
  return { saved: true as const, relation, snapshot: savedSnapshot, relations: await listKnowledgeRelations(libraryPath, source.id) }
}

export async function deleteKnowledgeRelation(libraryPath: string, request: KnowledgeRelationDeleteRequest) {
  if (!relationIdPattern.test(request.id) || !/^[a-f0-9]{64}$/.test(request.expectedRevision)) throw new Error('관계 삭제 정보가 올바르지 않습니다.')
  const relation = (await records(libraryPath)).find((item) => item.id === request.id)
  if (!relation) throw new Error('관계를 찾을 수 없습니다.')
  const snapshot = await readKnowledgeNode(libraryPath, relation.sourceId)
  if (snapshot.revision !== request.expectedRevision) return { saved: false as const, conflict: snapshot }
  let savedSnapshot = snapshot
  if (relation.reviewStatus === 'approved') {
    const saved = await saveKnowledgeNode(libraryPath, relation.sourceId, { content: removeMarkdownBlock(snapshot.content, relation.id), expectedRevision: request.expectedRevision })
    if (!saved.saved) return saved
    savedSnapshot = saved.snapshot
  }
  await fs.unlink(path.join(directory(libraryPath), `${relation.id}.json`))
  return { saved: true as const, snapshot: savedSnapshot, relations: await listKnowledgeRelations(libraryPath, relation.sourceId) }
}
