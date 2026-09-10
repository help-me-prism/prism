import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSessionStore } from '../dist-electron/sessionStore.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-session-store-'))
try {
  const file = path.join(root, 'profile', 'sessions.json'), store = createSessionStore(file)
  assert.deepEqual(await store.read(), [])
  await Promise.all([store.write([{ id: 'a' }]), store.write([{ id: 'b' }])])
  assert.deepEqual(await store.read(), [{ id: 'b' }])
  assert.deepEqual(JSON.parse(await fs.readFile(file + '.backup', 'utf8')), [{ id: 'a' }])
  const large = [{ id: 'large', text: 'x'.repeat(16 * 1024 * 1024) }]
  await store.write(large)
  assert.equal((await store.read())[0].text.length, large[0].text.length)
  await fs.writeFile(file, '{corrupted')
  await assert.rejects(store.read(), /원본은 덮어쓰지/)
  await assert.rejects(store.write([]), /원본은 덮어쓰지/)
  assert.equal(await fs.readFile(file, 'utf8'), '{corrupted')
  console.log('Session storage: serialized writes, previous valid backup, >15MB history, corruption never overwritten.')
} finally { await fs.rm(root, { recursive: true, force: true }) }
