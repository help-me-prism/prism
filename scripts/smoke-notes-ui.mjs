import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9324
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-notes-smoke-'))
const libraryPath = path.join(temporaryRoot, 'library')
const profilePath = path.join(temporaryRoot, 'profile')
const paperPath = path.join(libraryPath, 'papers', 'test.0001')
const notePath = path.join(paperPath, 'test.0001.md')
const initialNote = `---
type: paper
title: "Editor fixture"
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
await fs.writeFile(notePath, initialNote, 'utf8')
await fs.writeFile(path.join(libraryPath, '.prism', 'library.json'), JSON.stringify([{
  arxivId: 'test.0001', title: 'Editor fixture', authors: ['Prism'], summary: 'Fixture', published: '2026-09-02', updated: '2026-09-02', categories: ['cs.HC'], pdfUrl: '', absUrl: '', pdfPath: path.join(paperPath, 'original.pdf'), notePath, translationPath: path.join(paperPath, 'translation.ko.json'), downloadedAt: Date.now(),
}], null, 2), 'utf8')

const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, '.'], {
  cwd: process.cwd(),
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' },
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

let mainConnection
let notesConnection
try {
  mainConnection = await connect(await waitForPage('Prism'))
  await mainConnection.evaluate('window.prism.openNotes()')
  notesConnection = await connect(await waitForPage('Prism Notes'))
  await sleep(400)

  assert(await notesConnection.evaluate(`document.querySelector('.notes-modebar button.active')?.textContent.includes('Live Edit')`), 'Live Edit was not the default mode.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.getAttribute('aria-label')`) === 'Editor fixture Markdown 노트', 'CodeMirror editor was not accessible.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-modebar button')].find((button) => button.textContent.includes('읽기')).click()`)
  await sleep(100)
  const readState = await notesConnection.evaluate(`(() => ({
    heading: document.querySelector('.notes-preview h1')?.textContent,
    hasTable: Boolean(document.querySelector('.notes-preview table')),
    hasMath: Boolean(document.querySelector('.notes-preview .katex')),
    frontmatterVisible: document.querySelector('.notes-preview')?.textContent.includes('type: paper'),
    commentVisible: document.querySelector('.notes-preview')?.textContent.includes('keep-this-comment'),
  }))()`)
  assert(readState.heading === 'Research note', 'Reading mode did not render the heading.')
  assert(readState.hasTable && readState.hasMath, 'Reading mode did not render GFM table and math.')
  assert(!readState.frontmatterVisible, 'Reading mode exposed YAML frontmatter as note content.')
  assert(!readState.commentVisible, 'Reading mode exposed a preserved HTML comment.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-modebar button')].find((button) => button.textContent.includes('분할')).click()`)
  await sleep(100)
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.mode-split .markdown-editor') && document.querySelector('.mode-split .notes-preview'))`), 'Split mode did not show editor and preview together.')

  const replacement = `${initialNote}\nExact spacing:  A  B\n`
  await notesConnection.evaluate(`document.querySelector('.cm-content').focus()`)
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await notesConnection.send('Input.insertText', { text: replacement })
  await sleep(700)
  assert(await fs.readFile(notePath, 'utf8') === replacement, 'The exact Markdown text was not saved after editing.')

  const screenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const screenshotPath = path.resolve('tmp/ui/notes-editor.png')
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  assert(notesConnection.exceptions.length === 0, `Notes renderer exceptions: ${notesConnection.exceptions.join('; ')}`)
  process.stdout.write(`Notes UI smoke passed: exact Markdown, reading, Live Edit, and split modes.\nScreenshot: ${screenshotPath}\n`)
} finally {
  notesConnection?.socket.close()
  mainConnection?.socket.close()
  if (electron.exitCode === null) {
    electron.kill()
    await new Promise((resolve) => electron.once('exit', resolve))
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
