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
const externalUrlLog = path.join(temporaryRoot, 'external-urls.log')
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
  env: { ...process.env, PRISM_TEST_LIBRARY_PATH: libraryPath, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_EXTERNAL_URL_LOG: externalUrlLog },
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
  assert(await notesConnection.evaluate(`document.querySelectorAll('.template-manager-body aside > div > button').length`) === 6, 'The six starter templates were not created.')
  assert((await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md')).length === 6, 'Starter templates were not stored as Markdown files.')
  for (const directory of ['00 Inbox', 'Papers', 'Concepts', 'Claims', 'Insights', 'Questions', 'Projects', 'Templates', 'Assets']) assert((await fs.stat(path.join(libraryPath, directory))).isDirectory(), `Vault directory was not created: ${directory}`)

  const templateScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const templateScreenshotPath = path.resolve('tmp/ui/notes-templates.png')
  await fs.mkdir(path.dirname(templateScreenshotPath), { recursive: true })
  await fs.writeFile(templateScreenshotPath, Buffer.from(templateScreenshot.data, 'base64'))

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('즐겨찾기')).click()`)
  await waitFor(async () => { try { return JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'template-preferences.json'), 'utf8')).favorites.length === 1 } catch { return false } }, 'The favorite template preference was not persisted.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-filters button')].find((button) => button.textContent.includes('즐겨찾기')).click()`)
  assert(await notesConnection.evaluate(`document.querySelectorAll('.template-manager-body aside > div > button').length`) === 1, 'The favorite template filter did not show only favorite templates.')
  const templateLifecycleScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const templateLifecycleScreenshotPath = path.resolve('tmp/ui/notes-template-lifecycle.png')
  await fs.writeFile(templateLifecycleScreenshotPath, Buffer.from(templateLifecycleScreenshot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-filters button')].find((button) => button.textContent.trim() === '전체').click()`)

  await notesConnection.evaluate(`document.querySelector('.template-new').click()`)
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="템플릿 이름"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '나의 주장 검토'); input.dispatchEvent(new Event('input', { bubbles: true })); const select = document.querySelector('select[aria-label="템플릿 노트 유형"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(select, 'claim'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await replaceEditor(notesConnection, '# {{title}}\n\n프로젝트: {{current_project}}\n\n## 나의 근거\n', '.template-editor .cm-content')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await sleep(350)
  let templateFiles = (await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md'))
  assert(templateFiles.length === 7, 'A personal template was not created.')
  const customTemplateName = templateFiles.find((name) => name.startsWith('나의 주장 검토'))
  assert(customTemplateName, 'The personal template Markdown file was not named as expected.')
  const customTemplatePath = path.join(libraryPath, 'Templates', customTemplateName)
  const customTemplate = await fs.readFile(customTemplatePath, 'utf8')
  assert(customTemplate.includes('node_type: claim') && customTemplate.includes('{{current_project}}') && customTemplate.includes('## 나의 근거'), 'The personal template did not preserve frontmatter, variables, and Markdown content.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('복제')).click()`)
  await sleep(350)
  templateFiles = (await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md'))
  assert(templateFiles.length === 8, 'Template duplication did not create a Markdown copy.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('기본값')).click()`)
  await sleep(250)
  const defaults = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'template-defaults.json'), 'utf8'))
  assert(typeof defaults.claim === 'string' && defaults.claim.startsWith('claim-'), 'The default template selection was not persisted.')

  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.trim() === '삭제').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-manager footer button')].find((button) => button.textContent.includes('삭제 확인')).click()`)
  await sleep(350)
  assert((await fs.readdir(path.join(libraryPath, 'Templates'))).filter((name) => name.endsWith('.md')).length === 7, 'Template deletion did not remove the active file.')
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
  assert(await notesConnection.evaluate(`document.querySelectorAll('select[aria-label="새 지식 노트 유형"] option').length`) === 6, 'The knowledge creator did not expose every supported node type.')
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="새 지식 노트 유형"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(select, 'claim'); select.dispatchEvent(new Event('change', { bubbles: true })); const input = document.querySelector('input[aria-label="새 지식 노트 제목"]'); const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; inputSetter.call(input, '노이즈 예측은 score matching이다'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(150)
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="새 지식 노트 템플릿"]'); const option = [...select.options].find((item) => item.textContent.includes('나의 주장 검토')); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, option.value); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await notesConnection.evaluate(`document.querySelector('.knowledge-template-variables summary').click()`)
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="템플릿 변수 현재 프로젝트"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Diffusion study'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-create button')].find((button) => button.textContent.includes('노트 만들기')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'A Claim knowledge note was not opened after creation.')
  const claimPath = path.join(libraryPath, 'Claims', '노이즈 예측은 score matching이다.md')
  await waitFor(async () => { try { return (await fs.readFile(claimPath, 'utf8')).includes('type: claim') } catch { return false } }, 'The Claim was not stored as Markdown in the Claims folder.')
  let claimMarkdown = await fs.readFile(claimPath, 'utf8')
  assert(claimMarkdown.includes('prism_id: "claim-') && claimMarkdown.includes('template_id:') && /template_version: "[a-f0-9]{64}"/.test(claimMarkdown) && claimMarkdown.includes('# 노이즈 예측은 score matching이다') && claimMarkdown.includes('프로젝트: Diffusion study'), 'The generated Claim did not retain identity, exact template revision, rendered title, and optional variable values.')
  const templatePreferences = JSON.parse(await fs.readFile(path.join(libraryPath, '.prism', 'template-preferences.json'), 'utf8'))
  assert(Object.values(templatePreferences.recent).some((usedAt) => Number.isFinite(usedAt)), 'Creating a note did not record a recent template use.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="누락된 템플릿 섹션 추가"]').click()`)
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="섹션을 가져올 템플릿"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'claim-evidence-review'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  const missingSectionsScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const missingSectionsScreenshotPath = path.resolve('tmp/ui/notes-template-missing-sections.png')
  await fs.writeFile(missingSectionsScreenshotPath, Buffer.from(missingSectionsScreenshot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.template-section-picker button')].find((button) => button.textContent.trim() === '추가').click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('## 주장'), 'Applying a template did not append its missing sections.')
  const claimAfterSections = await fs.readFile(claimPath, 'utf8')
  assert(claimAfterSections.includes('## 주장') && claimAfterSections.includes('## 나의 근거') && claimAfterSections.indexOf('## 나의 근거') < claimAfterSections.indexOf('## 주장') && claimAfterSections.includes('프로젝트: Diffusion study'), 'Applying missing sections changed or replaced existing note content.')
  const createdTypes = await notesConnection.evaluate(`(async () => {
    const inputs = [['paper', '수동 Paper 노트'], ['concept', 'Reverse diffusion'], ['insight', '목적함수 연결 아이디어'], ['question', '가중치는 품질에 어떤 영향을 주는가'], ['project', 'Diffusion objective 개선 연구']];
    const results = [];
    for (const [nodeType, title] of inputs) results.push(await window.prism.createKnowledgeNode({ nodeType, title }));
    return results.map((result) => result.id);
  })()`)
  assert(createdTypes.length === 5, 'The remaining knowledge node types were not created through the public IPC contract.')
  for (const [folder, file] of [['Papers', '수동 Paper 노트.md'], ['Concepts', 'Reverse diffusion.md'], ['Insights', '목적함수 연결 아이디어.md'], ['Questions', '가중치는 품질에 어떤 영향을 주는가.md'], ['Projects', 'Diffusion objective 개선 연구.md']]) assert((await fs.stat(path.join(libraryPath, folder, file))).isFile(), `${folder} node was not stored in its Markdown folder.`)
  assert((await fs.readFile(path.join(libraryPath, 'Projects', 'Diffusion objective 개선 연구.md'), 'utf8')).includes('template_id: "project-research-context"'), 'A Project did not use its Markdown default template.')
  const claimNodeId = await notesConnection.evaluate(`window.prism.listKnowledgeNodes().then((nodes) => nodes.find((node) => node.title.includes('노이즈 예측')).id)`)

  async function chooseKnowledgeProperty(label, value, expectedLine) {
    await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes(expectedLine), `The ${label} property was not saved.`)
  }
  await chooseKnowledgeProperty('지식 노트 상태', 'established', 'status: established')
  await chooseKnowledgeProperty('지식 노트 중요도', 'high', 'importance: high')
  await chooseKnowledgeProperty('지식 노트 확신도', 'low', 'confidence: low')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="현재 노트를 Obsidian에서 열기"]').click()`)
  await waitFor(async () => { try { return (await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/).length === 1 } catch { return false } }, 'Opening the current note did not invoke an Obsidian URI.')
  let obsidianLocations = (await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/).map((uri) => new URL(uri).searchParams.get('path'))
  assert(obsidianLocations[0] === claimPath, `The Obsidian file URI did not preserve the native absolute path: ${obsidianLocations[0]}`)
  await notesConnection.evaluate(`window.prism.openKnowledgeNodeInObsidian({ nodeId: ${JSON.stringify(claimNodeId)}, heading: '지지 근거' })`)
  await waitFor(async () => (await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/).length === 2, 'Opening an Obsidian heading did not invoke a second URI.')
  obsidianLocations = (await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/).map((uri) => new URL(uri).searchParams.get('path'))
  assert(obsidianLocations[1] === `${claimPath}#지지 근거`, 'The Obsidian URI did not encode and restore its heading target.')

  let knowledgeViews = await notesConnection.evaluate(`window.prism.listKnowledgeDataViews()`)
  assert(knowledgeViews.projects.length === 1 && knowledgeViews.projects[0].relativePath === 'Projects/Diffusion objective 개선 연구.md', 'The Project data view did not expose a portable Vault-relative Project path.')
  assert(knowledgeViews.unansweredQuestions.length === 1 && knowledgeViews.unansweredQuestions[0].id === createdTypes[3], 'The unanswered Question data view did not include the developing Question.')
  assert(knowledgeViews.unsupportedClaims.length === 1 && knowledgeViews.unsupportedClaims[0].title.includes('노이즈 예측'), 'The unsupported Claim data view did not include a Claim without evidence.')
  const pendingEvidenceRelation = await notesConnection.evaluate(`(async () => { const snapshot = await window.prism.readKnowledgeNode(${JSON.stringify(createdTypes[0])}); return window.prism.createKnowledgeRelation({ sourceId: ${JSON.stringify(createdTypes[0])}, targetId: document.querySelector('.knowledge-manager-body > aside button.active')?.textContent.includes('노이즈 예측') ? (await window.prism.listKnowledgeNodes()).find((node) => node.title.includes('노이즈 예측')).id : '', type: 'supports', creator: 'ai', expectedRevision: snapshot.revision }); })()`)
  assert(pendingEvidenceRelation.saved && (await notesConnection.evaluate(`window.prism.listKnowledgeDataViews()`)).unsupportedClaims.length === 1, 'A pending AI relation incorrectly removed a Claim from the unsupported view.')
  await notesConnection.evaluate(`window.prism.deleteKnowledgeRelation({ id: ${JSON.stringify(pendingEvidenceRelation.relation.id)}, expectedRevision: ${JSON.stringify(pendingEvidenceRelation.snapshot.revision)} })`)
  const approvedEvidenceRelation = await notesConnection.evaluate(`(async () => { const snapshot = await window.prism.readKnowledgeNode(${JSON.stringify(createdTypes[0])}); const claim = (await window.prism.listKnowledgeNodes()).find((node) => node.title.includes('노이즈 예측')); return window.prism.createKnowledgeRelation({ sourceId: ${JSON.stringify(createdTypes[0])}, targetId: claim.id, type: 'supports', creator: 'user', expectedRevision: snapshot.revision }); })()`)
  assert(approvedEvidenceRelation.saved && (await notesConnection.evaluate(`window.prism.listKnowledgeDataViews()`)).unsupportedClaims.length === 0, 'An approved incoming supporting relation did not satisfy the Claim evidence view.')
  await notesConnection.evaluate(`window.prism.deleteKnowledgeRelation({ id: ${JSON.stringify(approvedEvidenceRelation.relation.id)}, expectedRevision: ${JSON.stringify(approvedEvidenceRelation.snapshot.revision)} })`)
  assert((await notesConnection.evaluate(`window.prism.listKnowledgeDataViews()`)).unsupportedClaims.length === 1, 'Removing the approved support did not restore the Claim to the unsupported view.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="지식 데이터 보기"]').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.knowledge-data-view').length === 3 && document.querySelector('.view-projects')?.textContent.includes('Diffusion objective 개선 연구') && document.querySelector('.view-questions')?.textContent.includes('가중치는 품질에') && document.querySelector('.view-claims')?.textContent.includes('노이즈 예측')`), 'The research overview did not render Project, unanswered Question, and unsupported Claim views.')
  const dataViewsScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const dataViewsScreenshotPath = path.resolve('tmp/ui/notes-knowledge-data-views.png')
  await fs.writeFile(dataViewsScreenshotPath, Buffer.from(dataViewsScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('.view-claims button').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측') && !document.querySelector('.knowledge-data-views')`), 'Selecting an unsupported Claim did not open its Markdown note.')
  await notesConnection.evaluate(`(async () => { const snapshot = await window.prism.readKnowledgeNode(${JSON.stringify(createdTypes[3])}); return window.prism.updateKnowledgeProperties(${JSON.stringify(createdTypes[3])}, { status: 'established' }, snapshot.revision); })()`)
  assert((await notesConnection.evaluate(`window.prism.listKnowledgeDataViews()`)).unansweredQuestions.length === 0, 'An established Question remained in the unanswered view.')

  await notesConnection.evaluate(`document.querySelector('button[aria-label="지식 링크 추가"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-link-picker'))`), 'The knowledge link picker did not open.')
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="링크 관계 유형"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'discusses'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-link-picker > div > button')].find((button) => button.textContent.includes('Reverse diffusion')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('[[Concepts/Reverse diffusion|Reverse diffusion]]') && (await notesConnection.evaluate(`document.querySelector('.knowledge-relations article small')?.textContent.includes('다룸')`)), 'The knowledge picker did not save a portable link and selected relation together.')
  await notesConnection.evaluate(`document.querySelector('.knowledge-relations .relation-delete').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.knowledge-relations')`), 'Removing the link-created relation did not leave the separate wiki link in place.')
  assert((await fs.readFile(claimPath, 'utf8')).includes('[[Concepts/Reverse diffusion|Reverse diffusion]]'), 'Removing a link-created relation also removed its ordinary wiki link.')
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
  await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-md-wikilink')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.wiki-link-preview')?.textContent.includes('PDF 근거 0개')`), 'Hovering a rendered knowledge link did not show its preview and evidence count.')
  const linkPreviewScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const linkPreviewScreenshotPath = path.resolve('tmp/ui/notes-link-preview.png')
  await fs.writeFile(linkPreviewScreenshotPath, Buffer.from(linkPreviewScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-md-wikilink')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`)

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
  const relatedContext = await notesConnection.evaluate(`window.prism.retrieveResearchContext('노이즈 예측 score matching')`)
  assert(relatedContext.nodes.some((node) => node.id === createdTypes[1]) && relatedContext.relations.some((relation) => relation.id === relationRecord.id && relation.reviewStatus === 'approved'), 'Graph-grounded retrieval did not follow the approved typed relation to its Concept.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="로컬 관계 그래프"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-local-graph')) && document.querySelector('.local-graph-center strong')?.textContent.includes('노이즈 예측') && document.querySelector('.local-graph-node strong')?.textContent === 'Reverse diffusion' && document.querySelector('.knowledge-local-graph')?.textContent.includes('지지함')`), 'The local relation graph did not render its center, neighbor, and typed edge.')
  const graphScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const graphScreenshotPath = path.resolve('tmp/ui/notes-local-graph.png')
  await fs.writeFile(graphScreenshotPath, Buffer.from(graphScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('.local-graph-node').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Reverse diffusion' && document.querySelector('.knowledge-relations article small')?.textContent.includes('지지함')`), 'The target Concept did not show the relation as incoming.')
  assert(!await notesConnection.evaluate(`Boolean(document.querySelector('.knowledge-local-graph'))`), 'Opening a graph neighbor did not close the local graph.')
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
  const pendingContext = await notesConnection.evaluate(`window.prism.retrieveResearchContext('노이즈 예측 score matching')`)
  assert(!pendingContext.relations.some((relation) => relation.id === aiRelation.relation.id), 'Graph-grounded retrieval followed a pending AI relation.')
  const removedAiRelation = await notesConnection.evaluate(`window.prism.deleteKnowledgeRelation({ id: ${JSON.stringify(aiRelation.relation.id)}, expectedRevision: ${JSON.stringify(aiRelation.snapshot.revision)} })`)
  assert(removedAiRelation.saved && (await fs.readdir(path.join(libraryPath, '.prism', 'relations'))).length === 0, 'Deleting a pending AI relation did not remove its sidecar.')

  claimMarkdown = await fs.readFile(claimPath, 'utf8')
  await replaceEditor(notesConnection, `${claimMarkdown}\n사용자가 문서형 화면에서 추가한 판단.\n`, '.knowledge-editor .cm-content')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('사용자가 문서형 화면에서 추가한 판단.'), 'The knowledge note body was not saved from Live Edit.')
  const baselineIndex = await notesConnection.evaluate(`window.prism.rebuildResearchIndex()`)
  const conceptRevisionBefore = await notesConnection.evaluate(`window.prism.readKnowledgeNode(${JSON.stringify(createdTypes[1])})`)
  const conceptSearchText = `${conceptRevisionBefore.content}\n역확산 과정은 입력의 노이즈를 단계적으로 제거해 표본을 복원한다.\n`
  await notesConnection.evaluate(`window.prism.saveKnowledgeNode(${JSON.stringify(createdTypes[1])}, { content: ${JSON.stringify(conceptSearchText)}, expectedRevision: ${JSON.stringify(conceptRevisionBefore.revision)} })`)
  const hybridResults = await notesConnection.evaluate(`window.prism.searchResearchKnowledge('노이즈 제거 과정')`)
  assert(hybridResults[0]?.node.id === createdTypes[1] && hybridResults[0].semanticScore > 0 && !conceptSearchText.includes('노이즈 제거 과정'), `Hybrid research search did not rank a semantically overlapping Concept without an exact phrase match: ${JSON.stringify(hybridResults.map((result) => ({ title: result.node.title, score: result.score, textScore: result.textScore, semanticScore: result.semanticScore })))}`)
  const researchIndexPath = path.join(libraryPath, '.prism', 'index', 'research-search-v1.json')
  const researchIndex = JSON.parse(await fs.readFile(researchIndexPath, 'utf8'))
  assert(researchIndex.version === 1 && researchIndex.signature !== baselineIndex.signature && researchIndex.entries.length === 6 && researchIndex.entries.every((entry) => entry.vector.length === 384 && !path.isAbsolute(entry.relativePath) && !entry.relativePath.includes('\\')), 'The rebuildable research index did not refresh after Markdown changed or preserve portable local embeddings.')
  const rebuiltIndex = await notesConnection.evaluate(`window.prism.rebuildResearchIndex()`)
  assert(rebuiltIndex.rebuilt && rebuiltIndex.nodeCount === 6 && rebuiltIndex.relativePath === '.prism/index/research-search-v1.json', 'Explicit research index rebuild did not report its derived artifact.')
  await fs.writeFile(researchIndexPath, '{"version":1,"entries":"malformed"}', 'utf8')
  assert((await notesConnection.evaluate(`window.prism.searchResearchKnowledge('노이즈 제거 과정')`))[0]?.node.id === createdTypes[1], 'Research search did not rebuild a malformed derived index from source Markdown.')
  assert(JSON.parse(await fs.readFile(researchIndexPath, 'utf8')).entries.length === 6, 'Malformed derived index data was not replaced by a valid rebuild.')
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="지식 노트 검색"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '문서형 화면에서'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.knowledge-manager-body > aside > div > button').length === 1 && document.querySelector('.knowledge-manager-body > aside > div button i')?.textContent.includes('문서형 화면에서')`), 'Full-text knowledge search did not find the body-only phrase with context.')
  const searchScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const searchScreenshotPath = path.resolve('tmp/ui/notes-full-text-search.png')
  await fs.writeFile(searchScreenshotPath, Buffer.from(searchScreenshot.data, 'base64'))
  await notesConnection.evaluate(`(() => { const input = document.querySelector('input[aria-label="지식 노트 검색"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelectorAll('.knowledge-manager-body > aside > div > button').length === 6`), 'Clearing knowledge search did not restore the complete node list.')

  const duplicateConceptId = await notesConnection.evaluate(`(async () => {
    const created = await window.prism.createKnowledgeNode({ nodeType: 'concept', title: 'Reverse diffusion process' });
    const snapshot = await window.prism.readKnowledgeNode(created.id);
    const saved = await window.prism.saveKnowledgeNode(created.id, { content: snapshot.content + ${JSON.stringify('\n역확산 과정은 입력의 노이즈를 단계적으로 제거해 표본을 복원한다.\n')}, expectedRevision: snapshot.revision });
    if (!saved.saved) throw new Error('duplicate concept save conflict');
    return created.id;
  })()`)
  const paperSuggestionPath = path.join(libraryPath, 'Papers', '수동 Paper 노트.md')
  const paperSuggestionSource = await notesConnection.evaluate(`(async () => {
    const snapshot = await window.prism.readKnowledgeNode(${JSON.stringify(createdTypes[0])});
    const content = snapshot.content + ${JSON.stringify('\n[[Claims/노이즈 예측은 score matching이다|노이즈 예측은 score matching이다]] 주장을 실험 결과가 지지한다.\n')};
    const saved = await window.prism.saveKnowledgeNode(${JSON.stringify(createdTypes[0])}, { content, expectedRevision: snapshot.revision });
    if (!saved.saved) throw new Error('paper suggestion fixture conflict');
    return saved.snapshot.content;
  })()`)
  const generatedSuggestions = await notesConnection.evaluate(`window.prism.suggestKnowledge(${JSON.stringify(createdTypes[0])})`)
  assert(generatedSuggestions.some((item) => item.kind === 'supports' && item.source.id === createdTypes[0] && item.target?.id === claimNodeId && item.proposedRelation === 'supports'), 'The local suggestion engine did not infer an explicit supporting Claim relation.')
  assert(!generatedSuggestions.some((item) => item.kind === 'duplicate_concept'), 'A Paper received a duplicate Concept suggestion unrelated to its active context.')
  assert(generatedSuggestions.some((item) => item.kind === 'evidence_gap' || item.kind === 'research_gap'), 'The local suggestion engine did not expose a research gap.')
  const duplicateSuggestions = await notesConnection.evaluate(`window.prism.suggestKnowledge(${JSON.stringify(createdTypes[1])})`)
  assert(duplicateSuggestions.some((item) => item.kind === 'duplicate_concept' && item.source.id === createdTypes[1] && item.target?.id === duplicateConceptId), 'The local suggestion engine did not identify a semantically overlapping Concept from the active Concept.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager-body > aside button')].find((button) => button.querySelector('strong')?.textContent === 'Reverse diffusion').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === 'Reverse diffusion'`), 'The source Concept did not open for duplicate review.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="AI 연구 제안 보기"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.knowledge-suggestions article')].find((item) => item.textContent.includes('Reverse diffusion → Reverse diffusion process'))) `), 'The duplicate Concept suggestion was not shown in its relevant active context.')
  const duplicateScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const duplicateScreenshotPath = path.resolve('tmp/ui/notes-ai-duplicate-concept.png')
  await fs.writeFile(duplicateScreenshotPath, Buffer.from(duplicateScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('button[aria-label="AI 연구 제안 닫기"]').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager-body > aside button')].find((button) => button.textContent.includes('수동 Paper 노트')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent === '수동 Paper 노트'`), 'The suggestion source Paper did not open.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="AI 연구 제안 보기"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.knowledge-suggestions article')].find((item) => item.textContent.includes('수동 Paper 노트 → 노이즈 예측'))) && Boolean([...document.querySelectorAll('.knowledge-suggestions article')].find((item) => item.textContent.includes('근거 공백'))) `), 'The AI research suggestion review did not render relation and research-gap cards.')
  const suggestionsScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const suggestionsScreenshotPath = path.resolve('tmp/ui/notes-ai-suggestions.png')
  await fs.writeFile(suggestionsScreenshotPath, Buffer.from(suggestionsScreenshot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-suggestions article')].find((item) => item.textContent.includes('수동 Paper 노트 → 노이즈 예측')).querySelector('footer button').click()`)
  await waitFor(async () => (await notesConnection.evaluate(`window.prism.listKnowledgeRelations(${JSON.stringify(createdTypes[0])})`)).some((item) => item.type === 'supports' && item.creator === 'ai' && item.reviewStatus === 'pending'), 'Accepting a suggestion did not create a pending AI relation.')
  assert(await fs.readFile(paperSuggestionPath, 'utf8') === paperSuggestionSource, 'A pending AI suggestion modified the user-owned Markdown body.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="AI 연구 제안 닫기"]').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.relation-review-actions'))`), 'The pending AI relation did not expose explicit review controls.')
  const reviewScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const reviewScreenshotPath = path.resolve('tmp/ui/notes-ai-relation-review.png')
  await fs.writeFile(reviewScreenshotPath, Buffer.from(reviewScreenshot.data, 'base64'))
  const pendingSuggestedRelation = (await notesConnection.evaluate(`window.prism.listKnowledgeRelations(${JSON.stringify(createdTypes[0])})`)).find((item) => item.type === 'supports' && item.creator === 'ai' && item.reviewStatus === 'pending')
  const contextBeforeReview = await notesConnection.evaluate(`window.prism.retrieveResearchContext('수동 Paper 노트')`)
  assert(!contextBeforeReview.relations.some((item) => item.id === pendingSuggestedRelation.id), 'Graph-grounded retrieval followed an unapproved suggestion.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label$="AI 관계 승인"]').click()`)
  await waitFor(async () => (await notesConnection.evaluate(`window.prism.listKnowledgeRelations(${JSON.stringify(createdTypes[0])})`)).some((item) => item.id === pendingSuggestedRelation.id && item.reviewStatus === 'approved'), 'Approving an AI relation did not persist its reviewed status.')
  const approvedSuggestionMarkdown = await fs.readFile(paperSuggestionPath, 'utf8')
  assert(approvedSuggestionMarkdown.includes(pendingSuggestedRelation.id) && approvedSuggestionMarkdown.includes('> [!abstract] 관계 · 지지함'), 'Approving an AI relation did not append its human-readable Markdown relation block.')
  const contextAfterReview = await notesConnection.evaluate(`window.prism.retrieveResearchContext('수동 Paper 노트')`)
  assert(contextAfterReview.relations.some((item) => item.id === pendingSuggestedRelation.id && item.reviewStatus === 'approved'), 'Graph-grounded retrieval did not follow an approved AI suggestion.')

  const rejectedFixture = await notesConnection.evaluate(`(async () => { const snapshot = await window.prism.readKnowledgeNode(${JSON.stringify(createdTypes[0])}); return window.prism.createKnowledgeRelation({ sourceId: ${JSON.stringify(createdTypes[0])}, targetId: ${JSON.stringify(createdTypes[2])}, type: 'extends', creator: 'ai', expectedRevision: snapshot.revision }); })()`)
  assert(rejectedFixture.saved && rejectedFixture.relation.reviewStatus === 'pending', 'The rejection fixture was not created as a pending AI relation.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager-body > aside button')].find((button) => button.textContent.includes('노이즈 예측은')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'The review fixture could not navigate away from its source.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager-body > aside button')].find((button) => button.textContent.includes('수동 Paper 노트')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('button[aria-label="목적함수 연결 아이디어 AI 관계 거절"]'))`), 'The second pending relation did not appear for rejection.')
  const markdownBeforeReject = await fs.readFile(paperSuggestionPath, 'utf8')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="목적함수 연결 아이디어 AI 관계 거절"]').click()`)
  await waitFor(async () => (await notesConnection.evaluate(`window.prism.listKnowledgeRelations(${JSON.stringify(createdTypes[0])})`)).some((item) => item.id === rejectedFixture.relation.id && item.reviewStatus === 'rejected'), 'Rejecting an AI relation did not persist its reviewed status.')
  assert(await fs.readFile(paperSuggestionPath, 'utf8') === markdownBeforeReject, 'Rejecting an AI relation changed user Markdown.')
  assert(!(await notesConnection.evaluate(`window.prism.retrieveResearchContext('수동 Paper 노트')`)).relations.some((item) => item.id === rejectedFixture.relation.id), 'Graph-grounded retrieval followed a rejected AI relation.')
  assert(duplicateConceptId.startsWith('concept-'), 'The duplicate Concept fixture did not retain a stable ID.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager-body > aside button')].find((button) => button.textContent.includes('노이즈 예측은')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측')`), 'The origin Claim did not reopen after suggestion review.')

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
  const copyTargetPath = path.join(libraryPath, 'Concepts', 'Reverse diffusion.md')
  const copyTargetOriginal = await fs.readFile(copyTargetPath, 'utf8')
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.trim() === '복사').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-copy-picker'))`), 'The evidence card copy picker did not open.')
  const evidenceCopyScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const evidenceCopyScreenshotPath = path.resolve('tmp/ui/notes-evidence-copy.png')
  await fs.writeFile(evidenceCopyScreenshotPath, Buffer.from(evidenceCopyScreenshot.data, 'base64'))
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-copy-picker > div > button')].find((button) => button.querySelector('strong')?.textContent === 'Reverse diffusion').click()`)
  await waitFor(async () => (await fs.readFile(copyTargetPath, 'utf8')).includes('^evidence-test-0001-equation-p2-3'), 'Copying an evidence card did not preserve its portable Markdown block in the target note.')
  assert((await fs.readFile(claimPath, 'utf8')).includes('^evidence-test-0001-equation-p2-3'), 'Copying an evidence card changed the source note.')
  await fs.writeFile(copyTargetPath, copyTargetOriginal, 'utf8')
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.trim() === '복사').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-copy-picker'))`), 'The evidence card copy picker did not reopen for conflict verification.')
  const conflictCopyTargetPath = path.join(libraryPath, 'Questions', '가중치는 품질에 어떤 영향을 주는가.md')
  await fs.appendFile(conflictCopyTargetPath, '\n외부에서 추가한 질문 메모.\n', 'utf8')
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-copy-picker > div > button')].find((button) => button.querySelector('strong')?.textContent.includes('가중치는 품질에')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-manager > footer > span')?.textContent.includes('외부에서 변경')`), 'A stale target revision did not stop evidence card copying.')
  assert((await fs.readFile(conflictCopyTargetPath, 'utf8')).includes('외부에서 추가한 질문 메모.') && !(await fs.readFile(conflictCopyTargetPath, 'utf8')).includes('^evidence-test-0001-equation-p2-3'), 'Conflict-safe evidence copying overwrote the external target or inserted the card anyway.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="근거 카드 복사 닫기"]').click()`)
  await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n@문장' })
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.evidence-link-menu strong')?.textContent === '문장1'`), 'Typing @ in the Notes editor did not search PDF evidence anchors.')
  const evidenceAutocompleteScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const evidenceAutocompleteScreenshotPath = path.resolve('tmp/ui/notes-evidence-autocomplete.png')
  await fs.writeFile(evidenceAutocompleteScreenshotPath, Buffer.from(evidenceAutocompleteScreenshot.data, 'base64'))
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await notesConnection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('^evidence-test-0001-sentence-p1-1'), 'The @ evidence autocomplete did not save a portable evidence card.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="문장1 근거 링크 삭제"]').click()`)
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => !(await fs.readFile(claimPath, 'utf8')).includes('^evidence-test-0001-sentence-p1-1'), 'Removing the @-inserted evidence did not preserve the original evidence card.')
  await notesConnection.evaluate(`document.querySelector('.evidence-card-actions button[aria-label$="Obsidian에서 열기"]').click()`)
  await waitFor(async () => (await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/).length === 3, 'Opening an evidence block in Obsidian did not invoke a block-addressed URI.')
  obsidianLocations = (await fs.readFile(externalUrlLog, 'utf8')).trim().split(/\r?\n/).map((uri) => new URL(uri).searchParams.get('path'))
  assert(obsidianLocations[2] === `${claimPath}#^evidence-test-0001-equation-p2-3`, 'The Obsidian URI did not preserve the evidence block target.')
  const obsidianScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const obsidianScreenshotPath = path.resolve('tmp/ui/notes-obsidian-navigation.png')
  await fs.writeFile(obsidianScreenshotPath, Buffer.from(obsidianScreenshot.data, 'base64'))
  knowledgeViews = await notesConnection.evaluate(`window.prism.listKnowledgeDataViews()`)
  assert(knowledgeViews.unsupportedClaims.length === 0, 'A Claim with an embedded PDF evidence card remained in the unsupported view.')
  const evidenceContext = await notesConnection.evaluate(`window.prism.retrieveResearchContext('노이즈 예측 score matching')`)
  assert(evidenceContext.evidence.some((item) => item.nodeId === claimNodeId && item.anchorId === 'equation-p2-3' && item.source.includes('L_simple')), 'Graph-grounded retrieval did not return the exact PDF evidence separately from user-authored notes.')
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
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.includes('Claim 연결')).click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean(document.querySelector('.evidence-claim-picker')) && document.querySelector('.evidence-claim-picker strong')?.textContent === 'Score matching 근거 주장'`), 'The evidence-to-Claim picker did not find the existing Claim.')
  const evidenceClaimScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const evidenceClaimScreenshotPath = path.resolve('tmp/ui/notes-evidence-claim.png')
  await fs.writeFile(evidenceClaimScreenshotPath, Buffer.from(evidenceClaimScreenshot.data, 'base64'))
  await notesConnection.evaluate(`document.querySelector('.evidence-claim-picker > div > button').click()`)
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.includes('관계 변경'))) && document.querySelector('.knowledge-relations')?.textContent.includes('지지함')`), 'Connecting evidence to an existing Claim did not create the selected relation.')
  let evidenceRelationRecord = (await notesConnection.evaluate(`window.prism.listKnowledgeRelations(${JSON.stringify(claimNodeId)})`)).find((item) => item.evidenceAnchor?.anchorId === 'equation-p2-3')
  assert(evidenceRelationRecord?.type === 'supports' && evidenceRelationRecord.evidenceAnchor.paperId === 'test.0001' && evidenceRelationRecord.evidenceAnchor.page === 2, 'The relation sidecar did not preserve its direct PDF evidence anchor.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.evidence-card-actions button')].find((button) => button.textContent.includes('관계 변경')).click()`)
  await notesConnection.evaluate(`(() => { const select = document.querySelector('select[aria-label="근거 Claim 관계 유형"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'contradicts'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await notesConnection.evaluate(`document.querySelector('.evidence-claim-picker > div > button').click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-relations')?.textContent.includes('반박함')`), 'Changing an evidence relation did not update the visible relation type.')
  evidenceRelationRecord = (await notesConnection.evaluate(`window.prism.listKnowledgeRelations(${JSON.stringify(claimNodeId)})`)).find((item) => item.evidenceAnchor?.anchorId === 'equation-p2-3')
  assert(evidenceRelationRecord?.type === 'contradicts' && evidenceRelationRecord.evidenceAnchor.label === '수식1', 'Changing an evidence relation lost its direct anchor or did not update the sidecar type.')
  assert((await fs.readFile(claimPath, 'utf8')).includes('> [!abstract] 관계 · 반박함'), 'Changing an evidence relation did not update its human-readable Markdown block.')
  await notesConnection.evaluate(`document.querySelector('button[aria-label="수식1 근거 링크 삭제"]').click()`)
  await waitFor(() => notesConnection.evaluate(`!document.querySelector('.evidence-strip article')`), 'Removing an evidence link did not remove its document card.')
  assert(await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content')?.textContent.includes('사용자가 문서형 화면에서 추가한 판단.')`), 'Removing an evidence link also removed user-authored content.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => !(await fs.readFile(claimPath, 'utf8')).includes('prism-evidence:'), 'Removing an evidence link was not saved to Markdown.')
  await notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content').focus()`)
  await notesConnection.send('Input.insertText', { text: '\n\n[[새로운 즉시 개념' })
  await waitFor(() => notesConnection.evaluate(`Boolean([...document.querySelectorAll('.wiki-link-menu footer button')].find((button) => button.textContent.includes('Concept로 만들기'))) `), 'An unmatched inline link did not offer immediate Concept and Claim creation.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.wiki-link-menu footer button')].find((button) => button.textContent.includes('Concept로 만들기')).click()`)
  await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-editor .cm-content')?.textContent.includes('Concepts/새로운 즉시 개념')`), 'Immediate Concept creation did not insert its portable wiki link.')
  await notesConnection.evaluate(`[...document.querySelectorAll('.knowledge-manager footer button')].find((button) => button.textContent.includes('저장')).click()`)
  await waitFor(async () => (await fs.readFile(claimPath, 'utf8')).includes('[[Concepts/새로운 즉시 개념|새로운 즉시 개념]]') && Boolean(await fs.stat(path.join(libraryPath, 'Concepts', '새로운 즉시 개념.md'))), 'The immediately created Concept and link were not stored as Markdown files.')
  try {
    await waitFor(() => notesConnection.evaluate(`document.querySelector('.knowledge-heading h3')?.textContent.includes('노이즈 예측') && document.querySelector('.knowledge-editor .cm-content')?.textContent.includes('새로운 즉시 개념')`), 'The editor did not settle after saving the immediately created Concept link.')
  } catch (reason) {
    const debug = await notesConnection.evaluate(`(async () => ({ heading: document.querySelector('.knowledge-heading h3')?.textContent, loading: document.querySelector('.knowledge-loading')?.textContent, active: [...document.querySelectorAll('.knowledge-manager-body > aside button.active')].map((item) => item.textContent), nodes: (await window.prism.listKnowledgeNodes()).map((item) => ({ id: item.id, title: item.title })) }))()`)
    throw new Error(`${reason.message} Debug: ${JSON.stringify(debug)}\n${(await fs.readFile(claimPath, 'utf8')).slice(0, 700)}`)
  }
  const inlineCreateScreenshot = await notesConnection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const inlineCreateScreenshotPath = path.resolve('tmp/ui/notes-inline-create.png')
  await fs.writeFile(inlineCreateScreenshotPath, Buffer.from(inlineCreateScreenshot.data, 'base64'))
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
  process.stdout.write(`Notes UI smoke passed: knowledge nodes, template favorites, recent use, exact template versions and missing-section application, Project templates and research data views, Obsidian file/heading/block navigation, structured properties, hybrid search, graph-grounded suggestions with explicit AI relation review, link-plus-relation creation, inline knowledge and @ evidence autocomplete, link previews, immediate Concept creation, conflict-safe evidence copying, evidence-to-Claim relations and direct anchors, backlinks, typed relations and local graph navigation, evidence relinking, promotion and backlinks, templates, document editing, safe external changes, conflict resolution, toolbar, slash commands, exact Markdown, reading, and split modes.\nScreenshots: ${screenshotPath}, ${conflictScreenshotPath}, ${templateScreenshotPath}, ${templateLifecycleScreenshotPath}, ${missingSectionsScreenshotPath}, ${knowledgeScreenshotPath}, ${dataViewsScreenshotPath}, ${obsidianScreenshotPath}, ${linksScreenshotPath}, ${autocompleteScreenshotPath}, ${linkPreviewScreenshotPath}, ${evidenceAutocompleteScreenshotPath}, ${inlineCreateScreenshotPath}, ${evidenceCopyScreenshotPath}, ${evidenceClaimScreenshotPath}, ${relationsScreenshotPath}, ${graphScreenshotPath}, ${searchScreenshotPath}, ${suggestionsScreenshotPath}, ${duplicateScreenshotPath}, ${reviewScreenshotPath}, ${promotionScreenshotPath}, ${backlinkScreenshotPath}\n`)
} finally {
  notesConnection?.socket.close()
  mainConnection?.socket.close()
  if (electron.exitCode === null) {
    electron.kill()
    await new Promise((resolve) => electron.once('exit', resolve))
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
