import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { transformWithOxc } from 'vite'
import { atomicWriteFile } from '../dist-electron/atomicFile.js'
import * as harness from '../dist-electron/translationHarness.js'
import * as scope from '../dist-electron/translationScope.js'
const source=await fs.readFile('electron/main.ts','utf8')
const body=source.slice(source.indexOf('function cachedSegments('),source.indexOf('let mainWindow:'))
const {code}=await transformWithOxc(body,'translation-runtime.ts')
const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-scoped-translation-'))
try {
 const file=path.join(root,'translation.json'),events=[],runs=new Map(),calls=[]
 let fail=false,cancel=false, omitOnce=false, malformedOnce=false
 const deps={fs,createHash,atomicWriteFile,...harness,...scope,readSettings:async()=>({translationProvider:'codex',translationModel:'fixture'}),translationRuns:runs,reportTranslation:(_sender,channel,event)=>events.push({channel,...event}),runTranslationCli:async(_provider,_model,prompt,key)=>{
  calls.push(prompt);if(fail)throw new Error('fixture failure');if(cancel)runs.get(key).cancelled=true
  const data=JSON.parse(prompt.split('INPUT:\n')[1].split('\nCopy each short')[0])
  if(omitOnce){omitOnce=false;return '[]'}
  if(malformedOnce){malformedOnce=false;return 'not json'}
  return JSON.stringify(data.items.map(item=>({id:item.id,translation:'세포는 변화에 반응합니다.'})))
 }}
 const translate=Function(...Object.keys(deps),code+';return translatePaper')(...Object.values(deps))
 const segments=[{id:'page1',page:1,kind:'text',source:'Cells respond to changes.',translation:'첫 페이지의 기존 번역입니다.'},{id:'page2',page:2,kind:'text',source:'Cells respond to changes.',translation:'둘째 페이지의 기존 번역입니다.'},{id:'references',page:3,kind:'heading',source:'References',translation:'참고문헌'}]
 const cache={version:1,provider:'codex',model:'fixture',sourceHash:'fixture',segments}
 const record={arxivId:'fixture',translationPath:file}
 await fs.writeFile(file,JSON.stringify(cache))
 await translate({},record,segments.map(({translation,...s})=>s),true,[2])
 const changed=JSON.parse(await fs.readFile(file,'utf8')).segments
 assert.equal(calls.length,1)
 assert.equal(changed[0].translation,segments[0].translation)
 assert.equal(changed[1].translation,'세포는 변화에 반응합니다.')
 assert.equal(changed[2].translation,segments[2].translation)
 const before=await fs.readFile(file,'utf8');fail=true
 await assert.rejects(translate({},record,segments,true,[2]),/fixture failure/)
 assert.equal(await fs.readFile(file,'utf8'),before,'Failed retry must not replace the saved cache')
 fail=false;cancel=true;await translate({},record,segments,true,[2])
 assert.equal(await fs.readFile(file,'utf8'),before,'Cancelled retry must not replace the saved cache')
 cancel=false; calls.length=0; omitOnce=true
 await translate({},record,segments,true,[2])
 assert.equal(calls.length,2,'Missing output retries only the failed page once')
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).segments[1].translation,'세포는 변화에 반응합니다.')
 calls.length=0; malformedOnce=true
 await translate({},record,segments,true,[2])
 assert.equal(calls.length,2,'Malformed batch receives one bounded retry')
 calls.length=0
 await translate({},record,segments,true,[3])
 assert.equal(calls.length,0,'Page translation must not bypass the bibliography exclusion')
 assert.equal(runs.size,0)
 console.log('Scoped retranslation: other pages and references preserved; failure/cancel keep last saved cache; task released.')
} finally {await fs.rm(root,{recursive:true,force:true})}
