import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const load = async file => {
  const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { joinBitmapRegions, joinVectorRegions } = await load('src/paper/figureGeometry.ts')
const { tableMemberIndexes } = await load('src/paper/tableRegions.ts')
const { mayMaskExcerpt } = await load('src/paper/excerptGeometry.ts')
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
const tableSegments = [{kind:'artifact',source:'Earlier damaged prose still ends here.'},{kind:'caption',source:'Table 2. Results.'},{kind:'text',source:'Model Score'},{kind:'artifact',source:'Base 30.1'},{kind:'equation',source:'Ours $x_i$ 33.8'},{kind:'text',source:'The discussion starts here.'}]
assert.deepEqual(tableMemberIndexes(tableSegments,1),[1,2,3,4],'Table range includes text and math cells but stops at prose')
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'table-row' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'table' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'equation' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'mixed' }], new Set(['mixed']), new Set()), true, 'Precise protected prose still masks neighboring sentences')
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'mixed' }], new Set(['mixed']), new Set(['mixed'])), false)
console.log('Figure geometry passed: real engineering table outer rules, page-background exclusion, independent figure, zoom and safe prose masking.')
