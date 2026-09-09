import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('electron/researchEvidenceSample.ts', 'utf8'), 'electron/researchEvidenceSample.ts')
const { sampleResearchEvidence } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const anchors = Array.from({ length: 17 }, (_, i) => ({ paperId: 'engineering', anchorId: `p${i + 1}-s1`, page: i + 1, type: 'sentence', label: '본문', source: `Page ${i + 1}: This specimen was prepared using the described procedure with controlled temperature and pressure.` }))
anchors[10].source = 'Our findings indicate that the proportion is the number of pores with the same shape factor divided by all pores.'
anchors.push({ ...anchors[0], anchorId: 'equation', type: 'equation', source: 'x = y '.repeat(30) })
anchors.push({ ...anchors[0], anchorId: 'broken', source: 'Math extraction = '.repeat(30) })
const sample = sampleResearchEvidence(anchors, '', 24, 12000)
assert(sample.some(item => item.anchor.page === 11), 'One shared section title must not hide page 11 findings')
assert(sample.some(item => item.anchor.page === 17), 'Later pages must be sampled')
assert(!sample.some(item => ['equation', 'broken'].includes(item.anchor.anchorId)))
assert(sample.every(item => item.line.endsWith(item.anchor.source)), 'Quotes must be complete original source')
assert(sample.length <= 24 && sample.reduce((sum, item) => sum + item.line.length + 1, 0) <= 12000)
assert.equal(sampleResearchEvidence(anchors, 'prism://paper/engineering?anchor=p15-s1', 2)[0].anchor.page, 15)
assert(sampleResearchEvidence(anchors, '', 24, 200).reduce((sum, item) => sum + item.line.length + 1, 0) <= 200)
console.log('research-evidence-sample: late-page coverage, explicit references, whole-source and budget/artifact guards passed')

const bibliography = [...anchors, {...anchors[0],page:16,type:'section',source:'References'}, {...anchors[0],page:18,type:'section',source:'Appendix A'}, {...anchors[0],page:18,anchorId:'appendix',source:'An additional experiment confirms the same controlled temperature procedure with independent samples.'}]
const withoutReferences = sampleResearchEvidence(bibliography,'')
assert(!withoutReferences.some(item => item.anchor.page===16 || item.anchor.page===17))
assert(withoutReferences.some(item => item.anchor.anchorId==='appendix'))

assert.equal(sampleResearchEvidence([{...anchors[0], source:'This is an open access article distributed under the terms of the Creative Commons Attribution License.'}],'').length,0)
