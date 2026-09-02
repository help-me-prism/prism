const port = Number(process.env.PRISM_DEBUG_PORT ?? process.argv[2] ?? 9223)
const action = process.argv[3]
const value = process.argv[4] ?? ''

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const page = pages.find((candidate) => candidate.type === 'page' && /Prism/i.test(candidate.title)) ?? pages.find((candidate) => candidate.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error(`No Electron page found on port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let sequence = 0
socket.addEventListener('message', (event) => {
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
function send(method, params = {}) {
  sequence += 1
  return new Promise((resolve, reject) => {
    pending.set(sequence, { resolve, reject })
    socket.send(JSON.stringify({ id: sequence, method, params }))
  })
}

if (action === 'click-label') {
  const encoded = JSON.stringify(value)
  await send('Runtime.evaluate', { expression: `(() => { const element = [...document.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === ${encoded}); if (!element) throw new Error('Button not found'); element.click(); return true })()` })
} else if (action === 'click-text') {
  const encoded = JSON.stringify(value)
  await send('Runtime.evaluate', { expression: `(() => { const element = [...document.querySelectorAll('button')].find((candidate) => candidate.innerText.trim() === ${encoded}); if (!element) throw new Error('Button not found'); element.click(); return true })()` })
} else if (action === 'fill-label') {
  const [label, text] = value.split('=', 2)
  if (!label || text === undefined) throw new Error('fill-label expects label=value')
  const encodedLabel = JSON.stringify(label)
  const encodedText = JSON.stringify(text)
  await send('Runtime.evaluate', { expression: `(() => { const element = [...document.querySelectorAll('input, textarea')].find((candidate) => candidate.getAttribute('aria-label') === ${encodedLabel}); if (!element) throw new Error('Field not found'); const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(element, ${encodedText}); element.dispatchEvent(new Event('input', { bubbles: true })); return true })()` })
} else if (action === 'press') {
  const key = value
  const keyCode = key === 'Escape' ? 27 : key === 'Enter' ? 13 : key === 'Tab' ? 9 : 0
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
} else {
  throw new Error(`Unknown action: ${action}`)
}

await new Promise((resolve) => setTimeout(resolve, 120))
socket.close()
