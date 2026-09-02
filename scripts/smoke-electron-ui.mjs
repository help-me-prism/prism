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
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_WINDOW_SIZE: '1040x680' },
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
const securityWarnings = []
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
    if (message.method === 'Runtime.consoleAPICalled') {
      const rendered = (message.params.args ?? []).map((argument) => argument.value ?? argument.description ?? '').join(' ')
      if (rendered.includes('Insecure Content-Security-Policy')) securityWarnings.push(rendered)
    }
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
    viewport: { width: innerWidth, height: innerHeight },
  }))()`)
  assert(initial.dialog === 'paper-finder-title', 'The first-run paper finder is not exposed as a dialog.')
  assert(initial.activeLabel === 'arXiv 논문 검색어', 'The paper search field did not receive initial focus.')
  assert(!initial.fatal, 'The renderer displayed the fatal error screen.')
  assert(initial.viewport.width === 1040 && initial.viewport.height === 680, `Minimum window size was not applied: ${initial.viewport.width}x${initial.viewport.height}`)

  await press('Escape', 27)
  assert(await evaluate(`!document.querySelector('.paper-finder')`), 'Escape did not close the paper finder.')
  assert(await evaluate(`document.querySelector('.repository-card').compareDocumentPosition(document.querySelector('.sidebar-actions')) & Node.DOCUMENT_POSITION_FOLLOWING`), 'The current library card was not placed above the open-paper button.')
  assert(await evaluate(`document.querySelector('.repository-card strong')?.textContent`) === 'library', 'The current library card did not show the configured repository name.')

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
  await evaluate(`document.querySelector('.trash-heading button').click()`)
  assert(await evaluate(`document.querySelectorAll('.trash-item').length`) === 1, 'Deleted chat was not kept in the trash.')
  await evaluate(`document.querySelector('.undo-toast button').click()`)
  await sleep(100)
  assert(await evaluate(`document.querySelectorAll('.session-item').length`) === 2, 'Undo did not restore the deleted chat.')
  assert(await evaluate(`document.querySelectorAll('.trash-item').length`) === 0, 'Undo left a duplicate chat in the trash.')

  const sampleSessions = [{
    id: 'visual-chat', title: '확산 모델 수식 설명', provider: 'codex', model: 'gpt-5.6-sol', createdAt: Date.now(), updatedAt: Date.now(),
    messages: [
      ...Array.from({ length: 7 }, (_, index) => ({ id: `history-${index}`, role: index % 2 ? 'assistant' : 'user', text: index % 2 ? `이전 답변 ${index}: 문맥을 확인했습니다.` : `이전 질문 ${index}`, createdAt: Date.now() - 20_000 + index })),
      { id: 'sample-user', role: 'user', text: '이 수식과 표의 의미를 함께 설명해줘', createdAt: Date.now() - 2, anchors: [{ paperId: '2006.11239', paperTitle: 'Denoising Diffusion Probabilistic Models', anchorId: 'p2-eq1', type: 'equation', page: 2, label: '수식2', source: 'p_theta(x_{t-1} | x_t)', placementId: 'sample-placement-equation', textOffset: 2 }, { paperId: '2006.11239', paperTitle: 'Denoising Diffusion Probabilistic Models', anchorId: 'p3-table1', type: 'table', page: 3, label: '표1', source: '\\begin{tabular}{lc} model & score \\\\ DDPM & 0.91 \\end{tabular}', placementId: 'sample-placement-table', textOffset: 6 }] },
      { id: 'sample-assistant', role: 'assistant', createdAt: Date.now() - 1, anchors: [{ paperId: '2006.11239', paperTitle: 'Denoising Diffusion Probabilistic Models', anchorId: 'p2-eq1', type: 'equation', page: 2, label: '수식2', source: 'p_theta(x_{t-1} | x_t)' }, { paperId: '2006.11239', paperTitle: 'Denoising Diffusion Probabilistic Models', anchorId: 'p3-table1', type: 'table', page: 3, label: '표1', source: '\\begin{tabular}{lc} model & score \\\\ DDPM & 0.91 \\end{tabular}' }], text: '## 역확산 과정\n\n[@수식2]는 잡음이 섞인 샘플에서 한 단계 더 깨끗한 샘플을 예측하는 **역확산 전이**입니다. [@표1]은 비교 결과를 원본 표 구조로 제공합니다.\n\n\\[p_\\theta(x_{t-1}\\mid x_t)=\\mathcal{N}(x_{t-1};\\mu_\\theta(x_t,t),\\Sigma_\\theta(x_t,t))\\]\n\n인라인 수식 \\(x_t\\)도 렌더링합니다.\n\n- 평균은 신경망이 예측합니다.\n- 분산은 복원 과정의 불확실성을 나타냅니다.\n\n| 항목 | 의미 |\n|---|---|\n| $x_t$ | 현재 잡음 샘플 |\n| $x_{t-1}$ | 복원된 샘플 |' },
    ],
  }]
  await evaluate(`window.prism.saveSessions(${JSON.stringify(sampleSessions)})`)
  await send('Page.reload', { ignoreCache: true })
  await sleep(600)
  await press('Escape', 27)
  assert(await evaluate(`document.querySelector('.message-body h2')?.textContent`) === '역확산 과정', 'Markdown heading was not rendered.')
  assert(await evaluate(`Boolean(document.querySelector('.message-body .katex'))`), 'Math was not rendered with KaTeX.')
  assert(await evaluate(`document.querySelectorAll('.message-body .katex').length >= 3`), 'Bracket-delimited display and inline math were not rendered with KaTeX.')
  assert(await evaluate(`Boolean(document.querySelector('.message-body table'))`), 'Markdown table was not rendered.')
  assert(await evaluate(`Boolean(document.querySelector('.message.user .message-body .type-equation'))`), 'The user reference was not rendered inline with a type icon.')
  assert(await evaluate(`Boolean(document.querySelector('.message.user .message-body .type-table'))`), 'The table reference was not rendered inline with a type icon.')
  const placedUserText = await evaluate(`[...document.querySelectorAll('.message.user .message-body')].find((body) => body.querySelector('.type-equation'))?.textContent`)
  assert(placedUserText.indexOf('수식2') < placedUserText.indexOf('수식과') && placedUserText.indexOf('표1') < placedUserText.indexOf('표의'), `Placed references did not remain at their sentence offsets: ${placedUserText}`)
  await evaluate(`(() => {
    const editor = document.querySelector('.composer-editor')
    editor.focus()
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    editor.textContent = '한'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한', inputType: 'insertCompositionText', isComposing: true }))
    editor.textContent = '한글'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: '글', inputType: 'insertCompositionText', isComposing: true }))
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글' }))
    return true
  })()`)
  await sleep(150)
  assert(await evaluate(`document.querySelector('.composer-editor')?.textContent`) === '한글', 'Korean IME composition was interrupted by a controlled-editor rerender.')
  await evaluate(`(() => { const editor = document.querySelector('.composer-editor'); editor.textContent = ''; editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); return true })()`)
  await evaluate(`(() => { const pane = document.querySelector('.messages'); pane.scrollTop = 0; pane.dispatchEvent(new Event('scroll', { bubbles: true })); return true })()`)
  await sleep(100)
  assert(await evaluate(`Boolean(document.querySelector('.jump-latest'))`), 'Scrolling up did not pause chat follow mode.')
  await evaluate(`document.querySelector('.jump-latest').click()`)
  await sleep(350)
  await send('Page.enable')
  const visual = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const visualPath = path.join(process.cwd(), 'tmp', 'ui', 'chat-markdown.png')
  await fs.mkdir(path.dirname(visualPath), { recursive: true }); await fs.writeFile(visualPath, Buffer.from(visual.data, 'base64'))

  assert(exceptions.length === 0, `Renderer exceptions were reported: ${exceptions.join('; ')}`)
  assert(securityWarnings.length === 0, 'Electron reported an insecure Content Security Policy.')
  process.stdout.write('Electron UI smoke passed: onboarding, settings, trash, Markdown, inline references, Korean IME, and paused follow mode.\n')
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
