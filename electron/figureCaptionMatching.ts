export type FigureForCaption = { id: string; order: number; caption?: string }
export type FigureCaption = { id: string; source: string }

function figureNumber(value: string) {
  return Number(value.match(/^\s*(?:figure|fig\.?)\s*(\d+)\b/i)?.[1]) || undefined
}

function words(value: string) {
  return new Set(value.toLowerCase().replace(/^\s*(?:figure|fig\.?)\s*\d+\s*[.:]?/i, '').match(/[\p{L}\p{N}]{2,}/gu) ?? [])
}

function similarity(left: string, right: string) {
  const a = words(left); const b = words(right)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / Math.max(a.size, b.size)
}

/** Match source figures to PDF anchors by printed identity, never extraction order. */
export function matchFigureCaptions<T extends FigureForCaption>(figures: T[], captions: FigureCaption[]) {
  const unused = new Set(captions.map(caption => caption.id))
  return figures.map((figure) => {
    const numbered = captions.filter(caption => unused.has(caption.id) && figureNumber(caption.source) === figure.order + 1)
    const exact = numbered.map(caption => ({ caption, score: similarity(figure.caption ?? '', caption.source) })).sort((a, b) => b.score - a.score)[0]?.caption
    const fuzzy = exact ? undefined : captions.filter(caption => unused.has(caption.id)).map(caption => ({ caption, score: similarity(figure.caption ?? '', caption.source) })).sort((a, b) => b.score - a.score)[0]
    const matched = exact ?? (fuzzy && fuzzy.score >= .55 ? fuzzy.caption : undefined)
    if (matched) unused.delete(matched.id)
    return { ...figure, captionAnchorId: matched?.id }
  })
}
