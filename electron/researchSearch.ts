import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { knowledgePlainText, listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { listKnowledgeRelationRecords, type KnowledgeRelationRecord } from './relations.js'

const indexVersion = 1
const vectorSize = 384
const indexRelativePath = '.prism/index/research-search-v1.json'

type IndexEntry = { nodeId: string; revision: string; title: string; relativePath: string; plain: string; terms: Record<string, number>; vector: number[] }
type ResearchIndex = { version: 1; signature: string; generatedAt: string; idf: Record<string, number>; entries: IndexEntry[] }
export type ResearchSearchResult = { node: KnowledgeNodeRecord; excerpt: string; score: number; textScore: number; semanticScore: number }
export type ResearchEvidence = { nodeId: string; paperId: string; anchorId: string; type: 'sentence' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string; paperTitle: string; source: string }
export type ResearchContext = { query: string; seeds: ResearchSearchResult[]; nodes: KnowledgeNodeRecord[]; relations: KnowledgeRelationRecord[]; evidence: ResearchEvidence[] }
export type ResearchIndexStatus = { nodeCount: number; signature: string; rebuilt: boolean; relativePath: typeof indexRelativePath }

function indexPath(libraryPath: string) { return path.join(libraryPath, ...indexRelativePath.split('/')) }
function signature(nodes: KnowledgeNodeRecord[]) { return createHash('sha256').update(nodes.map((node) => `${node.id}:${node.revision}`).sort().join('\n')).digest('hex') }
function normalized(value: string) { return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim() }
function features(value: string) {
  const result: string[] = []
  for (const word of normalized(value).match(/[\p{L}\p{N}]+/gu) ?? []) {
    result.push(`w:${word}`)
    if (/^[가-힣]+$/.test(word)) {
      for (const suffix of ['으로', '에서', '에게', '까지', '부터', '보다', '처럼', '하고', '이며', '이다', '한다', '되는', '하는', '를', '을', '은', '는', '이', '가', '의', '에', '도', '와', '과', '해']) {
        if (word.length > suffix.length + 1 && word.endsWith(suffix)) { result.push(`w:${word.slice(0, -suffix.length)}`); break }
      }
    }
    if (/^[a-z][a-z0-9]+$/.test(word)) {
      for (const suffix of ['ing', 'ed', 'es', 's']) if (word.length > suffix.length + 3 && word.endsWith(suffix)) { result.push(`w:${word.slice(0, -suffix.length)}`); break }
    }
    const characters = [...word]
    if (characters.length >= 2) for (let index = 0; index < characters.length - 1; index += 1) result.push(`c2:${characters[index]}${characters[index + 1]}`)
    if (characters.length >= 3) for (let index = 0; index < characters.length - 2; index += 1) result.push(`c3:${characters[index]}${characters[index + 1]}${characters[index + 2]}`)
  }
  return result
}
function termCounts(value: string) { const counts: Record<string, number> = {}; for (const feature of features(value)) counts[feature] = (counts[feature] ?? 0) + 1; return counts }
function featureHash(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) } return hash >>> 0 }
function vector(terms: Record<string, number>, idf: Record<string, number>) {
  const result = Array<number>(vectorSize).fill(0)
  for (const [term, count] of Object.entries(terms)) {
    const hash = featureHash(term); const weight = (1 + Math.log(count)) * (idf[term] ?? 1)
    result[hash % vectorSize] += (hash & 0x80000000) === 0 ? weight : -weight
  }
  const magnitude = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0))
  return magnitude ? result.map((value) => value / magnitude) : result
}
async function atomicJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${randomUUID()}.tmp`
  try { await fs.writeFile(temporary, JSON.stringify(value), 'utf8'); await fs.rename(temporary, filePath) }
  catch (reason) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw reason }
}
function validIndex(value: unknown, expectedSignature: string): value is ResearchIndex {
  if (!value || typeof value !== 'object') return false
  const index = value as Partial<ResearchIndex>
  return index.version === indexVersion && index.signature === expectedSignature && Boolean(index.idf) && typeof index.idf === 'object' && !Array.isArray(index.idf)
    && Object.values(index.idf).every((weight) => typeof weight === 'number' && Number.isFinite(weight)) && Array.isArray(index.entries)
    && index.entries.every((entry) => typeof entry?.nodeId === 'string' && typeof entry.revision === 'string' && typeof entry.title === 'string' && typeof entry.relativePath === 'string'
      && typeof entry.plain === 'string' && Boolean(entry.terms) && typeof entry.terms === 'object' && !Array.isArray(entry.terms)
      && Object.values(entry.terms).every((count) => typeof count === 'number' && Number.isFinite(count) && count > 0)
      && Array.isArray(entry.vector) && entry.vector.length === vectorSize && entry.vector.every((component) => typeof component === 'number' && Number.isFinite(component)))
}
async function buildIndex(libraryPath: string, nodes: KnowledgeNodeRecord[]) {
  const drafts: Array<Omit<IndexEntry, 'vector'>> = []
  const documentFrequency: Record<string, number> = {}
  for (const node of nodes) {
    const snapshot = await readKnowledgeNode(libraryPath, node.id)
    const plain = knowledgePlainText(snapshot.content); const terms = termCounts(`${node.title} ${node.title} ${node.title} ${node.nodeType} ${node.relativePath} ${plain}`)
    for (const term of Object.keys(terms)) documentFrequency[term] = (documentFrequency[term] ?? 0) + 1
    drafts.push({ nodeId: node.id, revision: node.revision, title: node.title, relativePath: node.relativePath, plain, terms })
  }
  const idf = Object.fromEntries(Object.entries(documentFrequency).map(([term, frequency]) => [term, Math.log((nodes.length + 1) / (frequency + 1)) + 1]))
  const index: ResearchIndex = { version: indexVersion, signature: signature(nodes), generatedAt: new Date().toISOString(), idf, entries: drafts.map((entry) => ({ ...entry, vector: vector(entry.terms, idf) })) }
  await atomicJson(indexPath(libraryPath), index)
  return index
}
async function currentIndex(libraryPath: string, force = false) {
  const nodes = await listKnowledgeNodes(libraryPath); const expectedSignature = signature(nodes)
  if (!force) try { const value = JSON.parse(await fs.readFile(indexPath(libraryPath), 'utf8')); if (validIndex(value, expectedSignature)) return { index: value, nodes, rebuilt: false } } catch { /* Rebuild missing or malformed derived data. */ }
  return { index: await buildIndex(libraryPath, nodes), nodes, rebuilt: true }
}
function excerpt(plain: string, query: string) {
  const body = normalized(plain); const phrase = normalized(query); let match = body.indexOf(phrase)
  if (match < 0) for (const word of phrase.split(' ').sort((left, right) => right.length - left.length)) { match = body.indexOf(word); if (match >= 0) break }
  const start = match < 0 ? 0 : Math.max(0, match - 70); const end = match < 0 ? Math.min(plain.length, 190) : Math.min(plain.length, match + phrase.length + 120)
  return `${start ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}

