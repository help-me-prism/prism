import type { LatexStructure } from './latex.js'

type Rect = { left: number; top: number; width: number; height: number }
export type AuditedSegment = {
  id: string; page: number; kind: string; source: string; blockId?: string; sourceMode?: string;
  translation?: string; preciseRects?: Rect[]
}
export type PaperRiskKind = 'inline-math' | 'complex-equation' | 'theorem' | 'table-figure-nearby' | 'multi-panel-figure' | 'equation-count-mismatch' | 'unmatched-complex-equation' | 'duplicate-equation-number' | 'translation-gap'
export type PaperRiskRecord = {
  kind: PaperRiskKind; severity: 'review' | 'warning'; page: number | null; latexBlockId: string | null;
  pdfSegmentId: string | null; expectedStructure: string; actualStructure: string; tagRange: Rect | null;
  errorCause: string | null; result: 'pass' | 'warning'; regressionTest: string
}

const inlineMath = /(?<!\\)(?:\$(?!\$)[^$\n]+(?<!\\)\$|\\\([\s\S]*?\\\))/g
const complexMath = /\\begin\{(?:bmatrix|pmatrix|matrix|cases|aligned|align|split|multline|array)\}|\\(?:frac|dfrac|tfrac|left|right|lVert|rVert|int|sum|prod)\b/g
const equationNumber = /\((\d{1,3})\)\s*$/

function range(rects?: Rect[]) {
  const valid = (rects ?? []).filter(rect => [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)
  if (!valid.length) return null
  const left = Math.min(...valid.map(rect => rect.left)); const top = Math.min(...valid.map(rect => rect.top))
  const right = Math.max(...valid.map(rect => rect.left + rect.width)); const bottom = Math.max(...valid.map(rect => rect.top + rect.height))
  return { left, top, width: right - left, height: bottom - top }
}

function base(kind: PaperRiskKind, segment: AuditedSegment | undefined, blockId: string | undefined, expectedStructure: string, regressionTest: string): PaperRiskRecord {
  return { kind, severity: 'review', page: segment?.page ?? null, latexBlockId: blockId ?? null, pdfSegmentId: segment?.id ?? null, expectedStructure, actualStructure: segment ? `${segment.kind}/${segment.sourceMode ?? 'pdf'}` : 'unmatched', tagRange: range(segment?.preciseRects), errorCause: null, result: 'pass', regressionTest }
}

/** Static, provider-neutral triage. It identifies pages worth visual review; it does not guess missing geometry. */
export function auditPaperQuality(structure: LatexStructure | null | undefined, segments: AuditedSegment[]) {
  const records: PaperRiskRecord[] = []
  const byBlock = new Map<string, AuditedSegment[]>()
  for (const segment of segments) if (segment.blockId) byBlock.set(segment.blockId, [...(byBlock.get(segment.blockId) ?? []), segment])
  for (const block of structure?.blocks ?? []) {
    const matched = byBlock.get(block.id)?.[0]
    if (['paragraph', 'caption', 'theorem'].includes(block.kind) && [...block.source.matchAll(inlineMath)].length) records.push(base('inline-math', matched, block.id, 'prose with rendered inline math', 'test-latex-structure.mjs + test-scientific-translation.mjs'))
    if (block.kind === 'equation' && complexMath.test(block.source)) {
      complexMath.lastIndex = 0
      const record = base('complex-equation', matched, block.id, 'one ordered display-equation block', 'test-pdf-text-extraction.mjs + test-equation-alignment.mjs')
      if (!matched) { record.kind = 'unmatched-complex-equation'; record.severity = 'warning'; record.result = 'warning'; record.errorCause = 'No confident PDF-to-source match; keep the PDF segment as the safe source.' }
      records.push(record)
    } else complexMath.lastIndex = 0
    if (block.kind === 'theorem') records.push(base('theorem', matched, block.id, 'title, prose and math in one theorem block', 'test-reading-blocks.mjs'))
    if (block.kind === 'figure' && (block.source.match(/\\includegraphics\b/g)?.length ?? 0) > 1) records.push(base('multi-panel-figure', matched, block.id, 'all panels plus caption in one figure region', 'test-figure-geometry.mjs'))
  }

  const pages = new Map<number, AuditedSegment[]>()
  for (const segment of segments) pages.set(segment.page, [...(pages.get(segment.page) ?? []), segment])
  for (const [page, items] of pages) {
    const table = items.find(item => item.kind === 'table')
    const figure = items.find(item => item.kind === 'figure')
    if (table && figure) records.push(base('table-figure-nearby', table, table.blockId, 'independent table and figure regions', 'test-figure-geometry.mjs'))
  }

  const sourceEquations = (structure?.blocks ?? []).filter(block => block.kind === 'equation')
  const pdfEquations = segments.filter(segment => segment.kind === 'equation')
  if (structure && Math.abs(sourceEquations.length - pdfEquations.length) > Math.max(2, Math.ceil(sourceEquations.length * .35))) {
    const record = base('equation-count-mismatch', pdfEquations[0], undefined, `${sourceEquations.length} source equations aligned monotonically without forced matches`, 'test-equation-alignment.mjs')
    record.severity = 'warning'; record.result = 'warning'; record.actualStructure = `${pdfEquations.length} PDF equation segments`; record.errorCause = 'Source and PDF equation counts differ substantially.'; records.push(record)
  }

  const numbered = new Map<string, AuditedSegment[]>()
  for (const segment of pdfEquations) {
    const number = segment.source.match(equationNumber)?.[1]
    if (number) numbered.set(number, [...(numbered.get(number) ?? []), segment])
  }
  for (const [number, matches] of numbered) if (new Set(matches.map(match => match.page)).size > 1) {
    const record = base('duplicate-equation-number', matches[0], matches[0].blockId, `equation number (${number}) unique within the document flow`, 'test-paper-quality-audit.mjs')
    record.severity = 'warning'; record.result = 'warning'; record.actualStructure = matches.map(match => `p${match.page}:${match.id}`).join(', '); record.errorCause = 'The same printed equation number was detected on multiple pages.'; records.push(record)
  }

  let gap: AuditedSegment[] = []
  const flushGap = () => {
    if (gap.length > 1) {
      const record = base('translation-gap', gap[0], gap[0].blockId, 'every eligible prose segment translated or explicitly rejected', 'test-reading-blocks.mjs + test-translation-request.mjs')
      record.severity = 'warning'; record.result = 'warning'; record.actualStructure = gap.map(item => item.id).join(', '); record.errorCause = 'Consecutive eligible segments have no saved translation.'; records.push(record)
    }
    gap = []
  }
  for (const segment of segments) {
    if (['text', 'heading', 'caption'].includes(segment.kind) && !segment.translation?.trim()) gap.push(segment)
    else flushGap()
  }
  flushGap()
  return records
}
