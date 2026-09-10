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
