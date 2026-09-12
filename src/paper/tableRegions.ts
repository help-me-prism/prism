type TableSegment = { kind: string; source: string; page?: number; preciseRects?: TableRect[] }

function bounds(rects?: TableRect[]) {
  if (!rects?.length) return undefined
  const left = Math.min(...rects.map(rect => rect.left)); const top = Math.min(...rects.map(rect => rect.top))
  const right = Math.max(...rects.map(rect => rect.left + rect.width)); const bottom = Math.max(...rects.map(rect => rect.top + rect.height))
  return { left, top, width: right - left, height: bottom - top }
}

function fallbackMembers(segments: TableSegment[], captionIndex: number, limit: number) {
  const members = new Set([captionIndex])
  for (const direction of [-1, 1]) for (let step = 1; step <= limit; step += 1) {
    const index = captionIndex + direction * step; const candidate = segments[index]
    if (!candidate || candidate.kind === 'caption' || candidate.kind === 'heading' || candidate.kind === 'table') break
    const wordCount = candidate.source.match(/[A-Za-z가-힣]{2,}/g)?.length ?? 0
    if (/[.!?]$/.test(candidate.source) && wordCount >= 4) break
    const shortCellText = candidate.source.length <= 180 && wordCount <= 18 && !/[.!?]$/.test(candidate.source)
    if (!['artifact', 'equation'].includes(candidate.kind) && !shortCellText) break
    members.add(index)
  }
  return [...members].sort((left, right) => left - right)
}

/** Find the bounded PDF-text run belonging to a LaTeX-confirmed table caption.
 * PDF reading order is not a table boundary: a wide cell can look like prose,
 * while a following chart consists entirely of short numeric artifacts. Prefer
 * the geometrically coherent side of the caption and use the old text-only
 * walk only when precise glyph bounds are unavailable. */
export function tableMemberIndexes(segments: TableSegment[], captionIndex: number, limit = 48) {
  const caption = segments[captionIndex]; const captionBox = bounds(caption?.preciseRects)
  if (!caption || !captionBox) return fallbackMembers(segments, captionIndex, Math.min(limit, 16))
  // Prompt listings are text-only tables: sentences are cell contents, not a
  // reason to stop. Their explicit title closes the upward walk.
  if (/prompt format/i.test(caption.source)) {
    const members: number[] = []
    for (let index = captionIndex - 1; index >= Math.max(0, captionIndex - 20); index--) {
      const candidate = segments[index]; const box = bounds(candidate.preciseRects)
      if (candidate.page !== caption.page || candidate.kind === 'caption' || !box || Math.abs(box.left - captionBox.left) > 35) break
      members.push(index)
      if (/^(?:Inference\s+)?(?:Input|Prompt) Format/i.test(candidate.source)) return [...members.reverse(), captionIndex]
      if (candidate.kind === 'heading') break
    }
  }
  const captionCenter = captionBox.left + captionBox.width / 2
  const runs = [-1, 1].map(direction => {
    const indexes: number[] = []; let previousBox = captionBox; let score = 0; let firstGap = Infinity
    for (let step = 1; step <= limit; step += 1) {
      const index = captionIndex + direction * step; const candidate = segments[index]; const box = bounds(candidate?.preciseRects)
      if (!candidate || candidate.page !== caption.page || !box || candidate.kind === 'caption' || candidate.kind === 'heading' || candidate.kind === 'table') break
      const wordCount = candidate.source.match(/[A-Za-z가-힣]{2,}/g)?.length ?? 0
      const numericCount = candidate.source.match(/\d+(?:\.\d+)?/g)?.length ?? 0
      // Abbreviated model names in cells often end in a period ("Uncond.",
      // "Self-cond."). A short numeric row is still table evidence, not prose.
      // The short-numeric-row exception below was swallowing real sentences that
      // happen to carry a number — "increased the maximum output length to input
      // length + 300 ." was read as a cell and preserved as table pixels, so a
      // paragraph after Table 4 stopped being translated. A row of cells is
      // short; a sentence of eight words or more is prose whatever it counts.
      const proseSentence = /[.!?]$/.test(candidate.source)
        && !/\b(?:acc|avg|std|dev|uncond|cond)\.$/i.test(candidate.source)
        && (wordCount >= 8 || (wordCount >= 5 && numericCount < 3 && !(candidate.source.length < 90 && numericCount >= 1)))
      const verticalGap = Math.max(0, Math.max(box.top, previousBox.top) - Math.min(box.top + box.height, previousBox.top + previousBox.height))
      const candidateCenter = box.left + box.width / 2
      const aligned = Math.abs(candidateCenter - captionCenter) <= Math.max(150, captionBox.width * .72)
      const tableLike = ['artifact', 'equation'].includes(candidate.kind) || numericCount >= 2 || (candidate.source.length <= 220 && wordCount <= 24)
      if (verticalGap > 34 || !aligned || !tableLike || proseSentence) break
      if (!indexes.length) firstGap = verticalGap
      indexes.push(index); previousBox = box
      score += (candidate.kind === 'artifact' ? 2 : 0) + Math.min(4, numericCount) + (box.width > captionBox.width * .45 ? 1 : 0)
    }
    const firstNumeric = indexes.length ? (segments[indexes[0]].source.match(/\d+(?:\.\d+)?/g)?.length ?? 0) : 0
    return { indexes, score: score ? 100 / (8 + firstGap) + Math.min(2, score * .05) + (firstNumeric >= 3 ? 1 : 0) : 0 }
  })
  const selected = runs.sort((left, right) => right.score - left.score || right.indexes.length - left.indexes.length)[0]
  return [captionIndex, ...(selected?.score ? selected.indexes : [])].sort((left, right) => left - right)
}

