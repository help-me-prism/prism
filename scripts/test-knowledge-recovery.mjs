import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { listKnowledgeNodes, listKnowledgeRecoveries, readKnowledgeRecovery, recoverKnowledgeNote } from '../dist-electron/knowledge.js'
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-knowledge-recovery-'))
const vault = path.join(temp, 'vault'), foreign = path.join(temp, 'foreign')
await fs.mkdir(vault); await fs.mkdir(foreign)
const body = (id, text) => `---\ntype: concept\nprism_id: "${id}"\ntitle: "Recovered research"\nstatus: developing\n---\n\n# Recovered research\n\n${text}\n`
async function fixture(root, relative, title, nodeId) {
  const parent = path.join(root, relative), transaction = randomUUID()
  const history = path.join(parent, '.prism-note-history', transaction)
  await fs.mkdir(history, { recursive: true })
  await fs.writeFile(path.join(history, 'metadata.json'), JSON.stringify({ version: 1, state: 'publishing', noteFile: title, createdAt: new Date().toISOString() }))
  await fs.writeFile(path.join(history, 'draft.md'), body(nodeId, 'Prism research draft'))
  await fs.writeFile(path.join(history, 'before.md'), body(nodeId, 'Earlier research'))
  return { parent, transaction, history, note: path.join(parent, title) }
}
try {
  const missing = await fixture(vault, 'Concepts', 'Missing.md', 'concept-missing001')
  assert(!(await listKnowledgeNodes(vault)).some(node => node.id === 'concept-missing001'), 'Publishing-gap note should not exist in the index')
  const entries = await listKnowledgeRecoveries(vault)
  const entry = entries.find(item => item.noteFile === 'Missing.md')
  assert(entry && entry.kinds.includes('draft') && entry.kinds.includes('before'), 'Vault inventory must discover an unindexed missing note')
  assert.equal(await readKnowledgeRecovery(vault, entry.id, 'draft'), body('concept-missing001', 'Prism research draft'))
  await fixture(foreign, 'Concepts', 'Foreign.md', 'concept-foreign01')
  await assert.rejects(readKnowledgeRecovery(foreign, entry.id, 'draft'))
  await assert.rejects(recoverKnowledgeNote(foreign, entry.id, 'draft'))
  await assert.rejects(readKnowledgeRecovery(vault, Buffer.from(JSON.stringify([foreign, 'Concepts', missing.transaction])).toString('base64url'), 'draft'))
  await recoverKnowledgeNote(vault, entry.id, 'draft')
  assert.equal(await fs.readFile(missing.note, 'utf8'), body('concept-missing001', 'Prism research draft'))
  assert((await listKnowledgeNodes(vault)).some(node => node.id === 'concept-missing001'), 'Restored note must enter the actual node index')
  assert(!(await listKnowledgeRecoveries(vault)).some(item => item.id === entry.id))
  const stale = await fixture(vault, 'Questions', 'Stale.md', 'concept-stale0001')
  const staleEntry = (await listKnowledgeRecoveries(vault)).find(item => item.noteFile === 'Stale.md')
  await fs.writeFile(stale.note, 'Externally recreated destination')
  await assert.rejects(recoverKnowledgeNote(vault, staleEntry.id, 'before'))
  assert.equal(await fs.readFile(stale.note, 'utf8'), 'Externally recreated destination')
  const outside = await fixture(temp, 'outside', 'Outside.md', 'concept-outside01')
  await fs.rmdir(path.join(vault, 'Claims'))
  await fs.symlink(outside.parent, path.join(vault, 'Claims'), process.platform === 'win32' ? 'junction' : 'dir')
  await fs.mkdir(path.join(vault, 'papers'), { recursive: true })
  await fs.symlink(outside.parent, path.join(vault, 'papers', 'linked-paper'), process.platform === 'win32' ? 'junction' : 'dir')
  assert(!(await listKnowledgeRecoveries(vault)).some(item => item.noteFile === 'Outside.md'), 'Folder links must not expose outside-vault recoveries')
  await assert.rejects(recoverKnowledgeNote(vault, Buffer.from(JSON.stringify([await fs.realpath(vault), 'Claims', outside.transaction])).toString('base64url'), 'draft'))
  assert.equal(await fs.stat(outside.note).then(() => true, () => false), false)
  console.log('knowledge-recovery: unindexed vault discovery, preview/restore/index refresh, foreign IDs, stale target and junction containment passed')
} finally { await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
