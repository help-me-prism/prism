import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/paper/flowProseGeometry.ts','utf8'),'flowProseGeometry.ts')
const {flowProseLines,blankGutterPieces}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
// A protected sentence begins at the end of one source line. Its next line includes
// a small comparator glyph. Keep exact pixels and within-line spacing at the same em scale.
const rects=[{left:310,top:100,width:90,height:10,fontSize:10},{left:100,top:114,width:120,height:10,fontSize:10},{left:224,top:116,width:8,height:7,fontSize:10},{left:234,top:114,width:166,height:10,fontSize:10}]
const plan=flowProseLines(rects)
assert.equal(plan.length,2)
assert.equal(plan[0].widthEm,9)
assert.equal(plan[1].widthEm,30)
assert.equal(plan[1].heightEm,1)
assert.deepEqual(plan.flatMap(line=>line.slices),rects)
assert.equal(plan[1].slices[1].left-plan[1].rect.left,124, 'Comparator position must remain unchanged within its line')
// Source viewport scaling must cancel: matching font size follows the surrounding flow em.
const twice=flowProseLines(rects.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v*2]))))
assert.deepEqual(twice.map(r=>[r.widthEm,r.heightEm]),plan.map(r=>[r.widthEm,r.heightEm]))
assert.equal(flowProseLines([{left:0,top:0,width:10,height:10}]),undefined)
assert.equal(flowProseLines([{left:0,top:0,width:10,height:10,fontSize:NaN}]),undefined)
console.log('Flow prose pixels: exact slice preservation, comparator spacing, left-aligned lines and viewport-independent em sizing passed')
const width=44,height=10
const rgba=new Uint8ClampedArray(width*height*4).fill(255)
const ink=(x,y,value=0)=>{const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=value}
// Word, ≥, word: comparator's upper/lower strokes jointly occupy every symbol column.
for(let x=0;x<10;x++) ink(x,4)
for(let x=15;x<24;x++){ink(x,Math.abs(x-19));ink(x,8)}
for(let x=29;x<44;x++) ink(x,4)
// A tiny inter-letter gap inside the last word is not a legal wrap boundary.
for(let y=0;y<height;y++){const i=(35+y*width)*4;rgba[i]=rgba[i+1]=rgba[i+2]=255}
const pieces=blankGutterPieces(rgba,width,height,10)
assert.deepEqual(pieces,[{left:0,width:12},{left:12,width:14},{left:26,width:18}])
for(const part of pieces.slice(1)) for(let y=0;y<height;y++) assert.equal(rgba[(y*width+part.left)*4],255,'Every cut must be entirely blank, never a comparator stroke')
assert.equal(pieces.reduce((n,p)=>n+p.width,0),width,'No pixel column may be lost')
// Even almost-white antialias ink prevents a split, and long unbreakable runs remain whole.
const unbroken=new Uint8ClampedArray(100*height*4).fill(255)
for(let x=0;x<100;x++) unbroken[(4*100+x)*4]=254
assert.deepEqual(blankGutterPieces(unbroken,100,height,10),[{left:0,width:100}])
assert.deepEqual(blankGutterPieces(new Uint8ClampedArray(),100,height,10),[])
console.log('Blank gutters: ≥ strokes intact, tiny letter gaps rejected, all pixel columns preserved, long unbreakable fallback passed')
