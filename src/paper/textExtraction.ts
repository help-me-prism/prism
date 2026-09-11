// A figure reference such as "Fig 2)" can begin a PDF text item in the middle
// of body prose. Only a caption label delimiter (or a label alone) starts a
// block. The label vocabulary and the case rules live in captionLabels.
import { captionStart } from './captionLabels'

export type PdfTextItem = { str: string; width: number; height: number; transform: number[]; hasEOL?: boolean; fontName?: string }
// Stands in for a full stop that must not end a sentence. It is exactly one
// character so offsets survive masking: segments address PDF glyph ranges by
// character position, so never drop it or replace it with a longer string.
const sentenceGuard = '\uE000'
const namedHeading = /^(?:abstract|one-sentence summary:?|references(?: and notes)?|bibliography|literature cited|acknowledg(?:e)?ments?|introduction|conclusions?|discussion|results|methods|materials and methods)$/i
const numberedTitle = /^(?:[IVX]+\.|\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.?)\s+[A-Z]/

const sentenceEnd = /[.!?:。！？：]["')\]』」]?$/
/** How short is too short to be a sentence, for the script it is written in. */
function shortFragmentLength(text: string) {
  return /[぀-ヿ一-鿿]/.test(text) ? 16 : 38
}

function isPublicationFurniture(text: string) {
  return /^PLOS\s+(?:ONE|BIOLOGY|GENETICS|MEDICINE|PATHOGENS|COMPUTATIONAL BIOLOGY)\b/i.test(text)
    || /^arXiv:\d{4}\.\d{4,5}v\d+\b/i.test(text)
    || /^Preprint$/i.test(text)
    || /^https?:\/\/(?:dx\.)?doi\.org\/\S+$/i.test(text)
}

function shortHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}

function isEquation(text: string) {
  const compact = text.replace(/\s/g, '')
  if (!compact) return false
  // Parenthesized labels, file types and citations are not display equations.
  if (!/[=+\-×÷∑∫√∞≈≠≤≥<>^_\\\u2200-\u22ff]/.test(compact)) return false
  // A multi-letter identifier inside an expression is not a prose word. Display
  // equations are full of them — pos, sin, model, softmax, Concat, head — and
  // counting them made "PE(pos,2i) = sin(pos/10000^(2i/dmodel))" read as a
  // sentence of four words and stop being an equation at all, which is why
  // machine-learning papers lost so many of theirs. A prose word has prose on
  // both sides; an identifier sits against an operator, a bracket or a digit.
  // Square brackets stay out of that test so a citation does not disqualify the
  // word in front of it.
  const proseWords = text.match(/(?<![=+\-×÷/^_(){}\d]\s*)\b[A-Za-z]{3,}\b(?!\s*[=+\-×÷/^_(){}\d])/g)?.length ?? 0
  // Explanatory clauses can be mostly symbols ("where T(t)=…") while still
  // belonging to the surrounding sentence. A grammatical lead is stronger
  // evidence than symbol density and must stay translatable prose.
  if (/^(?:where|given|let|since|when|for|with|and|if)\b/i.test(text.trim()) && proseWords >= 1) return false
  if (proseWords >= 4) return false
  const symbols = (compact.match(/[=+\-×÷∑∫√∞≈≠≤≥<>^_{}()[\]\\|\u2200-\u22ff︷︸]/g) ?? []).length
  const letters = (compact.match(/[A-Za-z가-힣]/g) ?? []).length
  // An equation built from long named functions carries its meaning in letters
  // rather than glyphs, so symbol density alone puts it just under the bar:
  // "MultiHead(Q,K,V) = Concat(head1, ..., headh)WO" measures .119 against .12
  // and stopped being an equation over one hundredth. A definition is a safer
  // shape to recognise than a density — an assignment, brackets, no prose and no
  // sentence to end — so it is allowed a lower density rather than a special case.
  const defines = /=/.test(compact) && symbols >= 4 && proseWords <= 1 && !/[.!?]$/.test(text.trim())
  return (symbols >= 2 && symbols / compact.length > .12) || (letters === 0 && symbols > 0)
    || (defines && symbols / compact.length > .09)
}

const numericToken = /\b\d+(?:[.,]\d+)?\b/g
const countMatches = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0

/** Where a table's cells begin inside what was read as one caption, or -1.
 *
 * A caption and the grid under it arrive as a single paragraph when nothing
 * separates them typographically — Table 4 of Attention Is All You Need carried
 * "Parser Training WSJ 23 F1 Vinyals & Kaiser el al. (2014) [37] ..." inside its
 * caption, so an entire results table went to the translator as a sentence.
 *
 * The cut has to be conservative, because a journal figure legend is long and
 * numeric too. A row of cells is numeric and ungrammatical: function words or a
 * second sentence in what follows mean it is still the caption talking. */
