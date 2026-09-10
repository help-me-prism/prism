import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
async function load(path) {
  const { code } = await transformWithOxc(await fs.readFile(path, 'utf8'), path)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { unsafeParagraphIds } = await load('electron/translationScope.ts')
const { groupReadingSegments } = await load('src/paper/readingBlocks.ts')
const { segments } = JSON.parse(await fs.readFile('scripts/fixtures/engineering-mixed-paragraph.json', 'utf8'))
const unsafe = unsafeParagraphIds(segments)
assert.deepEqual([...unsafe], ['pdf-p11-b0'])
const groups = groupReadingSegments(segments, unsafe)
assert.equal(groups.length, 1, 'Real p11 must paint one original crop, not split C/W glyphs at proportional boundaries')
assert.equal(groups[0].original, true)
assert.deepEqual(groups[0].items, segments, 'Whole paragraph preserves all neighboring sentences and damaged scientific notation')
// Cached translations must not change geometric safety or split the original fallback.
assert.deepEqual(unsafeParagraphIds(segments.map(s => ({ ...s, translation: 'cached text' }))), unsafe)
const wholeItems = segments.map(s => ({ ...s, itemSlices: s.itemSlices.map(i => ({ ...i, start: 0, end: 1 })) }))
assert.equal(unsafeParagraphIds(wholeItems).size, 0, 'Whole item boundaries remain eligible for masking')
assert.equal(groupReadingSegments(wholeItems).length, 3)
assert.equal(groupReadingSegments(wholeItems, new Set(['pdf-p11-b0'])).length, 1, 'Entirely untranslated mixed paragraphs can retain a single original crop')
assert.equal(unsafeParagraphIds(segments.filter(s => s.kind === 'text')).size, 0, 'Ordinary translated prose is not excluded')
assert.equal(unsafeParagraphIds(segments.map(s => ({ ...s, kind: s.kind === 'artifact' ? 'equation' : s.kind }))).size, 0, 'Equation policy remains full-region preservation')
assert.equal(unsafeParagraphIds([{kind:'text',blockId:'a',itemSlices:[{start:.2,end:1}]},{kind:'artifact',blockId:'b'}]).size,0,'Independent paragraphs cannot contaminate each other')
console.log('Unsafe paragraph regression passed: real engineering p11 uses one complete original crop; whole-item masks stay eligible.')
