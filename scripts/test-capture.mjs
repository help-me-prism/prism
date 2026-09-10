import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendToNotesSection, captureToPaperNote, ensureLinkStubs, chatCaptureProvenance } from '../dist-electron/capture.js'
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
  const capturedAnswer = await captureToPaperNote(root, paper, { kind: 'chat', paperId: 'test.0001', question: '이 목적함수는 왜 가중 score matching인가?', answer: '첫 줄\n\n둘째 줄 $x$', provider: 'codex', model: 'gpt-x', anchors: [{ paperId: 'test.0001', anchorId: 'equation-p2-3', label: '수식1', page: 2 }] })
  assert.match(capturedAnswer.blockId, /^ai-answer-[a-f0-9-]{36}$/)
  assert(capturedAnswer.snapshot.content.includes(`\n^${capturedAnswer.blockId}\n`), 'Saved answer has a stable Obsidian block target')
  assert(capturedAnswer.snapshot.content.includes(`\n\n^${capturedAnswer.blockId}\n\n<!-- prism-ai-answer:`), 'Structured callout IDs require blank lines on both sides, with metadata after the ID')
  const beforeId = capturedAnswer.snapshot.content.split(`\n\n^${capturedAnswer.blockId}`)[0]
  assert(beforeId.split('\n').at(-1).startsWith('>'), 'The block marker must immediately follow the actual callout, not an HTML metadata block')
  content = await fs.readFile(notePath, 'utf8')
  assert(content.includes('> [!ai]- AI 답변 ·') && content.includes('> **Q:** 이 목적함수는 왜 가중 score matching인가?') && content.includes('> 첫 줄\n>\n> 둘째 줄 $x$') && content.includes('> 참조: [수식1 · Capture fixture · p.2](prism://paper/test.0001?anchor=equation-p2-3&page=2)') && content.includes('<!-- prism-ai-answer:'), `The chat capture block is malformed:\n${content}`)
  const reference={paperId:'test.0001',anchorId:'equation-p2-3',label:'근거1',page:2}
  const provenance=chatCaptureProvenance('설명 [@근거1]. `[@근거1]`\n```text\n[@근거1]\n```\n$E=mc^2$',[reference,reference],paper)
  assert.equal(provenance.anchors.length,1,'Native duplicate request/cited anchors collapse by stable identity')
  assert.equal(provenance.references.split('prism://').length-1,1)
  assert(provenance.answer.startsWith('설명 [@근거1](prism://paper/test.0001?anchor=equation-p2-3&page=2).'))
  assert(provenance.answer.includes('`[@근거1]`\n```text\n[@근거1]\n```\n$E=mc^2$'),'Literal code and math are preserved')
  assert.equal(chatCaptureProvenance('$[@근거1]$',[reference],paper).answer,'$[@근거1]$','Citation-like math content stays literal')
  const multi=chatCaptureProvenance('비교 [@근거1]',[reference,{...reference,paperId:'other/paper'}],paper)
  assert.equal(multi.answer,'비교 [@근거1]','Ambiguous same-label multi-paper citations must not guess')
  assert.equal(multi.anchors.length,2)
  assert(multi.references.includes('other/paper')&&multi.references.includes('prism://paper/other%2Fpaper'))
  assert(content.indexOf('[!ai]-') < content.indexOf('## 관련 개념'), 'The chat capture did not stay inside the Notes section.')

  // Cross-paper labels use the pinned vault's actual library, without changing source identities.
  const foreign = { paperId: 'local-other-science', anchorId: 'p4-caption', label: '근거2', page: 4 }
  const unknown = { ...foreign, paperId: 'local-not-in-library', label: '근거3' }
  const conflicting = { ...foreign, paperId: 'local-conflicting', label: '근거4' }
  await fs.writeFile(path.join(root, '.prism', 'library.json'), JSON.stringify([
    { arxivId: paper.arxivId, title: 'Stale current title' },
    { arxivId: foreign.paperId, title: 'Fibers [thermal] properties', notePath: '/must/not/be/read.md' },
    { arxivId: conflicting.paperId, title: 'A' }, { arxivId: conflicting.paperId, title: 'B' },
    { arxivId: unknown.paperId, title: 123 },
  ]))
  const crossAnchors = [reference, foreign, unknown, conflicting]
  const cross = await captureToPaperNote(root, paper, { kind: 'chat', paperId: paper.arxivId, question: 'Compare papers', answer: 'See [@근거2].', provider: 'fixture', model: 'none', anchors: crossAnchors })
  content = await fs.readFile(notePath, 'utf8')
  assert(content.includes('[근거2 · Fibers \\[thermal\\] properties · p.4](prism://paper/local-other-science?anchor=p4-caption&page=4)'))
  assert(content.includes('[근거3 · local-not-in-library · p.4]'))
  assert(content.includes('[근거4 · local-conflicting · p.4]'), 'Conflicting duplicate identities must not pick a title')
  assert(!content.includes('Stale current title'), 'The destination paper already resolved by the caller takes precedence')
  const metadata = [...cross.snapshot.content.matchAll(/<!-- prism-ai-answer:([^ ]+) -->/g)].at(-1)
  assert.deepEqual(JSON.parse(decodeURIComponent(metadata[1])).anchors, crossAnchors)
  assert(content.includes('[@근거2](prism://paper/local-other-science?anchor=p4-caption&page=4)'))
  await fs.writeFile(path.join(root, '.prism', 'library.json'), '{invalid')
  await captureToPaperNote(root, paper, { kind: 'chat', paperId: paper.arxivId, question: 'Missing metadata', answer: 'Still retain source', provider: 'fixture', model: 'none', anchors: [foreign] })
  content = await fs.readFile(notePath, 'utf8')
  assert(content.includes('[근거2 · local-other-science · p.4](prism://paper/local-other-science?anchor=p4-caption&page=4)'), 'Unreadable index falls back without losing the saved answer')

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
    // A link where the researcher says what they will use this for names their work, not a concept: that axis
  // is in no paper, and asking for it as a frontmatter field is what left `projects:` empty in the real vault.
  const applying = `# T\n\n[[Score matching]]을 쓴다.\n\n## 내 연구에 쓸 곳\n\n<!-- prism:mine apply -->\n[[음성 합성 파이프라인]]의 샘플링 단계에 써볼 것. [[Concepts/Flow matching]]도 같이.\n<!-- /prism:mine apply -->\n`
  const stubbed = await ensureLinkStubs(root, applying)
  assert(stubbed.includes('음성 합성 파이프라인'), `A link naming the researcher's own work did not become a note: ${JSON.stringify(stubbed)}`)
  const projectNote = await fs.readFile(path.join(root, 'Projects', '음성 합성 파이프라인.md'), 'utf8')
  assert(projectNote.includes('type: project') && projectNote.includes('status: inbox'), `The stub is not an inbox project:\n${projectNote}`)
  // A folder still wins over the section it sits in, and everywhere else a link is still a concept.
  await fs.access(path.join(root, 'Concepts', 'Flow matching.md'))
  await fs.access(path.join(root, 'Concepts', 'Score matching.md'))

  // A real filesystem failure AFTER the paper commit must not invite duplicate memo submission.
  const conceptsPath = path.join(root, 'Concepts'), heldConcepts = path.join(root, 'concepts-held-for-test')
  assert.equal(path.dirname(path.resolve(conceptsPath)), path.resolve(root))
  assert.equal(path.dirname(path.resolve(heldConcepts)), path.resolve(root))
  await fs.rename(conceptsPath, heldConcepts)
  await fs.writeFile(conceptsPath, 'A file obstructs the concept directory')
  const uniqueMemo = 'Partial capture memo must occur exactly once.'
  const partial = await captureToPaperNote(root, paper, { kind: 'evidence', paperId: paper.arxivId, anchorId: 'sentence-p1-1', memo: uniqueMemo, concept: 'Recovered definition' })
  assert.equal(partial.saved, true)
  assert(partial.warning?.includes('Recovered definition'))
  assert(/ENOTDIR|EEXIST/.test(partial.warning), `Expected actual directory obstruction, received ${partial.warning}`)
  assert(partial.warning.includes('메모는 비워 두고'), 'Explain how to retry only the failed connection')
  assert.equal((await fs.readFile(notePath, 'utf8')).split(uniqueMemo).length - 1, 1)
  await fs.unlink(conceptsPath)
  await fs.rename(heldConcepts, conceptsPath)
  const repaired = await captureToPaperNote(root, paper, { kind: 'evidence', paperId: paper.arxivId, anchorId: 'sentence-p1-1', memo: '', concept: 'Recovered definition' })
  assert.equal(repaired.warning, undefined)
  assert.equal(repaired.concept, 'Recovered definition')
  assert.equal((await fs.readFile(notePath, 'utf8')).split(uniqueMemo).length - 1, 1, 'Retrying the connection cannot duplicate the previously saved memo')
  assert((await fs.readFile(path.join(conceptsPath, 'Recovered definition.md'), 'utf8')).includes('Noise prediction'))

process.stdout.write('Capture passed: Notes-section insertion, evidence cards with memos, duplicate-anchor merging, AI answer callouts with provenance, unknown-anchor rejection, inbox Concept stubs from unresolved links, and a link under the section for what a paper will be used for becoming a project rather than a concept.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
