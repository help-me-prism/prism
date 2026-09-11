// Offline reader-composition audit. Mirrors the extraction pipeline the reader
// actually runs (PaperWorkspace's PDF effect) and reports the failure shapes a
// reader sees in the translated view: prose dropped from translation, formulas
// and table rows sent to the model, figures that swallow body text, captions
// missed, running furniture translated on every page, sentences cut mid-clause.
// No model calls.
//
// The pipeline is reproduced rather than approximated on purpose. An earlier
// version ran segmentsFromItems alone, which silently disabled the font-weight
// caption split and both preservation passes, so it scored the app worse than
// the app behaves and never looked at figures or tables at all.
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadTs as load } from './load-ts.mjs'

const { segmentsFromItems, markRunningFurniture, hasDamagedMathEncoding } = await load('src/paper/textExtraction.ts')
const { withoutBibliography } = await load('electron/translationScope.ts')
const optional = async (file, names) => {
  try {
    const module = await load(file)
    return Object.fromEntries(names.map(name => [name, module[name]]))
  } catch { return Object.fromEntries(names.map(name => [name, undefined])) }
}
// These modules arrived with the figure and table preservation work. Guarding
// the import keeps the audit runnable on a branch that predates them, so two
// implementations can be measured with one harness.
const { textItemRect, segmentRects } = await optional('src/paper/itemGeometry.ts', ['textItemRect', 'segmentRects'])
const { preservePublicationFurniture } = await optional('src/paper/publicationFurniture.ts', ['preservePublicationFurniture'])
const { preservePdfTables } = await optional('src/paper/tableRegions.ts', ['preservePdfTables'])
const { joinBitmapRegions, joinVectorRegions, figureOverlapsProse } = await optional('src/paper/figureGeometry.ts', ['joinBitmapRegions', 'joinVectorRegions', 'figureOverlapsProse'])
const { collectSourceFontWeights, dominantSourceWeight } = await optional('src/paper/sourceEmphasis.ts', ['collectSourceFontWeights', 'dominantSourceWeight'])

const standardFonts = path.join(path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'))), 'standard_fonts').split(path.sep).join('/') + '/'

// Bitmap and vector ink, in viewport coordinates. Same operator walk and the
// same size gates the reader uses to decide what counts as a figure.
function graphicRegions(operators, viewport, scale = 1) {
  let transform = [1, 0, 0, 1, 0, 0]
  const stack = []; const bitmaps = []; const vectors = []
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operation = operators.fnArray[index]; const args = operators.argsArray[index]
    if (operation === pdfjs.OPS.save) stack.push([...transform])
    else if (operation === pdfjs.OPS.restore) transform = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    else if (operation === pdfjs.OPS.transform && args.length >= 6) transform = pdfjs.Util.transform(transform, args.slice(0, 6).map(Number))
    else if (operation === pdfjs.OPS.constructPath && args[0] !== pdfjs.OPS.endPath && args[0] !== pdfjs.OPS.clip && args[0] !== pdfjs.OPS.eoClip && args[2] && typeof args[2] === 'object') {
      const bounds = Array.from(args[2])
      if (bounds.length === 4 && bounds.every(Number.isFinite)) {
        const matrix = pdfjs.Util.transform(viewport.transform, transform)
        const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[0], bounds[3]], [bounds[2], bounds[3]]].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]])
        const left = Math.max(0, Math.min(...corners.map(point => point[0]))); const top = Math.max(0, Math.min(...corners.map(point => point[1])))
        const right = Math.min(viewport.width, Math.max(...corners.map(point => point[0]))); const bottom = Math.min(viewport.height, Math.max(...corners.map(point => point[1])))
        if (right >= left && bottom >= top) vectors.push({ left, top, width: right - left, height: bottom - top })
      }
    }
    else if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(operation)) {
      const matrix = pdfjs.Util.transform(viewport.transform, transform)
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]])
      const left = Math.min(...corners.map(corner => corner[0])); const top = Math.min(...corners.map(corner => corner[1]))
      const width = Math.max(...corners.map(corner => corner[0])) - left; const height = Math.max(...corners.map(corner => corner[1])) - top
      const area = width * height
      if (width > 72 * scale && height > 55 * scale && area > 7_500 * scale * scale && area < viewport.width * viewport.height * .78) bitmaps.push({ left, top, width, height })
    }
  }
  return { bitmaps, vectors }
}

