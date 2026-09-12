import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9331
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-recall-smoke-'))
const libraryPath = path.join(temporaryRoot, 'library')
const profilePath = path.join(temporaryRoot, 'profile')
const externalUrlLog = path.join(temporaryRoot, 'external-urls.log')
const paperPath = path.join(libraryPath, 'papers', 'test.0001')
const notePath = path.join(paperPath, 'test.0001.md')
const linkedPaperPath = path.join(libraryPath, 'papers', '2401.01234')
const linkedNotePath = path.join(linkedPaperPath, '2401.01234.md')
const linkedNote = `---
type: paper
prism_id: "paper-2401.01234"
arxiv_id: "2401.01234"
title: "Understanding Diffusion Models"
aliases: ["Former linked title"]
reading_status: to_read
---

# Linked paper fixture
`
const initialNote = `---
type: paper
prism_id: "paper-test.0001"
title: "Denoising Diffusion Probabilistic Models"
reading_status: to_read
---

# Research note

> [!note] Evidence
> Preserve this Obsidian callout.

| Item | Value |
| --- | --- |
| Loss | $L_2$ |

<!-- keep-this-comment -->

Related: [[Concepts/Score matching]]
`
await fs.mkdir(path.join(libraryPath, '.prism'), { recursive: true })
await fs.mkdir(paperPath, { recursive: true })
await fs.mkdir(linkedPaperPath, { recursive: true })
await fs.mkdir(path.join(libraryPath, '.prism', 'anchors'), { recursive: true })
await fs.mkdir(path.join(paperPath, 'figures'), { recursive: true })
await fs.writeFile(notePath, initialNote, 'utf8')
await fs.writeFile(linkedNotePath, linkedNote, 'utf8')
await fs.writeFile(path.join(libraryPath, '.prism', 'anchors', 'test.0001.json'), JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [
  { id: 'heading-p1-introduction', type: 'heading', page: 1, source: 'Introduction' },
  { id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching. The input is $x_t$.' },
  { id: 'equation-p2-3', type: 'equation', page: 2, source: 'L_simple = E[||epsilon - epsilon_theta(x_t,t)||^2]' },
  { id: 'table-p3-1', type: 'table', page: 3, source: 'Model | FID\nDDPM | 3.17' },
] }, null, 2), 'utf8')
await fs.writeFile(path.join(paperPath, 'figures', 'figure-p4-1.json'), JSON.stringify({ figureId: 'figure-p4-1', paperId: 'test.0001', page: 4, caption: 'Overview of the reverse diffusion process.' }, null, 2), 'utf8')
await fs.writeFile(path.join(libraryPath, '.prism', 'library.json'), JSON.stringify([{
  arxivId: 'test.0001', title: 'Denoising Diffusion Probabilistic Models', authors: ['Prism'], summary: 'Fixture', published: '2026-09-02', updated: '2026-09-02', categories: ['cs.HC'], pdfUrl: '', absUrl: '', pdfPath: path.join(paperPath, 'original.pdf'), notePath, translationPath: path.join(paperPath, 'translation.ko.json'), downloadedAt: Date.now(),
}, {
  arxivId: '2401.01234', title: 'Understanding Diffusion Models', authors: ['Second Author'], summary: 'A searchable linked paper.', published: '2024-01-03', updated: '2024-01-03', categories: ['cs.AI'], pdfUrl: '', absUrl: '', pdfPath: path.join(linkedPaperPath, 'original.pdf'), notePath: linkedNotePath, translationPath: path.join(linkedPaperPath, 'translation.ko.json'), downloadedAt: Date.now() - 1,
}], null, 2), 'utf8')

