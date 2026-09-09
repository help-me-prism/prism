import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
let { code } = await transformWithOxc(await fs.readFile('src/paper/readerContext.ts', 'utf8'), 'src/paper/readerContext.ts')
const shared = await transformWithOxc(await fs.readFile('electron/scientificSource.ts', 'utf8'), 'electron/scientificSource.ts')
code = code.replace('../../electron/scientificSource', 'data:text/javascript;base64,' + Buffer.from(shared.code).toString('base64'))
const { stableReferences, readingEvidence, messagePaperIds } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const a = { paperId: 'biology', paperTitle: 'Biology', anchorId: 's1', type: 'sentence', page: 4, label: '문장1', source: 'The control group showed no significant difference.' }
const b = { ...a, paperId: 'engineering', paperTitle: 'Engineering', source: 'The experimental concrete had greater compressive strength.' }
const manual = stableReferences([{ ...a, placementId: 'first', textOffset: 2 }, { ...b, placementId: 'second', textOffset: 10 }])
assert.notEqual(manual[0].label, manual[1].label, 'Two papers may both have a sentence1, but their chat references must differ')
assert.deepEqual(manual.map(anchor => anchor.textOffset), [2, 10], 'Inline comparison placements survive relabeling')
const first = readingEvidence([a, b], ['biology', 'engineering'], '실험 비교', 200, manual)
for (const reference of first.references) assert.equal(reference.label, manual.find(item => item.paperId === reference.paperId).label)
const nextAnchor = { ...b, anchorId: 's2', source: 'Methods used repeated trials.' }
const second = readingEvidence([nextAnchor, a], ['engineering', 'biology'], '실험 방법', 200, [...manual, ...first.references])
assert.equal(second.references.find(item => item.paperId === 'biology').label, manual[0].label, 'Old evidence remains identifiable after changing retrieval order')
assert(!manual.some(item => item.label === second.references.find(item => item.anchorId === 's2').label), 'New evidence cannot reuse a prior label')
const persisted = JSON.parse(JSON.stringify([...manual, ...first.references, ...second.references]))
assert.equal(stableReferences([a], persisted)[0].label, manual[0].label, 'Persisted conversation labels survive reopening')
assert.deepEqual(messagePaperIds('engineering', ['biology', 'engineering'], [a]), ['engineering', 'biology'], 'Save destination follows the active reading paper, independent of library order')
assert.deepEqual(messagePaperIds(undefined, [], [a]), ['biology'], 'Anchor-only questions retain a destination')
console.log('Chat reference lifecycle passed: cross-paper labels, later turns, persisted references, placements and primary-paper attribution.')
