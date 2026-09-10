type CrossrefWork = {
  DOI?: string; title?: string[]; author?: Array<{ given?: string; family?: string; name?: string }>;
  abstract?: string; published?: { 'date-parts'?: number[][] }; subject?: string[];
  'container-title'?: string[]; 'is-referenced-by-count'?: number;
}
const plain = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
export function crossrefPaper(work: CrossrefWork) {
  if (!work.DOI || !/^10\.\d{4,9}\/\S+$/i.test(work.DOI) || !work.title?.[0]) return null
  const date = work.published?.['date-parts']?.[0] ?? []
  return {
    arxivId: `doi:${work.DOI}`, title: plain(work.title[0]),
    authors: (work.author ?? []).map(author => author.name || [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
    summary: plain(work.abstract ?? ''), published: date.map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('-'), updated: '',
    categories: work.subject?.length ? work.subject : work['container-title'] ?? [],
    pdfUrl: '', absUrl: `https://doi.org/${work.DOI}`, citationCount: work['is-referenced-by-count'],
  }
}
export async function searchCrossref(query: string) {
  const clean = query.trim().slice(0, 500)
  if (!clean) return []
  const doi = clean.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
  const exact = /^10\.\d{4,9}\/\S+$/i.test(doi)
  const url = exact ? `https://api.crossref.org/works/${encodeURIComponent(doi)}` : `https://api.crossref.org/works?rows=15&query.bibliographic=${encodeURIComponent(clean)}`
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Prism/0.1 (local research reader; https://github.com/help-me-prism/prism)' } })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`논문 검색에 연결하지 못했습니다 (${response.status}). PDF 가져오기는 계속 사용할 수 있습니다.`)
  const result = await response.json() as { message: CrossrefWork & { items?: CrossrefWork[] } }
  return (exact ? [result.message] : result.message.items ?? []).map(crossrefPaper).filter(paper => paper !== null)
}
