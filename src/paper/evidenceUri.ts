export function evidenceFromUri(value: string, label = 'PDF 원문'): { paperId: string; anchorId: string; type: 'page'; page: number; label: string } | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'prism:' || url.hostname !== 'paper' || url.port || url.username || url.password || url.hash) return undefined
    const paperId = decodeURIComponent(url.pathname.slice(1))
    const anchorId = url.searchParams.get('anchor') ?? ''
    if (!paperId || !anchorId || paperId.length > 512 || anchorId.length > 512 || /[\u0000-\u001f\u007f]/.test(paperId + anchorId)) return undefined
    if (url.searchParams.getAll('anchor').length !== 1 || url.searchParams.getAll('page').length > 1) return undefined
    const rawPage = url.searchParams.get('page')
    if (rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) return undefined
    const page = Number(rawPage ?? anchorId.match(/^p(\d+)(?:\b|-)/)?.[1] ?? 1)
    if (!Number.isSafeInteger(page) || page < 1) return undefined
    return { paperId, anchorId, page, type: 'page', label: label || `PDF p.${page}` }
  } catch { return undefined }
}
