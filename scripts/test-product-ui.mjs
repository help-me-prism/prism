import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prism-product-ui-')))
const vault = path.join(root, 'vault'); await fs.mkdir(vault)
await fs.mkdir(path.join(root, 'profile')); await fs.writeFile(path.join(root, 'profile', 'settings.json'), JSON.stringify({ libraryPath: vault, autoTranslate: false }))
const sample = path.join(root, 'Cell biology.pdf')
// A deterministic two-column PDF with prose, a numeric table and a vector diagram.
const content = 'BT /F1 18 Tf 48 740 Td (Cell biology: a reading fixture) Tj ET\nBT /F1 11 Tf 48 700 Td (Cells respond to changes in their environment.) Tj 0 -18 Td (This experiment compares two populations [1].) Tj 270 18 Td (The control group received no treatment.) Tj 0 -18 Td (Results should not imply causation.) Tj ET\nBT /F1 12 Tf 48 620 Td (x = y + 2) Tj ET\n48 500 200 80 re S\nBT /F1 10 Tf 56 555 Td (Group       N       Response) Tj 0 -20 Td (Control     12      0.25) Tj 0 -20 Td (Treatment   12      0.75) Tj ET\nBT /F1 10 Tf 48 480 Td (Table 1. Observations from the experiment.) Tj ET\n320 530 50 50 re S 420 530 50 50 re S 370 555 m 420 555 l S\nBT /F1 10 Tf 320 500 Td (Figure 1. A vector diagram.) Tj ET'
function fixturePdf(content) {
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] /Count 3 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
objects.push(objects[2], objects[2])
let pdf = '%PDF-1.4\n'; const offsets = [0]
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
return pdf
}
const pdf = fixturePdf(content)
await fs.writeFile(sample, pdf); await fs.writeFile(path.join(root, 'selection.txt'), sample)
const port = 9341
const processHandle = spawn(require('electron'), [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(root, 'profile')}`, 'scripts/product-test-host.cjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PRISM_PRODUCT_TEST_CHAT: '1', PRISM_PRODUCT_TEST_ROOT: root, PRISM_TEST_LIBRARY_PATH: '', PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_WINDOW_SIZE: '1280x900' } })
let logs = ''; processHandle.stdout.on('data', chunk => { logs += chunk }); processHandle.stderr.on('data', chunk => { logs += chunk })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let captureFailure = async () => {}; let socket; let sequence = 0; const pending = new Map(); const exceptions = []
try {
  let target
  for (let i = 0; i < 150 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())).find(page => page.type === 'page' && page.title === 'Prism' && page.url.startsWith('file:')) } catch {}
    if (!target) await sleep(100)
  }
  assert(target, logs)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.consoleAPICalled') logs += '\n' + message.params.args.map(item => item.value ?? item.description ?? '').join(' ')
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.id) { const handler = pending.get(message.id); pending.delete(message.id); if (handler) message.error ? handler.reject(Object.assign(new Error(`${handler.method}: ${message.error.message} (${target.url})`), { code: message.error.code })) : handler.resolve(message.result) }
  })
  await new Promise(resolve => socket.addEventListener('open', resolve))
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
  const wait = async expression => { for (let i = 0; i < 200; i++) {
    try { const value = await evaluate(expression); if (value) return value } catch (error) {
      // These are readonly predicates. A navigation can temporarily detach its
      // execution context; never apply this retry to imports, saves or clicks.
      if (error.code !== -32000 || !/active page|context|navigat/i.test(error.message)) throw error
    }
    await sleep(100)
  } throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText")}\n${JSON.stringify(exceptions)}\n${await evaluate("JSON.stringify([...document.querySelectorAll('.continuous-page,.document-scroll')].slice(0,4).map(e=>({c:e.className,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,top:e.scrollTop,rect:e.getBoundingClientRect().toJSON(),s:e.getAttribute('style')})))")}\n${logs}`) }
  const reload = async () => {
    const epoch = `reload-${Date.now()}-${sequence}`
    await evaluate(`window.__testNavigationEpoch=${JSON.stringify(epoch)}; location.reload()`)
    await wait(`Boolean(window.prism && window.__testNavigationEpoch !== ${JSON.stringify(epoch)})`)
  }
  const shot = async name => { const image = await send('Page.captureScreenshot', { format: 'png' }); await fs.mkdir('tmp/ui', { recursive: true }); await fs.writeFile(`tmp/ui/${name}.png`, Buffer.from(image.data, 'base64')) }
  captureFailure = () => Promise.race([shot('product-ui-failure'), sleep(2000)])
  await send('Runtime.enable'); await wait('Boolean(window.prism && document.querySelector(".reader-empty"))')
  assert.equal((await evaluate('window.prism.getSettings()')).autoTranslate, false)
  await evaluate('localStorage.setItem("prism.appearance", "light"); dispatchEvent(new Event("prism-theme"))'); await reload()
  await wait('Boolean(document.querySelector(".reader-empty"))'); await shot('product-welcome-light')
  const paper = await evaluate('window.prism.importLocalPaper()')
  assert(paper.arxivId.startsWith('local-')); assert.equal(paper.title, 'Cell biology')
  assert.equal((await evaluate('window.prism.importLocalPaper()')).arxivId, paper.arxivId)
  assert.equal((await evaluate('window.prism.listLibrary()')).length, 1)
  await reload(); await wait('Boolean(document.querySelector(".continuous-page.rendered"))')
  await wait('document.querySelectorAll("[data-anchor]").length > 3')
  await wait('document.querySelector(".page-jump input").value === "1"')
  assert.equal(await evaluate('document.querySelector(".translation-scope").value'), 'page')
  const titlebarSafe = await evaluate(`(() => { const button = document.querySelector('.reading-focus'); const rect = button.getBoundingClientRect(); const mac = document.documentElement.dataset.platform === 'mac'; return rect.left >= (mac ? 80 : 0) && rect.right <= innerWidth - (mac ? 10 : 130) && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)); })()`)
  assert(titlebarSafe, 'Reading controls must remain clickable and clear of the platform window controls')
  await evaluate('document.querySelector(".reading-focus").click()')
  await wait('Boolean(document.querySelector(".composer-editor"))')
  await evaluate('document.querySelector(".composer-editor").focus()')
  await send('Input.insertText', { text: '근거 준비 중 취소하는 UI 회귀 검사' })
  await evaluate('document.querySelector("button[aria-label=보내기]").click()')
  await wait('Boolean(document.querySelector(".send-button.stop"))')
  await evaluate('document.querySelector(".send-button.stop").click()')
  await sleep(1000)
  assert.equal(await fs.stat(path.join(root, 'unexpected-chat-call.txt')).then(() => true, () => false), false)
  assert.equal(await evaluate('Boolean(document.querySelector(".send-button.stop"))'), false)
  await evaluate('document.querySelector(".reading-focus").click()')
  await evaluate('document.querySelector(".page-nav button:last-child").click()')
  await wait('document.querySelector(".page-jump input").value === "2"')
  await evaluate('document.querySelector(".page-nav button:first-child").click()')
  await wait('document.querySelector(".page-jump input").value === "1"')
  await evaluate('document.querySelector(".page-jump input").focus()')
  await send('Input.insertText', { text: '3' })
  await evaluate('document.querySelector(".page-jump").requestSubmit()')
  await wait('document.querySelector(".page-jump input").value === "3"')
  await wait('Boolean(document.querySelector("[data-page=original-3].rendered"))')
  await reload()
  await wait('document.querySelector(".page-jump input")?.value === "3"')
  await wait('Boolean(document.querySelector("[data-page=original-3].rendered"))')
  assert(await evaluate('(() => { const p = document.querySelector("[data-page=original-3]").getBoundingClientRect(); const pane = document.querySelector(".document-scroll").getBoundingClientRect(); return Math.abs(p.top - pane.top) < 40; })()'), 'Reload must restore the actual page, not merely its counter')
  await evaluate('document.querySelector(".page-jump input").focus()')
  await send('Input.insertText', { text: '1' })
  await evaluate('document.querySelector(".page-jump").requestSubmit()')
  await wait('document.querySelector(".page-jump input").value === "1"')
  await shot('product-pdf-light')
  let anchorData
  for (let attempt = 0; attempt < 30 && !anchorData; attempt++) { try { anchorData = JSON.parse(await fs.readFile(path.join(path.dirname(paper.pdfPath), 'anchors.json'), 'utf8')) } catch { await sleep(100) } }
  assert(anchorData)
  const citedSource = anchorData.anchors.find(anchor => anchor.source.includes('[1]'))
  assert(citedSource)
  await fs.writeFile(paper.translationPath, JSON.stringify({ segments: [{ ...citedSource, kind: citedSource.type, translation: '인용 표시가 누락된 잘못된 번역' }] }))
  assert.equal((await evaluate(`window.prism.readTranslation(${JSON.stringify(paper.arxivId)})`)).segments[0].translation, undefined)
  await evaluate('document.querySelector(".document-mode button:nth-child(2)").click()')
  await wait('Boolean(document.querySelector(".paper-layout-page.rendered .untouched-paper > canvas"))')
  // Width fitting may start a replacement render between separate observations.
  // Check ready state and complete pixel identity atomically on the same page.
  await wait('(() => { const page = document.querySelector(".paper-layout-page.rendered"), copy=page?.querySelector(".untouched-paper > canvas"); return !!copy && page.querySelector(":scope > canvas").toDataURL() === copy.toDataURL(); })()')
  const translations = new Map([
    ['Cells respond to changes in their environment.', '세포는 주변 환경의 변화에 반응한다. 번역문이 원문보다 길어져도 수식이나 표를 덮지 않고 자연스럽게 다음 줄로 이어져야 한다.'],
    ['This experiment compares two populations [1].', '이 실험은 두 집단을 비교한다 [1].'],
    ['The control group received no treatment.', '대조군에는 처치를 시행하지 않았다.'],
    ['Results should not imply causation.', '결과를 인과 관계로 해석해서는 안 된다.'],
  ])
  await fs.writeFile(paper.translationPath, JSON.stringify({ version: 1, provider: 'fixture', model: 'offline-render-test', segments: anchorData.anchors.map(anchor => ({ ...anchor, kind: anchor.type, translation: translations.get(anchor.source) })) }))
  await reload(); await wait('Boolean(document.querySelector(".document-mode"))')
  await wait('!document.querySelector(".paper-analysis-status") && Boolean(document.querySelector(".paper-layout-page.rendered .paper-layout-block.text span"))')
  await evaluate('document.fonts.ready')
  const settledPane = async (kind, arrangement) => {
    let previous; let stable = 0
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await evaluate(`(() => {
        const pane=document.querySelector('[data-pane=${kind}]'), bench=document.querySelector('.pane-workbench');
        if (!pane || !bench) return null;
        const r=pane.getBoundingClientRect(), b=bench.getBoundingClientRect();
        const mode=${JSON.stringify(arrangement)}, expectedWidth=b.width/(mode==='row'?2:1), expectedHeight=b.height/(mode==='col'?2:1)-30;
        return {width:r.width,height:r.height,benchWidth:b.width,benchHeight:b.height,style:pane.getAttribute('style'),
          ready:pane.dataset.shown==='true' && document.querySelectorAll('.pane-body[data-shown=true]').length===(mode==='single'?1:2)
            && !document.querySelector('.paper-analysis-status') && Math.abs(r.width-expectedWidth)<2 && Math.abs(r.height-expectedHeight)<2};
      })()`)
      stable = snapshot?.ready && JSON.stringify(snapshot) === JSON.stringify(previous) ? stable + 1 : 0
      if (stable >= 3) return snapshot
      previous = snapshot; await sleep(50)
    }
    throw new Error(`Pane geometry did not finish ${arrangement}/${kind}: ${JSON.stringify(previous)}`)
  }

  await evaluate('document.querySelector(".comparison-options > summary").click()')
  assert(await evaluate('(() => { const button = document.querySelector(".comparison-options .reader-toolbar-popover button"); const rect = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)); })()'), 'Comparison choices must be visible and clickable, not clipped by their parent')
  await evaluate('document.querySelector(".comparison-options").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  assert.equal(await evaluate('document.querySelector(".comparison-options").open'), false)
  for (const [choice, kind] of [[1, 'translated'], [2, 'original']]) {
    await evaluate(`document.querySelector('.comparison-options > summary').click()`)
    await evaluate(`document.querySelector('.comparison-options .reader-toolbar-popover button:nth-child(${choice})').click()`)
    // Both layouts already have two visible panes. Wait for the requested axis,
    // not the previous comparison's count, before recording its dimensions.
    await wait(`document.querySelector('.comparison-options .reader-toolbar-popover button:nth-child(${choice})')?.getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.pane-body[data-shown=true]').length === 2`)
    await wait(`(() => { const a=document.querySelector('[data-pane=original]').getBoundingClientRect(), b=document.querySelector('[data-pane=translated]').getBoundingClientRect(); return ${choice === 1 ? 'Math.abs(a.top-b.top)<2 && Math.abs(a.left-b.left)>a.width*.9' : 'Math.abs(a.left-b.left)<2 && Math.abs(a.top-b.top)>a.height*.9'}; })()`)
    const storedLayout = await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`)
    const priorPage = await evaluate('document.querySelector(".page-jump input").value')
    const zoomLabel = kind === 'original' ? '원문 배율' : '번역 배율'
    const priorZoom = await evaluate(`document.querySelector('select[aria-label="${zoomLabel}"]').value`)
    const before = await settledPane(kind, choice === 1 ? 'row' : 'col')
    await evaluate(`document.querySelector('.document-mode > button:nth-child(${kind === 'original' ? 1 : 2})').click()`)
    await wait('document.querySelectorAll(".pane-body[data-shown=true]").length === 1')
    const enlarged = await settledPane(kind, 'single')
    assert(choice === 1 ? enlarged.width > before.width * 1.8 : enlarged.height > before.height * 1.8, `Large reading must provide actual space: ${JSON.stringify({ choice, kind, before, enlarged, storedLayout })}`)
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`), storedLayout, 'Temporary reading must preserve the saved comparison layout')
    await evaluate(`(() => { const select=document.querySelector('select[aria-label="${zoomLabel}"]'); select.value='1.25'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
    await evaluate('document.querySelector(".document-mode > button:nth-child(3)").click()')
    await wait('document.querySelectorAll(".pane-body[data-shown=true]").length === 2')
    const restored = await settledPane(kind, choice === 1 ? 'row' : 'col')
    assert(Math.abs(restored.width - before.width) < 2 && Math.abs(restored.height - before.height) < 2, `Return must restore the prior split instead of choosing a new layout: ${JSON.stringify({choice,kind,before,restored})}`)
    assert.equal(await evaluate('document.querySelector(".page-jump input").value'), priorPage)
    assert.equal(await evaluate(`document.querySelector('select[aria-label="${zoomLabel}"]').value`), priorZoom, 'Return must restore comparison zoom after changing it in large reading')
  }
  await evaluate('document.querySelector(".document-mode button:nth-child(2)").click()')
  await wait('Boolean(document.querySelector(".reading-translation .reading-block"))')
  assert.equal(await evaluate('Boolean(document.querySelector(".translated-text-layer"))'), false)
  assert(await evaluate('document.querySelector(".reading-translation").textContent.includes("세포는")'))
  await wait('document.querySelectorAll(".reading-translation figure canvas").length >= 2')
  assert(await evaluate('[...document.querySelectorAll(".reading-translation figure canvas")].every(canvas => canvas.width > 10 && canvas.height > 10)'))
  assert.equal(await evaluate('Boolean(document.querySelector(".paper-layout-page > .flow-page-heading, .paper-layout-page > .flow-original"))'), false)
  assert(await evaluate('[...document.querySelectorAll(".paper-layout-page.rendered > canvas")].every(canvas => canvas.width >= 1000)'))
  await shot('product-translation-paper')
  const setTranslationZoom = async value => {
    await evaluate(`(() => { const select=document.querySelector('select[aria-label="번역 배율"]'); select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
    await wait(`Boolean(document.querySelector('.paper-layout-page.rendered[data-render-scale="${value}"] .paper-layout-block.text'))`)
    await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
  }
  const translatedMetrics = async () => {
    let previous; let stable = 0
    for (let attempt=0; attempt<60; attempt++) {
      const metrics = await evaluate('(() => { const page=document.querySelector(".paper-layout-page.rendered"), text=page?.querySelector(".paper-layout-block.text:has(span[data-anchor])"), figure=page?.querySelector("figure canvas"); return text && figure ? {width:page.getBoundingClientRect().width,font:parseFloat(getComputedStyle(text).fontSize),textHeight:text.getBoundingClientRect().height,figureWidth:figure.getBoundingClientRect().width} : null; })()')
      stable = metrics && JSON.stringify(metrics)===JSON.stringify(previous) ? stable+1 : 0
      if (stable>=3) return metrics
      previous=metrics; await sleep(50)
    }
    throw new Error(`Translated geometry did not settle: ${JSON.stringify(previous)}`)
  }
  await setTranslationZoom('1')
  const at100 = await translatedMetrics()
  await setTranslationZoom('1.5')
  const at150 = await translatedMetrics()
  for (const metric of ['width','font','figureWidth']) assert(Math.abs(at150[metric]/at100[metric]-1.5)<.02, `Paper zoom must scale ${metric} together: ${JSON.stringify({at100,at150})}`)
  assert(Math.abs(at150.textHeight/at100.textHeight-1.5)<.08,`Paper zoom must preserve paragraph composition, not enlarge text inside a fixed page: ${JSON.stringify({at100,at150})}`)
  await evaluate('(() => { const select=document.querySelector(\'select[aria-label="번역 배율"]\'); select.value="fit"; select.dispatchEvent(new Event("change",{bubbles:true})); })()')
  await wait('(() => { const page=document.querySelector(".paper-layout-page.rendered"); if(!page) return false; const pane=page.closest(".document-scroll"); return page.getBoundingClientRect().width <= pane.clientWidth && page.scrollWidth <= page.clientWidth+2; })()')
  await evaluate(`document.querySelector('.reading-translation figure button[title="피겨를 질문에 추가"]').click()`)
  await wait('Boolean(document.querySelector(".composer-anchor .type-figure"))')
  await wait('Boolean(document.querySelector(".figure-attachment img"))')
  await evaluate('document.querySelector(".figure-attachment").click()')
  await wait('Boolean(document.querySelector(".figure-preview-dialog"))')
  assert(await evaluate('document.querySelector(".figure-preview-dialog").contains(document.activeElement)'), 'Preview must receive keyboard focus')
  await evaluate('document.querySelector(".figure-preview-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  assert.equal(await evaluate('Boolean(document.querySelector(".figure-preview-dialog"))'), false)
  const figureDirectory = path.join(path.dirname(paper.pdfPath), 'figures')
  const figureFiles = await fs.readdir(figureDirectory)
  const savedFigure = figureFiles.find(file => file.endsWith('.png'))
  assert(savedFigure, 'Clicking a translated figure must save a real source image')
  const imageBytes = await fs.readFile(path.join(figureDirectory, savedFigure))
  assert(imageBytes.readUInt32BE(16) > 20 && imageBytes.readUInt32BE(20) > 20, 'Hidden source canvas must yield a nonempty image')
  const figureMetadata = JSON.parse(await fs.readFile(path.join(figureDirectory, savedFigure.replace(/\.png$/, '.json')), 'utf8'))
  assert(Object.values(figureMetadata.rect).every(Number.isFinite))
  assert(figureMetadata.rect.width > 0 && figureMetadata.rect.width <= 1)
  assert(figureMetadata.rect.height > 0 && figureMetadata.rect.height <= 1)
  const renderedPageWidth = await wait('(() => { const canvas=document.querySelector(".paper-layout-page.rendered > canvas"); return canvas && parseFloat(canvas.style.width); })()')
  const displayedCropWidth = renderedPageWidth * figureMetadata.rect.width
  assert(imageBytes.readUInt32BE(16) >= Math.min(displayedCropWidth * 3.9, 1900), 'Figure capture must rerender PDF detail above the display resolution')
  await evaluate('document.querySelector(".figure-attachment").click()')
  await wait('Boolean([...document.querySelectorAll(".figure-preview-controls button")].find(button => button.textContent.includes("100%") && !button.disabled))')
  await evaluate('[...document.querySelectorAll(".figure-preview-controls button")].find(button => button.textContent.includes("100%")).click()')
  assert.equal(await evaluate('document.querySelector(".figure-preview-stage img").getBoundingClientRect().width'), imageBytes.readUInt32BE(16), '100% preview must use the saved PNG pixels')
  await evaluate('[...document.querySelectorAll(".figure-preview-controls button")].find(button => button.textContent.includes("맞춤")).click()')
  assert(await evaluate('(() => { const stage = document.querySelector(".figure-preview-stage"); return stage.scrollWidth <= stage.clientWidth + 1 })()'), 'Fit preview must not overflow horizontally')
  await evaluate('document.querySelector(".figure-preview-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await fs.rename(path.join(figureDirectory, savedFigure), path.join(figureDirectory, savedFigure + '.held'))
  try {
    await evaluate('document.querySelector(".figure-attachment").click()')
    await wait('Boolean(document.querySelector(".figure-preview-error"))')
    assert(await evaluate('Boolean(document.querySelector(".figure-preview-stage img"))'), 'Missing original must retain its preview with an explicit error')
    await fs.rename(path.join(figureDirectory, savedFigure + '.held'), path.join(figureDirectory, savedFigure))
    await evaluate('document.querySelector(".figure-preview-error button").click()')
    await wait('Boolean([...document.querySelectorAll(".figure-preview-controls button")].find(button => button.textContent.includes("100%") && !button.disabled))')
    await evaluate('document.querySelector(".figure-preview-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  } finally { await fs.rename(path.join(figureDirectory, savedFigure + '.held'), path.join(figureDirectory, savedFigure)).catch(() => {}) }
  await evaluate(`window.prism.openEvidenceAnchor(${JSON.stringify({paperId:paper.arxivId, anchorId:savedFigure.replace(/\.png$/, ''), type:'figure',page:figureMetadata.page,label:'피겨'})})`)
  await wait('Boolean(document.querySelector("[data-saved-figure]"))')
  // Large single-pane reading may already place this first-page figure above
  // the viewport midpoint at scrollTop=0. Require full visibility and the
  // nearest reachable centered position, rather than an impossible negative scroll.
  await wait('(() => { const marker = document.querySelector("[data-saved-figure]"); const pane = marker?.closest(".document-scroll"); if (!pane) return false; const a = marker.getBoundingClientRect(), b = pane.getBoundingClientRect(); const top=b.top+pane.clientTop, desired=pane.scrollTop+(a.top+a.bottom)/2-(top+pane.clientHeight/2), reachable=Math.max(0,Math.min(pane.scrollHeight-pane.clientHeight,desired)); return Math.abs(pane.scrollTop-reachable)<8 && a.top>=top-1 && a.bottom<=top+pane.clientHeight+1 })()')
  const userMessagesBeforeFailure = await evaluate('document.querySelectorAll(".message.user").length')
  await evaluate('document.querySelector(".composer-editor").focus()')
  await send('Input.insertText', { text: '첨부 이미지 입력 전달 검사' })
  await evaluate('document.querySelector("button[aria-label=보내기]").click()')
  await wait('document.body.innerText.includes("Offline UI test prevents paid calls")')
  const dispatched = JSON.parse((await fs.readFile(path.join(root, 'unexpected-chat-call.txt'), 'utf8')).trim())
  assert.deepEqual(dispatched.figures.map(item => [item.paperId, item.anchorId]), [[paper.arxivId, savedFigure.replace(/\.png$/, '')]])
  assert.equal(await evaluate('document.querySelectorAll(".message.user").length'), userMessagesBeforeFailure, 'Rejected dispatch must restore the draft without adding a duplicate conversation turn')
  assert(await evaluate('document.querySelector(".composer-editor").textContent.includes("첨부 이미지 입력 전달 검사")'))
  assert(await evaluate('Boolean(document.querySelector(".figure-attachment"))'), 'Rejected dispatch must restore the attached figure')
  await evaluate('document.querySelector(".composer-anchor-remove").click()')
  await evaluate('document.querySelector(".reading-focus").click()')
  assert.equal(await evaluate('document.querySelector(".document-mode > button:nth-child(3)").textContent'), '비교로 복귀', 'Opening source evidence must preserve the temporary reading return action')
  await evaluate('document.querySelector(".document-mode > button:nth-child(3)").click()')
  await wait('document.querySelectorAll(".pane-body[data-shown=true]").length === 2')
  await evaluate('document.querySelector(".page-jump input").focus()')
  await send('Input.insertText', { text: '3' })
  await evaluate('document.querySelector(".page-jump").requestSubmit()')
  await wait('document.querySelector(".page-jump input").value === "3"')
  for (const format of ['flow', 'paper']) {
    await evaluate(`(() => { const select = document.querySelector('.translation-format'); select.value = '${format}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await wait('Boolean(document.querySelector("[data-page=translated-3].rendered"))')
    await sleep(850)
    assert.equal(await evaluate('document.querySelector(".page-jump input").value'), '3')
    assert(await evaluate('document.querySelector("[data-page=translated-3] canvas").width >= 1000'), 'A format change must render the replacement source canvas, not leave a blank 300px canvas')
    if (format === 'paper') assert(await evaluate('(() => { const page = document.querySelector("[data-page=translated-3]"); return page.scrollWidth <= page.clientWidth + 2 })()'), 'Restored paper layout must fit its visible width')
    const position = await evaluate('(() => { const element=document.querySelector("[data-page=translated-3]"), page=element.getBoundingClientRect(), pane=element.closest(".document-scroll").getBoundingClientRect(), marker=pane.top+pane.height*.28; return {valid:page.top<=marker && page.bottom>=marker,top:page.top,bottom:page.bottom,marker,scroll:element.closest(".document-scroll").scrollTop,heights:[...element.parentElement.children].map(item=>item.getBoundingClientRect().height)}; })()')
    assert(position.valid, `${format} must preserve the visible page when document heights change: ${JSON.stringify(position)}`)
  }
  // Width changes from opening/closing chat must not let intermediate reflow scroll events
  // replace the reading position (the native p11 regression moved back a page on close).
  const initialFocusState = await evaluate('document.querySelector(".reading-focus").getAttribute("aria-expanded")')
  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (let toggle = 0; toggle < 2; toggle += 1) {
      const previousFocusState = await evaluate('document.querySelector(".reading-focus").getAttribute("aria-expanded")')
      const chatTogglePoint = await evaluate('(() => { const rect = document.querySelector(".reading-focus").getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()')
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...chatTogglePoint, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...chatTogglePoint, button: 'left', clickCount: 1 })
      await wait(`document.querySelector('.reading-focus').getAttribute('aria-pressed') !== ${JSON.stringify(previousFocusState)}`)
      await sleep(1000)
      assert.equal(await evaluate('document.querySelector(".page-jump input").value'), '3', `Chat toggle ${cycle + 1}.${toggle + 1} must retain page 3 after width reflow settles`)
      const pagePositions = await evaluate(`(() => {
        return [...document.querySelectorAll('[data-page="original-3"], [data-page="translated-3"]')].map(page => {
          const pane = page.closest('.document-scroll'); const bounds = pane?.getBoundingClientRect(); const rect = page.getBoundingClientRect();
          if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !page.getClientRects().length) return null;
          const marker = bounds.top + bounds.height * .28;
          return { page: page.dataset.page, top: rect.top, bottom: rect.bottom, marker, visible: rect.top <= marker && rect.bottom >= marker };
        }).filter(Boolean);
      })()`)
      assert(pagePositions.length > 0 && pagePositions.every(page => page.visible), `Chat toggle must preserve actual page 3 in each visible pane, not just its counter: ${JSON.stringify(pagePositions)}`)
    }
  }
  assert.equal(await evaluate('document.querySelector(".reading-focus").getAttribute("aria-expanded")'), initialFocusState)
  await evaluate(`document.querySelector('[aria-label="설정"]').click()`)
  await evaluate(`(() => { const select = document.querySelector('[aria-label="화면 테마"]'); select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await evaluate(`document.querySelector('[aria-label="설정 닫기"]').click()`)
  assert.equal(await evaluate('document.documentElement.style.colorScheme'), 'dark')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".continuous-page")).colorScheme'), 'light')
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".titlebar")).backgroundColor'), 'rgba(0, 0, 0, 0)')
  await sleep(200)
  assert(await evaluate('document.querySelector(".reading-translation").textContent.includes("세포는")'))
  await shot('product-pdf-dark')
  await evaluate('document.querySelector(".document-mode > button:nth-child(2)").click()')
  await wait('document.querySelectorAll(".pane-body[data-shown=true]").length === 1')
  await evaluate('document.querySelector(".reading-focus").click()')
  await evaluate(`window.prism.openEvidenceAnchor(${JSON.stringify({ paperId: paper.arxivId, anchorId: citedSource.id, type: 'sentence', page: 1, label: '근거1' })})`)
  // Original canvases remain mounted while hidden. A cached render alone does
  // not mean the evidence event has opened the pane or highlighted its anchor.
  await wait(`Boolean(document.querySelector('[data-pane=original][data-shown=true] [data-page=original-1].rendered [data-anchor="${citedSource.id}"].highlighted'))`)
  assert(await evaluate('document.querySelector("[data-page=original-1]").closest(".document-scroll").clientWidth > 500'), 'A source link from Korean-only mode must open a readable original pane even with chat open')
  await evaluate('window.prism.choosePaperStorage()')
  const second = path.join(root, 'Engineering.pdf'); await fs.writeFile(second, fixturePdf(content.replace('Cell biology: a reading fixture', 'Engineering: a reading fixture'))); await fs.writeFile(path.join(root, 'selection.txt'), second)
  const external = await evaluate('window.prism.importLocalPaper()')
  assert(external.pdfPath.startsWith(path.join(root, 'external-papers')))
  assert(external.notePath.startsWith(vault)); assert.equal(external.externalAssets, true)
  const records = await evaluate('window.prism.listLibrary()')
  assert.equal(records.length, 2); assert.equal(records.find(item => item.arxivId === paper.arxivId).pdfPath, paper.pdfPath)
  assert.equal(records.find(item => item.arxivId === external.arxivId).pdfPath, external.pdfPath)
  const note = await fs.readFile(external.notePath, 'utf8'); assert(note.includes('file:///')); assert(!note.includes('tags: [paper, arxiv]'))
  // Two genuinely different PDFs deliberately share the cited sentence/anchor
  // ID. The first evidence event after a paper switch must bind to the new PDF,
  // survive cached-translation loading, and open its actual original pane.
  // Direct IPC import bypasses the import dialog's renderer library refresh.
  await reload()
  await wait(`Boolean([...document.querySelectorAll('.paper-tree button')].find(button => button.querySelector('strong')?.textContent === 'Engineering'))`)
  await evaluate(`([...document.querySelectorAll('.paper-tree button')].find(button => button.querySelector('strong')?.textContent === 'Engineering')).click()`)
  let externalAnchors
  for (let attempt = 0; attempt < 100 && !externalAnchors; attempt++) { try { externalAnchors = JSON.parse(await fs.readFile(path.join(path.dirname(external.pdfPath), 'anchors.json'), 'utf8')) } catch { await sleep(100) } }
  assert(externalAnchors, 'Second PDF must finish real extraction')
  const externalCited = externalAnchors.anchors.find(anchor => anchor.source === citedSource.source)
  assert.equal(externalCited.id, citedSource.id, 'Fixture exercises a cross-paper anchor ID collision')
  const engineeringTitle = externalAnchors.anchors.find(anchor => anchor.source.includes('Engineering:'))
  const biologyTitle = anchorData.anchors.find(anchor => anchor.source.includes('Cell biology:'))
  assert(engineeringTitle && biologyTitle && engineeringTitle.id !== biologyTitle.id)
  await fs.writeFile(external.translationPath, JSON.stringify({ segments: externalAnchors.anchors.map(anchor => ({ ...anchor, kind: anchor.type, translation: translations.get(anchor.source) })) }))
  for (const [targetPaper, targetTitle, previousPaper, previousTitle] of [[paper, biologyTitle, external, engineeringTitle], [external, engineeringTitle, paper, biologyTitle]]) {
    await evaluate('document.querySelector(".document-mode > button:nth-child(2)").click()')
    await wait('document.querySelector("[data-pane=translated]")?.dataset.shown === "true" && document.querySelector("[data-pane=original]")?.dataset.shown === "false"')
    await evaluate(`window.prism.openEvidenceAnchor(${JSON.stringify({ paperId: targetPaper.arxivId, anchorId: citedSource.id, type: 'sentence', page: 1, label: 'Cross-paper evidence' })})`)
    await wait(`Boolean(document.querySelector('[data-pane=original][data-shown=true] [data-page=original-1].rendered [data-anchor="${targetTitle.id}"]'))`)
    await wait(`Boolean(document.querySelector('[data-pane=original][data-shown=true] [data-page=original-1] [data-anchor="${citedSource.id}"].highlighted'))`)
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-pane=original] [data-anchor="${previousTitle.id}"]'))`), false, `${targetPaper.title} must not retain ${previousPaper.title}'s PDF anchors`)
    // Cache restoration is asynchronous. It must not subsequently hide the
    // explicit source navigation once the initial highlight has appeared.
    await sleep(850)
    assert(await evaluate(`Boolean(document.querySelector('[data-pane=original][data-shown=true] [data-page=original-1] [data-anchor="${citedSource.id}"].highlighted'))`), 'Cached translation must not overwrite explicit cross-paper evidence navigation')
    assert(await evaluate(`(() => { const anchor=document.querySelector('[data-pane=original][data-shown=true] [data-page=original-1] [data-anchor="${citedSource.id}"].highlighted'); const a=anchor.getBoundingClientRect(), p=anchor.closest('.document-scroll').getBoundingClientRect(); return a.width>0 && a.height>0 && a.top>=p.top && a.bottom<=p.bottom && a.left>=p.left && a.right<=p.right; })()`), 'Cross-paper evidence must be visibly located in the original pane, not only marked in a hidden/offscreen page')
  }
  const oldStorage = path.join(root, 'external-papers'), movedStorage = path.join(root, 'moved-papers')
  assert.equal(path.dirname(path.resolve(oldStorage)), path.resolve(root))
  assert.equal(path.dirname(path.resolve(movedStorage)), path.resolve(root))
  await fs.rename(oldStorage, movedStorage)
  assert(await evaluate(`window.prism.readPaperPdf(${JSON.stringify(external.arxivId)}).then(() => false, error => error.message.includes('다시 연결'))`))
  await fs.writeFile(path.join(root, 'directory-selection.txt'), movedStorage)
  await send('Page.reload')
  await wait('document.querySelector(".reader-empty[role=alert]")?.textContent.includes("논문을 열지 못했습니다")')
  assert(await evaluate('!document.querySelector(".reader-empty").textContent.includes("불러오는 중")'), 'Missing PDF must not remain in an indefinite loading state')
  await evaluate('[...document.querySelectorAll(".reader-empty button")].find(button => button.textContent.includes("이동한 폴더")).click()')
  await wait('Boolean(document.querySelector("[data-page=original-1].rendered"))')
  const recovered = (await evaluate('window.prism.listLibrary()')).find(item => item.arxivId === external.arxivId)
  assert.equal(recovered.pdfPath, path.join(movedStorage, external.arxivId, 'original.pdf'))
  assert.equal(recovered.notePath, external.notePath)
  assert.equal((await evaluate('window.prism.getSettings()')).paperStoragePath, movedStorage)
  assert(await evaluate(`window.prism.readPaperPdf(${JSON.stringify(external.arxivId)}).then(data => data.length > 100)`))
  const repairedNote = await fs.readFile(external.notePath, 'utf8')
  assert(repairedNote.includes('moved-papers'))
  assert.equal(repairedNote.replace(/^pdf:.*$/m, ''), note.replace(/^pdf:.*$/m, ''), 'Recovery may update the PDF property but must preserve authored note content')
  await fs.unlink(path.join(root, 'directory-selection.txt'))
  const bad = path.join(root, 'invalid.pdf'); await fs.writeFile(bad, 'not PDF'); await fs.writeFile(path.join(root, 'selection.txt'), bad)
  assert(await evaluate('window.prism.importLocalPaper().then(() => false, () => true)'))
  assert.equal((await evaluate('window.prism.listLibrary()')).length, 2)
  const node = (await evaluate('window.prism.listKnowledgeNodes()')).find(node => node.title === 'Cell biology')
  assert(node)
  const snapshot = await evaluate(`window.prism.readKnowledgeNode(${JSON.stringify(node.id)})`)
  assert(snapshot.vaultId)
  await evaluate('window.prism.chooseWorkspace()')
  const saved = await evaluate(`window.prism.saveKnowledgeNode(${JSON.stringify(node.id)}, ${JSON.stringify({ content: snapshot.content + '\nSaved after vault switch.\n', expectedRevision: snapshot.revision, vaultId: snapshot.vaultId })})`)
  assert(saved.saved)
  assert((await fs.readFile(paper.notePath, 'utf8')).includes('Saved after vault switch.'))
  assert.equal((await evaluate('window.prism.listLibrary()')).length, 0)
  assert.deepEqual(exceptions, [])
  console.log('Product UI passed: first launch, real PDF import/rendering, deduplication, reflow, theme and print colors, separate storage, existing-path preservation, and invalid file rejection.')
} catch (error) {
  await captureFailure().catch(() => {})
  throw error
} finally {
  socket?.close(); processHandle.kill()
  if (processHandle.exitCode === null) await new Promise(resolve => processHandle.once('exit', resolve))
  if (path.basename(root).startsWith('prism-product-ui-') && path.dirname(root) === await fs.realpath(os.tmpdir())) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
