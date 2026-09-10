import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : null
if (!executablePath) throw new Error('Usage: node scripts/smoke-packaged-launch.mjs <executable>')
await fs.access(executablePath)

const port = 9437
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-packaged-smoke-'))
const libraryPath = path.join(temporaryRoot, 'library')
const profilePath = path.join(temporaryRoot, 'profile')
await fs.mkdir(libraryPath, { recursive: true })

const child = spawn(executablePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_WINDOW_SIZE: '1040x680' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let processOutput = ''
child.stdout.on('data', (chunk) => { processOutput += chunk })
child.stderr.on('data', (chunk) => { processOutput += chunk })

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function waitForPage() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = pages.find((candidate) => candidate.type === 'page' && /Prism/i.test(candidate.title))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* The portable executable may still be unpacking. */ }
    await sleep(200)
  }
  throw new Error(`Packaged Prism did not expose its renderer page.\n${processOutput}`)
}

let socket
try {
  const page = await waitForPage()
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let requestId = 0
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId
    const timeout = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error(`Timed out: ${method}`)) }, 10000)
    const receive = event => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timeout); socket.removeEventListener('message', receive)
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result)
    }
    socket.addEventListener('message', receive)
    socket.send(JSON.stringify({ id, method, params }))
  })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await request('Runtime.evaluate', { expression: `Boolean(document.querySelector(".app-shell:not(.loading-app) .reader-empty")) && Array.from(document.fonts).some(font => font.family.includes("Pretendard") && font.status === "loaded")`, returnByValue: true })
    if (result.result?.value === true) { ready = true; break }
    await sleep(200)
  }
  if (!ready) throw new Error('Packaged app did not finish rendering its first-use screen and UI font')
  socket.send(JSON.stringify({ id: ++requestId, method: 'Browser.close' }))
  console.log(`Packaged launch passed: ${path.basename(executablePath)} rendered its first-use screen with the bundled UI font.`)
} finally {
  socket?.close()
  if (child.exitCode === null) child.kill()
  await sleep(500)
  const resolvedRoot = path.resolve(temporaryRoot)
  if (!resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep + 'prism-packaged-smoke-')) throw new Error('Unexpected smoke-test cleanup path')
  await fs.rm(resolvedRoot, { recursive: true, force: true }).catch(() => {})
}
