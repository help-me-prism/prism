import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/paper/readingBlocks.ts','utf8'),'src/paper/readingBlocks.ts')
const {groupReadingSegments}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const {segments}=JSON.parse(await fs.readFile('scripts/fixtures/engineering-mixed-paragraph.json','utf8'))
const groups=groupReadingSegments(segments)
assert.deepEqual(groups.map(g=>g.items[0].kind),['text','artifact','text'])
assert.deepEqual(groups.map(g=>g.items.length),[6,1,5])
assert(groups[1].items[0].source.includes('S � 1.2'))
assert(groups[2].items[0].source.startsWith('When the mass fraction of GF'))
assert.deepEqual(groups.flatMap(g=>g.items.map(s=>s.id)),segments.map(s=>s.id),'Source order and every sentence must survive')
assert.equal(new Set(groups.map(g=>g.id)).size,groups.length,'Repeated same-kind paragraph runs need distinct React keys')
const changedParagraph=groupReadingSegments([{id:'a',kind:'text',blockId:'first'},{id:'b',kind:'text',blockId:'second'}])
assert.equal(changedParagraph.length,2)
assert.deepEqual(groupReadingSegments([]),[])
console.log('Reading blocks passed: actual engineering p11 protected sentence stays between surrounding prose, without missing/duplicate content.')
