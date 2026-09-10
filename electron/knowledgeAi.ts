import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'
import { memosFor } from './capture.js'
import { createKnowledgeNode, knowledgePlainText, listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { createKnowledgeRelation, listKnowledgeRelationRecords, type KnowledgeRelationType, type RelationEvidenceAnchor } from './relations.js'
import { searchResearchKnowledge } from './researchSearch.js'
import { sampleResearchEvidence } from './researchEvidenceSample.js'
import { listEvidenceAnchors, type EvidencePaper } from './evidence.js'

/**
 * Model-assisted suggestions. The model only ever *points*: at existing nodes to relate, at memo lines the researcher
 * already wrote that read like claims or questions, and at concept names that recur. It never writes a claim statement.
 * Everything it returns lands as `pending`; the curation queue is where the researcher accepts or rejects.
 */
export type ModelSuggestionCandidate = { id: string; kind: 'claim' | 'question'; memo: string; blockId?: string; why: string; status: 'pending' | 'rejected' }
export type ModelConceptSuggestion = { id: string; title: string; reason: string; status: 'pending' | 'accepted' | 'rejected' }
/** A sentence the paper itself asserts, quoted from its own text. Accepting one makes a Claim with `claim_origin: paper`. */
export type ModelClaimSuggestion = { id: string; sentence: string; why: string; status: 'pending' | 'accepted' | 'rejected' }
export type ModelSuggestionRun = { version: 1; paperNodeId: string; provider: string; model: string; ranAt: string; relationsCreated: number; relationsSkipped: number; candidates: ModelSuggestionCandidate[]; concepts: ModelConceptSuggestion[]; claims?: ModelClaimSuggestion[] }
export type ModelSuggestionSummary = { paperNodeId: string; paperTitle: string; provider: string; model: string; ranAt: string; relationsCreated: number; relationsSkipped: number; candidates: number; concepts: number; claims: number }
export type ModelSuggestionReview = { paperNodeId: string; id: string; decision: 'accepted' | 'rejected' }
export type RunPrompt = (prompt: string) => Promise<string>

const allowedByTarget: Partial<Record<string, KnowledgeRelationType[]>> = { concept: ['defines', 'uses'], claim: ['supports', 'contradicts'], question: ['raises', 'answers'], paper: ['extends'] }
const directory = (libraryPath: string) => path.join(libraryPath, '.prism', 'suggestions')
const runPath = (libraryPath: string, paperNodeId: string) => path.join(directory(libraryPath), `${paperNodeId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
const suggestionId = (...parts: string[]) => `model-${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16)}`

function cardAnchors(content: string) {
  const anchors = new Map<string, RelationEvidenceAnchor & { source: string }>()
  for (const match of content.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->\r?\n\^(evidence-[a-zA-Z0-9_-]+)/g)) {
    try {
      const value = JSON.parse(decodeURIComponent(match[1])) as Partial<RelationEvidenceAnchor> & { source?: string }
      if (typeof value.paperId === 'string' && typeof value.anchorId === 'string' && typeof value.type === 'string' && Number.isInteger(value.page) && typeof value.label === 'string') anchors.set(match[2], { paperId: value.paperId, anchorId: value.anchorId, type: value.type, page: Number(value.page), label: value.label, source: typeof value.source === 'string' ? value.source : '' })
    } catch { /* ignore malformed metadata */ }
  }
  return anchors
}

/** Renders the paper note for the model: PDF quotes are labelled EVIDENCE, the researcher's words MEMO, and AI answers are left out entirely. */
export function renderNoteForModel(paper: KnowledgeNodeRecord, content: string, limit = 9_000) {
  const anchors = cardAnchors(content)
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/\r\n/g, '\n')
  const lines = body.split('\n'); const out: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^> \[!ai\]/.test(line)) { while (index + 1 < lines.length && (lines[index + 1].startsWith('>') || lines[index + 1].startsWith('<!--'))) index += 1; continue }
    if (/^> \[!evidence\]/.test(line)) {
      let cursor = index + 1; while (cursor < lines.length && !/^\^evidence-/.test(lines[cursor])) cursor += 1
      const blockId = lines[cursor]?.replace(/^\^/, '').trim(); const anchor = blockId ? anchors.get(blockId) : undefined
      out.push(`EVIDENCE[${blockId ?? '?'}] ${anchor ? `${anchor.label} p.${anchor.page}: ${anchor.source.slice(0, 500)}` : line.slice(0, 200)}`)
      index = cursor; continue
    }
    if (/^> \[!abstract\]/.test(line) || line.startsWith('<!--') || /^\^/.test(line)) continue
    if (/^#{1,6}\s/.test(line)) { out.push(`SECTION: ${line.replace(/^#+\s*/, '')}`); continue }
    if (line.startsWith('>')) { out.push(`QUOTE: ${line.replace(/^>\s?/, '')}`); continue }
    if (line.trim()) out.push(`MEMO: ${line.trim()}`)
  }
  return out.join('\n').slice(0, limit)
}

export function buildSuggestionPrompt(paper: KnowledgeNodeRecord, rendered: string, nodes: KnowledgeNodeRecord[], existing: Array<{ type: string; targetId: string }>, memos: string[], body: string[] = []) {
  const describe = (node: KnowledgeNodeRecord) => {
    const scope = node.nodeType === 'claim' ? [node.claimOrigin === 'mine' ? 'origin:mine' : 'origin:paper', node.scopeDomain ? `domain:${node.scopeDomain}` : '', node.scopeRegime ? `regime:${node.scopeRegime}` : ''].filter(Boolean).join(' ') : ''
    return `- ${node.id} | ${node.nodeType} | ${node.title}${scope ? ` | ${scope}` : ''}${node.preview ? ` | ${node.preview.slice(0, 120)}` : ''}`
  }
  return [
    'You help a researcher maintain a personal research knowledge graph stored as Markdown. You never write claims or notes for the researcher; you only point at what already exists.',
    '',
    `PAPER: ${paper.id} | ${paper.title}`,
    'PAPER NOTE (EVIDENCE = quoted from the PDF; MEMO = the researcher\'s own words):',
    rendered,
    '',
    'EXISTING NODES (only these ids may be referenced):',
    ...nodes.map(describe),
    '',
    'RELATIONS ALREADY RECORDED FROM THIS PAPER (do not repeat):',
    ...(existing.length ? existing.map((relation) => `- ${relation.type} -> ${relation.targetId}`) : ['- none']),
    '',
    'MEMO LINES (candidates must quote one of these verbatim):',
    ...(memos.length ? memos.map((memo) => `- ${memo}`) : ['- none']),
    '',
    'THE PAPER ITSELF (claims must quote an original source from the BOUNDED PDF SAMPLE verbatim, or one of these additional lines):',
    ...(body.length ? body.map((line) => `- ${line}`) : ['- none']),
    '',
    'Return ONLY a JSON object with this shape and nothing else:',
    'For supports and contradicts, evidenceBlockId is REQUIRED and must be an exact EVIDENCE block id supplied above. Without a supplied direct PDF quotation, omit the relation. Never invent an id. A citation alone does not establish support or contradiction; compare the claim scope and the quoted result. All suggestions still require researcher review.',
    '{"relations":[{"type":"defines|uses|supports|contradicts|extends|raises|answers","targetId":"<existing id>","reason":"<under 30 words>","evidenceBlockId":"<EVIDENCE block id or null>"}],',
    ' "candidates":[{"kind":"claim|question","memo":"<one MEMO line, verbatim>","why":"<under 20 words>"}],',
    ' "newConcepts":[{"title":"<concept name>","reason":"<under 20 words>"}],',
    ' "claims":[{"sentence":"<one line from THE PAPER ITSELF, verbatim>","why":"<under 20 words>"}]}',
    'Rules: allowed relation types by target type: concept -> defines or uses (defines only if this paper introduces or formally defines it); claim -> supports or contradicts (contradicts only when the scope actually overlaps); question -> raises or answers; paper -> extends (a real conceptual extension, not a mere citation). Prefer few, well-grounded relations over many. Candidates: only MEMO lines that read like a testable claim or an open research question; never paraphrase. newConcepts: at most 5 names that recur in the note but have no existing node; skip near-duplicates of existing concepts. claims: at most 3 lines where the paper asserts something that could be argued with — its own findings, not its description of prior work, and not a restatement of its topic. Reasons may be in Korean.',
  ].join('\n')
}

export function parseSuggestionResponse(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{'); const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('모델 응답에서 JSON을 찾지 못했습니다.')
  const value = JSON.parse(body.slice(start, end + 1)) as { relations?: unknown; candidates?: unknown; newConcepts?: unknown; claims?: unknown }
  const relations = Array.isArray(value.relations) ? value.relations.filter((item): item is { type: string; targetId: string; reason?: string; evidenceBlockId?: string | null } => Boolean(item) && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string' && typeof (item as { targetId?: unknown }).targetId === 'string') : []
  const candidates = Array.isArray(value.candidates) ? value.candidates.filter((item): item is { kind: string; memo: string; why?: string } => Boolean(item) && typeof item === 'object' && typeof (item as { memo?: unknown }).memo === 'string' && ((item as { kind?: unknown }).kind === 'claim' || (item as { kind?: unknown }).kind === 'question')) : []
  const newConcepts = Array.isArray(value.newConcepts) ? value.newConcepts.filter((item): item is { title: string; reason?: string } => Boolean(item) && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string') : []
  const claims = Array.isArray(value.claims) ? value.claims.filter((item): item is { sentence: string; why?: string } => Boolean(item) && typeof item === 'object' && typeof (item as { sentence?: unknown }).sentence === 'string') : []
  return { relations, candidates, newConcepts, claims }
}

export async function runModelSuggestions(libraryPath: string, paperNodeId: string, provider: string, model: string, runPrompt: RunPrompt): Promise<ModelSuggestionSummary> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const paper = nodes.find((node) => node.id === paperNodeId && node.nodeType === 'paper')
  if (!paper) throw new Error('Paper 노트를 찾을 수 없습니다.')
  const content = (await readKnowledgeNode(libraryPath, paper.id)).content
  const renderedNote = renderNoteForModel(paper, content)
  const library = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'library.json'), 'utf8')) as EvidencePaper[]
  const realAnchors = await listEvidenceAnchors(libraryPath, library)
  const sample = sampleResearchEvidence(realAnchors.filter(anchor => anchor.paperId === paper.arxivId), content)
  const rendered = `${renderedNote}\n\nBOUNDED PDF SAMPLE (original prose across pages; not a full-paper read; omitted material may change interpretation):\n${sample.map(item => item.line).join('\n')}`
  const memos = memosFor(paper, content)
  const others = nodes.filter((node) => node.id !== paper.id && node.nodeType !== 'project' && node.nodeType !== 'insight')
  let candidatesForPrompt = others
  if (others.length > 80) {
    const ranked = await searchResearchKnowledge(libraryPath, knowledgePlainText(content).slice(0, 1_500) || paper.title, 60).catch(() => [])
    const rankedIds = new Set(ranked.map((result) => result.node.id))
    candidatesForPrompt = [...others.filter((node) => rankedIds.has(node.id)), ...others.filter((node) => !rankedIds.has(node.id) && node.nodeType === 'concept')].slice(0, 80)
  }
  const existing = (await listKnowledgeRelationRecords(libraryPath)).filter((relation) => relation.sourceId === paper.id && relation.reviewStatus !== 'rejected')
  // The paper's own sentences, so a claim it makes can be quoted rather than invented.
  const body = sample.map(item => item.anchor.source)
  const prompt = buildSuggestionPrompt(paper, rendered, candidatesForPrompt, existing.map((relation) => ({ type: relation.type, targetId: relation.targetId })), memos.map((memo) => memo.memo.split('\n')[0]))
  const parsed = parseSuggestionResponse(await runPrompt(prompt))

  const byId = new Map(candidatesForPrompt.map((node) => [node.id, node]))
  const cards = cardAnchors(content)
  const anchors = new Map<string, RelationEvidenceAnchor & { source: string }>()
  for (const item of sample) anchors.set(item.id, item.anchor)
  // A card in the note is insufficient: its entire quotation must have been sent, and its
  // identity, location and source must still match the actual PDF anchor registry.
  const suppliedLines = new Set(rendered.split('\n'))
  for (const [blockId, card] of cards) {
    const supplied = `EVIDENCE[${blockId}] ${card.label} p.${card.page}: ${card.source.slice(0, 500)}`
    if (!suppliedLines.has(supplied) || !card.source.trim()) continue
    if (realAnchors.some(anchor => anchor.paperId === card.paperId && anchor.anchorId === card.anchorId && anchor.page === card.page && anchor.type === card.type && anchor.source === card.source)) anchors.set(blockId, card)
  }
  let relationsCreated = 0; let relationsSkipped = 0
  for (const item of parsed.relations.slice(0, 40)) {
    const target = byId.get(item.targetId)
    const allowed = target ? allowedByTarget[target.nodeType] ?? [] : []
    if (!target || target.id === paper.id || !allowed.includes(item.type as KnowledgeRelationType)) { relationsSkipped += 1; continue }
    const anchorEntry = typeof item.evidenceBlockId === 'string' ? anchors.get(item.evidenceBlockId) : undefined
    if ((['supports', 'contradicts', 'evidence_for'].includes(item.type) || item.evidenceBlockId != null) && !anchorEntry) { relationsSkipped += 1; continue }
    const evidenceAnchor = anchorEntry ? { paperId: anchorEntry.paperId, anchorId: anchorEntry.anchorId, type: anchorEntry.type, page: anchorEntry.page, label: anchorEntry.label } : undefined
    try {
      const snapshot = await readKnowledgeNode(libraryPath, paper.id)
      await createKnowledgeRelation(libraryPath, { sourceId: paper.id, targetId: target.id, type: item.type as KnowledgeRelationType, creator: 'ai', evidenceAnchor, expectedRevision: snapshot.revision })
      relationsCreated += 1
    } catch { relationsSkipped += 1 }
  }
  const memoLines = new Map(memos.map((memo) => [memo.memo.split('\n')[0].trim(), memo]))
  const candidates: ModelSuggestionCandidate[] = []
  for (const item of parsed.candidates.slice(0, 20)) {
    const quoted = item.memo.trim()
    const memo = memoLines.get(quoted) ?? [...memoLines.values()].find((entry) => entry.memo.includes(quoted) && quoted.length >= 12)
    if (!memo) continue
    const id = suggestionId(paper.id, memo.blockId, memo.memo, item.kind)
    if (candidates.some((candidate) => candidate.id === id)) continue
    candidates.push({ id, kind: item.kind as 'claim' | 'question', memo: memo.memo, blockId: memo.blockId, why: String(item.why ?? '').slice(0, 300), status: 'pending' })
  }
  const existingTitles = new Set(nodes.map((node) => node.title.toLocaleLowerCase()))
  const concepts: ModelConceptSuggestion[] = []
  for (const item of parsed.newConcepts.slice(0, 5)) {
    const title = item.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!title || existingTitles.has(title.toLocaleLowerCase()) || concepts.some((concept) => concept.title.toLocaleLowerCase() === title.toLocaleLowerCase())) continue
    concepts.push({ id: suggestionId(paper.id, 'concept', title.toLocaleLowerCase()), title, reason: String(item.reason ?? '').slice(0, 300), status: 'pending' })
  }
  // A claim has to be the paper's own words, so it is kept only if it quotes a line we actually sent.
  const bodyLines = new Set(body.map((line) => line.trim()))
  const claims: ModelClaimSuggestion[] = []
  for (const item of parsed.claims.slice(0, 3)) {
    const sentence = item.sentence.replace(/^\[[^\]]*\]\s*/, '').trim()
    if (!bodyLines.has(sentence)) continue
    const id = suggestionId(paper.id, 'claim', sentence)
    if (claims.some((claim) => claim.id === id)) continue
    claims.push({ id, sentence, why: String(item.why ?? '').slice(0, 300), status: 'pending' })
  }

  // Keep earlier rejections so a re-run does not resurface what the researcher already dismissed.
  const previous = await readRun(libraryPath, paper.id)
  const rejectedIds = new Set([...(previous?.candidates ?? []), ...(previous?.concepts ?? []), ...(previous?.claims ?? [])].filter((item) => item.status === 'rejected').map((item) => item.id))
  const run: ModelSuggestionRun = {
    version: 1, paperNodeId: paper.id, provider, model, ranAt: new Date().toISOString(), relationsCreated, relationsSkipped,
    candidates: candidates.map((candidate) => rejectedIds.has(candidate.id) ? { ...candidate, status: 'rejected' as const } : candidate),
    concepts: concepts.map((concept) => rejectedIds.has(concept.id) ? { ...concept, status: 'rejected' as const } : concept),
    claims: claims.map((claim) => rejectedIds.has(claim.id) ? { ...claim, status: 'rejected' as const } : claim),
  }
  await fs.mkdir(directory(libraryPath), { recursive: true })
  await atomicWriteFile(runPath(libraryPath, paper.id), JSON.stringify(run, null, 2))
  return summarize(run, paper.title)
}

