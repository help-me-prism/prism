import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { replaceFileWithRetry } from '../dist-electron/atomicFile.js'
import { createKnowledgeNode } from '../dist-electron/knowledge.js'
import { buildObsidianOpenUri } from '../dist-electron/obsidian.js'

const windowsUri = new URL(buildObsidianOpenUri('C:\\Research Vault', 'Claims/Noise prediction.md', { blockId: 'evidence-p4-3' }, 'win32'))
assert.equal(windowsUri.protocol, 'obsidian:')
assert.equal(windowsUri.hostname, 'open')
assert.equal(windowsUri.searchParams.get('path'), 'C:\\Research Vault\\Claims\\Noise prediction.md#^evidence-p4-3')

const macUri = new URL(buildObsidianOpenUri('/Users/research/Research Vault', 'Questions/시간 가중치.md', { heading: '답변 초안' }, 'darwin'))
assert.equal(macUri.searchParams.get('path'), '/Users/research/Research Vault/Questions/시간 가중치.md#답변 초안')

assert.throws(() => buildObsidianOpenUri('/vault', '../outside.md', {}, 'darwin'))
assert.throws(() => buildObsidianOpenUri('C:\\vault', 'C:/outside.md', {}, 'win32'))
assert.throws(() => buildObsidianOpenUri('/vault', 'Claims/test.md', { heading: 'A', blockId: 'block' }, 'darwin'))
assert.throws(() => buildObsidianOpenUri('/vault', 'Claims/test.md', { blockId: '../block' }, 'darwin'))

const atomicFixture = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-atomic-rename-'))
try {
  const temporaryPath = path.join(atomicFixture, 'relation.json.tmp')
  const targetPath = path.join(atomicFixture, 'relation.json')
  await fs.writeFile(temporaryPath, '{"reviewStatus":"rejected"}', 'utf8')
  await fs.writeFile(targetPath, '{"reviewStatus":"pending"}', 'utf8')
  let attempts = 0
  await replaceFileWithRetry(temporaryPath, targetPath, async (source, target) => {
    attempts += 1
    if (attempts < 3) throw Object.assign(new Error('simulated Windows file contention'), { code: 'EPERM' })
    await fs.rename(source, target)
  })
  assert.equal(attempts, 3)
  assert.equal(await fs.readFile(targetPath, 'utf8'), '{"reviewStatus":"rejected"}')
} finally {
  await fs.rm(atomicFixture, { recursive: true, force: true })
}

// Display titles preserve scientific punctuation; only filenames obey Windows restrictions.
const titleVault = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-note-titles-'))
try {
  for (const title of ['세포 A/B: p < 0.05? \"대조군\" | 경로 C:\\실험', 'CON', 'NUL.txt', '마지막 점...']) {
    const created = await createKnowledgeNode(titleVault, { nodeType: 'question', title })
    const node = created.nodes.find(node => node.id === created.id)
    assert.equal(node.title, title, 'The display title lost meaningful punctuation')
    const absolute = path.resolve(titleVault, node.relativePath)
    assert.ok(absolute.startsWith(path.resolve(titleVault) + path.sep), 'A title escaped the vault')
    assert.equal(path.dirname(node.relativePath).replaceAll('\\', '/'), 'Questions')
    assert.ok(!/[<>:"/\\|?*]/.test(path.basename(node.relativePath)), 'The filename is not Windows safe')
    assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(path.basename(node.relativePath)), 'A reserved Windows filename was used')
    const content = await fs.readFile(absolute, 'utf8')
    assert.ok(content.includes(`title: ${JSON.stringify(title)}`), 'Obsidian frontmatter lost the full title')
    assert.ok(content.includes(`# ${title}`), 'The note heading lost the full title')
  }
} finally {
  await fs.rm(titleVault, { recursive: true, force: true })
}

process.stdout.write('Vault compatibility passed: Windows and macOS paths, URI encoding, heading/block targets, traversal rejection, and transient atomic replace recovery.\n')
