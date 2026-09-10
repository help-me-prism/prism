import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const load = async file => {
  const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { joinVectorRegions } = await load('src/paper/figureGeometry.ts')
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
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'table-row' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'table' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'equation' }], new Set(), new Set()), false)
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'mixed' }], new Set(['mixed']), new Set()), true, 'Precise protected prose still masks neighboring sentences')
assert.equal(mayMaskExcerpt([{ kind: 'artifact', blockId: 'mixed' }], new Set(['mixed']), new Set(['mixed'])), false)
console.log('Figure geometry passed: real engineering table outer rules, page-background exclusion, independent figure, zoom and safe prose masking.')
