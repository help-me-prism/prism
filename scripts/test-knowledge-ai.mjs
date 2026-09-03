import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureToPaperNote } from '../dist-electron/capture.js'
import { listCurationQueue } from '../dist-electron/curation.js'
import { buildSuggestionPrompt, listModelSuggestionRuns, parseSuggestionResponse, renderNoteForModel, reviewModelSuggestion, runModelSuggestions } from '../dist-electron/knowledgeAi.js'
import { listKnowledgeNodes, migratePaperNotes, readKnowledgeNode } from '../dist-electron/knowledge.js'
import { listKnowledgeRelationRecords } from '../dist-electron/relations.js'

// The model pipeline is exercised with a fake CLI: what matters is what Prism sends and what it refuses to accept.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-ai-test-'))
function note(id, type, title, body, extra = '') { return `---\ntype: ${type}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: developing\nimportance: medium\nconfidence: medium\n${extra}---\n\n# ${title}\n\n${body}\n` }
async function write(relative, content) { const target = path.join(root, ...relative.split('/')); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8') }
try {
  const paperDir = path.join(root, 'papers', 'test.0001'); const notePath = path.join(paperDir, 'test.0001.md')
  await fs.mkdir(paperDir, { recursive: true }); await fs.writeFile(path.join(paperDir, 'original.pdf'), '')
  await fs.writeFile(notePath, `---\ntype: paper\narxiv_id: "test.0001"\ntitle: "Paper Alpha"\n---\n\n# Paper Alpha\n\n## 한 문장 요약\n\nDiffusion as weighted score matching.\n\n## Notes\n`, 'utf8')
  await write('.prism/anchors/test.0001.json', JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [{ id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching.' }] }))
  await write('.prism/library.json', JSON.stringify([{ arxivId: 'test.0001', title: 'Paper Alpha', pdfPath: path.join(paperDir, 'original.pdf'), notePath }]))
  await write('Concepts/Score matching.md', note('concept-aaaaaaaa', 'concept', 'Score matching', 'Matching the gradient of the log density.'))
  await write('Claims/Weighted objective.md', note('claim-bbbbbbbb', 'claim', 'The simple objective is a weighted ELBO', 'Weighting matters.', 'claim_origin: paper\nscope_domain: "image generation"\n'))
  await write('Questions/Open question.md', note('question-cccccccc', 'question', 'Does the weighting matter at scale?', 'Unknown.'))
  await migratePaperNotes(root)
  const paper = { arxivId: 'test.0001', title: 'Paper Alpha', pdfPath: path.join(paperDir, 'original.pdf'), notePath }
  await captureToPaperNote(root, paper, { kind: 'evidence', paperId: 'test.0001', anchorId: 'sentence-p1-1', memo: '노이즈 예측은 가중 score matching과 같다.' })
  await captureToPaperNote(root, paper, { kind: 'chat', paperId: 'test.0001', question: 'Q', answer: 'AI says this paper defines everything.', provider: 'codex', model: 'm' })

  // The rendered note labels PDF quotes and memos and drops AI answers.
  const paperNode = (await listKnowledgeNodes(root)).find((node) => node.id === 'paper-test.0001')
  const rendered = renderNoteForModel(paperNode, (await readKnowledgeNode(root, paperNode.id)).content)
  assert(rendered.includes('EVIDENCE[evidence-test-0001-sentence-p1-1] 문장1 p.1: Noise prediction can be interpreted as denoising score matching.'), `Evidence was not rendered:\n${rendered}`)
  assert(rendered.includes('MEMO: 노이즈 예측은 가중 score matching과 같다.') && rendered.includes('MEMO: Diffusion as weighted score matching.'), `Memos were not rendered:\n${rendered}`)
  assert(!rendered.includes('AI says'), 'AI answers leaked into the model prompt.')
  const prompt = buildSuggestionPrompt(paperNode, rendered, [], [], ['x'])
  assert(prompt.includes('never write claims') && prompt.includes('Return ONLY a JSON object'), 'The prompt lost its guard rails.')

  // Fenced JSON and stray prose are tolerated; malformed shapes are dropped.
  const parsed = parseSuggestionResponse('Sure!\n```json\n{"relations":[{"type":"uses","targetId":"concept-aaaaaaaa"},{"bad":1}],"candidates":[{"kind":"claim","memo":"x"},{"kind":"nope","memo":"y"}],"newConcepts":[{"title":"Flow matching"},"junk"]}\n```')
  assert.equal(parsed.relations.length, 1); assert.equal(parsed.candidates.length, 1); assert.equal(parsed.newConcepts.length, 1)
  assert.throws(() => parseSuggestionResponse('no json here'), /JSON/)

  // A run turns the model's pointers into pending relations, memo hints and concept suggestions, and refuses anything else.
  let seenPrompt = ''
  const fakeCli = async (text) => {
    seenPrompt = text
    return JSON.stringify({
      relations: [
        { type: 'defines', targetId: 'concept-aaaaaaaa', reason: '정의함', evidenceBlockId: 'evidence-test-0001-sentence-p1-1' },
        { type: 'contradicts', targetId: 'claim-bbbbbbbb', reason: 'scope overlaps' },
        { type: 'answers', targetId: 'question-cccccccc' },
        { type: 'supports', targetId: 'concept-aaaaaaaa', reason: 'wrong type for a concept' },
        { type: 'uses', targetId: 'concept-zzzzzzzz', reason: 'unknown id' },
        { type: 'extends', targetId: 'paper-test.0001', reason: 'self' },
      ],
      candidates: [
        { kind: 'claim', memo: '노이즈 예측은 가중 score matching과 같다.', why: '검증 가능한 명제' },
        { kind: 'question', memo: 'This line was invented by the model.', why: 'fabricated' },
      ],
      newConcepts: [{ title: 'Flow matching', reason: '반복 등장' }, { title: 'Score matching', reason: 'duplicate of existing' }, { title: 'Flow matching', reason: 'dup' }],
    })
  }
  const summary = await runModelSuggestions(root, 'paper-test.0001', 'codex', 'fake-model', fakeCli)
  assert(seenPrompt.includes('- concept-aaaaaaaa | concept | Score matching') && seenPrompt.includes('MEMO LINES') && seenPrompt.includes('- 노이즈 예측은 가중 score matching과 같다.'), 'The prompt did not list existing nodes and memo lines.')
  assert.equal(summary.relationsCreated, 3, `Expected three valid relations, got ${JSON.stringify(summary)}`)
  assert.equal(summary.relationsSkipped, 3)
  assert.equal(summary.candidates, 1); assert.equal(summary.concepts, 1)
  const relations = await listKnowledgeRelationRecords(root)
  const defines = relations.find((relation) => relation.type === 'defines' && relation.targetId === 'concept-aaaaaaaa')
  assert(defines?.creator === 'ai' && defines.reviewStatus === 'pending' && defines.evidenceAnchor?.anchorId === 'sentence-p1-1', 'The defines relation is not a pending AI relation with its evidence anchor.')
  assert(relations.every((relation) => relation.creator === 'ai' ? relation.reviewStatus === 'pending' : true), 'An AI relation was auto-approved.')
  const paperContent = await fs.readFile(notePath, 'utf8')
  assert(!paperContent.includes('prism-relation:'), 'A pending AI relation was written into the paper Markdown before approval.')

  // The queue surfaces the hint on the exact memo, the concept suggestion, and the run summary.
  let queue = await listCurationQueue(root)
  const hinted = queue.memos.find((memo) => memo.memo === '노이즈 예측은 가중 score matching과 같다.')
  assert(hinted?.aiHint?.kind === 'claim' && hinted.aiHint.why === '검증 가능한 명제', 'The memo did not receive its AI hint.')
  assert.equal(queue.conceptSuggestions.length, 1); assert.equal(queue.conceptSuggestions[0].title, 'Flow matching'); assert.equal(queue.conceptSuggestions[0].paperTitle, 'Paper Alpha')
  assert.equal(queue.pendingRelations.length, 3)
  assert(queue.modelRuns[0]?.model === 'fake-model' && queue.total === 3 + 0 + 1 + 1 + 1 + 1, `Queue totals are off: ${queue.total}`)

  // Reviewing: a concept suggestion becomes an inbox stub; a memo hint can only be dismissed, never auto-promoted.
  await reviewModelSuggestion(root, { paperNodeId: 'paper-test.0001', id: queue.conceptSuggestions[0].id, decision: 'accepted' })
  const stub = await fs.readFile(path.join(root, 'Concepts', 'Flow matching.md'), 'utf8')
  assert(stub.includes('status: inbox'), 'The accepted concept suggestion did not become an inbox stub.')
  await assert.rejects(reviewModelSuggestion(root, { paperNodeId: 'paper-test.0001', id: hinted.aiHint.id, decision: 'accepted' }), /직접 승격/)
  await reviewModelSuggestion(root, { paperNodeId: 'paper-test.0001', id: hinted.aiHint.id, decision: 'rejected' })
  queue = await listCurationQueue(root)
  assert(!queue.memos.find((memo) => memo.memo === '노이즈 예측은 가중 score matching과 같다.').aiHint && queue.conceptSuggestions.length === 0, 'Reviewed suggestions stayed in the queue.')
  assert(queue.stubs.some((item) => item.node.title === 'Flow matching'), 'The new stub is not in the stub queue.')

  // Re-running keeps the rejection and does not duplicate relations.
  const again = await runModelSuggestions(root, 'paper-test.0001', 'codex', 'fake-model', fakeCli)
  assert.equal(again.relationsCreated, 0, 'Re-running duplicated pending relations.')
  assert.equal(again.candidates, 0, 'A rejected memo hint resurfaced after re-running.')
  assert.equal((await listModelSuggestionRuns(root)).length, 1)
  process.stdout.write('Knowledge AI passed: note rendering without AI answers, guarded prompt, tolerant JSON parsing, type/id validation, pending-only relations with anchors, memo hints, concept stubs, and rejection memory.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
