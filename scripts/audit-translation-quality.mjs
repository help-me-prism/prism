// Offline reader-composition audit: runs the real PDF segmenter over a paper and
// reports the failure shapes that show up in the translated view — prose dropped
// from translation, table rows sent to the model, captions missed, running page
// furniture translated on every page, reference lists translated, and sentences
// cut mid-clause. No model calls.
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { transformWithOxc } from 'vite'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

async function load(file) {
  const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { segmentsFromItems, markRunningFurniture } = await load('src/paper/textExtraction.ts')
const { withoutBibliography } = await load('electron/translationScope.ts')
const standardFonts = path.join(path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'))), 'standard_fonts').split(path.sep).join('/') + '/'

export async function segmentsForPdf(pdfPath) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(pdfPath)), disableWorker: true, standardFontDataUrl: standardFonts }).promise
  const pages = []
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    pages.push(segmentsFromItems(page, content.items.filter(item => 'str' in item)))
  }
  const flat = typeof markRunningFurniture === 'function' ? markRunningFurniture(pages.flat(), pdf.numPages) : pages.flat()
  const grouped = new Map()
  for (const segment of flat) grouped.set(segment.page, [...(grouped.get(segment.page) ?? []), segment])
  return { pages: [...grouped.keys()].sort((a, b) => a - b).map(page => grouped.get(page)), flat, numPages: pdf.numPages }
}

const words = text => text.match(/[A-Za-z][A-Za-z'-]{1,}/g)?.length ?? 0
const digitShare = text => (text.match(/\d/g)?.length ?? 0) / Math.max(1, text.length)
const mathShare = text => (text.match(/[=+*/×÷∑∫√∞≈≠≤≥∈⊂⊆∀∃∇∂^_{}\\|]/g) ?? []).length / Math.max(1, text.replace(/\s/g, '').length)
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
  const numbers = trimmed.match(/\d+(?:\.\d+)?/g)?.length ?? 0
  return numbers >= 4 && digitShare(trimmed) > .2 && words(trimmed) <= 6
}

export function auditSegments(flat, numPages) {
  const findings = []
  const add = (type, segment, note) => findings.push({ type, page: segment.page, kind: segment.kind, id: segment.id, note, source: segment.source.slice(0, 220) })
  const body = new Set(withoutBibliography(flat).map(segment => segment.id))
  const byPage = new Map()
  for (const segment of flat) byPage.set(segment.page, [...(byPage.get(segment.page) ?? []), segment])

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
      if (segment.kind === 'heading' && words(text) >= 14) add('heading-too-long', segment, '문단이 제목으로 분류됨')
      if (text.includes('�') && segment.kind !== 'artifact') add('replacement-glyph', segment, '깨진 글리프가 번역 대상에 포함됨')
      if (segment.kind === 'text' && /^[a-z]/.test(text) && !/^(?:e\.g|i\.e|et al|vs)\b/i.test(text)
        && previous && translatableKinds.includes(previous.kind) && previous.blockId === segment.blockId
        && !/[.!?:;]["')\]]?$/.test(previous.source.trim())) add('split-mid-sentence', segment, `앞 조각이 "${previous.source.trim().slice(-40)}"로 끝남`)
      // Single-word translatable fragments come from a sentence break at an
      // initial or abbreviation; each costs a model call and reads as noise.
      if (segment.kind === 'text' && body.has(segment.id) && words(text) <= 2 && text.length <= 14 && /[.]/.test(text)) add('micro-fragment', segment, '약어·이니셜에서 문장이 잘림')
      if (segment.kind !== 'caption' && /^(?:Figure|Fig\.?|Table|Algorithm|TABLE|FIGURE|Supplementary Fig\.?|Extended Data Fig\.?)\s*\d+(?:\.\d+)*\s*[:|]|^(?:Figure|Fig\.?|Table|Algorithm|TABLE|FIGURE)\s*\d+(?:\.\d+)*\.\s+[A-Z]/.test(text)) add('missed-caption', segment, '캡션 라벨이 캡션으로 인식되지 않음')
      // A caption that swallowed the grid it labels sends the table body to the model.
      if (segment.kind === 'caption' && /^(?:Table|TABLE|Algorithm)\s*\d+/.test(text) && (text.match(/\d+(?:\.\d+)/g)?.length ?? 0) >= 4) add('caption-absorbed-table', segment, '표 캡션이 표 본문 행을 흡수함')
    }
  }
  return findings
}

export function scope(flat) {
  const body = withoutBibliography(flat)
  return {
    total: flat.length,
    translatable: flat.filter(segment => translatableKinds.includes(segment.kind)).length,
    inScope: body.filter(segment => translatableKinds.includes(segment.kind)).length,
  }
}

if (process.argv[1]?.endsWith('audit-translation-quality.mjs')) {
  const summary = []
  for (const target of process.argv.slice(2)) {
    const pdfPath = (await fs.stat(target)).isDirectory() ? path.join(target, 'original.pdf') : target
    const { flat, numPages } = await segmentsForPdf(pdfPath)
    const findings = auditSegments(flat, numPages)
    const counts = {}
    for (const finding of findings) counts[finding.type] = (counts[finding.type] ?? 0) + 1
    const kinds = {}
    for (const segment of flat) kinds[segment.kind] = (kinds[segment.kind] ?? 0) + 1
    summary.push({ paper: path.basename(pdfPath) === 'original.pdf' ? path.basename(path.dirname(pdfPath)) : path.basename(pdfPath, '.pdf'), pages: numPages, kinds, scope: scope(flat), counts, findings })
  }
  console.log(JSON.stringify(summary, null, 2))
}
