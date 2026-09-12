import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { loadTs } from './load-ts.mjs'
import { LoadedThreads } from '../dist-electron/loadedThreads.js'
import { TranslationStatusStore } from '../dist-electron/translationStatus.js'
import { readPaperAnalysis, writePaperAnalysis } from '../dist-electron/paperAnalysisCache.js'
import { containsLatexSource, samePaperTitle } from '../dist-electron/latexAvailability.js'
const threads = new LoadedThreads(); let resumes = 0
await Promise.all([threads.ensure('thread', async () => { resumes++; await new Promise(resolve => setTimeout(resolve, 10)) }), threads.ensure('thread', async () => { throw new Error('duplicate writer') })])
await threads.ensure('thread', async () => { throw new Error('already has an active writer') })
assert.equal(resumes, 1)
threads.clear(); await threads.ensure('thread', async () => { resumes++ }); assert.equal(resumes, 2)
await assert.rejects(threads.ensure('failed', async () => { throw new Error('offline') }))
await threads.ensure('failed', async () => {})
const states = new TranslationStatusStore()
const first = states.report('translation:progress', { arxivId: 'a', completedSegments: 4, totalSegments: 12 })
states.report('translation:progress', { arxivId: 'b', completedSegments: 31, totalSegments: 50 })
assert.equal(states.get('a').completed, 4); assert.equal(states.get('b').completed, 31)
states.report('translation:done', { arxivId: 'a' }); assert.equal(states.get('a').running, false); assert.equal(states.get('b').running, true)
assert(states.get('a').revision > first.revision); assert.equal(states.get('a').total, 12)
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-analysis-'))
const signature = 'a'.repeat(64), pdf = path.join(root, 'original.pdf'), source = { matched: 0, segments: [{ id: 'e1', kind: 'equation', preciseRects: [{ left: 10, top: 20, width: 30, height: 40, fontSize: 10 }] }] }
await writePaperAnalysis(pdf, signature, source); assert.deepEqual(await readPaperAnalysis(pdf, signature), source)
assert.equal(await readPaperAnalysis(pdf, 'b'.repeat(64)), null)
await fs.writeFile(path.join(root, 'reader-analysis.json'), JSON.stringify({ version: 1, signature, source })); assert.equal(await readPaperAnalysis(pdf, signature), null)
await fs.writeFile(path.join(root, 'reader-analysis.json'), '{broken'); assert.equal(await readPaperAnalysis(pdf, signature), null)
assert(containsLatexSource(Buffer.from('\\documentclass{article}\n\\begin{document}test')))
assert(containsLatexSource(gzipSync(Buffer.from('\\documentclass{article}'))))
for (const value of ['%PDF-1.4', '<html>source unavailable</html>', 'random bytes']) assert(!containsLatexSource(Buffer.from(value)))
assert(samePaperTitle('Flow Matching for Generative Modeling', 'Flow matching for generative modeling.'))
assert(!samePaperTitle('Flow Matching for Generative Modeling', 'Flow Matching for Discrete Modeling'))
const { noteMathRanges } = await loadTs('src/noteMath.ts')
assert.deepEqual(noteMathRanges('Inline $x_1$ and \\(y^2\\).\n$$\\frac{a}{b}$$\n\\[x&=1\\\\\ny&=2\\]').map(math => [math.source, math.display]), [['x_1',false],['y^2',false],['\\frac{a}{b}',true],['x&=1\\\\\ny&=2',true]])
assert.equal(noteMathRanges('`$a$` [cost $b$](url) \\$20\n```tex\n$$x$$\n```').length,0)
const { stableReferences } = await loadTs('src/paper/readerContext.ts')
const anchor=(type,id,paperId='a')=>({type,anchorId:id,paperId,label:'old',source:'x',page:1})
assert.deepEqual(stableReferences([anchor('sentence','s'),anchor('equation','e'),anchor('figure','f'),anchor('table','t'),anchor('sentence','s','b')]).map(a=>a.label), ['문장1','수식1','피겨1','표1','문장2'])
assert.equal(stableReferences([anchor('equation','e')],[{...anchor('equation','e'),label:'근거7'}])[0].label,'근거7')
const { pdfGraphicRects } = await loadTs('src/paper/pdfGraphics.ts')
const { OPS, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const graphics = pdfGraphicRects({fnArray:[OPS.paintFormXObjectBegin,OPS.transform,OPS.paintImageXObject,OPS.paintFormXObjectEnd,OPS.transform,OPS.paintImageXObject],argsArray:[[[2,0,0,2,10,20],[0,0,100,100]],[10,0,0,10,5,5],['image'],[],[20,0,0,30,200,300],['image']]},{width:600,height:800,transform:[1,0,0,1,0,0]},{OPS,Util})
assert.deepEqual(graphics.images,[{left:20,top:30,width:20,height:20},{left:200,top:300,width:20,height:30}])
const { joinVectorRegions, captionFigureRegions } = await loadTs('src/paper/figureGeometry.ts')
const strokes = Array.from({length:1600},(_,i)=>({left:i%30,top:0,width:.1,height:.1}))
strokes.push({left:100,top:100,width:100,height:80})
assert(joinVectorRegions(strokes,1,600*800).some(rect=>rect.left===100))
const panels=[{left:40,top:40,width:80,height:60},{left:160,top:45,width:80,height:60}]
assert.equal(captionFigureRegions(panels,[[{left:40,top:180,width:210,height:20}]],[],1).length,1)
const { joinPreservedRegions, preservedRegionKind } = await loadTs('src/paper/preservedRegions.ts')
const joined = joinPreservedRegions([{id:'a',items:[{kind:'artifact'}],rect:{left:40,top:30,width:100,height:10}},{id:'b',items:[{kind:'equation'}],rect:{left:40,top:42,width:100,height:10}}])
assert.equal(joined.length,1); assert.equal(preservedRegionKind(joined[0].items,'artifact'),'equation','An unrecognized fraction fragment cannot remove the green equation region')
const { translatedCaptureSource } = await loadTs('src/paper/translatedCapture.ts')
const region = { display: { left: 300, top: 1000, width: 400, height: 200 }, source: { left: 40, top: 60, width: 200, height: 100 }, image: true }
assert.deepEqual(translatedCaptureSource({left:400,top:1050,width:200,height:100},[region],{width:400,height:800}),{x:.225,y:.10625,width:.25,height:.0625},'Reflowed/scaled figures retain original coordinates')
assert.deepEqual(translatedCaptureSource({left:400,top:1050,width:200,height:100},[{...region,image:false}],{width:400,height:800}),{x:.1,y:.075,width:.5,height:.125},'Reflowed sentences link to the whole source block')
assert.equal(translatedCaptureSource({left:0,top:0,width:20,height:20},[region],{width:400,height:800}),undefined,'Blank margins are not assigned invented source bounds')
console.log('Reader regressions passed, including translated capture provenance across reflow and scaling.')
