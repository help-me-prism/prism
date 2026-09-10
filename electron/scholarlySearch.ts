export type ScholarlyPaper = {
  arxivId: string; title: string; authors: string[]; summary: string; published: string; updated: string;
  categories: string[]; pdfUrl: string; absUrl: string; citationCount?: number; source?: 'semantic-scholar' | 'crossref' | 'europe-pmc';
  doi?: string; pmcid?: string; structuredSourceUrl?: string; structuredSourceFormat?: 'jats'; structuredSourceProvider?: 'europe-pmc'; license?: string
}

type CrossrefWork = {
  DOI?: string; title?: string[]; author?: Array<{ given?: string; family?: string; name?: string }>;
  abstract?: string; published?: { 'date-parts'?: number[][] }; subject?: string[];
  'container-title'?: string[]; 'is-referenced-by-count'?: number;
  link?: Array<{ URL?: string; 'content-type'?: string }>;
  resource?: { primary?: { URL?: string } };
}

type SemanticScholarWork = {
  paperId?: string; title?: string; authors?: Array<{ name?: string }>; abstract?: string;
  publicationDate?: string; year?: number; citationCount?: number; venue?: string; fieldsOfStudy?: string[];
  externalIds?: { ArXiv?: string; DOI?: string }; openAccessPdf?: { url?: string }; url?: string;
}

type EuropePmcWork = {
  id?: string; source?: string; pmcid?: string; doi?: string; title?: string; abstractText?: string; firstPublicationDate?: string; pubYear?: string;
  authorList?: { author?: Array<{ fullName?: string }> }; authorString?: string; citedByCount?: number; journalInfo?: { journal?: { title?: string } };
  pubTypeList?: { pubType?: string[] }; isOpenAccess?: string; inPMC?: string; hasPDF?: string; license?: string;
  fullTextUrlList?: { fullTextUrl?: Array<{ availabilityCode?: string; documentStyle?: string; url?: string }> }
}

const plain = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
const httpsUrl = (value?: string) => {
  if (!value) return ''
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '' } catch { return '' }
}
const normalizedDoi = (value?: string) => value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')

