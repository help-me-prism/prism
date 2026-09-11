// Launch the real reader against a library and save a PNG of the translated
// view for each requested page, so figure, table and equation regions can be
// checked as the reader actually draws them.
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const [libraryPath, paperTitleMatch, pageList, outputDir = 'tmp/translated'] = process.argv.slice(2)
if (!libraryPath) throw new Error('Usage: node scripts/capture-translated-pages.mjs <library> <paper-substring> <p1,p2,...> [outDir]')
const wanted = pageList.split(',').map(Number)
const port = 9377
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-capture-'))
await fs.mkdir(outputDir, { recursive: true })

const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, '.'], {
  cwd: process.cwd(),
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: path.resolve(libraryPath), PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_WINDOW_SIZE: '1600x1100' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let output = ''
electron.stdout.on('data', (chunk) => { output += chunk })
electron.stderr.on('data', (chunk) => { output += chunk })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let socket; const pending = new Map(); let sequence = 0
function send(method, params = {}) {
  sequence += 1
  return new Promise((resolve, reject) => { pending.set(sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params })) })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
async function waitFor(expression, message, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(200) }
  throw new Error(`${message}\n${output.slice(-2000)}`)
}

try {
  const deadline = Date.now() + 30_000
  let page
  while (Date.now() < deadline && !page) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      page = list.find((candidate) => candidate.type === 'page' && /Prism/i.test(candidate.title))
    } catch { /* still starting */ }
    if (!page) await sleep(200)
  }
  if (!page) throw new Error(`Electron did not expose the Prism page.\n${output}`)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)); if (!message.id) return
    const callback = pending.get(message.id); if (!callback) return
    pending.delete(message.id)
    message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result)
  })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  await send('Runtime.enable')
  await waitFor(`Boolean(document.querySelector('.paper-tab, .reader-empty'))`, 'The reader never settled.')
  // Clicking once is not enough: the reader restores the paper it had open, so a
  // capture of a different paper silently produced the wrong screenshots. Click
  // until the open tab is actually the paper that was asked for.
  const opened = () => evaluate(`Boolean([...document.querySelectorAll('.paper-tab')].some(node => (node.textContent ?? '').includes(${JSON.stringify(paperTitleMatch)})))`)
  for (let attempt = 0; attempt < 20 && !(await opened()); attempt += 1) {
    await evaluate(`(() => { const item = [...document.querySelectorAll('.library-item, .paper-tab, aside button, nav button')].find(node => (node.textContent ?? '').includes(${JSON.stringify(paperTitleMatch)})); item?.click(); return Boolean(item) })()`)
    await sleep(600)
  }
  if (!(await opened())) throw new Error(`Never opened a paper matching ${paperTitleMatch}`)
  await waitFor(`Boolean(document.querySelector('.continuous-page'))`, 'No page rendered.')
  await evaluate(`(() => { const button = [...document.querySelectorAll('.document-mode button')].find(node => node.textContent.includes('병기')); button?.click(); return Boolean(button) })()`)
  await sleep(1500)
  console.log('controls:', JSON.stringify(await evaluate(`[...document.querySelectorAll('button')].map(node => (node.getAttribute('aria-label') || node.textContent || '').trim()).filter(Boolean).slice(0,40)`)))
  console.log('scrollers:', JSON.stringify(await evaluate(`[...document.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 40).map(node => node.className + '|' + node.scrollHeight + '/' + node.clientHeight).slice(0,12)`)))
  console.log('page anchors:', JSON.stringify(await evaluate(`[...document.querySelectorAll('.continuous-page')].slice(0,4).map(node => node.dataset.page ?? node.className)`)))
  for (const number of wanted) {
    // Use the reader's own pagination; the scroll panes are re-synced from the
    // saved reading position shortly after load.
    const currentPage = async () => evaluate(`(() => {
      const label = [...document.querySelectorAll('button')].map(node => node.getAttribute('aria-label') ?? '').find(text => text.startsWith('현재 ') && text.includes('페이지 AI 번역'))
      return label ? Number(label.slice(3, label.indexOf('페이지'))) : 0
    })()`)
    for (let guard = 0; guard < 200; guard += 1) {
      const current = await currentPage()
      if (!current || current === number) break
      const label = current < number ? '다음 페이지' : '이전 페이지'
      await evaluate(`[...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === ${JSON.stringify('__LABEL__')})?.click()`.replace('__LABEL__', label))
      await sleep(350)
    }
    const landed = await currentPage()
    if (landed !== number) console.log(`page ${number}: landed on ${landed}`)
    await sleep(2500)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(outputDir, `page-${number}.png`), Buffer.from(shot.data, 'base64'))
    console.log(`saved ${path.join(outputDir, `page-${number}.png`)}`)
  }
} finally {
  electron.kill()
  await fs.rm(profilePath, { recursive: true, force: true }).catch(() => undefined)
}
