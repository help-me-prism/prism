import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { confusionFromChat, focusFromChat, messagesForPaper, pruneEmptySections, readChatMessages, refreshPaperDigest, writeAutoSection } from '../dist-electron/paperDigest.js'
import { migratePaperNotes, readKnowledgeNode, saveKnowledgeNode } from '../dist-electron/knowledge.js'

// The digest writes the mechanical part of a paper note and must never touch the researcher's own words.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-digest-test-'))
try {
  const paperDir = path.join(root, 'papers', 'test.0001')
  const notePath = path.join(paperDir, 'test.0001.md')
  await fs.mkdir(paperDir, { recursive: true })
  await fs.writeFile(notePath, `---\ntype: paper\narxiv_id: "test.0001"\ntitle: "Flow Matching"\n---\n\n# Flow Matching\n\n> [!abstract]- Abstract\n> We propose flow matching. It trains a vector field without simulation. It beats diffusion on CIFAR10.\n\n## 한눈에\n\n## 내가 헷갈린 것\n\n## 내가 주목한 것\n\n## 내 생각\n\n손으로 쓴 내 문장은 절대 사라지면 안 된다.\n\n## 메모\n\n캡처한 메모.\n`, 'utf8')
  await migratePaperNotes(root)

  const messages = [
    { role: 'user', text: '이 논문에서 velocity field가 왜 필요한가요?', createdAt: 10, paperIds: ['test.0001'], anchors: [{ paperId: 'test.0001', anchorId: 'eq-1', label: '수식1', page: 3, source: 'v_t(x) is the vector field' }] },
    { role: 'assistant', text: '벡터장은 확률 경로를 정의합니다.', createdAt: 11, paperIds: ['test.0001'] },
    { role: 'user', text: 'velocity field가 왜 필요한지 아직 이해가 안 돼요', createdAt: 20, paperIds: ['test.0001'], anchors: [{ paperId: 'test.0001', anchorId: 'eq-1', label: '수식1', page: 3 }] },
    { role: 'user', text: 'CIFAR10 결과는 표 2에 있나요?', createdAt: 30, anchors: [{ paperId: 'test.0001', anchorId: 'table-2', label: '표2', page: 7, source: 'FID comparison' }] },
    { role: 'user', text: '다른 논문 이야기입니다', createdAt: 40, paperIds: ['other.9999'] },
  ]

  // Attribution comes from the recorded paper context or from any anchor in the message.
  assert.equal(messagesForPaper(messages, 'test.0001').length, 4)
  assert.equal(messagesForPaper(messages, 'other.9999').length, 1)

  const focus = focusFromChat(messagesForPaper(messages, 'test.0001'), 'test.0001')
  assert(focus[0].label === '수식1' && focus[0].count === 2 && focus[0].page === 3, `The most-referenced anchor was not first: ${JSON.stringify(focus)}`)
  assert(focus.some((item) => item.label === '표2'), 'A referenced table was dropped from the focus list.')

  const confusion = confusionFromChat(messagesForPaper(messages, 'test.0001'))
  assert(confusion[0].count === 2 && confusion[0].text.includes('velocity field'), `A repeated question was not counted as confusion: ${JSON.stringify(confusion)}`)
  assert(!confusion.some((item) => item.text.includes('벡터장은 확률 경로')), 'An assistant answer leaked into the confusion list.')

  // writeAutoSection replaces only its own region.
  const seeded = writeAutoSection('# T\n\n## 한눈에\n\n## 내 생각\n\n내 문장\n', 'overview', '- 첫 줄')
  assert(seeded.includes('<!-- prism:auto overview -->\n- 첫 줄\n<!-- /prism:auto overview -->') && seeded.includes('내 문장'), `The section was not inserted under its heading:\n${seeded}`)
  const rewritten = writeAutoSection(seeded, 'overview', '- 두 번째 줄')
  assert(rewritten.includes('- 두 번째 줄') && !rewritten.includes('- 첫 줄') && rewritten.includes('내 문장'), 'Rewriting a section changed something else.')
  const missingHeading = writeAutoSection('# T\n\n## 내 생각\n\n내 문장\n', 'focus', '- 값')
  assert(missingHeading.indexOf('## 내가 주목한 것') < missingHeading.indexOf('## 내 생각'), 'A new auto section was placed after the researcher\'s own section.')

  // A full refresh without a model: deterministic sections, user text untouched.
  const before = await fs.readFile(notePath, 'utf8')
  const result = await refreshPaperDigest(root, 'paper-test.0001', messages)
  assert(result.updated && result.chatMessages === 4 && !result.usedModel, `The deterministic refresh did not run: ${JSON.stringify(result)}`)
  const after = await fs.readFile(notePath, 'utf8')
  assert(after.includes('손으로 쓴 내 문장은 절대 사라지면 안 된다.') && after.includes('캡처한 메모.'), 'The digest overwrote the researcher\'s own writing.')
  assert(after.includes('We propose flow matching.'), 'The digest dropped the abstract.')
  assert(/<!-- prism:auto overview -->[\s\S]*flow matching[\s\S]*<!-- \/prism:auto overview -->/i.test(after), `The overview was not filled from the abstract:\n${after}`)
  assert(/<!-- prism:auto confusion -->[\s\S]*velocity field[\s\S]*2번 물어봄[\s\S]*<!-- \/prism:auto confusion -->/.test(after), 'The confusion section did not record the repeated question.')
  assert(/<!-- prism:auto focus -->[\s\S]*수식1 \(p\.3\) · 2번 참조[\s\S]*<!-- \/prism:auto focus -->/.test(after), 'The focus section did not record the repeated anchor.')
  assert.equal(before.split('## 내 생각').length, after.split('## 내 생각').length, 'The digest duplicated a heading.')

  // Running again with no new chat is a no-op; new chat updates only the generated regions.
  assert.equal((await refreshPaperDigest(root, 'paper-test.0001', messages)).updated, false, 'An unchanged digest rewrote the file.')
  const edited = await readKnowledgeNode(root, 'paper-test.0001')
  await saveKnowledgeNode(root, 'paper-test.0001', { content: `${edited.content}\n\n사용자가 나중에 추가한 줄.\n`, expectedRevision: edited.revision })
  await refreshPaperDigest(root, 'paper-test.0001', [...messages, { role: 'user', text: 'optimal transport 경로가 왜 더 곧은가요?', createdAt: 50, paperIds: ['test.0001'] }])
  const updated = await fs.readFile(notePath, 'utf8')
  assert(updated.includes('optimal transport') && updated.includes('사용자가 나중에 추가한 줄.'), 'A later refresh lost the user edit or missed the new question.')

  // The model may replace the generated bullets, and a broken response falls back to the deterministic text.
  const modelRun = await refreshPaperDigest(root, 'paper-test.0001', messages, async () => '```json\n{"overview":["모델이 쓴 한 줄"],"confusion":["velocity field의 역할을 반복해서 물었다"]}\n```')
  assert(modelRun.usedModel, 'The model response was ignored.')
  assert((await fs.readFile(notePath, 'utf8')).includes('모델이 쓴 한 줄'), 'The model overview was not written.')
  await refreshPaperDigest(root, 'paper-test.0001', messages, async () => 'not json at all')
  assert((await fs.readFile(notePath, 'utf8')).includes('We propose flow matching.'), 'A malformed model response broke the digest.')

  // Losing sight of the chat must never erase what the note already shows.
  const written = await fs.readFile(notePath, 'utf8')
  assert(written.includes('velocity field'), 'The confusion section should be populated before this check.')
  const withoutChat = await refreshPaperDigest(root, 'paper-test.0001', [])
  const afterEmpty = await fs.readFile(notePath, 'utf8')
  assert(afterEmpty.includes('velocity field'), 'An empty chat history wiped the generated confusion section.')
  assert.equal(withoutChat.sections.includes('confusion'), false, 'The digest rewrote a section it had nothing new for.')

  // Generated sections belong at the top, in order, under the abstract.
  const placed = await fs.readFile(notePath, 'utf8')
  const positions = ['overview', 'confusion', 'focus'].map((section) => placed.indexOf(`<!-- prism:auto ${section} -->`))
  assert(positions.every((index) => index > 0) && positions[0] < positions[1] && positions[1] < positions[2], `Generated sections are out of order: ${JSON.stringify(positions)}`)
  assert(positions[0] > placed.indexOf('[!abstract]') && positions[0] < placed.indexOf('## 내 생각'), 'The summary was not placed under the abstract and above the user section.')

  // Pruning removes only headings with nothing under them.
  const formy = await readKnowledgeNode(root, 'paper-test.0001')
  await saveKnowledgeNode(root, 'paper-test.0001', { content: `${formy.content}\n\n## 빈 섹션\n\n## 내용 있는 섹션\n\n여기엔 글이 있다.\n`, expectedRevision: formy.revision })
  const pruned = await pruneEmptySections(root, 'paper-test.0001')
  const afterPrune = await fs.readFile(notePath, 'utf8')
  assert(pruned.removed.includes('빈 섹션') && !afterPrune.includes('## 빈 섹션'), `An empty heading survived pruning: ${JSON.stringify(pruned.removed)}`)
  assert(afterPrune.includes('## 내용 있는 섹션') && afterPrune.includes('여기엔 글이 있다.'), 'Pruning removed a section that had content.')
  assert(afterPrune.includes('손으로 쓴 내 문장은 절대 사라지면 안 된다.') && afterPrune.includes('velocity field'), 'Pruning removed the researcher\'s writing or a generated section.')

  // Chat is read from Electron userData, skipping deleted conversations.
  const sessionsPath = path.join(root, 'sessions.json')
  await fs.writeFile(sessionsPath, JSON.stringify([
    { id: 'a', messages: [{ role: 'user', text: '살아있는 대화', createdAt: 1 }] },
    { id: 'b', deletedAt: 2, messages: [{ role: 'user', text: '지운 대화', createdAt: 2 }] },
  ]), 'utf8')
  const loaded = await readChatMessages(sessionsPath)
  assert(loaded.length === 1 && loaded[0].text === '살아있는 대화', 'Deleted conversations leaked into the digest.')
  assert.deepEqual(await readChatMessages(path.join(root, 'missing.json')), [], 'A missing sessions file should read as no chat.')

  process.stdout.write('Paper digest passed: chat attribution, repeated-question and repeated-anchor extraction, marker-scoped rewriting that preserves user writing, no-op reruns, model override with fallback, and userData chat reading.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
