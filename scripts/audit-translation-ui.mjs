import fs from 'node:fs/promises'
import path from 'node:path'

const port = Number(process.argv[2] ?? 9348)
const outputPath = path.resolve(process.argv[3] ?? 'tmp/ui/translation-audit.json')
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const page = pages.find((candidate) => candidate.type === 'page' && candidate.title === 'Prism')
if (!page?.webSocketDebuggerUrl) throw new Error(`Prism page not found on port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map(); let sequence = 0
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data)); if (!message.id) return
  const callback = pending.get(message.id); if (!callback) return
  pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result)
})
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
function send(method, params = {}) { sequence += 1; return new Promise((resolve, reject) => { pending.set(sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params })) }) }

const expression = `(async () => {
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const modeButtons = [...document.querySelectorAll('.document-mode button')]
  if (!document.querySelector('.continuous-page.translated')) { modeButtons.find((button) => button.textContent.includes('병기'))?.click(); await wait(300) }
  const scrollPanes = [...document.querySelectorAll('.document-scroll')]
  scrollPanes.forEach((pane) => { pane.style.scrollBehavior = 'auto' })
  const goToPage = async (target) => {
    for (const pane of scrollPanes) {
      const page = pane.querySelector('.continuous-page[data-page$="-' + target + '"]')
      if (page) pane.scrollTop = Math.max(0, page.offsetTop - 18)
    }
    await wait(180)
  }
  await goToPage(1)
  const total = document.querySelectorAll('.continuous-page.translated').length; const results = []
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    await goToPage(pageNumber)
    let page = document.querySelector('[data-page=translated-' + pageNumber + ']')
    const deadline = Date.now() + 4000
    while (page && !page.classList.contains('rendered') && Date.now() < deadline) { await wait(80); page = document.querySelector('[data-page=translated-' + pageNumber + ']') }
    if (!page) { results.push({ page: pageNumber, missing: true }); continue }
    const pageRect = page.getBoundingClientRect(); const structures = [...page.querySelectorAll('.structure-anchor-layer > *')].map((element) => {
      const rect = element.getBoundingClientRect(); return { type: element.className, x: rect.left - pageRect.left, y: rect.top - pageRect.top, width: rect.width, height: rect.height }
    })
    const blocks = [...page.querySelectorAll('.translated-block')].map((element, index) => {
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); const text = element.innerText ?? ''
      const local = { x: rect.left - pageRect.left, y: rect.top - pageRect.top, width: rect.width, height: rect.height }
      const overlaps = structures.filter((structure) => {
        const width = Math.max(0, Math.min(local.x + local.width, structure.x + structure.width) - Math.max(local.x, structure.x))
        const height = Math.max(0, Math.min(local.y + local.height, structure.y + structure.height) - Math.max(local.y, structure.y))
        return width * height > Math.min(local.width * local.height, structure.width * structure.height) * .08
      }).map((structure) => structure.type)
      return {
        index, kind: [...element.classList].find((name) => name !== 'translated-block'), text: text.slice(0, 240), ...local,
        fontSize: Number.parseFloat(style.fontSize), scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
        rawLatexArtifact: /<latexit|sha1_base64|AA[A-Z0-9+/]{20,}|\\u0000|\u0000!/.test(text),
        overflow: element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2,
        verticalRisk: text.length > 18 && local.width < 45 && local.height > local.width * 1.6,
        outsidePage: local.x < -1 || local.y < -1 || local.x + local.width > pageRect.width + 1 || local.y + local.height > pageRect.height + 1,
        overlaps,
      }
    })
    results.push({ page: pageNumber, rendered: page.classList.contains('rendered'), width: pageRect.width, height: pageRect.height, structures: structures.length, blocks })
  }
  return { title: document.querySelector('.paper-title-mini strong')?.textContent, paper: document.querySelector('.paper-title-mini small')?.textContent, pages: results }
})()`
const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
const audit = response.result.value
await fs.mkdir(path.dirname(outputPath), { recursive: true }); await fs.writeFile(outputPath, JSON.stringify(audit, null, 2))
const summary = audit.pages.map((entry) => ({
  page: entry.page, rendered: entry.rendered, blocks: entry.blocks?.length ?? 0,
  raw: entry.blocks?.filter((block) => block.rawLatexArtifact).length ?? 0,
  overflow: entry.blocks?.filter((block) => block.overflow).length ?? 0,
  vertical: entry.blocks?.filter((block) => block.verticalRisk).length ?? 0,
  outside: entry.blocks?.filter((block) => block.outsidePage).length ?? 0,
  structureOverlap: entry.blocks?.filter((block) => block.overlaps.length).length ?? 0,
}))
process.stdout.write(`${audit.title}\n${JSON.stringify(summary, null, 2)}\nSaved ${outputPath}\n`)
socket.close()
