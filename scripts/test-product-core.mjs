import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateTranslation, reuseTranslations } from '../dist-electron/translationHarness.js'
import { readLocalPaper } from '../dist-electron/localPaper.js'
import { listPaperCitations } from '../dist-electron/citations.js'
import { readNoteSnapshot, saveNoteSnapshot } from '../dist-electron/notes.js'
import { downloadBytes } from '../dist-electron/downloadBytes.js'
import { crossrefPaper } from '../dist-electron/scholarlySearch.js'

const input = [{ id: 's1', source: 'The energy $E=mc^2$ is conserved [12].' }]
assert.equal(validateTranslation('[{"id":"s1","translation":"에너지 $E=mc^2$는 보존된다 [12]."}]', input).size, 1)
for (const output of ['[]', '[{"id":"other","translation":"안녕"}]', '[{"id":"s1","translation":"에너지는 보존된다."}]', 'not JSON', '[{"id":"s1","translation":""}]']) {
  assert.throws(() => validateTranslation(output, input))
}
assert.throws(() => validateTranslation('[{"id":"s1","translation":"a"},{"id":"s1","translation":"b"}]', [...input, { id: 's2', source: 'b' }]))
assert.equal(reuseTranslations([{ id: 's1', source: 'new' }], [{ id: 's1', source: 'old', translation: 'stale' }])[0].translation, undefined)
assert.equal(reuseTranslations([{ id: 's1', source: 'old' }], [{ id: 's1', source: 'old', translation: 'saved' }])[0].translation, 'saved')
const work = crossrefPaper({ DOI: '10.1038/test', title: ['A <i>biological</i> study'], author: [{ given: 'Ada', family: 'Kim' }], published: { 'date-parts': [[2026, 3]] }, 'container-title': ['Biology'] })
assert.equal(work.title, 'A biological study')
assert.equal(work.published, '2026-03')
assert.equal(work.authors[0], 'Ada Kim')
assert.equal(work.pdfUrl, '') // metadata must never masquerade as a downloaded paper
assert.equal(crossrefPaper({ DOI: 'javascript:alert(1)', title: ['bad'] }), null)
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-product-'))
try {
  const citationRequests = []
  const fetchCitation = async url => { citationRequests.push(url); return { ok: true, status: 200, json: async () => ({ data: [] }) } }
  await listPaperCitations(root, 'local-biological-paper', { refresh: true, externalId: 'DOI:10.1038/example', fetchImpl: fetchCitation })
  assert.equal(citationRequests.length, 2)
  assert(citationRequests.every(url => decodeURIComponent(url).includes('/paper/DOI:10.1038/example/')))
  const unidentified = await listPaperCitations(root, 'local-no-doi', { refresh: true, fetchImpl: fetchCitation })
  assert(unidentified.error.includes('DOI')); assert.equal(citationRequests.length, 2)
  const file = path.join(root, '세포 연구.pdf')
  await fs.writeFile(file, '%PDF-1.7\nfixture')
  const first = await readLocalPaper(file)
  const renamed = path.join(root, 'renamed.pdf'); await fs.copyFile(file, renamed)
  assert.equal((await readLocalPaper(renamed)).id, first.id)
  assert.equal(first.title, '세포 연구')
  const noteFile = path.join(root, 'Note.md'); await fs.writeFile(noteFile, 'original')
  const revision = (await readNoteSnapshot(noteFile)).revision
  const writes = await Promise.all(['first', 'second'].map(content => saveNoteSnapshot(noteFile, { content, expectedRevision: revision })))
  assert.equal(writes.filter(result => result.saved).length, 1)
  assert.equal(await fs.readFile(noteFile, 'utf8'), 'first')
  assert.equal((await downloadBytes(new Response('small'), 10)).toString(), 'small')
  await assert.rejects(downloadBytes(new Response('too large'), 3), /제한/)
  await fs.writeFile(file, 'not a pdf')
  await assert.rejects(readLocalPaper(file), /PDF/)
} finally { await fs.rm(root, { recursive: true, force: true }) }
console.log('Product core passed: translation gates, source-aware cache, Crossref mapping, PDF validation and content deduplication.')