export function captionGridStart(paragraph: string) {
  if (paragraph.length < 220) return -1
  // A pseudocode listing opens like a caption and is numeric throughout, but its
  // body is the listing rather than a grid the caption swallowed; preservePdfTables
  // keeps it whole and cutting it here broke the listing into pieces.
  // "Table 4:" is itself one numbered colon, so a run of them is what marks a
  // listing rather than a single match.
  if (/\b(?:Require|Ensure)\s*:|←/.test(paragraph) || countMatches(paragraph, /\b\d+\s*:\s*\S/g) >= 3) return -1
  for (const boundary of paragraph.matchAll(/[.)\]:](?=\s+[A-Z(\d])/g)) {
    const at = (boundary.index ?? 0) + 1
    const head = paragraph.slice(0, at); const tail = paragraph.slice(at).trimStart()
    if (head.length < 40 || countMatches(head, /[A-Za-z]{2,}/g) < 6 || tail.length < 40) continue
    const opening = tail.slice(0, 100)
    if (/[.!?](?=\s+[A-Z])/.test(opening) || countMatches(opening, numericToken) < 2) continue
    if (countMatches(opening, /\b(?:the|of|and|for|with|are|were|was|is|in|on|to|from|by|that|this|show|shows|showing|indicate|indicates|represent|represents|each|all|same|images?|panels?|rows?|columns?|left|right|top|bottom)\b/gi) >= 2) continue
    const numbers = countMatches(tail, numericToken)
    if (numbers >= 4 && numbers / Math.max(1, tail.split(/\s+/).length) >= .12) return at
  }
  return -1
}

/** Where the prose after a display equation begins, or -1 when the paragraph is
 * not a display followed by a sentence. Takes the earliest boundary that still
 * leaves an equation behind it, so as much of the sentence as possible stays
 * translatable, and requires a real sentence ahead so a full stop inside the
 * maths does not split it. */
function trailingProseOffset(paragraph: string) {
  // Not gated on the whole paragraph being an equation: once the sentence is
  // attached the paragraph has too many words to read as one, which is the
  // reason these segments were classified by their maths font instead and the
  // sentence went untranslated with them.
  if (paragraph.length < 24) return -1
  // Judge the sentence immediately before the boundary, not everything before
  // it: a display is regularly introduced by a sentence of its own ("... we
  // obtain (2.4) k = ... ds. Then we rewrite"), and measuring the whole head
  // counts that introduction's words and reads the maths as prose.
  // A numbered section title never belongs inside the paragraph before it, and
  // the title that follows a short definition was being kept with it — "d ff =
  // 2048 . 3.4 Embeddings and Softmax" arrived as one preserved block, so the
  // heading vanished from the translation. The assignment in front is too small
  // to read as an equation on its own, so this boundary does not ask it to.
  for (const match of paragraph.matchAll(/[.!?]\s+(?=\d)/g)) {
    const at = (match.index ?? 0) + match[0].length
    const tail = paragraph.slice(at)
    if (tail.length > 80 || /[.!?]\s/.test(tail) || !numberedTitle.test(tail)) continue
    return at
  }
  // A run-in section title shares its line with the paragraph it introduces —
  // "3.3. 2D system in a disk Ω . To further verify ..." — so no line break and
  // no change of glyph size marks the boundary, and the whole thing became one
  // 189-character heading that the reader shows as a title. The numbering is
  // the evidence, and the first sentence end is the boundary.
  if (/^\d+(?:\.\d+)+\.?\s+\S/.test(paragraph) && paragraph.length > 120) {
    const boundary = paragraph.match(/[.!?]\s+(?=\p{Lu})/u)
    const at = boundary?.index === undefined ? -1 : boundary.index + boundary[0].length
    if (at > 0 && at < 120 && paragraph.length - at > 40) return at
  }
  // The same shape in a script with no capitals and few spaces: "1.1 开发语言
  // 工程软件二次开发语言多种多样，...". Han and Kana bodies almost never space
  // their words, so the one space after a numbered title is the title's end.
  const cjkTitle = paragraph.match(/^\d+(?:\.\d+)+\.?\s+([぀-ヿ一-鿿]{2,12})\s+(?=[぀-ヿ一-鿿])/)
  if (cjkTitle && paragraph.length > 60) return cjkTitle[0].length
  let previous = 0
  for (const match of paragraph.matchAll(/[.!?]\s+(?=\p{Lu})/gu)) {
    const at = (match.index ?? 0) + match[0].length
    const display = paragraph.slice(previous, at)
    previous = at
    const tail = paragraph.slice(at)
    if ((tail.match(/[A-Za-z]{3,}/g)?.length ?? 0) < 4) continue
    if (isEquation(tail) || !isEquation(display)) continue
    return at
  }
  return -1
}

function isPdfMetadataArtifact(text: string) {
  if (!text) return false
  if (text.includes('\u0000') || /<\/?latexit\b|sha1_base64\s*=|<\?xml\b/i.test(text)) return true
  const compact = text.replace(/\s/g, '')
  return compact.length > 120 && /^[A-Za-z0-9+/=]+$/.test(compact) && /[+/=]/.test(compact)
}

