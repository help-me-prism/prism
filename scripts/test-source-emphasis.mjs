import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const source = await fs.readFile('src/paper/sourceEmphasis.ts', 'utf8')
const { code } = await transformWithOxc(source, 'src/paper/sourceEmphasis.ts')
const { sourceFontWeight, dominantSourceWeight, collectSourceFontWeights } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
assert.equal(sourceFontWeight({ name: 'ABCDEF+MinionPro-Bold' }), 700)
assert.equal(sourceFontWeight({ name: 'Helvetica-BoldOblique' }), 700)
assert.equal(sourceFontWeight({ name: 'MinionPro-Regular' }), 400)
for (const name of ['g_d0_f1', 'sans-serif', 'Gotham-Medium', 'Bolden']) assert.equal(sourceFontWeight({ name }), undefined)
const weights = { b: 700, n: 400 }
const items = [{ str: 'BBBBBBBBBB', fontName: 'b' }, { str: 'nnnnnnnnnnnnnnnnnnnn', fontName: 'n' }]
assert.equal(dominantSourceWeight({ itemIndexes: [0, 1] }, items, weights), 400, 'minority inline bold must not bold the translated sentence')
assert.equal(dominantSourceWeight({ itemSlices: [{ itemIndex: 0, start: 0, end: 1 }, { itemIndex: 1, start: 0, end: .1 }] }, items, weights), 700, 'only characters belonging to the segment count')
assert.equal(dominantSourceWeight({ itemIndexes: [0, 1] }, items, { b: 700 }), undefined, 'unknown metadata cannot create a bold majority')
assert.equal(dominantSourceWeight({ itemIndexes: [9] }, items, weights), undefined)
assert.deepEqual(await collectSourceFontWeights({ getOperatorList: async () => { throw Error('unsupported') }, commonObjs: { get: () => null } }, items), {})
let loaded = false
const resolved = await collectSourceFontWeights({ getOperatorList: async () => { loaded = true }, commonObjs: { get: id => {
  assert(loaded, 'font objects are resolved only after operator loading')
  if (id === 'n') throw Error('unavailable font')
  return { name: 'Helvetica-Bold' }
} } }, items)
assert.equal(resolved.b, 700)
assert.equal(resolved.n, undefined, 'one unavailable font must not discard resolved fonts')
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/source-emphasis.json', 'utf8'))
for (const sample of fixture.samples) {
  const actual = Object.fromEntries(Object.entries(sample.fonts).map(([id, font]) => [id, sourceFontWeight(font)]))
  assert.equal(dominantSourceWeight({ itemIndexes: sample.items.map((_, index) => index) }, sample.items, actual), sample.expected, sample.label)
}
console.log('source-emphasis: metadata, slices, mixed/unknown fonts and real PDF samples passed')
