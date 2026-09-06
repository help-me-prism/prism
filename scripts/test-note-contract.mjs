import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertOnlyAutoChanged, autoMarkers, hasOwnWriting, isAutoSection, isMineSection, mineMarkers, mineRegion, withoutAutoSections } from '../dist-electron/noteContract.js'
import { refreshNoteDigest, refreshVaultDigests } from '../dist-electron/paperDigest.js'
import { listKnowledgeNodes, migratePaperNotes, readKnowledgeNode } from '../dist-electron/knowledge.js'

/**
 * A note has three layers and only one of them can be lost. Automation may rewrite what it generated; the
 * researcher's own sentences are not its business. This is the test that says so, because "the code only
 * writes between markers" is a claim about code that changes, and the guarantee has to survive that.
 */

const auto = (section, body) => `${autoMarkers(section).open}\n${body}\n${autoMarkers(section).close}`
const mine = (section, body) => `${mineMarkers(section).open}\n${body}\n${mineMarkers(section).close}`

// ---------- the invariant ----------
const note = `# Optimal Transport\n\n## 정의\n\n${auto('definition', '- 모델이 쓴 정의.')}\n\n## 내 말로\n\n${mine('restate', 'OT는 두 분포 사이 최단거리 경로를 고르는 문제.')}\n\n## 내 생각\n\n예전 양식에 손으로 쓴 문장.\n`

assert.doesNotThrow(() => assertOnlyAutoChanged(note, note.replace('- 모델이 쓴 정의.', '- 다시 쓴 정의.\n- 두 번째 줄.'), 'T'), 'Rewriting a generated region was refused.')
assert.doesNotThrow(() => assertOnlyAutoChanged(note, note.replace('## 내 말로', `## 어디서 나왔나\n\n${auto('sources', '- [[papers/x/x|X]]')}\n\n## 내 말로`), 'T'), 'Adding a generated section with its heading was refused.')
assert.doesNotThrow(() => assertOnlyAutoChanged(note.replace('## 정의', `## 대화에서 물어본 것\n\n${auto('asked', '- q')}\n\n## 정의`), note, 'T'), 'Taking an emptied generated section away was refused.')

// The three ways automation could reach the researcher's writing, all refused.
for (const [label, damaged] of [
  ['a marked section', note.replace('OT는 두 분포 사이 최단거리 경로를 고르는 문제.', 'OT는 최단거리 경로다.')],
  ['a marked section emptied', note.replace('OT는 두 분포 사이 최단거리 경로를 고르는 문제.', '')],
  ['an older unmarked section', note.replace('예전 양식에 손으로 쓴 문장.', '예전 양식에 손으로 쓴 문장!')],
]) assert.throws(() => assertOnlyAutoChanged(note, damaged, 'T'), /사용자가 쓴 부분/, `Rewriting ${label} was allowed.`)

// Reduction keeps everything that is not generated, so the researcher's words are what remains.
const reduced = withoutAutoSections(note)
assert(reduced.includes('OT는 두 분포 사이 최단거리 경로를 고르는 문제.') && reduced.includes('예전 양식에 손으로 쓴 문장.'), `The reduction dropped the researcher's writing:\n${reduced}`)
assert(!reduced.includes('모델이 쓴 정의') && !reduced.includes('## 정의'), `The reduction kept a generated section:\n${reduced}`)

// ---------- who owns which section ----------
assert(isAutoSection('paper', 'overview') && isAutoSection('concept', 'definition'), 'A generated section was not recognised as one.')
assert(!isAutoSection('paper', 'restate') && !isAutoSection('concept', 'belief'), 'A section belonging to the researcher was offered to automation.')
assert(isMineSection('concept', 'restate') && !isMineSection('concept', 'apply'), 'The per-node list of the researcher\'s sections is wrong.')
assert(!isAutoSection('concept', 'overview'), 'A paper section was offered on a concept.')

assert(hasOwnWriting('concept', note), 'A note with the researcher\'s writing was reported empty.')
assert(!hasOwnWriting('concept', `# T\n\n## 내 말로\n\n${mine('restate', '')}\n\n## 정의\n\n${auto('definition', '- 모델이 쓴 줄.')}\n`), 'Generated text was counted as the researcher\'s own writing.')
assert(mineRegion(note, 'restate').text.startsWith('OT는'), 'The marked region did not read back.')
assert(mineRegion(note, 'belief') === undefined, 'A region that is not in the note read back anyway.')

