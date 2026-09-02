import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseLatexStructure } from '../dist-electron/latex.js'

const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-latex-'))
const equationBody = String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V`
const tableBody = String.raw`\caption{Model results}\begin{tabular}{lcc}Model & BLEU & Params \\ Prism & 31.2 & 42M \\ \end{tabular}`
const equation = String.raw`\begin{equation}${equationBody}\end{equation}`
const table = String.raw`\begin{table}${tableBody}\end{table}`

try {
  await fs.writeFile(path.join(sourceDir, 'main.tex'), String.raw`\documentclass{article}
\begin{document}
\section{Method}
The model uses structured attention.
${equation}
${table}
\end{document}`)
  const structure = await parseLatexStructure(sourceDir)
  assert(structure, 'LaTeX structure was not parsed.')
  assert.equal(structure.blocks.find((block) => block.kind === 'equation')?.source, equationBody)
  assert.equal(structure.blocks.find((block) => block.kind === 'table')?.source, tableBody)
  process.stdout.write('LaTeX structure test passed: equation and table source stayed byte-for-byte intact.\n')
} finally {
  await fs.rm(sourceDir, { recursive: true, force: true })
}
