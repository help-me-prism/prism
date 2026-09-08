import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Talks to an already-running Prism (started with --remote-debugging-port) so a session can be driven
 * step by step from the shell instead of by one scripted run.
 *
 *   node scripts/cdp.mjs <port> <window> eval "<expression>"
 *   node scripts/cdp.mjs <port> <window> shot <file.png>
 *   node scripts/cdp.mjs <port> <window> click "<css>"
 *   node scripts/cdp.mjs <port> <window> type "<text>"
 *   node scripts/cdp.mjs <port> <window> key <Key>
 *   node scripts/cdp.mjs <port> list
 *
 * <window> matches the page title: "Prism" is the reader, "Prism Notes" the notes window.
 */
const [portValue, windowTitle, command, ...rest] = process.argv.slice(2)
const port = Number(portValue)
const argument = rest.join(' ')

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
if (windowTitle === 'list') {
  console.log(pages.filter((page) => page.type === 'page').map((page) => page.title).join('\n'))
  process.exit(0)
}
const target = pages.find((page) => page.type === 'page' && page.title === windowTitle)
if (!target) { console.error(`no window titled ${windowTitle}; open ones: ${pages.filter((p) => p.type === 'page').map((p) => p.title).join(', ')}`); process.exit(1) }

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map(); let seq = 0; const logs = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') { logs.push(`EXCEPTION ${message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text}`); return }
  const resolve = pending.get(message.id)
  if (resolve) { pending.delete(message.id); resolve(message) }
})
await new Promise((resolve) => socket.addEventListener('open', resolve))
const send = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
await send('Runtime.enable')
const evaluate = async (code) => {
  const response = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
  if (response.result?.exceptionDetails) return `THREW ${response.result.exceptionDetails.exception?.description}`
  return response.result?.result?.value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (command === 'eval') console.log(JSON.stringify(await evaluate(argument)))
else if (command === 'shot') {
  const data = await send('Page.captureScreenshot', { format: 'png' })
  await fs.mkdir(path.resolve('tmp/ui'), { recursive: true })
  await fs.writeFile(path.resolve('tmp/ui', argument), Buffer.from(data.result.data, 'base64'))
  console.log(`tmp/ui/${argument}`)
} else if (command === 'click') {
  console.log(JSON.stringify(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(argument)}); if (!el) return 'no element'; el.click(); return 'clicked ' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40) })()`)))
} else if (command === 'type') {
  await send('Input.insertText', { text: argument })
  console.log('typed')
} else if (command === 'key') {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: argument, code: argument, windowsVirtualKeyCode: argument === 'Enter' ? 13 : argument === 'Backspace' ? 8 : 0 })
  console.log('pressed')
} else if (command === 'wait') { await sleep(Number(argument) || 1000); console.log('waited') }
else { console.error('unknown command'); process.exit(1) }

if (logs.length) console.log('--- exceptions ---\n' + logs.join('\n'))
process.exit(0)
