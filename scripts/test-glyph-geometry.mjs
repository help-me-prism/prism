import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const sharedCode = await transformWithOxc(await fs.readFile('electron/scientificSource.ts', 'utf8'), 'electron/scientificSource.ts')
const sharedUrl = 'data:text/javascript;base64,' + Buffer.from(sharedCode.code).toString('base64')
const glyphSource = (await fs.readFile('src/paper/glyphAlignment.ts','utf8')).replaceAll("'../../electron/scientificSource'", JSON.stringify(sharedUrl))
const {code}=await transformWithOxc(glyphSource,'src/paper/glyphAlignment.ts')
const {alignGlyphGeometry}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const fixture=JSON.parse(await fs.readFile('scripts/fixtures/engineering-p11-glyphs.json','utf8'))
const expected=fixture.glyphs.map(({unicode,fontChar,fontRef})=>({unicode,fontChar,fontRef}))
const paints=fixture.glyphs.map(g=>({...g,char:g.fontChar,font:`16px "${g.fontRef}"`}))
const result=alignGlyphGeometry(expected,paints,fixture.items,fixture.segments)
assert.equal(result.ok,true, result.reason)
const paragraph=JSON.parse(await fs.readFile('scripts/fixtures/engineering-mixed-paragraph.json','utf8')).segments
const artifact=paragraph.find(s=>s.kind==='artifact'), following=paragraph[paragraph.indexOf(artifact)+1]
assert(Math.abs(result.rectangles.get(artifact.id)[0].left-434.719)<.001,'Compared C must not start at proportional442.395')
assert(Math.abs(result.rectangles.get(following.id)[0].left-546.516)<.001,'When W must not start at proportional555.101')
assert(result.rectangles.get(artifact.id).every(rect=>rect.fontSize===10),'Layout font size must remain10pt, not smaller ink height')
assert.equal(alignGlyphGeometry(expected,paints.slice(1),fixture.items,fixture.segments).ok,false)
const wrongFont=paints.map((p,i)=>i===0?{...p,font:'16px "different-font"'}:p)
assert.equal(alignGlyphGeometry(expected,wrongFont,fixture.items,fixture.segments).ok,false)
assert.equal(alignGlyphGeometry(expected,paints,[...fixture.items].reverse(),fixture.segments).ok,false)
const ligature=[{unicode:'ﬁ',fontChar:'x',fontRef:'test'}]
const paint=[{char:'x',font:'16px test',x:0,y:10,matrix:[1,0,0,1,0,0],metrics:{left:0,right:6,ascent:8,descent:0}}]
const ligatureItems=[{str:'fi',height:10}]
assert.equal(alignGlyphGeometry(ligature,paint,ligatureItems,[{id:'whole',itemSlices:[{itemIndex:0,start:0,end:1}]}]).ok,true)
assert.equal(alignGlyphGeometry(ligature,paint,ligatureItems,[{id:'f',itemSlices:[{itemIndex:0,start:0,end:.5}]},{id:'i',itemSlices:[{itemIndex:0,start:.5,end:1}]}]).ok,false,'A ligature cannot be clipped between sentences')
assert.equal(alignGlyphGeometry(ligature,paint,[{str:' f i ',height:10}],[{id:'whole',itemIndexes:[0]}]).ok,true,'PDF whitespace insertions keep exact glyph alignment')
console.log('Glyph geometry passed: all65 real p11 items align; complete C/W ink, original10pt sizing, mismatch rejection and indivisible ligatures.')

for (const segment of fixture.segments) assert(result.rectangles.get(segment.id).length <= (segment.itemSlices?.length ?? segment.itemIndexes?.length ?? 0), 'Layout must not create a DOM element per painted character')

