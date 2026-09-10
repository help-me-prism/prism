import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/evidenceUri.ts', 'utf8'), 'src/paper/evidenceUri.ts')
const { evidenceFromUri } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
assert.deepEqual(evidenceFromUri('prism://paper/10.1234%2Fpaper?anchor=p11-s3&page=11', '근거1'), {paperId:'10.1234/paper',anchorId:'p11-s3',page:11,type:'page',label:'근거1'})
assert.equal(evidenceFromUri('prism://paper/local-paper?anchor=p3-s1').page,3)
for (const uri of ['https://paper/id?anchor=x&page=1', 'prism://evil/id?anchor=x&page=1', 'prism://user@paper/id?anchor=x', 'prism://paper/id?anchor=x&page=-1', 'prism://paper/id?anchor=x&page=1.5', 'prism://paper/id?anchor=x&page=Infinity', 'prism://paper/id?anchor=x&page=0', 'prism://paper/id?anchor=x&page=1&page=2', 'prism://paper/id?anchor=x&anchor=y', 'prism://paper/%E0%A4%A?anchor=x', 'prism://paper/id?anchor=%00', 'prism://paper/id']) assert.equal(evidenceFromUri(uri),undefined,uri)
console.log('evidence-uri: source target parsing and invalid targets passed')
