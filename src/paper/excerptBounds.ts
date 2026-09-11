type Rect = { left: number; top: number; width: number; height: number }
/** Keep ink overhang, but never sample a neighbouring line in crop padding. */
export function paddedExcerptBounds(rect: Rect, neighbors: Rect[], padding = 3): Rect {
  let left = Math.max(0, rect.left - padding), top = Math.max(0, rect.top - padding)
  let right = rect.left + rect.width + padding, bottom = rect.top + rect.height + padding
  for (const other of neighbors) {
    const otherRight = other.left + other.width, otherBottom = other.top + other.height
    if (otherRight > rect.left && other.left < rect.left + rect.width) {
      if (other.top >= rect.top + rect.height - .01) bottom = Math.min(bottom, (rect.top + rect.height + other.top) / 2)
      if (otherBottom <= rect.top + .01) top = Math.max(top, (rect.top + otherBottom) / 2)
    }
    if (otherBottom > rect.top && other.top < rect.top + rect.height) {
      if (other.left >= rect.left + rect.width - .01) right = Math.min(right, (rect.left + rect.width + other.left) / 2)
      if (otherRight <= rect.left + .01) left = Math.max(left, (rect.left + otherRight) / 2)
    }
  }
  return { left, top, width: right - left, height: bottom - top }
}
