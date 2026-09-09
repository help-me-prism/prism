import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
let {code}=await transformWithOxc(await fs.readFile('src/paper/anchorContext.ts','utf8'),'src/paper/anchorContext.ts')
const shared = await transformWithOxc(await fs.readFile('electron/scientificSource.ts', 'utf8'), 'electron/scientificSource.ts')
code = code.replace('../../electron/scientificSource', 'data:text/javascript;base64,' + Buffer.from(shared.code).toString('base64'))
const {compactAnchorContext}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const sentence={paperId:'paper',anchorId:'p1',paperTitle:'Study',page:1,type:'sentence',label:'근거1',source:'The experiment compared two groups.'}
const result=JSON.parse(compactAnchorContext([sentence,{...sentence,textOffset:42},{...sentence,paperId:'other',label:'근거2'}]))
assert.equal(result.selectedEvidence.length,2)
assert.equal(result.selectedEvidence[0].source,sentence.source)
assert.equal(result.selectedEvidence[1].paperId,'other')
const image={...sentence,type:'figure',anchorId:'figure-p1-test',source:'Saved figure image: C:/private/location/image.png. Normalized bounds: {}'}
const imageContext=compactAnchorContext([image])
assert(!imageContext.includes('C:/private'));assert(JSON.parse(imageContext).selectedEvidence[0].imageAttached)
const caption=JSON.parse(compactAnchorContext([{...image,source:'Matched LaTeX figure 1. Caption: Control vs treatment. Source asset: /private/image.pdf. Saved figure image: /private/saved.png'}]))
assert.equal(caption.selectedEvidence[0].source,'Control vs treatment')
assert(!JSON.stringify(caption).includes('/private'))
const long=JSON.parse(compactAnchorContext([{...sentence,source:'x'.repeat(4100)}]))
assert.equal(long.selectedEvidence[0].source.length,4000);assert.equal(long.selectedEvidence[0].truncated,true)
assert.equal(compactAnchorContext([]),'')
console.log('Anchor context passed: unique sources, stable cross-paper identity, explicit truncation and no figure filesystem metadata.')
