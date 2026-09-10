import assert from 'node:assert/strict'
import { withTaskLock } from '../dist-electron/taskLock.js'
let finish, calls = 0
const pending = withTaskLock('vault-a/note', () => { calls++; return new Promise(resolve => { finish = resolve }) })
await assert.rejects(withTaskLock('vault-a/note', async () => { calls++ }), /이미 진행/)
assert.equal(calls, 1)
assert.equal(await withTaskLock('vault-b/note', async () => 'other vault'), 'other vault')
finish('done'); assert.equal(await pending, 'done')
await assert.rejects(withTaskLock('vault-a/note', async () => { throw new Error('failure') }), /failure/)
assert.equal(await withTaskLock('vault-a/note', async () => 'retry'), 'retry')
console.log('Task lock: no duplicate model call, independent vaults, retry after success and failure.')
