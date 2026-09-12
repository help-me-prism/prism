import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const load = async file => {
  const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { figureRegionWithCaption, joinBitmapRegions, joinVectorRegions, sourceFigureRegion } = await load('src/paper/figureGeometry.ts')
const { tableMemberIndexes, tableRegionFromEvidence } = await load('src/paper/tableRegions.ts')
const { mayMaskExcerpt } = await load('src/paper/excerptGeometry.ts')
const { durableAnchorPreview } = await load('src/paper/anchorPreview.ts')
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p5-table-vectors.json', 'utf8'))
const area = fixture.page.width * fixture.page.height
const regions = joinVectorRegions(fixture.rects, 1, area)
const table = regions.find(rect => rect.top < 100 && rect.width > 500)
assert(table, 'Actual engineering p5 table must survive the page-sized background path')
assert(Math.abs(table.left - 36) < .01 && Math.abs(table.top - 88.111) < .01)
assert(Math.abs(table.width - 540) < .01 && Math.abs(table.height - 137.999) < .01, 'Keep outer rules and all eleven table rows, not just glyph bounds')
for (const stroke of fixture.rects.filter(rect => rect.top >= 88 && rect.top + rect.height <= 227)) {
  assert(stroke.left >= table.left && stroke.left + stroke.width <= table.left + table.width && stroke.top >= table.top && stroke.top + stroke.height <= table.top + table.height)
}
assert(regions.some(rect => rect.top > 390 && rect.width === 360), 'Separate lower figure remains a separate region')
assert.deepEqual(joinVectorRegions(fixture.rects.map(rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * .5]))), .5, area * .25), regions.map(rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * .5]))))
const panels = joinBitmapRegions([{left:40,top:100,width:180,height:120},{left:230,top:102,width:180,height:118},{left:40,top:400,width:370,height:110}],1,612*792)
assert.equal(panels.length,2,'Adjacent aligned bitmap panels join, while a distant figure stays separate')
assert.deepEqual(panels[0],{left:40,top:100,width:370,height:120})
const wrapped = sourceFigureRegion([{left:385,top:457,width:119,height:10}],[{relativeWidth:.13,row:0,pixelWidth:600,pixelHeight:600},{relativeWidth:.13,row:0,pixelWidth:600,pixelHeight:600}],612,108,504,1,true)
assert(wrapped && wrapped.top > 370 && wrapped.height < 80 && wrapped.left >= 380,'A short wrapped two-panel figure stays near its caption instead of covering the column above it')
const fullWidth = sourceFigureRegion([{left:108,top:269,width:396,height:10}],[{relativeWidth:.32,row:0,pixelWidth:596,pixelHeight:200},{relativeWidth:.32,row:0,pixelWidth:596,pixelHeight:200},{relativeWidth:.32,row:0,pixelWidth:596,pixelHeight:200}],612,108,504,1,true)
assert(fullWidth && fullWidth.top > 195 && fullWidth.height < 75 && fullWidth.left >= 105,'A wide three-panel figure does not absorb the preceding table or prose')
assert.equal(sourceFigureRegion([{left:108,top:269,width:396,height:10}],[],612,108,504,1,true),undefined,'Unknown figure dimensions never trigger a broad guessed crop')
assert.deepEqual(figureRegionWithCaption({left:100,top:100,width:400,height:180},[{left:110,top:287,width:380,height:25}],1),{left:100,top:100,width:400,height:212},'A caption below a figure becomes part of the tagged region')
assert.deepEqual(figureRegionWithCaption({left:100,top:130,width:400,height:180},[{left:110,top:96,width:380,height:25}],1),{left:100,top:96,width:400,height:214},'A caption above a figure becomes part of the tagged region')
assert.deepEqual(figureRegionWithCaption({left:100,top:100,width:400,height:180},[{left:110,top:370,width:380,height:25}],1),{left:100,top:100,width:400,height:180},'Distant prose is not absorbed as a caption')
const tableSegments = [{kind:'artifact',source:'Earlier damaged prose still ends here.'},{kind:'caption',source:'Table 2. Results.'},{kind:'text',source:'Model Score'},{kind:'artifact',source:'Base 30.1'},{kind:'equation',source:'Ours $x_i$ 33.8'},{kind:'text',source:'The discussion starts here.'}]
assert.deepEqual(tableMemberIndexes(tableSegments,1),[1,2,3,4],'Table range includes text and math cells but stops at prose')
const rect = (left,top,width=390,height=14) => [{left,top,width,height}]
const captionBelow = [
  {kind:'artifact',source:'Model K=1 K=20 K=50',page:21,preciseRects:rect(108,100)},
  {kind:'artifact',source:'Ours 3.11 3.01 2.99',page:21,preciseRects:rect(108,125)},
  {kind:'table',source:'Table 4. Likelihood results.',page:21,preciseRects:rect(108,150)},
  {kind:'artifact',source:'0 100 200 300 400 500',page:21,preciseRects:rect(108,260)},
  {kind:'artifact',source:'Epochs',page:21,preciseRects:rect(260,280,45)},
  {kind:'caption',source:'Figure 10: Function evaluations.',page:21,preciseRects:rect(108,340)},
]
assert.deepEqual(tableMemberIndexes(captionBelow,2),[0,1,2],'A caption below its table chooses the dense aligned side and does not absorb the following chart')
const captionAbove = [
  {kind:'table',source:'Table 2. Results.',page:5,preciseRects:rect(108,80)},
  {kind:'text',source:'Model Accuracy',page:5,preciseRects:rect(108,105)},
  {kind:'artifact',source:'Base 30.1 Ours 33.8',page:5,preciseRects:rect(108,130)},
  {kind:'text',source:'The discussion begins here.',page:5,preciseRects:rect(108,190)},
]
assert.deepEqual(tableMemberIndexes(captionAbove,0),[0,1,2],'A caption above its table includes cell text but stops at separated prose')
const tableAboveCaption = tableRegionFromEvidence([{ left: 90, top: 110, width: 420, height: 90 }, { left: 105, top: 208, width: 390, height: 18 }], [{ left: 88, top: 105, width: 424, height: 97 }, { left: 100, top: 310, width: 400, height: 190 }], 1)
assert.deepEqual({ index: tableAboveCaption.index, rect: tableAboveCaption.rect }, { index: 0, rect: { left: 88, top: 105, width: 424, height: 121 } }, 'A caption below the grid is included in one table region')
const tableBelowCaption = tableRegionFromEvidence([{ left: 110, top: 80, width: 370, height: 18 }, { left: 100, top: 110, width: 390, height: 120 }], [{ left: 98, top: 106, width: 394, height: 126 }, { left: 120, top: 300, width: 350, height: 210 }], 1)
assert.deepEqual({ index: tableBelowCaption.index, rect: tableBelowCaption.rect }, { index: 0, rect: { left: 98, top: 80, width: 394, height: 152 } }, 'A caption above the grid is included in one table region')
const unruledTable = tableRegionFromEvidence([{ left: 100, top: 100, width: 380, height: 140 }], [{ left: 110, top: 280, width: 360, height: 220 }], 1)
assert.deepEqual(unruledTable, { rect: { left: 100, top: 100, width: 380, height: 140 } }, 'Text evidence remains a safe table region when no ruled region matches')
const ruledTable = tableRegionFromEvidence([{ left: 100, top: 100, width: 380, height: 140 }], [], 1, [{ left: 94, top: 96, width: 392, height: 1 }, { left: 94, top: 244, width: 392, height: 1 }, { left: 94, top: 600, width: 392, height: 1 }])
assert.deepEqual(ruledTable.rect, { left: 94, top: 96, width: 392, height: 149 }, 'A table grows to the rules drawn above and below it, and ignores one far away')
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'table-row' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'table' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'equation' }], new Set(), new Set()), false)
const cropAnchor = { type: 'table', preview: 'data:image/jpeg;base64,small' }
assert.equal(durableAnchorPreview(cropAnchor).preview, cropAnchor.preview, 'Compact text/table crops survive chat and draft persistence')
assert.equal('preview' in durableAnchorPreview({ type: 'figure', preview: cropAnchor.preview }), false, 'Saved figures do not duplicate image bytes in session storage')
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'mixed' }], new Set(['mixed']), new Set()), true, 'Precise protected prose still masks neighboring sentences')
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'mixed' }], new Set(['mixed']), new Set(['mixed'])), false)
console.log('Figure geometry passed: real engineering table outer rules, page-background exclusion, independent figure, zoom and safe prose masking.')

