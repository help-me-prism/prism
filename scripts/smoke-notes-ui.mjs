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
const paperPath = path.join(libraryPath, 'papers', 'test.0001')
const notePath = path.join(paperPath, 'test.0001.md')
const initialNote = `---
type: paper
title: "Editor fixture"
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
await fs.mkdir(path.join(libraryPath, '.prism', 'anchors'), { recursive: true })
await fs.mkdir(path.join(paperPath, 'figures'), { recursive: true })
await fs.writeFile(notePath, initialNote, 'utf8')
await fs.writeFile(path.join(libraryPath, '.prism', 'anchors', 'test.0001.json'), JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [
  { id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching.' },
  { id: 'equation-p2-3', type: 'equation', page: 2, source: 'L_simple = E[||epsilon - epsilon_theta(x_t,t)||^2]' },
  { id: 'table-p3-1', type: 'table', page: 3, source: 'Model | FID\nDDPM | 3.17' },
] }, null, 2), 'utf8')
await fs.writeFile(path.join(paperPath, 'figures', 'figure-p4-1.json'), JSON.stringify({ figureId: 'figure-p4-1', paperId: 'test.0001', page: 4, caption: 'Overview of the reverse diffusion process.' }, null, 2), 'utf8')
await fs.writeFile(path.join(libraryPath, '.prism', 'library.json'), JSON.stringify([{
  arxivId: 'test.0001', title: 'Editor fixture', authors: ['Prism'], summary: 'Fixture', published: '2026-09-02', updated: '2026-09-02', categories: ['cs.HC'], pdfUrl: '', absUrl: '', pdfPath: path.join(paperPath, 'original.pdf'), notePath, translationPath: path.join(paperPath, 'translation.ko.json'), downloadedAt: Date.now(),
}], null, 2), 'utf8')

const electron = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, '.'], {
  cwd: process.cwd(),
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1' },
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

let mainConnection
let notesConnection
try {
  mainConnection = await connect(await waitForPage('Prism'))
  await mainConnection.evaluate('window.prism.openNotes()')
  notesConnection = await connect(await waitForPage('Prism Notes'))
  await sleep(400)

  assert(await notesConnection.evaluate(`document.querySelector('.notes-modebar button.active')?.textContent.includes('Live Edit')`), 'Live Edit was not the default mode.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.getAttribute('aria-label')`) === 'Editor fixture Markdown 노트', 'CodeMirror editor was not accessible.')
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.cm-live-edit .cm-md-h1'))`), 'Live Edit did not present Markdown as a styled document.')
  assert(await notesConnection.evaluate(`document.querySelectorAll('.notes-block-tools button').length`) === 11, 'The block toolbar did not expose every supported block command.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="개인 템플릿 관리"]').click()`)
  await sleep(350)
  assert(await notesConnection.evaluate(`document.querySelectorAll('.template-manager-body aside > div > button').length`) === 5, 'The five starter templates were not created.')
  assert((await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md')).length === 5, 'Starter templates were not stored as Markdown files.')
  for (const directory of ['00 Inbox', 'Papers', 'Concepts', 'Claims', 'Insights', 'Questions', 'Projects', 'Templates', 'Assets']) assert((await fs.stat(path.join(libraryPath, directory))).isDirectory(), `Vault directory was not created: ${directory}`)

  const templateScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const templateScreenshotPath = path.resolve('tmp/ui/notes-templates.png')
  await fs.mkdir(path.dirname(templateScreenshotPath), { recursive: true })
  await fs.writeFile(templateScreenshotPath, Buffer.from(templateScreenshot.data, 'base64'))

  await notesConnection.evaluate(`document.querySelector('.template-new').click()`)
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="템플릿 이름"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '나의 주장 검토'); input.dispatchEvent(new Event('input', { bubbles: true })); const select = document.querySelector('select[aria-label="템플릿 노트 유형"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(select, 'claim'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await replaceEditor(notesConnection, '# {{title}}\n\n## 나의 근거\n', '.template-editor .cm-content')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await sleep(350)
  let templateFiles = (await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md'))
  assert(templateFiles.length === 6, 'A personal template was not created.')
  const customTemplateName = templateFiles.find((name) => name.startsWith('나의 주장 검토'))
  assert(customTemplateName, 'The personal template Markdown file was not named as expected.')
  const customTemplatePath = path.join(libraryPath, 'Templates', customTemplateName)
  const customTemplate = await fs.readFile(customTemplatePath, 'utf8')
  assert(customTemplate.includes('node_type: claim') && customTemplate.includes('## 나의 근거'), 'The personal template did not preserve frontmatter and Markdown content.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('복제')).click()`)
  await sleep(350)
  templateFiles = (await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md'))
  assert(templateFiles.length === 7, 'Template duplication did not create a Markdown copy.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('기본값')).click()`)
  await sleep(250)
  const defaults = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'template-defaults.json'), 'utf8'))
  assert(typeof defaults.claim === 'string' && defaults.claim.startsWith('claim-'), 'The default template selection was not persisted.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.trim() === '삭제').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('삭제 확인')).click()`)
  await sleep(350)
  assert((await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md')).length === 6, 'Template deletion did not remove the active file.')
  assert((await fs.readdir(path.join(libraryPath, '.prism', 'trash', 'templates'))).length === 1, 'Deleted templates were not recoverably moved to trash.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager-body aside > div > button')].find((button) => button.textContent.includes('Paper - Deep review')).click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.trim() === '삭제').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('삭제 확인')).click()`)
  await sleep(350)
  assert(!(await fs.readdir(path.join(libraryPath, 'Templates'))).includes('Paper - Deep review.md'), 'A deleted starter template was recreated during refresh.')
  assert((await fs.readdir(path.join(libraryPath, '.prism', 'trash', 'templates'))).length === 2, 'Deleted starter templates were not moved to trash.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="템플릿 닫기"]').click()`)
  await sleep(700)
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.template-manager'))`), 'The template manager did not close.')
  assert(await notesConnection.evaluate(`document.querySelectorAll('.cm-content').length`) === 1, 'The template editor remained mounted after closing.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="연구 지식 관리"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-create'))`), 'The empty knowledge workspace did not show its creation form.')
  assert(await notesConnection.evaluate(`document.querySelectorAll('select[aria-label="새 지식 노트 유형"] option').length`) === 5, 'The knowledge creator did not expose every supported node type.')
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="새 지식 노트 유형"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(select, 'claim'); select.dispatchEvent(new Event('change', { bubbles: true })); const input = document.querySelector('input[aria-label="새 지식 노트 제목"]'); const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; inputSetter.call(input, '노이즈 예측은 score matching이다'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(150)
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-create button')].find((button) => button.textContent.includes('노트 만들기')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'A Claim knowledge note was not opened after creation.')
  const claimPath = path.join(libraryPath, 'Claims', '노이즈 예측은 score matching이다.md')
  await waitFor(async () => { try { return (await fs.readFile(claimPath, 'utf8')).includes('type: claim') } catch { return false } }, 'The Claim was not stored as Markdown in the Claims folder.')
  let claimMarkdown = await fs.readFile(claimPath, 'utf8')
  assert(claimMarkdown.includes('prism_id: "claim-') && claimMarkdown.includes('template_id:') && claimMarkdown.includes('# 노이즈 예측은 score matching이다'), 'The generated Claim did not retain identity, template, and rendered title metadata.')
  const createdTypes = await notesConnection.evaluate(`(async () => {
    const inputs = [['paper', '수동 Paper 노트'], ['concept', 'Reverse diffusion'], ['insight', '목적함수 연결 아이디어'], ['question', '가중치는 품질에 어떤 영향을 주는가']];
    const results = [];
    for (const [nodeType, title] of inputs) results.push(await window.prism.createKnowledgeNode({ nodeType, title }));
    return results.map((result) => result.id);
  })()`)
  assert(createdTypes.length === 4, 'The remaining knowledge node types were not created through the public IPC contract.')
  for (const [folder, file] of [['Papers', '수동 Paper 노트.md'], ['Concepts', 'Reverse diffusion.md'], ['Insights', '목적함수 연결 아이디어.md'], ['Questions', '가중치는 품질에 어떤 영향을 주는가.md']]) assert((await fs.stat(path.join(libraryPath, folder, file))).isFile(), `${folder} node was not stored in its Markdown folder.`)

  async function chooseKnowledgeProperty(label, value, expectedLine) {
    await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes(expectedLine), `The ${label} property was not saved.`)
  }
  await chooseKnowledgeProperty('지식 노트 상태', 'established', 'status: established')
  await chooseKnowledgeProperty('지식 노트 중요도', 'high', 'importance: high')
  await chooseKnowledgeProperty('지식 노트 확신도', 'low', 'confidence: low')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="지식 링크 추가"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-link-picker'))`), 'The knowledge link picker did not open.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-link-picker > div > button')].find((button) => button.textContent.includes('Reverse diffusion')).click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('[[Concepts/Reverse diffusion|Reverse diffusion]]'), 'The knowledge link was not saved as portable Obsidian Markdown.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager aside button')].find((button) => button.textContent.includes('Reverse diffusion')).click()`)
  try {
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Reverse diffusion' && document.querySelector('.knowledge-backlinks strong')?.textContent.includes('노이즈 예측')`), 'Opening the linked Concept did not show the source Claim as a backlink.')
  } catch (reason) {
    const debug = await notesConnection.evaluate(`(async () => ({ title: document.querySelector('.knowledge-heading h3')?.textContent, backlinkText: document.querySelector('.knowledge-backlinks')?.textContent, direct: await window.prism.listKnowledgeBacklinks(${JSON.stringify(createdTypes[1])}) }))()`)
    throw new Error(`${reason.message} Debug: ${JSON.stringify(debug)}\nClaim: ${await fs.readFile(claimPath, 'utf8')}`)
  }
  const linksScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const linksScreenshotPath = path.resolve('tmp/ui/notes-links-backlinks.png')
  await fs.writeFile(linksScreenshotPath, Buffer.from(linksScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('.knowledge-backlinks button').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'Clicking a knowledge backlink did not return to its source note.')
  await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n[[가중' })
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.wiki-link-menu strong')?.textContent.includes('가중치')`), 'Typing [[ did not open filtered knowledge link autocomplete.')
  const autocompleteScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const autocompleteScreenshotPath = path.resolve('tmp/ui/notes-link-autocomplete.png')
  await fs.writeFile(autocompleteScreenshotPath, Buffer.from(autocompleteScreenshot.data, 'base64'))
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.wiki-link-menu'))`), 'Choosing an inline knowledge link did not close autocomplete.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('[[Questions/가중치는 품질에 어떤 영향을 주는가|가중치는 품질에 어떤 영향을 주는가]]'), 'Inline knowledge autocomplete did not save the selected Obsidian link.')
  await waitFor(() => notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장'))?.disabled === true`), 'The knowledge editor did not settle after saving the inline link.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="지식 관계 추가"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.relation-picker'))`), 'The typed relation picker did not open.')
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="지식 관계 유형"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'supports'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.relation-choice')?.textContent === '지지함'`), 'The typed relation picker did not apply the selected relation type.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.relation-picker > div > button')].find((button) => button.textContent.includes('Reverse diffusion')).click()`)
  try {
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-relations article small')?.textContent.includes('지지함')`), 'Creating a typed relation did not render its outgoing relation card.')
  } catch (reason) {
    const debug = await notesConnection.evaluate(`({ footer: document.querySelector('.knowledge-manager > footer > span')?.textContent, relationPicker: Boolean(document.querySelector('.relation-picker')), relationText: document.querySelector('.knowledge-relations')?.textContent })`)
    let files = []; try { files = await fs.readdir(path.join(libraryPath, '.prism', 'relations')) } catch { /* directory was not created */ }
    throw new Error(`${reason.message} Debug: ${JSON.stringify(debug)} Files: ${JSON.stringify(files)}\nClaim: ${await fs.readFile(claimPath, 'utf8')}`)
  }
  let relationFiles = await fs.readdir(path.join(libraryPath, '.prism', 'relations'))
  assert(relationFiles.length === 1 && relationFiles[0].startsWith('relation-'), 'A typed relation was not stored as an independent sidecar.')
  const relationRecord = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'relations', relationFiles[0]), 'utf8'))
  assert(relationRecord.type === 'supports' && relationRecord.creator === 'user' && relationRecord.reviewStatus === 'approved', 'The relation sidecar did not preserve type, creator, and review status.')
  assert((await fs.readFile(claimPath, 'utf8')).includes('> [!abstract] 관계 · 지지함'), 'The approved relation was not kept as human-readable Markdown.')
  const relationsScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const relationsScreenshotPath = path.resolve('tmp/ui/notes-typed-relations.png')
  await fs.writeFile(relationsScreenshotPath, Buffer.from(relationsScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('.knowledge-relations article > button:first-child').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Reverse diffusion' && document.querySelector('.knowledge-relations article small')?.textContent.includes('지지함')`), 'The target Concept did not show the relation as incoming.')
  await notesConnection.evaluate(`document.querySelector('.knowledge-relations article > button:first-child').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'The incoming relation card did not navigate back to its source.')
  await notesConnection.evaluate(`document.querySelector('.knowledge-relations .relation-delete').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.knowledge-relations')`), 'Deleting an outgoing relation did not remove its card.')
  relationFiles = await fs.readdir(path.join(libraryPath, '.prism', 'relations'))
  assert(relationFiles.length === 0 && !(await fs.readFile(claimPath, 'utf8')).includes('prism-relation:'), 'Deleting a relation did not remove its sidecar and generated Markdown block.')
  assert((await fs.readFile(claimPath, 'utf8')).includes('[[Concepts/Reverse diffusion|Reverse diffusion]]'), 'Deleting a typed relation removed a separate user-authored wiki link.')
  const aiRelation = await notesConnection.evaluate(`(async () => {
    const source = (await window.prism.listKnowledgeNodes()).find((node) => node.title.includes('노이즈 예측'));
    const snapshot = await window.prism.readKnowledgeNode(source.id);
    return window.prism.createKnowledgeRelation({ sourceId: source.id, targetId: ${JSON.stringify(createdTypes[2])}, type: 'extends', creator: 'ai', expectedRevision: snapshot.revision });
  })()`)
  assert(aiRelation.saved && aiRelation.relation.creator === 'ai' && aiRelation.relation.reviewStatus === 'pending', 'An AI relation did not start in pending review state.')
  assert(!(await fs.readFile(claimPath, 'utf8')).includes(aiRelation.relation.id), 'A pending AI relation modified user Markdown before approval.')
  const removedAiRelation = await notesConnection.evaluate(`window.prism.deleteKnowledgeRelation({ id: ${JSON.stringify(aiRelation.relation.id)}, expectedRevision: ${JSON.stringify(aiRelation.snapshot.revision)} })`)
  assert(removedAiRelation.saved && (await fs.readdir(path.join(libraryPath, '.prism', 'relations'))).length === 0, 'Deleting a pending AI relation did not remove its sidecar.')

  claimMarkdown = await fs.readFile(claimPath, 'utf8')
  await replaceEditor(notesConnection, `${claimMarkdown}\n사용자가 문서형 화면에서 추가한 판단.\n`, '.knowledge-editor .cm-content')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('사용자가 문서형 화면에서 추가한 판단.'), 'The knowledge note body was not saved from Live Edit.')

  assert(await notesConnection.evaluate(`window.prism.listEvidenceAnchors().then((items) => new Set(items.map((item) => item.type)).size)`) === 5, 'The evidence catalog did not expose sentence, equation, table, figure, and page anchors.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="PDF 근거 추가"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-picker'))`), 'The PDF evidence picker did not open.')
  assert(await notesConnection.evaluate(`document.querySelectorAll('.evidence-picker > div > button').length`) >= 5, 'The evidence picker did not list the stored PDF anchors.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-picker > div > button')].find((button) => button.textContent.includes('L_simple')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-strip article'))`), 'Inserting an evidence anchor did not render a document evidence card.')
  assert(await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content')?.textContent.includes('PDF 원문 열기')`), 'The evidence card was not inserted into the Markdown document at the editor selection.')
  await mainConnection.evaluate(`(() => { window.__openedEvidence = []; window.prism.onOpenEvidenceAnchor((anchor) => window.__openedEvidence.push(anchor)); })()`)
  await notesConnection.evaluate(`document.querySelector('.evidence-open').click()`)
  await waitFor(() => mainConnection.evaluate(`window.__openedEvidence?.[0]?.anchorId === 'equation-p2-3'`), 'Clicking the evidence card did not ask the Reader to open the stable PDF anchor.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('prism-evidence:') && (await fs.readFile(claimPath, 'utf8')).includes('^evidence-test-0001-equation-p2-3'), 'The evidence reference was not preserved in portable Markdown.')
  try {
    await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-heading h3')) && Boolean(document.querySelector('.evidence-strip article'))`), 'The knowledge document did not settle after saving the evidence card.')
  } catch (reason) {
    const debug = await notesConnection.evaluate(`({ loading: document.querySelector('.knowledge-loading')?.textContent, footer: document.querySelector('.knowledge-manager > footer')?.textContent, nodes: [...document.querySelectorAll('.knowledge-manager aside strong')].map((item) => item.textContent) })`)
    throw new Error(`${reason.message} Debug: ${JSON.stringify(debug)}\n${(await fs.readFile(claimPath, 'utf8')).slice(0, 700)}`)
  }

  const knowledgeScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const knowledgeScreenshotPath = path.resolve('tmp/ui/notes-knowledge.png')
  await fs.mkdir(path.dirname(knowledgeScreenshotPath), { recursive: true })
  await fs.writeFile(knowledgeScreenshotPath, Buffer.from(knowledgeScreenshot.data, 'base64'))

  const changedEquation = 'L_simple now uses an updated epsilon parameterization.'
  await fs.writeFile(path.join(libraryPath, '.prism', 'anchors', 'test.0001.json'), JSON.stringify({ version: 1, paperId: 'test.0001', anchors: [
    { id: 'sentence-p1-1', type: 'text', page: 1, source: 'Noise prediction can be interpreted as denoising score matching.' },
    { id: 'equation-p2-3', type: 'equation', page: 2, source: changedEquation },
    { id: 'table-p3-1', type: 'table', page: 3, source: 'Model | FID\nDDPM | 3.17' },
  ] }, null, 2), 'utf8')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="PDF 근거 추가"]').click()`)
  await notesConnection.evaluate(`document.querySelector('button[aria-label="PDF 앵커 새로고침"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-strip article.needs-relink'))`), 'A changed source hash did not mark the evidence card for relinking.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="PDF 근거 선택 닫기"]').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.includes('재연결')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.evidence-picker > div > button')].find((button) => button.textContent.includes('updated epsilon'))) `), 'The relink picker did not offer the updated anchor.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-picker > div > button')].find((button) => button.textContent.includes('updated epsilon')).click()`)
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.evidence-strip article.needs-relink'))`), 'Choosing the updated anchor did not resolve the broken evidence state.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes(changedEquation), 'The relinked source was not saved to Markdown.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.includes('승격')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-promote'))`), 'The evidence promotion dialog did not open.')
  const promotionScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const promotionScreenshotPath = path.resolve('tmp/ui/notes-evidence-promotion.png')
  await fs.writeFile(promotionScreenshotPath, Buffer.from(promotionScreenshot.data, 'base64'))
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="승격 노트 제목"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Score matching 근거 주장'); input.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('.evidence-promote footer button')].find((button) => button.textContent.includes('승격하기')).click(); })()`)
  const promotedPath = path.join(libraryPath, 'Claims', 'Score matching 근거 주장.md')
  await waitFor(async () => { try { const value = await fs.readFile(promotedPath, 'utf8'); return value.includes('prism-evidence:') && value.includes('[[Claims/노이즈 예측은 score matching이다|노이즈 예측은 score matching이다]]') } catch { return false } }, 'Promoting evidence did not preserve both the PDF anchor and origin note link.')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Score matching 근거 주장'`), 'The promoted Claim was not opened after creation.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager aside button')].find((button) => button.textContent.includes('노이즈 예측은 score matching이다')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'The origin Claim did not reopen after promotion.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="수식1 근거 링크 삭제"]').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.evidence-strip article')`), 'Removing an evidence link did not remove its document card.')
  assert(await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content')?.textContent.includes('사용자가 문서형 화면에서 추가한 판단.')`), 'Removing an evidence link also removed user-authored content.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => !(await fs.readFile(claimPath, 'utf8')).includes('prism-evidence:'), 'Removing an evidence link was not saved to Markdown.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="연구 지식 닫기"]').click()`)
  await sleep(200)
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-manager'))`), 'The knowledge manager did not close.')

  const backlinks = await mainConnection.evaluate(`window.prism.listEvidenceBacklinks({ paperId: 'test.0001', anchorId: 'equation-p2-3', type: 'equation', page: 2, label: '수식1' })`)
  assert(backlinks.length === 1 && backlinks[0].title === 'Score matching 근거 주장', `Evidence backlink lookup did not return only the promoted note: ${JSON.stringify(backlinks)}`)
  assert(backlinks[0].excerpt.includes(changedEquation), 'The evidence backlink did not include a useful source excerpt.')
  await mainConnection.evaluate(`window.prism.openKnowledgeNodeInNotes(${JSON.stringify(backlinks[0].nodeId)})`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Score matching 근거 주장'`), 'Opening an evidence backlink did not focus the exact knowledge note in Notes.')
  const backlinkScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const backlinkScreenshotPath = path.resolve('tmp/ui/notes-backlink-open.png')
  await fs.writeFile(backlinkScreenshotPath, Buffer.from(backlinkScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('button[aria-label="연구 지식 닫기"]').click()`)
  await sleep(100)

  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-modebar button')].find((button) => button.textContent.includes('읽기')).click()`)
  await sleep(100)
  const readState = await notesConnection.evaluate(`(() => ({
    heading: document.querySelector('.notes-preview h1')?.textContent,
    hasTable: Boolean(document.querySelector('.notes-preview table')),
    hasMath: Boolean(document.querySelector('.notes-preview .katex')),
    frontmatterVisible: document.querySelector('.notes-preview')?.textContent.includes('type: paper'),
    commentVisible: document.querySelector('.notes-preview')?.textContent.includes('keep-this-comment'),
  }))()`)
  assert(readState.heading === 'Research note', 'Reading mode did not render the heading.')
  assert(readState.hasTable && readState.hasMath, 'Reading mode did not render GFM table and math.')
  assert(!readState.frontmatterVisible, 'Reading mode exposed YAML frontmatter as note content.')
  assert(!readState.commentVisible, 'Reading mode exposed a preserved HTML comment.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-modebar button')].find((button) => button.textContent.includes('분할')).click()`)
  await sleep(100)
  assert(await notesConnection.evaluate(`Boolean(document.querySelector('.mode-split .markdown-editor') && document.querySelector('.mode-split .notes-preview'))`), 'Split mode did not show editor and preview together.')

  const replacement = `${initialNote}\nExact spacing:  A  B\n`
  await replaceEditor(notesConnection, replacement)
  const editorAfterReplacement = await notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent`)
  assert(editorAfterReplacement.includes('Exact spacing'), `The editor did not receive replacement input. Actual tail: ${JSON.stringify(editorAfterReplacement.slice(-120))}`)
  await waitFor(async () => await fs.readFile(notePath, 'utf8') === replacement, 'The exact Markdown text was not saved after editing.')
  const exactSaved = await fs.readFile(notePath, 'utf8')
  const saveUiState = await notesConnection.evaluate(`({ status: document.querySelector('.notes-save-status')?.textContent, error: document.querySelector('.notes-error')?.textContent, conflict: Boolean(document.querySelector('.notes-conflict')) })`)
  assert(exactSaved === replacement, `The exact Markdown text was not saved after editing. Actual tail: ${JSON.stringify(exactSaved.slice(-120))}; UI: ${JSON.stringify(saveUiState)}`)

  const localConflict = `${replacement}\nLocal draft must not be lost.\n`
  const externalConflict = `${replacement}\nExternal edit from Obsidian.\n`
  await replaceEditor(notesConnection, localConflict)
  await fs.writeFile(notePath, externalConflict, 'utf8')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'An external edit did not open the conflict comparison.')
  const conflictState = await notesConnection.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.notes-conflict')),
    title: document.querySelector('#notes-conflict-title')?.textContent,
    versions: [...document.querySelectorAll('.notes-conflict pre')].map((element) => element.textContent),
  }))()`)
  assert(conflictState.visible && conflictState.title.includes('외부 변경'), 'An external edit did not open the conflict comparison.')
  assert(conflictState.versions[0].includes('Local draft') && conflictState.versions[1].includes('External edit'), 'The conflict comparison did not preserve both versions.')
  assert(await fs.readFile(notePath, 'utf8') === externalConflict, 'Autosave overwrote an external edit before conflict resolution.')

  const conflictScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const conflictScreenshotPath = path.resolve('tmp/ui/notes-conflict.png')
  await fs.mkdir(path.dirname(conflictScreenshotPath), { recursive: true })
  await fs.writeFile(conflictScreenshotPath, Buffer.from(conflictScreenshot.data, 'base64'))

  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-conflict button')].find((button) => button.textContent.includes('디스크 버전')).click()`)
  await sleep(150)
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'Choosing the disk version did not close the conflict dialog.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent.includes('External edit from Obsidian.')`), 'Choosing the disk version did not load its content.')

  const cleanExternal = `${externalConflict}\nReloaded while clean.\n`
  await fs.writeFile(notePath, cleanExternal, 'utf8')
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.notes-notice')?.textContent.includes('외부 편집기')`), 'A clean external edit was not reported and reloaded.')
  assert(await notesConnection.evaluate(`document.querySelector('.notes-notice')?.textContent.includes('외부 편집기')`), 'A clean external edit was not reported and reloaded.')
  assert(await notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent.includes('Reloaded while clean.')`), 'A clean external edit was not loaded into the editor.')

  const localOverwrite = `${cleanExternal}\nKeep my second local draft.\n`
  const secondExternal = `${cleanExternal}\nSecond external edit.\n`
  await replaceEditor(notesConnection, localOverwrite)
  await fs.writeFile(notePath, secondExternal, 'utf8')
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.notes-conflict'))`), 'The second external edit did not open the conflict comparison.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.notes-conflict button')].find((button) => button.textContent.includes('내 편집본')).click()`)
  await waitFor(async () => await fs.readFile(notePath, 'utf8') === localOverwrite, 'Explicit overwrite did not atomically save the local version.')
  assert(await fs.readFile(notePath, 'utf8') === localOverwrite, 'Explicit overwrite did not atomically save the local version.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="제목 블록 삽입"]').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.cm-content')?.textContent.includes('제목')`), 'The toolbar did not update the editor document.')
  const toolbarState = await notesConnection.evaluate(`({ updated: document.querySelector('.cm-content')?.textContent.includes('제목'), conflict: Boolean(document.querySelector('.notes-conflict')), disabled: document.querySelector('button[aria-label="제목 블록 삽입"]')?.disabled, mode: document.querySelector('.notes-modebar button.active')?.textContent })`)
  assert(toolbarState.updated, `The toolbar did not update the editor document: ${JSON.stringify(toolbarState)}`)
  await waitFor(async () => (await fs.readFile(notePath, 'utf8')).includes('## 제목'), 'The toolbar did not insert a heading block.')
  assert((await fs.readFile(notePath, 'utf8')).includes('## 제목'), 'The toolbar did not insert a heading block.')

  await notesConnection.evaluate(`document.querySelector('.cm-content').focus()`)
  for (const key of ['ArrowRight', 'Enter', 'Enter']) {
    const code = key === 'Enter' ? 13 : 39
    await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
    await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
  }
  await notesConnection.send('Input.insertText', { text: '/표' })
  await sleep(150)
  assert(await notesConnection.evaluate(`document.querySelector('.slash-command-menu button')?.textContent.includes('표')`), 'Typing /표 did not open the filtered slash command menu.')
  const frontmatterState = await notesConnection.evaluate(`(() => { const lines = [...document.querySelectorAll('.cm-line')].slice(0, 6); return { lines: lines.map((line) => ({ text: line.textContent, className: line.className, display: getComputedStyle(line).display })) } })()`)
  assert(frontmatterState.lines.filter((line) => line.className.includes('cm-md-frontmatter') && line.display === 'none').length >= 3, `Live Edit exposed frontmatter: ${JSON.stringify(frontmatterState)}`)

  const screenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const screenshotPath = path.resolve('tmp/ui/notes-live-edit.png')
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
  await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await waitFor(async () => { const current = await fs.readFile(notePath, 'utf8'); return current.includes('| 항목 | 내용 |') && !current.includes('/표') }, 'Enter did not apply the selected slash command.')
  const slashResult = await fs.readFile(notePath, 'utf8')
  assert(slashResult.includes('| 항목 | 내용 |') && !slashResult.includes('/표'), 'Enter did not apply the selected slash command.')
  assert(notesConnection.exceptions.length === 0, `Notes renderer exceptions: ${notesConnection.exceptions.join('; ')}`)
  process.stdout.write(`Notes UI smoke passed: knowledge nodes, structured properties, knowledge links, inline autocomplete, backlinks and typed relations, evidence relinking, promotion and backlinks, templates, document editing, safe external changes, conflict resolution, toolbar, slash commands, exact Markdown, reading, and split modes.\nScreenshots: ${screenshotPath}, ${conflictScreenshotPath}, ${templateScreenshotPath}, ${knowledgeScreenshotPath}, ${linksScreenshotPath}, ${autocompleteScreenshotPath}, ${relationsScreenshotPath}, ${promotionScreenshotPath}, ${backlinkScreenshotPath}\n`)
} finally {
  notesConnection?.socket.close()
  mainConnection?.socket.close()
  if (electron.exitCode === null) {
    electron.kill()
    await new Promise((resolve) => electron.once('exit', resolve))
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
