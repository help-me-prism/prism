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

const partial=groupReadingSegments([{id:'ok1',kind:'text',blockId:'p'},{id:'bad',kind:'text',blockId:'p'},{id:'ok2',kind:'text',blockId:'p'}],new Set(),item=>item.id==='bad'?'source':'translated')
assert.deepEqual(partial.map(group=>group.items.map(item=>item.id)),[['ok1'],['bad'],['ok2']], 'A single failed sentence must not hide accepted neighboring translations')

// Actual engineering p11 run-in heading coordinates: bold ink starts slightly
// below the adjoining regular text. It must remain before its own paragraph.
const heading={id:'heading',kind:'heading',blockId:'p11',preciseRects:[{left:211.349,top:642.937,width:60.853,height:9.375}]}
const body={id:'body',kind:'text',blockId:'p11',preciseRects:[{left:278.983,top:642.312,width:294.308,height:10},{left:199.387,top:655.295,width:364.562,height:10}]}
const runIn=groupReadingSegments([heading,body])
assert.equal(runIn.length,1)
assert.equal(runIn[0].kind,'text')
assert.deepEqual(runIn[0].items.map(item=>item.id),['heading','body'])
assert.equal(groupReadingSegments([heading,{...body,blockId:'other'}]).length,2)
assert.equal(groupReadingSegments([heading,{...body,preciseRects:[{left:199,top:660,width:365,height:10}]}]).length,2,'A separate-line title must remain separate')
assert.equal(groupReadingSegments([heading,body],new Set(),item=>item.id==='body'?'source':'translated').length,2,'Do not merge across untranslated content')
const theorem=groupReadingSegments([{id:'theorem-title',kind:'text',source:'Theorem 2.',blockId:'thm'},{id:'theorem-body',kind:'text',source:'Assume x is positive.',blockId:'thm'},{id:'theorem-math',kind:'equation',source:'Hence, x = y.',blockId:'thm'}],new Set(),item=>item.kind==='equation'?'source':'translated')
assert.equal(theorem.length,1,'A theorem remains one semantic block even when its final inline expression looks like display math')
assert.equal(theorem[0].kind,'theorem')
const metadata = [{id:'author-a',kind:'artifact',blockId:'furniture-authors'},{id:'author-b',kind:'artifact',blockId:'furniture-authors'},{id:'author-c',kind:'artifact',blockId:'furniture-authors'}]
assert.equal(groupReadingSegments(metadata,new Set(),s=>s.id==='author-b'?'translated':'source').length,1,'Original author/affiliation pixels are one crop even when only some cached source strings pass translation validation')