export async function searchResearchKnowledge(libraryPath: string, input: string, limit = 30): Promise<ResearchSearchResult[]> {
  const query = input.trim(); if (!query || query.length > 200) throw new Error('검색어는 1자 이상 200자 이하로 입력해 주세요.')
  const { index, nodes } = await currentIndex(libraryPath); const byId = new Map(nodes.map((node) => [node.id, node])); const queryTerms = termCounts(query); const queryWords = Object.keys(queryTerms).filter((term) => term.startsWith('w:')); const queryVector = vector(queryTerms, index.idf); const phrase = normalized(query)
  const results: ResearchSearchResult[] = []
  for (const entry of index.entries) {
    const node = byId.get(entry.nodeId); if (!node) continue
    const title = normalized(entry.title); const body = normalized(entry.plain); let textScore = title === phrase ? 1000 : title.startsWith(phrase) ? 620 : title.includes(phrase) ? 380 : body.includes(phrase) ? 180 : 0
    for (const [term, count] of Object.entries(queryTerms)) if (entry.terms[term]) textScore += Math.min(entry.terms[term], 6) * Math.min(count, 3) * (index.idf[term] ?? 1) * (term.startsWith('w:') ? 16 : 2)
    if (queryWords.length) { const coverage = queryWords.filter((term) => entry.terms[term]).length / queryWords.length; textScore += coverage * 80 + (coverage === 1 ? 140 : 0) }
    const semanticScore = Math.max(0, entry.vector.reduce((sum, value, indexValue) => sum + value * queryVector[indexValue], 0))
    const score = textScore + semanticScore * 220
    if (textScore > 0 || semanticScore >= .04) results.push({ node, excerpt: excerpt(entry.plain, query), score, textScore, semanticScore })
  }
  return results.sort((left, right) => right.score - left.score || right.node.modifiedAt - left.node.modifiedAt).slice(0, Math.max(1, Math.min(limit, 100)))
}

function evidenceFrom(markdown: string, nodeId: string) {
  const result: ResearchEvidence[] = []
  for (const match of markdown.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->/g)) try {
    const item = JSON.parse(decodeURIComponent(match[1])) as Partial<ResearchEvidence>
    if (typeof item.paperId === 'string' && typeof item.anchorId === 'string' && ['sentence', 'equation', 'table', 'figure', 'page'].includes(String(item.type)) && Number.isInteger(item.page) && typeof item.label === 'string' && typeof item.paperTitle === 'string' && typeof item.source === 'string') result.push({ nodeId, paperId: item.paperId, anchorId: item.anchorId, type: item.type!, page: item.page!, label: item.label, paperTitle: item.paperTitle, source: item.source })
  } catch { /* Malformed generated metadata remains source Markdown but is not trusted as evidence. */ }
  return result
}

export async function retrieveResearchContext(libraryPath: string, input: string): Promise<ResearchContext> {
  const seeds = await searchResearchKnowledge(libraryPath, input, 5); const allNodes = await listKnowledgeNodes(libraryPath); const byId = new Map(allNodes.map((node) => [node.id, node])); const approved = (await listKnowledgeRelationRecords(libraryPath)).filter((relation) => relation.reviewStatus === 'approved')
  const selected = new Set(seeds.map((seed) => seed.node.id)); let frontier = [...selected]; const traversed = new Map<string, KnowledgeRelationRecord>()
  for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
    const next: string[] = []
    for (const relation of approved) if (frontier.includes(relation.sourceId) || frontier.includes(relation.targetId)) {
      const other = frontier.includes(relation.sourceId) ? relation.targetId : relation.sourceId
      traversed.set(relation.id, relation); if (byId.has(other) && !selected.has(other)) { selected.add(other); next.push(other) }
    }
    frontier = next
  }
  const nodes = [...selected].map((id) => byId.get(id)).filter((node): node is KnowledgeNodeRecord => Boolean(node))
  const evidence: ResearchEvidence[] = []
  for (const node of nodes) evidence.push(...evidenceFrom((await readKnowledgeNode(libraryPath, node.id)).content, node.id))
  return { query: input.trim(), seeds, nodes, relations: [...traversed.values()], evidence }
}

export async function rebuildResearchIndex(libraryPath: string): Promise<ResearchIndexStatus> {
  const result = await currentIndex(libraryPath, true)
  return { nodeCount: result.nodes.length, signature: result.index.signature, rebuilt: true, relativePath: indexRelativePath }
}
