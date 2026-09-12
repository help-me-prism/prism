export function localPdfIdentity(filename: string, metadataTitle: unknown, items: Array<{ str: string; transform: number[] }>) {
  const text = items.map(item => item.str).join(' ')
  const arxivId = text.match(/\barXiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)/i)?.[1]
    ?? filename.match(/^((?:\d{4}\.\d{4,5})(?:v\d+)?)(?:\.pdf)?$/i)?.[1]
  const candidate = typeof metadataTitle === 'string' ? metadataTitle.trim() : ''
  const usable = candidate.length >= 18 && !/^(?:untitled|microsoft|word|latex|arxiv|doi:|\d)/i.test(candidate)
  const titleItems = items.filter(item => item.str.trim().length > 1 && Math.abs(item.transform[1]) < .01)
  const size = Math.max(0, ...titleItems.filter(item => /[a-z]{3}/i.test(item.str)).map(item => Math.hypot(item.transform[2], item.transform[3])))
  const title = usable ? candidate : titleItems.filter(item => Math.hypot(item.transform[2], item.transform[3]) >= size * .92).map(item => item.str).join(' ').trim()
  return { arxivId, title: title.length >= 18 ? title.slice(0, 500) : filename.replace(/\.pdf$/i, '').replace(/_/g, ' ') }
}
