import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readNoteSnapshot, saveNoteSnapshot, type NoteSnapshot } from './notes.js'
import { listEvidenceAnchors, type EvidenceAnchor, type EvidencePaper } from './evidence.js'
import { createKnowledgeNode, listKnowledgeNodes, paperNodeId, readKnowledgeNode, saveKnowledgeNode, updateKnowledgeProperties, type KnowledgeNodeRecord } from './knowledge.js'
import { createKnowledgeRelation, listKnowledgeRelationRecords } from './relations.js'

/**
 * Reading-time capture: the Reader and the chat append into the Paper note's `## Notes` section
 * without opening the Notes window. Everything lands as ordinary Markdown so Obsidian sees it too.
 */
export type CapturePaper = EvidencePaper & { notePath: string }
export type PaperCaptureRequest =
  | { kind: 'evidence'; paperId: string; anchorId: string; memo?: string; concept?: string }
  | { kind: 'chat'; paperId: string; question: string; answer: string; provider: string; model: string; anchors?: Array<{ paperId: string; anchorId: string; label: string; page?: number }> }
export type PaperCaptureResult = { saved: true; snapshot: NoteSnapshot; blockId?: string; concept?: string }

const typeLabels: Record<EvidenceAnchor['type'], string> = { sentence: '문장', section: '섹션', equation: '수식', table: '표', figure: '피겨', page: '페이지' }

function blockIdFor(anchor: Pick<EvidenceAnchor, 'paperId' | 'anchorId'>) {
  const value = `${anchor.paperId}-${anchor.anchorId}`.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 90)
  return `evidence-${value || 'anchor'}`
}

/** Same card format the Notes editor inserts, so the renderer's evidence parser and backlinks treat both alike. */
export function evidenceCardMarkdown(anchor: EvidenceAnchor) {
  const blockId = blockIdFor(anchor)
  const embedded = { paperId: anchor.paperId, paperTitle: anchor.paperTitle, anchorId: anchor.anchorId, type: anchor.type, page: anchor.page, label: anchor.label, source: anchor.source, sourceHash: anchor.sourceHash, blockId }
  const metadata = encodeURIComponent(JSON.stringify(embedded))
  const source = anchor.source.replace(/\r?\n/g, '\n').split('\n').map((line) => `> ${line || ' '}`).join('\n')
  const target = `prism://paper/${encodeURIComponent(anchor.paperId)}?anchor=${encodeURIComponent(anchor.anchorId)}&page=${anchor.page}`
  return { blockId, markdown: `> [!evidence] ${typeLabels[anchor.type]} · ${anchor.paperTitle} · p.${anchor.page} · ${anchor.label}\n${source}\n> [PDF 원문 열기](${target})\n<!-- prism-evidence:${metadata} -->\n^${blockId}` }
}

