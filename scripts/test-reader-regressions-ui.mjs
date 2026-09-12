import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const require = createRequire(import.meta.url), root = await fs.mkdtemp(path.join(os.tmpdir(),'prism-product-ui-reader-'))
const vault = path.join(root,'Research library with a very long folder name'); await fs.mkdir(vault); await fs.mkdir(path.join(root,'profile'))
await fs.writeFile(path.join(root,'profile','settings.json'),JSON.stringify({libraryPath:vault,autoTranslate:false,autoMemory:false,autoReadingGuide:false}))
const sample = path.join(root,'Reader test.pdf')
function fixturePdf() {
  const content='BT /F1 16 Tf 40 740 Td (A test of consecutive equations) Tj ET\nBT /F1 11 Tf 40 690 Td (The experiment compares different mathematical models.) Tj ET\nBT /F1 12 Tf 80 610 Td (x = y + 2) Tj 0 -16 Td (z = x + 4) Tj ET\n40 480 200 80 re S\nBT /F1 10 Tf 40 460 Td (Figure 1. Experimental design.) Tj ET'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
  let pdf='%PDF-1.4\n'; const offsets=[0]; objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`});const start=Buffer.byteLength(pdf)
  return pdf+`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
}
await fs.writeFile(sample,fixturePdf());await fs.writeFile(path.join(root,'selection.txt'),sample)
const port=9348, child=spawn(require('electron'),[`--remote-debugging-port=${port}`,'scripts/product-test-host.cjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PRISM_PRODUCT_TEST_ROOT:root,PRISM_PRODUCT_TEST_CHAT:'1',PRISM_TEST_DISABLE_AUTO_TRANSLATE:'1',PRISM_TEST_WINDOW_SIZE:process.env.PRISM_TEST_WINDOW_SIZE || '1500x1000'}})
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), connections=[]
let readerUi
async function connect(title) {
  let target;for(let i=0;i<180&&!target;i++){try{target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(p=>p.type==='page'&&p.title===title)}catch{}if(!target)await sleep(100)}assert(target,logs)
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let seq=0
  socket.onmessage=({data})=>{const event=JSON.parse(data);if(event.id){const p=pending.get(event.id);pending.delete(event.id);event.error?p.reject(new Error(event.error.message)):p.resolve(event.result)}}
  await new Promise(resolve=>socket.onopen=resolve);connections.push(socket)
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value}
  const wait=async expression=>{for(let i=0;i<300;i++){const value=await evaluate(`(() => { const value = (${expression}); return value instanceof Node ? true : value })()`);if(value)return value;await sleep(100)}throw new Error(`Timeout: ${expression}\n${await evaluate('document.body.innerText')}\n${logs.slice(-2500)}`)}
  return {send,evaluate,wait}
}
async function rightDrag(ui, rect) {
  const before = await ui.evaluate('document.querySelectorAll(".composer-anchor-label").length')
  await ui.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',buttons:2,clickCount:1,x:rect.x,y:rect.y})
  await ui.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'right',buttons:2,x:rect.x+rect.width,y:rect.y+rect.height})
  await ui.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',buttons:0,clickCount:1,x:rect.x+rect.width,y:rect.y+rect.height})
  await ui.wait(`document.querySelectorAll('.composer-anchor-label').length > ${before}`)
}
async function renderedPane(ui, mode, fitted) {
  // Hidden panes retain their canvases. Wait for the shown pane's fitted width,
  // not a completed render at its old hidden width before ResizeObserver runs.
  await ui.wait(`(() => {const page=document.querySelector('[data-pane=${mode}][data-shown=true] .continuous-page.${mode}.rendered');if(!page)return false;if(${mode==='translated'}&&page.classList.contains('paper-layout-page')!==${Boolean(fitted)})return false;if(!${Boolean(fitted)})return true;const pane=page.closest('.document-scroll'),style=getComputedStyle(pane),available=pane.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),width=parseFloat(page.style.width),natural=width/Number(page.dataset.renderScale);return Math.abs(width-Math.min(2,Math.max(.15,available/natural))*natural)<1})()`)
}
try {
  const ui=await connect('Prism');await ui.wait('Boolean(window.prism && document.querySelector(".new-paper"))')
  readerUi=ui
  const first=await ui.evaluate(`window.prism.importLocalPaper(${JSON.stringify({arxivId:'',title:'A test of consecutive equations and the relationship between mathematical assumptions and experimental results',authors:['Test Author'],published:'2026',updated:'',summary:'',categories:[],pdfUrl:'',absUrl:''})})`);await ui.send('Page.reload');await ui.wait('document.querySelector(".paper-tree button")');await ui.evaluate('document.querySelector(".paper-tree button").click()')
  await ui.wait('document.querySelector(".continuous-page.original.rendered") && !document.querySelector(".paper-analysis-status")')
  assert(await ui.wait('document.querySelectorAll(".structure-anchor-layer .equation").length > 0'))
  const firstCache=path.join(path.dirname(first.pdfPath),'reader-analysis.json'); await fs.access(firstCache)
  const firstCacheTime=(await fs.stat(firstCache)).mtimeMs
  // macOS CI may constrain the native window to a small virtual display. The
  // sidebar is intentionally hidden below 1180px; test its wide layout explicitly,
  // then restore the real viewport before testing native screenshot coordinates.
  const narrow=await ui.evaluate('window.innerWidth <= 1180')
  if(narrow) await ui.send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await ui.wait('document.querySelector(".sidebar").getBoundingClientRect().width > 0')
  assert(await ui.evaluate('(() => { const card=document.querySelector(".sidebar-repository").getBoundingClientRect(), sidebar=document.querySelector(".sidebar").getBoundingClientRect(); return card.left >= sidebar.left+10 && card.right <= sidebar.right-10 })()'),'Library folder card fits inside sidebar including margins')
  if(narrow) { await ui.send('Emulation.clearDeviceMetricsOverride');await ui.wait('document.querySelector(".continuous-page.original.rendered")') }
  const sourceSegments=JSON.parse(await fs.readFile(firstCache,'utf8')).source.segments
  await fs.writeFile(first.translationPath,JSON.stringify({version:1,provider:'codex',model:'offline',sourceHash:'',segments:sourceSegments.map(segment=>({...segment,translation:['text','heading','caption'].includes(segment.kind)?'서로 다른 수학 모형의 차이와 실험 결과를 비교합니다. 선택한 번역 문장이 캡처 이미지에도 보여야 합니다. '.repeat(segment.kind==='text'?32:1):segment.source}))}))
  const session={id:'sidebar-topic',libraryPath:vault,title:'@근거1 설명해줘',provider:'codex',model:'offline',createdAt:Date.now(),updatedAt:Date.now(),messages:[{id:'q1',role:'user',text:'[@수식1] 두 수식의 가정과 실험 결과는 어떻게 연결되나요?',createdAt:Date.now(),primaryPaperId:first.arxivId},{id:'q2',role:'user',text:'고마워',createdAt:Date.now()}]}
  await ui.evaluate(`window.prism.saveSessions([${JSON.stringify(session)}])`)
  await ui.send('Page.reload');await ui.wait('document.querySelector(".session-copy strong")?.innerText.includes("두 수식의 가정")')
  assert.equal(await ui.evaluate('document.querySelectorAll(".session-provider").length'),0)
  assert(await ui.evaluate('document.querySelector(".session-copy small").innerText.includes("질문 2개")'))
  await ui.wait('document.querySelector(".continuous-page.original.rendered") && !document.querySelector(".paper-analysis-status")')
  if(process.argv[2]) {
    await fs.writeFile(path.join(root,'selection.txt'),path.resolve(process.argv[2]))
    const second=await ui.evaluate('window.prism.importLocalPaper()')
    const originalTranslation=path.join(path.dirname(path.resolve(process.argv[2])),'translation.ko.json')
    const hasTranslation=await fs.stat(originalTranslation).then(()=>true,()=>false)
    if(hasTranslation) await fs.copyFile(originalTranslation,second.translationPath)
    await ui.send('Page.reload')
    await ui.wait('document.querySelectorAll(".paper-tree button").length === 2')
    assert(await ui.evaluate('[...document.querySelectorAll(".paper-tree button > svg")].every(icon => Math.abs(icon.getBoundingClientRect().width-15)<.1 && Math.abs(icon.getBoundingClientRect().height-15)<.1)'),'Short and long paper titles have equal icon dimensions')
    await ui.evaluate(`[...document.querySelectorAll('.paper-tree button')].find(b=>b.innerText.includes(${JSON.stringify(second.title)})).click()`)
    await ui.wait('document.querySelector(".document-mode > button:first-child")')
    await ui.evaluate('document.querySelector(".document-mode > button:first-child").click()')
    await ui.wait('document.querySelector(".continuous-page.original.rendered") && !document.querySelector(".paper-analysis-status")')
    await ui.evaluate('document.querySelector("[data-page=original-2]").scrollIntoView()')
    await ui.wait('document.querySelector("[data-page=original-2].rendered")')
    const figures=await ui.wait('document.querySelectorAll("[data-page=original-2] .source-figure-layer button").length')
    console.log('Real paper page 2 figure regions:',figures)
    assert.equal(figures,2,'Two caption columns should produce two complete multi-panel figures')
    const figureBounds=await ui.evaluate('document.querySelector("[data-page=original-2] .source-figure-layer button").getBoundingClientRect().toJSON()')
    await ui.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:figureBounds.x+20,y:figureBounds.y+20})
    await fs.mkdir('tmp/ui',{recursive:true});await fs.writeFile('tmp/ui/reader-figures.png',Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'))
    if(hasTranslation) {
      await ui.evaluate('document.querySelector(".document-mode > button:nth-child(2)").click()')
      await ui.wait('document.querySelector("[data-page=translated-2].rendered")')
      await ui.evaluate('document.querySelector("[data-page=translated-2]").scrollIntoView()')
      await ui.wait('document.querySelectorAll("[data-page=translated-2] .structure-anchor.figure").length === 2')
      await ui.wait('(() => { const page = document.querySelector("[data-page=translated-2]"); return [...page.querySelectorAll(".structure-anchor.figure")].every(figure => figure.getBoundingClientRect().width > page.getBoundingClientRect().width * .25) })()')
      await ui.evaluate('document.querySelector("[data-page=translated-2]").scrollIntoView({block:"start"})')
      await fs.writeFile('tmp/ui/reader-translated-figures.png',Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'))
      const selectedFigure=await ui.evaluate('(() => {const r=document.querySelector("[data-page=translated-2] .structure-anchor.figure canvas").getBoundingClientRect();return {x:Math.ceil(r.x+5),y:Math.ceil(r.y+5),width:Math.floor(Math.min(200,r.width-10)),height:Math.floor(Math.min(150,r.height-10))}})()')
      await rightDrag(ui,selectedFigure)
      await ui.evaluate('document.querySelector(".document-mode > button:first-child").click()')
    }
    // Inactive progress must be restored immediately; a completed other paper must not stop this one.
    const events=[{channel:'translation:progress',event:{arxivId:first.arxivId,revision:10,running:true,completed:4,total:12}},{channel:'translation:progress',event:{arxivId:second.arxivId,revision:11,running:true,completed:31,total:50}}]
    await fs.writeFile(path.join(root,'reader-events.json'),JSON.stringify(events));await ui.evaluate('window.prism.getSettings()')
    await ui.wait('document.body.innerText.includes("31/50 · 중지")')
    await ui.evaluate(`[...document.querySelectorAll('.paper-tree button')].find(b=>b.innerText.includes(${JSON.stringify(first.title)})).click()`)
    await ui.wait('document.body.innerText.includes("4/12 · 중지")')
    await ui.wait('document.querySelector(".continuous-page.original.rendered") && !document.querySelector(".paper-analysis-status")')
    assert.equal((await fs.stat(firstCache)).mtimeMs,firstCacheTime,'Reopening an unchanged PDF reuses analysis')
    await fs.writeFile(path.join(root,'reader-events.json'),JSON.stringify([{channel:'translation:done',event:{arxivId:second.arxivId,revision:12,running:false,completed:50,total:50}}]));await ui.evaluate('window.prism.getSettings()');await ui.wait('document.body.innerText.includes("4/12 · 중지")')
  }
  // Native right-button drag creates a real saved PNG without entering capture mode.
  await ui.evaluate('document.querySelector(".document-mode > button:first-child").click()')
  await renderedPane(ui,'original',true)
  const rect=await ui.evaluate('document.querySelector("[data-pane=original][data-shown=true] .continuous-page.original").getBoundingClientRect().toJSON()')
  await rightDrag(ui,{x:rect.x+45,y:rect.y+100,width:190,height:110})
  const figureFiles=await fs.readdir(path.join(path.dirname(first.pdfPath),'figures'));assert(figureFiles.some(file=>file.endsWith('.png')))
  // Both translation layouts must capture visible Korean prose, with source provenance.
  await ui.evaluate('document.querySelector(".document-mode > button:nth-child(2)").click()')
  for(const format of ['paper','flow']) {
    await ui.evaluate(`(() => {const select=document.querySelector('.translation-format');select.value='${format}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await ui.wait('document.querySelector(".continuous-page.translated.rendered") && document.querySelector(".continuous-page.translated").innerText.includes("서로 다른 수학 모형")')
    await renderedPane(ui,'translated',format==='paper')
    await ui.evaluate('document.querySelector(".continuous-page.translated .reading-block:has([data-anchor])").scrollIntoView({block:"center"})')
    const selected=await ui.evaluate('(() => {const block=document.querySelector(".continuous-page.translated .reading-block:has([data-anchor])"), r=block.getBoundingClientRect(), pane=block.closest(".document-scroll").getBoundingClientRect(), x=Math.ceil(Math.max(r.x+2,pane.x+2)), y=Math.ceil(Math.max(r.y+2,pane.y+2));return {x,y,width:Math.floor(Math.min(250,r.right-x-2,pane.right-x-2)),height:Math.floor(Math.min(80,r.bottom-y-2,pane.bottom-y-2))}})()')
    assert(selected.width>=24&&selected.height>=24,'Select a visible part of the translated paragraph')
    await rightDrag(ui,selected)
    const files=await fs.readdir(path.join(path.dirname(first.pdfPath),'figures'))
    const latest=files.filter(file=>file.endsWith('.png')).sort().at(-1)
    const bytes=await fs.readFile(path.join(path.dirname(first.pdfPath),'figures',latest))
    const dimensions=await ui.evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${bytes.toString('base64')}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<160&&pixels[i+1]<160&&pixels[i+2]<160)ink++;return {width:img.width,height:img.height,ink}})()`)
    assert(Math.abs(dimensions.width-selected.width)<=2 && Math.abs(dimensions.height-selected.height)<=2,`${format}: captured the displayed selection dimensions`)
    assert(dimensions.ink>100,`${format}: the translated text is present, not a blank crop from original coordinates`)
    await fs.mkdir('tmp/ui',{recursive:true});await fs.writeFile(`tmp/ui/reader-capture-${format}.png`,bytes)
    const metadata=JSON.parse(await fs.readFile(path.join(path.dirname(first.pdfPath),'figures',latest.replace('.png','.json')),'utf8'))
    assert.equal(metadata.paperId,first.arxivId);assert.equal(metadata.page,1)
    assert(metadata.rect.x>=0&&metadata.rect.y>=0&&metadata.rect.x+metadata.rect.width<=1.001&&metadata.rect.y+metadata.rect.height<=1.001)
    if(format==='flow') {
      await ui.evaluate('document.querySelector(".continuous-page.translated .reading-block.text").scrollIntoView({block:"end"})')
      const lower=await ui.evaluate('(() => {const page=document.querySelector(".continuous-page.translated"), r=page.querySelector(".reading-block.text").getBoundingClientRect();return {x:Math.ceil(r.x+2),y:Math.floor(r.bottom-90),width:180,height:80,localY:r.bottom-page.getBoundingClientRect().top-90,sourceHeight:parseFloat(page.querySelector(".flow-original canvas").style.height)}})()')
      assert(lower.localY>lower.sourceHeight,`Exercise a reflowed area below the original PDF page height: ${JSON.stringify(lower)}`)
      await rightDrag(ui,lower)
    }
  }
  await fs.writeFile('tmp/ui/reader-sidebar.png',Buffer.from((await ui.send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  // Drag an actual native file through Chromium: preload must recover its path with webUtils.
  await fs.writeFile(path.join(root,'latex-offer.json'),JSON.stringify({arxivId:'2210.02747',title:'A test of consecutive equations',authors:[],summary:'',published:'2022',updated:'',categories:[],pdfUrl:'https://arxiv.org/pdf/2210.02747',absUrl:'https://arxiv.org/abs/2210.02747'}))
  await ui.evaluate('document.querySelector(".new-paper").click()');const drop=await ui.wait('document.querySelector(".pdf-drop-zone")?.getBoundingClientRect().toJSON()')
  for(const type of ['dragEnter','dragOver','drop']) await ui.send('Input.dispatchDragEvent',{type,x:drop.x+drop.width/2,y:drop.y+drop.height/2,data:{items:[],files:[sample],dragOperationsMask:1}})
  await ui.wait('document.querySelector(".local-source-offer")');await ui.evaluate('document.querySelector(".local-source-offer button").click()')
  const body='Inline $x_1$ and \\(y^2\\).\n\n$$\\frac{a}{b}$$\n\n\\[\nx&=1\\\\\ny&=2\n\\]\n\nEnd.'
  const created=await ui.evaluate(`window.prism.createKnowledgeNode(${JSON.stringify({nodeType:'concept',title:'Math rendering regression',body})})`)
  await ui.evaluate(`window.prism.openKnowledgeNodeInNotes(${JSON.stringify(created.id)})`)
  const notes=await connect('Prism Notes');await notes.wait('document.querySelectorAll(".cm-rendered-inline-math .katex").length >= 2 && document.querySelectorAll(".cm-rendered-math .katex").length >= 2')
  const before=await notes.evaluate(`window.prism.readKnowledgeNode(${JSON.stringify(created.id)})`)
  await notes.evaluate('document.querySelector(".cm-rendered-inline-math").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}))')
  await notes.wait('document.querySelector(".cm-content").textContent.includes("$x_1$")')
  await notes.evaluate('document.querySelector(".cm-content").blur()');await notes.wait('document.querySelectorAll(".cm-rendered-inline-math .katex").length >= 2')
  const after=await notes.evaluate(`window.prism.readKnowledgeNode(${JSON.stringify(created.id)})`);assert.equal(after.content,before.content,'Rendering and click-to-edit preserve stored Markdown')
  await fs.writeFile('tmp/ui/reader-note-math.png',Buffer.from((await notes.send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Reader UI passed: sidebar topics and unclipped library card, equal paper icons, native source/translated right drag (both layouts, long reflow and Korean pixels), PDF drop/source offer, typed figure tags and note math; optional corpus checks cover progress switching, cache reuse and compound figures.')
} catch(error) {
  if(readerUi) try {
    await fs.mkdir('tmp/ui',{recursive:true});await fs.writeFile('tmp/ui/reader-failure.png',Buffer.from((await readerUi.send('Page.captureScreenshot',{format:'png'})).data,'base64'))
    console.error('Reader viewport',await readerUi.evaluate('({width:innerWidth,height:innerHeight,sidebar:document.querySelector(".sidebar")?.getBoundingClientRect().toJSON()})'))
  } catch { /* Keep the original failure if the renderer has already exited. */ }
  console.error('Fixture retained at',root);throw error
}
finally { for(const socket of connections)socket.close();child.kill() }
