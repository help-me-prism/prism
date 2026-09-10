import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {transformWithOxc} from 'vite'
import {captureToPaperNote} from '../dist-electron/capture.js'
import {listEvidenceAnchors} from '../dist-electron/evidence.js'
const compile = async (file, dependency) => { let source = await fs.readFile(file,'utf8'); if (dependency) source = source.replaceAll("'../../electron/scientificSource'",JSON.stringify(dependency)).replaceAll("'../electron/scientificSource'",JSON.stringify(dependency)); const {code} = await transformWithOxc(source,file); return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64') }
const shared = await compile('electron/scientificSource.ts')
const {validatedScientificSource,validatedScientificSpans,scientificPreviewText} = await import(shared)
const {alignGlyphGeometry} = await import(await compile('src/paper/glyphAlignment.ts',shared))
const {compactAnchorContext} = await import(await compile('src/paper/anchorContext.ts',shared))
const {readerExcerpts} = await import(await compile('src/paper/readerContext.ts',shared))
const {evidenceMarkdown,embeddedEvidence} = await import(await compile('src/evidence.ts',shared))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-inline-glyphs.json','utf8'))
const geometry = alignGlyphGeometry(fixture.expected,fixture.painted,fixture.items,fixture.segments)
assert.equal(geometry.ok,true)
const segment = fixture.segments[0], spans = geometry.scientificSpans.get(segment.id), original = segment.source
const anchor = {paperId:'sample',paperTitle:'Engineering',anchorId:segment.id,type:'sentence',page:4,label:'근거1',source:original,scientificSpans:spans,sourceHash:createHash('sha256').update(original).digest('hex')}
const projected = validatedScientificSource(original,spans)
assert(scientificPreviewText(original,spans).includes('ρ₀'), 'Plain source previews must retain verified subscript semantics')
assert.equal(scientificPreviewText(original,undefined),original,'Unverified preview text stays unchanged')
assert(projected.includes('$\\rho_{0}$'))
assert.equal(JSON.parse(compactAnchorContext([anchor])).selectedEvidence[0].source,projected)
assert.equal(readerExcerpts([anchor],'density')[0].source,projected)
const markdown = evidenceMarkdown(anchor)
assert(markdown.includes(projected))
assert.equal(embeddedEvidence(markdown)[0].source, original)
assert.equal(embeddedEvidence(markdown)[0].sourceHash, anchor.sourceHash)
for (const mutate of [s=>({...s,latex:'\\input{secret}'}),s=>({...s,latex:'\\rho^{0}'}),s=>({...s,text:'wrong'}),s=>({...s,start:s.start+1}),s=>({...s,baseline:Infinity}),s=>({...s,rect:{...s.rect,width:-1}})]) {
 const invalid = spans.map(mutate)
 assert.deepEqual(validatedScientificSpans(original,invalid),[])
 assert.equal(validatedScientificSource(original,invalid),original)
}
assert.deepEqual(validatedScientificSpans(original,[spans[0],spans[0]]),[])
assert.equal(validatedScientificSource(original,undefined),original)
const vault = await fs.mkdtemp(path.join(os.tmpdir(),'prism-scientific-evidence-'))
try {
 const folder = path.join(vault,'papers','sample'); await fs.mkdir(folder,{recursive:true}); await fs.mkdir(path.join(vault,'.prism','anchors'),{recursive:true})
 const paper = {arxivId:'sample',title:'Engineering',notePath:path.join(folder,'sample.md'),pdfPath:path.join(folder,'original.pdf')}
 await fs.writeFile(paper.notePath,'---\ntype: paper\nprism_id: "paper:sample"\ntitle: "Engineering"\n---\n\n# Engineering\n\n## Notes\n')
 await fs.writeFile(path.join(vault,'.prism','anchors','sample.json'),JSON.stringify({anchors:[{id:segment.id,type:'text',page:4,source:original,scientificSpans:spans}]}))
 const [stored] = (await listEvidenceAnchors(vault,[paper])).filter(a=>a.anchorId===segment.id)
 assert.deepEqual(stored.scientificSpans,spans)
 await captureToPaperNote(vault,paper,{kind:'evidence',paperId:'sample',anchorId:segment.id})
 const saved = await fs.readFile(paper.notePath,'utf8')
 assert(saved.includes(projected),'Backend capture persists validated notation in actual Markdown')
 assert.equal(embeddedEvidence(saved)[0].source,original)
 assert.equal(embeddedEvidence(saved)[0].sourceHash,anchor.sourceHash)
} finally {await fs.rm(vault,{recursive:true,force:true})}
console.log('Scientific evidence: actual p4 glyph→selected/automatic prompt→frontend/backend Markdown, immutable identity, malformed/malicious fallback passed')
