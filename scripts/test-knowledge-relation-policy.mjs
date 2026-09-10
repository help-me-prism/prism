import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/knowledgeModel.ts','utf8'),'src/knowledgeModel.ts')
const { relationTypesFor, primaryRelationTypes } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const pair = (a,b) => relationTypesFor({id:'a',nodeType:a},{id:'b',nodeType:b})
for (const type of ['paper','concept','claim','question','project']) assert(pair('concept',type).includes('related'))
assert.equal(primaryRelationTypes[0],'related','default neutral association avoids an accidental hierarchy assertion')
assert(!pair('concept','paper').includes('supports'))
assert(!pair('paper','concept').includes('contradicts'))
assert(pair('claim','claim').includes('contradicts'))
assert(pair('paper','claim').includes('supports'))
assert.deepEqual(relationTypesFor({id:'same',nodeType:'concept'},{id:'same',nodeType:'concept'}),[])
console.log('knowledge relation policy: neutral associations and semantic constraints passed')
