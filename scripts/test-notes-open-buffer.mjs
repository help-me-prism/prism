import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {transformWithOxc} from 'vite'
const {code}=await transformWithOxc(await fs.readFile('electron/preload.cts','utf8'),'electron/preload.cts')
const ipc=new EventEmitter();ipc.invoke=async()=>undefined
let bridge
vm.runInNewContext(code,{require:name=>{assert.equal(name,'electron');return{ipcRenderer:ipc,contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value}}}},console})
ipc.emit('knowledge:open-requested',{},'paper-first')
ipc.emit('knowledge:open-requested',{},'paper-latest')
const received=[];const stop=bridge.onOpenKnowledgeNode(id=>received.push(id))
assert.deepEqual(received,['paper-latest'],'The latest request preceding React subscription must be delivered')
ipc.emit('knowledge:open-requested',{},'paper-live');assert.deepEqual(received,['paper-latest','paper-live'])
stop();ipc.emit('knowledge:open-requested',{},'paper-remount')
const remounted=[];bridge.onOpenKnowledgeNode(id=>remounted.push(id));assert.deepEqual(remounted,['paper-remount'])
const duplicate=[];bridge.onOpenKnowledgeNode(id=>duplicate.push(id));assert.deepEqual(duplicate,[],'Consumed requests must not replay during later subscriptions')
console.log('notes-open-buffer: actual preload early navigation, latest intent, live delivery, unsubscribe gap and no duplicate replay passed')