// ---------- a real sweep over a real vault ----------
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-contract-'))
try {
  const paperDir = path.join(root, 'papers', 'test.0001')
  await fs.mkdir(paperDir, { recursive: true })
  await fs.mkdir(path.join(root, 'Concepts'), { recursive: true })

  const mineLines = {
    unresolved: '조건부 경로가 왜 주변 경로와 같은 gradient를 주는지 아직 모르겠다.',
    apply: '음성 합성 샘플링 단계에 OT 경로를 써볼 것.',
    restate: 'OT는 두 분포를 최단거리로 잇는 경로를 고르는 문제.',
    legacy: '손으로 쓴 문장은 어떤 경로로도 사라지면 안 된다.',
  }
  await fs.writeFile(path.join(paperDir, 'test.0001.md'), `---\ntype: paper\narxiv_id: "test.0001"\ntitle: "Flow Matching"\n---\n\n# Flow Matching\n\n> [!abstract]- Abstract\n> We propose flow matching. It trains a vector field without simulation. It beats diffusion on CIFAR10.\n\n[[Concepts/Optimal Transport]]를 쓴다.\n\n## 아직 모르겠는 것\n\n${mine('unresolved', mineLines.unresolved)}\n\n## 내 연구에 쓸 곳\n\n${mine('apply', mineLines.apply)}\n\n## 내 생각\n\n${mineLines.legacy}\n`, 'utf8')
  await fs.writeFile(path.join(root, 'Concepts', 'Optimal Transport.md'), `---\ntype: concept\nprism_id: "concept-aaaaaaaa"\ntitle: "Optimal Transport"\nstatus: developing\n---\n\n# Optimal Transport\n\n## 내 말로\n\n${mine('restate', mineLines.restate)}\n`, 'utf8')
  await migratePaperNotes(root)

  const messages = [
    { role: 'user', text: 'Optimal Transport 경로가 왜 더 빠른가요?', createdAt: 10, paperIds: ['test.0001'] },
    { role: 'assistant', text: '직선 경로라 스텝이 적게 듭니다.', createdAt: 11, paperIds: ['test.0001'] },
    { role: 'user', text: 'velocity field가 왜 필요한지 모르겠어요', createdAt: 20, paperIds: ['test.0001'] },
  ]

  const sweep = await refreshVaultDigests(root, messages)
  assert(sweep.updated.length >= 2, `The sweep wrote nothing to check: ${JSON.stringify(sweep)}`)

  const nodes = await listKnowledgeNodes(root)
  const paper = nodes.find((node) => node.nodeType === 'paper')
  const concept = nodes.find((node) => node.nodeType === 'concept')
  const paperContent = (await readKnowledgeNode(root, paper.id)).content
  const conceptContent = (await readKnowledgeNode(root, concept.id)).content

  // The sweep did its job...
  assert(paperContent.includes('<!-- prism:auto overview -->') && paperContent.includes('<!-- prism:auto confusion -->'), 'The paper digest did not run.')
  assert(conceptContent.includes('<!-- prism:auto sources -->'), 'The concept digest did not run.')
  // ...and every sentence the researcher wrote is still exactly what they wrote.
  assert.equal(mineRegion(paperContent, 'unresolved').text, mineLines.unresolved, 'A sweep changed what the researcher wrote about what they do not understand.')
  assert.equal(mineRegion(paperContent, 'apply').text, mineLines.apply, 'A sweep changed what the researcher wrote about their own research.')
  assert.equal(mineRegion(conceptContent, 'restate').text, mineLines.restate, 'A sweep changed the researcher\'s own restatement of a concept.')
  assert(paperContent.includes(mineLines.legacy), 'A sweep changed an older unmarked section the researcher had written in.')
  assert(hasOwnWriting('paper', paperContent) && hasOwnWriting('concept', conceptContent), 'A note the researcher has written in was reported empty after a sweep.')

  // Running again converges rather than accumulating, and still leaves the researcher's words alone.
  const before = paperContent
  await refreshNoteDigest(root, paper.id, messages)
  const after = (await readKnowledgeNode(root, paper.id)).content
  assert.doesNotThrow(() => assertOnlyAutoChanged(before, after, 'rerun'), 'A second run moved something outside a generated region.')
  assert.equal(mineRegion(after, 'unresolved').text, mineLines.unresolved, 'A second run changed the researcher\'s writing.')

  process.stdout.write('Note contract passed: the three layers, section ownership per node type, reduction that keeps only what the researcher wrote, and a real sweep that rewrites its own regions while leaving marked and older user sections byte-for-byte intact.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
