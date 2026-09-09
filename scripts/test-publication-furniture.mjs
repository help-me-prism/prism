import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/publicationFurniture.ts', 'utf8'), 'src/paper/publicationFurniture.ts')
const { publicationDoiRects } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-doi-items.json', 'utf8'))
const items = fixture.items.map(item => ({ text: item.str, left: item.transform[4], top: 792 - item.transform[5] - item.height * .8, width: item.width, height: item.height }))
const restored = publicationDoiRects(items, [], 612, 792)
assert.equal(restored.length, 2, 'Restore actual table and figure DOI lines; the footer stays in its existing strip')
assert.equal(publicationDoiRects(items, restored, 612, 792).length, 0, 'Already-painted links cannot be painted twice')
assert.equal(publicationDoiRects(items, [{ left: 0, top: 0, width: 612, height: 792 }], 612, 792).length, 0)
const scaleRect = rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, typeof value === 'number' ? value * .5 : value]))
assert.deepEqual(publicationDoiRects(items.map(scaleRect), [], 306, 396), restored.map(scaleRect), 'Fit/zoom preserves crop geometry')
const first = items.find(item => item.text.endsWith('.t001'))
assert.equal(publicationDoiRects([{ ...first, text: `See ${first.text} for details.` }], [], 612, 792).length, 0, 'Do not duplicate translated prose that mentions a DOI')
assert.equal(publicationDoiRects([{ ...first, left: NaN }], [], 612, 792).length, 0)
assert.equal(publicationDoiRects([first, first], [], 612, 792).length, 1)
console.log('Publication DOI preservation passed: real table/figure lines, footer/prose exclusion, duplicate regions and zoom.')
