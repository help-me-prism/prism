import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const modules = path.resolve(process.env.PRISM_ALIAS_TEST_MODULES || 'dist-electron')
const { wikiTargetResolver } = await import(pathToFileURL(path.join(modules, 'wikiTargets.js')))
const { listKnowledgeNodes, listKnowledgeBacklinks, readKnowledgeNode } = await import(pathToFileURL(path.join(modules, 'knowledge.js')))
const { syncLinkRelations, listKnowledgeRelations } = await import(pathToFileURL(path.join(modules, 'relations.js')))
const nodes = [
  { id: 'node-a', title: 'Renamed research', relativePath: 'Papers/a.md', aliases: ['Old research', 'Shared', 'Old research', 'node-b'] },
  { id: 'node-b', title: 'Current exact', relativePath: 'Concepts/b.md', aliases: ['Shared', 'Old, with comma', 'Papers/a'] },
  { id: 'node-c', title: 'Old research', relativePath: 'Claims/c.md', aliases: ['Current exact'] },
]
for (const list of [nodes, [...nodes].reverse()]) {
  const resolve = wikiTargetResolver(list)
  assert.equal(resolve('node-b').id, 'node-b', 'Stable ID wins over an alias')
  assert.equal(resolve('Papers\\a.md#Evidence|Shown').id, 'node-a', 'Exact path wins over a competing alias')
  assert.equal(resolve('Old research').id, 'node-c', 'Current exact title wins over a historical alias')
  assert.equal(resolve('Shared'), undefined, 'Duplicate aliases must not depend on inventory order')
  assert.equal(resolve('Old, with comma').id, 'node-b')
}
const duplicateTitles = wikiTargetResolver([...nodes, { id: 'node-d', title: 'Old research', relativePath: 'Other/d.md' }])
assert.equal(duplicateTitles('Old research'), undefined, 'Ambiguous current titles cannot fall through to a unique historical alias')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-wiki-aliases-'))
try {
  await fs.mkdir(path.join(root, 'Concepts'))
  const note = (id, title, aliases, body = '') => `---\ntype: concept\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\n${aliases}\n---\n\n${body}\n`
  await fs.writeFile(path.join(root, 'Concepts', 'stable-target.md'), note('node-target', 'New title', 'aliases: ["Old title", "Old, with comma"]'))
  await fs.writeFile(path.join(root, 'Concepts', 'other.md'), note('node-other', 'Other', 'aliases:\n  - "Shared"'))
  await fs.writeFile(path.join(root, 'Concepts', 'third.md'), note('node-third', 'Third', 'aliases:\n  - "Shared"'))
  await fs.writeFile(path.join(root, 'Concepts', 'source.md'), note('node-source', 'Source', '', '[[Old title]] and [[Old, with comma]] and [[Shared]].'))
  assert.deepEqual((await listKnowledgeNodes(root)).find(node => node.id === 'node-target').aliases, ['Old title', 'Old, with comma'])
  assert.deepEqual((await listKnowledgeNodes(root)).find(node => node.id === 'node-other').aliases, ['Shared'])
  assert.equal((await listKnowledgeBacklinks(root, 'node-target')).length, 1, 'Old title links survive a rename and deduplicate their source')
  assert.equal((await listKnowledgeBacklinks(root, 'node-other')).length, 0)
  await syncLinkRelations(root, 'node-source')
  assert.deepEqual((await listKnowledgeRelations(root, 'node-source')).map(edge => edge.targetId), ['node-target'], 'Derived graph and backlinks agree on aliases and ambiguity')
  await fs.writeFile(path.join(root, 'Concepts', 'exact.md'), note('node-exact01', 'Old title', '', 'Current title owner.'))
  await fs.writeFile(path.join(root, 'Concepts', 'source.md'), note('node-source', 'Source', '', '[[Old title]]'))
  assert.equal(wikiTargetResolver(await listKnowledgeNodes(root))('Old title')?.id, 'node-exact01')
  assert((await readKnowledgeNode(root, 'node-source')).content.includes('[[Old title]]'))
  await syncLinkRelations(root, 'node-source')
  assert.deepEqual((await listKnowledgeRelations(root, 'node-source')).map(edge => edge.targetId), ['node-exact01'])
  assert.equal((await listKnowledgeBacklinks(root, 'node-target')).length, 0)
  assert.equal((await listKnowledgeBacklinks(root, 'node-exact01')).length, 1)
  console.log('Wiki aliases passed: metadata formats, comma titles, exact ID/path/title precedence, ambiguity, backlink deduplication and graph parity after rename.')
} finally { await fs.rm(root, { recursive: true, force: true }) }
