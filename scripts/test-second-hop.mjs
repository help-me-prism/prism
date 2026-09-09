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
const result=await loadSecondHop('center',[edge('a'),edge('a'),edge('b')],async id=>{calls.push(id);if(id==='b')throw Error('deleted');return[edge('center',{id:'edge-a'}),edge('b'),edge('pending',{reviewStatus:'pending'}),edge('mention',{type:'mentions'}),edge('c'),edge('c')]},()=>false)
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
const exact=await loadSecondHop('center',[edge('a'),edge('b')],async id=>id==='a'?Array.from({length:24},(_,i)=>edge(`child-${i}`)):[],()=>false)
assert.equal(exact.entries.length,24);assert.equal(exact.limited,false,'Exactly at the limit is complete when no other distinct edge is omitted')
const diamond=await loadSecondHop('A',[edge('B',{id:'a-b'}),edge('C',{id:'a-c'})],async id=>id==='B'
  ?[edge('A',{id:'a-b',direction:'incoming'}),edge('D',{id:'b-d',type:'supports',direction:'outgoing'}),edge('C',{id:'b-c',type:'related',direction:'outgoing'})]
  :[edge('A',{id:'a-c',direction:'incoming'}),edge('D',{id:'c-d',type:'contradicts',direction:'outgoing'}),edge('B',{id:'b-c',type:'related',direction:'incoming'})],()=>false)
assert.deepEqual(diamond.entries.map(e=>[e.parentId,e.relation.id,e.relation.type]),[['B','b-d','supports'],['B','b-c','related'],['C','c-d','contradicts']], 'Both paths to D survive; B–C appears once despite inverse fetch; direct A edges are not duplicated')
assert.equal(diamond.limited,false);assert.equal(diamond.failures,0)
assert.equal(await loadSecondHop('center',[edge('a')],async()=>{throw Error('must not request')},()=>true),undefined)
console.log('second-hop: cancellation after pending IPC, deduplication, approved-only filtering, failure reporting and explicit request/result bounds passed')
