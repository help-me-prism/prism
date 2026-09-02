import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { replaceFileWithRetry } from '../dist-electron/atomicFile.js'
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

process.stdout.write('Vault compatibility passed: Windows and macOS paths, URI encoding, heading/block targets, traversal rejection, and transient atomic replace recovery.\n')
