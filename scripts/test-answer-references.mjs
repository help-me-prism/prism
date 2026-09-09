import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
import {chatCaptureProvenance} from '../dist-electron/capture.js'
const {code}=await transformWithOxc(await fs.readFile('src/paper/answerReferences.ts','utf8'),'src/paper/answerReferences.ts')
const {answerReferences,answerReferenceAnchors}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const a={paperId:'paper-A',anchorId:'p11-s2',label:'근거1',page:11}
const b={paperId:'paper-B',anchorId:'p4-s3',label:'근거2',page:4}
const answer={id:'answer',text:'이전 결과 [@근거1]와 이번 결과 [@근거2]를 비교합니다. [@근거1]'}
const history=[{id:'old-question',anchors:[a]},{id:'old-answer',anchors:[a]},{id:'question',anchors:[b]},{...answer,anchors:[b]},{id:'future',anchors:[{...a,paperId:'future-paper'}]}]
const resolved=answerReferences(history,answer)
assert.deepEqual(answerReferenceAnchors(history,answer.id),[a,b],'Rendering receives unique historical and current labels')
assert.deepEqual(answerReferenceAnchors([{id:'ambiguous',anchors:[{...a,paperId:'other'}]},...history],answer.id),[b],'Rendering must also omit ambiguous labels')
assert.deepEqual(resolved,[a,b],'History/current sources retained, duplicate identities collapse, future collision ignored')
const saved=chatCaptureProvenance(answer.text,resolved,{arxivId:'paper-B',title:'Paper B'})
assert(saved.answer.includes('[@근거1](prism://paper/paper-A?anchor=p11-s2&page=11)'))
assert(saved.answer.includes('[@근거2](prism://paper/paper-B?anchor=p4-s3&page=4)'))
assert(saved.references.includes('paper-A')&&saved.references.includes('Paper B'),'Actual capture keeps both paper attributions')
assert.deepEqual(answerReferences([{id:'collision',anchors:[{...a,paperId:'other'}]},...history],answer),[b],'Ambiguous same label must not choose last/current anchor')
assert.deepEqual(answerReferences([{id:'collision',anchors:[{...a,anchorId:'different'}]},...history],answer),[b])
assert.deepEqual(answerReferences(history,{id:'missing',text:answer.text}),[])
const codeOnly={id:'answer',text:'`[@근거1]`\n```md\n[@근거1]\n```\n~~~text\n[@근거1]\n~~~\n$[@근거1]$\n\\([@근거1]\\)\n[@근거2]'}
assert.deepEqual(answerReferences(history,codeOnly),[b])
assert.deepEqual(answerReferences(history,{id:'answer',text:'[@근거999]'}),[])
console.log('answer-references: earlier/current evidence, future exclusion, ambiguous labels, code/math exclusion and real capture provenance passed')