const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, '.'], {
  cwd: process.cwd(),
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_EXTERNAL_URL_LOG: externalUrlLog },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let processOutput = ''
electron.stdout.on('data', (chunk) => { processOutput += chunk })
electron.stderr.on('data', (chunk) => { processOutput += chunk })

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function pages() {
  return fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
}
async function waitForPage(title) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const page = (await pages()).find((candidate) => candidate.type === 'page' && candidate.title === title)
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* Electron is still starting. */ }
    await sleep(120)
  }
  throw new Error(`Electron did not expose ${title}.\n${processOutput}`)
}
async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  const exceptions = []
  let sequence = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails?.text ?? 'Renderer exception')
    if (!message.id) return
    const callback = pending.get(message.id)
    if (!callback) return
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(message.error.message))
    else callback.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sendSequence = sequence
  function send(method, params = {}) {
    sendSequence += 1
    return new Promise((resolve, reject) => {
      pending.set(sendSequence, { resolve, reject })
      socket.send(JSON.stringify({ id: sendSequence, method, params }))
    })
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
    return response.result.value
  }
  await send('Runtime.enable')
  return { socket, send, evaluate, exceptions }
}
function assert(condition, message) { if (!condition) throw new Error(message) }
async function readPublishedNote(file) {
  const deadline = Date.now() + 2000
  while (true) {
    try { return await fs.readFile(file, 'utf8') } catch (error) {
      if (error?.code !== 'ENOENT' || Date.now() >= deadline) throw error
      await sleep(40)
    }
  }
}
async function waitFor(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) {
      // The transactional writer briefly moves the old file before publishing its replacement.
      // Retry only that observed filesystem gap; all other failures remain immediate.
      if (error?.code !== 'ENOENT') throw error
    }
    await sleep(80)
  }
  throw new Error(message)
}

