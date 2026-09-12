import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { paperRecall, readRecallField, writeRecallField } from '../dist-electron/paperRecall.js'
import { listKnowledgeNodes, readKnowledgeNode, saveKnowledgeNode } from '../dist-electron/knowledge.js'
import { assertOnlyAutoChanged, hasOwnWriting } from '../dist-electron/noteContract.js'

const source = '---\ntype: paper\ntitle: Recall fixture\narxiv_id: recall.001\n---\n\n# Recall fixture\n\n<!-- prism:auto overview -->\nAI summary\n<!-- /prism:auto overview -->\n\n## 메모\n\nDo not replace my original text, $x^2$, [[Concepts/Example]], or ^saved-block.\n'
let note = source
for (const [field, value] of Object.entries({ restate: '결과와 조건을 함께 기억한다.', unresolved: '작은 표본에서도 유지될까?', apply: '표본 크기를 줄여 재현해 본다.' })) note = writeRecallField(note, field, value)
assert(note.startsWith(source), 'Recall fields must preserve the complete pre-existing note.')
assert.equal(paperRecall(note).apply, '표본 크기를 줄여 재현해 본다.')
assert(hasOwnWriting('paper', note))
assert.doesNotThrow(() => assertOnlyAutoChanged(note, note.replace('AI summary', 'Updated AI summary'), 'digest'))
const before = note
note = writeRecallField(note, 'restate', 'One line with a trailing space \n\nSecond line\n')
assert.equal(readRecallField(note, 'restate'), 'One line with a trailing space \n\nSecond line\n', 'Typing spaces and newlines must round-trip.')
assert.equal(readRecallField(note, 'apply'), readRecallField(before, 'apply'))
assert.equal(writeRecallField(source, 'apply', ''), source, 'Empty prompts must not create file scaffolding.')
const cleared = writeRecallField(note, 'apply', '')
assert.equal(paperRecall(cleared).apply, '')
assert(cleared.includes('^saved-block'))
const legacy = `${source}\n## 내 연구에 쓸 곳\n\n기존 아이디어\n\n## 다른 기록\n이 문장은 보존한다.\n`
assert.equal(readRecallField(legacy, 'apply'), '기존 아이디어')
const migrated = writeRecallField(legacy, 'apply', '새 아이디어')
assert.equal((migrated.match(/## 내 연구에 쓸 곳/g) ?? []).length, 1)
assert(migrated.endsWith('## 다른 기록\n이 문장은 보존한다.\n'))
const crlf = writeRecallField(source.replaceAll('\n', '\r\n'), 'restate', '줄 하나\n줄 둘')
assert(crlf.startsWith(source.replaceAll('\n', '\r\n')))
assert.equal(readRecallField(crlf, 'restate'), '줄 하나\r\n줄 둘')
const example = `${source}\n\`\`\`md\n## 내 연구에 쓸 곳\n<!-- prism:mine apply -->\nexample\n<!-- /prism:mine apply -->\n\`\`\`\n`
assert.equal(readRecallField(example, 'apply'), '')
assert(writeRecallField(example, 'apply', 'real idea').startsWith(example))
assert.equal(readRecallField(writeRecallField(example, 'apply', 'real idea'), 'apply'), 'real idea')
for (const bad of ['<!-- prism:mine apply -->\nmissing end', '<!-- prism:mine apply -->\n<!-- prism:mine unresolved -->\nother field\n<!-- /prism:mine apply -->', '## 내 연구에 쓸 곳\nA\n## 내 연구에 쓸 곳\nB']) assert.throws(() => writeRecallField(bad, 'apply', 'replacement'))
assert.throws(() => writeRecallField(source, 'apply', '<!-- /prism:mine apply -->'))

const root = await mkdtemp(path.join(os.tmpdir(), 'prism-recall-contract-'))
try {
  const paperDir = path.join(root, 'papers', 'recall.001')
  await mkdir(paperDir, { recursive: true })
  await writeFile(path.join(paperDir, 'recall.001.md'), before)
  const record = (await listKnowledgeNodes(root))[0]
  assert.equal(record.recall.restate, '결과와 조건을 함께 기억한다.')
  assert.equal(record.recall.apply, '표본 크기를 줄여 재현해 본다.')
  const snapshot = await readKnowledgeNode(root, record.id)
  const changed = writeRecallField(snapshot.content, 'unresolved', '새 질문')
  const saved = await saveKnowledgeNode(root, record.id, { content: changed, expectedRevision: snapshot.revision })
  assert(saved.saved)
  assert.equal((await listKnowledgeNodes(root))[0].recall.unresolved, '새 질문', 'Home cards must reflect saved edits, not stale previews.')
  const stale = await saveKnowledgeNode(root, record.id, { content: writeRecallField(snapshot.content, 'apply', 'stale'), expectedRevision: snapshot.revision })
  assert.equal(stale.saved, false, 'The guided form must retain the existing conflict contract.')
  assert.equal(paperRecall((await readKnowledgeNode(root, record.id)).content).apply, record.recall.apply)
} finally { await rm(root, { recursive: true, force: true }) }
console.log('Paper recall: personal fields, legacy notes, whitespace, malformed regions, previews and save conflicts passed.')
