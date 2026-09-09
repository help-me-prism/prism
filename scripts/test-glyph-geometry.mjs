import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/paper/glyphAlignment.ts','utf8'),'src/paper/glyphAlignment.ts')
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