export async function analysePdf(pdfPath) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(pdfPath)), disableWorker: true, standardFontDataUrl: standardFonts }).promise
  const collected = []
  const pageSizes = new Map()
  const figuresByPage = new Map()
  const rectsBySegment = new Map()

  for (let page = 1; page <= pdf.numPages; page += 1) {
    const pdfPage = await pdf.getPage(page)
    const viewport = pdfPage.getViewport({ scale: 1 })
    pageSizes.set(page, { width: viewport.width, height: viewport.height })
    const content = await pdfPage.getTextContent()
    const items = content.items.filter(item => 'str' in item)
    const styles = content.styles ?? {}

    // Font weight separates a bold caption title from its legend. Resolving it
    // needs the operator list, so a page that cannot load fonts simply has none.
    const weights = collectSourceFontWeights ? await collectSourceFontWeights(pdfPage, items).catch(() => ({})) : {}
    const pageSegments = segmentsFromItems(page, items, weights)
      .map(segment => ({ ...segment, sourceFontWeight: dominantSourceWeight?.(segment, items, weights) }))

    // Coarse PDF boxes, the same fallback the reader uses when glyph geometry is
    // unavailable. Canvas rendering is out of reach here, so precise rects are
    // never better than these; that is a floor on figure accuracy, not a bug.
    if (textItemRect && segmentRects) {
      const fallbackRects = items.map(item => {
        const style = item.fontName ? styles[item.fontName] : undefined
        const ascent = typeof style?.ascent === 'number' ? style.ascent : typeof style?.descent === 'number' ? 1 + style.descent : .8
        return textItemRect(pdfjs.Util.transform(viewport.transform, item.transform), item.width, 1, ascent, item.str)
      })
      for (const segment of pageSegments) rectsBySegment.set(segment.id, segmentRects(segment, fallbackRects))
    }

    if (joinBitmapRegions && joinVectorRegions) {
      try {
        const { bitmaps, vectors } = graphicRegions(await pdfPage.getOperatorList(), viewport)
        figuresByPage.set(page, [...joinBitmapRegions(bitmaps, 1, viewport.width * viewport.height), ...joinVectorRegions(vectors, 1, viewport.width * viewport.height)])
      } catch { figuresByPage.set(page, []) }
    }
    collected.push(...pageSegments)
  }

  let flat = collected.map(segment => ({ ...segment, preciseRects: rectsBySegment.get(segment.id) }))
  if (preservePublicationFurniture) flat = preservePublicationFurniture(flat, pageSizes)
  if (preservePdfTables) flat = preservePdfTables(flat)
  if (typeof hasDamagedMathEncoding === 'function') flat = flat.map(segment => segment.kind !== 'table' && hasDamagedMathEncoding(segment.source) ? { ...segment, kind: 'artifact' } : segment)
  if (typeof markRunningFurniture === 'function') flat = markRunningFurniture(flat, pdf.numPages)

  const byPage = new Map()
  for (const segment of flat) byPage.set(segment.page, [...(byPage.get(segment.page) ?? []), segment])
  return { flat, byPage, pageSizes, figures: figuresByPage, numPages: pdf.numPages }
}

/** Kept for callers that only need segments. */
export async function segmentsForPdf(pdfPath) {
  const analysis = await analysePdf(pdfPath)
  return { pages: [...analysis.byPage.keys()].sort((a, b) => a - b).map(page => analysis.byPage.get(page)), flat: analysis.flat, numPages: analysis.numPages }
}

