import assert from 'node:assert/strict'
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

process.stdout.write('Vault compatibility passed: Windows and macOS paths, URI encoding, heading/block targets, and traversal rejection.\n')
