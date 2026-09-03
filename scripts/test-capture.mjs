import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendToNotesSection, captureToPaperNote, ensureLinkStubs } from '../dist-electron/capture.js'
import { listKnowledgeNodes, migratePaperNotes } from '../dist-electron/knowledge.js'

// Reading-time capture and link stubs work on plain Markdown in a throwaway vault; no Electron needed.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-capture-test-'))
try {
  const paperDir = path.join(root, 'papers', 'test.0001')
  const notePath = path.join(paperDir, 'test.0001.md')
  await fs.mkdir(paperDir, { recursive: true })
  await fs.mkdir(path.join(root, '.prism', 'anchors'), { recursive: true })
  await fs.writeFile(notePath, `---\ntype: paper\narxiv_id: "test.0001"\ntitle: "Capture fixture"\n---\n\n# Capture fixture\n\n## 한 문장 요약\n\n## Notes\n\n## 관련 개념\n\n[[Concepts/Score matching]] and [[Reverse diffusion]] and [[papers/other/other]] and [[1706.03762]]\n`, 'utf8')
  await fs.writeFile(path.join(root, '.prism', 'anchors', 'test.0001.json'), JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [
    { id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching.' },
    { id: 'equation-p2-3', type: 'equation', page: 2, source: 'L_simple = E[||epsilon - epsilon_theta(x_t,t)||^2]' },
  ] }), 'utf8')
  await fs.writeFile(path.join(paperDir, 'original.pdf'), '')
  const paper = { arxivId: 'test.0001', title: 'Capture fixture', pdfPath: path.join(paperDir, 'original.pdf'), notePath }

  // appendToNotesSection inserts before the next heading and creates the section when missing.
  const appended = appendToNotesSection('# T\n\n## Notes\n\nold\n\n## Next\n\nafter\n', 'NEW')
  assert.equal(appended, '# T\n\n## Notes\n\nold\n\nNEW\n\n## Next\n\nafter\n')
  assert.equal(appendToNotesSection('# T\n\nbody\n', 'NEW'), '# T\n\nbody\n\n## Notes\n\nNEW\n')

  // Evidence capture with a memo lands inside ## Notes as a standard evidence card.
  const first = await captureToPaperNote(root, paper, { kind: 'evidence', paperId: 'test.0001', anchorId: 'sentence-p1-1', memo: '핵심 문장. score matching 관점.' })
  assert.equal(first.blockId, 'evidence-test-0001-sentence-p1-1')
  let content = await fs.readFile(notePath, 'utf8')
  const notesStart = content.indexOf('## Notes'); const relatedStart = content.indexOf('## 관련 개념')
  const cardAt = content.indexOf('> [!evidence] 문장 · Capture fixture · p.1 · 문장1')
  assert(cardAt > notesStart && cardAt < relatedStart, 'The evidence card did not land inside the Notes section.')
  assert(content.includes('<!-- prism-evidence:') && content.includes('^evidence-test-0001-sentence-p1-1'), 'The captured card lacks Prism metadata or its block id.')
  assert(content.indexOf('핵심 문장. score matching 관점.') > cardAt, 'The memo was not placed under its card.')

  // Capturing the same anchor again appends only the memo under the existing card.
  await captureToPaperNote(root, paper, { kind: 'evidence', paperId: 'test.0001', anchorId: 'sentence-p1-1', memo: '두 번째 메모' })
  content = await fs.readFile(notePath, 'utf8')
  assert.equal(content.split('> [!evidence] 문장 ·').length - 1, 1, 'A duplicate card was inserted for the same anchor.')
  assert(content.indexOf('두 번째 메모') > content.indexOf('^evidence-test-0001-sentence-p1-1'), 'The second memo was not placed after the card block id.')
  assert(content.indexOf('두 번째 메모') < content.indexOf('핵심 문장. score matching 관점.'), 'The second memo did not sit directly under the card.')

  // Chat capture is a collapsed AI callout with provenance metadata, not user text.
  await captureToPaperNote(root, paper, { kind: 'chat', paperId: 'test.0001', question: '이 목적함수는 왜 가중 score matching인가?', answer: '첫 줄\n\n둘째 줄 $x$', provider: 'codex', model: 'gpt-x', anchors: [{ paperId: 'test.0001', anchorId: 'equation-p2-3', label: '수식1', page: 2 }] })
  content = await fs.readFile(notePath, 'utf8')
  assert(content.includes('> [!ai]- AI 답변 ·') && content.includes('> **Q:** 이 목적함수는 왜 가중 score matching인가?') && content.includes('> 첫 줄\n>\n> 둘째 줄 $x$') && content.includes('> 참조: 수식1 (p.2)') && content.includes('<!-- prism-ai-answer:'), `The chat capture block is malformed:\n${content}`)
  assert(content.indexOf('[!ai]-') < content.indexOf('## 관련 개념'), 'The chat capture did not stay inside the Notes section.')

  // Unknown anchors are rejected without touching the note.
  await assert.rejects(captureToPaperNote(root, paper, { kind: 'evidence', paperId: 'test.0001', anchorId: 'missing', memo: 'x' }), /앵커/)
  assert.equal(await fs.readFile(notePath, 'utf8'), content)

  // Link stubs: only concept-like targets become inbox Concept notes; paper paths and arXiv ids are skipped.
  await migratePaperNotes(root)
  const created = await ensureLinkStubs(root, await fs.readFile(notePath, 'utf8'))
  assert.deepEqual([...created].sort(), ['Reverse diffusion', 'Score matching'])
  const stub = await fs.readFile(path.join(root, 'Concepts', 'Score matching.md'), 'utf8')
  assert(stub.includes('type: concept') && stub.includes('status: inbox') && stub.includes('# Score matching'), `The stub is not an inbox Concept:\n${stub}`)
  assert.deepEqual(await ensureLinkStubs(root, await fs.readFile(notePath, 'utf8')), [], 'Stubs were created twice for the same links.')
  const nodes = await listKnowledgeNodes(root)
  assert(nodes.some((node) => node.nodeType === 'paper' && node.id === 'paper-test.0001') && nodes.filter((node) => node.nodeType === 'concept').length === 2, 'Node listing does not include the paper and both stubs.')
  process.stdout.write('Capture passed: Notes-section insertion, evidence cards with memos, duplicate-anchor merging, AI answer callouts with provenance, unknown-anchor rejection, and inbox Concept stubs from unresolved links.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