const words = text => text.match(/[A-Za-z][A-Za-z'-]{1,}/g)?.length ?? 0
const letters = text => text.match(/[\p{L}]/gu)?.length ?? 0
const digitShare = text => (text.match(/\d/g)?.length ?? 0) / Math.max(1, text.length)
const mathChars = /[=+*/×÷±∓∑∏∫∮√∞≈≠≡≤≥∈∉⊂⊆⊕⊗∀∃∇∂←→↦⟨⟩‖·°µ]/g
const mathShare = text => (text.match(mathChars) ?? []).length / Math.max(1, text.replace(/\s/g, '').length)
const translatableKinds = ['text', 'heading', 'caption']

// A segment that reads like a full English sentence but was excluded from
// translation is the "번역 누락" failure the reader actually sees.
function looksLikeProse(text) {
  const trimmed = text.trim()
  if (words(trimmed) < 6) return false
  if (digitShare(trimmed) > .16) return false
  if (mathShare(trimmed) > .1) return false
  if (!/[.!?]["')\]]?$/.test(trimmed)) return false
  if (!/\b(?:the|a|an|of|to|in|is|are|we|this|that|for|with|and|or|as|by|from|it|which|can|be|our|these|their)\b/i.test(trimmed)) return false
  return /^[A-Z("'[]/.test(trimmed)
}

// A row of numbers or short cell labels rendered as translatable prose is the
// "표 감지 실패" failure: the model rewrites a table body into a Korean sentence.
function looksLikeTableRow(text) {
  const trimmed = text.trim()
  if (/[.!?]$/.test(trimmed) && words(trimmed) >= 6 && digitShare(trimmed) < .12) return false
  // "Combining (2.19), (2.20), (2.21) and (2.22) gives" is prose citing equation
  // numbers, not a row of cells. Parenthesised numbers never carry table data.
  const bare = trimmed.replace(/\((?:\d+(?:\.\d+)*[a-z]?)\)/g, '')
  const numbers = bare.match(/\d+(?:\.\d+)?/g)?.length ?? 0
  return numbers >= 4 && digitShare(bare) > .2 && words(bare) <= 6
}

// A displayed formula sent to the model comes back as prose about the formula,
// or as a formula with digits quietly changed. Either way the equation is lost,
// so a maths-dense segment that is still translatable is a defect.
function looksLikeDisplayedEquation(text) {
  const trimmed = text.trim()
  // "where t ∼ U[0,1], x ∼ p_t(x)" is a clause of the sentence above it, and the
  // reader wants its lead word in Korean. A displayed equation opens on a symbol
  // or a single-letter variable, never on a spelled-out lower-case word — which
  // holds without knowing that the word is "where", "где" or "donde".
  if (/^\p{Ll}{2,}\s/u.test(trimmed)) return false
  // A URL is all slashes and colons and scores as maths under any density test.
  if (/https?:\/\/|\bdoi\.org\/|\barxiv\.org\//i.test(trimmed)) return false
  if (letters(trimmed) > 0 && words(trimmed) >= 8 && mathShare(trimmed) < .06) return false
  const symbols = (trimmed.match(mathChars) ?? []).length
  if (symbols === 0) return false
  return mathShare(trimmed) > .12 || (symbols >= 2 && letters(trimmed) <= 12)
}

// Prose really does carry inline maths, and that is fine as long as the formula
// survives whole. A translatable fragment that stops inside one — trailing
// operator, or unbalanced delimiters around maths — means the split landed in
// the middle of the expression and neither half can be translated correctly.
function inlineMathCut(text) {
  const trimmed = text.trim()
  mathChars.lastIndex = 0
  if (!mathChars.test(trimmed)) { mathChars.lastIndex = 0; return false }
  mathChars.lastIndex = 0
  // Only a fragment that stops *inside* the expression counts. Bracket balance
  // was tried here and misfired constantly: pdf.js emits maths bars, norms and
  // set-builder braces as ordinary characters, so imbalance is the normal state
  // of correctly extracted inline maths rather than evidence of a bad split.
  if (/[=+\-−×÷/^_<>≤≥≈∈]$/.test(trimmed)) return true
  return (trimmed.match(/\$/g) ?? []).length % 2 === 1
}

const captionLabel = /^(?:Figure|Fig\.?|FIG\.?|FIGURE|Table|TABLE|Algorithm|ALGORITHM|Scheme|Chart|Extended\s+Data\s+Fig\.?|Supplementary\s+(?:Fig\.?|Figure|Table))\s*\d/

export function auditAnalysis(analysis) {
  const { flat, byPage, figures, pageSizes, numPages } = analysis
  const findings = []
  const add = (type, segment, note) => findings.push({ type, page: segment.page, kind: segment.kind, id: segment.id, note, source: segment.source.slice(0, 220) })
  const body = new Set(withoutBibliography(flat).map(segment => segment.id))
  const inScope = segment => translatableKinds.includes(segment.kind) && body.has(segment.id)

  // Repeated short lines on many pages are running heads, watermarks or DOI
  // stamps; translating them wastes a call per page and clutters the reading view.
  const repeats = new Map()
  for (const segment of flat) {
    if (!translatableKinds.includes(segment.kind)) continue
    const key = segment.source.trim().replace(/\s+/g, ' ').replace(/\b\d+\b/g, '#')
    if (key.length > 90 || key.length < 3) continue
    const entry = repeats.get(key) ?? { pages: new Set(), samples: [] }
    entry.pages.add(segment.page); entry.samples.push(segment); repeats.set(key, entry)
  }
  for (const [key, entry] of repeats) {
    if (entry.pages.size < Math.max(3, numPages * .4)) continue
    findings.push({ type: 'running-furniture', page: entry.samples[0].page, kind: entry.samples[0].kind, id: entry.samples[0].id, note: `${entry.pages.size}/${numPages}쪽에 반복되는 머리말·워터마크가 번역 대상`, source: key.slice(0, 160) })
  }

  for (const segments of byPage.values()) {
    for (const [index, segment] of segments.entries()) {
      const text = segment.source.trim()
      const previous = segments[index - 1]
      if (['artifact', 'equation'].includes(segment.kind) && looksLikeProse(text)) add('dropped-prose', segment, `${segment.kind}로 분류되어 번역에서 제외됨`)
      if (segment.kind === 'text' && body.has(segment.id) && looksLikeTableRow(text)) add('table-as-prose', segment, '표 셀 행이 번역 대상 산문으로 분류됨')
      if (inScope(segment) && looksLikeDisplayedEquation(text)) add('equation-as-prose', segment, '수식이 번역 대상으로 분류됨')
      if (inScope(segment) && segment.kind !== 'caption' && inlineMathCut(text)) add('inline-math-cut', segment, '줄글 내 수식 중간에서 조각이 끊김')
      if (segment.kind === 'heading' && words(text) >= 14) add('heading-too-long', segment, '문단이 제목으로 분류됨')
      if (text.includes('�') && segment.kind !== 'artifact') add('replacement-glyph', segment, '깨진 글리프가 번역 대상에 포함됨')
      if (segment.kind === 'text' && /^[a-z]/.test(text) && !/^(?:e\.g|i\.e|et al|vs)\b/i.test(text)
        && previous && translatableKinds.includes(previous.kind) && previous.blockId === segment.blockId
        && !/[.!?:;]["')\]]?$/.test(previous.source.trim())) add('split-mid-sentence', segment, `앞 조각이 "${previous.source.trim().slice(-40)}"로 끝남`)
      // Single-word translatable fragments come from a sentence break at an
      // initial or abbreviation; each costs a model call and reads as noise.
      if (segment.kind === 'text' && body.has(segment.id) && words(text) <= 2 && text.length <= 14 && /[.]/.test(text)) add('micro-fragment', segment, '약어·이니셜에서 문장이 잘림')
      if (segment.kind !== 'caption' && captionLabel.test(text) && /^(?:Figure|Fig\.?|Table|Algorithm|TABLE|FIGURE|Supplementary Fig\.?|Extended Data Fig\.?)\s*\d+(?:\.\d+)*\s*[:|]|^(?:Figure|Fig\.?|Table|Algorithm|TABLE|FIGURE)\s*\d+(?:\.\d+)*\.\s+[A-Z]/.test(text)) add('missed-caption', segment, '캡션 라벨이 캡션으로 인식되지 않음')
      // A caption that swallowed the grid it labels sends the table body to the model.
      if (segment.kind === 'caption' && /^(?:Table|TABLE|Algorithm)\s*\d+/.test(text) && (text.match(/\d+(?:\.\d+)/g)?.length ?? 0) >= 4) add('caption-absorbed-table', segment, '표 캡션이 표 본문 행을 흡수함')
    }
  }

  // Figure regions are accepted or rejected before anything is drawn over the
  // page. A region that covers body prose hides the text the reader came for —
  // the failure that put a logo-sized rectangle over a whole first page.
  if (figures && figureOverlapsProse) {
    for (const [page, regions] of figures) {
      const segments = byPage.get(page) ?? []
      const size = pageSizes.get(page)
      const evidence = segments.map(segment => ({ kind: segment.kind, source: segment.source, rects: segment.preciseRects }))
      const accepted = regions.filter(region => !figureOverlapsProse(region, evidence))
      // A plate page is legitimately almost all figure, so size alone says
      // nothing. The defect is a page that is still mostly reading — several
      // in-scope sentences — with a figure accepted over most of it anyway.
      // That is the shape that once put a logo's bounding box over a whole
      // first page and hid the article behind it.
      const reading = segments.filter(segment => inScope(segment) && words(segment.source) >= 8).length
      if (reading < 5) continue
      for (const region of accepted) {
        if (!size || region.width * region.height <= size.width * size.height * .6) continue
        findings.push({ type: 'figure-over-reading-page', page, kind: 'figure', id: `p${page}-fig-${Math.round(region.left)}x${Math.round(region.top)}`, source: `${Math.round(region.width)}×${Math.round(region.height)}pt @ ${Math.round(region.left)},${Math.round(region.top)}`, note: `본문 ${reading}문장이 있는 쪽의 60% 이상을 피겨가 덮음` })
      }
    }
  }
  return findings
}

/** Back-compatible entry point: audits already-flattened segments. */
export function auditSegments(flat, numPages) {
  const byPage = new Map()
  for (const segment of flat) byPage.set(segment.page, [...(byPage.get(segment.page) ?? []), segment])
  return auditAnalysis({ flat, byPage, figures: null, pageSizes: new Map(), numPages })
}

export function scope(flat) {
  const body = withoutBibliography(flat)
  const count = (list, kind) => list.filter(segment => segment.kind === kind).length
  return {
    total: flat.length,
    translatable: flat.filter(segment => translatableKinds.includes(segment.kind)).length,
    inScope: body.filter(segment => translatableKinds.includes(segment.kind)).length,
    equations: count(flat, 'equation'),
    tables: count(flat, 'table'),
    captions: count(flat, 'caption'),
    artifacts: count(flat, 'artifact'),
  }
}

if (process.argv[1]?.endsWith('audit-translation-quality.mjs')) {
  const summary = []
  for (const target of process.argv.slice(2)) {
    const pdfPath = (await fs.stat(target)).isDirectory() ? path.join(target, 'original.pdf') : target
    const analysis = await analysePdf(pdfPath)
    const findings = auditAnalysis(analysis)
    const counts = {}
    for (const finding of findings) counts[finding.type] = (counts[finding.type] ?? 0) + 1
    const kinds = {}
    for (const segment of analysis.flat) kinds[segment.kind] = (kinds[segment.kind] ?? 0) + 1
    summary.push({ paper: path.basename(pdfPath) === 'original.pdf' ? path.basename(path.dirname(pdfPath)) : path.basename(pdfPath, '.pdf'), pages: analysis.numPages, kinds, scope: scope(analysis.flat), counts, findings })
  }
  console.log(JSON.stringify(summary, null, 2))
}
