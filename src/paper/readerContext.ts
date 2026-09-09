/** A bounded, deterministic context keeps simple reading questions out of a second AI pass. */
export function readerExcerpts(anchors: ContextAnchor[], question: string, budget = 12000) {
  const prose = anchors.filter(anchor => ['sentence', 'section'].includes(anchor.type))
  // Korean questions should still retrieve English methods/results without a paid query rewrite.
  const concepts: Array<[RegExp, string[]]> = [
    [/방법|실험|설계|대조군/, ['method', 'experiment', 'control', 'procedure']],
    [/한계|제약|불확실/, ['limitation', 'however', 'uncertain', 'future']],
    [/결과|발견|성능|비교/, ['result', 'performance', 'compar', 'table']],
    [/배경|개념|정의/, ['introduction', 'defined', 'background']],
    [/초록|요약|핵심|기여/, ['abstract', 'conclusion', 'contribution']],
    [/가설|주장|근거/, ['hypothesis', 'evidence', 'suggest', 'demonstrate']],
  ]
  const terms = [...question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [], ...concepts.filter(([pattern]) => pattern.test(question)).flatMap(([, words]) => words)]
  const requestedPage = question.match(/(?:p(?:age)?\.?\s*(\d+)|(\d+)\s*(?:쪽|페이지))/i)
  const page = requestedPage ? Number(requestedPage[1] ?? requestedPage[2]) : undefined
  const ranked = prose.map((anchor, index) => ({ anchor, index, score:
    terms.reduce((sum, term) => sum + (anchor.source.toLowerCase().includes(term) ? 3 : 0), 0)
    + (index < 14 ? 2 : 0) + (index > prose.length - 12 ? 1 : 0)
    + (/conclu|abstract|limitation|result/i.test(anchor.source.slice(0, 80)) ? 2 : 0),
  })).map(item => ({ ...item, score: item.score + (page === item.anchor.page ? 30 : 0) })).sort((a, b) => b.score - a.score || a.index - b.index)
  const chosen: typeof ranked = []
  for (const item of ranked) {
    if (item.anchor.source.length > budget) continue
    chosen.push(item); budget -= item.anchor.source.length
    if (budget < 100) break
  }
  return chosen.sort((a, b) => a.index - b.index).map(({ anchor }) => ({ paperId: anchor.paperId, anchorId: anchor.anchorId, ref: anchor.label, page: anchor.page, source: anchor.source }))
}

/** Labels belong to the conversation, rather than a page or retrieval batch. */
export function stableReferences(anchors: ContextAnchor[], history: ContextAnchor[] = []) {
  const identity = (anchor: ContextAnchor) => `${anchor.paperId}\u0000${anchor.anchorId}`
  const known = new Map<string, string>(); const used = new Set<string>(); let next = 1
  for (const anchor of history) {
    if (!/^근거\d+$/.test(anchor.label)) continue
    const key = identity(anchor)
    if (!known.has(key) && !used.has(anchor.label)) { known.set(key, anchor.label); used.add(anchor.label) }
    next = Math.max(next, Number(anchor.label.slice(2)) + 1)
  }
  return anchors.map(anchor => {
    const key = identity(anchor)
    if (!known.has(key)) { const label = `근거${next++}`; known.set(key, label); used.add(label) }
    return { ...anchor, label: known.get(key)! }
  })
}

export function messagePaperIds(primary: string | undefined, papers: string[], anchors: ContextAnchor[]) {
  return [...new Set([primary, ...papers, ...anchors.map(anchor => anchor.paperId)].filter((id): id is string => Boolean(id)))]
}

export function readingEvidence(anchors: ContextAnchor[], paperIds: string[], question: string, budget = 9000, history: ContextAnchor[] = []) {
  const ids = [...new Set(paperIds)].slice(0, 8)
  const portions = ids.map(paperId => readerExcerpts(anchors.filter(anchor => anchor.paperId === paperId), question, Math.floor(budget / Math.max(1, ids.length))))
  const chosen = portions.flat()
  const references = stableReferences(chosen.flatMap(excerpt => {
    const anchor = anchors.find(anchor => anchor.paperId === excerpt.paperId && anchor.anchorId === excerpt.anchorId)
    return anchor ? [anchor] : []
  }), history)
  const excerpts = chosen.map((excerpt, index) => ({ ...excerpt, ref: references[index].label }))
  return { excerpts, references, missingPaperIds: ids.filter((_, index) => !portions[index].length) }
}
