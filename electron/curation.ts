import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'
import { createKnowledgeNode, deleteKnowledgeNode, evidenceBlock, listKnowledgeNodes, readKnowledgeNode, saveKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { listKnowledgeDataViews } from './knowledgeViews.js'
import { createKnowledgeRelation, listKnowledgeRelationRecords, type KnowledgeRelationRecord, type RelationEvidenceAnchor } from './relations.js'

/**
 * The curation queue is the one place where reading notes turn into structure. Reading stays linear;
 * promotion, merging, and approval happen here, in a batch, once the value of a link or memo is proven.
 */
export type CurationMemo = { paper: KnowledgeNodeRecord; blockId: string; anchorLabel: string; anchorSource: string; anchor?: RelationEvidenceAnchor; memo: string }
export type CurationStub = { node: KnowledgeNodeRecord; backlinks: number; ready: boolean }
export type CurationPendingRelation = { relation: KnowledgeRelationRecord; source: KnowledgeNodeRecord; target: KnowledgeNodeRecord }
export type CurationQueue = { pendingRelations: CurationPendingRelation[]; stubs: CurationStub[]; memos: CurationMemo[]; unsupportedClaims: KnowledgeNodeRecord[]; unansweredQuestions: KnowledgeNodeRecord[]; total: number }
export type PromoteMemoRequest = { paperNodeId: string; blockId: string; memo: string; nodeType: 'claim' | 'question'; title: string }
export type MergeConceptsRequest = { sourceId: string; targetId: string }

const wikiLinkPattern = /\[\[([^\]\n]+)\]\]/g
const nodeBase = (node: KnowledgeNodeRecord) => node.relativePath.replace(/\.md$/i, '').split('/').at(-1)!.toLocaleLowerCase()
const nodePath = (node: KnowledgeNodeRecord) => node.relativePath.replace(/\.md$/i, '')

function linkResolvesTo(target: string, node: KnowledgeNodeRecord) {
  const normalized = target.split('|', 1)[0].split('#', 1)[0].replace(/\.md$/i, '').replaceAll('\\', '/').trim().toLocaleLowerCase()
  return normalized === nodePath(node).toLocaleLowerCase() || (!normalized.includes('/') && normalized === nodeBase(node))
}
function linksTo(content: string, node: KnowledgeNodeRecord) {
  const searchable = content.replace(/```[\s\S]*?```/g, '')
  for (const match of searchable.matchAll(wikiLinkPattern)) if (linkResolvesTo(match[1], node)) return true
  return false
}
function evidenceAnchorFromBlock(block: string): RelationEvidenceAnchor | undefined {
  const meta = block.match(/<!--\s*prism-evidence:([^\s]+)\s*-->/)
  if (!meta) return undefined
  try {
    const value = JSON.parse(decodeURIComponent(meta[1])) as Partial<RelationEvidenceAnchor>
    if (typeof value.paperId === 'string' && typeof value.anchorId === 'string' && typeof value.type === 'string' && Number.isInteger(value.page) && typeof value.label === 'string') return { paperId: value.paperId, anchorId: value.anchorId, type: value.type, page: Number(value.page), label: value.label }
  } catch { /* malformed metadata stays visible in raw Markdown */ }
  return undefined
}

