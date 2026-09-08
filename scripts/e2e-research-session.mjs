import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * A full research session against real papers, driven the way a person would drive it:
 * read in the Reader, capture from the PDF, chat about the paper, then open Notes and see what was written.
 * Usage: node scripts/e2e-research-session.mjs <source-library> [port]
 * The source library is copied first — this never writes to the folder you pass in.
 */
const require = createRequire(path.join(process.cwd(), 'package.json'))
const electronPath = require('electron')
const sourceLibrary = path.resolve(process.argv[2] ?? '')
const port = Number(process.argv[3] ?? 9421)
const root = path.join(process.cwd(), 'tmp', 'e2e')
const libraryPath = path.join(root, 'library')
const profile = path.join(root, 'profile')

const findings = []
const note = (area, text) => { findings.push({ area, text }); console.log(`FINDING [${area}] ${text}`) }
const step = (text) => console.log(`\n=== ${text}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- a clean vault: the three papers and nothing else ----------
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(path.join(libraryPath, '.prism'), { recursive: true })
await fs.mkdir(profile, { recursive: true })
const library = JSON.parse(await fs.readFile(path.join(sourceLibrary, '.prism', 'library.json'), 'utf8'))
const papers = []
for (const record of library.slice(0, 3)) {
  const from = path.join(sourceLibrary, 'papers', record.arxivId)
  const to = path.join(libraryPath, 'papers', record.arxivId)
  await fs.mkdir(to, { recursive: true })
  for (const file of ['original.pdf', 'metadata.json', 'anchors.json', 'latex-structure.json', 'translation.ko.json']) {
    await fs.copyFile(path.join(from, file), path.join(to, file)).catch(() => undefined)
  }
  const metadata = JSON.parse(await fs.readFile(path.join(to, 'metadata.json'), 'utf8'))
  // The note is written the way a fresh download writes it: front matter, abstract, nothing else.
  await fs.writeFile(path.join(to, `${record.arxivId}.md`), `---\ntype: paper\nprism_id: "paper-${record.arxivId}"\narxiv_id: "${record.arxivId}"\ntitle: ${JSON.stringify(record.title)}\nstatus: inbox\nreading_status: to_read\nimportance: medium\nconfidence: medium\ncreated_by: user\ntags: [paper, arxiv]\n---\n\n# ${record.title}\n\n> [!abstract]- Abstract\n> ${(metadata.summary ?? record.summary ?? '').replace(/\n/g, '\n> ')}\n\n## 내 생각\n\n## 메모\n`, 'utf8')
  papers.push({ ...record, pdfPath: path.join(to, 'original.pdf'), notePath: path.join(to, `${record.arxivId}.md`), translationPath: path.join(to, 'translation.ko.json') })
}
const anchorsDir = path.join(libraryPath, '.prism', 'anchors')
await fs.mkdir(anchorsDir, { recursive: true })
for (const paper of papers) {
  await fs.copyFile(path.join(sourceLibrary, '.prism', 'anchors', `${paper.arxivId}.json`), path.join(anchorsDir, `${paper.arxivId}.json`)).catch(() => undefined)
}
await fs.writeFile(path.join(libraryPath, '.prism', 'library.json'), JSON.stringify(papers, null, 2), 'utf8')
// No chat history at all: the researcher is starting fresh.
await fs.writeFile(path.join(profile, 'sessions.json'), '[]', 'utf8')
console.log(`Clean vault: ${papers.length} papers, no notes, no chat.`)

