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
const externalUrlLog = path.join(temporaryRoot, 'external-urls.log')
const paperPath = path.join(libraryPath, 'papers', 'test.0001')
const notePath = path.join(paperPath, 'test.0001.md')
const linkedPaperPath = path.join(libraryPath, 'papers', '2401.01234')
const linkedNotePath = path.join(linkedPaperPath, '2401.01234.md')
const linkedNote = `---
type: paper
prism_id: "paper-2401.01234"
arxiv_id: "2401.01234"
title: "Linked Paper Fixture"
aliases: ["Former linked title"]
reading_status: to_read
---

# Linked paper fixture
`
const initialNote = `---
type: paper
prism_id: "paper-test.0001"
title: "Editor fixture"
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
  arxivId: 'test.0001', title: 'Editor fixture', authors: ['Prism'], summary: 'Fixture', published: '2026-09-02', updated: '2026-09-02', categories: ['cs.HC'], pdfUrl: '', absUrl: '', pdfPath: path.join(paperPath, 'original.pdf'), notePath, translationPath: path.join(paperPath, 'translation.ko.json'), downloadedAt: Date.now(),
}, {
  arxivId: '2401.01234', title: 'Linked Paper Fixture', authors: ['Second Author'], summary: 'A searchable linked paper.', published: '2024-01-03', updated: '2024-01-03', categories: ['cs.AI'], pdfUrl: '', absUrl: '', pdfPath: path.join(linkedPaperPath, 'original.pdf'), notePath: linkedNotePath, translationPath: path.join(linkedPaperPath, 'translation.ko.json'), downloadedAt: Date.now() - 1,
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

async function replaceEditor(connection, content, selector = '.cm-content') {
  await connection.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await connection.send('Input.insertText', { text: content })
}

async function pressKey(connection, key, code, modifiers = 0) {
  const windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'End' ? 35 : key === 'Backspace' ? 8 : 0
  const eventKey = key.length === 1 && (modifiers & 8) ? key.toUpperCase() : key
  await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: eventKey, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers })
  await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: eventKey, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers })
}

function runClipboardProcess(command, args, input = '', environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `Clipboard process exited with ${code}`)))
    child.stdin.end(input)
  })
}

async function readSystemClipboard() {
  if (process.platform === 'win32') return runClipboardProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write((Get-Clipboard -Raw))'])
  if (process.platform === 'darwin') return runClipboardProcess('pbpaste', [])
  return undefined
}

async function writeSystemClipboard(value) {
  if (process.platform === 'win32') {
    const clipboardPath = path.join(temporaryRoot, 'clipboard-fixture.txt')
    await fs.writeFile(clipboardPath, value, 'utf8')
    // Windows PowerShell reads files as ANSI by default, which would put mojibake on the clipboard.
    await runClipboardProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 -LiteralPath $env:PRISM_TEST_CLIPBOARD_FILE)'], '', { PRISM_TEST_CLIPBOARD_FILE: clipboardPath })
    return
  }
  if (process.platform === 'darwin') { await runClipboardProcess('pbcopy', [], value); return }
  throw new Error('Clipboard smoke is supported on Windows and macOS.')
}

let mainConnection
let notesConnection
let previousClipboard

// Setting a React-controlled field needs the native setter so the framework sees the change.
async function setField(connection, tag, label, value, event) {
  const selector = JSON.stringify(`${tag}[aria-label="${label}"]`)
  const prototype = tag === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'
  await connection.evaluate(`(() => {
    const field = document.querySelector(${selector});
    if (!field) throw new Error('missing field ' + ${selector});
    Object.getOwnPropertyDescriptor(${prototype}.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`)
}
const setInput = (connection, label, value, tag = 'input') => setField(connection, tag, label, value, 'input')
// Properties start folded so the writing is the first thing on screen; editing one means opening them.
async function openProperties(connection) {
  await connection.evaluate(`(() => { const box = document.querySelector('details.note-props'); if (box) box.open = true; return true })()`)
}
// Property text fields commit on blur, the way a document field should.
async function setPropertyText(connection, label, value) {
  await openProperties(connection)
  await connection.evaluate(`(() => {
    const field = document.querySelector('.prop-text[aria-label="' + ${JSON.stringify(label)} + '"]');
    if (!field || field.disabled) throw new Error('missing or disabled property field');
    field.focus();
    field.select();
  })()`)
  // Real input and blur occur in separate browser tasks. Synthetic input + blur
  // in one evaluate can call onBlur before React commits the new draft closure.
  await connection.send('Input.insertText', { text: value })
  await waitFor(() => connection.evaluate(`document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(label)} && document.activeElement.value === ${JSON.stringify(value)}`), 'Property typing did not reach the focused field.')
  await connection.evaluate(`document.activeElement.blur()`)
}
const chooseSelect = (connection, label, value) => setField(connection, 'select', label, value, 'change')

try {
  mainConnection = await connect(await waitForPage('Prism'))
  // Regression: request a source note while its window does not exist yet. The
  // request must survive both preload→React handoff and initial vault loading.
  await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes('paper-test.0001')`)
  notesConnection = await connect(await waitForPage('Prism Notes'))
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Editor fixture'`), 'First-window source-note navigation was lost during startup.', 15000)
  await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes('paper-2401.01234')`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Linked Paper Fixture'`), 'An existing Notes window did not navigate to the next requested source note.')
  await notesConnection.evaluate(`(() => { setTimeout(() => window.close(), 0); return true })()`)
  notesConnection.socket.close()
  await waitFor(async () => !(await pages()).some(page => page.title === 'Prism Notes'), 'Notes test window did not close.')
  await mainConnection.evaluate('window.prism.openNotes()')
  notesConnection = await connect(await waitForPage('Prism Notes'))
  await notesConnection.evaluate(`(() => { window.__vaultEvents = []; window.prism.onVaultChanged((event) => window.__vaultEvents.push(event)) })()`)
  await notesConnection.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  previousClipboard = await readSystemClipboard()

  // ---------- shell ----------
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.tree-file').length >= 2`), 'The vault tree did not list the fixture notes.').catch(async (error) => { const diag = await notesConnection.evaluate(`JSON.stringify({ tree: document.querySelector('.notes-tree')?.textContent, body: document.body.innerText.slice(0, 400) })`); throw new Error(error.message + ' DIAG ' + diag) })
  const shell = await notesConnection.evaluate(`JSON.stringify({
    rail: [...document.querySelectorAll('.notes-rail button')].map((button) => button.getAttribute('aria-label')),
    folders: [...document.querySelectorAll('.tree-folder span')].map((span) => span.textContent),
    side: Boolean(document.querySelector('.notes-side')),
    status: document.querySelector('.notes-status')?.textContent,
    modes: document.querySelectorAll('.notes-modebar, .knowledge-manager').length,
  })`)
  const shellState = JSON.parse(shell)
  assert(shellState.rail.includes('논문 리더') && shellState.rail.includes('정리 대기열') && shellState.rail.includes('검색'), `The activity rail is incomplete: ${shell}`)
  assert(shellState.folders.includes('논문'), `The tree did not group nodes by folder: ${shell}`)
  assert(shellState.side, 'The connections panel is not visible by default.')
  assert(shellState.status.includes('노드 2'), `The status bar did not count nodes: ${shell}`)
  assert(shellState.modes === 0, 'A retired mode bar or knowledge modal is still rendered.')
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.notes-start-papers button')) && document.querySelector('.notes-start')?.textContent.includes('Obsidian')`), 'The note start screen did not offer a real paper note and vault guidance.')

  await notesConnection.evaluate(`(() => { const trigger = document.querySelector('button[aria-label="노트 설정"]'); trigger.focus(); trigger.click() })()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-settings-dialog select'))`), 'Notes settings did not open inside the Notes window.')
  assert(await notesConnection.evaluate(`Boolean([...document.querySelectorAll('.note-settings-dialog button')].find(button => button.textContent.includes('보관함 전체 정리') && !button.disabled))`), 'Free vault refresh must be discoverable in Notes settings.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-settings-dialog button')].find(button => button.textContent.includes('보관함 전체 정리')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.body.innerText.includes('AI는 사용하지 않았습니다')`), 'Free vault refresh did not finish with a visible result.')
  for (const theme of ['dark', 'light']) {
    await notesConnection.evaluate(`(() => { const select = document.querySelector('.note-settings-dialog select'); select.value = '${theme}'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await waitFor(() => notesConnection.evaluate(`document.documentElement.dataset.theme === '${theme}'`), 'Notes theme did not update.')
    await waitFor(() => mainConnection.evaluate(`document.documentElement.dataset.theme === '${theme}'`), 'Notes theme did not synchronize to Reader.')
  }
  await pressKey(notesConnection, 'Escape', 'Escape')
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.note-settings-dialog')`), 'Escape did not close Notes settings.')
  assert(await notesConnection.evaluate(`document.activeElement?.getAttribute('aria-label') === '노트 설정'`), 'Notes settings did not return focus to its trigger.')
  assert(await notesConnection.evaluate(`(async () => (await window.prism.getSettings()).libraryPath)()`) === libraryPath, 'Opening theme settings changed the note vault.')

  // ---------- opening a note ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Editor fixture')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Editor fixture'`), 'Clicking a tree row did not open the note.')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-body .cm-md-h1'))`), 'The document did not render Markdown as a live document.')
  assert(!await notesConnection.evaluate(`Array.from(document.querySelectorAll('.note-body .cm-md-h1 span')).some(span => getComputedStyle(span).textDecorationLine.includes('underline'))`), 'Live headings must not inherit syntax-editor underlines after mode reconfiguration.')
  const opened = await notesConnection.evaluate(`JSON.stringify({
    tabs: [...document.querySelectorAll('.notes-tab')].map((tab) => tab.textContent.replace(/\\s+/g, ' ').trim()),
    props: [...document.querySelectorAll('.note-props td:first-child')].map((cell) => cell.textContent),
    frontmatterHidden: [...document.querySelectorAll('.note-body .cm-md-frontmatter')].every((line) => getComputedStyle(line).display === 'none'),
    reader: Boolean([...document.querySelectorAll('.note-doc-actions button')].find((button) => button.textContent.includes('리더에서 열기'))),
  })`)
  const openedState = JSON.parse(opened)
  assert(openedState.tabs.length === 1 && openedState.tabs[0].includes('Editor fixture'), `The note did not open in a tab: ${opened}`)
  // Only properties something reads survive: the type row repeated the chip above the title, and nothing
  // ever looked at importance or confidence.
  assert(openedState.props.includes('상태') && openedState.props.includes('읽기') && !openedState.props.includes('유형') && !openedState.props.includes('중요도 · 확신도'), `The paper properties are not the trimmed set: ${opened}`)
  assert(openedState.frontmatterHidden, 'Live editing exposed raw frontmatter.')
  assert(openedState.reader, 'A paper note did not offer to open the Reader.')
  await notesConnection.send('Page.captureScreenshot', { format: 'png' }).then(async (shot) => { await fs.mkdir(path.resolve('tmp/ui'), { recursive: true }); await fs.writeFile(path.resolve('tmp/ui/notes-shell.png'), Buffer.from(shot.data, 'base64')) })

  // ---------- editing round-trips exact Markdown and autosaves ----------
  // A first toolbar insertion must preserve the title and show the link alias,
  // even though the researcher has never placed a caret in this note's body.
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find(button => button.textContent.trim() === '링크').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.note-picker .picker-list button')].find(button => button.textContent.includes('Linked Paper Fixture')))`), 'The toolbar link picker did not offer the other paper.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].find(button => button.textContent.includes('Linked Paper Fixture')).click()`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('|Linked Paper Fixture]]'), 'Toolbar link was not saved.')
  const firstLink = await fs.readFile(notePath, 'utf8')
  assert(firstLink.indexOf('# Research note') < firstLink.indexOf('|Linked Paper Fixture]]') && firstLink.includes('# Research note\n'), 'Toolbar link damaged or preceded the note title.')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-body .cm-content')?.innerText.includes('Linked Paper Fixture') && !document.querySelector('.note-body .cm-content')?.innerText.includes('[[papers/2401.01234')`), 'The newly inserted link exposed its internal path instead of its alias.')
  await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n연구 메모 한 줄.\n\n[[Former linked title|Historical label]]' })
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('연구 메모 한 줄.'), 'Autosave did not write the edit to disk.', 8000)
  const roundTrip = await fs.readFile(notePath, 'utf8')
  assert(roundTrip.startsWith('---\ntype: paper') && roundTrip.includes('> [!note] Evidence') && roundTrip.includes('| Item | Value |') && roundTrip.includes('<!-- keep-this-comment -->'), `Editing rewrote untouched Markdown:\n${roundTrip}`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-save')?.textContent.includes('저장됨')`), 'The save indicator stayed busy after autosave.', 8000)

  // A visible label is not the link target. The old title resolves through the
  // target note's aliases to its current title for both hover and navigation.
  await notesConnection.evaluate(`document.querySelector('.note-doc-title h1').focus(); document.querySelector('[data-wiki-target="Former linked title"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.wiki-link-preview strong')?.textContent === 'Linked Paper Fixture'`), 'An old-title alias did not show the current note in its hover preview.')
  await notesConnection.evaluate(`document.querySelector('[data-wiki-target="Former linked title"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Linked Paper Fixture'`), 'An old-title alias with a different visible label did not open its existing note.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-tab [role=tab]')].find(button=>button.textContent.includes('Editor fixture')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Editor fixture' && Boolean(document.querySelector('.note-body .cm-content'))`), 'The original note did not reopen after alias navigation.')

  // Unresolved [[links]] become inbox concept stubs once editing settles.
  // Wait for what is being asserted, not for the file to exist: a stub is created and then given its
  // properties, so a read that arrives between the two sees a concept without a status and fails for timing.
  await waitFor(async () => {
    try { return (await fs.readFile(path.join(libraryPath, 'Concepts', 'Score matching.md'), 'utf8')).includes('status: inbox') } catch { return false }
  }, 'An unresolved wiki link did not become an inbox concept stub.', 12000)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].some((button) => button.classList.contains('is-stub') && button.textContent.includes('Score matching'))`), 'The new stub did not appear in the tree as a stub.', 8000)

  // ---------- the researcher's own section is opened on request, never before ----------
  // A paper offers exactly the two questions its kind of note asks, and neither exists in the file until asked for.
  const mineButtons = await notesConnection.evaluate(`JSON.stringify([...document.querySelectorAll('.note-hint .note-write-mine')].map((button) => button.textContent.trim()))`)
  assert(JSON.parse(mineButtons).join('|') === '아직 모르겠는 것|내 연구에 쓸 곳', `A paper note offered the wrong sections to write in: ${mineButtons}`)
  assert(!(await fs.readFile(notePath, 'utf8')).includes('prism:mine'), 'A section belonging to the researcher was written into the file before they asked for one.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.note-hint .note-write-mine')].find((button) => button.textContent.includes('아직 모르겠는 것')).click()`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('<!-- prism:mine unresolved -->'), 'Asking for a section did not open one in the file.', 8000)
  const ownSentence = '조건부 경로 부분이 아직 안 풀린다.'
  await notesConnection.send('Input.insertText', { text: ownSentence })
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes(ownSentence), 'Writing in the opened section did not reach the file.', 8000)
  const withOwnSection = await fs.readFile(notePath, 'utf8')
  const marked = withOwnSection.slice(withOwnSection.indexOf('<!-- prism:mine unresolved -->'), withOwnSection.indexOf('<!-- /prism:mine unresolved -->'))
  assert(marked.includes(ownSentence), `The sentence landed outside the section it was written for:\n${withOwnSection}`)
  // The markers are how the rest of the app knows this is the researcher's; they are not something to read.
  const shown = await notesConnection.evaluate(`JSON.stringify([...document.querySelectorAll('.note-body .cm-content .cm-line')].filter((line) => line.textContent.includes('prism:mine') && line.offsetHeight > 0).map((line) => line.textContent))`)
  assert(shown === '[]', `The section markers are visible in the editor: ${shown}`)

  // ---------- block insertion through the single insert affordance ----------
  await notesConnection.evaluate(`document.querySelector('.note-hint .note-insert-block').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.slash-command-menu'))`), 'The insert button did not open the block menu.')
  await notesConnection.send('Input.insertText', { text: '표' })
  await sleep(150)
  assert(await notesConnection.evaluate(`document.querySelector('.slash-command-menu button')?.textContent.includes('표')`), 'Typing filtered the block menu incorrectly.')
  await pressKey(notesConnection, 'Enter', 'Enter')
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('| 항목 | 내용 |'), 'The block menu did not insert a table.', 8000)
  assert(!(await fs.readFile(notePath, 'utf8')).includes('/표'), 'The slash command text stayed in the saved Markdown.')

  // A table cell may contain an escaped pipe — Obsidian aliases inside tables depend on it.
  await notesConnection.evaluate(`(async () => {
    const snapshot = await window.prism.readKnowledgeNode('paper-test.0001');
    const table = '\\n\\n| 논문 | 정의 |\\n| --- | --- |\\n| [[Concepts/Score matching\\\\|Score matching]] | 파이프가 들어간 셀 |\\n';
    await window.prism.saveKnowledgeNode('paper-test.0001', { content: snapshot.content + table, expectedRevision: snapshot.revision });
  })()`)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.cm-rendered-table')].some((table) => table.textContent.includes('파이프가 들어간 셀'))`), 'The escaped-pipe table did not render.', 8000)
  const escapedTable = await notesConnection.evaluate(`(() => {
    const table = [...document.querySelectorAll('.cm-rendered-table')].find((item) => item.textContent.includes('파이프가 들어간 셀'))
    return JSON.stringify({ cells: [...table.querySelectorAll('tr')].map((row) => row.children.length), alias: table.textContent.includes('Score matching') })
  })()`)
  assert(JSON.parse(escapedTable).cells.every((count) => count === 2) && JSON.parse(escapedTable).alias, `An escaped pipe split a table cell: ${escapedTable}`)

  // ---------- keyboard history and native paste ----------
  const undoModifier = process.platform === 'darwin' ? 4 : 2
  await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n실행 취소 확인 문장.' })
  await sleep(200)
  await pressKey(notesConnection, 'z', 'KeyZ', undoModifier)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.note-body .cm-content')?.textContent.includes('실행 취소 확인 문장')`), `${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Z did not undo the edit.`)
  await pressKey(notesConnection, 'z', 'KeyZ', undoModifier | 8)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-body .cm-content')?.textContent.includes('실행 취소 확인 문장')`), 'Shift+Z did not redo the edit.')
  await writeSystemClipboard('붙여넣기 첫 줄\n- 붙여넣기 항목')
  // The OS clipboard is set by another process, so retry the paste until the text actually arrives.
  const pasted = async () => (await fs.readFile(notePath, 'utf8')).replace(/\r\n/g, '\n').includes('붙여넣기 첫 줄\n- 붙여넣기 항목')
  for (let attempt = 0; attempt < 4 && !(await pasted()); attempt += 1) {
    await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
    await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: undoModifier })
    await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: undoModifier })
    await sleep(900)
  }
  await waitFor(pasted, 'Native multiline paste did not reach the Markdown file.', 8000).catch(async (error) => {
    const clip = await readSystemClipboard().catch((reason) => `clipboard read failed: ${reason}`)
    const tail = await notesConnection.evaluate(`JSON.stringify({ active: document.activeElement?.className, tail: document.querySelector('.note-body .cm-content')?.textContent.slice(-80) })`)
    throw new Error(`${error.message} CLIP ${JSON.stringify(clip)} STATE ${tail}`)
  })

  // ---------- section folding stays a view state ----------
  const beforeFold = await fs.readFile(notePath, 'utf8')
  await notesConnection.evaluate(`document.querySelector('.cm-section-fold-toggle')?.click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.cm-section-fold-toggle')?.getAttribute('aria-expanded') === 'false'`), 'The section fold control did not collapse.')
  assert(await fs.readFile(notePath, 'utf8') === beforeFold, 'Folding a section changed the stored Markdown.')
  await notesConnection.evaluate(`document.querySelector('button.cm-section-fold-summary').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.cm-section-fold-toggle')?.getAttribute('aria-expanded') === 'true'`), 'Clicking the visible folded summary did not reveal the content.')
  assert(await fs.readFile(notePath, 'utf8') === beforeFold, 'Expanding the summary changed the stored Markdown.')

  // ---------- inline link and evidence autocomplete ----------
  await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n[[Score' })
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.wiki-link-menu strong')?.textContent.includes('Score matching')`), 'Typing [[ did not search knowledge notes.')
  await pressKey(notesConnection, 'Tab', 'Tab')
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('[[Concepts/Score matching|Score matching]]'), 'Selecting a wiki link did not insert a portable link.', 8000)
  await notesConnection.send('Input.insertText', { text: '\n\n@문장' })
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.evidence-link-menu strong')?.textContent === '문장1'`), 'Typing @ did not search PDF evidence anchors.')
  await pressKey(notesConnection, 'Escape', 'Escape')

  // ---------- evidence cards from the toolbar picker ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find((button) => button.textContent.includes('근거')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.note-picker .picker-list button').length >= 4`), 'The evidence picker did not list stored anchors.')
  await notesConnection.evaluate(`document.querySelector('.note-picker input').focus()`)
  await notesConnection.send('Input.insertText', { text: 'no-such-evidence-round25' })
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-picker [role="status"]')?.textContent.includes('검색어와 일치하는')`), 'A failed evidence search was confused with an empty library.')
  await notesConnection.evaluate(`document.querySelector('.note-picker input').select()`)
  await pressKey(notesConnection, 'Backspace', 'Backspace')
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.note-picker .picker-list button').length >= 4`), 'Clearing the query did not restore existing evidence.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].find((button) => button.textContent.includes('denoising score matching')).click()`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('^evidence-test-0001-sentence-p1-1'), 'Choosing an anchor did not insert an evidence card.', 8000)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.note-evidence .evidence-row').length >= 1`), 'The evidence list did not show the inserted card.')
  const evidenceMarkup = await fs.readFile(notePath, 'utf8')
  assert(evidenceMarkup.includes('> [!evidence] 문장 · Editor fixture · p.1 · 문장1') && evidenceMarkup.includes('prism://paper/test.0001?anchor=sentence-p1-1'), 'The evidence card lost its Obsidian-readable form.')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.cm-rendered-evidence .katex math'))`), 'The saved evidence card displayed inline math delimiters instead of a rendered expression.')

  // ---------- properties write frontmatter ----------
  await chooseSelect(notesConnection, '논문 읽기 상태', 'read')
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('reading_status: read'), 'Changing the reading status did not update frontmatter.', 8000)
  await chooseSelect(notesConnection, '노트 상태', 'established')
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('status: established'), 'Changing the status did not update frontmatter.', 8000)

  // ---------- creating notes from the tree ----------
  for (const [type, title] of [['concept', '역확산 과정'], ['claim', '노이즈 예측은 가중 score matching이다'], ['question', '가중치는 품질에 어떤 영향을 주는가']]) {
    await notesConnection.evaluate(`document.querySelector('.tree-new').click()`)
    await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.tree-create'))`), 'The new-note form did not open.')
    await notesConnection.evaluate(`[...document.querySelectorAll('.create-types button')].find((button) => button.textContent === ${JSON.stringify({ concept: '개념', claim: '주장', question: '질문' }[type])}).click()`)
    await setInput(notesConnection, '새 노트 제목', title)
    await notesConnection.evaluate(`document.querySelector('.create-actions .primary').click()`)
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === ${JSON.stringify(title)}`), `Creating a ${type} note did not open it.`, 8000)
  }
  for (const [folder, file] of [['Concepts', '역확산 과정.md'], ['Claims', '노이즈 예측은 가중 score matching이다.md'], ['Questions', '가중치는 품질에 어떤 영향을 주는가.md']]) {
    assert((await fs.stat(path.join(libraryPath, folder, file))).isFile(), `${folder} note was not stored in its Markdown folder.`)
  }
  const claimPath = path.join(libraryPath, 'Claims', '노이즈 예측은 가중 score matching이다.md')
  assert((await fs.readFile(claimPath, 'utf8')).includes('claim_origin: paper'), 'A new claim did not record its origin.')

  // ---------- claim scope and the contradiction guard ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('노이즈 예측')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('select[aria-label="주장 출처"]:not(:disabled)'))`), 'The claim properties did not become editable.')
  await chooseSelect(notesConnection, '주장 출처', 'mine')
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('claim_origin: mine'), 'The claim origin was not saved.', 8000)
  await setPropertyText(notesConnection, '도메인', '이미지 생성')
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('scope_domain: "이미지 생성"'), 'The claim scope domain was not saved.', 8000)

  const secondClaim = await notesConnection.evaluate(`(async () => {
    const created = await window.prism.createKnowledgeNode({ nodeType: 'claim', title: '청크가 길면 저하된다' });
    const snapshot = await window.prism.readKnowledgeNode(created.id);
    await window.prism.updateKnowledgeProperties(created.id, { scopeDomain: '로봇 제어' }, snapshot.revision);
    return created.id;
  })()`)
  // A note created outside the window shows up the way it does in real use: when the window regains focus.
  await notesConnection.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].some((button) => button.textContent.includes('청크가 길면'))`), 'A note created outside the window did not appear in the tree.', 8000)
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('노이즈 예측')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent.includes('노이즈 예측')`), 'The first claim did not reopen.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find(button => button.textContent.trim() === '관계').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-picker .picker-types'))`), 'The relation picker did not open.')
  const relationChoices = await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-types button')].map((button) => button.textContent)`)
  assert(JSON.stringify(relationChoices) === JSON.stringify(['관련', '사용함', '지지함', '반박함', '확장함', '질문 제기', '답함']), `The claim relation picker offered the wrong model: ${JSON.stringify(relationChoices)}`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-types button')].find((button) => button.textContent === '반박함').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].find((button) => button.textContent.includes('청크가 길면')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-scope-warning')?.textContent.includes('도메인이 다릅니다')`), 'Contradicting claims with different scope did not warn.')
  const scopeShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-scope-warning.png'), Buffer.from(scopeShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-scope-warning button')].find((button) => button.textContent.includes('그래도')).click()`)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.rel-chip')].some((chip) => chip.textContent.includes('청크가 길면'))`), 'The confirmed contradiction did not appear as a relation chip.', 8000)
  // A relation is a sidecar and a line in a generated section, not a callout copied into the note: it used
  // to be written once per edge, at the bottom, and only into the note the edge started from.
  const claimAfterRelation = await readPublishedNote(claimPath)
  assert(!claimAfterRelation.includes('> [!abstract] 관계') && !claimAfterRelation.includes('prism-relation:'), `A relation was copied into the note:
${claimAfterRelation}`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('<!-- prism:auto against -->'), 'The approved contradiction did not reach the generated section.', 10000)
  assert((await readPublishedNote(claimPath)).includes('청크가 길면'), 'The generated section does not name what the claim is contradicted by.')
  const relationRecords = await Promise.all((await fs.readdir(path.join(libraryPath, '.prism', 'relations'))).map(async (file) => JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'relations', file), 'utf8'))))
  assert(relationRecords.some((record) => record.type === 'contradicts' && record.creator === 'user' && record.reviewStatus === 'approved' && record.targetId === secondClaim), 'The relation sidecar did not record the user contradiction.')

  assert(await notesConnection.evaluate(`!document.querySelector('.note-body .cm-content')?.innerText.includes('scope_domain:')`), 'Updating note properties moved the editor into raw YAML metadata.')

  // ---------- graph and backlinks in the standing panel ----------
  assert(await notesConnection.evaluate(`document.querySelector('.side-graph-toggle')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('.side-graph .graph-canvas')`), 'The graph occupied the connection list area before the user requested it.')
  await notesConnection.evaluate(`document.querySelector('.side-graph-toggle').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.side-graph .mini-node').length >= 2`), 'The connections graph did not draw the new edge.')
  // The graph draws its nodes before its edges, and the wait above only
  // established the nodes, so asserting the edge in the next tick failed about
  // one run in five. Wait for the edge itself.
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.side-graph .mini-edge[data-relation="contradicts"]'))`), 'A contradiction was not drawn as a contradiction edge.')
  // The layout has to put the note the panel is about in the middle, whatever else it decides.
  const centreOffset = await notesConnection.evaluate(`(() => {
    const circle = document.querySelector('.side-graph .mini-node.is-center circle')
    return circle ? Math.hypot(Number(circle.getAttribute('cx')) - 160, Number(circle.getAttribute('cy')) - 125) : -1
  })()`)
  assert(centreOffset >= 0 && centreOffset < 1, `The open note is not at the centre of its own graph: ${centreOffset}`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.side-chips button')].find((button) => button.textContent === '간접 연결').click()`)
  await sleep(400)
  const graphShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-graph-panel.png'), Buffer.from(graphShot.data, 'base64'))

  // ---------- the whole vault as one graph ----------
  const vaultGraph = await notesConnection.evaluate(`window.prism.listKnowledgeGraph().then((graph) => ({ nodes: graph.nodes.length, edges: graph.edges.length, links: graph.edges.filter((edge) => edge.origin === 'link').length }))`)
  assert(vaultGraph.nodes >= 4 && vaultGraph.edges >= 2, `The vault graph is missing nodes or edges: ${JSON.stringify(vaultGraph)}`)
  assert(vaultGraph.links >= 1, 'A [[link]] written in the note did not become an edge of the vault graph.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-rail button')].find((button) => button.textContent.includes('그래프')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.graph-view .graph-canvas-full')) && !document.querySelector('.graph-view-empty')`), 'The full graph view did not draw.', 8000)
  assert(await notesConnection.evaluate(`document.querySelectorAll('.graph-types .graph-chip').length >= 2`), 'The full graph is missing its type filters.')
  const graphStatus = await notesConnection.evaluate(`document.querySelector('.graph-status span')?.textContent`)
  assert(/\d+/.test(graphStatus), `The full graph does not report what it is showing: ${graphStatus}`)
  await sleep(500)
  const fullGraphShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-graph-view.png'), Buffer.from(fullGraphShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-rail button')].find((button) => button.textContent.includes('노트')).click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Score matching')).click()`)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.side-connected .side-row-title')].some((row) => row.textContent.includes('Editor fixture'))`), 'The connected-note list did not show the note that links here.', 8000)
  assert(await notesConnection.evaluate(`(() => { const rows = [...document.querySelectorAll('.side-connected button')].filter(row => row.textContent.includes('Editor fixture')); return rows.length === 1 && rows[0].textContent.includes('이 노트를 언급') && Boolean(rows[0].querySelector('.connection-excerpt')) && !document.querySelector('.side-links') })()`), 'The backlink was duplicated or lost its readable mention context.')

  // ---------- reading-time capture reaches the paper note ----------
  const captureResult = await notesConnection.evaluate(`window.prism.capturePaperNote({ kind: 'evidence', paperId: 'test.0001', anchorId: 'equation-p2-3', memo: '노이즈 예측은 score matching이다 — 검증 필요' })`)
  assert(captureResult.blockId === 'evidence-test-0001-equation-p2-3', `Reader capture did not return the evidence block id: ${JSON.stringify(captureResult)}`)
  await notesConnection.evaluate(`window.prism.capturePaperNote({ kind: 'chat', libraryPath: ${JSON.stringify(libraryPath)}, paperId: 'test.0001', question: '이 목적함수는 왜 가중 score matching인가?', answer: '첫 줄\\n\\n둘째 줄', provider: 'codex', model: 'smoke-model' })`)
  const captured = await fs.readFile(notePath, 'utf8')
  assert(captured.includes('검증 필요') && captured.includes('> [!ai]- AI 답변') && captured.includes('<!-- prism-ai-answer:'), `Capture did not land in the paper note:\n${captured}`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Editor fixture')).click()`)
  // The document scrolls in its outer note pane, while CodeMirror virtualizes its lines. Scrolling the
  // last currently mounted line can stall at a viewport boundary before Notes. Use the same section
  // navigation a reader uses; this also verifies that the newly captured section reached React state.
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.note-doc-actions button')].find(button => button.textContent.includes('메모 보기')))`), 'The captured Notes section did not become available in the open note.', 10000)
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find(button => button.textContent.includes('메모 보기')).click()`)
  await waitFor(async () => {
    await sleep(120)
    return notesConnection.evaluate(`document.querySelector('.note-body .cm-content')?.textContent.includes('검증 필요')`)
  }, 'The open note did not reload the externally captured memo.', 20000)

  // ---------- what wrote itself is marked until it has been read ----------
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-auto-read button'))`), 'A note that wrote itself did not offer to be marked as read.', 10000)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].some((button) => button.textContent.includes('Editor fixture') && button.querySelector('.tree-unread'))`), 'The tree did not mark the note that wrote itself.', 8000)
  await notesConnection.evaluate(`document.querySelector('.note-auto-read button').click()`)
  // Only this note is retired: the other notes that wrote themselves keep their own marks.
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.note-auto-read') && ![...document.querySelectorAll('.tree-file')].some((button) => button.textContent.includes('Editor fixture') && button.querySelector('.tree-unread'))`), 'Marking a note as read did not clear it.', 8000)

  // ---------- curation queue: promote a memo into a claim ----------
  const pendingEvidence = { paperId: 'test.0001', anchorId: 'equation-p2-3', type: 'equation', page: 2, label: '수식1' }
  await notesConnection.evaluate(`(async () => {
    const snapshot = await window.prism.readKnowledgeNode('paper-test.0001')
    await window.prism.createKnowledgeRelation({ sourceId: 'paper-test.0001', targetId: ${JSON.stringify(secondClaim)}, type: 'supports', creator: 'ai', evidenceAnchor: ${JSON.stringify(pendingEvidence)}, expectedRevision: snapshot.revision })
  })()`)
  await mainConnection.evaluate(`window.__curationEvidence = null; window.__stopCurationEvidence = window.prism.onOpenEvidenceAnchor(anchor => { window.__curationEvidence = anchor })`)
  await notesConnection.evaluate(`document.querySelector('.notes-rail button[aria-label="정리 대기열"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.curation-queue')) && document.querySelector('.curation-queue')?.textContent.includes('검증 필요')`), 'The curation queue did not list the captured memo.', 10000)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.curation-relation-evidence button'))`), 'The pending relation did not expose its PDF evidence button.')
  assert(await notesConnection.evaluate(`(() => {
    const evidence = document.querySelector('.curation-relation-evidence button')
    const source = evidence.closest('.curation-relation-detail').querySelector('button[title="출발 노트 열기"]')
    return source && source !== evidence && !source.contains(evidence) && !evidence.contains(source) && !evidence.parentElement.closest('button') && evidence.textContent.includes('원문 근거 열기')
  })()`), 'PDF evidence and source-note navigation must be separate non-nested buttons.')
  const evidencePoint = await notesConnection.evaluate(`(() => { const button = document.querySelector('.curation-relation-evidence button'); button.scrollIntoView({ block: 'center' }); const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()`)
  await notesConnection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...evidencePoint, button: 'left', clickCount: 1 })
  await notesConnection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...evidencePoint, button: 'left', clickCount: 1 })
  await waitFor(() => mainConnection.evaluate(`Boolean(window.__curationEvidence)`), 'Clicking pending relation evidence did not reach the Reader event.')
  const receivedEvidence = await mainConnection.evaluate('window.__curationEvidence')
  assert(Object.keys(receivedEvidence).length === Object.keys(pendingEvidence).length && Object.entries(pendingEvidence).every(([key, value]) => receivedEvidence[key] === value), `The relation evidence click changed its PDF anchor identity or location: ${JSON.stringify(receivedEvidence)}`)
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.curation-queue'))`), 'The PDF evidence button opened a note instead of keeping the review queue available.')
  await mainConnection.evaluate('window.__stopCurationEvidence(); delete window.__stopCurationEvidence; delete window.__curationEvidence')
  const queueShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-curation-queue.png'), Buffer.from(queueShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.curation-item')].find((item) => item.textContent.includes('검증 필요')).querySelector('.curation-actions button').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.curation-form input[aria-label="승격 노트 제목"]'))`), 'Choosing promotion did not open the title form.')
  await setInput(notesConnection, '승격 노트 제목', '노이즈 예측은 가중 score matching이다 (스모크)')
  await notesConnection.evaluate(`[...document.querySelectorAll('.curation-form-actions button')].find((button) => button.textContent.includes('노트로 만들기')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent.includes('(스모크)')`), 'Promoting a memo did not open the new claim.', 10000)
  const promoted = await readPublishedNote(path.join(libraryPath, 'Claims', '노이즈 예측은 가중 score matching이다 (스모크).md'))
  assert(promoted.includes('claim_origin: paper') && promoted.includes('^evidence-test-0001-equation-p2-3') && promoted.includes('> [[papers/test.0001/test.0001|Editor fixture]]'), `The promoted claim lost its evidence or source link:\n${promoted}`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('검증 필요 → [[Claims/노이즈 예측은 가중 score matching이다 (스모크)|'), 'The paper note was not marked with the promoted claim link.', 8000)

  // ---------- model suggestions stay behind an explicit setting ----------
  const modelGuard = await notesConnection.evaluate(`window.prism.runModelSuggestions('paper-test.0001').then(() => '', (error) => String(error))`)
  assert(modelGuard.includes('지식 제안 CLI'), `Model suggestions ran without a configured provider: ${modelGuard}`)

  // ---------- citation layer is cache-only under test ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Editor fixture')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.side-citations'))`), 'A paper note did not show the citation layer.', 8000)
  // Nothing fetched means nothing rendered: the header and its refresh button are the whole section.
  assert(await notesConnection.evaluate(`document.querySelectorAll('.side-citations .citation-row').length === 0 && !document.querySelector('.side-citations .citation-meta')`), 'The citation layer fetched without an explicit refresh.')
  assert(await notesConnection.evaluate(`!document.querySelector('.side-citations .side-list') && Boolean(document.querySelector('.side-citations .citation-empty-summary')) && Boolean(document.querySelector('.side-citations .side-refresh')) && document.querySelector('.side-citations').getBoundingClientRect().height < 65`), 'Empty citations occupied more than a compact status row or lost explicit refresh.')

  // ---------- Obsidian navigation keeps native paths ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find((button) => button.getAttribute('aria-label') === '노트 메뉴').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-menu'))`), 'The note menu did not open.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-menu button')].find((button) => button.textContent.includes('Obsidian')).click()`)
  await waitFor(async () => { try { return (await fs.readFile(externalUrlLog, 'utf8')).trim().length > 0 } catch { return false } }, 'Opening Obsidian did not invoke a URI.')
  const obsidianTarget = new URL((await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/)[0]).searchParams.get('path')
  assert(obsidianTarget === notePath, `The Obsidian URI did not preserve the native absolute path: ${obsidianTarget}`)

  // ---------- external change with nothing unsaved: the note follows the disk ----------
  // Prism used to find this out by re-reading the file on a timer; now the main process names the file that
  // moved, so this is what proves an open note still notices Obsidian writing underneath it.
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-save.is-saved'))`), 'The note never reached a saved state before the external write.', 8000)
  // Inspect the end where this external edit will arrive. CodeMirror may omit
  // off-screen lines from the DOM even after its document has updated correctly.
  await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
  await pressKey(notesConnection, 'End', 'End', undoModifier)
  const followLine = '외부 편집기가 조용히 추가한 줄.'
  await fs.writeFile(notePath, `${await fs.readFile(notePath, 'utf8')}\n\n${followLine}\n`, 'utf8')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-body .cm-content')?.textContent.includes(${JSON.stringify(followLine)})`), 'An external change to a clean note never reached the open editor.', 10000)
  assert(!(await notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`)), 'A note with nothing unsaved raised a conflict instead of following the disk.')

  // ---------- external change and conflict resolution ----------
  await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n충돌 테스트 편집.' })
  await sleep(120)
  await fs.writeFile(notePath, `${await fs.readFile(notePath, 'utf8')}\n\n외부 편집기가 추가한 줄.\n`, 'utf8')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'An external change during editing did not raise a conflict.', 10000)
  const conflictShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-conflict.png'), Buffer.from(conflictShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-conflict footer button')].find((button) => button.textContent.includes('내 편집본')).click()`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('충돌 테스트 편집.'), 'Overwriting with my version did not save.', 8000)
  assert(!(await fs.readFile(notePath, 'utf8')).includes('외부 편집기가 추가한 줄.'), 'The conflict resolution kept the discarded disk version.')

  // ---------- the model that writes notes is chosen where the writing happens ----------
  const cliOptions = await notesConnection.evaluate(`JSON.stringify([...document.querySelector('.notes-status .status-model select').options].map((option) => option.value))`)
  assert(JSON.parse(cliOptions)[0] === '' && JSON.parse(cliOptions).length > 1, `The Notes window does not offer a knowledge CLI: ${cliOptions}`)
  assert(!(await notesConnection.evaluate(`Boolean(document.querySelectorAll('.notes-status .status-model select')[1])`)), 'A model list is showing before a CLI has been chosen.')

  // ---------- search ----------
  await setInput(notesConnection, '노트 검색', '역확산')
  // Contextual creation also mentions the concept in the connected paper's
  // preview, so both are legitimate matches. Unrelated notes must disappear.
  await waitFor(() => notesConnection.evaluate(`(() => { const rows = [...document.querySelectorAll('.tree-file')]; return rows.some(row => row.textContent.includes('역확산')) && rows.every(row => row.textContent.includes('역확산')) })()`), 'Typing did not filter the tree to matching titles or previews.')
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="노트 검색"]'); input.focus(); })()`)
  await pressKey(notesConnection, 'Enter', 'Enter')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.tree-folder.is-static')?.textContent.includes('본문 검색')`), 'Enter did not run the semantic search.', 8000)
  await pressKey(notesConnection, 'Escape', 'Escape')

  // ---------- templates remain reachable ----------
  await notesConnection.evaluate(`document.querySelector('.notes-rail button[aria-label="노트 양식"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.template-manager'))`), 'The template manager did not open from the rail.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="템플릿 닫기"]').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.template-manager')`), 'The template manager did not close.')

  // ---------- persisted note history: preview and restore without losing the current version ----------
  // Keep this last: restoring an older document intentionally changes the fixture used above.
  await setInput(notesConnection, '노트 검색', '')
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find(button => button.textContent.includes('Editor fixture')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Editor fixture' && Boolean(document.querySelector('.note-body .cm-content'))`), 'History fixture did not open.')
  const historyOlder = 'HISTORY_OLDER_SENTINEL_9324'
  const historyCurrent = 'HISTORY_CURRENT_SENTINEL_9324'
  for (const sentinel of [historyOlder, historyCurrent]) {
    await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
    await notesConnection.send('Input.insertText', { text: `\n\n${sentinel}\n` })
    await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes(sentinel) && await notesConnection.evaluate(`Boolean(document.querySelector('.note-save.is-saved'))`), 'History fixture edit did not finish saving.', 10000)
  }
  const historyEntries = await notesConnection.evaluate(`(async () => {
    const entries = await window.prism.listNoteHistory('paper-test.0001')
    return Promise.all(entries.map(async entry => ({ ...entry, content: await window.prism.readNoteHistory('paper-test.0001', entry.id) })))
  })()`)
  const restoreIndex = historyEntries.findIndex(entry => entry.content.includes(historyOlder) && !entry.content.includes(historyCurrent))
  assert(restoreIndex >= 0, 'The actual editor saves did not retain a distinct older history snapshot.')
  const restoreContent = historyEntries[restoreIndex].content
  const openHistory = async () => {
    await notesConnection.evaluate(`document.querySelector('.note-doc-actions button[aria-label="노트 메뉴"]').click()`)
    await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-menu'))`), 'Note menu did not open for history.')
    await notesConnection.evaluate(`[...document.querySelectorAll('.note-menu button')].find(button => button.textContent.trim() === '저장 이력').click()`)
    await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-history-preview pre'))`), 'History dialog did not load its readonly preview.', 10000)
  }
  await openHistory()
  assert(await notesConnection.evaluate(`document.querySelectorAll('.note-history-list li button').length`) === historyEntries.length, 'History rows differ from the available persisted versions.')
  assert(await notesConnection.evaluate(`document.querySelector('.note-history-preview pre')?.textContent`) === historyEntries[0].content, 'Default history preview differs from readNoteHistory.')
  assert(await notesConnection.evaluate(`!document.querySelector('.note-history-preview pre').isContentEditable && !document.querySelector('.note-history-dialog .cm-editor')`), 'History preview unexpectedly exposes an editable document.')
  await pressKey(notesConnection, 'Escape', 'Escape')
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.note-history-dialog')`), 'Escape did not close the history dialog.')
  await openHistory()
  await notesConnection.evaluate(`document.querySelectorAll('.note-history-list li button')[${restoreIndex}].click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-history-preview pre')?.textContent === ${JSON.stringify(restoreContent)} && !document.querySelector('.note-history-restore').disabled`), 'Selected history preview did not match its exact stored contents.')
  await notesConnection.evaluate(`document.querySelector('.note-history-restore').click()`)
  await waitFor(async () => {
    const restored = await fs.readFile(notePath, 'utf8')
    return restored.includes(historyOlder) && !restored.includes(historyCurrent) && await notesConnection.evaluate(`!document.querySelector('.note-history-dialog')`)
  }, 'Restoring the selected version did not replace the current document.', 10000)
  assert(await notesConnection.evaluate(`(async () => {
    for (const entry of await window.prism.listNoteHistory('paper-test.0001')) {
      if ((await window.prism.readNoteHistory('paper-test.0001', entry.id)).includes(${JSON.stringify(historyCurrent)})) return true
    }
    return false
  })()`), 'Restoration discarded the version that was current immediately before restoring.')
  process.stdout.write('Persisted history UI passed: real editor versions, exact readonly preview, Escape, selected-version restore, and preservation of the displaced current version.\n')

  // An interrupted publication has no live Markdown file or indexed note to open.
  // Seed only the real transaction journal, then discover and recover it through the UI/IPC.
  const orphanName = 'Unindexed recovery fixture.md'
  const orphanPath = path.join(libraryPath, 'Claims', orphanName)
  const orphanJournal = path.join(libraryPath, 'Claims', '.prism-note-history', 'b18bf099-ef76-472e-9cc4-842c5d192aa1')
  const orphanDraft = '---\ntype: claim\nprism_id: "claim-orphan-history-test"\ntitle: "Unindexed recovery fixture"\n---\n\n# Recovered draft\n\nORPHAN_SELECTED_DRAFT_9324\n'
  const orphanBefore = '# Previous external contents\n\nORPHAN_PREVIOUS_VERSION_9324\n'
  await fs.mkdir(orphanJournal, { recursive: true })
  await fs.writeFile(path.join(orphanJournal, 'metadata.json'), JSON.stringify({ version: 1, state: 'publishing', noteFile: orphanName, createdAt: new Date().toISOString() }))
  await fs.writeFile(path.join(orphanJournal, 'draft.md'), orphanDraft)
  await fs.writeFile(path.join(orphanJournal, 'before.md'), orphanBefore)
  await fs.writeFile(path.join(orphanJournal, 'displaced.md'), orphanBefore)
  assert(!(await fs.stat(orphanPath).then(() => true, () => false)), 'Orphan fixture unexpectedly has a live note before recovery.')
  const pendingOrphan = await notesConnection.evaluate(`(async () => (await window.prism.listPendingNoteRecoveries()).find(entry => entry.noteFile === ${JSON.stringify(orphanName)}))()`)
  assert(pendingOrphan?.kinds.includes('draft'), 'Real IPC did not discover the publishing journal without an existing note.')
  assert(await notesConnection.evaluate(`window.prism.readPendingNoteRecovery(${JSON.stringify(pendingOrphan.id)}, 'draft')`) === orphanDraft, 'Orphan draft IPC preview changed the preserved text.')
  await notesConnection.evaluate('window.__beforeOrphanReload = true')
  await notesConnection.send('Page.reload')
  await waitFor(() => notesConnection.evaluate(`!window.__beforeOrphanReload && Boolean(document.querySelector('.note-recovery-notice button'))`), 'Missing-note recovery notice did not appear without an open document.', 10000)
  assert(!(await fs.stat(orphanPath).then(() => true, () => false)), 'Startup silently restored a publishing-gap note before explicit approval.')
  await notesConnection.evaluate(`document.querySelector('.note-recovery-notice button').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-recovery-dialog pre'))`), 'Orphan recovery dialog failed to load.')
  await notesConnection.evaluate(`(() => {
    const row = [...document.querySelectorAll('.note-recovery-dialog .note-history-list button')].find(button => button.textContent.includes(${JSON.stringify(orphanName)}))
    row.click()
    const select = document.querySelector('.note-recovery-version select')
    select.value = 'draft'; select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-recovery-dialog pre')?.textContent === ${JSON.stringify(orphanDraft)} && !document.querySelector('.note-recovery-dialog .note-history-restore').disabled`), 'Selected orphan draft preview did not match the actual journal.')
  assert(await notesConnection.evaluate(`!document.querySelector('.note-recovery-dialog pre').isContentEditable`), 'Recovery preview must be readonly.')
  await notesConnection.evaluate(`document.querySelector('.note-recovery-dialog .note-history-restore').click()`)
  await waitFor(async () => (await readPublishedNote(orphanPath)) === orphanDraft && await notesConnection.evaluate(`!document.querySelector('.note-recovery-dialog')`), 'Explicit orphan recovery did not restore the exact selected draft.', 10000)
  assert(await fs.readFile(path.join(orphanJournal, 'draft.md'), 'utf8') === orphanDraft && await fs.readFile(path.join(orphanJournal, 'before.md'), 'utf8') === orphanBefore, 'Recovery modified the preserved journal versions.')
  assert(!(await notesConnection.evaluate(`(async () => (await window.prism.listPendingNoteRecoveries()).some(entry => entry.id === ${JSON.stringify(pendingOrphan.id)}))()`)), 'Recovered note remained listed as missing.')
  process.stdout.write('Orphan recovery UI passed: absent unindexed target, publishing journal discovery, exact readonly draft preview, explicit restore, and preserved history.\n')

  // Creating a thought from a paper offers an explicit, reversible association.
  for (const connectPaper of [true, false]) {
    await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes('paper-2401.01234')`)
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Linked Paper Fixture' && Boolean(document.querySelector('.note-body .cm-content'))`), 'Context paper did not open.')
    const paperBeforeCreation = await fs.readFile(linkedNotePath, 'utf8')
    await notesConnection.evaluate(`document.querySelector('.tree-new').click()`)
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.create-paper-link input')?.checked === true && document.querySelector('.create-paper-link')?.textContent.includes('Linked Paper Fixture')`), 'Creation did not show the specific paper association.')
    if (!connectPaper) await notesConnection.evaluate(`document.querySelector('.create-paper-link input').click()`)
    const title = connectPaper ? 'Contextual concept regression' : 'Independent concept regression'
    await notesConnection.evaluate(`document.querySelector('input[aria-label="새 노트 제목"]').select()`)
    await notesConnection.send('Input.insertText', { text: title })
    await notesConnection.evaluate(`document.querySelector('.create-actions .primary').click()`)
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === ${JSON.stringify(title)} && !document.querySelector('.tree-create')`), 'Created note did not open.')
    const edges = await notesConnection.evaluate(`(async () => { const node = (await window.prism.listKnowledgeNodes()).find(node => node.title === ${JSON.stringify(title)}); return window.prism.listKnowledgeRelations(node.id) })()`)
    assert(edges.some(edge => edge.type === 'related' && edge.direction === 'outgoing' && edge.other.id === 'paper-2401.01234') === connectPaper, 'Creation ignored the paper association choice.')
    assert(await fs.readFile(linkedNotePath, 'utf8') === paperBeforeCreation, 'Creating a connected thought modified the source paper Markdown.')
    if (connectPaper) {
      await waitFor(() => notesConnection.evaluate(`document.querySelector('.side-connected')?.textContent.includes('Linked Paper Fixture')`), 'The new note did not offer a readable route back to its paper.')
      await notesConnection.evaluate(`document.querySelector('.side-connected button').click()`)
      await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Linked Paper Fixture'`), 'Connected-note navigation did not return to the paper.')
    }
  }

  // Create a claim directly from an actual saved evidence card. The selected
  // relation must survive creation, and synchronous duplicate activation must
  // not create a second file while the first IPC is pending.
  await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes('paper-test.0001')`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Editor fixture' && Boolean(document.querySelector('.note-body .cm-content'))`), 'Evidence source paper did not reopen.')
  if (!(await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-row')].some(row => row.textContent.includes('denoising score matching'))`))) {
    await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find(button => button.textContent.includes('근거')).click()`)
    await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].some(button => button.textContent.includes('denoising score matching'))`), 'Claim setup evidence was not available.')
    await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].find(button => button.textContent.includes('denoising score matching')).click()`)
    await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.evidence-row')].some(row => row.textContent.includes('denoising score matching'))`), 'Claim setup evidence card was not saved.')
  }
  const evidenceClaimTitle = 'Evidence-derived claim regression'
  const openEvidenceClaimPicker = async () => {
    await notesConnection.evaluate(`(() => { const row = [...document.querySelectorAll('.evidence-row')].find(row => row.textContent.includes('denoising score matching')); row.closest('details').open = true; [...row.querySelectorAll('button')].find(button => button.textContent === '주장에 연결').click() })()`)
    await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('section[aria-label="근거를 연결할 주장 선택"]'))`), 'Evidence-to-claim picker did not open.')
    await setInput(notesConnection, '노트 및 근거 검색', evidenceClaimTitle)
    await notesConnection.evaluate(`[...document.querySelectorAll('nav[aria-label="근거 관계 유형"] button')].find(button => button.textContent === '확장함').click()`)
    assert(await notesConnection.evaluate(`[...document.querySelectorAll('nav[aria-label="근거 관계 유형"] button')].find(button => button.textContent === '확장함').getAttribute('aria-pressed') === 'true'`), 'Evidence relation selection was not retained.')
  }
  await openEvidenceClaimPicker()
  await notesConnection.evaluate(`(() => { const button = [...document.querySelectorAll('.note-picker footer button')].find(button => button.textContent === '이 근거로 주장 만들고 연결'); button.click(); button.click() })()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('section[aria-label="근거를 연결할 주장 선택"]') && document.querySelector('section[aria-label="준비한 주장"]')?.textContent.includes(${JSON.stringify(evidenceClaimTitle)})`), 'Creating an evidence claim did not complete its relation.', 10000)
  const evidenceClaim = await notesConnection.evaluate(`(async () => { const matches = (await window.prism.listKnowledgeNodes()).filter(node => node.nodeType === 'claim' && node.title === ${JSON.stringify(evidenceClaimTitle)}); if (matches.length !== 1) throw new Error('Duplicate evidence claims: ' + matches.length); return matches[0] })()`)
  const evidenceClaimContent = await readPublishedNote(path.join(libraryPath, evidenceClaim.relativePath))
  const originalEvidence = [...evidenceMarkup.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->/g)].map(match => JSON.parse(decodeURIComponent(match[1]))).find(item => item.anchorId === 'sentence-p1-1')
  const claimEvidence = [...evidenceClaimContent.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->/g)].map(match => JSON.parse(decodeURIComponent(match[1]))).find(item => item.anchorId === 'sentence-p1-1')
  assert(originalEvidence && claimEvidence && JSON.stringify(claimEvidence) === JSON.stringify(originalEvidence), 'The new claim changed the exact evidence source, hash, paper identity or location.')
  assert(evidenceClaimContent.includes('# ' + evidenceClaimTitle) && evidenceClaimContent.includes('> ' + originalEvidence.source) && evidenceClaimContent.includes('prism://paper/test.0001?anchor=sentence-p1-1&page=1'), 'The claim body lacks the chosen title, literal source or clickable PDF origin.')
  const checkEvidenceClaimRelation = async () => {
    const links = await notesConnection.evaluate(`window.prism.listKnowledgeRelations('paper-test.0001')`)
    const matching = links.filter(edge => edge.direction === 'outgoing' && edge.other.id === evidenceClaim.id && edge.type === 'extends')
    assert(matching.length === 1 && matching[0].creator === 'user' && matching[0].reviewStatus === 'approved', 'The chosen extends relation was changed, omitted or duplicated.')
    const anchor = matching[0].evidenceAnchor
    assert(anchor?.paperId === 'test.0001' && anchor.anchorId === 'sentence-p1-1' && anchor.page === 1 && anchor.type === 'sentence', 'The saved relation lost the selected evidence anchor.')
  }
  await checkEvidenceClaimRelation()
  // A successfully linked claim is available for review, not offered as a
  // failed operation to retry. Existing targets remain explicitly selectable.
  await openEvidenceClaimPicker()
  assert(await notesConnection.evaluate(`document.querySelector('.note-picker footer')?.textContent.includes('이 주장은 연결했습니다') && !document.querySelector('.note-picker footer button')`), 'A successful claim still offered creation or failure retry.')
  assert(await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button strong')].some(item => item.textContent === ${JSON.stringify(evidenceClaimTitle)})`), 'The created claim was missing from existing targets.')
  assert(await notesConnection.evaluate(`(async () => (await window.prism.listKnowledgeNodes()).filter(node => node.nodeType === 'claim' && node.title === ${JSON.stringify(evidenceClaimTitle)}).length)()`) === 1, 'The completed claim was duplicated after reopening its picker.')
  await checkEvidenceClaimRelation()
  await notesConnection.evaluate(`document.querySelector('.note-picker button[aria-label="선택 닫기"]')?.click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('section[aria-label="준비한 주장"] button')].find(button => button.textContent.startsWith('주장 열기 ·')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === ${JSON.stringify(evidenceClaimTitle)}`), 'The prepared claim could not be opened for review.')
  process.stdout.write('Evidence-to-claim UI passed: typed title, explicit extends relation, exact source/hash/PDF link, duplicate activation guard, completed-claim state and review navigation.\n')

  // Opposing indirect evidence paths must both survive, while their common
  // destination is drawn once. Set up real vault records, then use the graph UI.
  const diamond = await notesConnection.evaluate(`(async () => {
    const made = [];
    for (const title of ['Graph starting claim', 'Supporting path', 'Contradicting path', 'Shared conclusion']) made.push(await window.prism.createKnowledgeNode({nodeType:'claim', title}));
    for (const [from,to,type] of [[0,1,'related'],[0,2,'related'],[1,3,'supports'],[2,3,'contradicts']]) {
      const source = await window.prism.readKnowledgeNode(made[from].id);
      const result = await window.prism.createKnowledgeRelation({sourceId:made[from].id,targetId:made[to].id,type,creator:'user',expectedRevision:source.revision});
      if (!result.saved) throw new Error('Could not prepare graph relation');
    }
    return made.map(node => node.id);
  })()`)
  await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes(${JSON.stringify(diamond[0])})`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Graph starting claim' && document.querySelectorAll('.side-graph .mini-node').length >= 3`), 'The graph fixture did not open.')
  await notesConnection.evaluate(`(() => { const toggle = [...document.querySelectorAll('.side-chips button')].find(button => button.textContent === '간접 연결'); if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click() })()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.side-graph .mini-edge[data-relation="supports"]').length === 1 && document.querySelectorAll('.side-graph .mini-edge[data-relation="contradicts"]').length === 1 && document.querySelectorAll('.side-graph .mini-node').length === 4`), 'The indirect graph lost an opposing path or duplicated its shared destination.')

  // Real high-degree notes use the panel's scroll, not a second 240px viewport.
  await notesConnection.evaluate(`(async () => {
    for (let index = 0; index < 8; index++) {
      const target = await window.prism.createKnowledgeNode({nodeType:'concept',title:'Connected research finding ' + index});
      const source = await window.prism.readKnowledgeNode(${JSON.stringify(diamond[0])});
      const result = await window.prism.createKnowledgeRelation({sourceId:${JSON.stringify(diamond[0])},targetId:target.id,type:'related',creator:'user',expectedRevision:source.revision});
      if (!result.saved) throw new Error('Could not prepare connection list');
    }
  })()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.side-connected .side-list > button').length === 10`), 'The complete connected-note list did not refresh.')
  const connectionGeometry = await notesConnection.evaluate(`(() => { const list = document.querySelector('.side-connected .side-list'); return {height:list.getBoundingClientRect().height,client:list.clientHeight,scroll:list.scrollHeight} })()`)
  assert(connectionGeometry.height > 240 && Math.abs(connectionGeometry.client - connectionGeometry.scroll) <= 1, `Connections were trapped in a nested short viewport: ${JSON.stringify(connectionGeometry)}`)
  await notesConnection.evaluate(`document.querySelector('.side-graph-toggle').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.side-graph .graph-canvas') && localStorage.getItem('prism.notes.graph-expanded') === 'false'`), 'Collapsing the graph did not remove its canvas and remember the preference.')
  await notesConnection.evaluate(`location.reload()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(window.prism && document.querySelector('.notes-rail'))`), 'Notes did not reload for the saved graph preference.')
  await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes(${JSON.stringify(diamond[0])})`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Graph starting claim' && document.querySelectorAll('.side-connected .side-list > button').length === 10`), 'The connected note did not reopen after reload.')
  assert(await notesConnection.evaluate(`document.querySelector('.side-graph-toggle')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('.side-graph .graph-canvas')`), 'The graph preference was lost on renderer reload.')
  await notesConnection.evaluate(`document.querySelector('.side-graph-toggle').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.side-graph .mini-node').length >= 11`), 'The collapsed graph could not be reopened with its current connections.')

  assert(notesConnection.exceptions.length === 0, `Notes renderer exceptions: ${notesConnection.exceptions.join('; ')}`)
  process.stdout.write('Notes UI smoke passed: vault shell (rail, tree, tabs, standing connections panel, status bar), always-live document editing with exact Markdown round-trip, sections the researcher opens on request, single insert affordance, history and native paste, section folding, inline link and evidence autocomplete, evidence cards, frontmatter properties, note creation, claim scope with the contradiction guard, typed relations and the graph, reading-time capture, curation-queue promotion, the model-suggestion guard, the cache-only citation layer, the knowledge CLI chosen in the status bar, Obsidian navigation, external changes that a clean note follows and a dirty one raises as a conflict, search, and templates.\n')
  process.stdout.write(`Screenshots: ${['notes-shell', 'notes-scope-warning', 'notes-graph-panel', 'notes-curation-queue', 'notes-conflict'].map((name) => path.resolve(`tmp/ui/${name}.png`)).join(', ')}\n`)
} catch (error) {
  process.stderr.write(`Notes host output: ${processOutput.slice(-6000)}\n`)
  const historyRoot = path.join(paperPath, '.prism-note-history')
  const historyDiagnostic = await fs.readdir(historyRoot).then(async names => Promise.all(names.slice(-8).map(async name => ({ name, files: await fs.readdir(path.join(historyRoot, name)), metadata: await fs.readFile(path.join(historyRoot, name, 'metadata.json'), 'utf8').catch(String) })))).catch(String)
  process.stderr.write(`Notes history diagnostic: ${JSON.stringify(historyDiagnostic)}\n`)
  const saveDiagnostic = await fs.readdir(historyRoot).then(async names => Promise.all(names.slice(-8).map(async name => ({ name, versions: await Promise.all(['before', 'draft', 'displaced'].map(async kind => ({ kind, containsEdit: (await fs.readFile(path.join(historyRoot, name, `${kind}.md`), 'utf8').catch(() => '')).includes('연구 메모 한 줄.') }))) })))).catch(String)
  process.stderr.write(`Notes save-content diagnostic: ${JSON.stringify({ history: saveDiagnostic, disk: await fs.readFile(notePath, 'utf8').catch(String) })}\n`)
  if (notesConnection) {
    process.stderr.write(`Notes property diagnostic: ${JSON.stringify(await notesConnection.evaluate("[...document.querySelectorAll('.prop-text')].map(el => ({label:el.getAttribute('aria-label'),value:el.value,disabled:el.disabled,focused:el===document.activeElement}))").catch(String))}\n`)
    process.stderr.write(`Claim disk diagnostic: ${await fs.readFile(path.join(libraryPath, 'Claims', '노이즈 예측은 가중 score matching이다.md'), 'utf8').catch(String)}\n`)
    process.stderr.write(`Notes notification diagnostic: ${JSON.stringify(await notesConnection.evaluate("[...document.querySelectorAll('[role=alert], .notes-toast, .note-notice, .notes-notice, .notes-conflict-backdrop')].map(el => el.textContent)").catch(String))}\n`)
    const diagnostic = await notesConnection.evaluate(`(() => ({ title: document.querySelector('.note-doc-title')?.textContent, actions: document.querySelector('.note-doc-actions')?.textContent, body: document.querySelector('.note-body')?.innerText, scroll: [...document.querySelectorAll('.cm-scroller, .note-doc-scroll')].map(el => ({ className: el.className, top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight })) }))()`).catch(String)
    process.stderr.write(`Notes failure diagnostic: ${JSON.stringify(diagnostic)}\n`)
  }
  throw error
} finally {
  if (previousClipboard !== undefined) await writeSystemClipboard(previousClipboard).catch(() => undefined)
  notesConnection?.socket.close()
  mainConnection?.socket.close()
  if (electron.exitCode === null) {
    electron.kill()
    await new Promise((resolve) => electron.once('exit', resolve))
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
