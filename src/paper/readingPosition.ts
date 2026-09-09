export type ReadingPosition = { page: number; progress: number; anchorId?: string; anchorProgress?: number; align?: 'top' }
const key = (pdfPath: string) => `prism.reading-position.v1:${encodeURIComponent(pdfPath)}`
export function validateReadingPosition(value: unknown, pageCount = Number.MAX_SAFE_INTEGER): ReadingPosition | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Partial<ReadingPosition>
  if (!Number.isInteger(item.page) || item.page! < 1 || !Number.isFinite(item.progress)) return
  return { page: Math.min(item.page!, pageCount), progress: Math.max(0, Math.min(1, item.progress!)),
    anchorId: typeof item.anchorId === 'string' && item.anchorId.length <= 256 ? item.anchorId : undefined,
    anchorProgress: Number.isFinite(item.anchorProgress) ? Math.max(0, Math.min(1, item.anchorProgress!)) : undefined,
    align: item.align === 'top' ? 'top' : undefined }
}
export function readReadingPosition(pdfPath: string, pageCount?: number): ReadingPosition | undefined {
  try { return validateReadingPosition(JSON.parse(localStorage.getItem(key(pdfPath)) ?? 'null'), pageCount) } catch { return }
}
export function saveReadingPosition(pdfPath: string, position?: ReadingPosition) {
  if (!position) return
  try { localStorage.setItem(key(pdfPath), JSON.stringify(position)) } catch { /* Reading still works when storage is unavailable. */ }
}
