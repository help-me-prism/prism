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