export type TableRect = { left: number; top: number; width: number; height: number }

/** Join a table's textual evidence (cells plus caption) with the nearest ruled
 * region. Captions may be above or below the grid, so direction is deliberately
 * not assumed. A region needs horizontal alignment and either contained cell
 * text or a table-like wide shape; nearby figures are therefore not claimed
 * merely because they happen to precede a caption. */
export function tableRegionFromEvidence(evidence: TableRect[], regions: TableRect[], scale = 1, rules: TableRect[] = []) {
  if (!evidence.length) return undefined
  const left = Math.min(...evidence.map(rect => rect.left)); const top = Math.min(...evidence.map(rect => rect.top))
  const right = Math.max(...evidence.map(rect => rect.left + rect.width)); const bottom = Math.max(...evidence.map(rect => rect.top + rect.height))
  const evidenceWidth = Math.max(1, right - left)
  const ranked = regions.flatMap((rect, index) => {
    const horizontalOverlap = Math.max(0, Math.min(right, rect.left + rect.width) - Math.max(left, rect.left)) / Math.max(1, Math.min(evidenceWidth, rect.width))
    const verticalGap = Math.max(0, Math.max(top, rect.top) - Math.min(bottom, rect.top + rect.height))
    const centersInside = evidence.filter(box => {
      const x = box.left + box.width / 2; const y = box.top + box.height / 2
      return x >= rect.left - 3 * scale && x <= rect.left + rect.width + 3 * scale && y >= rect.top - 3 * scale && y <= rect.top + rect.height + 3 * scale
    }).length
    const proximity = 1 - verticalGap / Math.max(1, 96 * scale)
    const tableShape = rect.width >= Math.max(70 * scale, rect.height * 1.15)
    if (horizontalOverlap < .28 || verticalGap > 96 * scale || (!centersInside && (!tableShape || verticalGap > 28 * scale))) return []
    return [{ rect, index, score: horizontalOverlap + Math.max(0, proximity) + Math.min(1.5, centersInside * .18) + (tableShape ? .2 : 0) }]
  }).sort((a, b) => b.score - a.score)
  // Rules are matched on their own terms: they run across the table's columns
  // and sit inside it or just against its edges. They are never "claimed" the
  // way a figure region is, because nothing else would have drawn them.
  const attachedRules = rules.filter(rule => {
    const overlap = Math.max(0, Math.min(right, rule.left + rule.width) - Math.max(left, rule.left)) / Math.max(1, Math.min(evidenceWidth, rule.width))
    const gap = Math.max(0, Math.max(top, rule.top) - Math.min(bottom, rule.top + rule.height))
    return overlap >= .6 && gap <= 12 * scale
  })
  const withRules = (rect: TableRect): TableRect => {
    if (!attachedRules.length) return rect
    const ruleLeft = Math.min(rect.left, ...attachedRules.map(rule => rule.left))
    const ruleTop = Math.min(rect.top, ...attachedRules.map(rule => rule.top))
    return { left: ruleLeft, top: ruleTop,
      width: Math.max(rect.left + rect.width, ...attachedRules.map(rule => rule.left + rule.width)) - ruleLeft,
      height: Math.max(rect.top + rect.height, ...attachedRules.map(rule => rule.top + rule.height)) - ruleTop } as TableRect
  }
  const match = ranked[0]
  if (!match) return { rect: withRules({ left, top, width: evidenceWidth, height: bottom - top } as TableRect) }
  // A ruled table is drawn as separate strokes — one above the header, one
  // below it, one under the last row — and they are too far apart to join into
  // a single region. Taking only the best-scoring one cropped the table to
  // whichever rule won, so the opposite edge was cut off the picture. Every
  // rule that runs across this table's columns and sits against it belongs to
  // it, so the region is the union of all of them.
  const parts = ranked.filter(candidate => candidate === match
    || (candidate.rect.width >= Math.max(70 * scale, candidate.rect.height * 1.15)
      && Math.max(0, Math.max(top, candidate.rect.top) - Math.min(bottom, candidate.rect.top + candidate.rect.height)) <= 28 * scale))
  const unionLeft = Math.min(left, ...parts.map(part => part.rect.left))
  const unionTop = Math.min(top, ...parts.map(part => part.rect.top))
  const unionRight = Math.max(right, ...parts.map(part => part.rect.left + part.rect.width))
  const unionBottom = Math.max(bottom, ...parts.map(part => part.rect.top + part.rect.height))
  return { index: match.index, indexes: parts.map(part => part.index), rect: withRules({ left: unionLeft, top: unionTop, width: unionRight - unionLeft, height: unionBottom - unionTop } as TableRect) }
}

