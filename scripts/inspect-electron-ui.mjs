import fs from 'node:fs/promises'
import path from 'node:path'

const port = Number(process.env.PRISM_DEBUG_PORT ?? process.argv[2] ?? 9223)
const outputPath = path.resolve(process.argv[3] ?? 'tmp/ui/prism.png')
const requestedTitle = process.argv[4]

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`Electron debug endpoint returned ${response.status}`)
  return response.json()
})
const page = (requestedTitle ? pages.find((candidate) => candidate.type === 'page' && candidate.title === requestedTitle) : undefined)
  ?? pages.find((candidate) => candidate.type === 'page' && candidate.title === 'Prism')
  ?? pages.find((candidate) => candidate.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error(`No Electron page found on port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
const consoleEntries = []
let sequence = 0

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const callback = pending.get(message.id)
    if (callback) {
      pending.delete(message.id)
      if (message.error) callback.reject(new Error(message.error.message))
      else callback.resolve(message.result)
    }
    return
  }
  if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown') consoleEntries.push(message)
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function send(method, params = {}) {
  sequence += 1
  return new Promise((resolve, reject) => {
    pending.set(sequence, { resolve, reject })
    socket.send(JSON.stringify({ id: sequence, method, params }))
  })
}

await send('Page.enable')
await send('Runtime.enable')
await send('Runtime.evaluate', { expression: 'window.moveTo(0, 0); window.resizeTo(screen.availWidth, screen.availHeight)' })
await new Promise((resolve) => setTimeout(resolve, 250))
const evaluation = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    bodyText: document.body.innerText.slice(0, 12000),
    buttons: [...document.querySelectorAll('button')].map((element) => ({
      text: element.innerText.trim(),
      label: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      disabled: element.disabled,
    })),
    inputs: [...document.querySelectorAll('input, textarea, select')].map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type'),
      placeholder: element.getAttribute('placeholder'),
      label: element.getAttribute('aria-label'),
      disabled: element.disabled,
    })),
    landmarks: [...document.querySelectorAll('main, nav, aside, header')].map((element) => ({
      tag: element.tagName.toLowerCase(),
      label: element.getAttribute('aria-label'),
      className: element.className,
    })),
  })`,
  returnByValue: true,
})
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, Buffer.from(screenshot.data, 'base64'))
socket.close()

const summary = JSON.parse(evaluation.result.value)
summary.consoleEntries = consoleEntries.map((entry) => ({ method: entry.method, params: entry.params }))
summary.screenshot = outputPath
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
