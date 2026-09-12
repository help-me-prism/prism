export type CaptureRect = { left: number; top: number; width: number; height: number }
export type CaptureRegion = { display: CaptureRect; source: CaptureRect; image?: boolean }

export function intersectCapture(a: CaptureRect, b: CaptureRect): CaptureRect | undefined {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top)
  const width = Math.min(a.left + a.width, b.left + b.width) - left
  const height = Math.min(a.top + a.height, b.top + b.height) - top
  return width > 0 && height > 0 ? { left, top, width, height } : undefined
}

/** Reflowed text links to its entire source block; bitmap crops map pixel for pixel. */
export function translatedCaptureSource(selection: CaptureRect, regions: CaptureRegion[], page: { width: number; height: number }) {
  if (![page.width, page.height].every(value => Number.isFinite(value) && value > 0)) return
  const sourceRects = regions.flatMap(({ display, source, image }) => {
    if (![display, source].every(rect => rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)) return []
    const part = intersectCapture(selection, display)
    if (!part) return []
    const mapped = image ? {
      left: source.left + (part.left - display.left) / display.width * source.width,
      top: source.top + (part.top - display.top) / display.height * source.height,
      width: part.width / display.width * source.width, height: part.height / display.height * source.height,
    } : source
    const bounded = intersectCapture(mapped, { left: 0, top: 0, ...page })
    return bounded ? [bounded] : []
  })
  if (!sourceRects.length) return
  const left = Math.min(...sourceRects.map(rect => rect.left)), top = Math.min(...sourceRects.map(rect => rect.top))
  return { x: left / page.width, y: top / page.height,
    width: (Math.max(...sourceRects.map(rect => rect.left + rect.width)) - left) / page.width,
    height: (Math.max(...sourceRects.map(rect => rect.top + rect.height)) - top) / page.height }
}
