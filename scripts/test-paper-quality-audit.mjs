import assert from 'node:assert/strict'
import { auditPaperQuality } from '../dist-electron/paperQualityAudit.js'

const structure = { version: 6, rootFile: 'main.tex', generatedAt: '', format: 'latex', blocks: [
  { id: 'p', kind: 'paragraph', source: 'The score is $x_i / n$.' },
  { id: 'eq', kind: 'equation', source: String.raw`\begin{aligned}\frac{x}{y} &= 1 \\ z &= 2\end{aligned}` },
  { id: 'missing', kind: 'equation', source: String.raw`\begin{cases}1 & x>0 \\ 0 & x\le0\end{cases}` },
  { id: 'thm', kind: 'theorem', source: 'Theorem 1. Let $x>0$.' },
  { id: 'fig', kind: 'figure', source: String.raw`\includegraphics{a}\includegraphics{b}\caption{Panels}` },
] }
const rect = [{ left: 10, top: 20, width: 30, height: 8 }]
const segments = [
  { id: 's1', page: 1, kind: 'text', source: 'The score is x_i / n.', blockId: 'p', sourceMode: 'latex', preciseRects: rect },
  { id: 'e1', page: 1, kind: 'equation', source: 'x/y=1 z=2 (1)', blockId: 'eq', sourceMode: 'latex', preciseRects: rect },
  { id: 'th1', page: 2, kind: 'text', source: 'Theorem 1.', blockId: 'thm', sourceMode: 'latex' },
  { id: 'f1', page: 2, kind: 'figure', source: 'Panels', blockId: 'fig', sourceMode: 'latex' },
  { id: 't1', page: 2, kind: 'table', source: 'Table 1.', preciseRects: rect },
  { id: 'u1', page: 3, kind: 'text', source: 'First missing translation.' },
  { id: 'u2', page: 3, kind: 'caption', source: 'Second missing translation.' },
  { id: 'e2', page: 4, kind: 'equation', source: 'another (1)' },
]
const risks = auditPaperQuality(structure, segments)
for (const kind of ['inline-math', 'complex-equation', 'unmatched-complex-equation', 'theorem', 'multi-panel-figure', 'table-figure-nearby', 'duplicate-equation-number', 'translation-gap']) assert(risks.some(risk => risk.kind === kind), `Missing ${kind}`)
assert(risks.every(risk => ['page', 'latexBlockId', 'pdfSegmentId', 'expectedStructure', 'actualStructure', 'tagRange', 'errorCause', 'result', 'regressionTest'].every(key => key in risk)))
assert.equal(risks.find(risk => risk.kind === 'unmatched-complex-equation').result, 'warning')
assert.deepEqual(risks.find(risk => risk.kind === 'complex-equation').tagRange, { left: 10, top: 20, width: 30, height: 8 })
console.log('Paper quality audit passed: provider-neutral risk triage, traceable geometry and conservative warnings.')
