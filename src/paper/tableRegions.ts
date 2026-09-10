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
    if (!candidate || candidate.kind === 'caption' || candidate.kind === 'heading') break
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
  const captionCenter = captionBox.left + captionBox.width / 2
  const runs = [-1, 1].map(direction => {
    const indexes: number[] = []; let previousBox = captionBox; let score = 0
    for (let step = 1; step <= limit; step += 1) {
      const index = captionIndex + direction * step; const candidate = segments[index]; const box = bounds(candidate?.preciseRects)
      if (!candidate || candidate.page !== caption.page || !box || candidate.kind === 'caption' || candidate.kind === 'heading') break
      const wordCount = candidate.source.match(/[A-Za-z가-힣]{2,}/g)?.length ?? 0
      const numericCount = candidate.source.match(/\d+(?:\.\d+)?/g)?.length ?? 0
      // Abbreviated model names in cells often end in a period ("Uncond.",
      // "Self-cond."). A short numeric row is still table evidence, not prose.
      const proseSentence = /[.!?]$/.test(candidate.source) && wordCount >= 5
        && numericCount < 3 && !(candidate.source.length < 90 && numericCount >= 1)
      const verticalGap = Math.max(0, Math.max(box.top, previousBox.top) - Math.min(box.top + box.height, previousBox.top + previousBox.height))
      const candidateCenter = box.left + box.width / 2
      const aligned = Math.abs(candidateCenter - captionCenter) <= Math.max(150, captionBox.width * .72)
      const tableLike = ['artifact', 'equation'].includes(candidate.kind) || numericCount >= 2 || (candidate.source.length <= 220 && wordCount <= 24)
      if (verticalGap > 34 || !aligned || !tableLike || proseSentence) break
      indexes.push(index); previousBox = box
      score += (candidate.kind === 'artifact' ? 2 : 0) + Math.min(4, numericCount) + (box.width > captionBox.width * .45 ? 1 : 0)
    }
    return { indexes, score }
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
export function tableRegionFromEvidence(evidence: TableRect[], regions: TableRect[], scale = 1) {
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
  const match = ranked[0]
  if (!match) return { rect: { left, top, width: evidenceWidth, height: bottom - top } as TableRect }
  const unionLeft = Math.min(left, match.rect.left); const unionTop = Math.min(top, match.rect.top)
  return { index: match.index, rect: { left: unionLeft, top: unionTop, width: Math.max(right, match.rect.left + match.rect.width) - unionLeft, height: Math.max(bottom, match.rect.top + match.rect.height) - unionTop } as TableRect }
}
