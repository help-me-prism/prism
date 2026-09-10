import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readPaperBody } from '../dist-electron/paperBody.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-paper-body-'))
const removeTree=async target=>{
 const resolved=path.resolve(target), relative=path.relative(path.resolve(root),resolved)
 assert(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),'Recursive cleanup must stay within the test root')
 const real=await fs.realpath(resolved), realRoot=await fs.realpath(root), realRelative=path.relative(realRoot,real)
 assert(realRelative !== '..' && !realRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(realRelative),'Resolved cleanup target must stay within the test root')
 await fs.rm(resolved,{recursive:true,force:true})
}
const vault=path.join(root,'vault'), external=path.join(root,'external'), id='local-science'
const source='The connected pore structure controls heat transfer through the specimen.'
const changed='The connected pore structure does not control heat transfer in this experiment.'
const korean='연결된 기공 구조는 시편의 열전달을 제어한다.'
const anchorPath=path.join(vault,'.prism','anchors',`${id}.json`)
const translationPath=path.join(external,'translation.ko.json')
const write=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data))}
const registry=async(sourceText=source)=>write(anchorPath,{paperId:id,anchors:[{id:'h',type:'heading',page:2,source:'Results'},{id:'s',type:'text',page:2,source:sourceText}]})
const cache=async(sourceText=source)=>write(translationPath,{segments:[{id:'s',kind:'text',page:2,source:sourceText,translation:korean}]})
const index=async(record)=>write(path.join(vault,'.prism','library.json'),[{arxivId:id,...record}])
try {
 await registry()
 let body=await readPaperBody(vault,id)
 assert.deepEqual(body.sections,[{title:'Results',page:2,lines:[source]}])
 assert.equal(body.find(source),undefined)
 await index({externalAssets:true,translationPath});await cache()
 body=await readPaperBody(vault,id)
 assert.equal(body.sections[0].lines[0],korean)
 assert.equal(body.find(source),korean)
 assert.equal(body.find(source.toLowerCase()),undefined,'Case changes can change scientific symbol identity')
 assert.equal(body.find(source.replace('heat transfer','heattransfer')),undefined,'Word boundaries cannot be discarded')
 assert.equal(body.find(source.replace('heat transfer','heat\n  transfer')),korean,'Layout whitespace remains normalizable')
 const originalRead=fs.readFile;let reads=0
 try {
  fs.readFile=async(...args)=>{reads++;return originalRead(...args)}
  assert.equal(await readPaperBody(vault,id),body)
  assert.equal(reads,0,'Unchanged stat signatures must reuse parsed payloads without any file reads')
 } finally {fs.readFile=originalRead}
 assert.equal(body.find(changed),undefined,'Shared prefix must never translate a different scientific claim')
 await registry(changed)
 body=await readPaperBody(vault,id)
 assert.equal(body.sections[0].lines[0],changed,'Anchor update invalidates merged cached body')
 assert.equal(body.find(source),undefined)
 await cache(changed)
 assert.equal((await readPaperBody(vault,id)).find(changed),korean,'Translation update invalidates cache independently')
 await write(translationPath,{segments:[{id:'wrong',kind:'text',page:2,source:changed,translation:korean}]})
 assert.equal((await readPaperBody(vault,id)).find(changed),undefined,'Equal source alone cannot replace mismatched segment identity')
 await write(anchorPath,{paperId:id,anchors:[{id:'s',type:'text',page:3,sectionTitle:'Discussion',source:changed}]})
 assert.equal((await readPaperBody(vault,id)).sections[0].title,'Discussion')
 // Moved internal record must use the current vault, not an existing old copy.
 await cache(changed)
 await index({externalAssets:false,translationPath,pdfPath:path.join(external,'original.pdf')})
 const moved=path.join(vault,'papers',id,'translation.ko.json')
 await write(moved,{segments:[{id:'s',kind:'text',page:3,source:changed,translation:'현재 볼트에 보관된 번역입니다.'}]})
 assert.equal((await readPaperBody(vault,id)).find(changed),'현재 볼트에 보관된 번역입니다.')
 await write(anchorPath,{paperId:'different-paper',anchors:[{id:'s',type:'text',page:2,source:source}]})
 assert.deepEqual((await readPaperBody(vault,id)).sections,[],'Wrong registry identity fails closed rather than resurrecting cache')
 await fs.writeFile(anchorPath,'{broken')
 assert.deepEqual((await readPaperBody(vault,id)).sections,[])
 await fs.rm(anchorPath)
 assert.equal((await readPaperBody(vault,id)).find(changed),'현재 볼트에 보관된 번역입니다.','Legacy translation-only vault remains readable')
 await fs.rm(moved)
 assert.deepEqual((await readPaperBody(vault,id)).sections,[],'Absent files are not fabricated body text')
 // Internal symlink/junction paths cannot escape the vault; explicit external registration above can.
 await removeTree(path.dirname(moved))
 await fs.symlink(external,path.dirname(moved),process.platform==='win32'?'junction':'dir')
 assert.deepEqual((await readPaperBody(vault,id)).sections,[],'Implicit external asset escape is not trusted')
 assert.deepEqual((await readPaperBody(vault,'..')).sections,[])
 await write(path.join(vault,'papers','symbols','translation.ko.json'),{segments:[
  {id:'co',kind:'text',page:1,source:'CO concentration depends on x in this experiment.',translation:'기호를 보존한 번역'},
 ]})
 const symbols=await readPaperBody(vault,'symbols')
 assert.equal(symbols.find('CO concentration depends on x in this experiment.'),'기호를 보존한 번역')
 assert.equal(symbols.find('Co concentration depends on x in this experiment.'),undefined,'CO and Co identify different substances')
 assert.equal(symbols.find('CO concentration depends on X in this experiment.'),undefined,'x and X can identify different quantities')
 const proofId='biology-proof', proofPath=path.join(vault,'.prism','anchors',`${proofId}.json`)
 const proofCache=path.join(vault,'papers',proofId,'translation.ko.json')
 const genuine='Long-read sequencing supports chromosome-scale genome assemblies.'
 const placeholder='a1111111111 a1111111111 a1111111111 a1111111111'
 const proofSegments=[
  {id:'heading',type:'heading',page:1,source:'Introduction'},
  {id:'placeholder',type:'heading',page:1,source:placeholder},
  {id:'p1-s28-ejh0sl',type:'text',page:1,source:`AU : Pleaseconfirmthatallheadinglevelsarerepresentedcorrectly : ${genuine}`,sectionTitle:placeholder,sourceHash:'immutable-fixture-hash'},
  {id:'spaced',type:'text',page:1,source:`au: please confirm that all heading levels are represented correctly: ${genuine}`},
  {id:'astronomy',type:'text',page:1,source:'AU is the astronomical unit used for orbital distances.'},
  {id:'real-body',type:'text',page:1,source:`The measured identifier is ${placeholder}.`},
  {id:'similar-query',type:'text',page:1,source:'AU: Please confirm that all sample levels are represented correctly: This is not the known heading query.'},
 ]
 await write(proofPath,{paperId:proofId,anchors:proofSegments})
 await write(proofCache,{segments:proofSegments.map(s=>({...s,kind:s.type,translation:s.id==='p1-s28-ejh0sl'||s.id==='spaced'?'교정 요청이 혼입된 잘못된 번역':undefined}))})
 const untouched=await fs.readFile(proofPath,'utf8'), untouchedCache=await fs.readFile(proofCache,'utf8')
 const proofBody=await readPaperBody(vault,proofId)
 assert.equal(proofBody.sections[0].title,'본문','Publisher placeholder ends the previous section without becoming a heading')
 assert.deepEqual(proofBody.sections[0].lines.slice(0,2),[genuine,genuine],'Exact proof query is removed with or without word spacing, case-insensitively')
 assert.equal(proofBody.find(proofSegments[2].source),undefined,'Contaminated cached translation cannot be reused through find')
 assert.equal(proofBody.find(proofSegments[3].source),undefined)
 assert.equal(proofBody.find(genuine),undefined,'Cleaning source must not re-key a contaminated translation')
 assert(proofBody.sections[0].lines.includes(proofSegments[4].source),'Astronomical AU prose remains intact')
 assert(proofBody.sections[0].lines.includes(proofSegments[5].source),'Placeholder-like literal body content is not removed')
 assert(proofBody.sections[0].lines.includes(proofSegments[6].source),'Similar but unrecognized queries remain unchanged')
 assert.equal(await fs.readFile(proofPath,'utf8'),untouched,'Registry IDs/source/hash must remain byte-for-byte unchanged')
 assert.equal(await fs.readFile(proofCache,'utf8'),untouchedCache,'Filtering never rewrites the paid translation cache')
 console.log('paper-body: untranslated anchors, external assets, moved vault, identity/source merge, both-file invalidation, sections, corrupt/missing fallback and realpath boundary passed')
} finally {await removeTree(root)}