let main, notes
const outputDir = path.resolve('tmp/ui/recall')
async function clickText(selector, text) {
  await notes.evaluate(`(() => { const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.includes(${JSON.stringify(text)})); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)}); button.click() })()`)
}
async function capture(name) {
  await notes.evaluate(`document.querySelector('button[aria-label="알림 닫기"]')?.click()`)
  const shot = await notes.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.join(outputDir, name + '.png'), Buffer.from(shot.data, 'base64'))
}
async function fill(section, text) {
  await notes.evaluate(`document.querySelector('#recall-${section}').focus()`)
  await notes.send('Input.insertText', { text })
  await waitFor(() => notes.evaluate(`document.querySelector('#recall-${section}')?.value === ${JSON.stringify(text)}`), 'Guided input lost its text.')
}
async function setTheme(theme) {
  await notes.evaluate(`document.querySelector('button[aria-label="노트 설정"]').click()`)
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('select[aria-label="화면 테마"]'))`), 'Theme settings did not open.')
  await notes.evaluate(`(() => { const select = document.querySelector('select[aria-label="화면 테마"]'); select.value = ${JSON.stringify(theme)}; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(() => notes.evaluate(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`), 'Theme did not apply.')
  await notes.evaluate(`document.querySelector('button[aria-label="노트 설정 닫기"]').click()`)
}
try {
  await fs.mkdir(outputDir, { recursive: true })
  main = await connect(await waitForPage('Prism'))
  await main.evaluate('window.prism.openNotes()')
  notes = await connect(await waitForPage('Prism Notes'))
  await notes.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => notes.evaluate(`document.querySelectorAll('.recall-card').length === 2`), 'Home did not display paper records.')
  assert(!await notes.evaluate(`Boolean(document.querySelector('.notes-side'))`), 'Connections should begin closed.')
  assert(!await notes.evaluate(`Boolean(document.querySelector('button[aria-label="정리 대기열"]'))`), 'Advanced tools should not crowd the first screen.')
  assert(!await notes.evaluate(`Boolean(document.querySelector('.notes-status select'))`), 'Model controls should live in settings.')
  await setTheme('light')
  await clickText('.recall-card', 'Denoising Diffusion Probabilistic Models')
  await waitFor(() => notes.evaluate(`document.querySelectorAll('.paper-recall textarea').length === 3`), 'A paper did not open in the guided view.')
  assert(!await notes.evaluate(`Boolean(document.querySelector('.cm-content'))`), 'The complete document should be a separate view.')
  await capture('empty-paper')
  const summary = '노이즈를 조금씩 제거하는 과정으로 데이터를 생성한다. '
  await fill('restate', summary)
  await notes.send('Input.insertText', { text: '학습 목표와 샘플링 비용을 함께 봐야 한다.\n다른 데이터에서 다시 확인한다.' })
  const fullSummary = summary + '학습 목표와 샘플링 비용을 함께 봐야 한다.\n다른 데이터에서 다시 확인한다.'
  await waitFor(() => notes.evaluate(`document.querySelector('#recall-restate').value === ${JSON.stringify(fullSummary)}`), 'Spaces/newlines vanished while typing.')
  await fill('unresolved', '학습 데이터가 적어도 같은 품질을 유지할 수 있을까?')
  await fill('apply', '의료 영상 데이터의 크기를 줄여가며 생성 품질과 오류율을 비교한다.')
  await notes.evaluate('document.activeElement.blur()')
  await waitFor(async () => (await readPublishedNote(notePath)).includes('의료 영상 데이터의 크기를 줄여가며'), 'Guided edits were not saved to Markdown.')
  const stored = await readPublishedNote(notePath)
  assert(stored.includes('<!-- keep-this-comment -->') && stored.includes('Preserve this Obsidian callout.') && stored.includes('| Loss | $L_2$ |'), 'Guided editing damaged old note content.')
  await capture('paper-light')
  await clickText('.recall-done button', '읽기 마침')
  await waitFor(() => notes.evaluate(`document.querySelector('.recall-done button')?.textContent === '읽음'`), 'Reading completion did not persist.')
  await clickText('.note-reading-modes button', '전체 노트')
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.cm-content'))`), 'Full Markdown editing is no longer available.')
  assert(await notes.evaluate(`document.querySelector('.note-body')?.textContent.includes('의료 영상')`), 'Full view did not include the saved idea.')
  await notes.evaluate(`document.querySelector('button[aria-label="노트"]').click()`)
  await waitFor(() => notes.evaluate(`document.querySelector('.recall-card')?.textContent.includes('노이즈를 조금씩')`), 'Recall home did not surface personal writing.')
  await capture('home-light')
  await clickText('.recall-switch button', '연구 아이디어')
  await waitFor(() => notes.evaluate(`document.querySelectorAll('.recall-card').length === 1 && document.querySelector('.recall-card')?.textContent.includes('의료 영상')`), 'Ideas view did not filter and show the saved question and idea.')
  await capture('ideas-light')
  await setTheme('dark')
  await waitFor(() => notes.evaluate(`document.documentElement.dataset.theme === 'dark'`), 'Dark theme did not apply.')
  await capture('ideas-dark')
  await notes.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false })
  assert(await notes.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.notes-home').scrollWidth <= document.querySelector('.notes-home').clientWidth`), 'Home overflows a narrow window.')
  await capture('ideas-narrow')
  await clickText('.recall-card', 'Denoising Diffusion Probabilistic Models')
  await waitFor(() => notes.evaluate(`document.querySelector('#recall-restate')?.value === ${JSON.stringify(fullSummary)}`), 'Reopening a note lost the saved personal summary.')
  assert(await notes.evaluate(`document.querySelector('.note-doc-scroll').scrollWidth <= document.querySelector('.note-doc-scroll').clientWidth`), 'Guided note overflows a narrow window.')
  await capture('paper-narrow')
  // External writes refresh the form, and a block-targeted Reader request opens the full document.
  await fs.appendFile(notePath, '\n## External note\nExternally saved thought.\n^external-recall-block\n')
  await main.evaluate(`window.prism.openKnowledgeNodeInNotes('paper-test.0001', { blockId: 'external-recall-block' })`)
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.cm-content')) && document.querySelector('.note-body').textContent.includes('Externally saved thought.')`), 'Reader block navigation did not reveal the complete saved note.')
  await notes.evaluate(`document.querySelector('button[aria-label="노트"]').click()`)
  await main.evaluate(`window.prism.openPaperInReader('test.0001')`)
  await waitFor(() => main.evaluate(`Boolean(document.querySelector('.reader-recall-entry'))`), 'Reader did not offer a visible reading-note entry.')
  await main.evaluate(`document.querySelector('.reader-recall-entry').click()`)
  await waitFor(() => notes.evaluate(`document.querySelector('#recall-restate')?.value === ${JSON.stringify(fullSummary)}`), 'Reader entry did not open this paper’s personal record.')
  await notes.evaluate(`document.querySelector('button[aria-label="검색"]').click()`)
  await waitFor(() => notes.evaluate(`document.activeElement?.getAttribute('aria-label') === '논문과 내 생각 검색'`), 'Search did not focus a visible input in a narrow window.')
  assert(notes.exceptions.length === 0, `Renderer exceptions: ${notes.exceptions.join(', ')}`)
  console.log('Recall UI passed: home, guided Korean writing, autosave, source preservation, read status, full editor, ideas, themes, narrow layout and Reader navigation.')
  console.log(`Screenshots: ${outputDir}`)
} catch (reason) {
  if (notes) { await capture('failure').catch(() => undefined); console.error(await notes.evaluate('document.body.innerText').catch(String)) }
  throw reason
} finally {
  notes?.socket.close(); main?.socket.close()
  if (electron.exitCode === null) { electron.kill(); await new Promise(resolve => electron.once('exit', resolve)) }
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
