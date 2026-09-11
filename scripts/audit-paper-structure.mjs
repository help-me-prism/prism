import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadTs as load } from './load-ts.mjs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { auditPaperQuality } from '../dist-electron/paperQualityAudit.js'

const paperDir = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: node scripts/audit-paper-structure.mjs <paper-directory>')
const readJson = async name => JSON.parse(await fs.readFile(path.join(paperDir, name), 'utf8'))
const optionalJson = async name => { try { return await readJson(name) } catch { return undefined } }
const { segmentsFromItems } = await load('src/paper/textExtraction.ts')

const anchors = (await optionalJson('anchors.json'))?.anchors ?? []
const structure = await optionalJson('latex-structure.json') ?? await optionalJson('jats-structure.json')
const latexBlocks = structure?.blocks ?? []
const complexPattern = /\\begin\{(?:bmatrix|pmatrix|matrix|cases|aligned|align|split|multline|array)\}|\\substack|\\frac/g
const inlineMathPattern = /(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$/g
const likelyRisks = latexBlocks.flatMap(block => {
  const complex = block.kind === 'equation' ? [...block.source.matchAll(complexPattern)].length : 0
  const inline = ['paragraph', 'theorem', 'caption'].includes(block.kind) ? [...block.source.matchAll(inlineMathPattern)].length : 0
  return complex || inline ? [{ id: block.id, kind: block.kind, section: block.section, complex, inline }] : []
})

const pdfjsRoot = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(path.join(paperDir, 'original.pdf'))), disableWorker: true, standardFontDataUrl: `${path.join(pdfjsRoot, 'standard_fonts').replaceAll('\\', '/')}/` }).promise
const extracted = []
for (let page = 1; page <= pdf.numPages; page += 1) {
  const content = await (await pdf.getPage(page)).getTextContent()
  extracted.push(...segmentsFromItems(page, content.items.filter(item => 'str' in item)))
}
const anchorEquations = anchors.filter(anchor => anchor.type === 'equation')
const tableCaptions = extracted.filter(segment => segment.kind === 'caption' && /^(?:table|algorithm)\s*\d+/i.test(segment.source))
const figureCaptions = extracted.filter(segment => segment.kind === 'caption' && /^(?:figure|fig\.?)\s*\d+/i.test(segment.source))
const suspiciousEquationProse = extracted.filter(segment => segment.kind === 'equation' && /^(?:where|given|let|since|we|the|this|that|for|if|in)\b/i.test(segment.source.trim())).map(segment => ({ page: segment.page, id: segment.id, source: segment.source.slice(0, 180) }))
const fragmentedNumbers = new Map()
for (const segment of extracted.filter(segment => segment.kind === 'equation')) {
  const number = segment.source.match(/\((\d{1,3})\)\s*$/)?.[1]
  if (number) fragmentedNumbers.set(number, [...(fragmentedNumbers.get(number) ?? []), segment])
}
const duplicatedEquationNumbers = [...fragmentedNumbers].filter(([, entries]) => entries.length > 1).map(([number, entries]) => ({ number, ids: entries.map(entry => entry.id), pages: entries.map(entry => entry.page) }))
const unmatchedComplex = likelyRisks.filter(risk => risk.kind === 'equation' && risk.complex).filter(risk => !anchorEquations.some(anchor => anchor.blockId === risk.id && anchor.sourceMode === 'latex'))
const result = {
  paper: path.basename(paperDir), pages: pdf.numPages,
  latex: structure ? {
    blocks: latexBlocks.length,
    equations: latexBlocks.filter(block => block.kind === 'equation').length,
    tables: latexBlocks.filter(block => block.kind === 'table').length,
    figures: latexBlocks.filter(block => block.kind === 'figure').length,
    likelyRiskCount: likelyRisks.length,
    complexEquationCount: likelyRisks.filter(risk => risk.complex).length,
    inlineMathBlockCount: likelyRisks.filter(risk => risk.inline).length,
  } : null,
  extracted: {
    segments: extracted.length,
    equations: extracted.filter(segment => segment.kind === 'equation').length,
    tableCaptions: tableCaptions.length,
    figureCaptions: figureCaptions.length,
    savedTables: anchors.filter(anchor => anchor.type === 'table').length,
    savedFigures: anchors.filter(anchor => anchor.type === 'figure').length,
    latexEquationAnchors: anchorEquations.filter(anchor => anchor.sourceMode === 'latex').length,
    pdfEquationAnchors: anchorEquations.filter(anchor => anchor.sourceMode !== 'latex').length,
  },
  flags: { suspiciousEquationProse, duplicatedEquationNumbers, unmatchedComplex },
  riskRecords: auditPaperQuality(structure, anchors.length ? anchors : extracted),
}
console.log(JSON.stringify(result, null, 2))
