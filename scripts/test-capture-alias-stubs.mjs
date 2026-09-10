import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureLinkStubs } from '../dist-electron/capture.js'
import { listKnowledgeNodes, invalidateKnowledgeCache, listKnowledgeBacklinks } from '../dist-electron/knowledge.js'

const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-capture-alias-'))
try {
  await fs.mkdir(path.join(vault, 'Concepts'), { recursive: true })
  const note = (id, title, aliases, body = '') => `---\ntype: concept\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\naliases: ${JSON.stringify(aliases)}\n---\n# ${title}\n\n${body}\n`
  await fs.writeFile(path.join(vault, 'Concepts', 'original-file.md'), note('stable-id', 'Renamed paper', ['Old paper title', 'Shared alias', 'Result, with comma']))
  await fs.writeFile(path.join(vault, 'Concepts', 'other.md'), note('other-id', 'Other research', ['Shared alias']))
  const source = '[[Old paper title]] [[old PAPER title#Results|earlier result]] [[Shared alias]] [[Result, with comma]] [[stable-id]] [[Concepts/original-file]] [[Renamed paper]]'
  await fs.writeFile(path.join(vault, 'Concepts', 'source.md'), note('source-id', 'Reading notes', [], source))
  invalidateKnowledgeCache(vault)
  const before = (await fs.readdir(path.join(vault, 'Concepts'))).sort()
  assert.deepEqual(await ensureLinkStubs(vault, source), [])
  assert.deepEqual((await fs.readdir(path.join(vault, 'Concepts'))).sort(), before, 'Existing/ambiguous aliases never create shadow notes')
  assert((await listKnowledgeBacklinks(vault, 'stable-id')).some(item => item.nodeId === 'source-id'), 'Preserved alias still points to original node')
  assert.deepEqual(await ensureLinkStubs(vault, '[[A genuinely new concept]]'), ['A genuinely new concept'])
  assert.deepEqual(await ensureLinkStubs(vault, '[[A genuinely new concept]]'), [], 'Normal creation remains idempotent')
  const nodes = await listKnowledgeNodes(vault)
  assert.equal(nodes.filter(item => item.title === 'A genuinely new concept').length, 1)
  assert(!nodes.some(item => item.title === 'Shared alias' || item.title === 'Old paper title'))
  console.log('Capture alias stubs: actual vault preserves renamed/ambiguous/commas/ID/path targets and only creates genuinely missing notes')
} finally { await fs.rm(vault, { recursive: true, force: true }) }
