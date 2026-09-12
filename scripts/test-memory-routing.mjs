import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const source=await fs.readFile('dist-electron/main.js','utf8')
const start=source.indexOf('async function routeChatIntoNotes()'),end=source.indexOf('\n/**',start)
assert(start>=0&&end>start)
const messages=[{id:'q1',role:'user',text:'내 연구에 적용할 계획',primaryPaperId:'paper'}, {id:'a1',role:'assistant',text:'첫 답변'}, {id:'q2',role:'user',text:'이제 이해했어',primaryPaperId:'paper'}, {id:'a2',role:'assistant',text:'둘째 답변'}, {id:'q3',role:'user',text:'아직 헷갈려',primaryPaperId:'paper'}, {id:'a3',role:'assistant',text:'실패한 부분 답변'}]
const settledAnswers=new Set(['s:a1','s:a2','foreign:a1']),memoryAttempts=new Set(),calls=[]
let enabled=true,busy=true,retries=0
const dependencies={
 readSettings:async()=>({libraryPath:'vault',autoMemory:enabled}),
 readChatMessages:async()=>messages,sessionsPath:()=>'',
 buildDigestContext:async()=>({vault:{records:[{id:'node',arxivId:'paper',nodeType:'paper',title:'Paper'}]}}),
 titleMatcher:()=>()=>false,refreshNoteDigest:async()=>{},
 process:{env:{}},loadSessions:async()=>[{id:'s',libraryPath:'vault',messages},{id:'foreign',libraryPath:'other',messages}],
 activeChats:new Map(),assertChatScope:async(requested,current)=>{if(requested!==current)throw Error('scope')},
 settledAnswers,memoryAttempts,withTaskLock:async(_key,run)=>{if(busy)throw Error('busy');return run()},scheduleChatRouting:()=>retries++,
 updateReadingMemory:async(_vault,_paper,_node,exchange)=>{calls.push(exchange.id);return{updated:true}},
 runTranslationCli:()=>{throw Error('No paid calls in regression tests')},mainWindow:undefined,safeSend:()=>{},
}
const route=new Function(...Object.keys(dependencies),source.slice(start,end)+'; return routeChatIntoNotes;')(...Object.values(dependencies))
await route();assert.equal(calls.length,0);assert.equal(retries,2,'Initial guide contention must schedule a free retry')
busy=false
await route();assert.deepEqual(calls,['s:a1','s:a2'],'Every completed pair must survive a quick follow-up; partial and foreign replies must not write memory')
await route();assert.equal(calls.length,2,'Routing again must not repeat model calls')
messages.push({id:'q4',role:'user',text:'내 연구에 적용할 거야',paperIds:['paper','another']},{id:'a4',role:'assistant',text:'비교 답변'})
settledAnswers.add('s:a4');await route()
assert.equal(calls.length,2,'A comparative turn must not be filed under the first paper')
assert(!settledAnswers.has('s:a4'))
enabled=false;settledAnswers.add('s:a3');await route();assert.equal(calls.length,2,'Disabled memory must not start a model')
console.log('Memory routing passed: rapid consecutive turns, incomplete/foreign replies, no replay and off switch.')
