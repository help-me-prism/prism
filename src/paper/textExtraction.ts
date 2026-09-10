export type PdfTextItem = { str: string; width: number; height: number; transform: number[]; hasEOL?: boolean; fontName?: string }

// A figure reference such as "Fig 2)" can begin a PDF text item in the middle
// of body prose. Only a caption label delimiter (or a label alone) starts a block.
const captionStart = /^(?:figure|fig\.?|table|algorithm)\s*\d+(?:\s*[.:](?:\s|$)|\s*$)/i
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

export function segmentsFromItems(page: number, items: PdfTextItem[]): TranslationSegment[] {
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
      const currentParagraph = combined.slice(combined.lastIndexOf('\n\n') + 2)
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
      const equationContinuation = (isEquation(currentParagraph) && (isEquation(value)
        || (pendingEOL && mathFont(item))
        || (value.length <= 4 && Math.abs(item.transform[4] - previous.transform[4]) < 24)))
        || (displayMathRun && (isEquation(value) || mathFont(item) || /^\(?\d{1,4}\)?$/.test(value) || value.length <= 4))
      const columnReset = rawColumnReset && !equationContinuation
      const displayToProse = previous.hasEOL && verticalGap > height * .9 && isEquation(currentParagraph) && !isEquation(value) && !equationContinuation
      const numberedDisplayToProse = previous.hasEOL && /^\(\d{1,4}\)$/.test(previous.str.trim()) && verticalGap > height * .9
      const centeredDisplayAfterProse = startsDisplayMath
      const paragraphGap = (!equationContinuation && previous.hasEOL && verticalGap > height * 1.55)
        || (!equationContinuation && pendingEOL && verticalGap > height * 1.64) || displayToProse || numberedDisplayToProse || centeredDisplayAfterProse
      // A number at an inline font boundary is often a subscript or a measured
      // dimension, not a section number (e.g. rho + "0 of ...", 300 mm × 300 mm).
      const headingBoundary = /^(?:abstract|references|acknowledg(?:e)?ments?|appendix)\b/i.test(value)
        || captionStart.test(value)
        || (verticalGap > height * .75 && /^\d+(?:\.\d+)*\s+[A-Z]/.test(value))
        // Numbered run-in subsection titles can use the same regular font and
        // line spacing as prose. Preserve their new paragraph without inventing
        // bold weight or splitting the body that follows on the same baseline.
        || (verticalGap > height * .75 && /^\(\d{1,3}\)\s+[A-Z][^.!?]{1,100}[.:]$/.test(value) && value.split(/\s+/).length <= 9)
      const displayGap = !equationContinuation && verticalGap > height * 1.8
      const fontSizeBoundary = !equationContinuation && verticalGap > height * .75 && (nextHeight < height * .8 || nextHeight > height * 1.2)
      const joinHyphen = previous.str.trimEnd().endsWith('-') && !columnReset
      if (joinHyphen && combined.endsWith('-')) { combined = combined.slice(0, -1); const lastRange = ranges.at(-1); if (lastRange) lastRange.end -= 1 }
      combined += joinHyphen ? '' : (columnReset || paragraphGap || headingBoundary || displayGap || fontSizeBoundary ? '\n\n' : ' ')
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
    if ((isEquation(paragraph) && paragraph.length < 260) || captionStart.test(paragraph)) {
      parts.push({ text: paragraph, start: paragraphStart, end: paragraphStart + paragraph.length, blockId, paragraphContext: paragraph }); continue
    }
    const sentences = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(paragraph)]
      : paragraph.split(/(?<=[.!?])\s+/).map((segment, index, all) => ({ segment, index: all.slice(0, index).join(' ').length + (index ? 1 : 0) }))
    for (const sentence of sentences) {
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
    const numberedHeading = /^\d+(?:\.\d+)+\s+/.test(part.text) || (/^\d+\s+[A-Z]/.test(part.text) && averageHeight > bodyHeight * 1.08)
    const sectionHeading = numberedHeading || /^(?:abstract$|references$|acknowledg(?:e)?ments?$|appendix\b)/i.test(part.text)
    const caption = captionStart.test(part.text)
    const shortFragments = matchedItems.filter((item) => item.str.trim().length < 32).length
    const lineYs = new Set(matchedItems.map((item) => Math.round(item.transform[5] / 3)))
    const digitRatio = digits / Math.max(1, part.text.length)
    const numericLayout = digits >= 6 && digitRatio > .12 && matchedItems.length >= 5
    const proseWordCount = part.text.match(/[A-Za-z]{2,}/g)?.length ?? 0
    const hasProseSentence = (/[.!?]$/.test(part.text) && proseWordCount >= 4) || (/[,;:]$/.test(part.text) && proseWordCount >= 6)
    const likelyGraphicOrTable = !caption && !hasProseSentence && averageHeight <= bodyHeight * 1.08 && (numericLayout || (!sectionHeading && (
      (shortFragments >= 2 && shortFragments === matchedItems.length && lineYs.size <= 3)
      || (digitRatio > .18 && matchedItems.length >= 4)
    )))
    const mathFontRatio = matchedItems.filter((item) => /(?:cmmi|cmsy|cmex|math|symbol|mtmi|mtsy|stmary|msam|msbm)/i.test(item.fontName ?? '')).length / Math.max(1, matchedItems.length)
    const proseMathClause = /^(?:where|given|let|since|when|for|with|and|if)\b/i.test(part.text.trim())
    const fontMarkedEquation = !caption && !proseMathClause && part.text.length < 260 && mathFontRatio >= .45 && (part.text.match(/[A-Za-z]{3,}/g)?.length ?? 0) < 4
    // A missing font mapping can be an inequality or an experimental condition.
    // Preserve the original pixels instead of asking a translator to guess it.
    const kind: TranslationSegment['kind'] = part.text.includes('\uFFFD') ? 'artifact' : caption ? 'caption'
      : isEquation(part.text) || fontMarkedEquation ? 'equation'
        : likelyGraphicOrTable ? 'artifact'
          : sectionHeading || (part.text === part.paragraphContext && punctuation === 0 && part.text.length < 140 && averageHeight > bodyHeight * 1.08) ? 'heading' : 'text'
    return { id: `p${page}-s${index}-${shortHash(part.text)}`, page, source: part.text, kind, blockId: part.blockId, paragraphContext: part.paragraphContext, itemIndexes: itemSlices.map((slice) => slice.itemIndex), itemSlices }
  })
  const shortLayoutFragments = preliminary.filter((segment) => ['text', 'heading'].includes(segment.kind) && segment.source.length < 38 && !/[.!?:]$/.test(segment.source)).length
  const denseLayoutPage = shortLayoutFragments >= 6 && shortLayoutFragments / Math.max(1, preliminary.length) > .18
  const classified = preliminary.map((segment, index) => {
    if (segment.kind === 'heading' && preliminary[index + 1]?.kind === 'caption' && !/^(?:figure|table|algorithm)/i.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    const semanticHeading = /^(?:abstract|references|acknowledg(?:e)?ments?|appendix\b|\d+(?:\.\d+)*\s+)/i.test(segment.source)
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

function wordCount(value: string) {
  return value.match(/[A-Za-z가-힣]{2,}/g)?.length ?? 0
}

