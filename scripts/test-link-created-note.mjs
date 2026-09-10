import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/linkCreatedNote.ts','utf8'),'src/linkCreatedNote.ts')
const {linkCreatedNote}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const calls=[]
const outcome=await linkCreatedNote('new-claim','paper-source',()=>true,async id=>{calls.push(['read',id]);return{revision:'fresh-revision'}},async request=>{calls.push(['create',request]);return{saved:true}})
assert.equal(outcome,'linked')
assert.deepEqual(calls,[['read','new-claim'],['create',{sourceId:'new-claim',targetId:'paper-source',type:'related',creator:'user',expectedRevision:'fresh-revision'}]],'Read/revision belongs to new note; no paper content read/write or asserted support')
assert.equal(await linkCreatedNote('new','paper',()=>false,()=>{throw Error('stale read')},()=>{throw Error('stale link')}),'stale')
let owner=true
assert.equal(await linkCreatedNote('new','paper',()=>owner,async()=>{owner=false;return{revision:'r'}},()=>{throw Error('must not link after selection/vault change')}),'stale')
await assert.rejects(linkCreatedNote('new','paper',()=>true,async()=>({revision:'r'}),async()=>({saved:false})),/외부에서 변경/)
await assert.rejects(linkCreatedNote('new','paper',()=>true,async()=>({revision:'r'}),async()=>{throw Error('disk failure')}),/disk failure/)
console.log('link-created-note: new-note revision/direction, neutral relation, stale selection/vault, conflict and failure propagation passed')
