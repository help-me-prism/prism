export type RectLike = { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Place an anchor preview in viewport coordinates. The caller may render the
 * preview inside any clipped/scrolled ancestor because its CSS is fixed. */
export function anchorPopoverPosition(token: RectLike, preview: Pick<RectLike, 'width' | 'height'>, viewport: { width: number; height: number }, margin = 8) {
  const usableWidth = Math.max(0, viewport.width - margin * 2)
  const usableHeight = Math.max(0, viewport.height - margin * 2)
  const width = Math.min(preview.width, usableWidth)
  const height = Math.min(preview.height, usableHeight)
  const half = width / 2
  const center = Math.max(margin + half, Math.min(viewport.width - margin - half, token.left + token.width / 2))
  const above = token.top - height - margin
  const below = token.bottom + margin
  const top = above >= margin ? above : Math.min(viewport.height - height - margin, below)
  return { left: center, top: Math.max(margin, top) }
}
