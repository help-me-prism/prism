/** A bounded, deterministic context keeps simple reading questions out of a second AI pass. */
export function readerExcerpts(anchors: ContextAnchor[], question: string, budget = 12000) {
  const prose = anchors.filter(anchor => ['sentence', 'section'].includes(anchor.type))
  const terms = question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  const ranked = prose.map((anchor, index) => ({ anchor, index, score:
    terms.reduce((sum, term) => sum + (anchor.source.toLowerCase().includes(term) ? 3 : 0), 0)
    + (index < 14 ? 2 : 0) + (index > prose.length - 12 ? 1 : 0)
    + (/conclu|abstract|limitation|result/i.test(anchor.source.slice(0, 80)) ? 2 : 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index)
  const chosen: typeof ranked = []
  for (const item of ranked) {
    if (item.anchor.source.length > budget) continue
    chosen.push(item); budget -= item.anchor.source.length
    if (budget < 100) break
  }
  return chosen.sort((a, b) => a.index - b.index).map(({ anchor }) => ({ paperId: anchor.paperId, ref: anchor.label, page: anchor.page, source: anchor.source }))
}