function summarize(run: ModelSuggestionRun, paperTitle: string): ModelSuggestionSummary {
  return { paperNodeId: run.paperNodeId, paperTitle, provider: run.provider, model: run.model, ranAt: run.ranAt, relationsCreated: run.relationsCreated, relationsSkipped: run.relationsSkipped, candidates: run.candidates.filter((item) => item.status === 'pending').length, concepts: run.concepts.filter((item) => item.status === 'pending').length, claims: (run.claims ?? []).filter((item) => item.status === 'pending').length }
}
async function readRun(libraryPath: string, paperNodeId: string): Promise<ModelSuggestionRun | undefined> {
  try { const value = JSON.parse(await fs.readFile(runPath(libraryPath, paperNodeId), 'utf8')) as ModelSuggestionRun; return value?.version === 1 && Array.isArray(value.candidates) && Array.isArray(value.concepts) ? value : undefined } catch { return undefined }
}
export async function listModelSuggestionRuns(libraryPath: string): Promise<ModelSuggestionRun[]> {
  let names: string[]
  try { names = (await fs.readdir(directory(libraryPath))).filter((name) => name.endsWith('.json')) } catch { return [] }
  const runs: ModelSuggestionRun[] = []
  for (const name of names) { try { const value = JSON.parse(await fs.readFile(path.join(directory(libraryPath), name), 'utf8')) as ModelSuggestionRun; if (value?.version === 1 && Array.isArray(value.candidates) && Array.isArray(value.concepts)) runs.push(value) } catch { /* skip malformed run files */ } }
  return runs.sort((left, right) => right.ranAt.localeCompare(left.ranAt))
}
export async function reviewModelSuggestion(libraryPath: string, request: ModelSuggestionReview) {
  const run = await readRun(libraryPath, request.paperNodeId)
  if (!run) throw new Error('모델 제안 기록을 찾을 수 없습니다.')
  const candidate = run.candidates.find((item) => item.id === request.id)
  const concept = run.concepts.find((item) => item.id === request.id)
  const claim = (run.claims ?? []).find((item) => item.id === request.id)
  if (!candidate && !concept && !claim) throw new Error('해당 제안을 찾을 수 없습니다.')
  if (candidate) {
    if (request.decision === 'accepted') throw new Error('필기 후보는 정리 대기열에서 직접 승격하세요. 문장은 사용자가 씁니다.')
    candidate.status = 'rejected'
  }
  if (concept && concept.status === 'pending') {
    if (request.decision === 'accepted') {
      await createKnowledgeNode(libraryPath, { title: concept.title, nodeType: 'concept', status: 'inbox' })
      concept.status = 'accepted'
    } else concept.status = 'rejected'
  }
  if (claim && claim.status === 'pending') {
    if (request.decision === 'accepted') {
      // The paper's claim, in the paper's words, with a link back to where it says so. It is not the
      // researcher's reading of anything, so it is `claim_origin: paper` and carries no judgement.
      const paper = (await listKnowledgeNodes(libraryPath)).find((node) => node.id === run.paperNodeId)
      if (!paper) throw new Error('논문 노트를 찾을 수 없습니다.')
      const title = claim.sentence.slice(0, 120)
      await createKnowledgeNode(libraryPath, { title, nodeType: 'claim', body: `# {{title}}\n\n${claim.sentence}\n\n> [!note] 출처 논문\n> [[${paper.relativePath.replace(/\.md$/i, '')}|${paper.title}]]\n` })
      claim.status = 'accepted'
    } else claim.status = 'rejected'
  }
  await atomicWriteFile(runPath(libraryPath, request.paperNodeId), JSON.stringify(run, null, 2))
  return run
}
