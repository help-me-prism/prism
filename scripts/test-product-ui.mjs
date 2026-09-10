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
const content = 'BT /F1 18 Tf 48 740 Td (Cell biology: a reading fixture) Tj ET\nBT /F1 11 Tf 48 700 Td (Cells respond to changes in their environment.) Tj 0 -18 Td (This experiment compares two populations [1].) Tj 270 18 Td (The control group received no treatment.) Tj 0 -18 Td (Results should not imply causation.) Tj ET\nBT /F1 12 Tf 48 620 Td (x = y + 2) Tj ET\n48 500 200 80 re S\nBT /F1 10 Tf 56 555 Td (Group       N       Response) Tj 0 -20 Td (Control     12      0.25) Tj 0 -20 Td (Treatment   12      0.75) Tj ET\nBT /F1 10 Tf 48 480 Td (Table 1. Observations from the experiment.) Tj ET\n320 530 50 50 re S 420 530 50 50 re S 370 555 m 420 555 l S\nBT /F1 10 Tf 320 500 Td (Figure 1. A vector diagram.) Tj ET\nBT /F1 8 Tf 48 460 Td (https://doi.org/10.1371/journal.pone.0287690.t001) Tj ET'
function fixturePdf(content) {
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] /Count 3 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
objects.push(objects[2], objects[2], '<< /Title (Cell biology and controlled experiments) >>')
const secondContent = content.replace('Cells respond to changes in their environment.', 'Genomes vary between the sampled species.').replace('This experiment compares two populations [1].', 'Assembly quality depends on sequencing coverage [1].').replace('The control group received no treatment.', 'The specimens were collected at two sites.').replace('Results should not imply causation.', 'The sample size limits generalization.')
objects[5] = objects[5].replace('/Contents 5 0 R', '/Contents 9 0 R')
objects.push(`<< /Length ${Buffer.byteLength(secondContent)} >>\nstream\n${secondContent}\nendstream`)
let pdf = '%PDF-1.4\n'; const offsets = [0]
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF`
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
  const userObservation = '\nA personal observation that must survive title editing.\n'
  await fs.appendFile(paper.notePath, userObservation)
  const metadataBeforeTitle = JSON.parse(await fs.readFile(path.join(path.dirname(paper.pdfPath), 'metadata.json'), 'utf8'))
  const openTitleDialog = async () => {
    await evaluate('document.querySelector(".reader-more summary").click()')
    await evaluate('[...document.querySelectorAll(".reader-more button")].find(button => button.textContent.includes("논문 제목 편집")).click()')
    await wait('Boolean(document.querySelector(".paper-title-dialog"))')
  }
  await openTitleDialog()
  await evaluate('document.querySelector(".pdf-title-suggestion").click()')
  await wait('document.querySelector("#paper-title-input").value === "Cell biology and controlled experiments"')
  await evaluate('document.querySelector(".paper-title-dialog footer button[type=button]").click()')
  assert.equal((await evaluate('window.prism.listLibrary()'))[0].title, paper.title, 'Cancel must not write suggested PDF metadata')
  await openTitleDialog()
  await evaluate('document.querySelector(".pdf-title-suggestion").click()')
  await wait('document.querySelector("#paper-title-input").value === "Cell biology and controlled experiments"')
  await evaluate('document.querySelector(".paper-title-dialog button[type=submit]").click()')
  await wait('!document.querySelector(".paper-title-dialog")')
  const renamedPaper = (await evaluate('window.prism.listLibrary()'))[0]
  assert.equal(renamedPaper.title, 'Cell biology and controlled experiments')
  for (const key of ['arxivId','pdfPath','notePath','translationPath','pdfSha256']) assert.equal(renamedPaper[key], paper[key], `Title edit cannot change ${key}`)
  const noteAfterTitle = await fs.readFile(paper.notePath, 'utf8')
  assert(noteAfterTitle.includes(userObservation))
  assert(noteAfterTitle.includes('aliases: ["Cell biology"]'), 'Old title remains resolvable as a wiki alias')
  assert(noteAfterTitle.includes('# Cell biology and controlled experiments'))
  const metadataAfterTitle = JSON.parse(await fs.readFile(path.join(path.dirname(paper.pdfPath), 'metadata.json'), 'utf8'))
  assert.deepEqual(metadataAfterTitle, { ...metadataBeforeTitle, title: renamedPaper.title })
  assert(await evaluate(`window.prism.updatePaperTitle(${JSON.stringify({paperId:paper.arxivId,title:'Stale overwrite',expectedTitle:paper.title,libraryPath:vault})}).then(()=>false,()=>true)`), 'Stale title editors cannot overwrite a newer title')
  const metadataFile = path.join(path.dirname(paper.pdfPath), 'metadata.json')
  await fs.rename(metadataFile, metadataFile + '.held')
  try {
    const partial = await evaluate(`window.prism.updatePaperTitle(${JSON.stringify({paperId:paper.arxivId,title:renamedPaper.title,expectedTitle:renamedPaper.title,libraryPath:vault})})`)
    assert.equal(partial.paper.title, renamedPaper.title)
    assert(partial.warnings.some(warning => warning.includes('metadata.json')), 'Secondary write failures must be visible rather than reported as full success')
  } finally { await fs.rename(metadataFile + '.held', metadataFile) }
  assert(await evaluate(`window.prism.updatePaperTitle(${JSON.stringify({paperId:paper.arxivId,title:'Wrong vault',expectedTitle:renamedPaper.title,libraryPath:path.join(root,'wrong-vault')})}).then(()=>false,()=>true)`), 'An editor from another vault cannot rename the active paper')
  paper.title = renamedPaper.title
  await wait('document.querySelector(".paper-tab-title").textContent.includes("Cell biology and controlled experiments")')
  await reload(); await wait('Boolean(document.querySelector(".continuous-page.rendered"))')
  assert.equal((await evaluate('window.prism.listLibrary()'))[0].title, paper.title, 'Title survives reopening the application')
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
  const preservedCache = anchorData.anchors.filter(anchor => ['equation', 'table', 'artifact'].includes(anchor.type)).map(anchor => ({ ...anchor, kind: anchor.type, translation: anchor.source }))
  assert(preservedCache.length > 0, 'The fixture must include protected source content for the identity-cache regression')
  await fs.writeFile(paper.translationPath, JSON.stringify({ segments: [{ ...citedSource, kind: citedSource.type, translation: '인용 표시가 누락된 잘못된 번역' }, ...preservedCache] }))
  assert.equal((await evaluate(`window.prism.readTranslation(${JSON.stringify(paper.arxivId)})`)).segments[0].translation, undefined)
  await evaluate('document.querySelector(".document-mode button:nth-child(2)").click()')
  await wait('Boolean(document.querySelector(".paper-layout-page.rendered .untouched-paper > canvas"))')
  // Width fitting may start a replacement render between separate observations.
  // Check ready state and complete pixel identity atomically on the same page.
  await wait('(() => { const page = document.querySelector(".paper-layout-page.rendered"), copy=page?.querySelector(".untouched-paper > canvas"); return !!copy && page.querySelector(":scope > canvas").toDataURL() === copy.toDataURL(); })()')
  const captionSource = anchorData.anchors.find(anchor => anchor.source.startsWith('Figure 1.'))
  assert(captionSource)
  await fs.writeFile(paper.translationPath, JSON.stringify({ segments: [...preservedCache, { ...captionSource, kind: captionSource.type, translation: 'Figure 1. 벡터 도식.' }] }))
  await reload()
  await wait(`Boolean(document.querySelector('.paper-layout-page.rendered .paper-layout-block.caption span[data-anchor="${captionSource.id}"]'))`)
  assert(await evaluate(`document.querySelector('.paper-layout-page.rendered .paper-layout-block.caption span[data-anchor="${captionSource.id}"]').textContent.includes('벡터 도식')`), 'A real caption translation must remain visible even if the body is untranslated')
  const translations = new Map([
    ['Cells respond to changes in their environment.', '세포는 주변 환경의 변화에 반응한다. 번역문이 원문보다 길어져도 수식이나 표를 덮지 않고 자연스럽게 다음 줄로 이어져야 한다.'],
    ['This experiment compares two populations [1].', '이 실험은 두 집단을 비교한다 [1].'],
    ['The control group received no treatment.', '대조군에는 처치를 시행하지 않았다.'],
    ['Results should not imply causation.', '결과를 인과 관계로 해석해서는 안 된다.'],
  ])
  // A cache on one page must not label an untouched neighboring page as saved Korean.
  await fs.writeFile(paper.translationPath, JSON.stringify({ version: 1, provider: 'fixture', model: 'offline-render-test', segments: anchorData.anchors.map(anchor => ({ ...anchor, kind: anchor.type, translation: anchor.page === 1 ? translations.get(anchor.source) : undefined })) }))
  await reload(); await wait('!document.querySelector(".paper-analysis-status") && Boolean(document.querySelector(".paper-layout-page.rendered .paper-layout-block.text span"))')
  assert(/^\d+\/\d+문장 번역/.test(await evaluate('document.querySelector(".pane-note").textContent')), 'The partly translated first page should report its actual count')
  await evaluate('document.querySelector(".page-jump input").focus()')
  await send('Input.insertText', { text: '2' })
  await evaluate('document.querySelector(".page-jump").requestSubmit()')
  await wait('document.querySelector(".page-jump input").value === "2" && document.querySelector(".pane-note").textContent.includes("미번역 · 원문 표시")')
  assert(!(await evaluate('document.querySelector(".pane-note").textContent')).includes('저장됨'), 'A different page cache must not imply this page is translated')
  await evaluate('document.querySelector(".page-jump input").focus()')
  await send('Input.insertText', { text: '1' })
  await evaluate('document.querySelector(".page-jump").requestSubmit()')
  await wait('document.querySelector(".page-jump input").value === "1"')
  await fs.writeFile(paper.translationPath, JSON.stringify({ version: 1, provider: 'fixture', model: 'offline-render-test', segments: anchorData.anchors.map(anchor => ({ ...anchor, kind: anchor.type, translation: translations.get(anchor.source) })) }))
  await reload(); await wait('Boolean(document.querySelector(".document-mode"))')
  await wait('!document.querySelector(".paper-analysis-status") && Boolean(document.querySelector(".paper-layout-page.rendered .paper-layout-block.text span"))')
  await evaluate('document.fonts.ready')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".paper-layout-block.text span[data-anchor]")).fontWeight'), '400', 'Confirmed regular PDF prose must not inherit the heavier paper theme weight')
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

  // The first comparison in a laptop-sized viewport must keep readable width.
  await evaluate('document.querySelector(".document-mode > button:nth-child(3)").click()')
  await settledPane('original', 'col')
  await evaluate(`document.querySelector('.comparison-options > summary').click()`)
  await evaluate(`document.querySelector('.comparison-options .reader-toolbar-popover button:nth-child(1)').click()`)
  await settledPane('original', 'row')
  assert.equal(await evaluate('document.querySelector(".document-mode > button:nth-child(3)").textContent'), '좌우 비교', 'An explicit narrow side-by-side choice must dismiss the suggestion for this paper session')
  const savedSideBySide = await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`)
  await reload()
  await settledPane('original', 'row')
  await wait('document.querySelector(".document-mode > button:nth-child(3)").textContent === "상하로 넓게"')
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`), savedSideBySide, 'Offering a wider comparison must not change the saved arrangement')
  const comparisonZooms = await evaluate('[...document.querySelectorAll(".zoom-control select")].map(select => select.value)')
  await evaluate('document.querySelector(".document-mode > button:nth-child(3)").click()')
  await settledPane('original', 'col')
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".zoom-control select")].map(select => select.value)'), comparisonZooms, 'Changing comparison direction must preserve zoom choices')
  assert.equal(await evaluate('document.querySelector(".page-jump input").value'), '1')
  assert.notEqual(await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`), savedSideBySide, 'The accepted direction change should persist')

  // A wide-screen explicit choice remains in place when chat narrows the area;
  // the contextual action is offered without moving content or losing a draft.
  await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 900, deviceScaleFactor: 1, mobile: false })
  await evaluate(`document.querySelector('.comparison-options > summary').click()`)
  await evaluate(`document.querySelector('.comparison-options .reader-toolbar-popover button:nth-child(1)').click()`)
  await settledPane('original', 'row')
  await evaluate('if(document.querySelector(".chat-pane").hidden) document.querySelector(".reading-focus").click()')
  await wait('!document.querySelector(".chat-pane").hidden')
  await evaluate('document.querySelector(".composer-editor").focus()')
  await send('Input.insertText', { text: '이 문단과 표의 차이를 비교하고 싶습니다.' })
  const widthDraft = await evaluate('document.querySelector(".composer-editor").innerHTML')
  await wait('document.querySelector(".document-mode > button:nth-child(3)").textContent === "상하로 넓게"')
  await settledPane('original', 'row')
  await evaluate('document.querySelector(".document-mode > button:nth-child(3)").click()')
  await settledPane('original', 'col')
  assert.equal(await evaluate('document.querySelector(".composer-editor").innerHTML'), widthDraft, 'Accepting a wider comparison must preserve the question draft')
  await evaluate('document.querySelector(".reading-focus").click()')
  await send('Emulation.clearDeviceMetricsOverride')
  await settledPane('original', 'col')

  // Equal physical PDF content must not get different stroke weights merely
  // because one raster is used for the original and the other for crops.
  await evaluate(`document.querySelector('.comparison-options > summary').click()`)
  await evaluate(`document.querySelector('.comparison-options .reader-toolbar-popover button:nth-child(1)').click()`)
  await settledPane('original', 'row')
  await evaluate(`document.querySelectorAll('.zoom-control select').forEach(select => { select.value='0.7'; select.dispatchEvent(new Event('change',{bubbles:true})); })`)
  await wait(`['original','translated'].every(kind => Number(document.querySelector('[data-page='+kind+'-1].rendered')?.dataset.renderScale) === .7)`)
  assert(await evaluate(`(() => { const a=document.querySelector('[data-page=original-1] > canvas'),b=document.querySelector('[data-page=translated-1] > canvas'); return a.width===b.width && a.height===b.height && a.toDataURL()===b.toDataURL(); })()`), 'Both reader panes must rasterize identical PDF pixels at equal zoom')
  await evaluate(`document.querySelectorAll('.zoom-control select').forEach(select => { select.value='fit'; select.dispatchEvent(new Event('change',{bubbles:true})); })`)

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
  // Preserve the measured pre-chat fit scale, including non-round percentages.
  const sizeAnchor = anchorData.anchors.find(anchor => anchor.source === 'The control group received no treatment.')
  assert(sizeAnchor)
  const stableRenderScale = async kind => {
    let last; let stable = 0
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await evaluate(`Number(document.querySelector('[data-pane=${kind}][data-shown=true] [data-page=${kind}-1].rendered')?.dataset.renderScale)`)
      stable = value > 0 && value === last ? stable + 1 : 0
      if (stable >= 4) return value
      last = value; await sleep(60)
    }
    throw new Error(`Render scale did not settle for ${kind}`)
  }
  const anchorsBeforeSizeOffer = await evaluate('[...document.querySelectorAll(".composer-anchor")].map(node=>node.dataset.placementId)')
  for (const kind of ['original', 'translated']) {
    if (await evaluate('document.querySelector(".reading-focus").getAttribute("aria-expanded") === "true"')) await evaluate('document.querySelector(".reading-focus").click()')
    await wait('document.querySelector(".reading-focus").getAttribute("aria-expanded") === "false"')
    await evaluate('document.querySelector(".comparison-options > summary").click(); document.querySelector(".comparison-options .reader-toolbar-popover button:nth-child(2)").click()')
    await settledPane(kind, 'col')
    const zoomLabel = kind === 'original' ? '원문 배율' : '번역 배율'
    await evaluate(`(() => { const select=document.querySelector('select[aria-label="${zoomLabel}"]'); select.value='fit'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
    const beforeScale = await stableRenderScale(kind)
    const beforePaintWidth = await evaluate(`document.querySelector('[data-pane=${kind}][data-shown=true] [data-page=${kind}-1].rendered > canvas').getBoundingClientRect().width`)
    assert(Math.abs(beforeScale - 1) > .02, 'Fixture must distinguish measured fit scale from a hardcoded 100%')
    const layoutBeforeOffer = await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`)
    const zoomsBeforeOffer = await evaluate('[...document.querySelectorAll(".zoom-control select")].map(select=>({label:select.getAttribute("aria-label"),value:select.value}))')
    await evaluate(`document.querySelector('[data-pane=${kind}][data-shown=true] [data-page=${kind}-1] [data-anchor="${sizeAnchor.id}"]').click()`)
    await wait('Boolean(document.querySelector(".composer-editor") && document.querySelector(".reading-size-offer button"))')
    await evaluate('document.querySelector(".reading-size-offer button").click()')
    await settledPane(kind, 'single')
    await wait(`Math.abs(Number(document.querySelector('[data-pane=${kind}][data-shown=true] [data-page=${kind}-1].rendered')?.dataset.renderScale)-${beforeScale})<.001`)
    assert(Math.abs(await stableRenderScale(kind) - beforeScale) < .001, 'The offer must restore the exact measured scale rather than a rounded dropdown percentage')
    assert(Math.abs(Number(await evaluate(`document.querySelector('select[aria-label="${zoomLabel}"]').value`)) - beforeScale) < .001, 'The restored scale must also have an exact numeric selection rather than an empty or rounded option')
    const afterPaintWidth = await evaluate(`document.querySelector('[data-pane=${kind}][data-shown=true] [data-page=${kind}-1].rendered > canvas').getBoundingClientRect().width`)
    assert(Math.abs(afterPaintWidth - beforePaintWidth) <= 1, `Actual painted PDF width must preserve pre-chat size: ${kind} ${beforePaintWidth}→${afterPaintWidth}`)
    await wait(`(() => { const anchor=document.querySelector('[data-pane=${kind}][data-shown=true] [data-page=${kind}-1] [data-anchor="${sizeAnchor.id}"]'); if(!anchor)return false; const a=anchor.getBoundingClientRect(),pane=anchor.closest('.document-scroll'),p=pane.getBoundingClientRect(); return pane.scrollWidth>pane.clientWidth+10 && a.width>0 && a.top>=p.top-2 && a.bottom<=p.top+pane.clientHeight+2 && a.left>=p.left-2 && a.right<=p.left+pane.clientWidth+2; })()`)
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`), layoutBeforeOffer, 'The reading-size offer must not persist its temporary layout')
    await evaluate('document.querySelector(".document-mode > button:nth-child(3)").click()')
    await settledPane(kind, 'col')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".zoom-control select")].map(select=>({label:select.getAttribute("aria-label"),value:select.value}))'), zoomsBeforeOffer, 'Return must restore both original fit/numeric zoom states')
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(`prism.reader.layout.${paper.arxivId}`)})`), layoutBeforeOffer)
  }
  await evaluate(`document.querySelectorAll('.composer-anchor').forEach(node=>{if(!${JSON.stringify(anchorsBeforeSizeOffer)}.includes(node.dataset.placementId)) node.querySelector('.composer-anchor-remove').click()})`)
  if (await evaluate('document.querySelector(".reading-focus").getAttribute("aria-expanded") === "true"')) await evaluate('document.querySelector(".reading-focus").click()')
  await wait('document.querySelector(".reading-focus").getAttribute("aria-expanded") === "false"')
  await evaluate('document.querySelector(".document-mode button:nth-child(2)").click()')
  await wait('Boolean(document.querySelector(".reading-translation .reading-block"))')
  assert.equal(await evaluate('Boolean(document.querySelector(".translated-text-layer"))'), false)
  assert(await evaluate('document.querySelector(".reading-translation").textContent.includes("세포는")'))
  await wait('document.querySelectorAll(".reading-translation figure canvas").length >= 2')
  assert(await evaluate('[...document.querySelectorAll(".reading-translation figure canvas")].every(canvas => canvas.width > 10 && canvas.height > 10)'))
  assert.equal(await evaluate('Boolean(document.querySelector(".paper-layout-page > .flow-page-heading, .paper-layout-page > .flow-original"))'), false)
  assert(await evaluate('[...document.querySelectorAll(".paper-layout-page.rendered > canvas")].every(canvas => canvas.width >= 1000)'))
  await wait('document.querySelectorAll(".paper-layout-block.publication-link canvas").length >= 1')
  assert(await evaluate('[...document.querySelectorAll(".paper-layout-block.publication-link canvas")].every(canvas => canvas.width > 10 && canvas.height > 2 && canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data.some((value,index,pixels) => index % 4 === 0 && pixels[index + 3] > 0 && value < 200))'), 'Excluded DOI print lines must retain their source pixels')
  await shot('product-translation-paper')
  const setTranslationZoom = async value => {
    await evaluate(`(() => { const select=document.querySelector('select[aria-label="번역 배율"]'); select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
    await wait(`Boolean(document.querySelector('.paper-layout-page.rendered[data-render-scale="${value}"] .paper-layout-block.text'))`)
    await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
  }
  const translatedMetrics = async () => {
    let previous; let stable = 0
    for (let attempt=0; attempt<60; attempt++) {
      const metrics = await evaluate('(() => { const page=document.querySelector(".paper-layout-page.rendered"), text=page?.querySelector(".paper-layout-block.text:has(span[data-anchor])"), figure=page?.querySelector("figure canvas"); return text && figure ? {width:page.getBoundingClientRect().width,font:parseFloat(getComputedStyle(text).fontSize),lineHeight:parseFloat(getComputedStyle(text).lineHeight),textHeight:text.getBoundingClientRect().height,figureWidth:figure.getBoundingClientRect().width} : null; })()')
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
  for (const metric of ['width','font','lineHeight','figureWidth']) assert(Math.abs(at150[metric]/at100[metric]-1.5)<.02, `Paper zoom must scale ${metric} together: ${JSON.stringify({at100,at150})}`)
  assert(Math.abs(at150.textHeight/at100.textHeight-1.5)<.08,`Paper zoom must preserve paragraph composition, not enlarge text inside a fixed page: ${JSON.stringify({at100,at150})}`)
  await evaluate('(() => { const select=document.querySelector(\'select[aria-label="번역 배율"]\'); select.value="fit"; select.dispatchEvent(new Event("change",{bubbles:true})); })()')
  await wait('(() => { const page=document.querySelector(".paper-layout-page.rendered"); if(!page) return false; const pane=page.closest(".document-scroll"); return page.getBoundingClientRect().width <= pane.clientWidth && page.scrollWidth <= page.clientWidth+2; })()')
  await evaluate('if(document.querySelector(".chat-pane").hidden) document.querySelector(".reading-focus").click()')
  await wait('!document.querySelector(".chat-pane").hidden')
  await evaluate('(() => { const editor=document.querySelector(".composer-editor"); editor.focus(); const range=document.createRange(); range.selectNodeContents(editor); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); })()')
  const questionPrefix = '첫 문단.\n\n\n둘째 문단: 여기 '
  await send('Input.insertText', { text: questionPrefix + '뒤에 근거를 넣습니다.\n셋째 문단.' })
  await evaluate('(() => { const editor=document.querySelector(".composer-editor"), walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT); let node; while(node=walker.nextNode()) { const at=node.textContent.replaceAll(String.fromCharCode(160)," ").indexOf("둘째 문단: 여기 "); if(at<0) continue; const range=document.createRange(); range.setStart(node,at+"둘째 문단: 여기 ".length); range.collapse(true); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); editor.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true,key:"ArrowRight"})); return; } throw new Error("Middle paragraph was lost: " + editor.innerHTML); })()')
  await wait(`Boolean(document.querySelector('.reading-translation figure button[title="피겨를 질문에 추가"]'))`)
  await evaluate(`document.querySelector('.reading-translation figure button[title="피겨를 질문에 추가"]').click()`)
  await wait('Boolean(document.querySelector(".composer-anchor .type-figure"))')
  assert.equal(await evaluate('document.querySelector(".composer-editor").firstChild.textContent'), questionPrefix, 'A new figure anchor must stay at the middle-paragraph caret, including every blank line')
  const composerEvidence = await evaluate('(() => { const chip=document.querySelector(".composer-anchor-label"), editor=document.querySelector(".composer-editor"); return {location:chip.querySelector(".composer-anchor-location")?.textContent,excerpt:chip.querySelector(".composer-anchor-excerpt")?.textContent,text:chip.textContent,width:chip.getBoundingClientRect().width,available:editor.clientWidth}; })()')
  assert.match(composerEvidence.location, /1쪽 · 피겨/)
  assert(composerEvidence.excerpt?.trim(), 'The selected source must be visible without hovering')
  assert(!composerEvidence.text.includes('local-'), 'Internal PDF IDs must not be the visible attachment description')
  assert(composerEvidence.width <= composerEvidence.available + 2, 'Evidence must fit inside the question composer')
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
  await evaluate('(() => { const editor=document.querySelector(".composer-editor"); editor.focus(); const range=document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); })()')
  await evaluate('(() => { const editor=document.querySelector(".composer-editor"), clipboardData=new DataTransfer(); clipboardData.setData("text/plain", "첨부 이미지 입력 전달 검사\\n" + "선택한 그림과 논문의 결과를 함께 설명해 주세요.\\n".repeat(12)); editor.dispatchEvent(new ClipboardEvent("paste", {bubbles:true,cancelable:true,clipboardData})); })()')
  await wait('(() => { const editor=document.querySelector(".composer-editor"), selection=getSelection(); if(!selection?.rangeCount) return false; const caret=editor.querySelector(":scope > div:last-child").getBoundingClientRect(), viewport=editor.getBoundingClientRect(); return editor.scrollHeight>editor.clientHeight && caret.height>0 && caret.bottom<=viewport.top+editor.clientHeight+1 && caret.top>=viewport.top-1; })()')
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
    if (format === 'flow') assert.equal(await evaluate('getComputedStyle(document.querySelector(".reading-block.text span[data-anchor]")).fontWeight'), '400', 'Source regular weight must also survive flow layout')
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
  // These PDFs intentionally share a sentence ID. Drafts must still belong to
  // their own paper, and delayed IPC must not resurrect a closed/foreign panel.
  const openCaptureSource = async target => {
    await evaluate(`window.prism.openEvidenceAnchor(${JSON.stringify({ paperId: target.arxivId, anchorId: citedSource.id, type: 'sentence', page: 1, label: 'Draft source' })})`)
    await wait(`Boolean(document.querySelector('[data-pane=original][data-shown=true] [data-anchor="${target.arxivId === paper.arxivId ? biologyTitle.id : engineeringTitle.id}"]'))`)
  }
  const openCapture = async () => {
    await evaluate(`document.querySelector('[data-pane=original] [data-anchor="${citedSource.id}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
    await wait('Boolean(document.querySelector("[aria-label=\\"노트 메모\\"]"))')
  }
  const typeCapture = async (label, value) => {
    await evaluate(`(() => { const input=document.querySelector('[aria-label="${label}"]'); input.focus(); input.select(); })()`)
    await send('Input.insertText', { text: value })
  }
  // A composer reference belongs to its source paper even after the reader switches papers.
  await openCaptureSource(paper)
  if (!await evaluate('Boolean(document.querySelector(".composer-editor"))')) await evaluate('document.querySelector(".reading-focus").click()')
  await wait('Boolean(document.querySelector(".composer-editor"))')
  await evaluate('(() => { const editor=document.querySelector(".composer-editor"); editor.focus(); const range=document.createRange(); range.selectNodeContents(editor); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); })()')
  await send('Input.insertText', { text: '' })
  await evaluate(`document.querySelector('[data-pane=original][data-shown=true] [data-anchor="${citedSource.id}"]').click()`)
  await wait('Boolean(document.querySelector(".composer-anchor-memo"))')
  await send('Input.insertText', { text: 'Round34 질문 초안은 그대로 보존되어야 합니다.' })
  const composerBeforeMemo = await evaluate('({text:document.querySelector(".composer-editor").textContent,anchors:[...document.querySelectorAll(".composer-anchor")].map(node=>node.dataset.placementId)})')
  assert(composerBeforeMemo.text.includes('Round34 질문 초안'))
  await openCaptureSource(external)
  await fs.unlink(path.join(root, 'unexpected-chat-call.txt')).catch(error => { if (error.code !== 'ENOENT') throw error })
  await evaluate('document.querySelector(".composer-anchor-memo").click()')
  await wait(`Boolean(document.querySelector('[data-pane=original][data-shown=true] [data-anchor="${biologyTitle.id}"]'))`)
  await wait('Boolean(document.querySelector(".reader-evidence-backlinks"))')
  assert.equal(await evaluate('document.querySelector(".reader-capture-source").textContent'), citedSource.source)
  await wait(`Boolean(document.querySelector('[data-pane=original] [data-anchor="${citedSource.id}"].highlighted'))`)
  await evaluate(`(() => { const other = [...document.querySelectorAll('[data-pane=original] [data-anchor]')].find(node => node.dataset.anchor !== ${JSON.stringify(citedSource.id)}); other.dispatchEvent(new MouseEvent('mouseover', {bubbles:true})); other.dispatchEvent(new MouseEvent('mouseout', {bubbles:true})); })()`)
  await sleep(100)
  assert(await evaluate(`Boolean(document.querySelector('[data-pane=original] [data-anchor="${citedSource.id}"].highlighted'))`), 'Scroll-induced hover must not replace or erase the exact memo source highlight')
  assert((await evaluate('document.querySelector(".reader-evidence-backlinks header").textContent')).includes(paper.title))
  assert.deepEqual(await evaluate('({text:document.querySelector(".composer-editor").textContent,anchors:[...document.querySelectorAll(".composer-anchor")].map(node=>node.dataset.placementId)})'), composerBeforeMemo)
  await evaluate('document.querySelector("[aria-label=\\"관련 노트 닫기\\"]").click()')
  await wait('!document.querySelector(".reader-evidence-backlinks")')
  await evaluate('document.querySelector(".composer-editor").focus()')
  await sleep(100)
  for (const expectedClass of ['composer-anchor-label', 'composer-anchor-memo']) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await sleep(100)
    assert(await evaluate(`document.activeElement?.classList.contains(${JSON.stringify(expectedClass)})`), `Actual Tab order must focus ${expectedClass}, matching the visible chip→memo→remove order`)
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait('Boolean(document.querySelector(".reader-evidence-backlinks"))')
  await sleep(1000)
  assert.equal(await fs.stat(path.join(root, 'unexpected-chat-call.txt')).then(() => true, () => false), false, 'Enter on the memo action must not submit a paid chat request')
  assert.deepEqual(await evaluate('({text:document.querySelector(".composer-editor").textContent,anchors:[...document.querySelectorAll(".composer-anchor")].map(node=>node.dataset.placementId)})'), composerBeforeMemo)
  await evaluate('document.querySelector("[aria-label=\\"관련 노트 닫기\\"]").click()')
  await wait('!document.querySelector(".reader-evidence-backlinks")')
  const questionText = '(() => { const clone=document.querySelector(".composer-editor").cloneNode(true); clone.querySelectorAll(".composer-anchor").forEach(node=>node.remove()); return clone.textContent.replaceAll("\\u200b", ""); })()'
  const textBeforeRemove = await evaluate(questionText)
  const removedPlacement = await evaluate('document.querySelector(".composer-anchor-remove").closest(".composer-anchor").dataset.placementId')
  await evaluate('document.querySelector(".composer-anchor-remove").focus()')
  await sleep(100)
  assert(await evaluate('document.activeElement?.classList.contains("composer-anchor-remove")'))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(`![...document.querySelectorAll('.composer-anchor')].some(node=>node.dataset.placementId===${JSON.stringify(removedPlacement)})`)
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".composer-anchor")].map(node=>node.dataset.placementId)'), composerBeforeMemo.anchors.filter(id => id !== removedPlacement))
  assert.equal(await evaluate(questionText), textBeforeRemove, 'Removing a reference with Enter must preserve the question text')
  await sleep(1000)
  assert.equal(await fs.stat(path.join(root, 'unexpected-chat-call.txt')).then(() => true, () => false), false, 'Enter on remove must not bubble into chat submission')
  await openCaptureSource(paper); await openCapture()
  await typeCapture('노트 메모', 'Biology draft round33')
  await typeCapture('정의하는 개념', 'Biology concept round33')
  await openCaptureSource(external)
  assert.equal(await evaluate('Boolean(document.querySelector(".reader-evidence-backlinks"))'), false, 'Switching papers must hide the previous evidence form immediately')
  await openCapture()
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"노트 메모\\"]").value'), '', 'Identical anchor IDs across papers must not share drafts')
  await typeCapture('노트 메모', 'Engineering draft round33')
  await openCaptureSource(paper); await openCapture()
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"노트 메모\\"]").value'), 'Biology draft round33')
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"정의하는 개념\\"]").value'), 'Biology concept round33')
  await evaluate('document.querySelector("[aria-label=\\"관련 노트 닫기\\"]").click()')
  await fs.writeFile(path.join(root, 'backlinks-delay.txt'), '1200')
  await openCapture()
  await evaluate('document.querySelector("[aria-label=\\"관련 노트 닫기\\"]").click()')
  await sleep(1500)
  assert.equal(await evaluate('Boolean(document.querySelector(".reader-evidence-backlinks"))'), false, 'A late backlink response must not reopen a dismissed panel')
  await fs.unlink(path.join(root, 'backlinks-delay.txt'))
  await openCapture()
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"노트 메모\\"]").value'), 'Biology draft round33', 'Closing and reopening must retain the session draft')
  await typeCapture('정의하는 개념', '')
  await typeCapture('노트 메모', 'Submitted once round33')
  await fs.writeFile(path.join(root, 'capture-delay.txt'), '1200')
  await evaluate('document.querySelector(".reader-capture").requestSubmit(); document.querySelector(".reader-capture").requestSubmit()')
  await wait('document.querySelector("[aria-label=\\"논문 노트에 담기\\"]").disabled')
  await typeCapture('노트 메모', 'New writing during save round33')
  await sleep(150)
  await openCaptureSource(external); await openCapture()
  await sleep(1400)
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"노트 메모\\"]").value'), 'Engineering draft round33', 'Late save completion must not clear another paper draft')
  assert(!(await evaluate('document.querySelector(".reader-evidence-backlinks").textContent')).includes('제출한 메모를 저장'), 'A save status belongs to its original draft')
  const capturedNote = await fs.readFile(paper.notePath, 'utf8')
  assert.equal(capturedNote.split('Submitted once round33').length - 1, 1, 'Rapid duplicate submission must append once')
  assert(!capturedNote.includes('New writing during save round33'), 'Typing during an in-flight save must remain unsaved')
  await openCaptureSource(paper); await openCapture()
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"노트 메모\\"]").value'), 'New writing during save round33')
  await fs.unlink(path.join(root, 'capture-delay.txt'))
  // A concept failure happens after the paper memo is committed. The form must
  // acknowledge that partial success and let the reader retry only the link.
  const conceptDirectory = path.resolve(vault, 'Concepts'), heldConceptDirectory = path.resolve(root, 'concepts-held-round33')
  assert.equal(path.dirname(conceptDirectory), path.resolve(vault))
  assert.equal(path.dirname(path.resolve(vault)), path.resolve(root))
  assert.equal(path.dirname(heldConceptDirectory), path.resolve(root))
  await fs.mkdir(conceptDirectory, { recursive: true })
  await fs.rename(conceptDirectory, heldConceptDirectory)
  await fs.writeFile(conceptDirectory, 'Test-only directory obstruction')
  await typeCapture('노트 메모', 'Partial success memo round33')
  await typeCapture('정의하는 개념', 'Round33 recovered concept')
  await evaluate('document.querySelector(".reader-capture").requestSubmit()')
  await wait('document.querySelector(".reader-capture-status")?.textContent.includes("논문 근거와 메모는 저장했습니다")')
  assert.equal(await evaluate('document.querySelector(".reader-capture input").value'), '', 'A committed memo must not remain as a retry draft after a concept failure')
  assert.equal((await fs.readFile(paper.notePath, 'utf8')).split('Partial success memo round33').length - 1, 1)
  await fs.unlink(conceptDirectory)
  await fs.rename(heldConceptDirectory, conceptDirectory)
  await typeCapture('정의하는 개념', 'Round33 recovered concept')
  await evaluate('document.querySelector(".reader-capture").requestSubmit()')
  await wait('document.querySelector(".reader-capture-status")?.textContent.includes("정의 비교 표에 담았습니다")')
  assert.equal((await fs.readFile(paper.notePath, 'utf8')).split('Partial success memo round33').length - 1, 1, 'Connection-only retry must not duplicate the acknowledged memo')
  await evaluate('document.querySelector("[aria-label=\\"관련 노트 닫기\\"]").click()')
  await openCaptureSource(external)
  assert(await evaluate(`window.prism.capturePaperNote(${JSON.stringify({ kind: 'evidence', libraryPath: path.join(root, 'another-vault'), paperId: paper.arxivId, anchorId: citedSource.id, memo: 'Must not save to a different vault' })}).then(() => false, error => error.message.includes('라이브러리가 변경'))`), 'A capture request from another vault must fail before writing')
  const crossVaultAnswer = { kind: 'chat', libraryPath: path.join(root, 'another-vault'), paperId: paper.arxivId, question: 'Which vault owns this?', answer: 'Cross-vault answer must not be written.', provider: 'codex', model: 'offline-test' }
  const beforeWrongVaultAnswer = await fs.readFile(paper.notePath, 'utf8')
  assert(await evaluate(`window.prism.capturePaperNote(${JSON.stringify(crossVaultAnswer)}).then(() => false, error => error.message.includes('라이브러리가 변경'))`), 'Chat captures must enforce the same source-vault boundary as evidence memos')
  assert.equal(await fs.readFile(paper.notePath, 'utf8'), beforeWrongVaultAnswer)
  // Exercise the real answer button and the separate Notes renderer, including
  // the initial window load. Synthetic history avoids any paid model call.
  const savedAnswerText = 'Round40 saved answer: sequencing coverage limits this conclusion.'
  const nextAnswerText = 'Round40 second answer: verify the latest block in the already open note.'
  const answerContext = { provider: 'codex', model: 'gpt-5.6-luna', primaryPaperId: paper.arxivId, paperIds: [paper.arxivId] }
  const answerSession = { id: 'answer-navigation-fixture', title: 'Saved answer navigation', ...answerContext, createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { id: 'answer-navigation-question', role: 'user', text: 'Offline fixture question.', anchors: [{ paperId: paper.arxivId, paperTitle: paper.title, anchorId: citedSource.id, type: 'sentence', page: citedSource.page, label: '근거1', source: citedSource.source }], createdAt: Date.now(), ...answerContext },
    { id: 'answer-navigation-answer', role: 'assistant', text: savedAnswerText + ' [@근거1]', createdAt: Date.now(), ...answerContext },
    { id: 'answer-navigation-next-question', role: 'user', text: 'Another offline fixture question.', createdAt: Date.now(), ...answerContext },
    { id: 'answer-navigation-next-answer', role: 'assistant', text: nextAnswerText, createdAt: Date.now(), ...answerContext },
  ] }
  await evaluate(`window.prism.saveSessions(${JSON.stringify([answerSession])})`)
  await reload()
  await wait('Boolean(document.querySelector(".message-actions button"))')
  await evaluate('document.querySelector(".message-actions button").click()')
  await wait('document.querySelector(".message-actions button")?.textContent.includes("저장한")')
  const noteAfterAnswer = await fs.readFile(paper.notePath, 'utf8')
  assert.equal(noteAfterAnswer.split(savedAnswerText).length - 1, 1, 'The answer button must save exactly once')
  assert(/\^ai-answer-[a-zA-Z0-9-]+/m.test(noteAfterAnswer), 'Saved answers need an Obsidian-compatible navigation target')
  await evaluate('document.querySelector(".message-actions button").click()')
  let notesTarget
  for (let attempt = 0; attempt < 150 && !notesTarget; attempt++) {
    notesTarget = (await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())).find(page => page.title === 'Prism Notes')
    if (!notesTarget) await sleep(100)
  }
  assert(notesTarget?.webSocketDebuggerUrl, 'The saved answer must open the Notes window')
  const notesSocket = new WebSocket(notesTarget.webSocketDebuggerUrl), notesPending = new Map()
  let notesSequence = 0
  notesSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data), handler = notesPending.get(message.id)
    if (!handler) return
    notesPending.delete(message.id)
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result)
  })
  await new Promise((resolve, reject) => { notesSocket.addEventListener('open', resolve, { once: true }); notesSocket.addEventListener('error', reject, { once: true }) })
  const notesEvaluate = async expression => {
    const response = await new Promise((resolve, reject) => { const id = ++notesSequence; notesPending.set(id, { resolve, reject }); notesSocket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })
    assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  try {
    const visibleAnswer = `(() => { const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent.includes(${JSON.stringify(savedAnswerText)})); if (!line) return false; const box = line.getBoundingClientRect(), viewport = line.closest('.cm-scroller').getBoundingClientRect(); return box.height > 0 && box.top >= viewport.top && box.bottom <= viewport.bottom; })()`
    let found = false
    for (let attempt = 0; attempt < 150 && !found; attempt++) { found = await notesEvaluate(visibleAnswer); if (!found) await sleep(100) }
    assert(found, 'Opening a saved answer must reveal its expanded text in the editor viewport without another click')
    assert(await notesEvaluate(`(() => { const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent.includes(${JSON.stringify(savedAnswerText)})); return !line.textContent.includes('prism://'); })()`), 'Reading navigation must keep source links formatted instead of entering raw Markdown editing')
    // The existing Notes-open digest refresh adds managed overview sections.
    // Authored content and every captured block must remain byte-identical.
    assert.equal((await fs.readFile(paper.notePath, 'utf8')).split('## Notes\n')[1], noteAfterAnswer.split('## Notes\n')[1], 'Opening the saved answer must preserve the authored note and captured blocks')
    await evaluate('document.querySelectorAll(".message-actions button")[1].click()')
    await wait('document.querySelectorAll(".message-actions button")[1]?.textContent.includes("저장한")')
    await evaluate('document.querySelectorAll(".message-actions button")[1].click()')
    let nextFound = false
    const visibleNextAnswer = visibleAnswer.replace(JSON.stringify(savedAnswerText), JSON.stringify(nextAnswerText))
    for (let attempt = 0; attempt < 150 && !nextFound; attempt++) { nextFound = await notesEvaluate(visibleNextAnswer); if (!nextFound) await sleep(100) }
    assert(nextFound, 'An already open note must refresh and reveal the newly saved answer on the first click')
    assert.equal((await fs.readFile(paper.notePath, 'utf8')).split(nextAnswerText).length - 1, 1)
    await notesEvaluate('window.close(); true')
  } finally { notesSocket.close() }
  await openCaptureSource(external)
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
  // Reproduce a real in-flight IPC switch with the same paper ID in two vaults.
  const answerOwner = (await evaluate('window.prism.getSettings()')).libraryPath
  const twinVault = path.join(root, 'answer-twin-vault')
  const twinPaperDirectory = path.join(twinVault, 'papers', paper.arxivId)
  await fs.mkdir(path.join(twinVault, '.prism'), { recursive: true })
  await fs.mkdir(twinPaperDirectory, { recursive: true })
  const twinPaper = { ...paper, pdfPath: path.join(twinPaperDirectory, 'original.pdf'), notePath: path.join(twinPaperDirectory, `${paper.arxivId}.md`), translationPath: path.join(twinPaperDirectory, 'translation.ko.json') }
  await fs.copyFile(paper.pdfPath, twinPaper.pdfPath)
  const originalBeforeRace = await fs.readFile(paper.notePath, 'utf8')
  await fs.writeFile(twinPaper.notePath, originalBeforeRace)
  await fs.writeFile(path.join(twinVault, '.prism', 'library.json'), JSON.stringify([twinPaper]))
  await fs.writeFile(path.join(root, 'answer-capture-gate.txt'), 'hold')
  const racingAnswer = { ...crossVaultAnswer, libraryPath: answerOwner, answer: 'Round39 source-owned answer.' }
  await evaluate(`(() => { window.__answerCapture = window.prism.capturePaperNote(${JSON.stringify(racingAnswer)}).then(() => ({saved:true}), error => ({saved:false,error:String(error)})); return true; })()`)
  for (let attempt = 0; attempt < 100 && !(await fs.access(path.join(root, 'answer-capture-started.txt')).then(() => true, () => false)); attempt++) await sleep(25)
  await fs.access(path.join(root, 'answer-capture-started.txt'))
  await fs.writeFile(path.join(root, 'directory-selection.txt'), twinVault)
  await evaluate('window.prism.chooseWorkspace()')
  assert.equal((await evaluate('window.prism.getSettings()')).libraryPath, twinVault)
  assert((await evaluate('window.prism.listLibrary()')).some(item => item.arxivId === paper.arxivId), 'The destination vault must contain the same paper ID')
  const twinBeforeRelease = await fs.readFile(twinPaper.notePath, 'utf8')
  await fs.unlink(path.join(root, 'answer-capture-gate.txt'))
  const raceOutcome = await evaluate('window.__answerCapture')
  assert.equal(raceOutcome.saved, false)
  assert(raceOutcome.error.includes('라이브러리가 변경'))
  assert.equal(await fs.readFile(paper.notePath, 'utf8'), originalBeforeRace)
  assert.equal(await fs.readFile(twinPaper.notePath, 'utf8'), twinBeforeRelease, 'A delayed answer must not write into another vault with the same paper ID')
  await fs.writeFile(path.join(root, 'directory-selection.txt'), answerOwner)
  await evaluate('window.prism.chooseWorkspace()')
  assert((await evaluate(`window.prism.capturePaperNote(${JSON.stringify(racingAnswer)})`)).saved)
  assert((await fs.readFile(paper.notePath, 'utf8')).includes(racingAnswer.answer), 'Returning to the owner vault must allow retry')
  assert.equal(await fs.readFile(twinPaper.notePath, 'utf8'), twinBeforeRelease)
  const missingOwner = { ...racingAnswer }; delete missingOwner.libraryPath
  assert(await evaluate(`window.prism.capturePaperNote(${JSON.stringify(missingOwner)}).then(() => false, () => true)`), 'An IPC answer capture must not silently default a missing vault')
  await fs.unlink(path.join(root, 'directory-selection.txt'))
  const node = (await evaluate('window.prism.listKnowledgeNodes()')).find(node => node.title === paper.title)
  assert(node)
  const snapshot = await evaluate(`window.prism.readKnowledgeNode(${JSON.stringify(node.id)})`)
  assert(snapshot.vaultId)
  await evaluate('window.prism.chooseWorkspace()')
  const saved = await evaluate(`window.prism.saveKnowledgeNode(${JSON.stringify(node.id)}, ${JSON.stringify({ content: snapshot.content + '\nSaved after vault switch.\n', expectedRevision: snapshot.revision, vaultId: snapshot.vaultId })})`)
  assert(saved.saved)
  assert((await fs.readFile(paper.notePath, 'utf8')).includes('Saved after vault switch.'))
  const claimRequest = { title: 'Claim pinned to original vault', nodeType: 'claim', body: '# Claim pinned to original vault\n\nOriginal vault evidence.\n', vaultId: snapshot.vaultId }
  const createdClaim = await evaluate(`window.prism.createKnowledgeNode(${JSON.stringify(claimRequest)})`)
  const pinnedClaim = await evaluate(`window.prism.readKnowledgeNode(${JSON.stringify(createdClaim.id)}, ${JSON.stringify(snapshot.vaultId)})`)
  assert(pinnedClaim.content.includes('Original vault evidence.'))
  const relationRequest = { sourceId: node.id, targetId: createdClaim.id, type: 'supports', creator: 'user', expectedRevision: saved.snapshot.revision, vaultId: snapshot.vaultId }
  assert((await evaluate(`window.prism.createKnowledgeRelation(${JSON.stringify(relationRequest)})`)).saved)
  assert(!(await evaluate('window.prism.listKnowledgeNodes()')).some(item => item.id === createdClaim.id), 'Pinned claim must not appear in the newly selected vault')
  assert(await evaluate(`window.prism.createKnowledgeNode(${JSON.stringify({ ...claimRequest, vaultId: 'unregistered-vault' })}).then(() => false, () => true)`), 'Invalid vault token must not fall back to current vault')
  assert(await evaluate(`window.prism.createKnowledgeRelation(${JSON.stringify({ ...relationRequest, vaultId: '' })}).then(() => false, () => true)`), 'Empty vault token must not fall back to current vault')
  assert(await evaluate(`window.prism.createKnowledgeNode(${JSON.stringify({ ...claimRequest, body: 7 })}).then(() => false, () => true)`), 'Malformed custom note body must be rejected before creating a file')
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
