import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('electron/paperTitle.ts', 'utf8'), 'electron/paperTitle.ts')
const { renamedPaperNote, updatePaperTitleRecord } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const body = '\n# Old title\n\nMy own findings: Old title remains here.\n[[papers/id/id|Old title]]\n'
const original = '---\ntype: paper\ntitle: "Old title"\nprism_id: "paper:id"\n---\n' + body
const changed = renamedPaperNote(original, 'Old title', 'New title')
assert(changed.includes('title: "New title"'))
assert(changed.includes('aliases: ["Old title"]'))
assert(changed.endsWith(body.replace('# Old title', '# New title')))
assert.equal(renamedPaperNote(changed, 'Old title', 'New title'), changed)
assert.equal(renamedPaperNote(original.replace('title: "Old title"', 'title: "My custom title"'), 'Old title', 'New title'), undefined)
assert(renamedPaperNote(original.replace('# Old title', '# My heading'), 'Old title', 'New title').includes('# My heading'))
const crlf = renamedPaperNote(original.replaceAll('\n', '\r\n'), 'Old title', 'New title')
assert(!/(?<!\r)\n/.test(crlf))
assert(renamedPaperNote(original.replace('type: paper', 'aliases:\n  - "Existing, alias"\ntype: paper'), 'Old title', 'New title').includes('["Existing, alias","Old title"]'))
assert.equal(renamedPaperNote(original.replace('type: paper', 'aliases: [unquoted, yaml]\ntype: paper'), 'Old title', 'New title'), undefined)
let records = [{ arxivId: 'id', title: 'Old title', pdfPath: '/same/original.pdf', notePath: '/same/id.md' }]
let owner = '/vault'; let commits = 0; let notified = 0
const deps = { currentLibrary: async () => owner, read: async () => structuredClone(records), commit: async next => { commits++; records = next }, propagate: async () => ['metadata warning'], notify: () => notified++ }
const request = { paperId: 'id', title: 'New title', expectedTitle: 'Old title', libraryPath: '/vault' }
const result = await updatePaperTitleRecord(request, deps)
assert.deepEqual(result.warnings, ['metadata warning'])
assert.equal(result.paper.notePath, '/same/id.md'); assert.equal(result.paper.pdfPath, '/same/original.pdf')
await updatePaperTitleRecord(request, deps); assert.equal(commits, 1, 'Retry is idempotent')
await assert.rejects(updatePaperTitleRecord({ ...request, title: 'Stale replacement' }, deps), /다른 곳/)
owner = '/other'; await assert.rejects(updatePaperTitleRecord(request, deps), /볼트/)
owner = '/vault'
await assert.rejects(updatePaperTitleRecord(request, { ...deps, read: async () => { owner = '/other'; return records } }), /볼트/)
assert.equal(commits, 1); assert.equal(notified, 2)
// Same queue contract as libraryWrites: concurrent edits observe the preceding committed title.
owner = '/vault'; records[0].title = 'Old title'; let queue = Promise.resolve()
const enqueue = input => { const run = queue.catch(() => {}).then(() => updatePaperTitleRecord(input, deps)); queue = run; return run }
const settled = await Promise.allSettled([enqueue(request), enqueue({ ...request, title: 'Concurrent title' })])
assert.equal(settled[0].status, 'fulfilled'); assert.equal(settled[1].status, 'rejected')
assert.equal(records[0].title, 'New title')
console.log('Paper title: body/CRLF/custom heading, aliases, CAS, owner, idempotency, partial warning and serialized concurrent edit passed')
