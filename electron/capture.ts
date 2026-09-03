import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readNoteSnapshot, saveNoteSnapshot, type NoteSnapshot } from './notes.js'
import { listEvidenceAnchors, type EvidenceAnchor, type EvidencePaper } from './evidence.js'
import { createKnowledgeNode, listKnowledgeNodes, readKnowledgeNode, updateKnowledgeProperties } from './knowledge.js'

/**
 * Reading-time capture: the Reader and the chat append into the Paper note's `## Notes` section
 * without opening the Notes window. Everything lands as ordinary Markdown so Obsidian sees it too.
 */
export type CapturePaper = EvidencePaper & { notePath: string }
export type PaperCaptureRequest =
  | { kind: 'evidence'; paperId: string; anchorId: string; memo?: string }
  | { kind: 'chat'; paperId: string; question: string; answer: string; provider: string; model: string; anchors?: Array<{ paperId: string; anchorId: string; label: string; page?: number }> }
export type PaperCaptureResult = { saved: true; snapshot: NoteSnapshot; blockId?: string }

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

export async function captureToPaperNote(libraryPath: string, paper: CapturePaper, request: PaperCaptureRequest): Promise<PaperCaptureResult> {
  const snapshot = await readNoteSnapshot(paper.notePath)
  let content = snapshot.content
  let blockId: string | undefined
  if (request.kind === 'evidence') {
    const anchor = (await listEvidenceAnchors(libraryPath, [paper])).find((item) => item.anchorId === request.anchorId)
    if (!anchor) throw new Error('이 논문에서 해당 PDF 앵커를 찾을 수 없습니다. Reader에서 논문을 다시 열면 앵커가 생성됩니다.')
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
  return { saved: true, snapshot: result.snapshot, blockId }
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
