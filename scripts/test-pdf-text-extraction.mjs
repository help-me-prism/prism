import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const source = await fs.readFile('src/paper/textExtraction.ts', 'utf8')
const { code } = await transformWithOxc(source, 'src/paper/textExtraction.ts')
const { segmentsFromItems } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-text-items.json', 'utf8'))

const density = segmentsFromItems(4, fixture.density)
assert(density.some(s => s.kind === 'text' && s.source.includes('dry density ρ 0 of FRFC')))
assert(!density.some(s => s.source.startsWith('0 of FRFC')))
const dimensions = segmentsFromItems(4, fixture.dimensions)
assert(dimensions.some(s => s.kind === 'text' && s.source.includes('300 mm × 300 mm × 30 mm')))
assert(!dimensions.some(s => s.kind === 'artifact'))
const caption = segmentsFromItems(4, fixture.caption)
assert.equal(caption.length, 1)
assert.equal(caption[0].kind, 'caption')
assert.equal(caption[0].source, 'Fig 2. Preparation process of FRFC.')
assert.deepEqual(segmentsFromItems(4, fixture.furniture), [])

// Preserve genuine section and paragraph boundaries while joining inline quantities.
const item = (str, y, hasEOL = true, height = 10) => ({str,y,width:120,height,transform:[height,0,0,height,100,y],hasEOL})
const section = segmentsFromItems(1, [item('A preceding sentence.',700), item('2 Methods',674, true,12), item('We compared specimens.',655)])
assert(section.some(s=>s.kind==='heading' && s.source==='2 Methods'))
for (const label of ['Fig 3. Test setup.', 'Fig. 3. Test setup.', 'Figure 3. Test setup.', 'Table 3. Test setup.']) {
  assert.equal(segmentsFromItems(1,[item(label,700)])[0].kind,'caption')
}
for (const label of ['Fig 2) illustrates the differences.', '(1) SEM tests.', '(XLSX)', '[65].']) {
  const parsed = segmentsFromItems(1,[item(label,700)])
  assert(parsed.every(s=>!['caption','equation'].includes(s.kind)), label)
}
const inlineReference = segmentsFromItems(1,[item('See (',700,false),{...item('Fig 2) for the results.',700),transform:[10,0,0,10,126,700]}])
assert.equal(inlineReference.length,1)
assert.equal(inlineReference[0].kind,'text')
const damagedComparator = segmentsFromItems(11,[item('The proportion of S � 1.2 decreased for the reinforced specimens.',700)])
assert.equal(damagedComparator[0].kind,'artifact')
const mixedSizes = [item('A smaller sidebar sentence contributes its font size.',720,true,8),item('Another smaller sidebar sentence contributes its font size.',706,true,8),item('The main paragraph ends with a continuation. While',680,true,10)]
assert.equal(segmentsFromItems(2,mixedSizes).find(s=>s.source==='While').kind,'text')
console.log('PDF extraction passed: real PLOS engineering dimensions/subscript/caption/footer regressions and section boundaries.')
