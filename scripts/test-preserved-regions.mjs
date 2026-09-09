import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/paper/preservedRegions.ts','utf8'),'src/paper/preservedRegions.ts')
const {joinPreservedRegions}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const block=(id,kind,left,top,width,height)=>({id,items:[{kind}],rect:{left,top,width,height}})
// Separate numerator and denominator fragments of the same original fraction.
const numerator=block('n','artifact',350,240,45,14)
const denominator=block('d','artifact',375,252,200,12)
const fraction=joinPreservedRegions([numerator,denominator])
assert.equal(fraction.length,1)
assert.deepEqual(fraction[0].rect,{left:350,top:240,width:225,height:24})
assert.equal(fraction[0].items.length,2)
// Never bridge explanatory prose, separate columns, or a large vertical gap.
assert.equal(joinPreservedRegions([numerator,block('t','text',350,250,90,10),denominator]).length,3)
assert.equal(joinPreservedRegions([numerator,block('c','artifact',480,240,45,14)]).length,2)
assert.equal(joinPreservedRegions([numerator,block('far','equation',350,310,90,14)]).length,2)
// Mixed artifact/equation table rows should retain the original row spacing.
const table=joinPreservedRegions([block('r1','artifact',36,90,540,10),block('r2','artifact',36,103,540,10),block('r3','equation',36,116,540,10)])
assert.equal(table.length,1)
assert.equal(table[0].rect.height,36)
const actual=JSON.parse(await fs.readFile('scripts/fixtures/engineering-text-items.json','utf8')).preservedFragments
const actualJoined=joinPreservedRegions(actual)
assert.equal(actualJoined.length,3, 'Engineering page 4: two full equations and one intact table')
assert.deepEqual(actualJoined.map(r=>r.items.length),[2,2,3])
assert(actualJoined[0].rect.left<=352.12 && actualJoined[0].rect.left+actualJoined[0].rect.width>=575.9)
console.log('Preserved regions passed: fraction/table continuity, prose barriers, separate columns and gap bounds.')
