import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'

const shared = await transformWithOxc(await fs.readFile('electron/scientificSource.ts', 'utf8'), 'electron/scientificSource.ts')
const sharedUrl = 'data:text/javascript;base64,' + Buffer.from(shared.code).toString('base64')
const { code } = await transformWithOxc((await fs.readFile('src/paper/composerEvidenceLabel.ts', 'utf8')).replaceAll("'../../electron/scientificSource'", JSON.stringify(sharedUrl)), 'src/paper/composerEvidenceLabel.ts')
const { composerEvidenceLabel } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const anchor = Object.freeze({ label: '문장88', type: 'sentence', page: 11, paperId: 'local-6f1c8cd', anchorId: 'stable-s88', paperTitle: 'Thermal conductivity of porous materials', source: 'The measured conductivity\n  decreased with porosity.' })
const display = composerEvidenceLabel(anchor)
assert.equal(display.location, '11쪽 · 문장')
assert.equal(display.excerpt, 'The measured conductivity decreased with porosity.')
assert(display.description.includes(anchor.paperTitle))
assert(display.description.includes(display.excerpt))
assert(!display.description.includes(anchor.paperId), 'Internal paper identifiers do not help identify selected evidence')
assert.equal(anchor.anchorId, 'stable-s88', 'Presentation must not change evidence identity')
for (const [type, kind] of [['table', '표'], ['figure', '피겨'], ['equation', '수식'], ['page', '페이지']]) {
  const source = '<literal table cell>\n' + 'long scientific content '.repeat(500)
  const result = composerEvidenceLabel({ ...anchor, type, page: 4, source })
  assert.equal(result.location, `4쪽 · ${kind}`)
  assert.equal(result.excerpt, source.replace(/\s+/g, ' ').trim(), 'Full evidence remains accessible in the tooltip; CSS clips only its visual excerpt')
  assert(result.description.includes('<literal table cell>'), 'Literal scientific text remains plain text')
}
for (const page of [0, -1, NaN, 1.5]) assert.equal(composerEvidenceLabel({ ...anchor, page }).location, '문장')
const figure = { ...anchor, type: 'figure', source: 'Saved figure image: C:/vault/local-123/figures/crop.png. Normalized bounds: {"x":0.2}' }
assert.equal(composerEvidenceLabel(figure).excerpt, '선택한 피겨 영역')
assert(!composerEvidenceLabel(figure).description.includes('C:/vault'), 'Image transport paths are not a reader-facing preview')
assert.equal(composerEvidenceLabel({ ...figure, source: 'Matched LaTeX figure 2. Caption: Growth at 25 C. Source asset: images/figure.pdf. Saved figure image: crop.png' }).excerpt, 'Growth at 25 C')
assert(figure.source.includes('C:/vault'), 'The model still receives the original image transport description')
console.log('Composer evidence presentation: page/type, full source, title, and stable identity passed')
