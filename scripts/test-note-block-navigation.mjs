import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
const {code}=await transformWithOxc(await fs.readFile('src/noteBlockNavigation.ts','utf8'),'src/noteBlockNavigation.ts')
const {noteBlockPosition}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const id='ai-answer-12345678-aaaa-bbbb-cccc-123456789abc'
const block=`> [!ai]- AI 답변\n> **Q:** question\n>\n> Exact saved answer $x$.\n> second line\n<!-- prism-ai-answer:data -->\n^${id}\n`
const currentBlock=block.replace(`\n<!-- prism-ai-answer:data -->\n^${id}\n`, `\n\n^${id}\n\n<!-- prism-ai-answer:data -->\n`)
for(const eol of ['\n','\r\n']) for (const savedBlock of [block,currentBlock]) {
 const content=('# Existing\n\n## Notes\n\n'+savedBlock+'\n## Later\nkeep user text').replaceAll('\n',eol)
 const position=noteBlockPosition(content,id)
 assert.equal(content.slice(position).trimStart().startsWith('Exact saved answer'),true)
 assert.equal(noteBlockPosition(content+'\n^'+id+'\n',id),undefined,'Duplicate block IDs must not choose arbitrary evidence')
 assert.equal(noteBlockPosition('```md\n'+block+'```\n',id),undefined,'Code examples are not saved block targets')
 assert.equal(noteBlockPosition(content,'missing'),undefined)
 assert.equal(noteBlockPosition(content,'../bad'),undefined)
}
console.log('Note block navigation: exact saved answer body, CRLF, unrelated headings, duplicates, missing targets and fenced examples passed')
