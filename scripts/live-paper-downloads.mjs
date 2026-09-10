import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9341
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-live-papers-'))
const keepDownloadedPapers = process.env.PRISM_KEEP_LIVE_PAPERS === '1'
const libraryPath = path.join(temporaryRoot, 'library')
const profilePath = path.join(temporaryRoot, 'profile')
await fs.mkdir(libraryPath, { recursive: true })

const cases = [
  { field: '생명과학 · CRISPR', query: '10.1126/science.1225829', id: 'doi:10.1126/science.1225829' },
  { field: '인공지능 · Transformer', query: '1706.03762', id: '1706.03762' },
  { field: '컴퓨터 비전 · ResNet', query: '1512.03385', id: '1512.03385' },
  { field: '입자물리 · Higgs', query: '1207.7214', id: '1207.7214' },
  { field: '의학 · COVID-19 치료', query: '10.1056/NEJMoa2021436', id: 'doi:10.1056/nejmoa2021436' },
  { field: '기후경제 · 불평등', query: '10.1073/pnas.1816020116', id: 'doi:10.1073/pnas.1816020116' },
]

const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, '.'], {
  cwd: process.cwd(),
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let processOutput = ''
electron.stdout.on('data', chunk => { processOutput += chunk })
electron.stderr.on('data', chunk => { processOutput += chunk })
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForPage() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
      const page = pages.find(candidate => candidate.type === 'page' && /Prism/i.test(candidate.title))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* Electron is starting. */ }
    await sleep(150)
  }
  throw new Error(`Electron did not expose the Prism page.\n${processOutput}`)
}

let socket
let sequence = 0
const pending = new Map()
function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

async function inspectPdf(record) {
  const bytes = new Uint8Array(await fs.readFile(record.pdfPath))
  const byteLength = bytes.byteLength
  const standardFontDataUrl = `${path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts').replaceAll('\\', '/')}/`
  const loadingTask = getDocument({ data: bytes, disableWorker: true, standardFontDataUrl })
  const document = await loadingTask.promise
  const pages = document.numPages
  let extractedCharacters = 0
  const pageCharacters = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const characters = content.items.reduce((sum, item) => sum + ('str' in item ? item.str.length : 0), 0)
    extractedCharacters += characters
    pageCharacters.push(characters)
  }
  await loadingTask.destroy()
  let structuredBlocks = 0
  for (const filename of ['latex-structure.json', 'jats-structure.json']) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(path.dirname(record.pdfPath), filename), 'utf8'))
      structuredBlocks = Math.max(structuredBlocks, Array.isArray(parsed.blocks) ? parsed.blocks.length : 0)
    } catch { /* This provider did not offer a structured source. */ }
  }
  return { bytes: byteLength, pages, extractedCharacters, pageCharacters, structuredBlocks }
}

try {
  const page = await waitForPage()
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
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
  await send('Runtime.enable')

  const report = []
  for (const item of cases) {
    const result = await evaluate(`(async () => {
      const papers = await window.prism.searchPapers(${JSON.stringify(item.query)})
      const paper = papers.find(candidate => candidate.arxivId.toLowerCase() === ${JSON.stringify(item.id.toLowerCase())}) ?? papers[0]
      if (!paper) return { error: '검색 결과 없음', count: papers.length, candidates: papers.slice(0, 5).map(candidate => candidate.arxivId) }
      if (!paper.pdfUrl) return { error: 'PDF 링크 없음', count: papers.length, paper, candidates: papers.slice(0, 5).map(candidate => candidate.arxivId), arxivCandidates: await window.prism.searchArxiv(${JSON.stringify(item.query)}).then(items => items.slice(0, 5).map(candidate => candidate.arxivId)).catch(error => [String(error)]) }
      try { return { count: papers.length, paper, record: await window.prism.downloadPaper(paper) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error), count: papers.length, paper } }
    })()`)
    if (result.error) report.push({ field: item.field, query: item.query, found: result.paper?.title, candidates: result.candidates, arxivCandidates: result.arxivCandidates, error: result.error })
    else report.push({ field: item.field, query: item.query, title: result.record.title, id: result.record.arxivId, source: result.record.source ?? 'arxiv', structured: result.record.structuredSourceFormat ?? (result.record.sourcePath ? 'latex' : 'none'), ...await inspectPdf(result.record) })
  }
  console.log(JSON.stringify(report, null, 2))
  if (keepDownloadedPapers) console.log(`PRESERVED_PAPER_ROOT=${temporaryRoot}`)
  if (report.some(item => item.error)) throw new Error(`Live paper failures: ${report.filter(item => item.error).map(item => `${item.field}: ${item.error}`).join('; ')}`)
  if (report.some(item => item.extractedCharacters < 100)) throw new Error('At least one downloaded PDF did not expose a useful text layer.')
} finally {
  try { socket?.close() } catch { /* no-op */ }
  electron.kill()
  await new Promise(resolve => electron.once('exit', resolve))
  if (!keepDownloadedPapers) await fs.rm(temporaryRoot, { recursive: true, force: true })
}
