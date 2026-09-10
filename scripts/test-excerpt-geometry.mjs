import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/excerptGeometry.ts', 'utf8'), 'src/paper/excerptGeometry.ts')
const { alignExcerptLines, alignedExcerptSlices, excerptSlices, mixedProseParagraphs } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-mixed-paragraph.json', 'utf8'))
const precise = JSON.parse(await fs.readFile('scripts/fixtures/engineering-precise-excerpt.json', 'utf8'))
const precisePlan = alignExcerptLines(precise.rects, precise.bounds)
assert.equal(precisePlan.aligned, true, 'Actual italic/symbol ink boxes must align with their unique containing text line')
assert.equal(precisePlan.slices[0].destinationRect.left, precise.bounds.left)
assert.deepEqual(precisePlan.slices.map(slice => slice.sourceRect), precise.rects)
assert.equal(new Set(precisePlan.slices.map(slice => Math.round((slice.sourceRect.top - precise.bounds.top) / 13))).size, 3)
for (const slice of precisePlan.slices) {
  assert.equal(slice.sourceRect.top, slice.destinationRect.top)
  assert.equal(slice.sourceRect.width * slice.sourceRect.height, slice.destinationRect.width * slice.destinationRect.height)
}
for (const indices of [[0], [1, 2, 3], [4, 5, 6, 7]]) {
  const shifts = indices.map(i => precisePlan.slices[i].destinationRect.left - precisePlan.slices[i].sourceRect.left)
  assert(shifts.every(dx => Math.abs(dx - shifts[0]) < 1e-8))
}
const rects = fixture.segments.find(segment => segment.id === 'p11-s3-syk2f8').rects
const bounds = { left: 200.012, top: 431.807, width: 370, height: 40 }
const result = alignExcerptLines(rects, bounds)
assert.equal(result.aligned, true)
assert.equal(result.slices[0].destinationRect.left, bounds.left)
assert(result.slices[0].sourceRect.left > 500, 'The crop must still read from the original right-hand sentence fragment')
assert.deepEqual(result.slices.map(slice => slice.sourceRect), rects, 'Source slices and their original order must remain exact; no surrounding pixels may be added')
for (const slice of result.slices) {
  assert.equal(slice.sourceRect.width, slice.destinationRect.width)
  assert.equal(slice.sourceRect.height, slice.destinationRect.height)
  assert.equal(slice.sourceRect.top, slice.destinationRect.top)
}
const runs = [{ left: 80, top: 20, width: 10, height: 10 }, { left: 105, top: 20.2, width: 15, height: 10 }]
const line = alignExcerptLines(runs, { left: 0, top: 0, width: 150, height: 100 })
assert.equal(line.slices[1].destinationRect.left - line.slices[0].destinationRect.left, 25, 'Inline symbol gaps must not be reflowed')
assert.equal(line.slices[1].destinationRect.top, 20.2)
for (const ambiguous of [
  [{ left: 0, top: 10, width: 20, height: 10 }, { left: 30, top: 15, width: 20, height: 10 }],
  [{ left: 0, top: 10, width: 20, height: 10 }, { left: 10, top: 10, width: 20, height: 10 }],
  [{ left: 0, top: 10, width: -1, height: 10 }],
  [{ left: NaN, top: 10, width: 20, height: 10 }],
]) {
  const fallback = alignExcerptLines(ambiguous, { left: 0, top: 0, width: 150, height: 100 })
  assert.equal(fallback.aligned, false); assert(fallback.reason)
  assert.deepEqual(fallback.slices.map(slice => slice.destinationRect), ambiguous)
}
console.log('excerpt-geometry: real p11 exact crop alignment, dimensions/order/gaps preserved, ambiguous geometry unchanged')

// Retain the original clipping and neighboring-pixel regressions.
{
const segments = fixture.segments
const bounds=rs=>{const left=Math.min(...rs.map(r=>r.left)),top=Math.min(...rs.map(r=>r.top));return{left,top,width:Math.max(...rs.map(r=>r.left+r.width))-left,height:Math.max(...rs.map(r=>r.top+r.height))-top}}
const protectedRects = segments.find(segment => segment.kind === 'artifact').rects
const protectedBounds = bounds(protectedRects)
const aligned = alignedExcerptSlices(protectedBounds, protectedRects)
assert(protectedRects[0].left > protectedBounds.left + 20, 'Protected fixture must start at the right of a shared source line')
assert.equal(aligned[0].destination.left, protectedBounds.left)
assert.deepEqual(aligned.map(item => item.source), protectedRects)
for (const a of aligned) for (const b of aligned) if (Math.abs(a.source.top - b.source.top) < .1) assert(Math.abs((a.destination.left - a.source.left) - (b.destination.left - b.source.left)) < 1e-8, 'All fragments in the same line must share one dx')
const superscript = [{ left: 40, top: 20, width: 40, height: 10 }, { left: 82, top: 16, width: 5, height: 6 }]
assert.deepEqual(alignedExcerptSlices({ left: 0, top: 0, width: 150, height: 100 }, superscript), superscript.map(source => ({ source, destination: source })), 'Ambiguous superscript baselines must remain unchanged')
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
}
