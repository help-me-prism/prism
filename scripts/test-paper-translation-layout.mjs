import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/paperLayout.ts', 'utf8'), 'src/paper/paperLayout.ts')
const { placePaperBlocks, clearCropBoundary, sourceParagraphIndent } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const rect = (left,top,width,height) => ({left,top,width,height})
const blocks = [rect(40,40,240,80), rect(320,40,240,80), rect(40,140,240,50), rect(40,220,520,100), rect(40,340,240,40),rect(320,340,240,40)]
const positions = placePaperBlocks(blocks,[160,80,70,100,40,40],1)
assert.equal(positions[0],40)
assert.equal(positions[1],40) // growth in left column must not move the independent right column
assert.equal(positions[2],206)
assert(positions[3]>=positions[2]+70) // spanning figure waits for both columns
assert(positions[4]>=positions[3]+100)
assert(positions[5]>=positions[3]+100)
for (let i=0;i<blocks.length;i++) for(let j=i+1;j<blocks.length;j++) {
  const a=blocks[i], b=blocks[j]
  if(Math.min(a.left+a.width,b.left+b.width)>Math.max(a.left,b.left)) assert(positions[j]>=positions[i]+[160,80,70,100,40,40][i])
}
const scaled=placePaperBlocks([rect(40,40,240,80),rect(40,140,240,50)],[40,25],.5)
assert.deepEqual(scaled,[20,70])
// A small translation expansion consumes existing whitespace before moving
// the next paragraph; the original page coordinates remain the preferred tops.
assert.deepEqual(placePaperBlocks([rect(40,40,240,80),rect(40,140,240,50)],[90,50],1),[40,140])
assert.deepEqual(placePaperBlocks([rect(40,40,240,80),rect(40,140,240,50)],[45,25],.5),[20,70])
console.log('Paper translation layout passed: source margins, independent columns, expanded prose and spanning barriers without overlap.')

const metadata = [rect(40, 720, 200, 10), rect(40, 731, 80, 10)]
assert.equal(clearCropBoundary(725, metadata, 'before'), 718)
assert.equal(clearCropBoundary(725, metadata, 'after'), 743)
assert.equal(clearCropBoundary(700, metadata, 'after'), 700)

const indented = [rect(215, 100, 345, 10), rect(200, 113, 360, 10), rect(200, 126, 180, 10)]
assert.equal(sourceParagraphIndent(indented), 15)
assert.equal(sourceParagraphIndent(indented.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * .5])))), 7.5)
assert.equal(sourceParagraphIndent(indented.slice(0, 2)), 0, 'Two lines are insufficient evidence of a stable paragraph edge')
assert.equal(sourceParagraphIndent([rect(300, 100, 260, 10), ...indented.slice(1)]), 0, 'A split sentence must not become a huge first-line indent')
assert.equal(sourceParagraphIndent([indented[0], indented[1], rect(210, 126, 180, 10)]), 0, 'Centered or ragged-left lines do not establish a paragraph indent')
// Multiple exact glyph runs on a line, including a small raised scientific symbol,
// must not be mistaken for additional lines or change the paragraph edge.
assert.equal(sourceParagraphIndent([...indented, { ...rect(400, 114, 5, 6), fontSize: 10 }]), 15)
const preciseExcerpt = JSON.parse(await fs.readFile('scripts/fixtures/engineering-precise-excerpt.json', 'utf8'))
assert.equal(sourceParagraphIndent(preciseExcerpt.rects), 0, 'Actual p11 protected sentence begins mid-line, not at a paragraph indent')
const scientific = JSON.parse(await fs.readFile('scripts/fixtures/engineering-text-items.json', 'utf8'))
const densityRects = scientific.density.filter(item => item.height > 0).map(item => rect(item.transform[4], 800 - item.transform[5], item.width, item.height))
assert.equal(sourceParagraphIndent(densityRects), 0, 'Actual p4 continuation paragraph stays flush left')
console.log('Source paragraph indentation passed: scaled geometry, stable edges, scientific glyphs and actual engineering continuations.')
