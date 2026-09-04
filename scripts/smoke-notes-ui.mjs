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
  { id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching.' },
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

async function pressKey(connection, key, code, modifiers = 0) {
  const windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'End' ? 35 : 0
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
// Property text fields commit on blur, the way a document field should.
async function setPropertyText(connection, label, value) {
  await connection.evaluate(`(() => {
    const field = document.querySelector('.prop-text[aria-label="' + ${JSON.stringify(label)} + '"]');
    if (!field) throw new Error('missing property field');
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.blur();
  })()`)
}
const chooseSelect = (connection, label, value) => setField(connection, 'select', label, value, 'change')

try {
  mainConnection = await connect(await waitForPage('Prism'))
  await mainConnection.evaluate('window.prism.openNotes()')
  notesConnection = await connect(await waitForPage('Prism Notes'))
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
  assert(shellState.folders.includes('papers'), `The tree did not group nodes by folder: ${shell}`)
  assert(shellState.side, 'The connections panel is not visible by default.')
  assert(shellState.status.includes('노드 2'), `The status bar did not count nodes: ${shell}`)
  assert(shellState.modes === 0, 'A retired mode bar or knowledge modal is still rendered.')

  // ---------- opening a note ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Editor fixture')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent === 'Editor fixture'`), 'Clicking a tree row did not open the note.')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-body .cm-md-h1'))`), 'The document did not render Markdown as a live document.')
  const opened = await notesConnection.evaluate(`JSON.stringify({
    tabs: [...document.querySelectorAll('.notes-tab')].map((tab) => tab.textContent.replace(/\\s+/g, ' ').trim()),
    props: [...document.querySelectorAll('.note-props td:first-child')].map((cell) => cell.textContent),
    frontmatterHidden: [...document.querySelectorAll('.note-body .cm-md-frontmatter')].every((line) => getComputedStyle(line).display === 'none'),
    reader: Boolean([...document.querySelectorAll('.note-doc-actions button')].find((button) => button.textContent.includes('리더에서 열기'))),
  })`)
  const openedState = JSON.parse(opened)
  assert(openedState.tabs.length === 1 && openedState.tabs[0].includes('Editor fixture'), `The note did not open in a tab: ${opened}`)
  assert(openedState.props.includes('유형') && openedState.props.includes('상태') && openedState.props.includes('읽기'), `The properties table is missing paper rows: ${opened}`)
  assert(openedState.frontmatterHidden, 'Live editing exposed raw frontmatter.')
  assert(openedState.reader, 'A paper note did not offer to open the Reader.')
  await notesConnection.send('Page.captureScreenshot', { format: 'png' }).then(async (shot) => { await fs.mkdir(path.resolve('tmp/ui'), { recursive: true }); await fs.writeFile(path.resolve('tmp/ui/notes-shell.png'), Buffer.from(shot.data, 'base64')) })

  // ---------- editing round-trips exact Markdown and autosaves ----------
  await notesConnection.evaluate(`document.querySelector('.note-body .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n연구 메모 한 줄.' })
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('연구 메모 한 줄.'), 'Autosave did not write the edit to disk.', 8000)
  const roundTrip = await fs.readFile(notePath, 'utf8')
  assert(roundTrip.startsWith('---\ntype: paper') && roundTrip.includes('> [!note] Evidence') && roundTrip.includes('| Item | Value |') && roundTrip.includes('<!-- keep-this-comment -->'), `Editing rewrote untouched Markdown:\n${roundTrip}`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-save')?.textContent.includes('저장됨')`), 'The save indicator stayed busy after autosave.', 8000)

  // Unresolved [[links]] become inbox concept stubs once editing settles.
  await waitFor(async () => { try { await fs.stat(path.join(libraryPath, 'Concepts', 'Score matching.md')); return true } catch { return false } }, 'An unresolved wiki link did not become an inbox concept stub.', 12000)
  assert((await fs.readFile(path.join(libraryPath, 'Concepts', 'Score matching.md'), 'utf8')).includes('status: inbox'), 'The generated stub is not an inbox concept.')
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].some((button) => button.classList.contains('is-stub') && button.textContent.includes('Score matching'))`), 'The new stub did not appear in the tree as a stub.', 8000)

  // ---------- block insertion through the single insert affordance ----------
  await notesConnection.evaluate(`document.querySelector('.note-hint button').click()`)
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
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.note-body .cm-content').textContent.includes('실행 취소 확인 문장')`), `${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Z did not undo the edit.`)
  await pressKey(notesConnection, 'z', 'KeyZ', undoModifier | 8)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-body .cm-content').textContent.includes('실행 취소 확인 문장')`), 'Shift+Z did not redo the edit.')
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
  await notesConnection.evaluate(`document.querySelector('.cm-section-fold-toggle')?.click()`)

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
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].find((button) => button.textContent.includes('denoising score matching')).click()`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('^evidence-test-0001-sentence-p1-1'), 'Choosing an anchor did not insert an evidence card.', 8000)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.note-evidence .evidence-row').length >= 1`), 'The evidence list did not show the inserted card.')
  const evidenceMarkup = await fs.readFile(notePath, 'utf8')
  assert(evidenceMarkup.includes('> [!evidence] 문장 · Editor fixture · p.1 · 문장1') && evidenceMarkup.includes('prism://paper/test.0001?anchor=sentence-p1-1'), 'The evidence card lost its Obsidian-readable form.')

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
  await notesConnection.evaluate(`document.querySelector('.prop-add button').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-picker .picker-types'))`), 'The relation picker did not open.')
  const relationChoices = await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-types button')].map((button) => button.textContent)`)
  assert(JSON.stringify(relationChoices) === JSON.stringify(['사용함', '지지함', '반박함', '확장함', '질문 제기', '답함']), `The claim relation picker offered the wrong model: ${JSON.stringify(relationChoices)}`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-types button')].find((button) => button.textContent === '반박함').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-picker .picker-list button')].find((button) => button.textContent.includes('청크가 길면')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-scope-warning')?.textContent.includes('도메인이 다릅니다')`), 'Contradicting claims with different scope did not warn.')
  const scopeShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-scope-warning.png'), Buffer.from(scopeShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-scope-warning button')].find((button) => button.textContent.includes('그래도')).click()`)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.rel-chip')].some((chip) => chip.textContent.includes('청크가 길면'))`), 'The confirmed contradiction did not appear as a relation chip.', 8000)
  assert((await fs.readFile(claimPath, 'utf8')).includes('> [!abstract] 관계 · 반박함'), 'The approved relation was not written as readable Markdown.')
  const relationRecords = await Promise.all((await fs.readdir(path.join(libraryPath, '.prism', 'relations'))).map(async (file) => JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'relations', file), 'utf8'))))
  assert(relationRecords.some((record) => record.type === 'contradicts' && record.creator === 'user' && record.reviewStatus === 'approved' && record.targetId === secondClaim), 'The relation sidecar did not record the user contradiction.')

  // ---------- graph and backlinks in the standing panel ----------
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.side-graph .graph-node').length >= 2`), 'The connections graph did not draw the new edge.')
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.side-graph .graph-edge.contra'))`), 'A contradiction was not drawn as a contradiction edge.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.side-chips button')].find((button) => button.textContent === '2홉').click()`)
  await sleep(400)
  const graphShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-graph-panel.png'), Buffer.from(graphShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Score matching')).click()`)
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.side-links .side-row-title')].some((row) => row.textContent.includes('Editor fixture'))`), 'The backlink panel did not show the note that links here.', 8000)

  // ---------- reading-time capture reaches the paper note ----------
  const captureResult = await notesConnection.evaluate(`window.prism.capturePaperNote({ kind: 'evidence', paperId: 'test.0001', anchorId: 'equation-p2-3', memo: '노이즈 예측은 score matching이다 — 검증 필요' })`)
  assert(captureResult.blockId === 'evidence-test-0001-equation-p2-3', `Reader capture did not return the evidence block id: ${JSON.stringify(captureResult)}`)
  await notesConnection.evaluate(`window.prism.capturePaperNote({ kind: 'chat', paperId: 'test.0001', question: '이 목적함수는 왜 가중 score matching인가?', answer: '첫 줄\\n\\n둘째 줄', provider: 'codex', model: 'smoke-model' })`)
  const captured = await fs.readFile(notePath, 'utf8')
  assert(captured.includes('검증 필요') && captured.includes('> [!ai]- AI 답변') && captured.includes('<!-- prism-ai-answer:'), `Capture did not land in the paper note:\n${captured}`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Editor fixture')).click()`)
  // CodeMirror only renders the visible slice, so scroll to where the capture landed.
  await waitFor(async () => {
    await notesConnection.evaluate(`(() => { const scroller = document.querySelector('.note-doc-scroll'); if (scroller) scroller.scrollTop = scroller.scrollHeight })()`)
    return notesConnection.evaluate(`document.querySelector('.note-body .cm-content')?.textContent.includes('검증 필요')`)
  }, 'The open note did not reload the externally captured memo.', 10000)

  // ---------- curation queue: promote a memo into a claim ----------
  await notesConnection.evaluate(`document.querySelector('.notes-rail button[aria-label="정리 대기열"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.curation-queue')) && document.querySelector('.curation-queue')?.textContent.includes('검증 필요')`), 'The curation queue did not list the captured memo.', 10000)
  const queueShot = await notesConnection.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.resolve('tmp/ui/notes-curation-queue.png'), Buffer.from(queueShot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.curation-item')].find((item) => item.textContent.includes('검증 필요')).querySelector('.curation-actions button').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.curation-form input[aria-label="승격 노트 제목"]'))`), 'Choosing promotion did not open the title form.')
  await setInput(notesConnection, '승격 노트 제목', '노이즈 예측은 가중 score matching이다 (스모크)')
  await notesConnection.evaluate(`[...document.querySelectorAll('.curation-form-actions button')].find((button) => button.textContent.includes('승격하기')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.note-doc-title h1')?.textContent.includes('(스모크)')`), 'Promoting a memo did not open the new claim.', 10000)
  const promoted = await fs.readFile(path.join(libraryPath, 'Claims', '노이즈 예측은 가중 score matching이다 (스모크).md'), 'utf8')
  assert(promoted.includes('claim_origin: paper') && promoted.includes('^evidence-test-0001-equation-p2-3') && promoted.includes('> [[papers/test.0001/test.0001|Editor fixture]]'), `The promoted claim lost its evidence or source link:\n${promoted}`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('검증 필요 → [[Claims/노이즈 예측은 가중 score matching이다 (스모크)|'), 'The paper note was not marked with the promoted claim link.', 8000)

  // ---------- model suggestions stay behind an explicit setting ----------
  const modelGuard = await notesConnection.evaluate(`window.prism.runModelSuggestions('paper-test.0001').then(() => '', (error) => String(error))`)
  assert(modelGuard.includes('지식 제안 CLI'), `Model suggestions ran without a configured provider: ${modelGuard}`)

  // ---------- citation layer is cache-only under test ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].find((button) => button.textContent.includes('Editor fixture')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.side-citations'))`), 'A paper note did not show the citation layer.', 8000)
  assert(await notesConnection.evaluate(`document.querySelector('.side-citations .side-empty')?.textContent.includes('새로고침')`), 'The citation layer fetched without an explicit refresh.')

  // ---------- Obsidian navigation keeps native paths ----------
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-doc-actions button')].find((button) => button.getAttribute('aria-label') === '노트 메뉴').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.note-menu'))`), 'The note menu did not open.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.note-menu button')].find((button) => button.textContent.includes('Obsidian')).click()`)
  await waitFor(async () => { try { return (await fs.readFile(externalUrlLog, 'utf8')).trim().length > 0 } catch { return false } }, 'Opening Obsidian did not invoke a URI.')
  const obsidianTarget = new URL((await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/)[0]).searchParams.get('path')
  assert(obsidianTarget === notePath, `The Obsidian URI did not preserve the native absolute path: ${obsidianTarget}`)

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

  // ---------- search ----------
  await setInput(notesConnection, '노트 검색', '역확산')
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.tree-file')].length === 1 && document.querySelector('.tree-file').textContent.includes('역확산')`), 'Typing did not filter the tree.')
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="노트 검색"]'); input.focus(); })()`)
  await pressKey(notesConnection, 'Enter', 'Enter')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.tree-folder.is-static')?.textContent.includes('의미 검색')`), 'Enter did not run the semantic search.', 8000)
  await pressKey(notesConnection, 'Escape', 'Escape')

  // ---------- templates remain reachable ----------
  await notesConnection.evaluate(`document.querySelector('.notes-rail button[aria-label="노트 양식"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.template-manager'))`), 'The template manager did not open from the rail.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="템플릿 닫기"]').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.template-manager')`), 'The template manager did not close.')

  assert(notesConnection.exceptions.length === 0, `Notes renderer exceptions: ${notesConnection.exceptions.join('; ')}`)
  process.stdout.write('Notes UI smoke passed: vault shell (rail, tree, tabs, standing connections panel, status bar), always-live document editing with exact Markdown round-trip, single insert affordance, history and native paste, section folding, inline link and evidence autocomplete, evidence cards, frontmatter properties, note creation, claim scope with the contradiction guard, typed relations and the graph, reading-time capture, curation-queue promotion, the model-suggestion guard, the cache-only citation layer, Obsidian navigation, conflict resolution, search, and templates.\n')
  process.stdout.write(`Screenshots: ${['notes-shell', 'notes-scope-warning', 'notes-graph-panel', 'notes-curation-queue', 'notes-conflict'].map((name) => path.resolve(`tmp/ui/${name}.png`)).join(', ')}\n`)
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
