type Rect = { left: number; top: number; width: number; height: number }

/** DOI-only print lines are excluded from translation, but still belong to the
 * page. Restore their pixels unless another retained region already paints them.
 * Never treat a prose sentence containing a DOI as publication furniture. */
export function publicationDoiRects(items: Array<Rect & { text?: string }>, covered: Rect[], pageWidth: number, pageHeight: number): Rect[] {
  const restored: Rect[] = []
  for (const item of items) {
    if (!/^https?:\/\/(?:dx\.)?doi\.org\/10\.\d{4,9}\/\S+$/i.test(item.text?.trim() ?? '')) continue
    if (![item.left, item.top, item.width, item.height].every(Number.isFinite) || item.width <= 0 || item.height <= 0) continue
    // Include small ink overhangs without collecting a neighbouring caption.
    const pad = item.height * .12
    const left = Math.max(0, item.left - pad), top = Math.max(0, item.top - pad)
    const right = Math.min(pageWidth, item.left + item.width + pad), bottom = Math.min(pageHeight, item.top + item.height + pad)
    if (right <= left || bottom <= top) continue
    const rect = { left, top, width: right - left, height: bottom - top }
    const overlaps = [...covered, ...restored].some(other =>
      Math.min(other.left + other.width, right) > Math.max(other.left, left)
      && Math.min(other.top + other.height, bottom) > Math.max(other.top, top))
    if (!overlaps) restored.push(rect)
  }
  return restored
}

/** Repeated margin text is publisher furniture, never body prose. Compare PDF
 * coordinates across pages, not text alone: a repeated term in the body stays. */
export function preservePublicationFurniture<T extends { page: number; source: string; kind: string; blockId?: string; paragraphContext?: string; preciseRects?: Rect[] }>(segments: T[], pageSizes: Map<number, { width: number; height: number }>): T[] {
  const key = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  const margin = (segment: T) => {
    const size = pageSizes.get(segment.page); const rects = segment.preciseRects
    return !!size && !!rects?.length && rects.every(r => r.top < size.height * .09 || r.top + r.height > size.height * .91 || r.left + r.width < size.width * .07)
  }
  const occurrences = new Map<string, Set<number>>()
  const abstractIndex = segments.findIndex(s => s.page === 1 && /^Abstract\b/i.test(s.source))
  const metadataBlocks = new Set<string>()
  // Author names and their superscripts are publication metadata. Do not
  // demand Korean output for names, or turn a split initial into a failed body
  // sentence. Affiliation institutions remain translatable. Restrict this to the front matter of a recognized abstract page.
  for (const [index, segment] of segments.entries()) {
    if (segment.page !== 1 || index >= abstractIndex || !segment.blockId || segment.kind === 'heading') continue
    const context = segment.paragraphContext ?? segment.source
    const authors = /\d/.test(context) && (context.match(/\b[\p{Lu}][\p{L}’'-]+\s+[\p{Lu}][\p{L}’'-]+/gu)?.length ?? 0) >= 3 && /,/.test(context) && !/[.!?]\s+[a-z]/.test(context)
    const markedName = context.length < 150 && /[∗*†‡]/.test(context) && (context.match(/\b[\p{Lu}][\p{L}’'-]+/gu)?.length ?? 0) >= 2 && !/\b(?:the|this|we|our|these|that)\b/i.test(context)
    const affiliation = /^\d+\s*(?:[A-Z]|Department\b)/.test(context) && /\b(?:University|Institute|Laborator(?:y|ies)|Department|School|Hospital|College)\b/i.test(context)
    if (!affiliation && (authors || markedName)) metadataBlocks.add(segment.blockId)
  }
  for (const segment of segments) if (margin(segment) && segment.source.length < 240) {
    const pages = occurrences.get(key(segment.source)) ?? new Set<number>(); pages.add(segment.page); occurrences.set(key(segment.source), pages)
  }
  return segments.map(segment => {
    const text = segment.source.trim()
    const known = /^(?:(?:HHMI|NIH|HHS)(?:-PA)? Author Manuscript\s*)+$/i.test(text)
      || /^.{0,70}Author manuscript; available in PMC\b/i.test(text)
      || (segment.page === 1 && /^Published as:/i.test(segment.paragraphContext ?? text))
      || (segment.page === 1 && /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?\d{4}\.?$/i.test(text))
    const repeated = (occurrences.get(key(text))?.size ?? 0) >= 3
    const pageNumber = /^(?:Page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(text)
    return known || metadataBlocks.has(segment.blockId ?? '') || (margin(segment) && (repeated || pageNumber))
      ? { ...segment, kind: 'artifact', blockId: `furniture-${segment.page}-${segment.blockId}` } : segment
  })
}
