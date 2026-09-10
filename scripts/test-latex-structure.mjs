import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseLatexStructure } from '../dist-electron/latex.js'

const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-latex-'))
const equationBody = String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V`
const tableBody = String.raw`\caption{Model results}\begin{tabular}{lcc}Model & BLEU & Params \\ Prism & 31.2 & 42M \\ \end{tabular}`
const algorithmBody = String.raw`[H]\caption{Training}\begin{algorithmic}[1]\STATE Keep $x_t$ unchanged \\ \RETURN $x_0$\end{algorithmic}`
const equation = String.raw`\begin{equation}${equationBody}\end{equation}`
const table = String.raw`\begin{table}${tableBody}\end{table}`
const algorithm = String.raw`\begin{algorithm}${algorithmBody}\end{algorithm}`

try {
  await fs.writeFile(path.join(sourceDir, 'main.tex'), String.raw`\documentclass{article}
\newcommand{\Real}{\mathbb R}
\newcommand{\gL}{\mathcal{L}}
\newcommand{\CFM}{\scriptscriptstyle \text{CFM}}
\newcommand{\norm}[1]{\left\Vert#1\right\Vert}
\def \too{\rightarrow}
\begin{document}
\section{Method}
The model uses structured attention with $QK^T / \sqrt{d_k}$ scores and \(x_t = x_{t-1} + u_t\) updates on $x\in\Real^d$.
The loss $\gL_{\CFM}=\norm{x}$ maps $\Real^d\too\Real$.
${equation}
${table}
${algorithm}
\begin{restatable}{theorem}{stable}\label{thm:stable}
For every $x\in\mathbb{R}^d$, the update satisfies $f(x)=x$.
\end{restatable}
\begin{wrapfigure}[4]{r}{0.3\textwidth}
\includegraphics{figures/panel.png}
\caption{Wrapped example}
\end{wrapfigure}
\end{document}`)
  const structure = await parseLatexStructure(sourceDir)
  assert(structure, 'LaTeX structure was not parsed.')
  assert.equal(structure.blocks.find((block) => block.kind === 'equation')?.source, equationBody)
  assert.equal(structure.blocks.find((block) => block.kind === 'table')?.source, tableBody)
  const paragraph = structure.blocks.find((block) => block.kind === 'paragraph')?.source ?? ''
  assert.match(paragraph, /\$QK\^T \/ \\sqrt\{d_k\}\$/)
  assert.match(paragraph, /\$x_t = x_\{t-1\} \+ u_t\$/)
  const prose = structure.blocks.filter((block) => block.kind === 'paragraph').map((block) => block.source).join(' ')
  assert.match(prose, /\$x\\in\\mathbb R\^d\$/)
  assert.match(prose, /\\mathcal\{L\}_\{\\scriptscriptstyle \\text\{CFM\}\}=\\left\\Vert\{x\}\\right\\Vert/)
  assert.match(prose, /\\mathbb R\^d\\rightarrow\\mathbb R/)
  assert.doesNotMatch(prose, /\\(?:Real|gL|CFM|norm|too)\b/)
  assert.match(structure.blocks.find((block) => block.kind === 'theorem')?.source ?? '', /\$f\(x\)=x\$/)
  assert(structure.blocks.some((block) => block.kind === 'figure' && block.source.includes('figures/panel.png')), 'Wrapped figures participate in source/caption order.')
  assert(structure.blocks.some((block) => block.kind === 'table' && block.source === algorithmBody), 'Algorithm source was not preserved as a table-like structure.')
  process.stdout.write('LaTeX structure test passed: equation and table source stayed byte-for-byte intact.\n')
} finally {
  await fs.rm(sourceDir, { recursive: true, force: true })
}
