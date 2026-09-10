import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { transformWithOxc } from 'vite'
const modules = new Map()
async function moduleUrl(file) {
  if (modules.has(file)) return modules.get(file)
  let { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
  for (const match of [...code.matchAll(/from ["'](\.[^"']+)["']/g)]) {
    code = code.replace(match[1], await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`)))
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  modules.set(file, url); return url
}
const { buildQuestionContext, questionCharacterLimit } = await import(await moduleUrl(path.resolve('src/paper/questionContext.ts')))
const anchor = (id, page, source, paperId = 'paper') => ({ anchorId: id, page, source, paperId, paperTitle: paperId, type: 'sentence', label: id })
const papers = [{ arxivId: 'paper', title: 'paper', summary: 'Introduction abstract' }]
const catalog = [anchor('intro', 1, 'Background abstract. '.repeat(100)), anchor('target', 8, 'TARGETPAGECONTENT '.repeat(100))]
const page = { ...anchor('p8', 8, 'Page 8 of paper'), type: 'page', label: '근거1' }
const selectedPage = buildQuestionContext('이 페이지 설명해줘', [page], catalog, papers, [])
assert(selectedPage.prompt.includes('TARGETPAGECONTENT'))
assert(!selectedPage.prompt.includes('Background abstract.'))
assert.throws(() => buildQuestionContext('설명', [page], [], papers, []), /본문을 읽지 못/)
const nine = Array.from({ length: 9 }, (_, index) => ({ arxivId: `p${index}`, title: 'paper', summary: '' }))
assert.throws(() => buildQuestionContext('비교', [], [], nine, []), /8편/)
assert.throws(() => buildQuestionContext('설명', [anchor('a', 1, 'abc', 'ninth')], [], nine.slice(0, 8), []), /8편/)
const long = Array.from({ length: 13 }, (_, index) => anchor(`근거${index + 1}`, 1, 'x'.repeat(4000)))
assert.throws(() => buildQuestionContext('설명', long, [], papers, []), /너무 깁니다/)
const duplicate = buildQuestionContext('설명', [long[0], long[0]], [], papers, [])
assert.equal(duplicate.prompt.split('x'.repeat(4000)).length, 2)
const bounded = buildQuestionContext('q'.repeat(42000), [], catalog, papers, [])
assert(bounded.prompt.length <= questionCharacterLimit)
assert(bounded.reduced)
assert.throws(() => buildQuestionContext('q'.repeat(46000), [], [], [], []), /너무 깁니다/)
const empty = buildQuestionContext('일반 개념', [], catalog, [], [])
assert.deepEqual(empty.paperIds, [])
assert(!empty.prompt.includes('TARGETPAGECONTENT'))
console.log('Question context passed: page source, missing-page error, explicit/automatic paper limit, whole-request budget, duplicate sources, general questions.')
