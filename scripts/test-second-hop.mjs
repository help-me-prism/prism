import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/graph/secondHop.ts','utf8'),'src/graph/secondHop.ts')
const {loadSecondHop,secondHopLimits}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const edge=(id, options={})=>({id:`edge-${id}`,other:{id,title:id,nodeType:'concept'},type:'related',reviewStatus:'approved',...options})
let cancel=false, release, calls=[]
const pending=loadSecondHop('center',[edge('a'),edge('b')],id=>{calls.push(id);return new Promise(resolve=>{release=resolve})},()=>cancel)
assert.deepEqual(calls,['a'])
cancel=true; release([edge('obsolete')])
assert.equal(await pending,undefined)
assert.deepEqual(calls,['a'],'A superseded request must not continue to the next neighbour')
calls=[]
const result=await loadSecondHop('center',[edge('a'),edge('a'),edge('b')],async id=>{calls.push(id);if(id==='b')throw Error('deleted');return[edge('center'),edge('b'),edge('pending',{reviewStatus:'pending'}),edge('mention',{type:'mentions'}),edge('c'),edge('c')]},()=>false)
assert.deepEqual(calls,['a','b'],'Duplicate direct neighbours should be fetched once')
assert.deepEqual(result.entries.map(e=>[e.parentId,e.relation.other.id]),[['a','c']])
assert.equal(result.failures,1)
assert.equal(result.limited,false)
calls=[]
const capped=await loadSecondHop('center',Array.from({length:100},(_,i)=>edge(`parent-${i}`)),async id=>{calls.push(id);return[]},()=>false)
assert.equal(calls.length,secondHopLimits.neighbours);assert.equal(capped.limited,true)
calls=[]
const full=await loadSecondHop('center',[edge('a'),edge('b')],async id=>{calls.push(id);return Array.from({length:100},(_,i)=>edge(`child-${i}`))},()=>false)
assert.equal(full.entries.length,secondHopLimits.entries);assert.equal(full.limited,true);assert.deepEqual(calls,['a'])
assert.equal(await loadSecondHop('center',[edge('a')],async()=>{throw Error('must not request')},()=>true),undefined)
console.log('second-hop: cancellation after pending IPC, deduplication, approved-only filtering, failure reporting and explicit request/result bounds passed')