export function crossrefPaper(work: CrossrefWork): ScholarlyPaper | null {
  const doi = normalizedDoi(work.DOI)
  if (!doi || !/^10\.\d{4,9}\/\S+$/i.test(doi) || !work.title?.[0]) return null
  const date = work.published?.['date-parts']?.[0] ?? []
  return {
    arxivId: `doi:${doi}`, title: plain(work.title[0]),
    authors: (work.author ?? []).map(author => author.name || [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
    summary: plain(work.abstract ?? ''), published: date.map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('-'), updated: '',
    categories: work.subject?.length ? work.subject : work['container-title'] ?? [],
    pdfUrl: httpsUrl(work.link?.find((link) => link['content-type']?.toLowerCase() === 'application/pdf')?.URL),
    absUrl: httpsUrl(work.resource?.primary?.URL) || `https://doi.org/${doi}`,
    citationCount: work['is-referenced-by-count'], source: 'crossref', doi,
  }
}

export function semanticScholarPaper(work: SemanticScholarWork): ScholarlyPaper | null {
  if (!work.paperId || !work.title?.trim()) return null
  const doi = normalizedDoi(work.externalIds?.DOI)
  const arxivId = work.externalIds?.ArXiv?.trim()
  const id = arxivId || (doi && /^10\.\d{4,9}\/\S+$/i.test(doi) ? `doi:${doi}` : `s2:${work.paperId}`)
  const categories = (work.fieldsOfStudy ?? []).filter(Boolean)
  if (work.venue && !categories.includes(work.venue)) categories.push(work.venue)
  return {
    arxivId: id, title: plain(work.title), authors: (work.authors ?? []).map(author => author.name?.trim() ?? '').filter(Boolean),
    summary: plain(work.abstract ?? ''), published: work.publicationDate ?? (work.year ? String(work.year) : ''), updated: '', categories,
    pdfUrl: httpsUrl(work.openAccessPdf?.url),
    absUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : doi ? `https://doi.org/${doi}` : httpsUrl(work.url) || `https://www.semanticscholar.org/paper/${work.paperId}`,
    citationCount: work.citationCount, source: 'semantic-scholar', doi,
  }
}

export function europePmcPaper(work: EuropePmcWork): ScholarlyPaper | null {
  if (!work.id || !work.title?.trim()) return null
  const doi = normalizedDoi(work.doi)
  const pmcid = /^PMC\d+$/i.test(work.pmcid ?? '') ? work.pmcid!.toUpperCase() : undefined
  const id = doi && /^10\.\d{4,9}\/\S+$/i.test(doi) ? `doi:${doi}` : pmcid ? `pmc:${pmcid}` : `epmc:${work.source ?? 'MED'}:${work.id}`
  const urls = work.fullTextUrlList?.fullTextUrl ?? []
  const listedPdfUrl = httpsUrl(urls.find((url) => url.documentStyle?.toLowerCase() === 'pdf' && url.availabilityCode === 'OA')?.url)
  // Some repository manuscripts expose hasPDF=Y without populating fullTextUrlList.
  // Europe PMC's canonical render endpoint still performs the final access check.
  const pdfUrl = listedPdfUrl || (pmcid && work.hasPDF === 'Y' ? `https://europepmc.org/articles/${pmcid}?pdf=render` : '')
  const htmlUrl = httpsUrl(urls.find((url) => url.documentStyle?.toLowerCase() === 'html')?.url)
  const hasJats = Boolean(pmcid && work.inPMC === 'Y' && work.isOpenAccess === 'Y')
  return {
    arxivId: id, title: plain(work.title),
    authors: (work.authorList?.author ?? []).map((author) => author.fullName?.trim() ?? '').filter(Boolean),
    summary: plain(work.abstractText ?? ''), published: work.firstPublicationDate ?? work.pubYear ?? '', updated: '',
    categories: [...(work.pubTypeList?.pubType ?? []), work.journalInfo?.journal?.title ?? ''].filter(Boolean),
    pdfUrl, absUrl: htmlUrl || (pmcid ? `https://europepmc.org/articles/${pmcid}` : doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${work.source ?? 'MED'}/${work.id}`),
    citationCount: work.citedByCount, source: 'europe-pmc', doi, pmcid,
    structuredSourceUrl: hasJats ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML` : undefined,
    structuredSourceFormat: hasJats ? 'jats' : undefined, structuredSourceProvider: hasJats ? 'europe-pmc' : undefined,
    license: work.license?.trim() || undefined,
  }
}

const normalize = (value: string) => plain(value).toLocaleLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim()
export function rankScholarlyPapers(query: string, papers: ScholarlyPaper[]) {
  const rawQuery = query.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLocaleLowerCase()
  const wanted = normalize(rawQuery)
  const wantedTokens = [...new Set(wanted.split(' ').filter(token => token.length > 1))]
  const score = (paper: ScholarlyPaper) => {
    const title = normalize(paper.title)
    const titleTokens = new Set(title.split(' '))
    const overlap = wantedTokens.filter(token => titleTokens.has(token)).length / Math.max(1, wantedTokens.length)
    const phrase = title === wanted ? 1_000_000 : title.startsWith(wanted) ? 100_000 : title.includes(wanted) ? 20_000 : 0
    const identifier = paper.arxivId.replace(/^doi:/i, '').toLocaleLowerCase()
    const identifierMatch = identifier === rawQuery ? 2_000_000 : 0
    return identifierMatch + phrase + overlap * 10_000 + Math.log10((paper.citationCount ?? 0) + 1) * 120 + (paper.pdfUrl ? 250 : 0)
  }
  return papers.sort((left, right) => score(right) - score(left))
}

export function mergeScholarlyPapers(query: string, papers: ScholarlyPaper[]) {
  const byTitle = new Map<string, ScholarlyPaper>()
  for (const paper of papers) {
    const key = normalize(paper.title) || paper.arxivId
    const current = byTitle.get(key)
    const paperIsArxiv = /^(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})$/i.test(paper.arxivId)
    const currentIsArxiv = current && /^(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})$/i.test(current.arxivId)
    if (!current) { byTitle.set(key, paper); continue }
    const preferPaper = (paperIsArxiv && !currentIsArxiv) || (!current.pdfUrl && paper.pdfUrl) || ((paper.citationCount ?? 0) > (current.citationCount ?? 0) && Boolean(paper.pdfUrl) === Boolean(current.pdfUrl))
    const preferred = preferPaper ? paper : current
    const other = preferPaper ? current : paper
    byTitle.set(key, {
      ...other, ...preferred,
      pdfUrl: preferred.pdfUrl || other.pdfUrl, absUrl: preferred.absUrl || other.absUrl,
      summary: preferred.summary || other.summary, authors: preferred.authors.length ? preferred.authors : other.authors,
      categories: [...new Set([...preferred.categories, ...other.categories])],
      doi: preferred.doi || other.doi, pmcid: preferred.pmcid || other.pmcid, structuredSourceUrl: preferred.structuredSourceUrl || other.structuredSourceUrl,
      structuredSourceFormat: preferred.structuredSourceFormat || other.structuredSourceFormat,
      structuredSourceProvider: preferred.structuredSourceProvider || other.structuredSourceProvider,
      license: preferred.license || other.license,
    })
  }
  return rankScholarlyPapers(query, [...byTitle.values()])
}

async function crossrefSearch(clean: string, exactDoi?: string): Promise<ScholarlyPaper[]> {
  const url = exactDoi
    ? `https://api.crossref.org/works/${encodeURIComponent(exactDoi)}`
    : `https://api.crossref.org/works?rows=20&sort=relevance&order=desc&query.bibliographic=${encodeURIComponent(clean)}`
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Prism/0.1 (local research reader; https://github.com/help-me-prism/prism)' } })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`논문 검색에 연결하지 못했습니다 (${response.status}). PDF 가져오기는 계속 사용할 수 있습니다.`)
  const result = await response.json() as { message: CrossrefWork & { items?: CrossrefWork[] } }
  return (exactDoi ? [result.message] : result.message.items ?? []).map(crossrefPaper).filter((paper): paper is ScholarlyPaper => paper !== null)
}

async function semanticScholarSearch(clean: string, exactDoi?: string): Promise<ScholarlyPaper[]> {
  const fields = 'title,authors,abstract,publicationDate,year,citationCount,venue,fieldsOfStudy,externalIds,openAccessPdf,url'
  const endpoint = exactDoi
    ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(exactDoi)}?fields=${encodeURIComponent(fields)}`
    : `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(clean.replace(/-/g, ' '))}&limit=20&fields=${encodeURIComponent(fields)}`
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' } })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Semantic Scholar ${response.status}`)
  const body = await response.json() as SemanticScholarWork & { data?: SemanticScholarWork[] }
  return (exactDoi ? [body] : body.data ?? []).map(semanticScholarPaper).filter((paper): paper is ScholarlyPaper => paper !== null)
}