// A grid whose cells the PDF emitted column by column: the rows never become
// neighbours in reading order, so joinPreservedRegions leaves several regions
// over one table and the reader draws a marker on each. Geometry recovers them.
const { mergeOverlappingRegions } = await load('src/paper/preservedRegions.ts')
const scattered = [
  { id: 'r1', items: [{ kind: 'table' }], rect: { left: 146, top: 138, width: 210, height: 11 } },
  { id: 'r2', items: [{ kind: 'table' }], rect: { left: 116, top: 132, width: 386, height: 34 } },
  { id: 'r3', items: [{ kind: 'table' }], rect: { left: 118, top: 185, width: 14, height: 10 } },
  { id: 'r4', items: [{ kind: 'table' }], rect: { left: 119, top: 169, width: 375, height: 66 } },
]
assert.equal(mergeOverlappingRegions(scattered).length, 1, 'Interleaved rows of one table become one region')
assert.deepEqual(mergeOverlappingRegions(scattered)[0].rect, { left: 116, top: 132, width: 386, height: 103 })
// Prose between two tables keeps them apart, whatever their columns look like.
const separated = [
  { id: 'a', items: [{ kind: 'table' }], rect: { left: 116, top: 100, width: 380, height: 40 } },
  { id: 'b', items: [{ kind: 'table' }], rect: { left: 116, top: 148, width: 380, height: 40 } },
]
assert.equal(mergeOverlappingRegions(separated, [{ left: 116, top: 142, width: 380, height: 4 }]).length, 2, 'A paragraph between two tables stops the merge')
assert.equal(mergeOverlappingRegions(separated).length, 1, 'Without prose between them the same two are one table')
console.log('Preserved region merge passed: interleaved table rows, prose barrier.')