// ---------- boot ----------
const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '.'], {
  cwd: process.cwd(), env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let output = ''; electron.stdout.on('data', (c) => { output += c }); electron.stderr.on('data', (c) => { output += c })
async function page(title) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()); const found = pages.find((x) => x.type === 'page' && x.title === title); if (found?.webSocketDebuggerUrl) return found } catch { /* booting */ }
    await sleep(150)
  }
  throw new Error(`no page ${title}\n${output}`)
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl); const pending = new Map(); let seq = 0; const errors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Runtime.exceptionThrown') { errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text); return }
    if (!message.id) return
    const callback = pending.get(message.id); if (!callback) return
    pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result)
  })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const send = (method, params = {}) => { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) }) }
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  await send('Runtime.enable'); await send('Page.enable')
  return { socket, send, evaluate, errors, shot: async (name) => { const data = await send('Page.captureScreenshot', { format: 'png' }); await fs.mkdir(path.resolve('tmp/ui'), { recursive: true }); await fs.writeFile(path.resolve('tmp/ui', name), Buffer.from(data.data, 'base64')); console.log(`  saved tmp/ui/${name}`) } }
}
async function waitFor(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check().catch(() => false)) return true; await sleep(250) }
  throw new Error(message)
}
const readNote = (arxivId) => fs.readFile(path.join(libraryPath, 'papers', arxivId, `${arxivId}.md`), 'utf8')

