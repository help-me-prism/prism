import assert from 'node:assert/strict'
import { withoutBibliography, unsafeParagraphIds } from '../dist-electron/translationScope.js'
const items = [
  {kind:'text', source:'References to the method are discussed here.'},
  {kind:'heading', source:'6 References'},
  {kind:'text', source:'Author (2024). A cited work.'},
  {kind:'heading', source:'Appendix A. Additional experiments'},
  {kind:'text', source:'The experiment used 24 samples.'},
]
assert.deepEqual(withoutBibliography(items), [items[0],items[3],items[4]])
assert.deepEqual(withoutBibliography(items.slice(0,1)),items.slice(0,1))
const mixed = [
  { kind: 'text', blockId: 'mixed', itemSlices: [{ start: 0, end: .5 }] },
  { kind: 'artifact', blockId: 'mixed', itemSlices: [{ start: .5, end: 1 }] },
]
assert(unsafeParagraphIds(mixed).has('mixed'))
const precise = mixed.map(item => ({ ...item, preciseRects: [{ left: 10, top: 20, width: 30, height: 9, fontSize: 10 }] }))
assert.equal(unsafeParagraphIds(precise).size, 0, 'Validated glyph boundaries allow prose beside protected source glyphs')
for (const invalid of [[], [{ left: 0, top: 0, width: NaN, height: 9, fontSize: 10 }], [{ left: 0, top: 0, width: 30, height: 9, fontSize: 0 }]]) {
  assert(unsafeParagraphIds([precise[0], { ...precise[1], preciseRects: invalid }]).has('mixed'), 'Incomplete or malformed geometry must retain the safe original paragraph')
}
console.log('Translation scope passed: bibliography excluded from body, appendices retained, prose mentions unaffected.')

assert.equal(withoutBibliography([{kind:'heading',source:'References and Notes'}, {kind:'text',source:'1. Author (2020).'}, {kind:'caption',source:'Fig. 1. Experimental results.'}]).length,1,'Figures placed after references still have translatable captions')
