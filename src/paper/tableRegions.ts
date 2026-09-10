/** Find the bounded PDF-text run belonging to a LaTeX-confirmed table caption. */
export function tableMemberIndexes(segments: Array<{ kind: string; source: string }>, captionIndex: number, limit = 16) {
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
