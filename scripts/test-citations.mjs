import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listPaperCitations } from '../dist-electron/citations.js'
import { migratePaperNotes } from '../dist-electron/knowledge.js'

// The citation layer is cached per paper and matched against library papers; the network is a stub here.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-citations-test-'))
try {
  for (const id of ['test.0001', '1706.03762']) {
    const dir = path.join(root, 'papers', id); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${id}.md`), `---\ntype: paper\narxiv_id: "${id}"\ntitle: "Paper ${id}"\n---\n\n# Paper ${id}\n`, 'utf8')
  }
  await migratePaperNotes(root)
  let calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('/references')) return { ok: true, status: 200, json: async () => ({ data: [
      { citedPaper: { title: 'Attention Is All You Need', year: 2017, citationCount: 100000, externalIds: { ArXiv: '1706.03762' }, authors: [{ name: 'Vaswani' }] } },
      { citedPaper: { title: 'Some unrelated book', year: 1999, citationCount: 5, externalIds: {}, authors: [] } },
      { citedPaper: { title: 'Bigger citation count but not in library', year: 2020, citationCount: 900, externalIds: { ArXiv: '2001.00001' }, authors: [] } },
      { citedPaper: null },
    ] }) }
    return { ok: true, status: 200, json: async () => ({ data: [{ citingPaper: { title: 'A follow-up', year: 2024, citationCount: 3, externalIds: { ArXiv: '2401.00001' }, authors: [{ name: 'Someone' }] } }] }) }
  }

  // Missing cache: fetch, store, match library papers, and put in-library entries first.
  const first = await listPaperCitations(root, 'test.0001', { fetchImpl })
  assert.equal(calls.length, 2)
  assert.equal(first.references.length, 3)
  assert(first.references[0].inLibrary && first.references[0].nodeId === 'paper-1706.03762' && first.references[0].arxivId === '1706.03762', 'The in-library reference was not matched to its Paper node or ordered first.')
  assert(first.references[1].title.startsWith('Bigger citation') && !first.references[1].inLibrary, 'Out-of-library references are not ordered by citation count.')
  assert.equal(first.citations.length, 1); assert.equal(first.citations[0].inLibrary, false)
  assert(!first.stale && !first.error)
  const cached = JSON.parse(await fs.readFile(path.join(root, '.prism', 'citations', 'test.0001.json'), 'utf8'))
  assert(cached.version === 1 && cached.references.length === 3 && !('inLibrary' in cached.references[0]), 'The cache stores raw entries only.')

  // Fresh cache: no network; cache-only mode never fetches even when stale; refresh forces a fetch.
  calls = []
  await listPaperCitations(root, 'test.0001', { fetchImpl })
  assert.equal(calls.length, 0, 'A fresh cache still hit the network.')
  cached.fetchedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await fs.writeFile(path.join(root, '.prism', 'citations', 'test.0001.json'), JSON.stringify(cached), 'utf8')
  const cacheOnly = await listPaperCitations(root, 'test.0001', { refresh: false, fetchImpl })
  assert(calls.length === 0 && cacheOnly.stale && cacheOnly.references.length === 3, 'Cache-only mode fetched or dropped stale data.')
  await listPaperCitations(root, 'test.0001', { fetchImpl })
  assert.equal(calls.length, 2, 'A stale cache was not refreshed by default.')
  calls = []
  await listPaperCitations(root, 'test.0001', { refresh: true, fetchImpl })
  assert.equal(calls.length, 2, 'refresh: true did not force a fetch.')

  // Network failure keeps the old cache and reports the error; with no cache it returns an empty, stale result.
  const failing = async () => ({ ok: false, status: 429, json: async () => ({}) })
  const failed = await listPaperCitations(root, 'test.0001', { refresh: true, fetchImpl: failing })
  assert(failed.references.length === 3 && failed.error?.includes('429'), 'A failed refresh dropped the cached graph or hid the error.')
  const none = await listPaperCitations(root, '1706.03762', { fetchImpl: failing })
  assert(none.references.length === 0 && none.stale && none.error, 'A paper without cache and without network did not return an empty stale result.')
  process.stdout.write('Citations passed: fetch and cache, library matching and ordering, cache-only and forced refresh modes, and failure fallback.\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
