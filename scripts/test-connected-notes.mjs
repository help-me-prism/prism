import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/connectedNotes.ts', 'utf8'), 'src/connectedNotes.ts')
const { connectedNoteRows, connectionDescription } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const other = { id: 'concept-one', title: 'Genome assembly', nodeType: 'concept', relativePath: 'Concepts/Genome assembly.md' }
const support = { id: 'support', type: 'supports', direction: 'outgoing', reviewStatus: 'approved', other }
const contradiction = { ...support, id: 'contradiction', type: 'contradicts', direction: 'incoming' }
const backlink = { nodeId: other.id, ...other, excerpt: 'This experiment qualifies [[Genome assembly]].' }
const rows = connectedNoteRows([support, contradiction, support, { ...support, id: 'pending', reviewStatus: 'pending' }], [backlink, { ...backlink, nodeId: 'paper-two', title: 'Second paper', excerpt: 'A separate mention.' }])
assert.equal(rows.length, 2, 'A backlink must enrich its existing destination rather than duplicate it')
assert.deepEqual(rows[0].relations.map(item => item.id), ['support', 'contradiction'], 'Distinct opposing relations must both remain visible')
assert.equal(rows[0].excerpt, backlink.excerpt)
assert.equal(rows[1].title, 'Second paper')
assert.equal(rows[1].relations.length, 0, 'A mention alone must not invent a typed relation')
for (const direction of ['incoming', 'outgoing']) assert.equal(connectionDescription({ type: 'related', direction }, '관련'), '관련 노트')
assert.equal(connectionDescription({ type: 'link', origin: 'link', direction: 'outgoing' }, '링크'), '이 노트에서 언급')
assert.equal(connectionDescription({ type: 'link', origin: 'link', direction: 'incoming' }, '링크'), '이 노트를 언급')
assert.equal(connectionDescription(support, '지지함'), '이 노트가 지지함')
assert.equal(connectionDescription(contradiction, '반박함'), '이 노트를 반박함')
console.log('Connected notes passed: unique destinations, retained mentions and opposing relations, and explicit direction.')
