import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateTranslation, reuseTranslations } from '../dist-electron/translationHarness.js'
import { readLocalPaper } from '../dist-electron/localPaper.js'
import { listPaperCitations } from '../dist-electron/citations.js'
import { readNoteSnapshot, saveNoteSnapshot } from '../dist-electron/notes.js'
import { downloadBytes } from '../dist-electron/downloadBytes.js'
import { crossrefPaper, europePmcPaper, mergeScholarlyPapers, rankScholarlyPapers, semanticScholarPaper } from '../dist-electron/scholarlySearch.js'
import { parseJatsStructure } from '../dist-electron/jats.js'
import { isStoredPaperId } from '../dist-electron/paperIdentifier.js'

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
assert.equal(work.doi, '10.1038/test')
assert.equal(work.pdfUrl, '') // metadata must never masquerade as a downloaded paper
assert.equal(crossrefPaper({ DOI: 'javascript:alert(1)', title: ['bad'] }), null)
const linkedWork = crossrefPaper({ DOI: '10.1371/journal.pone.0287690', title: ['Concrete pores'], link: [{ URL: 'https://journals.example/paper.pdf', 'content-type': 'application/pdf' }] })
assert.equal(linkedWork.pdfUrl, 'https://journals.example/paper.pdf')
assert.equal(crossrefPaper({ DOI: '10.1000/unsafe', title: ['Unsafe'], link: [{ URL: 'http://localhost/paper.pdf', 'content-type': 'application/pdf' }] }).pdfUrl, '')
const semanticWork = semanticScholarPaper({ paperId: 'abc123', title: 'A useful result', externalIds: { DOI: '10.1000/useful' }, authors: [{ name: 'Ada Kim' }], openAccessPdf: { url: 'https://repository.example/useful.pdf' }, citationCount: 12 })
assert.equal(semanticWork.arxivId, 'doi:10.1000/useful')
assert(isStoredPaperId('doi:10.1000/useful'), 'DOI-backed papers must remain usable after download.')
assert(isStoredPaperId('pmc:PMC123') && isStoredPaperId('1706.03762') && isStoredPaperId('local-a1b2c3'))
assert(!isStoredPaperId('../paper') && !isStoredPaperId('doi:10.1/test\nspoof'))
assert.equal(semanticWork.doi, '10.1000/useful')
assert.equal(semanticWork.pdfUrl, 'https://repository.example/useful.pdf')
const ranked = rankScholarlyPapers('useful result', [work, semanticWork])
assert.equal(ranked[0].title, 'A useful result')
assert.equal(rankScholarlyPapers('1706.03762', [work, { ...semanticWork, arxivId: '1706.03762' }])[0].arxivId, '1706.03762')
const merged = mergeScholarlyPapers('useful result', [semanticWork, { ...semanticWork, arxivId: '2401.01234', pdfUrl: 'https://arxiv.org/pdf/2401.01234' }])
assert.equal(merged.length, 1)
assert.equal(merged[0].arxivId, '2401.01234')
const pmcWork = europePmcPaper({ id: '123', source: 'MED', pmcid: 'PMC123', doi: '10.1000/useful', title: 'A useful result', isOpenAccess: 'Y', inPMC: 'Y', authorList: { author: [{ fullName: 'Ada Kim' }] }, fullTextUrlList: { fullTextUrl: [{ availabilityCode: 'OA', documentStyle: 'pdf', url: 'https://europepmc.org/articles/PMC123?pdf=render' }] }, license: 'CC BY' })
assert.equal(pmcWork.structuredSourceFormat, 'jats')
assert.equal(pmcWork.doi, '10.1000/useful')
assert.equal(pmcWork.pdfUrl, 'https://europepmc.org/articles/PMC123?pdf=render')
assert.equal(mergeScholarlyPapers('useful result', [semanticWork, pmcWork])[0].pmcid, 'PMC123')
const manuscriptWork = europePmcPaper({ id: '456', source: 'MED', pmcid: 'PMC456', doi: '10.1000/manuscript', title: 'Repository manuscript', hasPDF: 'Y', inPMC: 'Y', isOpenAccess: 'N' })
assert.equal(manuscriptWork.pdfUrl, 'https://europepmc.org/articles/PMC456?pdf=render')
assert.equal(manuscriptWork.structuredSourceFormat, undefined)
const jats = parseJatsStructure(`<?xml version="1.0"?><article><front><article-meta><abstract><p>Measured abstract.</p></abstract></article-meta></front><body><sec><title>Methods</title><p>We measured ten samples.</p><disp-formula><tex-math>E = mc^2</tex-math></disp-formula><fig><caption><p>Figure 1. Apparatus.</p></caption></fig></sec></body><ref-list><ref><mixed-citation>Ignored reference</mixed-citation></ref></ref-list></article>`, { provider: 'europe-pmc', license: 'CC BY' })
assert.equal(jats.format, 'jats')
assert.deepEqual(jats.blocks.map(block => block.kind), ['heading', 'paragraph', 'heading', 'paragraph', 'equation', 'caption'])
assert.equal(jats.blocks.find(block => block.kind === 'equation').source, 'E = mc^2')
assert(!jats.blocks.some(block => block.source.includes('Ignored reference')))
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
console.log('Product core passed: translation gates, scholarly-source merging, JATS parsing, PDF validation and content deduplication.')