const inline = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-inline-glyphs.json', 'utf8'))
const alignedInline = alignGlyphGeometry(inline.expected, inline.painted, inline.items, inline.segments)
assert.equal(alignedInline.ok, true, alignedInline.reason)
const spans = [...alignedInline.scientificSpans.values()].flat()
assert.deepEqual(spans.map(s => [s.text, s.latex]), [['ρ 0', '\\rho_{0}'], ['m0', 'm_{0}']])
for (const segment of inline.segments) {
  const [span] = alignedInline.scientificSpans.get(segment.id)
  assert.equal(segment.source.slice(span.start, span.end), span.text)
  assert.equal(span.rect.fontSize, 10, 'Measured base paint font, not misleading item-level size')
  assert(span.baseline > span.rect.top && span.baseline < span.rect.top + span.rect.height, 'Baseline keeps the actual subscript ink below surrounding prose')
  const following = inline.painted.find((g, i) => inline.expected[i].unicode === (span.text === 'm0' ? 'a' : 'o') && g.x > span.rect.left && Math.abs(g.y - (span.text === 'm0' ? 285.619 : 214.979)) < .01)
  assert(following && span.rect.left + span.rect.width < following.x, 'Scientific crop must exclude following normal prose')
}
// Removing source metadata remains compatible and never guesses UTF-16 offsets.
assert.equal(alignGlyphGeometry(inline.expected, inline.painted, inline.items, inline.segments.map(({source,...s})=>s)).scientificSpans.size, 0)
assert.equal(alignGlyphGeometry(inline.expected, inline.painted, inline.items, inline.segments.map(s=>({...s,source:'Different '+s.source}))).scientificSpans.size, 0)
const plain = inline.painted.map((g,i) => inline.expected[i].unicode === '0' ? {...g,matrix:[.625,0,0,.625,g.matrix[4],g.matrix[5]]} : g)
assert.equal(alignGlyphGeometry(inline.expected, plain, inline.items, inline.segments).scientificSpans.size, 0, 'Normal-sized digits are not subscripts even when positioned lower')
const raised = inline.painted.map((g,i) => inline.expected[i].unicode === '0' ? {...g,y:g.y-3.29} : g)
assert.equal(alignGlyphGeometry(inline.expected, raised, inline.items, inline.segments).scientificSpans.size, 0, 'Raised numeric footnotes are not silently interpreted as variable exponents')
const distant = inline.painted.map((g,i) => inline.expected[i].unicode === '0' ? {...g,x:g.x+10} : g)
assert.equal(alignGlyphGeometry(inline.expected, distant, inline.items, inline.segments).scientificSpans.size, 0, 'Unrelated nearby numbers cannot attach to a variable')
const noSize = inline.painted.map(g=>({...g,font:g.font.replace('16px','1em')}))
assert.equal(alignGlyphGeometry(inline.expected, noSize, inline.items, inline.segments).scientificSpans.size, 0, 'No item-font fallback may manufacture scientific semantics')
const geometryOnly = alignGlyphGeometry(inline.expected, inline.painted, inline.items, inline.segments.map(({source,...s})=>s))
assert.deepEqual([...alignedInline.rectangles], [...geometryOnly.rectangles], 'Scientific metadata cannot change existing source crop geometry')
console.log('Scientific source spans passed: real p4 rho/m subscripts, exact UTF-16 slices and ink crops, plain digits/footnotes/ambiguous fonts excluded; legacy rectangle behavior unchanged.')

const chromium = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-inline-chromium-glyphs.json', 'utf8'))
for (const scale of [.5, 1, 2]) {
  const paints = chromium.painted.map(g=>({...g,x:g.x*scale,y:g.y*scale,matrix:g.matrix.map(v=>v*scale)}))
  const actual = alignGlyphGeometry(chromium.expected, paints, chromium.items, chromium.segments)
  assert.equal(actual.ok, true, actual.reason)
  assert.deepEqual([...actual.scientificSpans.values()].flat().map(s=>s.latex), ['\\rho_{0}', 'm_{0}'], 'Chromium italic overhang is not a negative text advance')
  for (const span of [...actual.scientificSpans.values()].flat()) assert.equal(span.rect.fontSize, 10*scale)
}
const zeroIndexes = chromium.expected.flatMap((g,i)=>g.unicode==='0'?[i]:[])
const overlappingOrigins = chromium.painted.map((g,i)=>zeroIndexes.includes(i)?{...g,x:chromium.painted[i-1].x}:g)
assert.equal(alignGlyphGeometry(chromium.expected, overlappingOrigins, chromium.items, chromium.segments).scientificSpans.size, 0, 'Ink overlap is allowed; identical paint origins are not attached subscripts')
const reversedOrigins = chromium.painted.map((g,i)=>zeroIndexes.includes(i)?{...g,x:chromium.painted[i-1].x-1}:g)
assert.equal(alignGlyphGeometry(chromium.expected, reversedOrigins, chromium.items, chromium.segments).scientificSpans.size, 0, 'A number before its base origin cannot be attached')
const distantOrigins = chromium.painted.map((g,i)=>zeroIndexes.includes(i)?{...g,x:chromium.painted[i-1].x+20}:g)
assert.equal(alignGlyphGeometry(chromium.expected, distantOrigins, chromium.items, chromium.segments).scientificSpans.size, 0, 'A far number on the same lower baseline cannot be attached')
console.log('Actual Chromium scientific glyphs passed: italic rho overhang, scale invariance, and same/reversed/distant origin rejection.')