async function europePmcSearch(clean: string, exactDoi?: string): Promise<ScholarlyPaper[]> {
  const query = exactDoi ? `DOI:\"${exactDoi}\"` : clean
  const endpoint = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=20`
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Prism/0.1 local desktop research reader' } })
  if (!response.ok) throw new Error(`Europe PMC ${response.status}`)
  const body = await response.json() as { resultList?: { result?: EuropePmcWork[] } }
  return (body.resultList?.result ?? []).map(europePmcPaper).filter((paper): paper is ScholarlyPaper => paper !== null)
}

export async function findEuropePmcPaper(doi: string) {
  const normalized = normalizedDoi(doi)
  if (!normalized || !/^10\.\d{4,9}\/\S+$/i.test(normalized)) return undefined
  try { return (await europePmcSearch(normalized, normalized))[0] } catch { return undefined }
}

/** Relevance search with public-PDF discovery; Crossref remains the no-key fallback. */
export async function searchScholarly(query: string) {
  const clean = query.trim().slice(0, 500)
  if (!clean) return []
  const doi = normalizedDoi(clean)
  const exactDoi = doi && /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : undefined
  const responses = await Promise.allSettled([semanticScholarSearch(clean, exactDoi), crossrefSearch(clean, exactDoi), europePmcSearch(clean, exactDoi)])
  const papers = responses.flatMap((response) => response.status === 'fulfilled' ? response.value : [])
  if (papers.length) return mergeScholarlyPapers(clean, papers)
  const failure = responses[1].status === 'rejected' ? responses[1] : responses.find((response): response is PromiseRejectedResult => response.status === 'rejected')
  if (failure) throw failure.reason
  return []
}

export const searchCrossref = searchScholarly