/** Appends a block at the end of the `## Notes` section (created when missing), before the next top-level heading. */
export function appendToNotesSection(content: string, block: string) {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const start = lines.findIndex((line) => /^##\s+(notes|필기|메모)\s*$/i.test(line))
  if (start < 0) return `${normalized.trimEnd()}\n\n## Notes\n\n${block}\n`
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) if (/^#{1,2}\s/.test(lines[index])) { end = index; break }
  const before = lines.slice(0, end).join('\n').trimEnd()
  const after = lines.slice(end).join('\n').replace(/^\n+/, '')
  return `${before}\n\n${block}\n${after ? `\n${after}` : ''}`
}

/** Appends one row to the Concept's "정의 비교" table: which paper, how it defines the concept, and the researcher's note with a PDF link. */
export async function addConceptDefinition(libraryPath: string, concept: KnowledgeNodeRecord, paper: KnowledgeNodeRecord, anchor: EvidenceAnchor, memo: string) {
  const snapshot = await readKnowledgeNode(libraryPath, concept.id)
  const cell = (value: string) => value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
  const link = `[PDF p.${anchor.page}](prism://paper/${encodeURIComponent(anchor.paperId)}?anchor=${encodeURIComponent(anchor.anchorId)}&page=${anchor.page})`
  const row = `| [[${paper.relativePath.replace(/\.md$/i, '')}\\|${cell(paper.title)}]] | ${cell(anchor.source).slice(0, 400)} | ${memo ? `${cell(memo)} ` : ''}${link} |`
  const lines = snapshot.content.replace(/\r\n/g, '\n').split('\n')
  const heading = lines.findIndex((line) => /^##\s+정의 비교\s*$/.test(line))
  let content: string
  if (heading < 0) content = `${snapshot.content.trimEnd()}\n\n## 정의 비교\n\n| 논문 | 이 논문의 정의 | 차이점 |\n| --- | --- | --- |\n${row}\n`
  else {
    let cursor = heading + 1
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1
    if (!lines[cursor]?.startsWith('|')) { lines.splice(heading + 1, 0, '', '| 논문 | 이 논문의 정의 | 차이점 |', '| --- | --- | --- |', row); content = lines.join('\n') }
    else {
      let last = cursor
      while (last + 1 < lines.length && lines[last + 1].startsWith('|')) last += 1
      const placeholder = lines.slice(cursor, last + 1).findIndex((line, index) => index >= 2 && line.replace(/[|\s]/g, '') === '')
      if (placeholder >= 0) lines[cursor + placeholder] = row; else lines.splice(last + 1, 0, row)
      content = lines.join('\n')
    }
  }
  const saved = await saveKnowledgeNode(libraryPath, concept.id, { content, expectedRevision: snapshot.revision })
  if (!saved.saved) throw new Error('Concept 노트가 외부에서 변경되어 정의 행을 추가하지 못했습니다.')
}

export async function captureToPaperNote(libraryPath: string, paper: CapturePaper, request: PaperCaptureRequest): Promise<PaperCaptureResult> {
  const snapshot = await readNoteSnapshot(paper.notePath)
  let content = snapshot.content
  let blockId: string | undefined
  let capturedAnchor: EvidenceAnchor | undefined
  if (request.kind === 'evidence') {
    const anchor = (await listEvidenceAnchors(libraryPath, [paper])).find((item) => item.anchorId === request.anchorId)
    if (!anchor) throw new Error('이 논문에서 해당 PDF 앵커를 찾을 수 없습니다. Reader에서 논문을 다시 열면 앵커가 생성됩니다.')
    capturedAnchor = anchor
    const card = evidenceCardMarkdown(anchor)
    blockId = card.blockId
    const memo = (request.memo ?? '').trim()
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const existing = lines.findIndex((line) => line.trim() === `^${card.blockId}`)
    if (existing >= 0) {
      // The card is already in the note: only add the new memo under it.
      if (memo) { lines.splice(existing + 1, 0, '', memo); content = lines.join('\n') }
    } else content = appendToNotesSection(content, memo ? `${card.markdown}\n\n${memo}` : card.markdown)
  } else {
    const capturedAt = new Date().toISOString()
    const question = request.question.replace(/\s+/g, ' ').trim().slice(0, 300)
    const answer = request.answer.replace(/\r\n/g, '\n').trim().split('\n').map((line) => line ? `> ${line}` : '>').join('\n')
    const references = (request.anchors ?? []).map((anchor) => `${anchor.label}${anchor.page ? ` (p.${anchor.page})` : ''}`).join(', ')
    const metadata = encodeURIComponent(JSON.stringify({ provider: request.provider, model: request.model, capturedAt }))
    const block = `> [!ai]- AI 답변 · ${capturedAt.slice(0, 10)} · ${request.provider}/${request.model}\n> **Q:** ${question || '(질문 없음)'}\n>\n${answer}${references ? `\n>\n> 참조: ${references}` : ''}\n<!-- prism-ai-answer:${metadata} -->`
    content = appendToNotesSection(content, block)
  }
  const result = await saveNoteSnapshot(paper.notePath, { content, expectedRevision: snapshot.revision })
  if (!result.saved) throw new Error('노트가 방금 외부에서 변경되었습니다. 다시 시도해 주세요.')
  const conceptTitle = request.kind === 'evidence' ? request.concept?.trim() : undefined
  if (!conceptTitle || !capturedAnchor) return { saved: true, snapshot: result.snapshot, blockId }
  // The sentence defines a concept: record it in the concept's comparison table and as an approved `defines` relation.
  let nodes = await listKnowledgeNodes(libraryPath)
  let concept = nodes.find((node) => node.nodeType === 'concept' && node.title.toLocaleLowerCase() === conceptTitle.toLocaleLowerCase())
  if (!concept) { const created = await createKnowledgeNode(libraryPath, { title: conceptTitle, nodeType: 'concept' }); nodes = created.nodes; concept = nodes.find((node) => node.id === created.id) }
  const paperNode = nodes.find((node) => node.id === paperNodeId(paper.arxivId))
  if (!concept || !paperNode) throw new Error('개념 정의를 연결할 노트를 찾을 수 없습니다.')
  await addConceptDefinition(libraryPath, concept, paperNode, capturedAnchor, (request.kind === 'evidence' ? request.memo ?? '' : '').trim())
  const relations = await listKnowledgeRelationRecords(libraryPath)
  if (!relations.some((relation) => relation.sourceId === paperNode.id && relation.targetId === concept!.id && relation.type === 'defines' && relation.reviewStatus !== 'rejected')) {
    const latest = await readNoteSnapshot(paper.notePath)
    await createKnowledgeRelation(libraryPath, { sourceId: paperNode.id, targetId: concept.id, type: 'defines', creator: 'user', evidenceAnchor: { paperId: capturedAnchor.paperId, anchorId: capturedAnchor.anchorId, type: capturedAnchor.type, page: capturedAnchor.page, label: capturedAnchor.label }, expectedRevision: latest.revision })
  }
  return { saved: true, snapshot: await readNoteSnapshot(paper.notePath), blockId, concept: concept.title }
}

/**
 * Obsidian-style stubs: a `[[Concept]]` link whose target does not exist becomes an empty Concept note in `inbox`
 * status. Links are free; the note only gets written once the curation queue proves it is worth it.
 */
export async function ensureLinkStubs(libraryPath: string, content: string) {
  const searchable = content.replace(/```[\s\S]*?```/g, '')
  const targets = new Set<string>()
  for (const match of searchable.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const raw = match[1].split('|', 1)[0].split('#', 1)[0].replace(/\.md$/i, '').replaceAll('\\', '/').trim()
    if (!raw) continue
    if (raw.includes('/') && !/^concepts\//i.test(raw)) continue
    const name = raw.split('/').at(-1)!.trim()
    if (name.length < 2 || name.length > 120 || /^[\d.v]+$/.test(name) || /[<>:"|?*]/.test(name)) continue
    targets.add(name)
  }
  if (!targets.size) return []
  const nodes = await listKnowledgeNodes(libraryPath)
  const known = new Set<string>()
  for (const node of nodes) {
    known.add(node.title.toLocaleLowerCase())
    known.add(node.relativePath.replace(/\.md$/i, '').split('/').at(-1)!.toLocaleLowerCase())
  }
  const created: string[] = []
  for (const name of targets) {
    if (known.has(name.toLocaleLowerCase())) continue
    try { await fs.access(path.join(libraryPath, 'Concepts', `${name}.md`)); continue } catch { /* not present: create the stub */ }
    const result = await createKnowledgeNode(libraryPath, { title: name, nodeType: 'concept' })
    const snapshot = await readKnowledgeNode(libraryPath, result.id)
    await updateKnowledgeProperties(libraryPath, result.id, { status: 'inbox' }, snapshot.revision)
    created.push(name)
    known.add(name.toLocaleLowerCase())
  }
  return created
}