/** Legacy math fonts sometimes map plus/parentheses to standalone thorn/eth. */
export function hasDamagedMathEncoding(source: string) {
  return /[\u0080-\u009f]|(?:ffi){3,}|(?:^|\s)[þðÞ](?=\s|$)/.test(source)
}

export function segmentsFromItems(page: number, items: PdfTextItem[], weights: Record<string, number | undefined> = {}): TranslationSegment[] {
  let combined = ''
  const ranges: Array<{ start: number; end: number; itemIndex: number }> = []
  const bodyHeights = items.filter((item) => item.str.trim().length > 20).map((item) => Math.max(1, Math.abs(item.height || item.transform[3]))).sort((a, b) => a - b)
  const bodyHeight = bodyHeights[Math.floor(bodyHeights.length / 2)] ?? 10
  // How far apart this page sets its lines. A paragraph break used to be a
  // fixed multiple of glyph height, which assumes the leading every Latin
  // journal happens to use. Korean journals set 200% leading, so every single
  // line cleared the bar and became its own paragraph: sentences were cut at
  // the margin, tails became one-word segments, and lines with no punctuation
  // were read as headings. Measuring the page's own leading costs nothing and
  // needs to know nothing about the script.
  // Only the leading between body lines: a table's rows and a display's parts
  // jump by their own amounts and would drag the median away from the prose.
  const bodyLine = (item?: PdfTextItem) => !!item && item.str.trim().length > 12
    && Math.abs(Math.abs(item.height || item.transform[3]) - bodyHeight) < bodyHeight * .15
  const baselineGaps = items.slice(1).flatMap((item, index) => {
    if (!bodyLine(items[index]) || !bodyLine(item)) return []
    const gap = Math.abs(items[index].transform[5] - item.transform[5])
    return gap > bodyHeight * .4 && gap < bodyHeight * 4 ? [gap] : []
  }).sort((a, b) => a - b)
  const lineGap = baselineGaps[Math.floor(baselineGaps.length / 2)] ?? bodyHeight * 1.2
  // Only a page that really is set wide gets the derived threshold; anything at
  // ordinary Latin leading keeps exactly the behaviour it had.
  const wideLeading = baselineGaps.length >= 8 && lineGap > bodyHeight * 1.45
  const paragraphBreak = (height: number, factor: number) => wideLeading ? Math.max(height * factor, lineGap * (factor / 1.5)) : height * factor
  let previous: PdfTextItem | undefined
  let pendingEOL = false
  let displayMathRun = false
  const mathFont = (item?: PdfTextItem) => /(?:cmmi|cmsy|cmex|math|symbol|mtmi|mtsy|stmary|msam|msbm)/i.test(item?.fontName ?? '')
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]; const value = item.str.trim()
    if (!value || isPdfMetadataArtifact(value)) { if (item.hasEOL) pendingEOL = true; continue }
    if (previous && combined) {
      const previousY = previous.transform[5]; const nextY = item.transform[5]
      const height = Math.max(5, Math.abs(previous.height || previous.transform[3]))
      const nextHeight = Math.max(1, Math.abs(item.height || item.transform[3]))
      const verticalGap = Math.abs(previousY - nextY)
      const rawColumnReset = nextY > previousY + height * 1.2
      // Empty PDF.js items can carry the only EOL between centered displays and
      // prose. Use a slightly stronger gap for those markers so ordinary compact
      // table rows retain their established source identity.
      // With no paragraph break yet lastIndexOf returns -1, and adding 2 sliced the
      // first character off. Every rule below reads this value, so the opening
      // paragraph of each page was judged against text missing its first letter.
      const paragraphStartAt = combined.lastIndexOf('\n\n')
      const currentParagraph = paragraphStartAt < 0 ? combined : combined.slice(paragraphStartAt + 2)
      // PDF text order walks tall delimiters and fractions vertically even though
      // they belong to one visual display. Do not turn those short nearby glyphs
      // into separate paragraphs merely because their baseline moves upward/downward.
      const previousRight = previous.transform[4] + Math.max(0, previous.width || 0)
      const horizontalGap = item.transform[4] - previousRight
      const displayMathLead = isEquation(value) || mathFont(item) || /^(?:d|∂|∫|∑|√|\[|\]|\(|\{|\|)$/.test(value)
      const centeredMathAfterProse = (currentParagraph.match(/[A-Za-z]{3,}/g)?.length ?? 0) >= 3
        && displayMathLead && horizontalGap > 24 && verticalGap > height * .42
      const startsDisplayMath = (pendingEOL && wordCount(currentParagraph) >= 3 && verticalGap > height * .9 && displayMathLead
        && Math.abs(item.transform[4] - previous.transform[4]) > 40) || centeredMathAfterProse
      const inlineRadical = !pendingEOL && !previous.hasEOL && Math.abs(horizontalGap) < height * .8 && verticalGap < height * 1.2
        && (value === '√' || (previous.str.trim() === '√' && value.length <= 3))
      const equationContinuation = inlineRadical || (isEquation(currentParagraph) && (isEquation(value)
        || (pendingEOL && mathFont(item))
        || (value.length <= 4 && Math.abs(item.transform[4] - previous.transform[4]) < 24)))
        || (displayMathRun && (isEquation(value) || mathFont(item) || /^\(?\d{1,4}\)?$/.test(value) || value.length <= 4))
      const orientationBoundary = (Math.abs(previous.transform[1]) > Math.abs(previous.transform[0])) !== (Math.abs(item.transform[1]) > Math.abs(item.transform[0]))
        && (previous.str.length > 12 || item.str.length > 12)
      const columnReset = orientationBoundary || (rawColumnReset && !equationContinuation)
      const displayToProse = previous.hasEOL && verticalGap > height * .9 && isEquation(currentParagraph) && !isEquation(value) && !equationContinuation
      const numberedDisplayToProse = previous.hasEOL && /^\(\d{1,4}\)$/.test(previous.str.trim()) && verticalGap > height * .9
      const centeredDisplayAfterProse = startsDisplayMath
      // A section title is only slightly larger than body text and its leading sits
      // just under both thresholds above (measured: 1.54x against 1.55x, and 0.83x
      // against 0.80x), so the title kept absorbing the paragraph that follows it.
      // A numbered title followed by a real change in glyph size is a boundary.
      const headingToBody = !equationContinuation && verticalGap > height * .75
        && ((numberedTitle.test(currentParagraph) && !/[.!?]$/.test(currentParagraph)
        && currentParagraph.length < 120 && (Math.abs(nextHeight - height) > height * .08 || (!!item.fontName && item.fontName !== previous.fontName))) || namedHeading.test(currentParagraph))
      const captionBodyBoundary = captionStart.test(currentParagraph) && verticalGap > height * .75
        && weights[previous.fontName ?? ''] === 700
        && (weights[item.fontName ?? ''] === 400 || nextHeight > height * 1.08)
      const paragraphGap = captionBodyBoundary || headingToBody || (!equationContinuation && previous.hasEOL && verticalGap > paragraphBreak(height, 1.55))
        || (!equationContinuation && pendingEOL && verticalGap > paragraphBreak(height, 1.64)) || displayToProse || numberedDisplayToProse || centeredDisplayAfterProse
      // A number at an inline font boundary is often a subscript or a measured
      // dimension, not a section number (e.g. rho + "0 of ...", 300 mm × 300 mm).
      const headingBoundary = (verticalGap > height * .75 && (namedHeading.test(value) || /^appendix\b/i.test(value)))
        || captionStart.test(value)
        || (verticalGap > height * .75 && numberedTitle.test(value))
        // Numbered run-in subsection titles can use the same regular font and
        // line spacing as prose. Preserve their new paragraph without inventing
        // bold weight or splitting the body that follows on the same baseline.
        || (verticalGap > height * .75 && /^\(\d{1,3}\)\s+[A-Z][^.!?]{1,100}[.:]$/.test(value) && value.split(/\s+/).length <= 9)
      const bulletBoundary = verticalGap > height * .6 && /^[•●▪]\s*/.test(value)
      const displayGap = !equationContinuation && verticalGap > paragraphBreak(height, 1.8)
      const fontSizeBoundary = !equationContinuation && verticalGap > height * .75 && (nextHeight < height * .8 || nextHeight > height * 1.2)
      // An empty table cell arrives as a lone '-'. A word broken across lines keeps a
      // letter in front of its hyphen, so only join in that case. Otherwise one
      // empty cell swallows the caption boundary that follows it, because a true
      // joinHyphen skips every boundary test below, and table and caption merge.
      const trailingHyphen = /[A-Za-zÀ-ɏ가-힣]-$/.test(previous.str.trimEnd())
      const joinHyphen = trailingHyphen && !columnReset && !headingBoundary && /^[a-zà-ɏ가-힣]/.test(value) && verticalGap > height * .6
      const inlineHyphen = trailingHyphen && verticalGap < height * .3 && !headingBoundary
      if (joinHyphen && combined.endsWith('-')) { combined = combined.slice(0, -1); const lastRange = ranges.at(-1); if (lastRange) lastRange.end -= 1 }
      combined += joinHyphen || inlineHyphen ? '' : (columnReset || paragraphGap || headingBoundary || bulletBoundary || displayGap || fontSizeBoundary ? '\n\n' : ' ')
      if (startsDisplayMath) displayMathRun = true
      if (numberedDisplayToProse || (displayMathRun && !equationContinuation && !mathFont(item) && wordCount(value) >= 3)) displayMathRun = false
    }
    const start = combined.length; combined += value
    ranges.push({ start, end: combined.length, itemIndex }); previous = item; pendingEOL = false
  }

  const parts: Array<{ text: string; start: number; end: number; blockId: string; paragraphContext: string }> = []
  let paragraphIndex = 0
  for (const paragraphMatch of combined.matchAll(/[^\n]+/g)) {
    const paragraph = paragraphMatch[0].trim()
    if (!paragraph || isPublicationFurniture(paragraph)) continue
    const blockId = `pdf-p${page}-b${paragraphIndex++}`
    const paragraphStart = paragraphMatch.index + paragraphMatch[0].indexOf(paragraph)
    const displayWithProse = paragraph.match(/^([\s\S]*?\(\d+\))\s+((?:where|when|since|which)\b[\s\S]+)$/i)
    if (displayWithProse && (isEquation(displayWithProse[1]) || isEquation(parts.at(-1)?.text ?? ''))) {
      const proseOffset = paragraph.indexOf(displayWithProse[2], displayWithProse[1].length)
      parts.push({ text: displayWithProse[1], start: paragraphStart, end: paragraphStart + displayWithProse[1].length, blockId, paragraphContext: displayWithProse[1] })
      parts.push({ text: displayWithProse[2], start: paragraphStart + proseOffset, end: paragraphStart + proseOffset + displayWithProse[2].length, blockId: `pdf-p${page}-b${paragraphIndex++}`, paragraphContext: displayWithProse[2] })
      continue
    }
    // A display equation and the sentence that follows it often arrive as one
    // paragraph, and the whole thing was then classified as an equation and left
    // untranslated — the sentence disappeared from the reading view with it. The
    // rule above catches only a numbered display followed by "where"/"which";
    // this finds the boundary itself, at the first sentence end that leaves
    // maths behind it and a real sentence in front.
    const gridStart = captionStart.test(paragraph) ? captionGridStart(paragraph) : -1
    if (gridStart > 0) {
      const head = paragraph.slice(0, gridStart).trimEnd()
      const tail = paragraph.slice(gridStart).trimStart()
      const tailStart = paragraphStart + paragraph.indexOf(tail, head.length)
      parts.push({ text: head, start: paragraphStart, end: paragraphStart + head.length, blockId, paragraphContext: head })
      parts.push({ text: tail, start: tailStart, end: tailStart + tail.length, blockId: `pdf-p${page}-b${paragraphIndex++}`, paragraphContext: tail })
      continue
    }
    const proseAt = trailingProseOffset(paragraph)
    if (proseAt > 0) {
      const head = paragraph.slice(0, proseAt).trimEnd()
      const tail = paragraph.slice(proseAt)
      parts.push({ text: head, start: paragraphStart, end: paragraphStart + head.length, blockId, paragraphContext: head })
      parts.push({ text: tail, start: paragraphStart + proseAt, end: paragraphStart + proseAt + tail.length, blockId: `pdf-p${page}-b${paragraphIndex++}`, paragraphContext: tail })
      continue
    }
    if ((isEquation(paragraph) && paragraph.length < 260) || captionStart.test(paragraph) || (numberedTitle.test(paragraph) && paragraph.length < 140 && !/[.!?]\s+[A-Z]/.test(paragraph.replace(/^(?:[IVX]+\.|\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.?)\s+/, ''))) || namedHeading.test(paragraph)) {
      parts.push({ text: paragraph, start: paragraphStart, end: paragraphStart + paragraph.length, blockId, paragraphContext: paragraph }); continue
    }
    // The English sentence segmenter reads the full stop in "0 . 5" or "Fig. 2" as
    // an ending and chops formulas and abbreviations apart. Masking keeps the same
    // length, so offsets hold and each cut can be read back out of the original.
    const masked = paragraph
      .replace(/\b([A-Z][a-z]+\s+[A-Z])\.(?=\s+[A-Z][a-z])/g, `$1${sentenceGuard}`)
      .replace(/(\d)(\s*)\.(\s*)(\d)/g, `$1$2${sentenceGuard}$3$4`)
      .replace(/\b(?:Fig|Figs|Eq|Eqs|Sec|Ref|Refs|Tab|No|vs|cf|al|approx|resp|etc|Dr|Prof|Mr|Mrs|Ms|St)\./gi, (whole) => `${whole.slice(0, -1)}${sentenceGuard}`)
    const sentences = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(masked)]
        .map((part) => ({ segment: paragraph.slice(part.index, part.index + part.segment.length), index: part.index }))
      : masked.split(/(?<=[.!?])\s+/).map((segment, index, all) => {
        const at = all.slice(0, index).join(' ').length + (index ? 1 : 0)
        return { segment: paragraph.slice(at, at + segment.length), index: at }
      })
    // The masking above can only spare the abbreviations someone thought to
    // list, and the list is English. Every other full stop that is not a
    // sentence ending — an initial, a section number, an equation label, a
    // journal abbreviation in a language nobody enumerated — still cuts here,
    // and each cut costs a model call and reads as noise in the translation.
    //
    // Rather than extend the list, discard the cuts by their result: a piece too
    // small to be a sentence in any language is not one, whatever produced it.
    // It rejoins the sentence it was cut from, forwards where there is one,
    // since a stray head ("Abstract.", "2.1.", "L.") introduces what follows.
    for (const sentence of coalesceFragments(sentences)) {
      const text = sentence.segment.trim()
      if (text.length < 2) continue
      const start = paragraphStart + sentence.index + sentence.segment.indexOf(text)
      parts.push({ text, start, end: start + text.length, blockId, paragraphContext: paragraph })
    }
  }
  const preliminary = parts.map((part, index) => {
    const matchedRanges = ranges.filter((range) => range.end > part.start && range.start < part.end)
    const itemSlices = matchedRanges.map((range) => ({
      itemIndex: range.itemIndex,
      start: Math.max(0, Math.min(1, (Math.max(part.start, range.start) - range.start) / Math.max(1, range.end - range.start))),
      end: Math.max(0, Math.min(1, (Math.min(part.end, range.end) - range.start) / Math.max(1, range.end - range.start))),
    })).filter((slice) => slice.end > slice.start)
    const matchedItems = itemSlices.map((slice) => items[slice.itemIndex])
    const heights = matchedItems.map((item) => Math.max(1, Math.abs(item.height || item.transform[3])))
    const averageHeight = heights.reduce((sum, value) => sum + value, 0) / Math.max(1, heights.length)
    const punctuation = (part.text.match(/[.!?;:]/g) ?? []).length
    const digits = (part.text.match(/\d/g) ?? []).length
    const numberedHeading = /^(?:\d+(?:\.\d+)+|[A-Z]\.\d+)\.?\s+/.test(part.text) || (/^(?:\d+\.?|[IVX]+\.)\s+[A-Z]/.test(part.text) && averageHeight > bodyHeight * 1.08)
    const sectionHeading = numberedHeading || namedHeading.test(part.text) || /^appendix\b/i.test(part.text)
    const caption = captionStart.test(part.text)
    const shortFragments = matchedItems.filter((item) => item.str.trim().length < (/[぀-ヿ一-鿿]/.test(item.str) ? 14 : 32)).length
    const lineYs = new Set(matchedItems.map((item) => Math.round(item.transform[5] / 3)))
    const digitRatio = digits / Math.max(1, part.text.length)
    const numericLayout = digits >= 6 && digitRatio > .12 && matchedItems.length >= 5
    const proseWordCount = wordCount(part.text)
    // A short emphasised phrase ("Arti-PG toolbox.") arrives as several bold runs
    // and looks like table debris, yet it sits inside a paragraph of full
    // sentences. Tables and bibliography entries never form such a paragraph, so
    // require a long, multi-sentence context before granting the exception. One
    // fragment misread here drops its whole paragraph from translation.
    const digitShare = (part.text.match(/\d/g)?.length ?? 0) / Math.max(1, part.text.length)
    const inProseParagraph = wordCount(part.paragraphContext) >= 60
      && (part.paragraphContext.match(/[.!?]\s/g)?.length ?? 0) >= 3
    const proseLooking = inProseParagraph && (/\b[a-z]{4,}\b/.test(part.text) || /[぀-ヿ一-鿿가-힣]{4,}/.test(part.text))
      && !/[=+×÷∑∫√∞≈≠≤≥∈⊂⊆∀∃∇∂]/.test(part.text) && digitShare < .08
    const hasProseSentence = (/[.!?。！？]$/.test(part.text) && (proseWordCount >= 4 || proseLooking)) || (/[,;:，；：]$/.test(part.text) && proseWordCount >= 6)
    const likelyGraphicOrTable = !caption && !hasProseSentence && averageHeight <= bodyHeight * 1.08 && (numericLayout || (!sectionHeading && (
      (shortFragments >= 2 && shortFragments === matchedItems.length && lineYs.size <= 3)
      || (digitRatio > .18 && matchedItems.length >= 4)
    )))
    const mathFontRatio = matchedItems.filter((item) => /(?:cmmi|cmsy|cmex|math|symbol|mtmi|mtsy|stmary|msam|msbm)/i.test(item.fontName ?? '')).length / Math.max(1, matchedItems.length)
    const proseMathClause = /^(?:where|given|let|since|when|for|with|and|if)\b/i.test(part.text.trim())
    const fontMarkedEquation = !caption && !proseMathClause && part.text.length < 260 && mathFontRatio >= .45 && (part.text.match(/[A-Za-z]{3,}/g)?.length ?? 0) < 4
    // A missing font mapping can be an inequality or an experimental condition.
    // Preserve the original pixels instead of asking a translator to guess it.
      const algorithm = /^Algorithm\s+\d+\b/i.test(part.text) && /(?:\b\d+\s*:|←|\b(?:Input|Output|Require|Ensure):)/.test(part.text)
    const rotatedLabels = matchedItems.length > 1 && matchedItems.every(item => Math.abs(item.transform[1]) > Math.abs(item.transform[0]) * 2)
      && items.some(item => item.str.length > 60 && Math.abs(item.transform[0]) > Math.abs(item.transform[1]) * 2)
    const codeListing = /\b\w+\s*=\s*[A-Za-z]\w*\(/.test(part.text) && /\);/.test(part.text)
      || (part.text.match(/\b[A-Z]\w*\([^)]*\);/g)?.length ?? 0) >= 2
    // Panel headings can be emitted right-to-left on the same baseline. They
    // are separate labels, not one prose sentence spanning the entire diagram.
    const panelLabels = !/[.!?]/.test(part.text) && matchedItems.some((item, at) => {
      const previous = matchedItems[at - 1]
      return previous && item.transform[4] + item.width < previous.transform[4] - averageHeight * 3
        && Math.abs(item.transform[5] - previous.transform[5]) < averageHeight * .4
        && wordCount(item.str) >= 3 && wordCount(previous.str) >= 3
    })
        // Nothing in any script to translate: a standalone equation label "(2.1)",
    // a list marker "19.", a row of measurements. Sending these to a translator
    // costs a call and returns the same characters, and they were arriving as
    // ordinary prose because the equation test needs an operator to fire and a
    // parenthesised number has none.
    const nothingToTranslate = !/\p{L}/u.test(part.text)
    const kind: TranslationSegment['kind'] = algorithm ? 'table' : (nothingToTranslate || rotatedLabels || codeListing || panelLabels || part.text.includes('\uFFFD') || /[\u0080-\u009f]|(?:ffi){3,}/.test(part.text) || ((part.text.match(/[ðÞþ¼]/g)?.length ?? 0) >= 3 && /[=χρ∑∫]/.test(part.text))) ? 'artifact' : caption ? 'caption'
      : sectionHeading && part.text.length < 140 ? 'heading'
      : isEquation(part.text) || fontMarkedEquation ? 'equation'
        : likelyGraphicOrTable ? 'artifact'
          : sectionHeading || (part.text === part.paragraphContext && punctuation === 0 && part.text.length < 140 && averageHeight > bodyHeight * 1.08) ? 'heading' : 'text'
    return { id: `p${page}-s${index}-${shortHash(part.text)}`, page, source: part.text, kind, blockId: part.blockId, paragraphContext: part.paragraphContext, itemIndexes: itemSlices.map((slice) => slice.itemIndex), itemSlices }
  })
  const shortLayoutFragments = preliminary.filter((segment) => ['text', 'heading'].includes(segment.kind) && segment.source.length < shortFragmentLength(segment.source) && !sentenceEnd.test(segment.source)).length
  const denseLayoutPage = shortLayoutFragments >= 6 && shortLayoutFragments / Math.max(1, preliminary.length) > .18
  const classified = preliminary.map((segment, index) => {
    if (segment.kind === 'heading' && !numberedTitle.test(segment.source) && !namedHeading.test(segment.source) && preliminary[index + 1]?.kind === 'caption' && !/^(?:figure|table|algorithm)/i.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    const semanticHeading = numberedTitle.test(segment.source) || /^(?:abstract|references|acknowledg(?:e)?ments?|appendix\b|\d+(?:\.\d+)*\s+|[A-Z]\.\d+\s+)/i.test(segment.source)
    if (denseLayoutPage && ['text', 'heading'].includes(segment.kind) && !semanticHeading && segment.source.length < shortFragmentLength(segment.source) && !sentenceEnd.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    return segment
  })
  const merged: TranslationSegment[] = []
  for (let index = 0; index < classified.length; index += 1) {
    const current = classified[index]; const next = classified[index + 1]; const after = classified[index + 2]
    // A display split across lines leaves a scrap between its halves, and
    // rejoining the three restores one equation. But the piece between two
    // displays is just as often the sentence that links them ("... ds. Then we
    // rewrite (2.2) in the form ..."), and absorbing that into an equation drops
    // it from translation entirely — the sentence simply vanished from the
    // reading view. A scrap has no sentence in it; this one does.
    const linkingProse = next && (next.source.match(/[A-Za-z]{3,}/g)?.length ?? 0) >= 4 && /\p{Ll}\s+\p{L}/u.test(next.source)
    // An inline expression that ends a sentence is emitted in its own font run
    // and became a block of its own: "... can be represented as a linear
    // function of" and then "PE pos ." on a line by itself, one sentence torn
    // in two with the half that carries the maths left untranslated. A sentence
    // that has not ended yet is still owed its ending, so a short expression
    // directly after it belongs to it.
    const unfinishedProse = current.kind === 'text' && !/[.!?:;]["')\]]?$/.test(current.source.trim())
    // A centred display below the same unfinished line is a different thing and
    // must stay its own block, so the continuation has to begin at the column's
    // own left edge rather than indented into the middle of the page.
    const leftOf = (segment?: TranslationSegment) => Math.min(...(segment?.itemIndexes ?? []).map(at => items[at]?.transform[4] ?? Infinity))
    const trailingExpression = next && ['artifact', 'equation'].includes(next.kind) && next.source.trim().length <= 24
      && !/[.!?].*\S/.test(next.source.trim()) && current.page === next.page
      && Number.isFinite(leftOf(next)) && Number.isFinite(leftOf(current)) && leftOf(next) - leftOf(current) < 24
    if (unfinishedProse && trailingExpression) {
      const source = `${current.source} ${next.source}`.replace(/\s+/g, ' ').trim()
      merged.push({ ...current, source, itemIndexes: [...(current.itemIndexes ?? []), ...(next.itemIndexes ?? [])], itemSlices: [...(current.itemSlices ?? []), ...(next.itemSlices ?? [])] })
      index += 1; continue
    }
    if (current.kind === 'equation' && next?.kind === 'artifact' && after?.kind === 'equation' && linkingProse) {
      // Sitting between two displays is what made it look like part of one.
      merged.push(current, { ...next, kind: 'text' })
      index += 1; continue
    }
    if (current.kind === 'equation' && next?.kind === 'artifact' && after?.kind === 'equation') {
      const source = `${current.source} ${next.source} ${after.source}`.replace(/\s+/g, ' ').trim()
      merged.push({ ...current, id: `p${page}-eq-${shortHash(source)}`, source, itemIndexes: [...(current.itemIndexes ?? []), ...(next.itemIndexes ?? []), ...(after.itemIndexes ?? [])], itemSlices: [...(current.itemSlices ?? []), ...(next.itemSlices ?? []), ...(after.itemSlices ?? [])] })
      index += 2; continue
    }
    merged.push(current)
  }
  return merged
}

type SentencePiece = { segment: string; index: number }

/** A piece too small to carry a sentence, measured without reference to any
 * language: too few letters to be words at all, or one or two short tokens.
 * Scripts that do not space their words are judged on letters alone, since a
 * two-token test would call every Japanese sentence a fragment. */
function isSentenceFragment(value: string) {
  const text = value.trim()
  if (!text) return true
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (letters < 3) return true
  // Han, Hiragana and Katakana run words together, so counting tokens would
  // call every Japanese sentence a fragment. Korean and Latin both space words.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return letters < 6
  const tokens = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return tokens <= 2 && text.length <= 14
}

/** True when the piece stops on an author initial rather than at a sentence end.
 * No sentence in a cased script ends on a lone capital letter, so this is the
 * one abbreviation shape that can be recognised without a dictionary and
 * without guessing — "shown by Koonin, E." continues into "V. and others".
 *
 * Truncated words ("Phil.", "Soc.") are deliberately not matched. They are the
 * same shape as an acronym that really does end a sentence ("... the remaining
 * FCs."), and merging those swallowed a paragraph of prose into the table
 * beside it. A citation therefore still breaks at "Phil."; it no longer breaks
 * at every initial, which is where the fragments came from. */
function endsOnInitial(value: string) {
  const text = value.trim().replace(/["')\]]+$/, '')
  if (!text.endsWith('.')) return false
  const lastToken = text.slice(0, -1).match(/[\p{L}\p{N}]+$/u)?.[0] ?? ''
  // Names are written in Latin or Cyrillic; a lone Greek capital is a variable.
  // Reading "a disk Ω ." as an initial joined a section title to the paragraph
  // under it and produced a 189-character heading.
  return lastToken.length === 1 && /^[A-ZА-Я]$/.test(lastToken)
}

/** Rejoins sentence fragments with their neighbour, preferring the sentence
 * that follows. Offsets stay meaningful because the pieces are adjacent slices
 * of one paragraph, so a merged piece spans from the first index to the last. */
function coalesceFragments(sentences: SentencePiece[]): SentencePiece[] {
  const merged: SentencePiece[] = []
  let pending: SentencePiece | undefined
  for (const sentence of sentences) {
    const start = pending ?? sentence
    const segment = pending ? pending.segment + sentence.segment.slice(Math.max(0, pending.index + pending.segment.length - sentence.index)) : sentence.segment
    const candidate = { segment, index: start.index }
    if (isSentenceFragment(candidate.segment) || endsOnInitial(candidate.segment)) { pending = candidate; continue }
    merged.push(candidate); pending = undefined
  }
  // A fragment at the very end has nothing to introduce, and it is usually a
  // clause continuing into the next column or page ("... a continuation. While").
  // Appending it to the finished sentence before it would put a dangling word
  // inside a sentence that is already complete, so it stays as it is.
  if (pending) merged.push(pending)
  return merged
}

function wordCount(value: string) {
  return (value.match(/[A-Za-z가-힣]{2,}/g)?.length ?? 0) + Math.round((value.match(/[぀-ヿ一-鿿]/g)?.length ?? 0) / 2)
}