let reader; let notes
try {
  reader = await connect(await page('Prism'))
  await reader.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  step('1. Reader: open the first paper and capture while reading')
  await waitFor(() => reader.evaluate(`document.querySelectorAll('.paper-tree button').length >= 3`), 'the library tree did not list three papers')
  const treeTitles = await reader.evaluate(`JSON.stringify([...document.querySelectorAll('.paper-tree button')].map((b) => b.textContent.trim().slice(0, 40)))`)
  console.log('  library:', treeTitles)
  await reader.evaluate(`document.querySelector('.paper-tree button').click()`)
  // The sentence overlay is the normal way in. If it never paints, the run still has to exercise the notes
  // side, so it falls back to the same IPC the capture panel calls and records the overlay failure as a finding.
  const overlayReady = await waitFor(() => reader.evaluate(`document.querySelectorAll('.anchor-layer span').length > 20`), 'no overlay', 90000).catch(() => false)
  const firstPaper = await reader.evaluate(`(async () => { const state = await window.prism.listLibrary(); return state[0].arxivId })()`)
  console.log('  reading', firstPaper, overlayReady ? '(sentence overlay ready)' : '(no sentence overlay)')
  await sleep(1000)
  if (!overlayReady) {
    const detail = await reader.evaluate(`JSON.stringify({ canvases: document.querySelectorAll('canvas').length, layers: document.querySelectorAll('.anchor-layer').length, rendered: document.querySelectorAll('.continuous-page.rendered').length, blocks: document.querySelectorAll('.translated-block').length })`)
    note('reader', 'No clickable sentence appeared over the PDF within 90s, so a reader right-click cannot capture anything: ' + detail)
    await reader.shot('e2e-1-reader-no-overlay.png')
    const fallback = await reader.evaluate(`(async () => {
      const paper = (await window.prism.listLibrary())[0];
      const anchors = (await window.prism.listEvidenceAnchors()).filter((item) => item.paperId === paper.arxivId);
      const target = anchors.find((item) => item.type === 'text' && (item.source ?? '').length > 60) ?? anchors[12];
      await window.prism.capturePaperNote({ kind: 'evidence', paperId: paper.arxivId, anchorId: target.anchorId, memo: '이 문장이 핵심 주장 같다. 나중에 확인.', concept: 'Attention' });
      return JSON.stringify({ anchor: target.label, page: target.page });
    })()`)
    console.log('  captured through the same IPC the panel calls:', fallback)
  } else {
    // Right-click a sentence, write a one-line memo, and name the concept it defines.
    await reader.evaluate(`(() => { const spans = [...document.querySelectorAll('.anchor-layer span')]; const target = spans.find((s) => s.getBoundingClientRect().top > 260 && s.getBoundingClientRect().width > 90) ?? spans[12]; target.scrollIntoView({ block: 'center' }); target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); })()`)
    await waitFor(() => reader.evaluate(`Boolean(document.querySelector('.reader-capture input'))`), 'the capture panel did not open on right-click')
    await reader.evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const memo = document.querySelector('.reader-capture input[aria-label="노트 메모"]');
      setter.call(memo, '이 문장이 핵심 주장 같다. 나중에 확인.'); memo.dispatchEvent(new Event('input', { bubbles: true }));
      const concept = document.querySelector('.reader-capture input[aria-label="정의하는 개념"]');
      setter.call(concept, 'Attention'); concept.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await reader.shot('e2e-1-reader-capture.png')
    await reader.evaluate(`document.querySelector('.reader-capture button[type="submit"]').click()`)
    await waitFor(() => reader.evaluate(`document.querySelector('.reader-capture-status')?.textContent.includes('담았습니다')`), 'the capture did not report success')
    console.log('  capture said:', await reader.evaluate(`document.querySelector('.reader-capture-status')?.textContent`))
  }
  const afterCapture = await readNote(firstPaper)
  if (!afterCapture.includes('이 문장이 핵심 주장 같다')) note('capture', 'The memo did not reach the paper note.')
  if (!afterCapture.includes('[!evidence]')) note('capture', 'No evidence card was written for the captured sentence.')

  step('2. Chat about the paper (recorded the way the composer records it)')
  // The chat CLI is not available in a test run, so the exchange is written through the app's own session store.
  const chat = await reader.evaluate(`(async () => {
    const sessions = await window.prism.loadSessions();
    const paper = (await window.prism.listLibrary())[0];
    const anchors = (await window.prism.listEvidenceAnchors()).filter((a) => a.paperId === paper.arxivId);
    const eq = anchors.find((a) => a.type === 'equation') ?? anchors[3];
    const ref = { paperId: eq.paperId, paperTitle: eq.paperTitle, anchorId: eq.anchorId, type: eq.type, page: eq.page, label: eq.label, source: eq.source };
    const now = Date.now();
    sessions.push({ id: 'e2e', title: '읽으며 질문', provider: 'codex', model: 'test', createdAt: now, updatedAt: now, messages: [
      { id: 'm1', role: 'user', text: '이 수식이 왜 이렇게 되는지 모르겠어요', createdAt: now, anchors: [ref], paperIds: [paper.arxivId] },
      { id: 'm2', role: 'assistant', text: '분모의 스케일링 때문입니다.', createdAt: now + 1, paperIds: [paper.arxivId] },
      { id: 'm3', role: 'user', text: '스케일링이 왜 필요한지 아직 이해가 안 됩니다', createdAt: now + 2, anchors: [ref], paperIds: [paper.arxivId] },
      { id: 'm4', role: 'user', text: '이 방법이 기존 방식이랑 무슨 차이인가요?', createdAt: now + 3, paperIds: [paper.arxivId] },
    ] });
    await window.prism.saveSessions(sessions);
    return JSON.stringify({ anchor: ref.label, page: ref.page });
  })()`)
  console.log('  chat referenced', chat)

  step('3. Notes: open the paper and see what was written for me')
  await reader.evaluate('window.prism.openNotes()')
  notes = await connect(await page('Prism Notes'))
  await notes.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false })
  await waitFor(() => notes.evaluate(`document.querySelectorAll('.tree-folder').length >= 4`), 'the tree did not show every node type')
  const folders = await notes.evaluate(`JSON.stringify([...document.querySelectorAll('.tree-folder')].map((f) => f.textContent))`)
  console.log('  folders:', folders)
  await notes.evaluate(`[...document.querySelectorAll('.tree-file')].find((b) => b.textContent.includes(${JSON.stringify(papers[0].title.slice(0, 14))}))?.click()`)
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.note-doc-title h1'))`), 'the paper note did not open')
  await waitFor(async () => (await readNote(firstPaper)).includes('prism:auto overview'), 'the digest did not run when the note opened', 30000)
  await sleep(1500)
  await notes.shot('e2e-2-notes-digest.png')
  const digested = await readNote(firstPaper)
  const section = (name) => digested.match(new RegExp(`<!-- prism:auto ${name} -->([\\s\\S]*?)<!-- /prism:auto ${name} -->`))?.[1].trim() ?? ''
  console.log('  한눈에:', section('overview').split('\n')[0]?.slice(0, 90))
  console.log('  헷갈린 것:', section('confusion').replace(/\n/g, ' | ').slice(0, 140))
  console.log('  주목한 것:', section('focus').replace(/\n/g, ' | ').slice(0, 140))
  if (!section('overview')) note('digest', 'The summary section is empty right after opening.')
  if (section('confusion').startsWith('_')) note('digest', 'Chat happened but the confusion section stayed a placeholder.')
  if (section('focus').startsWith('_')) note('digest', 'An anchor was referenced in chat but the focus section stayed a placeholder.')

  step('4. Write the only part that is mine')
  await notes.evaluate(`(() => { const scroller = document.querySelector('.note-doc-scroll'); scroller.scrollTop = scroller.scrollHeight })()`)
  await sleep(400)
  // Use the affordance a real reader has: the '내 생각 쓰기' button under the body.
  const hasButton = await notes.evaluate(`Boolean(document.querySelector('.note-write-mine'))`)
  if (!hasButton) note('writing', 'There is no visible way to jump to my own section.')
  await notes.evaluate(`document.querySelector('.note-write-mine').click()`)
  await sleep(400)
  // Where the caret sits is what matters; read it from the DOM selection rather than editor internals.
  const landed = await notes.evaluate(`(() => {
    const selection = window.getSelection()
    if (!selection || !selection.anchorNode) return JSON.stringify({ caret: null })
    const node = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement
    const line = node && node.closest('.cm-line')
    const all = [...document.querySelectorAll('.note-body .cm-line')]
    const index = line ? all.indexOf(line) : -1
    return JSON.stringify({ caret: line ? line.textContent : null, previous: index > 0 ? all[index - 1].textContent : null, inEditor: Boolean(line) })
  })()`)
  console.log('  cursor landed:', landed)
  const cursor = JSON.parse(landed)
  if (!cursor.inEditor) note('writing', '내 생각 쓰기 did not put the caret in the note body: ' + landed)
  else if (!(cursor.previous ?? '').includes('내 생각') && !(cursor.caret ?? '').includes('내 생각')) note('writing', '내 생각 쓰기 put the caret somewhere else: ' + landed)
  await notes.send('Input.insertText', { text: '\n스케일링은 결국 분산을 맞추는 트릭이라고 이해했다. [[Attention]]과 이어짐.\n' })
  await waitFor(async () => (await readNote(firstPaper)).includes('분산을 맞추는 트릭'), 'my own sentence was not saved', 15000)
  await waitFor(() => notes.evaluate(`[...document.querySelectorAll('.rel-chip')].some((c) => c.textContent.includes('Attention'))`), 'the [[link]] did not become a relation', 20000)
  await sleep(800)
  await notes.shot('e2e-3-my-thought.png')
  const withThought = await readNote(firstPaper)
  const userAt = withThought.indexOf('분산을 맞추는 트릭')
  const autoEnd = withThought.lastIndexOf('<!-- /prism:auto')
  if (userAt < autoEnd) note('layout', 'My sentence landed above the generated sections instead of in my own section.')
  console.log('  graph nodes:', await notes.evaluate(`document.querySelectorAll('.side-graph .graph-node').length`))

  step('5. The queue turns the reading memo into a claim')
  await notes.evaluate(`document.querySelector('.notes-rail button[aria-label="정리 대기열"]').click()`)
  await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.curation-queue'))`), 'the curation queue did not open')
  await sleep(1200)
  await notes.shot('e2e-4-queue.png')
  const queue = await notes.evaluate(`(async () => JSON.stringify(await window.prism.listCurationQueue()))()`)
  const parsedQueue = JSON.parse(queue)
  console.log('  queue:', JSON.stringify({ memos: parsedQueue.memos.length, stubs: parsedQueue.stubs.length, pending: parsedQueue.pendingRelations.length, total: parsedQueue.total }))
  if (!parsedQueue.memos.length) note('queue', 'The captured memo is not offered for promotion.')
  const memoRow = await notes.evaluate(`Boolean([...document.querySelectorAll('.curation-item')].find((item) => item.textContent.includes('핵심 주장 같다')))`)
  if (!memoRow) note('queue', 'The memo row is missing from the queue view.')
  else {
    await notes.evaluate(`[...document.querySelectorAll('.curation-item')].find((item) => item.textContent.includes('핵심 주장 같다')).querySelector('.curation-actions button').click()`)
    await waitFor(() => notes.evaluate(`Boolean(document.querySelector('.curation-form input[aria-label="승격 노트 제목"]'))`), 'promotion did not open its title form')
    await notes.evaluate(`(() => { const input = document.querySelector('.curation-form input[aria-label="승격 노트 제목"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '스케일드 닷프로덕트가 분산을 안정화한다'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await notes.evaluate(`[...document.querySelectorAll('.curation-form-actions button')].find((b) => b.textContent.includes('승격하기')).click()`)
    await waitFor(() => notes.evaluate(`document.querySelector('.note-doc-title h1')?.textContent.includes('분산을 안정화')`), 'the promoted claim did not open', 20000)
    await sleep(800)
    await notes.shot('e2e-5-promoted-claim.png')
    const claims = await fs.readdir(path.join(libraryPath, 'Claims')).catch(() => [])
    console.log('  claims folder:', claims.join(', '))
  }

  step('6. Second paper: does the note stay quiet when there is no chat?')
  await notes.evaluate(`[...document.querySelectorAll('.tree-file')].find((b) => b.textContent.includes(${JSON.stringify(papers[1].title.slice(0, 14))}))?.click()`)
  await waitFor(() => notes.evaluate(`document.querySelector('.note-doc-title h1')?.textContent.includes(${JSON.stringify(papers[1].title.slice(0, 10))})`), 'the second paper note did not open')
  await waitFor(async () => (await readNote(papers[1].arxivId)).includes('prism:auto overview'), 'the second note was not digested', 25000)
  await sleep(1200)
  await notes.shot('e2e-6-second-paper.png')
  const second = await readNote(papers[1].arxivId)
  const secondConfusion = second.match(/<!-- prism:auto confusion -->([\s\S]*?)<!-- \/prism:auto confusion -->/)?.[1].trim() ?? ''
  console.log('  second paper confusion:', secondConfusion.slice(0, 80))
  if (!secondConfusion.startsWith('_')) note('digest', 'A paper with no chat still claims the reader was confused about something.')

  step('7. Vault contents after one session')
  const walk = async (dir, prefix = '') => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const out = []
    for (const entry of entries) {
      if (entry.name === 'source' || entry.name === 'figures' || entry.name === 'index' || entry.name === 'cache') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...await walk(full, `${prefix}${entry.name}/`))
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) out.push(`${prefix}${entry.name}`)
    }
    return out
  }
  const files = await walk(libraryPath)
  console.log('  vault files:\n   ', files.filter((f) => !f.startsWith('papers/') || f.endsWith('.md')).join('\n    '))
  const relations = await fs.readdir(path.join(libraryPath, '.prism', 'relations')).catch(() => [])
  console.log('  relations:', relations.length)
  for (const file of relations) {
    const record = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'relations', file), 'utf8'))
    console.log(`    ${record.type} ${record.origin ?? 'manual'} ${record.sourceId} -> ${record.targetId}`)
  }

  step('8. Renderer errors')
  console.log('  reader:', JSON.stringify(reader.errors.slice(0, 3)))
  console.log('  notes:', JSON.stringify(notes.errors.slice(0, 3)))
  if (reader.errors.length) note('runtime', `Reader logged ${reader.errors.length} exception(s).`)
  if (notes.errors.length) note('runtime', `Notes logged ${notes.errors.length} exception(s).`)

  console.log(`\n=== FINDINGS: ${findings.length}`)
  for (const item of findings) console.log(` - [${item.area}] ${item.text}`)
  console.log(`\nFinal note (${firstPaper}):\n${'-'.repeat(60)}\n${(await readNote(firstPaper)).slice(0, 2600)}\n${'-'.repeat(60)}`)
} finally {
  notes?.socket.close(); reader?.socket.close()
  if (electron.exitCode === null) { electron.kill(); await new Promise((resolve) => electron.once('exit', resolve)) }
}
