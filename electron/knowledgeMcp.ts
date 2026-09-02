import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { knowledgePlainText, listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { suggestKnowledge } from './knowledgeSuggestions.js'
import { listEvidenceAnchors, type EvidenceAnchor, type EvidencePaper } from './evidence.js'
import { listKnowledgeRelationRecords, type KnowledgeRelationRecord } from './relations.js'
import { searchResearchKnowledge } from './researchSearch.js'
import { listTemplates, markTemplateUsed } from './templates.js'

type EmbeddedEvidence = { nodeId: string; paperId: string; anchorId: string; type: 'sentence' | 'section' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string; paperTitle: string; source: string }
type OpenAnchorRequest = { version: 1; requestId: string; requestedAt: string; paperId: string; anchorId: string; type: EvidenceAnchor['type']; page: number; label: string }

const nodeIdPattern = /^[a-z]+-[a-f0-9-]{6,80}$/
const paperIdPattern = /^[a-zA-Z0-9._-]{1,160}$/
const draftFolders = { paper: 'Papers', concept: 'Concepts', claim: 'Claims', insight: 'Insights', question: 'Questions', project: 'Projects' } as const
const templateVariables = new Set(['title', 'date', 'authors', 'year', 'arxiv_id', 'doi', 'paper_link', 'current_project', 'selected_anchor'])

function inside(root: string, candidate: string) { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }
function portableRelative(root: string, candidate: string) { return path.relative(root, candidate).split(path.sep).join('/') }
function safeName(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Untitled' }
async function exists(filePath: string) { try { await fs.access(filePath); return true } catch { return false } }
async function atomicJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${randomUUID()}.tmp`
  try { await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8'); await fs.rename(temporary, filePath) }
  catch (reason) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw reason }
}

export async function assertKnowledgeVault(input: string) {
  const libraryPath = path.resolve(input)
  try { if (!(await fs.stat(libraryPath)).isDirectory()) throw new Error() } catch { throw new Error('설정한 Prism Vault 폴더를 찾을 수 없습니다.') }
  const markers = [path.join(libraryPath, '.prism', 'library.json'), ...Object.values(draftFolders).map((folder) => path.join(libraryPath, folder))]
  if (!(await Promise.all(markers.map(exists))).some(Boolean)) throw new Error('설정한 폴더는 Prism 연구 Vault가 아닙니다.')
  return libraryPath
}

async function evidencePapers(libraryPath: string): Promise<EvidencePaper[]> {
  let payload: unknown
  try { payload = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'library.json'), 'utf8')) } catch { return [] }
  if (!Array.isArray(payload)) return []
  const papers: EvidencePaper[] = []
  for (const value of payload) {
    if (!value || typeof value !== 'object') continue
    const item = value as { arxivId?: unknown; title?: unknown; pdfPath?: unknown }
    if (typeof item.arxivId !== 'string' || !paperIdPattern.test(item.arxivId) || typeof item.title !== 'string') continue
    const fallback = path.join(libraryPath, 'papers', item.arxivId, 'original.pdf')
    const stored = typeof item.pdfPath === 'string' ? path.resolve(item.pdfPath) : fallback
    papers.push({ arxivId: item.arxivId, title: item.title.slice(0, 500), pdfPath: inside(libraryPath, stored) ? stored : fallback })
  }
  return papers
}

function embeddedEvidence(markdown: string, nodeId: string): EmbeddedEvidence[] {
  const result: EmbeddedEvidence[] = []
  for (const match of markdown.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->/g)) try {
    const item = JSON.parse(decodeURIComponent(match[1])) as Partial<EmbeddedEvidence>
    if (typeof item.paperId === 'string' && paperIdPattern.test(item.paperId) && typeof item.anchorId === 'string' && item.anchorId.length <= 300
      && ['sentence', 'section', 'equation', 'table', 'figure', 'page'].includes(String(item.type)) && Number.isInteger(item.page) && Number(item.page) > 0
      && typeof item.label === 'string' && typeof item.paperTitle === 'string' && typeof item.source === 'string') result.push({ nodeId, paperId: item.paperId, anchorId: item.anchorId, type: item.type!, page: item.page!, label: item.label.slice(0, 300), paperTitle: item.paperTitle.slice(0, 500), source: item.source.slice(0, 20_000) })
  } catch { /* Malformed generated metadata is never returned to an MCP client. */ }
  return result
}

function relationOther(relation: KnowledgeRelationRecord, nodeId: string) { return relation.sourceId === nodeId ? relation.targetId : relation.sourceId }
function approvedRelations(relations: KnowledgeRelationRecord[]) { return relations.filter((relation) => relation.reviewStatus === 'approved') }

export async function mcpSearchKnowledge(libraryPath: string, query: string, limit = 8) {
  const results = await searchResearchKnowledge(libraryPath, query, limit)
  return { query: query.trim(), results: results.map((item) => ({ ...item, node: { ...item.node, relativePath: item.node.relativePath.replaceAll('\\', '/') } })) }
}

export async function mcpGetClaimEvidence(libraryPath: string, claimId: string) {
  if (!nodeIdPattern.test(claimId)) throw new Error('Claim ID가 올바르지 않습니다.')
  const nodes = await listKnowledgeNodes(libraryPath); const claim = nodes.find((node) => node.id === claimId)
  if (!claim || claim.nodeType !== 'claim') throw new Error('해당 ID의 Claim을 찾을 수 없습니다.')
  const relations = approvedRelations(await listKnowledgeRelationRecords(libraryPath))
    .filter((relation) => relation.targetId === claimId && ['supports', 'contradicts', 'evidence_for'].includes(relation.type)).slice(0, 100)
  const sourceNodes = [...new Set(relations.map((relation) => relationOther(relation, claimId)))].map((id) => nodes.find((node) => node.id === id)).filter((node): node is KnowledgeNodeRecord => Boolean(node))
  const evidence: EmbeddedEvidence[] = []; const notes: Array<{ node: KnowledgeNodeRecord; text: string }> = []
  for (const node of [claim, ...sourceNodes]) { const markdown = (await readKnowledgeNode(libraryPath, node.id)).content; evidence.push(...embeddedEvidence(markdown, node.id)); notes.push({ node, text: knowledgePlainText(markdown).slice(0, 8_000) }) }
  return { claim, relations, sourceNodes, evidence: evidence.slice(0, 200), notes }
}

export async function mcpFindRelatedConcepts(libraryPath: string, conceptId: string) {
  if (!nodeIdPattern.test(conceptId)) throw new Error('Concept ID가 올바르지 않습니다.')
  const nodes = await listKnowledgeNodes(libraryPath); const concept = nodes.find((node) => node.id === conceptId)
  if (!concept || concept.nodeType !== 'concept') throw new Error('해당 ID의 Concept를 찾을 수 없습니다.')
  const relations = approvedRelations(await listKnowledgeRelationRecords(libraryPath)).filter((relation) => relation.sourceId === conceptId || relation.targetId === conceptId)
  const related = relations.map((relation) => ({ relation, node: nodes.find((node) => node.id === relationOther(relation, conceptId)), direction: relation.sourceId === conceptId ? 'outgoing' as const : 'incoming' as const })).filter((item): item is typeof item & { node: KnowledgeNodeRecord } => item.node?.nodeType === 'concept')
  const markdown = (await readKnowledgeNode(libraryPath, conceptId)).content
  const connectedIds = new Set(related.map((item) => item.node.id)); const candidates = (await searchResearchKnowledge(libraryPath, `${concept.title} ${knowledgePlainText(markdown).slice(0, 800)}`, 20))
    .filter((item) => item.node.nodeType === 'concept' && item.node.id !== conceptId && !connectedIds.has(item.node.id) && item.semanticScore >= .12).slice(0, 5)
  return { concept, related, semanticCandidates: candidates }
}

export async function mcpComparePapers(libraryPath: string, paperIds: string[]) {
  const unique = [...new Set(paperIds)]
  if (unique.length < 2 || unique.length > 8 || unique.some((id) => !nodeIdPattern.test(id))) throw new Error('비교할 Paper ID는 서로 다른 2개 이상 8개 이하여야 합니다.')
  const nodes = await listKnowledgeNodes(libraryPath); const papers = unique.map((id) => nodes.find((node) => node.id === id))
  if (papers.some((node) => node?.nodeType !== 'paper')) throw new Error('비교 목록에는 Paper 노트 ID만 사용할 수 있습니다.')
  const selected = papers as KnowledgeNodeRecord[]; const selectedIds = new Set(unique); const allRelations = approvedRelations(await listKnowledgeRelationRecords(libraryPath))
  const relations = allRelations.filter((relation) => selectedIds.has(relation.sourceId) || selectedIds.has(relation.targetId)).filter((relation) => { const other = nodes.find((node) => node.id === relationOther(relation, selectedIds.has(relation.sourceId) ? relation.sourceId : relation.targetId)); return other?.nodeType === 'claim' || other?.nodeType === 'concept' })
  const records = []
  for (const paper of selected) { const markdown = (await readKnowledgeNode(libraryPath, paper.id)).content; records.push({ paper, noteExcerpt: knowledgePlainText(markdown).slice(0, 8_000), evidence: embeddedEvidence(markdown, paper.id), relations: relations.filter((relation) => relation.sourceId === paper.id || relation.targetId === paper.id) }) }
  return { papers: records, linkedNodes: [...new Set(relations.flatMap((relation) => [relation.sourceId, relation.targetId]).filter((id) => !selectedIds.has(id)))].map((id) => nodes.find((node) => node.id === id)).filter(Boolean) }
}

export async function mcpOpenPaperAnchor(libraryPath: string, anchorId: string, paperId?: string) {
  if (!anchorId || anchorId.length > 300 || (paperId !== undefined && !paperIdPattern.test(paperId))) throw new Error('PDF 앵커 위치가 올바르지 않습니다.')
  const anchors = await listEvidenceAnchors(libraryPath, await evidencePapers(libraryPath)); const matches = anchors.filter((anchor) => anchor.anchorId === anchorId && (!paperId || anchor.paperId === paperId))
  if (matches.length !== 1) throw new Error(matches.length ? '같은 ID의 앵커가 여러 논문에 있습니다. paper_id를 함께 지정하세요.' : 'PDF 앵커를 찾을 수 없습니다.')
  const anchor = matches[0]; const request: OpenAnchorRequest = { version: 1, requestId: randomUUID(), requestedAt: new Date().toISOString(), paperId: anchor.paperId, anchorId: anchor.anchorId, type: anchor.type, page: anchor.page, label: anchor.label }
  const target = path.join(libraryPath, '.prism', 'cache', 'mcp-open-anchor.json'); await atomicJson(target, request)
  return { queued: true as const, anchor, requestPath: portableRelative(libraryPath, target) }
}

export async function readMcpOpenAnchorRequest(libraryPath: string): Promise<OpenAnchorRequest | undefined> {
  let value: unknown
  try { value = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'cache', 'mcp-open-anchor.json'), 'utf8')) } catch { return undefined }
  if (!value || typeof value !== 'object') return undefined
  const item = value as Partial<OpenAnchorRequest>
  if (item.version !== 1 || typeof item.requestId !== 'string' || typeof item.requestedAt !== 'string' || typeof item.paperId !== 'string' || !paperIdPattern.test(item.paperId)
    || typeof item.anchorId !== 'string' || item.anchorId.length > 300 || !['sentence', 'section', 'equation', 'table', 'figure', 'page'].includes(String(item.type)) || !Number.isInteger(item.page) || Number(item.page) < 1 || typeof item.label !== 'string') return undefined
  return item as OpenAnchorRequest
}

export async function mcpSuggestRelationships(libraryPath: string, nodeId: string) {
  if (!nodeIdPattern.test(nodeId)) throw new Error('지식 노트 ID가 올바르지 않습니다.')
  return { nodeId, suggestions: await suggestKnowledge(libraryPath, nodeId) }
}

export async function mcpCreateNoteDraft(libraryPath: string, templateId: string, rawTitle: string, variables: Record<string, string> = {}) {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(templateId)) throw new Error('템플릿 ID가 올바르지 않습니다.')
  const title = safeName(rawTitle); const template = (await listTemplates(libraryPath)).find((item) => item.id === templateId)
  if (!template) throw new Error('템플릿을 찾을 수 없습니다.')
  const values: Record<string, string> = { title, date: new Date().toISOString().slice(0, 10) }
  for (const [key, value] of Object.entries(variables)) { if (!templateVariables.has(key) || typeof value !== 'string' || value.length > 2_000) throw new Error('지원하지 않는 템플릿 변수이거나 값이 너무 깁니다.'); values[key] = value }
  const directory = path.join(libraryPath, draftFolders[template.nodeType]); await fs.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `${title}.md`); const names = await fs.readdir(directory)
  if (names.some((name) => name.toLocaleLowerCase() === `${title}.md`.toLocaleLowerCase())) throw new Error('같은 제목의 지식 노트가 이미 있습니다.')
  const id = `${template.nodeType}-${randomUUID().slice(0, 12)}`
  const body = template.content.replace(/\{\{([a-z_]+)\}\}/g, (token, key: string) => values[key] ?? token).replace(/^\s+/, '')
  const content = `---\ntype: ${template.nodeType}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: inbox\n${template.nodeType === 'paper' ? 'reading_status: to_read\n' : ''}importance: medium\nconfidence: low\ncreated_by: ai\ndraft: true\ntemplate_id: ${JSON.stringify(template.id)}\ntemplate_version: ${JSON.stringify(template.revision)}\ncreated_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n${body}`
  await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
  await markTemplateUsed(libraryPath, template.id).catch(() => undefined)
  const node = (await listKnowledgeNodes(libraryPath)).find((item) => item.id === id)
  if (!node) throw new Error('생성한 초안 노트를 다시 읽을 수 없습니다.')
  return { node, created: true as const }
}
