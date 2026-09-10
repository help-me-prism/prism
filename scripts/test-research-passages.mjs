import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('electron/researchPassages.ts','utf8'),'electron/researchPassages.ts')
const {researchPassages, researchPassagesVersion}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
assert.equal(researchPassagesVersion,1)
const note=`---
title: metadata must not become prose
---
# Paper title
## Empty heading
<!-- prism:auto overview -->
- **방법** A randomized experiment compared the groups.
- **결과** The observed effect was small.
<!-- /prism:auto overview -->
<!-- prism:auto relations -->
- supports · [[Other note]]
<!-- /prism:auto relations -->
<!-- prism:auto confusion -->
- Please describe the green labels.
<!-- /prism:auto confusion -->
<!-- prism:auto focus -->
- 근거1 (p.4)
- 근거2 (p.11) — Fibers bridge opening cracks.
<!-- /prism:auto focus -->
> [!evidence] 문장 · paper · p.11
> Original scientific quotation with **emphasis**.
> [PDF 원문 열기](prism://paper/id?anchor=a&page=11)
<!-- prism-evidence:opaque-metadata -->
^evidence-id-a

> [!ai]- AI 답변 · model · date
> **Q:** Read the image labels.
> This is a continued question line.
>
> The image contains two labeled groups.
>
> A second answer paragraph includes [its source](prism://paper/id?anchor=b).
> 참조: [근거1](prism://paper/id?anchor=b)
<!-- prism-ai-answer:opaque-metadata -->

## My interpretation
I disagree with [[Concept|that interpretation]] because the control was absent.
`
const passages=researchPassages(note)
const text=passages.map(p=>p.text).join('\n')
for(const expected of ['randomized experiment','observed effect','Fibers bridge','Original scientific quotation','two labeled groups','second answer paragraph','control was absent']) assert(text.includes(expected),expected)
for(const excluded of ['metadata','Paper title','Empty heading','supports','Please describe','Read the image','continued question','원문 열기','참조:','근거1 (p.4)','AI 답변']) assert(!text.includes(excluded),excluded)
assert(passages.some(p=>p.kind==='summary'&&p.text.includes('observed effect')))
assert(passages.some(p=>p.kind==='evidence'&&p.text.includes('Original scientific')))
assert.equal(passages.filter(p=>p.kind==='ai-answer').length,2)
assert.deepEqual(researchPassages(note.replaceAll('\n','\r\n')),passages)
assert.deepEqual(researchPassages('# Title-only question\n'),[])
assert.deepEqual(researchPassages('<!-- prism:auto focus -->\n_리더에서 문장을 태그하면 여기에 쌓입니다._\n<!-- /prism:auto focus -->'),[])
assert.equal(researchPassages('아직 없음')[0].text,'아직 없음','Do not delete matching words from user prose')
assert(researchPassages('<!-- prism:auto custom -->\nA custom scientific summary.\n<!-- /prism:auto custom -->')[0].text.includes('scientific'))
assert(researchPassages('<!-- prism:auto relations -->\nUnclosed region must preserve my prose.')[0].text.includes('preserve'))
assert.equal(researchPassages('Before <!-- hidden\nmetadata --> after.')[0].text,'Before after.')
assert.equal(researchPassages('> [!abstract]- Abstract\n> A real abstract.')[0].kind,'abstract')
console.log('research-passages: actual template structures, preserved summaries/evidence/answers, prompt/navigation exclusion and user-prose safety passed')
