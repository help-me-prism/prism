import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {transformWithOxc} from 'vite'
import {createKnowledgeNode,readKnowledgeNode,saveKnowledgeNode,copyKnowledgeEvidence,evidenceBlock} from '../dist-electron/knowledge.js'
const {code}=await transformWithOxc(await fs.readFile('src/noteEvidenceCopy.ts','utf8'),'src/noteEvidenceCopy.ts')
const {copySavedEvidence}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-evidence-copy-'))
try {
  const source=await createKnowledgeNode(root,{nodeType:'concept',title:'Source concept'})
  const target=await createKnowledgeNode(root,{nodeType:'claim',title:'Existing claim'})
  const literalBody = '# Claim with quoted source\n\n> Source contains {{title}} and {{date}} literally.\n'
  const literalClaim = await createKnowledgeNode(root,{nodeType:'claim',title:'Literal evidence',body:literalBody})
  assert((await readKnowledgeNode(root,literalClaim.id)).content.includes(literalBody),'Explicit evidence body must not undergo template substitution')
  const first=await readKnowledgeNode(root,source.id),destination=await readKnowledgeNode(root,target.id)
  const card='> [!evidence] 문장 · Test paper · p.11\n> Newly inserted evidence must reach the target.\n> [PDF 원문 열기](prism://paper/test?anchor=sentence-p11&page=11)\n<!-- prism-evidence:%7B%22anchorId%22%3A%22sentence-p11%22%7D -->\n^evidence-test-p11'
  const draft=`${first.content.trimEnd()}\n\n${card}\n`
  for(const ending of ['', '\n', '\r\n', '\n\n']) assert.equal(evidenceBlock(card+ending,'evidence-test-p11'),card,'A standard final newline must not hide the last evidence card')
  assert.equal(evidenceBlock((card+'\n').replaceAll('\n','\r\n'),'evidence-test-p11'),card.replaceAll('\n','\r\n'))
  assert.equal(evidenceBlock(card.replace('^evidence-test-p11','^evidence-test-p110')+'\n','evidence-test-p11'),undefined,'Do not match block-ID prefixes')
  const request={sourceNodeId:source.id,targetNodeId:target.id,blockId:'evidence-test-p11',expectedTargetRevision:destination.revision}
  await assert.rejects(copyKnowledgeEvidence(root,request),/근거 카드/, 'The pre-fix disk-only copy cannot find the unsaved card')
  const copied=await copySavedEvidence(async()=> (await saveKnowledgeNode(root,source.id,{content:draft,expectedRevision:first.revision})).saved,()=>true,()=>copyKnowledgeEvidence(root,request))
  assert.equal(copied.saved,true)
  assert((await readKnowledgeNode(root,target.id)).content.includes(card),'Source evidence and PDF provenance arrive intact in existing target')
  const targetAfter=await readKnowledgeNode(root,target.id)
  let attempted=0
  const blocked=await copySavedEvidence(async()=>false,()=>true,async()=>{attempted++;throw Error('must not copy')})
  assert.equal(blocked,undefined);assert.equal(attempted,0)
  assert.equal((await readKnowledgeNode(root,target.id)).content,targetAfter.content,'Save conflict must leave destination unchanged')
  let release
  const changed=copySavedEvidence(()=>new Promise(resolve=>{release=resolve}),()=>false,async()=>{attempted++;throw Error('must not copy stale source')})
  release(true);assert.equal(await changed,undefined);assert.equal(attempted,0,'Continued edits/navigation during save abort the copy')
  console.log('note-evidence-copy: reproduced unsaved-card failure, real Markdown source flush+target copy, provenance preservation, conflict and continued-edit guards passed')
} finally {await fs.rm(root,{recursive:true,force:true})}
