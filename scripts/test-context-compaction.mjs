import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { transformWithOxc } from 'vite'
import { parseAiUsage } from '../dist-electron/aiUsage.js'
const source=await fs.readFile('electron/main.ts','utf8')
const body=source.slice(source.indexOf('class CodexAppServer {'),source.indexOf('const codexServer ='))
const {code}=await transformWithOxc(body,'codex-app-server.ts')
const owners=new Map(),active=new Map(),events=[],runs=[]
const dependencies={sessionOwners:owners,activeChats:active,app:{getPath:()=>'/profile'},path,prismMcpServer:libraryPath=>({vault:libraryPath}),chatMemoryInstruction:'memory',randomUUID:()=> 'fixture',parseAiUsage,aiUsagePath:()=>'/usage',recordAiRun:(_file,run)=>runs.push(run),safeSend:(_sender,channel,event)=>events.push({channel,...event})}
const Server=Function(...Object.keys(dependencies),code+';return CodexAppServer')(...Object.values(dependencies))
const server=new Server(),calls=[];server.ensureReady=async()=>{}
server.request=async(method,params)=>{calls.push({method,params});return{}}
await server.compact({}, {id:'session',model:'fixture-model',providerThreadId:'thread'},'/vault')
assert.deepEqual(calls.map(c=>c.method),['thread/resume','thread/compact/start'])
assert.equal(calls[0].params.cwd,'/profile')
assert.equal(calls[0].params.config.mcp_servers.prism.vault,'/vault')
server.onMessage({method:'turn/started',params:{threadId:'thread',turn:{id:'compact-turn'}}})
assert.equal(active.get('session').turnId,'compact-turn')
server.onMessage({method:'item/agentMessage/delta',params:{threadId:'thread',delta:'internal summary'}})
assert.equal(events.length,0,'A compaction summary must not become a new visible assistant answer')
server.onMessage({method:'thread/tokenUsage/updated',params:{threadId:'thread',tokenUsage:{last:{inputTokens:120,outputTokens:10},modelContextWindow:1000}}})
server.onMessage({method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}})
assert.equal(active.size,0)
assert.equal(runs[0].task,'context');assert.equal(runs[0].inputTokens,120)
assert(events.some(e=>e.channel==='chat:done'))
server.onMessage({method:'turn/completed',params:{threadId:'thread',turn:{status:'failed',error:{message:'compaction failed'}}}})
assert(events.some(e=>e.channel==='chat:error'&&e.message==='compaction failed'))
console.log('Codex compaction protocol: scoped resume, asynchronous lifecycle, hidden summary, separate usage, visible failures.')