/** Plain paragraphs written directly under an evidence card are reading memos; a memo already linked to a Claim or Question counts as promoted. */
export function memosFor(paper: KnowledgeNodeRecord, content: string): CurationMemo[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const memos: CurationMemo[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const idMatch = lines[index].match(/^\^(evidence-[a-zA-Z0-9_-]+)\s*$/)
    if (!idMatch) continue
    const metaMatch = lines[index - 1]?.match(/^<!--\s*prism-evidence:([^\s]+)\s*-->$/)
    let anchor: RelationEvidenceAnchor | undefined; let anchorLabel = ''; let anchorSource = ''
    if (metaMatch) {
      try {
        const value = JSON.parse(decodeURIComponent(metaMatch[1])) as { label?: string; source?: string; paperId?: string; anchorId?: string; type?: RelationEvidenceAnchor['type']; page?: number }
        anchorLabel = value.label ?? ''; anchorSource = value.source ?? ''
        if (value.paperId && value.anchorId && value.type && Number.isInteger(value.page) && value.label) anchor = { paperId: value.paperId, anchorId: value.anchorId, type: value.type, page: Number(value.page), label: value.label }
      } catch { /* ignore */ }
    }
    const paragraphs: string[] = []; let current: string[] = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (/^(#{1,6}\s|>|<!--|\^|\||```|---)/.test(line)) break
      if (!line.trim()) { if (current.length) { paragraphs.push(current.join('\n')); current = [] } continue }
      current.push(line)
    }
    if (current.length) paragraphs.push(current.join('\n'))
    for (const memo of paragraphs) if (!/\[\[(Claims|Questions)\//i.test(memo)) memos.push({ paper, blockId: idMatch[1], anchorLabel, anchorSource, anchor, memo })
  }
  return memos
}

export async function listCurationQueue(libraryPath: string): Promise<CurationQueue> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const contents = new Map<string, string>()
  for (const node of nodes) contents.set(node.id, (await readKnowledgeNode(libraryPath, node.id)).content)
  const relations = await listKnowledgeRelationRecords(libraryPath)
  const pendingRelations = relations.filter((relation) => relation.reviewStatus === 'pending')
    .flatMap((relation) => { const source = byId.get(relation.sourceId); const target = byId.get(relation.targetId); return source && target ? [{ relation, source, target }] : [] })
    .sort((left, right) => right.relation.createdAt.localeCompare(left.relation.createdAt))
  const stubs = nodes.filter((node) => node.nodeType === 'concept' && node.status === 'inbox').map((node) => {
    let backlinks = 0
    for (const [id, content] of contents) if (id !== node.id && linksTo(content, node)) backlinks += 1
    return { node, backlinks, ready: backlinks >= 2 }
  }).sort((left, right) => right.backlinks - left.backlinks || left.node.title.localeCompare(right.node.title))
  const memos = nodes.filter((node) => node.nodeType === 'paper').flatMap((paper) => memosFor(paper, contents.get(paper.id) ?? ''))
  const views = await listKnowledgeDataViews(libraryPath)
  const total = pendingRelations.length + stubs.length + memos.length + views.unsupportedClaims.length + views.unansweredQuestions.length
  return { pendingRelations, stubs, memos, unsupportedClaims: views.unsupportedClaims, unansweredQuestions: views.unansweredQuestions, total }
}

/** Turns one reading memo into a Claim or Question that keeps its PDF evidence and links back to the paper note. */
export async function promoteMemo(libraryPath: string, request: PromoteMemoRequest) {
  const paper = (await listKnowledgeNodes(libraryPath)).find((node) => node.id === request.paperNodeId && node.nodeType === 'paper')
  if (!paper) throw new Error('논문 노트를 찾을 수 없습니다.')
  const paperSnapshot = await readKnowledgeNode(libraryPath, paper.id)
  const block = evidenceBlock(paperSnapshot.content, request.blockId)
  if (!block) throw new Error('근거 카드를 찾을 수 없습니다.')
  const memo = request.memo.replace(/\r\n/g, '\n').trim()
  const title = request.title.trim()
  if (!memo || !paperSnapshot.content.replace(/\r\n/g, '\n').includes(memo)) throw new Error('승격할 필기를 논문 노트에서 찾을 수 없습니다.')
  if (!title) throw new Error('승격할 노트 제목을 입력하세요.')
  const created = await createKnowledgeNode(libraryPath, { title, nodeType: request.nodeType })
  const node = created.nodes.find((item) => item.id === created.id)
  if (!node) throw new Error('승격 노트를 만들지 못했습니다.')
  const draft = await readKnowledgeNode(libraryPath, created.id)
  // The statement stays the researcher's own words; Prism only carries the evidence and the source link along.
  const body = `${draft.content.trimEnd()}\n\n${memo}\n\n${block}\n\n> [!note] 출처 노트\n> [[${nodePath(paper)}|${paper.title}]]\n`
  const saved = await saveKnowledgeNode(libraryPath, created.id, { content: body, expectedRevision: draft.revision })
  if (!saved.saved) throw new Error('승격 노트를 저장하지 못했습니다.')
  const marked = paperSnapshot.content.replace(/\r\n/g, '\n').replace(memo, () => `${memo} → [[${nodePath(node)}|${title}]]`)
  const paperSaved = await saveKnowledgeNode(libraryPath, paper.id, { content: marked, expectedRevision: paperSnapshot.revision })
  if (!paperSaved.saved) throw new Error('논문 노트가 외부에서 변경되어 승격 표시를 남기지 못했습니다.')
  await createKnowledgeRelation(libraryPath, { sourceId: paper.id, targetId: created.id, type: request.nodeType === 'claim' ? 'supports' : 'raises', creator: 'user', evidenceAnchor: evidenceAnchorFromBlock(block), expectedRevision: paperSaved.snapshot.revision })
  return { id: created.id }
}

/** Folds a duplicate or stub Concept into another: links and relation sidecars are repointed, any real body is appended, and the source goes to trash. */
export async function mergeConcepts(libraryPath: string, request: MergeConceptsRequest) {
  const nodes = await listKnowledgeNodes(libraryPath)
  const source = nodes.find((node) => node.id === request.sourceId && node.nodeType === 'concept')
  const target = nodes.find((node) => node.id === request.targetId && node.nodeType === 'concept')
  if (!source || !target || source.id === target.id) throw new Error('병합할 두 Concept을 찾을 수 없습니다.')
  const targetPath = nodePath(target)
  for (const node of nodes) {
    if (node.id === source.id) continue
    const snapshot = await readKnowledgeNode(libraryPath, node.id)
    const next = snapshot.content.replace(wikiLinkPattern, (whole, inner: string) => {
      if (!linkResolvesTo(inner, source)) return whole
      const [targetPart, alias] = inner.split('|')
      const suffix = targetPart.includes('#') ? `#${targetPart.split('#').slice(1).join('#')}` : ''
      return `[[${targetPath}${suffix}|${alias ?? source.title}]]`
    })
    if (next !== snapshot.content) await saveKnowledgeNode(libraryPath, node.id, { content: next, expectedRevision: snapshot.revision })
  }
  const relationsDirectory = path.join(libraryPath, '.prism', 'relations')
  const relations = await listKnowledgeRelationRecords(libraryPath)
  for (const relation of relations) {
    if (relation.sourceId !== source.id && relation.targetId !== source.id) continue
    const updated: KnowledgeRelationRecord = { ...relation, sourceId: relation.sourceId === source.id ? target.id : relation.sourceId, targetId: relation.targetId === source.id ? target.id : relation.targetId }
    const duplicate = updated.sourceId === updated.targetId || relations.some((other) => other.id !== relation.id && other.sourceId === updated.sourceId && other.targetId === updated.targetId && other.type === updated.type)
    if (duplicate) await fs.unlink(path.join(relationsDirectory, `${relation.id}.json`)).catch(() => undefined)
    else await atomicWriteFile(path.join(relationsDirectory, `${relation.id}.json`), JSON.stringify(updated, null, 2))
  }
  const sourceSnapshot = await readKnowledgeNode(libraryPath, source.id)
  const sourceBody = sourceSnapshot.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/^#\s[^\n]*\n?/, '').trim()
  const meaningful = sourceBody.replace(/^#{1,6}\s.*$/gm, '').replace(/^\|.*$/gm, '').trim()
  if (meaningful) {
    const targetSnapshot = await readKnowledgeNode(libraryPath, target.id)
    await saveKnowledgeNode(libraryPath, target.id, { content: `${targetSnapshot.content.trimEnd()}\n\n## 병합됨: ${source.title}\n\n${sourceBody}\n`, expectedRevision: targetSnapshot.revision })
  }
  await deleteKnowledgeNode(libraryPath, source.id)
  return { id: target.id }
}
