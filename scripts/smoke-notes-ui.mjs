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
async function waitFor(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check()) return; await sleep(80) }
  throw new Error(message)
}

async function replaceEditor(connection, content, selector = '.cm-content') {
  await connection.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await connection.send('Input.insertText', { text: content })
}

let mainConnection
let notesConnection
try {
  mainConnection = await connect(await waitForPage('Prism'))
  await mainConnection.evaluate('window.prism.openNotes()')
  notesConnection = await connect(await waitForPage('Prism Notes'))
  await sleep(400)

  assert(await notesConnection.evaluate(`document.querySelector('.notes-modebar button.active')?.textContent.includes('Live Edit')`), 'Live Edit was not the default mode.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.getAttribute('aria-label')`) === 'Editor fixture Markdown 노트', 'CodeMirror editor was not accessible.')
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.cm-live-edit .cm-md-h1'))`), 'Live Edit did not present Markdown as a styled document.')
  assert(await notesConnection.evaluate(`document.querySelectorAll('.notes-block-tools button').length`) === 11, 'The block toolbar did not expose every supported block command.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="개인 템플릿 관리"]').click()`)
  await sleep(350)
  assert(await notesConnection.evaluate(`document.querySelectorAll('.template-manager-body aside > div > button').length`) === 5, 'The five starter templates were not created.')
  assert((await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md')).length === 5, 'Starter templates were not stored as Markdown files.')
  for (const directory of ['00 Inbox', 'Papers', 'Concepts', 'Claims', 'Insights', 'Questions', 'Projects', 'Templates', 'Assets']) assert((await fs.stat(path.join(libraryPath, directory))).isDirectory(), `Vault directory was not created: ${directory}`)

  const templateScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const templateScreenshotPath = path.resolve('tmp/ui/notes-templates.png')
  await fs.mkdir(path.dirname(templateScreenshotPath), { recursive: true })
  await fs.writeFile(templateScreenshotPath, Buffer.from(templateScreenshot.data, 'base64'))

  await notesConnection.evaluate(`document.querySelector('.template-new').click()`)
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="템플릿 이름"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '나의 주장 검토'); input.dispatchEvent(new Event('input', { bubbles: true })); const select = document.querySelector('select[aria-label="템플릿 노트 유형"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(select, 'claim'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await replaceEditor(notesConnection, '# {{title}}\n\n## 나의 근거\n', '.template-editor .cm-content')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await sleep(350)
  let templateFiles = (await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md'))
  assert(templateFiles.length === 6, 'A personal template was not created.')
  const customTemplateName = templateFiles.find((name) => name.startsWith('나의 주장 검토'))
  assert(customTemplateName, 'The personal template Markdown file was not named as expected.')
  const customTemplatePath = path.join(libraryPath, 'Templates', customTemplateName)
  const customTemplate = await fs.readFile(customTemplatePath, 'utf8')
  assert(customTemplate.includes('node_type: claim') && customTemplate.includes('## 나의 근거'), 'The personal template did not preserve frontmatter and Markdown content.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('복제')).click()`)
  await sleep(350)
  templateFiles = (await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md'))
  assert(templateFiles.length === 7, 'Template duplication did not create a Markdown copy.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('기본값')).click()`)
  await sleep(250)
  const defaults = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'template-defaults.json'), 'utf8'))
  assert(typeof defaults.claim === 'string' && defaults.claim.startsWith('claim-'), 'The default template selection was not persisted.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.trim() === '삭제').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('삭제 확인')).click()`)
  await sleep(350)
  assert((await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md')).length === 6, 'Template deletion did not remove the active file.')
  assert((await fs.readdir(path.join(libraryPath, '.prism', 'trash', 'templates'))).length === 1, 'Deleted templates were not recoverably moved to trash.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager-body aside > div > button')].find((button) => button.textContent.includes('Paper - Deep review')).click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.trim() === '삭제').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('삭제 확인')).click()`)
  await sleep(350)
  assert(!(await fs.readdir(path.join(libraryPath, 'Templates'))).includes('Paper - Deep review.md'), 'A deleted starter template was recreated during refresh.')
  assert((await fs.readdir(path.join(libraryPath, '.prism', 'trash', 'templates'))).length === 2, 'Deleted starter templates were not moved to trash.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="템플릿 닫기"]').click()`)
  await sleep(700)
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.template-manager'))`), 'The template manager did not close.')
  assert(await notesConnection.evaluate(`document.querySelectorAll('.cm-content').length`) === 1, 'The template editor remained mounted after closing.')

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
  await replaceEditor(notesConnection, replacement)
  const editorAfterReplacement = await notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent`)
  assert(editorAfterReplacement.includes('Exact spacing'), `The editor did not receive replacement input. Actual tail: ${JSON.stringify(editorAfterReplacement.slice(-120))}`)
  await waitFor(async () => await fs.readFile(notePath, 'utf8') === replacement, 'The exact Markdown text was not saved after editing.')
  const exactSaved = await fs.readFile(notePath, 'utf8')
  const saveUiState = await notesConnection.evaluate(`({ status: document.querySelector('.notes-save-status')?.textContent, error: document.querySelector('.notes-error')?.textContent, conflict: Boolean(document.querySelector('.notes-conflict')) })`)
  assert(exactSaved === replacement, `The exact Markdown text was not saved after editing. Actual tail: ${JSON.stringify(exactSaved.slice(-120))}; UI: ${JSON.stringify(saveUiState)}`)

  const localConflict = `${replacement}\nLocal draft must not be lost.\n`
  const externalConflict = `${replacement}\nExternal edit from Obsidian.\n`
  await replaceEditor(notesConnection, localConflict)
  await fs.writeFile(notePath, externalConflict, 'utf8')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'An external edit did not open the conflict comparison.')
  const conflictState = await notesConnection.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.notes-conflict')),
    title: document.querySelector('#notes-conflict-title')?.textContent,
    versions: [...document.querySelectorAll('.notes-conflict pre')].map((element) => element.textContent),
  }))()`)
  assert(conflictState.visible && conflictState.title.includes('외부 변경'), 'An external edit did not open the conflict comparison.')
  assert(conflictState.versions[0].includes('Local draft') && conflictState.versions[1].includes('External edit'), 'The conflict comparison did not preserve both versions.')
  assert(await fs.readFile(notePath, 'utf8') === externalConflict, 'Autosave overwrote an external edit before conflict resolution.')

  const conflictScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const conflictScreenshotPath = path.resolve('tmp/ui/notes-conflict.png')
  await fs.mkdir(path.dirname(conflictScreenshotPath), { recursive: true })
  await fs.writeFile(conflictScreenshotPath, Buffer.from(conflictScreenshot.data, 'base64'))

  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-conflict button')].find((button) => button.textContent.includes('디스크 버전')).click()`)
  await sleep(150)
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'Choosing the disk version did not close the conflict dialog.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent.includes('External edit from Obsidian.')`), 'Choosing the disk version did not load its content.')

  const cleanExternal = `${externalConflict}\nReloaded while clean.\n`
  await fs.writeFile(notePath, cleanExternal, 'utf8')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.notes-notice')?.textContent.includes('외부 편집기')`), 'A clean external edit was not reported and reloaded.')
  assert(await notesConnection.evaluate(`document.querySelector('.notes-notice')?.textContent.includes('외부 편집기')`), 'A clean external edit was not reported and reloaded.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent.includes('Reloaded while clean.')`), 'A clean external edit was not loaded into the editor.')

  const localOverwrite = `${cleanExternal}\nKeep my second local draft.\n`
  const secondExternal = `${cleanExternal}\nSecond external edit.\n`
  await replaceEditor(notesConnection, localOverwrite)
  await fs.writeFile(notePath, secondExternal, 'utf8')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'The second external edit did not open the conflict comparison.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-conflict button')].find((button) => button.textContent.includes('내 편집본')).click()`)
  await waitFor(async () => await fs.readFile(notePath, 'utf8') === localOverwrite, 'Explicit overwrite did not atomically save the local version.')
  assert(await fs.readFile(notePath, 'utf8') === localOverwrite, 'Explicit overwrite did not atomically save the local version.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="제목 블록 삽입"]').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent.includes('제목')`), 'The toolbar did not update the editor document.')
  const toolbarState = await notesConnection.evaluate(`({ updated: document.querySelector('.cm-content')?.textContent.includes('제목'), conflict: Boolean(document.querySelector('.notes-conflict')), disabled: document.querySelector('button[aria-label="제목 블록 삽입"]')?.disabled, mode: document.querySelector('.notes-modebar button.active')?.textContent })`)
  assert(toolbarState.updated, `The toolbar did not update the editor document: ${JSON.stringify(toolbarState)}`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('## 제목'), 'The toolbar did not insert a heading block.')
  assert((await fs.readFile(notePath, 'utf8')).includes('## 제목'), 'The toolbar did not insert a heading block.')

  await notesConnection.evaluate(`document.querySelector('.cm-content').focus()`)
  for (const key of ['ArrowRight', 'Enter', 'Enter']) {
    const code = key === 'Enter' ? 13 : 39
    await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
    await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
  }
  await notesConnection.send('Input.insertText', { text: '/표' })
  await sleep(150)
  assert(await notesConnection.evaluate(`document.querySelector('.slash-command-menu button')?.textContent.includes('표')`), 'Typing /표 did not open the filtered slash command menu.')
  const frontmatterState = await notesConnection.evaluate(`(() => { const lines = [...document.querySelectorAll('.cm-line')].slice(0, 6); return { lines: lines.map((line) => ({ text: line.textContent, className: line.className, display: getComputedStyle(line).display })) } })()`)
  assert(frontmatterState.lines.filter((line) => line.className.includes('cm-md-frontmatter') && line.display === 'none').length >= 3, `Live Edit exposed frontmatter: ${JSON.stringify(frontmatterState)}`)

  const screenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const screenshotPath = path.resolve('tmp/ui/notes-live-edit.png')
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await waitFor(async () => { const current = await fs.readFile(notePath, 'utf8'); return current.includes('| 항목 | 내용 |') && !current.includes('/표') }, 'Enter did not apply the selected slash command.')
  const slashResult = await fs.readFile(notePath, 'utf8')
  assert(slashResult.includes('| 항목 | 내용 |') && !slashResult.includes('/표'), 'Enter did not apply the selected slash command.')
  assert(notesConnection.exceptions.length === 0, `Notes renderer exceptions: ${notesConnection.exceptions.join('; ')}`)
  process.stdout.write(`Notes UI smoke passed: templates, document editing, safe external changes, conflict resolution, toolbar, slash commands, exact Markdown, reading, and split modes.\nScreenshots: ${screenshotPath}, ${conflictScreenshotPath}, ${templateScreenshotPath}\n`)
} finally {
  notesConnection?.socket.close()
  mainConnection?.socket.close()
  if (electron.exitCode === null) {
    electron.kill()
    await new Promise((resolve) => electron.once('exit', resolve))
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