/** PDF tables do not require a downloadable TeX source. Keep the cells in one
 * original-pixel block and translate the caption independently. */
export function preservePdfTables<T extends TableSegment & { id: string; blockId?: string }>(segments: T[]): T[] {
  const result = segments.map(segment => ({ ...segment }))
  for (const [index, caption] of segments.entries()) {
    if (caption.kind !== 'caption' || !/^(?:table|algorithm)\s*(?:\d+|[IVX]+)\b/i.test(caption.source)) continue
    const members = tableMemberIndexes(result, index).filter(member => member !== index)
    // A short prose fragment by itself is not evidence of a table.
    if (!/prompt format/i.test(caption.source) && !members.some(member => ['artifact', 'equation', 'table'].includes(segments[member].kind) || (segments[member].source.match(/\d+(?:\.\d+)?/g)?.length ?? 0) >= 3)) continue
    for (const member of members) result[member] = { ...result[member], kind: 'table', blockId: `pdf-table-${caption.id}` }
  }
  // A listing can already be classified as a table before its fraction-heavy
  // rows are split into other segments. Follow explicit row labels, not kinds.
  for (const [index, start] of segments.entries()) {
    // "Algorithm 1 displays the complete training procedure" is a sentence
    // about a listing, not the listing itself, and preserving it as pixels lost
    // a paragraph of DDPM's method section. A real listing shows its own
    // machinery: numbered steps, an assignment arrow, or a Require/Ensure line.
    const algorithm = /^Algorithm\s+\d+\b/i.test(start.source)
      && /(?:\b\d+\s*:|←|\b(?:Input|Output|Require|Ensure|repeat|until|end for|end while):?)/i.test(start.source)
    const code = /^\w+\s*=\s*(?:Sequential|\w+Model)\s*\(\s*\[/.test(start.source)
    if (!algorithm && !code) continue
    const blockId = `pdf-listing-${start.id}`
    result[index] = { ...result[index], kind: 'table', blockId }
    let previous = bounds(start.preciseRects)
    for (let cursor = index + 1; cursor < segments.length; cursor++) {
      const item = segments[cursor]; const box = bounds(item.preciseRects)
      if (item.page !== start.page || item.kind === 'heading' || item.kind === 'caption') break
      if (box && previous && (box.top - previous.top - previous.height > 35 || box.top < previous.top - 12)) break
      const row = /^\d{1,3}\s*[:.]/.test(item.source)
      const continuation = code && /^(?:Dense|Conv\w*|Dropout|Flatten|\]|\))\s*[(\]),]/.test(item.source)
      if (!(algorithm ? row : continuation)) break
      result[cursor] = { ...result[cursor], kind: 'table', blockId }
      previous = box ?? previous
    }
  }
  return result
}
