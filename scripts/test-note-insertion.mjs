import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/noteInsertion.ts', 'utf8'), 'src/noteInsertion.ts')
const { noteBlockInsertionPosition: position } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const text = '---\ntitle: note\n---\n\n# Scientific title\n\nMy own text.\n'
assert.equal(position(text,0),text.indexOf('\n\nMy own text.') + 1)
const caret = text.indexOf('own')
assert.equal(position(text,caret),caret,'explicit body insertion point remains unchanged')
assert.equal(position('# Title',0),7)
assert.equal(position('No title\n',0),0)
const windowsNote = '---\r\ntype: concept\r\n---\r\n\r\n# Title\r\n'
assert.equal(position(windowsNote,0),windowsNote.length)
console.log('note-insertion: new-note title and explicit body caret passed')
