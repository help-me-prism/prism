import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {transformWithOxc} from 'vite'
const require = createRequire(import.meta.url)
const source = (await fs.readFile('src/evidenceInlineMath.ts','utf8')).replace("'katex'",JSON.stringify(pathToFileURL(require.resolve('katex')).href))
const {code} = await transformWithOxc(source,'src/evidenceInlineMath.ts')
const {evidenceInlineMathHtml:render} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const html=render('Density $\\rho_{0}$ and mass $m_{0}$ remain source evidence.')
assert.equal((html.match(/class="katex"/g)||[]).length,2)
assert(html.includes('Density ') && html.endsWith(' remain source evidence.'))
for(const literal of ['`$m_0$`','[$m_0$](prism://paper/test)','$m_0','\\$m_0','$$m_0$$','$ m_0 $','$\\unknownCommand{m}$']) assert(!render(literal).includes('class="katex"'),literal)
const hostile=render('<img src=x onerror=alert(1)> $\\href{javascript:alert(1)}{x}$ $\\htmlClass{evil}{x}$')
assert(!hostile.includes('<img')); assert(!hostile.includes('href="javascript:')); assert(!hostile.includes('class="evil"'))
assert(render('x & y < z').includes('x &amp; y &lt; z'))
assert(!render('$'+'m'.repeat(1001)+'$').includes('class="katex"'))
console.log('Evidence inline math: bounded explicit math, plain/code/link preservation, invalid fallback and untrusted HTML/URL safety passed')
