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
  const proseWords = text.match(/[A-Za-z]{3,}/g)?.length ?? 0
  // Explanatory clauses can be mostly symbols ("where T(t)=…") while still
  // belonging to the surrounding sentence. A grammatical lead is stronger
  // evidence than symbol density and must stay translatable prose.
  if (/^(?:where|given|let|since|when|for|with|and|if)\b/i.test(text.trim()) && proseWords >= 1) return false
  if (proseWords >= 4) return false
  const symbols = (compact.match(/[=+\-×÷∑∫√∞≈≠≤≥<>^_{}()[\]\\|\u2200-\u22ff︷︸]/g) ?? []).length
  const letters = (compact.match(/[A-Za-z가-힣]/g) ?? []).length
  return (symbols >= 2 && symbols / compact.length > .12) || (letters === 0 && symbols > 0)
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
      const paragraphGap = captionBodyBoundary || headingToBody || (!equationContinuation && previous.hasEOL && verticalGap > height * 1.55)
        || (!equationContinuation && pendingEOL && verticalGap > height * 1.64) || displayToProse || numberedDisplayToProse || centeredDisplayAfterProse
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
      const displayGap = !equationContinuation && verticalGap > height * 1.8
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
    const shortFragments = matchedItems.filter((item) => item.str.trim().length < 32).length
    const lineYs = new Set(matchedItems.map((item) => Math.round(item.transform[5] / 3)))
    const digitRatio = digits / Math.max(1, part.text.length)
    const numericLayout = digits >= 6 && digitRatio > .12 && matchedItems.length >= 5
    const proseWordCount = part.text.match(/[A-Za-z]{2,}/g)?.length ?? 0
    // A short emphasised phrase ("Arti-PG toolbox.") arrives as several bold runs
    // and looks like table debris, yet it sits inside a paragraph of full
    // sentences. Tables and bibliography entries never form such a paragraph, so
    // require a long, multi-sentence context before granting the exception. One
    // fragment misread here drops its whole paragraph from translation.
    const digitShare = (part.text.match(/\d/g)?.length ?? 0) / Math.max(1, part.text.length)
    const inProseParagraph = (part.paragraphContext.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 60
      && (part.paragraphContext.match(/[.!?]\s/g)?.length ?? 0) >= 3
    const proseLooking = inProseParagraph && /\b[a-z]{4,}\b/.test(part.text)
      && !/[=+×÷∑∫√∞≈≠≤≥∈⊂⊆∀∃∇∂]/.test(part.text) && digitShare < .08
    const hasProseSentence = (/[.!?]$/.test(part.text) && (proseWordCount >= 4 || proseLooking)) || (/[,;:]$/.test(part.text) && proseWordCount >= 6)
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
    const kind: TranslationSegment['kind'] = algorithm ? 'table' : (rotatedLabels || codeListing || panelLabels || part.text.includes('\uFFFD') || /[\u0080-\u009f]|(?:ffi){3,}/.test(part.text) || ((part.text.match(/[ðÞþ¼]/g)?.length ?? 0) >= 3 && /[=χρ∑∫]/.test(part.text))) ? 'artifact' : caption ? 'caption'
      : sectionHeading && part.text.length < 140 ? 'heading'
      : isEquation(part.text) || fontMarkedEquation ? 'equation'
        : likelyGraphicOrTable ? 'artifact'
          : sectionHeading || (part.text === part.paragraphContext && punctuation === 0 && part.text.length < 140 && averageHeight > bodyHeight * 1.08) ? 'heading' : 'text'
    return { id: `p${page}-s${index}-${shortHash(part.text)}`, page, source: part.text, kind, blockId: part.blockId, paragraphContext: part.paragraphContext, itemIndexes: itemSlices.map((slice) => slice.itemIndex), itemSlices }
  })
  const shortLayoutFragments = preliminary.filter((segment) => ['text', 'heading'].includes(segment.kind) && segment.source.length < 38 && !/[.!?:]$/.test(segment.source)).length
  const denseLayoutPage = shortLayoutFragments >= 6 && shortLayoutFragments / Math.max(1, preliminary.length) > .18
  const classified = preliminary.map((segment, index) => {
    if (segment.kind === 'heading' && !numberedTitle.test(segment.source) && !namedHeading.test(segment.source) && preliminary[index + 1]?.kind === 'caption' && !/^(?:figure|table|algorithm)/i.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    const semanticHeading = numberedTitle.test(segment.source) || /^(?:abstract|references|acknowledg(?:e)?ments?|appendix\b|\d+(?:\.\d+)*\s+|[A-Z]\.\d+\s+)/i.test(segment.source)
    if (denseLayoutPage && ['text', 'heading'].includes(segment.kind) && !semanticHeading && segment.source.length < 38 && !/[.!?:]$/.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    return segment
  })
  const merged: TranslationSegment[] = []
  for (let index = 0; index < classified.length; index += 1) {
    const current = classified[index]; const next = classified[index + 1]; const after = classified[index + 2]
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
  return lastToken.length === 1 && /^\p{Lu}$/u.test(lastToken)
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
  return value.match(/[A-Za-z가-힣]{2,}/g)?.length ?? 0
}
