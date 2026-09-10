import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createKnowledgeNode,readKnowledgeNode} from '../dist-electron/knowledge.js'
import {syncLinkRelations,listKnowledgeRelations,createKnowledgeRelation} from '../dist-electron/relations.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-relation-upgrade-'))
const writeFile=fs.writeFile
try {
  const target=await createKnowledgeNode(root,{nodeType:'concept',title:'Target concept'})
  const source=await createKnowledgeNode(root,{nodeType:'concept',title:'Source concept',body:'My connection: [[Concepts/Target concept]].'})
  await syncLinkRelations(root,source.id)
  const before=await listKnowledgeRelations(root,source.id)
  assert.equal(before.length,1);assert.equal(before[0].origin,'link')
  const snapshot=await readKnowledgeNode(root,source.id)
  const request={sourceId:source.id,targetId:target.id,type:'related',creator:'user',expectedRevision:snapshot.revision}
  const stale=await createKnowledgeRelation(root,{...request,expectedRevision:'0'.repeat(64)})
  assert.equal(stale.saved,false)
  assert.deepEqual(await listKnowledgeRelations(root,source.id),before,'Rejected revision must not erase the pre-existing link')
  let injected=false
  fs.writeFile=async function(file,data,options){
    if(path.dirname(String(file))===path.join(root,'.prism','relations')&&options?.flag==='wx') {
      injected=true;throw Object.assign(new Error('Simulated full disk at relation publication'),{code:'ENOSPC'})
    }
    return writeFile.call(this,file,data,options)
  }
  await assert.rejects(createKnowledgeRelation(root,request),/full disk/)
  assert(injected)
  fs.writeFile=writeFile
  assert.deepEqual(await listKnowledgeRelations(root,source.id),before,'Failed publication must preserve the exact original relation record')
  assert.equal((await readKnowledgeNode(root,source.id)).content,snapshot.content)
  const upgraded=await createKnowledgeRelation(root,request)
  assert.equal(upgraded.saved,true)
  const after=await listKnowledgeRelations(root,source.id)
  assert.equal(after.length,1);assert.equal(after[0].type,'related');assert.equal(after[0].origin,'manual')
  assert.equal((await readKnowledgeNode(root,source.id)).content,snapshot.content,'Upgrade preserves the user Markdown link')
  console.log('relation-upgrade: stale revision and injected publish failure preserve original graph edge; successful upgrade retires only derived edge and preserves Markdown')
} finally {fs.writeFile=writeFile;await fs.rm(root,{recursive:true,force:true})}
