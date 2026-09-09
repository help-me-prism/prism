import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/readerContext.ts', 'utf8'), 'src/paper/readerContext.ts')
const { readingEvidence, readerExcerpts } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const anchor = (id, source, page = 1, paperId = 'bio') => ({ anchorId: id, paperId, paperTitle: paperId, type: 'sentence', page, label: '문장1', source })
const papers = [anchor('a', 'The abstract describes an association.'), anchor('b', 'The experimental control group received placebo.', 4), anchor('c', 'Methods used reinforced concrete.', 2, 'eng')]
const evidence = readingEvidence(papers, ['bio', 'eng', 'unparsed'], '두 연구의 실험 방법을 비교해줘', 500)
assert.deepEqual(new Set(evidence.excerpts.map(item => item.paperId)), new Set(['bio', 'eng']))
assert.deepEqual(evidence.missingPaperIds, ['unparsed'])
assert.equal(new Set(evidence.references.map(item => item.label)).size, evidence.references.length)
for (const ref of evidence.references) assert(papers.some(item => item.anchorId === ref.anchorId && item.paperId === ref.paperId))
assert(evidence.excerpts.reduce((sum, item) => sum + item.source.length, 0) <= 500)
assert.equal(readerExcerpts(papers, '4페이지에서 설명한 방법은?', 70)[0].anchorId, 'b')
assert.equal(readerExcerpts(papers, '실험 대조군이 궁금해', 65)[0].anchorId, 'b')
assert.deepEqual(readingEvidence([], ['bio'], '요약').missingPaperIds, ['bio'])
console.log('Reading evidence passed: balanced papers, Korean retrieval, exact source links, page requests and missing evidence.')
