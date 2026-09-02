import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9323
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-ui-smoke-'))
const libraryPath = path.join(temporaryRoot, 'library')
const profilePath = path.join(temporaryRoot, 'profile')
await fs.mkdir(libraryPath, { recursive: true })

const electron = spawn(electronPath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  '.',
], {
  cwd: process.cwd(),
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let processOutput = ''
electron.stdout.on('data', (chunk) => { processOutput += chunk })
electron.stderr.on('data', (chunk) => { processOutput += chunk })

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
async function waitForPage() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = pages.find((candidate) => candidate.type === 'page' && /Prism/i.test(candidate.title))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* Electron is still starting. */ }
    await sleep(120)
  }
  throw new Error(`Electron did not expose the Prism page.\n${processOutput}`)
}

let socket
const pending = new Map()
const exceptions = []
let sequence = 0
function send(method, params = {}) {
  sequence += 1
  return new Promise((resolve, reject) => {
    pending.set(sequence, { resolve, reject })
    socket.send(JSON.stringify({ id: sequence, method, params }))
  })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
async function press(key, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
  await sleep(100)
}
function assert(condition, message) { if (!condition) throw new Error(message) }

try {
  const page = await waitForPage()
  socket = new WebSocket(page.webSocketDebuggerUrl)
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
  await send('Runtime.enable')
  await sleep(250)

  const initial = await evaluate(`(() => ({
    dialog: document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby'),
    activeLabel: document.activeElement?.getAttribute('aria-label'),
    fatal: Boolean(document.querySelector('.fatal-error')),
  }))()`)
  assert(initial.dialog === 'paper-finder-title', 'The first-run paper finder is not exposed as a dialog.')
  assert(initial.activeLabel === 'arXiv 논문 검색어', 'The paper search field did not receive initial focus.')
  assert(!initial.fatal, 'The renderer displayed the fatal error screen.')

  await press('Escape', 27)
  assert(await evaluate(`!document.querySelector('.paper-finder')`), 'Escape did not close the paper finder.')

  await evaluate(`document.querySelector('button[aria-label="설정"]').click()`)
  await sleep(100)
  const settings = await evaluate(`(() => ({
    title: document.querySelector('.app-settings h2')?.textContent,
    providers: document.querySelectorAll('.provider-list > div').length,
  }))()`)
  assert(settings.title === 'Prism 설정', 'The settings button did not open the settings dialog.')
  assert(settings.providers >= 2, 'The settings dialog did not show CLI provider status.')
  await press('Escape', 27)

  await evaluate(`document.querySelector('button[aria-label="새 대화"]').click()`)
  await sleep(100)
  assert(await evaluate(`document.querySelectorAll('.session-item').length`) === 2, 'Creating a second chat failed.')
  await evaluate(`document.querySelector('.delete-session:not(:disabled)').click()`)
  await sleep(100)
  assert(await evaluate(`Boolean(document.querySelector('.undo-toast'))`), 'Deleting a chat did not offer undo.')
  await evaluate(`document.querySelector('.undo-toast button').click()`)
  await sleep(100)
  assert(await evaluate(`document.querySelectorAll('.session-item').length`) === 2, 'Undo did not restore the deleted chat.')

  assert(exceptions.length === 0, `Renderer exceptions were reported: ${exceptions.join('; ')}`)
  process.stdout.write('Electron UI smoke passed: onboarding, keyboard close, settings, and undo.\n')
} finally {
  socket?.close()
  electron.kill()
  if (electron.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => electron.once('exit', resolve)),
      sleep(2_000),
    ])
  }
  const resolvedTemporaryRoot = path.resolve(temporaryRoot)
  if (resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedTemporaryRoot).startsWith('prism-ui-smoke-')) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true }); break }
      catch (error) {
        if (!['EBUSY', 'EPERM'].includes(error?.code) || attempt === 9) throw error
        await sleep(100 * (attempt + 1))
      }
    }
  }
}
