import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/paperLayout.ts', 'utf8'), 'src/paper/paperLayout.ts')
const { placePaperBlocks, clearCropBoundary, sourceParagraphIndent, sourceParagraphLineHeight } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
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

const sourceLines = scientific.density.slice(0, 4).map(item => ({ ...rect(item.transform[4], 800 - item.transform[5], item.width, item.height), fontSize: item.height }))
const leading = sourceParagraphLineHeight(sourceLines, 10.8)
const actualProse = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-prose-leading.json', 'utf8'))
assert.equal(sourceParagraphLineHeight(actualProse.rects, 10.8), 1.35, 'Actual precise glyph rectangles including rho/subscript must retain the body line pitch')
assert.equal(leading, 1.35, 'Actual p4 ~13pt source leading uses the Korean safety floor instead of fixed 15.984pt leading')
assert(leading * 10.8 < 1.48 * 10.8 && leading * 10.8 >= 13.039)
const scaledLines = sourceLines.map(line => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, value * .5])))
assert.equal(sourceParagraphLineHeight(scaledLines, 5.4), leading, 'PDF fit/zoom must not change relative leading')
assert.equal(sourceParagraphLineHeight([...sourceLines, { ...rect(380, sourceLines[1].top + 1, 4, 5), fontSize: 5.33 }], 10.8), leading, 'A raised/subscript glyph cannot become its own line')
assert.equal(sourceParagraphLineHeight(sourceLines.slice(0, 2), 10.8), undefined)
assert.equal(sourceParagraphLineHeight(sourceLines.map((line, index) => index === 2 ? { ...line, top: line.top + 5 } : line), 10.8), undefined, 'Irregular paragraph/equation gaps do not establish leading')
assert.equal(sourceParagraphLineHeight(sourceLines.map((line, index) => index === 2 ? { ...line, left: line.left + 220 } : line), 10.8), undefined, 'Alternating columns cannot establish leading')
assert.equal(sourceParagraphLineHeight(sourceLines.map((line, index) => index > 1 ? { ...line, fontSize: 16 } : line), 10.8), undefined, 'Mixed heading/body sizes retain fallback')
assert.equal(sourceParagraphLineHeight(preciseExcerpt.rects, 10.8), undefined, 'Actual p11 sentence begins halfway across a line; do not infer paragraph leading')
assert.equal(sourceParagraphLineHeight([{ ...sourceLines[0], top: NaN }, ...sourceLines.slice(1)], 10.8), undefined)
console.log('Source leading passed: actual engineering pitch, Korean safety floor, scaling, raised symbols and ambiguous-layout fallback.')

// Actual public PDF text items at narrow-pane scales: the 5px interaction
// minimum must never become the nominal font size of translated text.
const itemGeometryCode = await transformWithOxc(await fs.readFile('src/paper/itemGeometry.ts', 'utf8'), 'src/paper/itemGeometry.ts')
const { textItemRect, segmentRects } = await import('data:text/javascript;base64,' + Buffer.from(itemGeometryCode.code).toString('base64'))
const { Util } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdfFixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-doi-items.json', 'utf8'))
const pdfItems = pdfFixture.items.filter(item => item.str && item.height > 0)
assert(pdfItems.length > 0)
for (const scale of [.15, .4, .5, 1, 2]) {
  // PDF.js viewport transform for this unrotated, zero-origin 612x792 page.
  const viewport = { transform: [scale, 0, 0, -scale, 0, pdfFixture.page.height * scale] }
  for (const item of pdfItems) {
    const tx = Util.transform(viewport.transform, item.transform)
    const box = textItemRect(tx, item.width, scale, .8, item.str)
    const nominal = Math.hypot(item.transform[2], item.transform[3]) * scale
    assert(Math.abs(box.fontSize - nominal) < 1e-8)
    assert.equal(box.height, Math.max(5, nominal), 'Keep existing clickable/crop bounds')
    for (const segment of [{ itemIndexes: [0] }, { itemSlices: [{ itemIndex: 0, start: .2, end: .8 }] }]) {
      const [fallback] = segmentRects(segment, [box], scale)
      assert.equal(fallback.fontSize, nominal, 'Slices and whole-item fallback retain uncapped em, without scaling twice')
      assert(Math.abs((fallback.fontSize ?? fallback.height) * 1.08 - nominal * 1.08) < 1e-8)
    }
    const [precise] = segmentRects({ preciseRects: [{ left: 10, top: 20, width: 30, height: 7, fontSize: nominal / scale }] }, [], scale)
    assert(Math.abs(precise.fontSize - nominal) < 1e-8, 'Validated geometry remains equivalent in nominal font size')
    if (scale === .5 && item.height < 8.01) assert(box.height / box.fontSize > 1.24, 'Fixture actually reproduces the previous 25% font inflation')
  }
}
console.log('Real PDF fallback font geometry passed at 15%, 40%, 50%, 100%, 200%: hit bounds isolated from nominal em; precise and fallback scaling agree.')
const stamp = textItemRect([0,12,12,0,22,100],132,1,.8,'HHMI Author Manuscript')
assert(Math.abs(stamp.width-12)<1e-8)
assert.equal(stamp.height,132)
assert(stamp.left+stamp.width<40,'Rotated manuscript stamp stays in the margin')
const halfStamp = segmentRects({itemSlices:[{itemIndex:0,start:.5,end:1}]},[stamp])[0]
assert.equal(halfStamp.top,166)
assert.equal(halfStamp.height,66)
