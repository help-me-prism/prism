import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {searchResearchKnowledge} from '../dist-electron/researchSearch.js'
const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-preview-'))
try {
  await fs.mkdir(path.join(vault, 'Concepts'))
  const file = path.join(vault, 'Concepts', 'pores.md')
  const markdown = `---
type: concept
prism_id: concept-preview-pores
title: 기공 비율 정의
---
# 기공 비율 정의
<!-- prism:auto asked -->
기공 비율 (3번 물어봄) 내가 주목한 것 근거1
<!-- /prism:auto asked -->
<!-- prism:auto sources -->
[PDF 원문 열기](prism://paper/example)
<!-- /prism:auto sources -->
> [!ai] 저장한 답변
> Q: 기공 비율을 설명해줘.
>
> 기공 형상 계수의 비율은 같은 형상의 기공 수를 전체 기공 수로 나눈 값이다.
`
  await fs.writeFile(file, markdown)
  const [result] = await searchResearchKnowledge(vault, '기공 비율')
  assert.equal(result.node.id, 'concept-preview-pores')
  assert(result.excerpt.includes('전체 기공 수로 나눈 값'))
  for (const clutter of ['3번', '물어봄', '내가 주목한 것', 'PDF 원문', 'Q:', '설명해줘']) assert(!result.excerpt.includes(clutter), clutter)
  assert.equal(await fs.readFile(file, 'utf8'), markdown, 'Preview derivation must not rewrite the note')
  const cache = path.join(vault, '.prism', 'index', 'research-lexical-v3.json')
  const saved = JSON.parse(await fs.readFile(cache, 'utf8'))
  delete saved.entries[0].prose
  await fs.writeFile(cache, JSON.stringify(saved))
  assert.deepEqual(await searchResearchKnowledge(vault, '기공 비율'), [result], 'Older/incomplete preview caches must be rebuilt')
  console.log('research-preview: useful prose instead of generated prompts/navigation, original note preservation and derived-cache repair passed')
} finally {
  if (path.dirname(vault) !== path.resolve(os.tmpdir()) || !path.basename(vault).startsWith('prism-preview-')) throw Error('Unexpected test directory')
  await fs.rm(vault, {recursive:true,force:true,maxRetries:5,retryDelay:100})
}
