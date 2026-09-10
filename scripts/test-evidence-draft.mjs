import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/evidenceDraft.ts', 'utf8'), 'src/paper/evidenceDraft.ts')
const { readEvidenceDraft, writeEvidenceDraft } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const values = new Map()
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
const key = JSON.stringify(['vault-a', 'paper', 'anchor'])
writeEvidenceDraft(storage, key, { memo: '재실행 후 복원', concept: '개념' })
assert.deepEqual(readEvidenceDraft(storage, key), { memo: '재실행 후 복원', concept: '개념' })
assert.equal(readEvidenceDraft(storage, JSON.stringify(['vault-b', 'paper', 'anchor'])).memo, '')
assert.equal(readEvidenceDraft(storage, JSON.stringify(['vault-a', 'other', 'anchor'])).memo, '')
assert.throws(() => writeEvidenceDraft({ ...storage, setItem() { throw new Error('quota') } }, key, { memo: 'new', concept: '' }), /quota/)
assert.equal(readEvidenceDraft(storage, key).memo, '재실행 후 복원')
writeEvidenceDraft(storage, key, { memo: '', concept: '' })
assert.equal(values.size, 0)
console.log('Evidence drafts: restart recovery, vault/paper isolation, failed writes preserve disk, saved drafts clear.')
