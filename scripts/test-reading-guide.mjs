import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { guideRequest, inspectGuide, mergeReadingNote, prepareReadingGuide, updateReadingMemory, memoryCandidate } from '../dist-electron/readingGuide.js'
import { migratePaperNotes, listKnowledgeNodes } from '../dist-electron/knowledge.js'
import { writeAutoSection, removeAutoSection, refreshPaperDigest } from '../dist-electron/paperDigest.js'
import { protectEditedAutoSections, protectedAutoSection } from '../dist-electron/noteContract.js'
const entries=[{id:'guide-summary',text:'Original generated sentence.'},{id:'guide-source',text:'Original point.'}]
let state=mergeReadingNote('# Paper\n\nMy own sentence.',{},entries)
const edited=state.content.replace('Original generated sentence.','A meaningful correction by the user.')
let next=mergeReadingNote(edited,state.baseline,entries.map(e=>({...e,text:'New AI suggestion.'})))
assert(next.content.includes('A meaningful correction by the user.'))
assert(next.content.includes('My own sentence.'))
assert.equal(next.protectedIds[0],'guide-summary')
const spacing=state.content.replace('Original generated sentence.','Original  generated sentence.   ')
assert(mergeReadingNote(spacing,state.baseline,[{id:'guide-summary',text:'New summary.'}]).content.includes('New summary.'))
const deleted=state.content.replace(/<!-- prism:reading guide-source -->[\s\S]*?<!-- \/prism:reading guide-source -->/,'')
assert(!mergeReadingNote(deleted,state.baseline,entries).content.includes('Original point.'))
let legacy=writeAutoSection('# Note\n','confusion','- Original question.')
assert(!protectedAutoSection(legacy,'confusion'))
const custom=legacy.replace('Original question.','A manually corrected question.')
assert(protectedAutoSection(custom,'confusion'))
assert.equal(writeAutoSection(custom,'confusion','- Replace me.'),custom)
assert.equal(removeAutoSection(custom,'confusion'),custom)
assert(!protectedAutoSection(legacy.replace('Original question.','Original  question.   '),'confusion'))
assert(protectEditedAutoSections(legacy,custom).includes('prism:keep confusion'))
for(const text of ['고마워','네','이 논문을 세 문장으로 요약해줘','Figure 2를 설명해줘'])assert(!memoryCandidate(text),text)
for(const text of ['아직 이해가 안돼','이제 이해했어','내 연구에 적용할 때 표본 수가 걱정돼','고마워. 내 연구에서는 이 방법을 적용할 거야'])assert(memoryCandidate(text),text)
const anchors=Array.from({length:180},(_,i)=>({id:`a${i}`,page:Math.floor(i/10)+1,type:'text',source:`Cells respond to treatment under condition ${i}.`,sectionTitle:'Methods'}))
const request=guideRequest('Paper',anchors)
assert(request.prompt.length<50_000)
assert(request.sources.some(a=>a.page===18))
assert(request.sampled)
const longRequest=guideRequest('Long paper',anchors.map(a=>({...a,source:a.source.repeat(25)})))
assert(longRequest.prompt.length < 50_000 && longRequest.sources.at(-1).page === 18, 'Budget reduction must still cover the final page')
assert.throws(()=>inspectGuide(JSON.stringify({summary:'요약',points:[{anchorId:'invented',text:'이유',kind:'finding'}]}),request,'fixture'),/근거/)
const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-reading-guide-'))
try {
 const paper='test.0001',folder=path.join(root,'papers',paper),file=path.join(folder,paper+'.md')
 await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,`---\ntype: paper\narxiv_id: ${paper}\ntitle: Paper\n---\n\n# Paper\n\nMy handwritten sentence.\n`)
 await migratePaperNotes(root);const node=(await listKnowledgeNodes(root))[0]
 let calls=0
 const run=async()=>{calls++;return JSON.stringify({summary:'검증용 요약입니다.',points:[{anchorId:'s1',text:'방법을 확인할 곳입니다.',kind:'method'}]})}
 await prepareReadingGuide(root,paper,node.id,'Paper',anchors,'fixture',run)
 await prepareReadingGuide(root,paper,node.id,'Paper',anchors,'different-model',run)
 assert.equal(calls,1,'Reopening or changing model does not repay for the same source')
 let text=await fs.readFile(file,'utf8');text=text.replace('검증용 요약입니다.','직접 수정한 요약입니다.');await fs.writeFile(file,text)
 await prepareReadingGuide(root,paper,node.id,'Paper',anchors,'fixture',run,true)
 assert((await fs.readFile(file,'utf8')).includes('직접 수정한 요약입니다.'))
 await assert.rejects(prepareReadingGuide(root,paper,node.id,'Paper',anchors,'fixture',async()=>'{invalid',true))
 assert((await fs.readFile(file,'utf8')).includes('직접 수정한 요약입니다.'))
 const exchange={id:'turn1',question:'내 연구에 적용할 때 표본 수가 걱정돼',answer:'답변 자체는 이해의 증거가 아닙니다.'}
 let memoryCalls=0
 const memory=async()=>{memoryCalls++;return JSON.stringify({items:[{id:'sample-size',text:'작은 표본에 적용하려 하며 표본 수의 한계를 더 확인해야 한다.'}]})}
 assert((await updateReadingMemory(root,paper,node.id,exchange,memory)).updated)
 const seeded=writeAutoSection(await fs.readFile(file,'utf8'),'confusion','- Old frequency-based doubt.')
 await fs.writeFile(file,seeded)
 await refreshPaperDigest(root,node.id,[{role:'user',text:'velocity field가 왜 필요한지 아직 이해가 안 돼요',createdAt:1,paperIds:[paper]}])
 assert(!(await fs.readFile(file,'utf8')).includes('<!-- prism:auto confusion -->'),'Local question counts must not compete with selective memory')
 await updateReadingMemory(root,paper,node.id,exchange,memory)
 await updateReadingMemory(root,paper,node.id,{...exchange,id:'turn2',question:'고마워'},memory)
 assert.equal(memoryCalls,1,'Same turn and acknowledgements must not cause model calls')
 const before=await fs.readFile(file,'utf8')
 await updateReadingMemory(root,paper,node.id,{...exchange,id:'turn3',question:'이제 이해했어'},async()=>'{"items":[]}')
 const after=await fs.readFile(file,'utf8')
 assert(!after.includes('작은 표본에 적용하려'))
 assert(after.includes('직접 수정한 요약입니다.')&&after.includes('My handwritten sentence.'))
 await updateReadingMemory(root,paper,node.id,{...exchange,id:'turn4'},memory)
 // A manual edit made while the model is running must also survive removal by the model.
 await updateReadingMemory(root,paper,node.id,{...exchange,id:'turn5',question:'이제 표본 수 한계는 이해했어'},async()=>{
   const latest=await fs.readFile(file,'utf8')
   await fs.writeFile(file,latest.replace('작은 표본에 적용하려 하며 표본 수의 한계를 더 확인해야 한다.','직접 수정: 내 실험에서는 독립 표본 20개를 확보한다.'))
   return '{"items":[]}'
 })
 assert((await fs.readFile(file,'utf8')).includes('직접 수정: 내 실험에서는 독립 표본 20개를 확보한다.'))
 const stable=await fs.readFile(file,'utf8')
 await assert.rejects(updateReadingMemory(root,paper,node.id,{...exchange,id:'turn6'},async()=>'{invalid'))
 assert.equal(await fs.readFile(file,'utf8'),stable)
 console.log('Reading guide and memory passed: distributed grounding, unknown-ID rejection, cache, selective calls, resolved memory, meaningful edits, whitespace, deletion and failure preservation.')
} finally {await fs.rm(root,{recursive:true,force:true})}
