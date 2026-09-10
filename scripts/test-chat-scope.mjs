import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertChatScope } from '../dist-electron/chatScope.js'
import { readChatMessages } from '../dist-electron/paperDigest.js'
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prism-chat-scope-')))
try {
  const a = path.join(root, 'a'), b = path.join(root, 'b')
  await fs.mkdir(a); await fs.mkdir(b)
  assert.equal(await assertChatScope(a, a), a)
  assert.equal(await assertChatScope(null, undefined), null)
  await assert.rejects(assertChatScope(a, b), /변경/)
  await assert.rejects(assertChatScope(b, b, { libraryPath: a, messages: [{}] }), /다른 보관함/)
  await assert.rejects(assertChatScope(a, a, { messages: [{}] }), /이전 버전/)
  const sessions = path.join(root, 'sessions.json')
  await fs.writeFile(sessions, JSON.stringify([
    { libraryPath: a, messages: [{ text: 'A', paperIds: ['same-paper'] }] },
    { libraryPath: b, messages: [{ text: 'B', paperIds: ['same-paper'] }] },
    { messages: [{ text: 'legacy-unowned' }] },
    { libraryPath: a, deletedAt: 1, messages: [{ text: 'deleted' }] },
  ]))
  assert.deepEqual((await readChatMessages(sessions, a)).map(message => message.text), ['A'])
  assert.deepEqual((await readChatMessages(sessions, b)).map(message => message.text), ['B'])
  console.log('Chat scope passed: changed vault, resumed vault, legacy ownership and same-paper isolation.')
} finally {
  assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()))
  assert(path.basename(root).startsWith('prism-chat-scope-'))
  await fs.rm(root, { recursive: true, force: true })
}
