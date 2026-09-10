import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/paper/readingPosition.ts','utf8'),'src/paper/readingPosition.ts')
const {validateReadingPosition,readReadingPosition,saveReadingPosition}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const values=new Map()
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
const point={page:11,progress:.42,anchorId:'p11-s3',anchorProgress:.25}
saveReadingPosition('vault-a/paper.pdf',point)
assert.deepEqual(readReadingPosition('vault-a/paper.pdf'),{...point,align:undefined})
assert.equal(readReadingPosition('vault-b/paper.pdf'),undefined)
assert.equal(readReadingPosition('vault-a/paper.pdf',5).page,5)
for(const bad of [null,{}, {page:-1,progress:0},{page:1.2,progress:0},{page:1,progress:NaN}]) assert.equal(validateReadingPosition(bad),undefined)
assert.equal(validateReadingPosition({page:1,progress:99}).progress,1)
globalThis.localStorage={getItem(){throw Error('unavailable')},setItem(){throw Error('unavailable')}}
assert.equal(readReadingPosition('unavailable'),undefined)
assert.doesNotThrow(()=>saveReadingPosition('unavailable',point))
console.log('Reading positions passed: per-PDF isolation, paragraph offsets, stale page bounds and unavailable storage.')
