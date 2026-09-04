import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureToPaperNote } from '../dist-electron/capture.js'
import { listCurationQueue, mergeConcepts, promoteMemo } from '../dist-electron/curation.js'
import { listKnowledgeNodes, migratePaperNotes, readKnowledgeNode } from '../dist-electron/knowledge.js'
import { createKnowledgeRelation, listKnowledgeRelationRecords } from '../dist-electron/relations.js'

// The curation queue and its decisions (promote, merge, approve) run on plain Markdown in a throwaway vault.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-curation-test-'))
function note(id, type, title, body, extra = '') { return `---\ntype: ${type}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: developing\nimportance: medium\nconfidence: medium\n${extra}---\n\n# ${title}\n\n${body}\n` }
async function write(relative, content) { const target = path.join(root, ...relative.split('/')); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8') }
try {
  const paperDir = path.join(root, 'papers', 'test.0001')
  const notePath = path.join(paperDir, 'test.0001.md')
  await fs.mkdir(paperDir, { recursive: true })
  await fs.writeFile(path.join(paperDir, 'original.pdf'), '')
  await fs.writeFile(notePath, `---\ntype: paper\narxiv_id: "test.0001"\ntitle: "Paper Alpha"\n---\n\n# Paper Alpha\n\n## Notes\n\n[[Score matching]] appears here and [[Denoising]] too.\n`, 'utf8')
  await write('.prism/anchors/test.0001.json', JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [
    { id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching.' },
    { id: 'sentence-p1-2', type: 'text', page: 1, source: 'We define score matching as matching the gradient of the log density.' },
  ] }))
  await write('Papers/Paper Beta.md', note('paper-bbbbbbbb', 'paper', 'Paper Beta', 'Beta also relies on [[Score matching]].', 'reading_status: read\n'))
  await write('Concepts/Score matching.md', note('concept-aaaaaaaa', 'concept', 'Score matching', '## 정의 비교\n\n| 논문 | 이 논문의 정의 | 차이점 |\n| --- | --- | --- |\n|  |  |  |\n').replace('status: developing', 'status: inbox'))
  await write('Concepts/Denoising.md', note('concept-cccccccc', 'concept', 'Denoising', '').replace('status: developing', 'status: inbox'))
  await write('Concepts/Score-based models.md', note('concept-dddddddd', 'concept', 'Score-based models', 'Real body about score-based generative models.'))
  await write('Claims/Unsupported claim.md', note('claim-eeeeeeee', 'claim', 'Unsupported claim', 'No evidence yet.', 'claim_origin: mine\n'))
  await write('Questions/Open question.md', note('question-ffffffff', 'question', 'Open question', 'Why?'))
  await write('.prism/relations/relation-11111111111111111111.json', JSON.stringify({ id: 'relation-11111111111111111111', sourceId: 'paper-bbbbbbbb', targetId: 'claim-eeeeeeee', type: 'supports', creator: 'ai', reviewStatus: 'pending', createdAt: '2026-09-03T00:00:00.000Z' }))
  await write('.prism/library.json', JSON.stringify([{ arxivId: 'test.0001', title: 'Paper Alpha', pdfPath: path.join(paperDir, 'original.pdf'), notePath }]))
  await migratePaperNotes(root)
  const paper = { arxivId: 'test.0001', title: 'Paper Alpha', pdfPath: path.join(paperDir, 'original.pdf'), notePath }

  // Reading-time capture with a memo and a concept definition.
  await captureToPaperNote(root, paper, { kind: 'evidence', paperId: 'test.0001', anchorId: 'sentence-p1-1', memo: '노이즈 예측은 가중 score matching과 같다.' })
  const captured = await captureToPaperNote(root, paper, { kind: 'evidence', paperId: 'test.0001', anchorId: 'sentence-p1-2', memo: 'log density gradient로 정의', concept: 'Score matching' })
  assert.equal(captured.concept, 'Score matching')
  const conceptAfter = await fs.readFile(path.join(root, 'Concepts', 'Score matching.md'), 'utf8')
  assert(conceptAfter.includes('| [[papers/test.0001/test.0001\\|Paper Alpha]] | We define score matching as matching the gradient of the log density. | log density gradient로 정의 [PDF p.1](prism://paper/test.0001?anchor=sentence-p1-2&page=1) |'), `The definition row was not appended to the comparison table:\n${conceptAfter}`)
  assert(!conceptAfter.includes('|  |  |  |'), 'The placeholder table row was not replaced.')
  const definesRelation = (await listKnowledgeRelationRecords(root)).find((relation) => relation.sourceId === 'paper-test.0001' && relation.targetId === 'concept-aaaaaaaa' && relation.type === 'defines')
  assert(definesRelation?.reviewStatus === 'approved' && definesRelation.evidenceAnchor?.anchorId === 'sentence-p1-2', 'Capturing a definition did not create an approved defines relation with its anchor.')

  // The queue lists pending AI relations, stubs with backlink counts, memos, unsupported claims, and open questions.
  let queue = await listCurationQueue(root)
  assert.equal(queue.pendingRelations.length, 1)
  assert.equal(queue.pendingRelations[0].source.title, 'Paper Beta')
  const scoreStub = queue.stubs.find((stub) => stub.node.title === 'Score matching'); const denoisingStub = queue.stubs.find((stub) => stub.node.title === 'Denoising')
  assert(scoreStub?.backlinks === 2 && scoreStub.ready && denoisingStub?.backlinks === 1 && !denoisingStub.ready, `Stub backlink counts are wrong: ${JSON.stringify(queue.stubs.map((stub) => [stub.node.title, stub.backlinks]))}`)
  assert.equal(queue.stubs[0].node.title, 'Score matching', 'Stubs are not ordered by backlink count.')
  const memoTexts = queue.memos.map((memo) => memo.memo)
  assert(memoTexts.includes('노이즈 예측은 가중 score matching과 같다.') && memoTexts.includes('log density gradient로 정의'), `Reading memos were not detected: ${JSON.stringify(memoTexts)}`)
  assert(queue.memos.every((memo) => memo.anchor && memo.anchorLabel), 'Memos lost their anchor metadata.')
  assert.equal(queue.unsupportedClaims.length, 1); assert.equal(queue.unansweredQuestions.length, 1)
  assert.equal(queue.total, 1 + 2 + 2 + 1 + 1)

  // Promoting a memo creates a Claim that keeps the evidence card, links back, and marks the memo in the paper note.
  const memo = queue.memos.find((item) => item.memo.startsWith('노이즈 예측'))
  const promoted = await promoteMemo(root, { paperNodeId: memo.paper.id, blockId: memo.blockId, memo: memo.memo, nodeType: 'claim', title: '노이즈 예측은 가중 score matching이다' })
  const claim = await readKnowledgeNode(root, promoted.id)
  assert(claim.content.includes('claim_origin: paper') && claim.content.includes('노이즈 예측은 가중 score matching과 같다.') && claim.content.includes('> [!evidence] 문장 · Paper Alpha · p.1') && claim.content.includes('> [[papers/test.0001/test.0001|Paper Alpha]]'), `The promoted Claim is incomplete:\n${claim.content}`)
  const paperAfter = await fs.readFile(notePath, 'utf8')
  assert(paperAfter.includes('노이즈 예측은 가중 score matching과 같다. → [[Claims/노이즈 예측은 가중 score matching이다|노이즈 예측은 가중 score matching이다]]'), 'The promoted memo was not marked in the paper note.')
  const supports = (await listKnowledgeRelationRecords(root)).find((relation) => relation.sourceId === 'paper-test.0001' && relation.targetId === promoted.id)
  assert(supports?.type === 'supports' && supports.reviewStatus === 'approved' && supports.evidenceAnchor?.anchorId === 'sentence-p1-1', 'Promotion did not create the paper → claim supports relation with its anchor.')
  queue = await listCurationQueue(root)
  assert(!queue.memos.some((item) => item.memo.startsWith('노이즈 예측')), 'A promoted memo stayed in the queue.')

  // Merging a stub repoints links and relations, appends real content only, and trashes the stub.
  const beta = (await listKnowledgeNodes(root)).find((node) => node.id === 'paper-bbbbbbbb')
  const betaSnapshot = await readKnowledgeNode(root, beta.id)
  await createKnowledgeRelation(root, { sourceId: beta.id, targetId: 'concept-cccccccc', type: 'uses', creator: 'user', expectedRevision: betaSnapshot.revision })
  await mergeConcepts(root, { sourceId: 'concept-cccccccc', targetId: 'concept-dddddddd' })
  const paperMerged = await fs.readFile(notePath, 'utf8')
  assert(paperMerged.includes('[[Concepts/Score-based models|Denoising]]') && !paperMerged.includes('[[Denoising]]'), 'Links to the merged stub were not repointed with the original alias.')
  const relationsAfter = await listKnowledgeRelationRecords(root)
  assert(relationsAfter.some((relation) => relation.sourceId === beta.id && relation.targetId === 'concept-dddddddd' && relation.type === 'uses') && !relationsAfter.some((relation) => relation.targetId === 'concept-cccccccc'), 'Relation sidecars were not repointed to the merge target.')
  const target = await fs.readFile(path.join(root, 'Concepts', 'Score-based models.md'), 'utf8')
  assert(!target.includes('## 병합됨'), 'An empty stub body was appended to the merge target.')
  await assert.rejects(fs.access(path.join(root, 'Concepts', 'Denoising.md')), 'The merged stub was not removed.')
  assert((await fs.readdir(path.join(root, '.prism', 'trash', 'knowledge'))).some((name) => name.endsWith('Denoising.md')), 'The merged stub was not moved to trash.')
  queue = await listCurationQueue(root)
  assert(!queue.stubs.some((stub) => stub.node.title === 'Denoising'), 'The merged stub remained in the queue.')
  process.stdout.write('Curation passed: definition rows with defines relations, queue sections and ordering, memo promotion with evidence and back-marking, and stub merging with link and sidecar repointing.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
