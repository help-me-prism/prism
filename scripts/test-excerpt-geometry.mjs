import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/paper/excerptGeometry.ts','utf8'),'src/paper/excerptGeometry.ts')
const {excerptSlices,mixedProseParagraphs}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const {segments}=JSON.parse(await fs.readFile('scripts/fixtures/engineering-mixed-paragraph.json','utf8'))
const bounds=rs=>{const left=Math.min(...rs.map(r=>r.left)),top=Math.min(...rs.map(r=>r.top));return{left,top,width:Math.max(...rs.map(r=>r.left+r.width))-left,height:Math.max(...rs.map(r=>r.top+r.height))-top}}
const area=r=>r.width*r.height
const overlap=(a,b)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top))
const runs=[segments.slice(0,6),segments.slice(6,7),segments.slice(7)].map(items=>items.flatMap(s=>s.rects))
assert(overlap(bounds(runs[0]),bounds(runs[1]))>1000,'Real fixture must reproduce the shared first line')
assert(overlap(bounds(runs[1]),bounds(runs[2]))>1000,'Real fixture must reproduce the shared last line')
// Both the protected sentence and the surrounding original-text runs must avoid
// repainting characters belonging to their neighbors, while retaining every own slice.
for(let i=0;i<runs.length;i++) {
  const painted=excerptSlices(bounds(runs[i]),runs[i])
  assert(Math.abs(painted.reduce((sum,r)=>sum+area(r),0)-runs[i].reduce((sum,r)=>sum+area(r),0))<1e-5)
  for(let j=0;j<runs.length;j++)if(i!==j) {
    const duplicated=painted.reduce((sum,a)=>sum+runs[j].reduce((subtotal,b)=>subtotal+overlap(a,b),0),0)
    assert(duplicated<1e-5,`Run ${i} must not paint neighboring run ${j}: ${duplicated}`)
  }
}
assert(mixedProseParagraphs(segments).has('pdf-p11-b0'))
assert.equal(mixedProseParagraphs([{kind:'text',blockId:'equation'},{kind:'artifact',blockId:'equation'},{kind:'equation',blockId:'equation'}]).size,0,'Equation fraction bars must keep full-region crops')
assert.equal(mixedProseParagraphs([{kind:'text',blockId:'table'},{kind:'artifact',blockId:'table'},{kind:'table',blockId:'table'}]).size,0,'Table rules must keep full-region crops')
assert.deepEqual(excerptSlices({left:10,top:10,width:20,height:20},[{left:0,top:0,width:15,height:15},{left:40,top:40,width:2,height:2}]),[{left:10,top:10,width:5,height:5}])
console.log('Excerpt geometry passed: real partial-line artifact and original prose slices cannot repaint neighboring sentences; equations/tables stay unmasked.')
