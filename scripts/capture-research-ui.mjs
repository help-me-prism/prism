import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

// Opens Prism against a library folder and captures the research-DB screens (Reader capture panel, Notes context panel,
// curation queue) into tmp/ui for a visual check. Usage: node scripts/capture-research-ui.mjs <library-path> [port]
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const libraryPath = path.resolve(process.argv[2] ?? '')
const port = Number(process.argv[3] ?? 9351)
if (!libraryPath) throw new Error('Pass the library folder to open.')
const profilePath = path.join(process.cwd(), 'tmp', 'capture-profile')
await fs.rm(profilePath, { recursive: true, force: true })
await fs.mkdir(path.join(process.cwd(), 'tmp', 'ui'), { recursive: true })

const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, '.'], {
  cwd: process.cwd(), env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let output = ''
electron.stdout.on('data', (chunk) => { output += chunk }); electron.stderr.on('data', (chunk) => { output += chunk })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitForPage(title) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()); const page = pages.find((item) => item.type === 'page' && item.title === title); if (page?.webSocketDebuggerUrl) return page } catch { /* starting */ }
    await sleep(150)
  }
  throw new Error(`Electron did not expose ${title}.\n${output}`)
}
async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl); const pending = new Map(); let sequence = 0
  socket.addEventListener('message', (event) => { const message = JSON.parse(String(event.data)); if (!message.id) return; const callback = pending.get(message.id); if (!callback) return; pending.delete(message.id); if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result) })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const send = (method, params = {}) => { const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) }) }
  const evaluate = async (expression) => { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result.value }
  await send('Runtime.enable'); await send('Page.enable')
  return { socket, send, evaluate, shot: async (name) => { const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const file = path.resolve('tmp/ui', name); await fs.writeFile(file, Buffer.from(data.data, 'base64')); console.log(`saved ${file}`) } }
}
async function waitFor(check, message, timeout = 30_000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check().catch(() => false)) return; await sleep(200) } throw new Error(message) }

let main; let notes
try {
  main = await connect(await waitForPage('Prism'))
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => main.evaluate(`document.querySelectorAll('.paper-tree button').length > 0`), 'No papers in the library tree.')
  await main.evaluate(`document.querySelector('.paper-tree button').click()`)
  await waitFor(() => main.evaluate(`document.querySelectorAll('.anchor-layer span').length > 20`), 'The Reader did not produce sentence anchors.', 90_000)
  await sleep(800)
  await main.evaluate(`(() => { const spans = [...document.querySelectorAll('.anchor-layer span')]; const target = spans.find((span) => span.getBoundingClientRect().top > 250 && span.getBoundingClientRect().width > 80) ?? spans[10]; target.scrollIntoView({ block: 'center' }); target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); })()`)
  await waitFor(() => main.evaluate(`Boolean(document.querySelector('.reader-capture input'))`), 'The capture panel did not open on right-click.')
  await main.evaluate(`(() => { const input = document.querySelector('.reader-capture input[aria-label="노트 메모"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '핵심 문장. 나중에 Claim으로.'); input.dispatchEvent(new Event('input', { bubbles: true })); const concept = document.querySelector('.reader-capture input[aria-label="정의하는 개념"]'); setter.call(concept, 'Attention'); concept.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(300)
  await main.shot('research-reader-capture.png')
  await main.evaluate(`document.querySelector('.reader-capture button[type="submit"]').click()`)
  await waitFor(() => main.evaluate(`document.querySelector('.reader-capture-status')?.textContent.includes('담았습니다')`), 'Capture did not report success.')
  await main.shot('research-reader-captured.png')
  await main.evaluate('window.prism.openNotes()')
  notes = await connect(await waitForPage('Prism Notes'))
  await notes.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.notes-context')) && document.querySelector('.cm-content')?.textContent.includes('나중에 Claim으로')`), 'The Notes window did not show the captured memo with its context panel.')
  await sleep(400)
  await notes.shot('research-notes-context.png')
  await notes.evaluate(`document.querySelector('button[aria-label="정리 대기열"]').click()`)
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.curation-queue')) && !document.querySelector('.curation-queue')?.textContent.includes('계산하는 중')`), 'The curation queue did not load.')
  await sleep(300)
  await notes.shot('research-curation-queue.png')
  await notes.evaluate(`[...document.querySelectorAll('.knowledge-manager-body > aside > div > button')].find((button) => button.textContent.includes('Attention'))?.click()`)
  await waitFor(() => notes.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Attention'`), 'The Attention concept did not open.')
  await sleep(300)
  await notes.shot('research-concept-definition-table.png')
  await notes.evaluate(`document.querySelector('button[aria-label="로컬 관계 그래프"]').click()`)
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.local-graph-filters'))`), 'The local graph filters did not render.')
  await notes.evaluate(`[...document.querySelectorAll('.local-graph-filters button')].find((button) => button.textContent === '2홉').click()`)
  await sleep(600)
  await notes.shot('research-local-graph.png')
  console.log('Captured research UI screenshots.')
} finally {
  notes?.socket.close(); main?.socket.close()
  if (electron.exitCode === null) { electron.kill(); await new Promise((resolve) => electron.once('exit', resolve)) }
}
