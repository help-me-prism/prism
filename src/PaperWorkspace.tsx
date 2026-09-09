import { textItemRect, segmentRects, type ItemRect } from './paper/itemGeometry'
import { reuseTranslations } from '../electron/translationHarness'
import { collectSourceFontWeights, dominantSourceWeight } from './paper/sourceEmphasis'
import { captureGlyphGeometry } from './paper/glyphGeometry'
import { mixedProseParagraphs } from './paper/excerptGeometry'
import { readReadingPosition, saveReadingPosition, type ReadingPosition } from './paper/readingPosition'
import { segmentsFromItems, type PdfTextItem } from './paper/textExtraction'
import { withoutBibliography, unsafeParagraphIds } from '../electron/translationScope'
import { useDialogFocus } from './useDialogFocus'
import { joinVectorRegions } from './paper/figureGeometry'
import ReadingTranslation from './paper/ReadingTranslation'
import PaperTitleDialog from './PaperTitleDialog'
import { useEvidenceCapture } from './paper/useEvidenceCapture'
import './readerToolbar.css'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Columns2, Download, ExternalLink, FileText,
  FolderOpen, Image, Link2, LoaderCircle, PanelLeftClose, Plus, Rows2, Search,
  Settings2, Sigma, Sparkles, Square, Table2, Tag, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import PaperMap from './paper/PaperMap'
import PaperPanes from './paper/PaperPanes'
import {
  activateKind, describeLayout, groupHolding, moveKindToGroup, openKinds, paneGroups, paneKinds,
  panePresets, parseLayout, splitGroupWithKind, type PaneKind, type PaneNode,
} from './paper/panes'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>

type PdfTextStyle = { ascent?: number; descent?: number; vertical?: boolean }
/** Which windows this reader can draw. The structure map joins the list once it exists. */
const readerKinds: PaneKind[] = ['original', 'translated', 'map']

/**
 * A paper reopens in the arrangement it was left in. This is view state, not research, so it stays in the
 * renderer's own storage: nothing about it belongs in the vault, in settings, or in an IPC round trip.
 */
const layoutStorageKey = (arxivId: string) => `prism.reader.layout.${arxivId}`
/**
 * `stored` matters as much as the layout: a paper the researcher has already arranged must not have windows
 * opened back up under them by the translation loader. Only a paper being opened for the first time gets one.
 */
function readStoredLayout(arxivId: string): { layout: PaneNode; stored: boolean } {
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(arxivId))
    const parsed = raw ? parseLayout(JSON.parse(raw), readerKinds) : undefined
    if (parsed) return { layout: parsed, stored: true }
  } catch { /* a layout we cannot read is a layout we do not use */ }
  return { layout: panePresets.original(), stored: false }
}
function writeStoredLayout(arxivId: string, layout: PaneNode) {
  try { window.localStorage.setItem(layoutStorageKey(arxivId), JSON.stringify(layout)) } catch { /* private mode, quota, or no storage at all */ }
}

/** Small reading areas open a readable translation; comparison remains an explicit layout choice. */
function withTranslated(layout: PaneNode): PaneNode {
  if (openKinds(layout).includes('translated')) return activateKind(layout, 'translated')
  if ((document.querySelector('.paper-workspace')?.clientWidth ?? window.innerWidth) < 1200) return panePresets.translated()
  const host = groupHolding(layout, 'original') ?? paneGroups(layout)[0]
  return host ? splitGroupWithKind(layout, host.id, 'translated', 'right') : panePresets.dual()
}

const pdfResourceRoot = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : new URL('./pdfjs/', document.baseURI).href
const pdfOptions = { standardFontDataUrl: `${pdfResourceRoot}standard_fonts/`, cMapUrl: `${pdfResourceRoot}cmaps/`, cMapPacked: true, wasmUrl: `${pdfResourceRoot}wasm/`, isEvalSupported: false }

function matchTokens(value: string) {
  return value.toLowerCase().replace(/\$[^$]*\$/g, ' math ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1)
}

function structureTokens(value: string) {
  const ignored = new Set(['begin', 'end', 'label', 'mathrm', 'mathbf', 'text', 'left', 'right', 'frac', 'sqrt', 'cdot', 'quad', 'qquad', 'displaystyle', 'array', 'aligned', 'tabular', 'center'])
  return new Set(value.toLowerCase().replace(/\\[a-zA-Z]+/g, (command) => ` ${command.slice(1)} `).match(/[a-z]+|\d+(?:\.\d+)?/g)?.filter((token) => !ignored.has(token)) ?? [])
}

function tokenSimilarity(left: string, right: string) {
  const a = structureTokens(left); const b = structureTokens(right)
  if (!a.size || !b.size) return 0
  let shared = 0; for (const token of a) if (b.has(token)) shared += 1
  return shared / Math.max(1, Math.max(a.size, b.size))
}

function enrichWithLatex(segments: TranslationSegment[], structure: LatexStructure | null) {
  if (!structure?.blocks.length) return { segments: segments.map((segment) => ({ ...segment, sourceMode: 'pdf' as const })), matched: 0 }
  const prose = structure.blocks.filter((block) => ['paragraph', 'heading', 'caption'].includes(block.kind)).map((block) => ({ ...block, tokens: new Set(matchTokens(block.source)) }))
  let matched = 0
  const enriched: TranslationSegment[] = segments.map((segment): TranslationSegment => {
    if (!['text', 'heading', 'caption'].includes(segment.kind)) return { ...segment, sourceMode: 'pdf' as const }
    const tokens = matchTokens(segment.source)
    if (tokens.length < 2) return { ...segment, sourceMode: 'pdf' as const }
    let best: { index: number; score: number; block: typeof prose[number] } | undefined
    for (let index = 0; index < prose.length; index += 1) {
      const block = prose[index]
      const overlap = tokens.filter((token) => block.tokens.has(token)).length
      const score = overlap / tokens.length
      if (!best || score > best.score) best = { index, score, block }
    }
    const threshold = tokens.length < 5 ? .78 : .58
    if (!best || best.score < threshold) return { ...segment, sourceMode: 'pdf' as const }
    matched += 1
    return { ...segment, sourceMode: 'latex' as const, sectionTitle: best.block.section, paragraphContext: best.block.source.slice(0, 12_000) }
  })
  const equationIndexes = enriched.map((segment, index) => segment.kind === 'equation' ? index : -1).filter((index) => index >= 0)
  const usedEquations = new Set<number>()
  for (const block of structure.blocks.filter((candidate) => candidate.kind === 'equation')) {
    const ranked = equationIndexes.filter((index) => !usedEquations.has(index)).map((index) => ({ index, score: tokenSimilarity(block.source, enriched[index].source) })).sort((a, b) => b.score - a.score)
    const selected = ranked[0]
    if (!selected || selected.score < .22) continue
    usedEquations.add(selected.index)
    enriched[selected.index] = { ...enriched[selected.index], source: block.source, sourceMode: 'latex', blockId: block.id, sectionTitle: block.section }
  }

  const tableBlocks = structure.blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.kind === 'table')
  const captionIndexes = enriched.map((segment, index) => segment.kind === 'caption' && /^(?:table|algorithm)\s*\d+/i.test(segment.source) ? index : -1).filter((index) => index >= 0)
  const usedCaptions = new Set<number>()
  for (let tableIndex = 0; tableIndex < tableBlocks.length; tableIndex += 1) {
    const { block, index: blockIndex } = tableBlocks[tableIndex]
    const nextBlock = structure.blocks[blockIndex + 1]; const latexCaption = nextBlock?.kind === 'caption' ? nextBlock : undefined
    const available = captionIndexes.filter((index) => !usedCaptions.has(index))
    const ranked = available.map((index) => ({ index, score: tokenSimilarity(latexCaption?.source ?? block.source, enriched[index].source) })).sort((a, b) => b.score - a.score)
    const selected = ranked[0]?.score >= .12 ? ranked[0].index : available[0]
    if (selected === undefined) continue
    usedCaptions.add(selected); const caption = enriched[selected]
    enriched[selected] = { ...caption, kind: 'table', source: block.source, sourceMode: 'latex', blockId: block.id, sectionTitle: block.section, paragraphContext: latexCaption?.source }
  }
  return { segments: enriched, matched }
}

async function prepareFigureAsset(asset: PaperFigureAsset): Promise<PaperFigureAsset & { preview?: string }> {
  if (!asset.dataUrl) return asset
  if (asset.mimeType?.startsWith('image/')) return { ...asset, preview: asset.dataUrl }
  if (asset.mimeType !== 'application/pdf') return asset
  try {
    const encoded = asset.dataUrl.split(',')[1]; const raw = atob(encoded); const data = Uint8Array.from(raw, (character) => character.charCodeAt(0))
    const figurePdf = await pdfjs.getDocument({ data, ...pdfOptions }).promise; const page = await figurePdf.getPage(1); const base = page.getViewport({ scale: 1 }); const renderScale = Math.min(2, 560 / Math.max(1, base.width)); const viewport = page.getViewport({ scale: renderScale })
    const canvas = window.document.createElement('canvas'); canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height)); await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    return { ...asset, preview: canvas.toDataURL('image/jpeg', .86) }
  } catch { return asset }
}

function Finder({ library, settings, onChooseFolder, onOpen, onDownloaded, onSettings, onClose }: {
  library: PaperRecord[]; settings: AppSettings; onChooseFolder: () => void; onOpen: (paper: PaperRecord) => void
  onDownloaded: (paper: PaperRecord) => void; onSettings: (patch: Partial<AppSettings>) => void; onClose: () => void
}) {
  useDialogFocus(true, '.paper-finder', '.new-paper')
  const [query, setQuery] = useState(''); const [results, setResults] = useState<ArxivPaper[]>([])
  const [suggestions, setSuggestions] = useState<Array<{ title: string; authorsYear?: string }>>([])
  const [searching, setSearching] = useState(false); const [downloading, setDownloading] = useState<string>(); const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [searchSource, setSearchSource] = useState<'crossref' | 'arxiv'>('crossref')
  const searchSequence = useRef(0)

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    if (searchSource !== 'arxiv' || query.trim().length < 2) { setSuggestions([]); return }
    let disposed = false
    const timeout = window.setTimeout(() => window.prism.autocompletePapers(query).then((value) => { if (!disposed) setSuggestions(value) }).catch(() => { if (!disposed) setSuggestions([]) }), 280)
    return () => { disposed = true; window.clearTimeout(timeout) }
  }, [query, searchSource])

  async function search(nextQuery = query) {
    if (!nextQuery.trim()) return
    setQuery(nextQuery); setSuggestions([]); setSearching(true); setResults([]); setHasSearched(true); setError('')
    const sequence = ++searchSequence.current
    try { const papers = await (searchSource === 'arxiv' ? window.prism.searchArxiv(nextQuery) : window.prism.searchCrossref(nextQuery)); if (sequence === searchSequence.current) setResults(papers) } catch (reason) { if (sequence === searchSequence.current) setError(reason instanceof Error ? reason.message : String(reason)) } finally { if (sequence === searchSequence.current) setSearching(false) }
  }
  async function download(paper: ArxivPaper) {
    if (!settings.libraryPath) { onChooseFolder(); return }
    setDownloading(paper.arxivId); setError('')
    try { onDownloaded(await window.prism.downloadPaper(paper)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setDownloading(undefined) }
  }

  async function importPdf(metadata?: ArxivPaper) {
    if (!settings.libraryPath) { onChooseFolder(); return }
    setDownloading('local'); setError('')
    try { const paper = await window.prism.importLocalPaper(metadata); if (paper) onDownloaded(paper) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setDownloading(undefined) }
  }

  return <div className="finder-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="paper-finder" role="dialog" aria-modal="true" aria-labelledby="paper-finder-title">
    <header><div><span className="finder-icon"><BookOpen size={20} /></span><div><h2 id="paper-finder-title">논문 찾기</h2><p>PDF를 가져오거나 제목·키워드·DOI로 찾아보세요.</p></div></div><button onClick={onClose} aria-label="논문 찾기 닫기"><X size={18} /></button></header>
    {!settings.libraryPath && <button className="folder-callout" onClick={onChooseFolder}><FolderOpen size={18} /><span><strong>라이브러리 폴더가 필요합니다</strong><small>PDF, 소스, 번역, Markdown 노트를 저장할 위치를 선택하세요.</small></span><ArrowRight size={16} /></button>}
    <div className="search-source"><label>검색 범위 <select aria-label="검색 범위" value={searchSource} onChange={event => { searchSequence.current++; setSearching(false); setSearchSource(event.target.value as "crossref" | "arxiv"); setResults([]); setSuggestions([]); setHasSearched(false); setError("") }}><option value="crossref">모든 분야 · Crossref</option><option value="arxiv">arXiv · 프리프린트</option></select></label><small>{searchSource === "crossref" ? "원문 사이트에서 받은 PDF를 연결하면 서지정보도 함께 저장됩니다." : "PDF와 공개된 LaTeX 소스를 바로 저장합니다."}</small></div><div className="finder-search-wrap"><div className="finder-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder={searchSource === "crossref" ? "예: CRISPR, 단백질 구조, 10.1038/…" : "논문 제목, arXiv ID 또는 링크"} aria-label="논문 검색어" /><button onClick={() => void search()} disabled={searching || !query.trim()}>{searching ? <LoaderCircle className="spin" size={16} /> : '검색'}</button></div>
      {suggestions.length > 0 && <div className="search-suggestions">{suggestions.map((item) => <button key={`${item.title}-${item.authorsYear}`} onMouseDown={(event) => event.preventDefault()} onClick={() => void search(item.title)}><Search size={13} /><span><strong>{item.title}</strong><small>{item.authorsYear}</small></span></button>)}</div>}
    </div>
    <div className="import-pdf-row"><button disabled={Boolean(downloading) || !settings.libraryPath} onClick={() => void importPdf()}><FolderOpen size={16} /> {downloading === "local" ? "가져오는 중…" : "내 컴퓨터에서 PDF 가져오기"}</button><span>모든 연구 분야 · AI 연결 없이 읽기</span></div><div className="finder-options"><label><input type="checkbox" checked={settings.autoTranslate} onChange={(event) => onSettings({ autoTranslate: event.target.checked })} /><span>저장 직후 설정된 모델로 한국어 번역 시작</span></label><small><Settings2 size={12} /> 번역 모델은 논문 화면에서 미리 설정할 수 있습니다.</small></div>
    {error && <div className="finder-error">{error}</div>}
    <div className="finder-content">{searching ? <div className="finder-empty" role="status"><LoaderCircle className="spin" size={24} /><p>논문을 찾고 있습니다…</p></div> : results.length > 0 ? <><p className="result-label">{searchSource === "crossref" ? "검색 결과 · Crossref" : "검색 결과 · arXiv"}</p>{results.map((paper, index) => {
      const saved = library.find((item) => item.arxivId === paper.arxivId)
      return <article className="paper-result" key={paper.arxivId}><div><div className="paper-result-meta"><span>#{index + 1}</span><span>{paper.arxivId}</span><span>{paper.categories[0]}</span><span>{paper.published.slice(0, 10)}</span>{typeof paper.citationCount === 'number' && <span>인용 {paper.citationCount.toLocaleString()}</span>}</div><h3>{paper.title}</h3><p className="authors">{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ` 외 ${paper.authors.length - 4}명` : ''}</p><p className="abstract">{paper.summary}</p></div><div className="result-actions"><button onClick={() => void (paper.arxivId.startsWith("doi:") ? window.prism.openDoi(paper.arxivId) : window.prism.openArxiv(paper.arxivId))} title="원문 사이트 열기" aria-label="원문 사이트 열기"><ExternalLink size={14} /></button>{paper.arxivId.startsWith("doi:") ? <button className="primary" disabled={Boolean(downloading)} onClick={() => void importPdf(paper)}><FolderOpen size={14} /> PDF 연결</button> : saved ? <button className="primary" onClick={() => { onOpen(saved); onClose() }}><Check size={14} /> 열기</button> : <button className="primary" onClick={() => void download(paper)} disabled={downloading === paper.arxivId}>{downloading === paper.arxivId ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} 저장</button>}</div></article>
    })}</> : hasSearched && !searching ? <div className="finder-empty no-results"><Search size={32} strokeWidth={1.4} /><h3>검색 결과가 없습니다</h3><p>영문 제목이나 DOI로 검색하거나 검색 범위를 바꿔 보세요.</p><button onClick={() => { setQuery(''); setHasSearched(false) }}>검색어 지우기</button></div> : library.length > 0 ? <><p className="result-label">MY LIBRARY · {library.length}</p>{library.map((paper) => <button className="library-result" key={paper.arxivId} onClick={() => { onOpen(paper); onClose() }}><FileText size={18} /><span><strong>{paper.title}</strong><small>{paper.arxivId} · {paper.authors.slice(0, 2).join(', ')}</small></span><ArrowRight size={15} /></button>)}</> : <div className="finder-empty"><BookOpen size={34} strokeWidth={1.4} /><h3>첫 논문을 찾아보세요</h3><p>생물학·의학·공학 등 어떤 분야의 PDF도 가져올 수 있습니다. 읽다가 남긴 메모는 Markdown으로 보관됩니다.</p><div className="finder-steps"><span><b>1</b> 논문 검색</span><span><b>2</b> 로컬 저장</span><span><b>3</b> 읽고 질문하기</span></div></div>}</div>
  </section></div>
}

function PdfPage({ document: pdfDocument, pageNumber, scale: requestedScale, fitWidth, translationFormat, segments, translation, mode, highlighted, figureSelect, sourceFigures, onHighlight, onTag, onFindNotes, onFigure, onCaptureError, focusedFigure }: {
  document: PdfDocument; pageNumber: number; scale: number; fitWidth?: boolean; translationFormat?: 'paper' | 'flow'; segments: TranslationSegment[]; translation: Map<string, string>; mode: 'original' | 'translated'
  highlighted?: string; figureSelect: boolean; onHighlight: (id?: string) => void; onTag: (segment: TranslationSegment) => void; onFindNotes: (segment: TranslationSegment) => void
  sourceFigures: Array<PaperFigureAsset & { captionAnchorId?: string; preview?: string }>
  focusedFigure?: { anchorId: string; rect: { x: number; y: number; width: number; height: number } }
  onCaptureError: (message: string) => void
  onFigure: (page: number, dataUrl: string, preview: string, rect: { x: number; y: number; width: number; height: number }, sourceFigure?: PaperFigureAsset) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const pageRef = useRef<HTMLDivElement>(null); const [itemRects, setItemRects] = useState<ItemRect[]>([])
  const [availableWidth, setAvailableWidth] = useState(612)
  const [naturalWidth, setNaturalWidth] = useState(612)
  const [naturalHeight, setNaturalHeight] = useState(792)
  const scale = fitWidth ? Math.min(2, Math.max(.15, availableWidth / naturalWidth)) : requestedScale
  useEffect(() => {
    const pane = pageRef.current?.parentElement
    if (!pane || !fitWidth) return
    const measure = () => {
      const style = getComputedStyle(pane)
      setAvailableWidth(Math.max(100, pane.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)))
    }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(pane)
    return () => observer.disconnect()
  }, [fitWidth])
  const [pageError, setPageError] = useState('')
  const [renderAttempt, setRenderAttempt] = useState(0)
  const [detectedFigureRects, setDetectedFigureRects] = useState<ItemRect[]>([])
  const pageSize = { width: naturalWidth * scale, height: naturalHeight * scale }
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2); const [rendered, setRendered] = useState(false)
  const [selection, setSelection] = useState<{ startX: number; startY: number; x: number; y: number }>()
  const selectionRef = useRef<{ startX: number; startY: number; x: number; y: number } | undefined>(undefined)
  useEffect(() => {
    if (!pageRef.current || nearViewport) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNearViewport(true); observer.disconnect() } }, { rootMargin: '1000px 0px' })
    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [nearViewport])
  useEffect(() => {
    if (!canvasRef.current || !nearViewport) return
    setRendered(false); setPageError('')
    let cancelled = false; let renderTask: ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | undefined
    pdfDocument.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return
      setNaturalWidth(page.getViewport({ scale: 1 }).width)
      setNaturalHeight(page.getViewport({ scale: 1 }).height)
      const viewport = page.getViewport({ scale }); const deviceRatio = window.devicePixelRatio || 1; const ratio = mode === 'translated' ? Math.max(deviceRatio, Math.min(4, Math.ceil(1000 / viewport.width) * deviceRatio)) : deviceRatio; const canvas = canvasRef.current; const context = canvas.getContext('2d')!
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); await renderTask.promise
      if (!cancelled) setRendered(true)
      const content = await page.getTextContent(); const items = content.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]; const styles = content.styles as Record<string, PdfTextStyle>
      if (!cancelled) setItemRects(items.map((item) => {
        const tx = pdfjs.Util.transform(viewport.transform, item.transform); const style = item.fontName ? styles[item.fontName] : undefined
        const ascent = typeof style?.ascent === 'number' ? style.ascent : typeof style?.descent === 'number' ? 1 + style.descent : .8
        return textItemRect(tx, item.width, scale, ascent, item.str)
      }))
      try {
        const operators = await page.getOperatorList(); let transform = [1, 0, 0, 1, 0, 0]; const stack: number[][] = []; const figures: ItemRect[] = []; const vectors: ItemRect[] = []
        for (let index = 0; index < operators.fnArray.length; index += 1) {
          const operation = operators.fnArray[index]; const args = operators.argsArray[index] as unknown[]
          if (operation === pdfjs.OPS.save) stack.push([...transform])
          else if (operation === pdfjs.OPS.restore) transform = stack.pop() ?? [1, 0, 0, 1, 0, 0]
          else if (operation === pdfjs.OPS.transform && args.length >= 6) transform = pdfjs.Util.transform(transform, args.slice(0, 6).map(Number))
          else if (operation === pdfjs.OPS.constructPath && args[2] && typeof args[2] === 'object') {
            const bounds = Array.from(args[2] as ArrayLike<number>)
            if (bounds.length === 4 && bounds.every(Number.isFinite)) {
              const matrix = pdfjs.Util.transform(viewport.transform, transform)
              const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[0], bounds[3]], [bounds[2], bounds[3]]].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]])
              const left = Math.max(0, Math.min(...corners.map(point => point[0]))); const top = Math.max(0, Math.min(...corners.map(point => point[1])))
              const right = Math.min(viewport.width, Math.max(...corners.map(point => point[0]))); const bottom = Math.min(viewport.height, Math.max(...corners.map(point => point[1])))
              if (right >= left && bottom >= top) vectors.push({ left, top, width: right - left, height: bottom - top })
            }
          }
          else if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(operation)) {
            const matrix = pdfjs.Util.transform(viewport.transform, transform); const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]])
            const left = Math.min(...corners.map((corner) => corner[0])); const top = Math.min(...corners.map((corner) => corner[1])); const width = Math.max(...corners.map((corner) => corner[0])) - left; const height = Math.max(...corners.map((corner) => corner[1])) - top
            const area = width * height; if (width > 72 * scale && height > 55 * scale && area > 7_500 * scale * scale && area < viewport.width * viewport.height * .78) figures.push({ left, top, width, height })
          }
        }
        figures.push(...joinVectorRegions(vectors, scale, viewport.width * viewport.height))
        if (!cancelled) setDetectedFigureRects(figures.filter((figure, index, all) => all.findIndex((candidate) => Math.abs(candidate.left - figure.left) < 3 && Math.abs(candidate.top - figure.top) < 3 && Math.abs(candidate.width - figure.width) < 3 && Math.abs(candidate.height - figure.height) < 3) === index))
      } catch { if (!cancelled) setDetectedFigureRects([]) }
    }).catch(reason => { if (!cancelled) setPageError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdfDocument, pageNumber, scale, nearViewport, renderAttempt, translationFormat])
  function point(event: ReactPointerEvent) { const box = pageRef.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top } }
  const captureBusy = useRef(false)
  const [capturing, setCapturing] = useState(false)
  async function captureFigure(x: number, y: number, width: number, height: number, sourceFigure?: PaperFigureAsset & { preview?: string }) {
    if (!canvasRef.current || captureBusy.current) return
    const source = canvasRef.current
    const sourceWidth = parseFloat(source.style.width) || source.clientWidth
    const sourceHeight = parseFloat(source.style.height) || source.clientHeight
    if (![x, y, width, height, sourceWidth, sourceHeight].every(Number.isFinite) || width <= 0 || height <= 0) return
    captureBusy.current = true; setCapturing(true)
    try {
      // Render the PDF region again: enlarging the displayed bitmap cannot recover small labels.
      const quality = Math.min(4, 2000 / Math.max(width, height))
      const crop = window.document.createElement('canvas')
      crop.width = Math.max(1, Math.round(width * quality)); crop.height = Math.max(1, Math.round(height * quality))
      const page = await pdfDocument.getPage(pageNumber)
      await page.render({ canvas: crop, canvasContext: crop.getContext('2d')!, viewport: page.getViewport({ scale }), transform: [quality, 0, 0, quality, -x * quality, -y * quality] }).promise
      const thumbnail = window.document.createElement('canvas'); const thumbnailScale = Math.min(1, 960 / crop.width, 720 / crop.height)
      thumbnail.width = Math.max(1, Math.round(crop.width * thumbnailScale)); thumbnail.height = Math.max(1, Math.round(crop.height * thumbnailScale)); thumbnail.getContext('2d')!.drawImage(crop, 0, 0, thumbnail.width, thumbnail.height)
      onFigure(pageNumber, crop.toDataURL('image/png'), thumbnail.toDataURL('image/jpeg', .86), { x: x / sourceWidth, y: y / sourceHeight, width: width / sourceWidth, height: height / sourceHeight }, sourceFigure)
    } catch (reason) {
      onCaptureError(`피겨를 저장하지 못했습니다. 다시 선택해 주세요. ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally { captureBusy.current = false; setCapturing(false) }
  }
  function finishFigure(event: ReactPointerEvent) {
    const current = selectionRef.current
    if (!current || !canvasRef.current) return
    const end = point(event); let x = Math.max(0, Math.min(current.startX, end.x)); let y = Math.max(0, Math.min(current.startY, end.y)); let width = Math.abs(end.x - current.startX); let height = Math.abs(end.y - current.startY); selectionRef.current = undefined; setSelection(undefined)
    if (width < 24 || height < 24) {
      width = Math.min(pageSize.width * .72, 520 * scale); height = Math.min(pageSize.height * .34, 320 * scale)
      x = Math.max(0, Math.min(pageSize.width - width, end.x - width / 2)); y = Math.max(0, Math.min(pageSize.height - height, end.y - height / 2))
    }
    captureFigure(x, y, Math.min(width, pageSize.width - x), Math.min(height, pageSize.height - y))
  }
  const structuredRegions = segments.filter((segment) => ['equation', 'table'].includes(segment.kind)).flatMap((segment) => {
    const rects = segmentRects(segment, itemRects, scale); if (!rects.length) return []
    const left = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top)); const width = Math.max(...rects.map((rect) => rect.left + rect.width)) - left; const height = Math.max(...rects.map((rect) => rect.top + rect.height)) - top
    return [{ segment, rect: { left, top, width, height } }]
  })
  const sourceFigureRects = sourceFigures.flatMap((figure) => {
    const caption = segments.find((segment) => segment.id === figure.captionAnchorId)
    const rects = caption ? segmentRects(caption, itemRects, scale) : []
    if (!rects.length) return []
    const captionLeft = Math.min(...rects.map((rect) => rect.left)); const captionTop = Math.min(...rects.map((rect) => rect.top)); const captionWidth = Math.max(...rects.map((rect) => rect.left + rect.width)) - captionLeft
    const fullWidth = captionWidth > pageSize.width * .58; const width = fullWidth ? pageSize.width * .82 : pageSize.width * .43
    const left = fullWidth ? pageSize.width * .09 : captionLeft < pageSize.width / 2 ? pageSize.width * .055 : pageSize.width * .515
    const height = Math.min(260 * scale, Math.max(90 * scale, captionTop - 24 * scale)); const top = Math.max(8 * scale, captionTop - height - 5 * scale)
    return [{ figure, rect: { left, top, width, height } }]
  })
  const automaticFigures: Array<{ key: string; figure?: PaperFigureAsset & { preview?: string }; rect: ItemRect }> = detectedFigureRects.length
    ? [...detectedFigureRects.map((rect, index) => ({ key: `pdf-${index}`, figure: sourceFigures.find(figure => { const caption = segments.find(segment => segment.id === figure.captionAnchorId); const boxes = caption ? segmentRects(caption, itemRects, scale) : []; return boxes.some(box => box.top >= rect.top + rect.height - 8 * scale && box.top - rect.top - rect.height < 70 * scale && box.left < rect.left + rect.width && box.left + box.width > rect.left) }), rect })), ...sourceFigureRects.slice(detectedFigureRects.length).map(({ figure, rect }) => ({ key: figure.id, figure, rect }))]
    : sourceFigureRects.map(({ figure, rect }) => ({ key: figure.id, figure, rect }))
  if (mode === 'translated') return <div className={`continuous-page translated flow-page ${translationFormat === 'paper' ? 'paper-layout-page' : ''} ${rendered ? "rendered" : "pending"}`} ref={pageRef} data-page={`translated-${pageNumber}`} data-render-scale={scale} style={{ width: pageSize.width, minHeight: translationFormat === 'paper' ? pageSize.height : undefined, fontSize: 15 * scale }}>
    {translationFormat === 'flow' && <header className="flow-page-heading"><span>한국어 읽기 · {pageNumber}쪽</span><small>{segments.some(segment => ['text', 'heading', 'caption'].includes(segment.kind) && !translation.get(segment.id)) ? '아직 번역하지 않은 문장은 원문으로 표시합니다' : '수식·표는 원문을 보존합니다'}</small></header>}
    {translationFormat === 'flow' ? <details className="flow-original"><summary>이 페이지 원문 펼치기</summary><canvas ref={canvasRef} /></details> : <canvas ref={canvasRef} style={{ display: 'none' }} />}
    {!rendered && <p className="flow-loading">{pageError || "페이지를 준비하고 있습니다…"}{pageError && <button onClick={() => setRenderAttempt(value => value + 1)}>다시 시도</button>}</p>}
    {capturing && <div className="figure-capture-status" role="status">피겨를 준비하고 있습니다…</div>}
    <ReadingTranslation format={translationFormat} fontScale={1} sourceScale={scale} segments={segments} translation={translation} source={canvasRef.current} ready={rendered} sourceRects={itemRects} rectangles={segment => segmentRects(segment, itemRects, scale)} figures={detectedFigureRects} highlighted={highlighted} onHighlight={onHighlight} onFigureRect={rect => captureFigure(rect.left, rect.top, rect.width, rect.height)} onTag={segment => {
      if (segment.kind !== 'artifact') { onTag(segment); return }
      const boxes = segmentRects(segment, itemRects, scale)
      if (!boxes.length) return
      const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top))
      captureFigure(Math.max(0, left - 3), Math.max(0, top - 3), Math.max(...boxes.map(box => box.left + box.width)) - left + 6, Math.max(...boxes.map(box => box.top + box.height)) - top + 6)
    }} onFindNotes={onFindNotes} />
    {translationFormat === 'flow' && <span className="page-badge">{pageNumber}</span>}
  </div>
  return <div className={`continuous-page ${mode} ${rendered ? 'rendered' : 'pending'}`} ref={pageRef} data-page={`${mode}-${pageNumber}`} data-render-scale={scale} style={pageSize}><canvas ref={canvasRef} />
    {!rendered && <div className="page-loading">{pageError ? <><span role="alert">페이지를 표시하지 못했습니다: {pageError}</span><button onClick={() => setRenderAttempt(value => value + 1)}>다시 시도</button></> : <><LoaderCircle className="spin" size={16} /><span>페이지 {pageNumber} 준비 중</span></>}</div>}


    {capturing && <div className="figure-capture-status" role="status">피겨를 준비하고 있습니다…</div>}
    {mode === 'original' && <div className="source-figure-layer">{automaticFigures.map(({ key, figure, rect }, index) => <button key={key} style={rect} title={`${figure?.caption || `PDF 피겨 ${index + 1}`} · 클릭하여 채팅에 태그`} onClick={() => captureFigure(rect.left, rect.top, rect.width, rect.height, figure)}><Image size={15} /><span>피겨 {figure ? figure.order + 1 : index + 1}</span></button>)}</div>}
    <div className="anchor-layer">{segments.filter((segment) => !['artifact', 'equation', 'table'].includes(segment.kind)).flatMap((segment) => segmentRects(segment, itemRects, scale).map((rect, rectIndex) => <span key={`${segment.id}-${rectIndex}`} data-anchor={segment.id} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} style={rect} title="클릭: 채팅 태그 · 우클릭: 노트에 담기" onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onContextMenu={(event) => { event.preventDefault(); onFindNotes(segment) }} />))}</div>
    <div className="structure-anchor-layer">{structuredRegions.map(({ segment, rect }) => <button key={segment.id} data-anchor={segment.id} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} style={rect} title={`${segment.kind === 'table' ? '표' : '수식'} · 클릭: 채팅 태그 · 우클릭: 노트에 담기`} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onContextMenu={(event) => { event.preventDefault(); onFindNotes(segment) }}>{segment.kind === 'table' ? <Table2 size={11} /> : <Sigma size={11} />}</button>)}</div>
    {figureSelect && <div className="figure-capture-layer" onPointerDown={(event) => { const value = point(event); const next = { startX: value.x, startY: value.y, x: value.x, y: value.y }; event.currentTarget.setPointerCapture(event.pointerId); selectionRef.current = next; setSelection(next) }} onPointerMove={(event) => { const current = selectionRef.current; if (!current) return; const value = point(event); const next = { ...current, x: value.x, y: value.y }; selectionRef.current = next; setSelection(next) }} onPointerUp={finishFigure}>{selection && <span style={{ left: Math.min(selection.startX, selection.x), top: Math.min(selection.startY, selection.y), width: Math.abs(selection.x - selection.startX), height: Math.abs(selection.y - selection.startY) }} />}</div>}
    {focusedFigure && <span data-saved-figure={focusedFigure.anchorId} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 7, left: focusedFigure.rect.x * pageSize.width, top: focusedFigure.rect.y * pageSize.height, width: focusedFigure.rect.width * pageSize.width, height: focusedFigure.rect.height * pageSize.height, outline: '2px solid #8873cb', outlineOffset: 3 }} />}
    <span className="page-badge">{pageNumber}</span>
  </div>
}

export default function PaperWorkspace({ providers, command, sidebarOpen, onToggleSidebar, onTagAnchor, onAnchorCatalog, onWorkspaceState }: { providers: ProviderInfo[]; sidebarOpen: boolean; command?: WorkspaceCommand; onToggleSidebar: () => void; onTagAnchor: (anchor: ContextAnchor) => void; onAnchorCatalog: (anchors: ContextAnchor[]) => void; onWorkspaceState: (state: WorkspaceSnapshot) => void }) {
  const [reloadAttempt, setReloadAttempt] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const [settings, setSettings] = useState<AppSettings>({ translationProvider: 'codex', translationModel: 'gpt-5.6-luna', autoTranslate: false })
  const [library, setLibrary] = useState<PaperRecord[]>([]); const [tabs, setTabs] = useState<string[]>([]); const [activeId, setActiveId] = useState<string>()
  const [editingPaper, setEditingPaper] = useState<{ paper: PaperRecord; libraryPath: string; document: PdfDocument }>()
  const [finderOpen, setFinderOpen] = useState(false); const [pdf, setPdf] = useState<PdfDocument>()
  const [pdfPaperId, setPdfPaperId] = useState<string>()
  const [translatedFit, setTranslatedFit] = useState(true)
  const [pageNumber, setPageNumber] = useState(1); const [sourceScale, setSourceScale] = useState(1); const [sourceFit, setSourceFit] = useState(true); const [translatedScale, setTranslatedScale] = useState(1); const [allSegments, setAllSegments] = useState<TranslationSegment[]>([])
  const [translation, setTranslation] = useState<TranslationSegment[]>([]); const [highlighted, setHighlighted] = useState<string>(); const [layout, setLayout] = useState<PaneNode>(() => panePresets.original())
  const [comparisonReturn, setComparisonReturn] = useState<{ paperId: string; layout: PaneNode; sourceScale: number; translatedScale: number; sourceFit: boolean; translatedFit: boolean }>()
  const [translationFormat, setTranslationFormat] = useState<'paper' | 'flow'>(() => localStorage.getItem('prism.translation-format') === 'flow' ? 'flow' : 'paper'); const [cacheExists, setCacheExists] = useState(false)
  const { panel: backlinkPanel, memo: captureMemo, concept: captureConcept, status: captureStatus, conceptOptions, saving: captureSaving, show: showBacklinks, close: closeBacklinks, setMemo: setCaptureMemo, setConcept: setCaptureConcept, capture: captureAnchor } = useEvidenceCapture({ libraryPath: settings.libraryPath, activePaperId: activeId })
  const [sourceStatus, setSourceStatus] = useState<{ mode: 'latex' | 'pdf'; matched: number; total: number }>({ mode: 'pdf', matched: 0, total: 0 })
  const [translationTargetPage, setTranslationTargetPage] = useState(1); const [pendingTranslationPage, setPendingTranslationPage] = useState<number>(); const [translationScope, setTranslationScope] = useState<'page' | 'all'>('page'); const [translationJobs, setTranslationJobs] = useState<Record<string, boolean>>({}); const translating = Boolean(activeId && translationJobs[activeId]); const [translationProgress, setTranslationProgress] = useState({ completed: 0, total: 0 }); const [figureSelect, setFigureSelect] = useState(false)
  const [figureAssets, setFigureAssets] = useState<Array<PaperFigureAsset & { preview?: string }>>([]); const [error, setError] = useState('')
  const [loadStatus, setLoadStatus] = useState<{ phase: 'pdf' | 'analyzing'; completed: number; total: number }>()
  const [focusedFigure, setFocusedFigure] = useState<{ paperId: string; page: number; anchorId: string; rect: { x: number; y: number; width: number; height: number } }>()
  const [syncScrollEnabled, setSyncScrollEnabled] = useState(true); const [syncZoomEnabled, setSyncZoomEnabled] = useState(false); const [pendingAnchor, setPendingAnchor] = useState<ContextAnchor>()
  const activeIdRef = useRef<string | undefined>(undefined); const autoStartedRef = useRef(new Set<string>()); const sourceScrollRef = useRef<HTMLDivElement>(null); const translatedScrollRef = useRef<HTMLDivElement>(null); const layoutRef = useRef<PaneNode>(layout); const arrangedRef = useRef(false); const syncLock = useRef(false)
  const zoomAnchorRef = useRef<{ page: number; progress: number } | undefined>(undefined)
  const navigationTarget = useRef<ReadingPosition | undefined>(undefined)
  const explicitAnchorTarget = useRef<ContextAnchor | undefined>(undefined)
  const navigationTimer = useRef<number | undefined>(undefined)
  const lastReadingPosition = useRef<ReadingPosition | undefined>(undefined)
  const positionSaveTimer = useRef<number | undefined>(undefined)
  const [pageDraft, setPageDraft] = useState<string>()
  const paneWidths = useRef(new WeakMap<HTMLDivElement, number>())
  useEffect(() => window.prism.onSettingsChanged(next => {
    setSettings(next)
    if (next.libraryPath !== settings.libraryPath) {
      window.prism.listLibrary().then(papers => { setLibrary(papers); setTabs(papers[0] ? [papers[0].arxivId] : []); setActiveId(papers[0]?.arxivId) }).catch(reason => setError(String(reason)))
    }
  }), [settings.libraryPath])
  useEffect(() => window.prism.onLibraryChanged(setLibrary), [])
  const activePaper = library.find((paper) => paper.arxivId === activeId); const translationProvider = providers.find((provider) => provider.id === settings.translationProvider)
  const openPanes = openKinds(layout)
  const bothDocumentsOpen = openPanes.includes('original') && openPanes.includes('translated')
  /** Explicit arrangement edits replace the saved layout; temporary large reading does not. */
  function applyLayout(next: PaneNode, forPaper = activeIdRef.current) {
    if (comparisonReturn && JSON.stringify(next) === JSON.stringify(layoutRef.current)) return
    setComparisonReturn(undefined); layoutRef.current = next; arrangedRef.current = true; setLayout(next)
    if (forPaper) writeStoredLayout(forPaper, next)
  }
  /** Opening a closed window: into an empty group if the researcher left one, otherwise beside the original. */
  function openPane(kind: PaneKind) {
    if (kind === 'original' && comparisonReturn?.paperId === activeId && activeId) {
      const next = panePresets.original()
      layoutRef.current = next; setLayout(next); return
    }
    const empty = paneGroups(layout).find((group) => !group.tabs.length)
    if (empty) return applyLayout(moveKindToGroup(layout, empty.id, kind))
    if (kind === 'translated') return applyLayout(withTranslated(layout))
    const host = groupHolding(layout, 'original') ?? paneGroups(layout)[0]
    const side = kind === 'original' && (document.querySelector('.paper-workspace')?.clientWidth ?? window.innerWidth) < 960 ? 'top' : 'right'
    applyLayout(host ? splitGroupWithKind(layout, host.id, kind, side) : panePresets.original())
  }
  const translationMap = useMemo(() => new Map(translation.map((segment) => [segment.id, segment.translation ?? ''])), [translation])
  const preservedParagraphs = unsafeParagraphIds(allSegments)
  const preservedParagraphCount = new Set(allSegments.filter(segment => segment.page === pageNumber && preservedParagraphs.has(segment.blockId ?? '')).map(segment => segment.blockId)).size
  const mixedParagraphs = mixedProseParagraphs(allSegments)
  const translatedParagraphs = new Set(allSegments.filter(segment => translationMap.get(segment.id)).map(segment => segment.blockId))
  const protectedProseCount = allSegments.filter(segment => segment.page === pageNumber && segment.kind === 'artifact' && mixedParagraphs.has(segment.blockId ?? '') && !preservedParagraphs.has(segment.blockId ?? '') && translatedParagraphs.has(segment.blockId)).length
  const translatableSegments = allSegments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && !preservedParagraphs.has(segment.blockId ?? ''))
  const translatedCount = translatableSegments.filter(segment => translationMap.get(segment.id)).length
  const scopedSegments = translationScope === 'all' ? withoutBibliography(translatableSegments) : translatableSegments.filter(segment => segment.page === pageNumber)
  const scopedMissing = scopedSegments.filter(segment => !translation.some(saved => saved.id === segment.id && saved.source === segment.source && saved.translation)).length
  const scopedOriginalProse = allSegments.some(segment => (translationScope === 'all' || segment.page === pageNumber) && (segment.kind === 'artifact' || preservedParagraphs.has(segment.blockId ?? '')))
  const hasCachedTranslation = cacheExists
  const pageTranslatable = translatableSegments.filter(segment => segment.page === pageNumber && segment.source.trim().length > 1)
  const pageTranslated = pageTranslatable.filter(segment => translation.some(saved => saved.id === segment.id && saved.source === segment.source && saved.translation)).length
  const pageTranslationLabel = !pageTranslatable.length ? '원문 유지' : !pageTranslated ? '번역 전 · 원문' : pageTranslated < pageTranslatable.length ? `${pageTranslated}/${pageTranslatable.length}문장 번역` : '이 페이지 번역됨'
  const pageTranslationDetail = `${pageNumber}쪽: ${pageTranslated}/${pageTranslatable.length}문장 번역. ${!pageTranslatable.length ? '번역할 본문이 없는 페이지는 원문으로 표시합니다.' : pageTranslated < pageTranslatable.length ? '아직 번역하지 않은 문장은 원문으로 표시합니다. 위의 AI 번역 버튼으로 이 페이지를 번역할 수 있습니다.' : '번역문이 저장돼 있습니다.'}${preservedParagraphCount ? ` 글자 위치가 불확실한 ${preservedParagraphCount}개 문단은 원문으로 보존합니다.` : protectedProseCount ? ` 글자와 기호를 보존한 원문 ${protectedProseCount}곳이 포함돼 있습니다.` : ''}`
  const zoomLevels = [.7, .85, 1, 1.15, 1.3, 1.5, 1.75, 2]
  const captionSegments = allSegments.filter((segment) => segment.kind === 'caption')
  const matchedFigures = figureAssets.map((figure, index) => ({ ...figure, captionAnchorId: captionSegments[index]?.id }))
  const anchorCatalog = useMemo(() => {
    if (!activePaper) return []
    let sentence = 0; let section = 0; let equation = 0; let table = 0
    const anchors = allSegments.flatMap((segment): ContextAnchor[] => {
      if (segment.kind === 'heading') { section += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'section', page: segment.page, label: `섹션${section}`, source: segment.source, scientificSpans: segment.scientificSpans }] }
      if (['text', 'caption'].includes(segment.kind)) { sentence += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'sentence', page: segment.page, label: `문장${sentence}`, source: segment.source, scientificSpans: segment.scientificSpans }] }
      if (segment.kind === 'equation') { equation += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'equation', page: segment.page, label: `수식${equation}`, source: segment.source, scientificSpans: segment.scientificSpans }] }
      if (segment.kind === 'table') { table += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'table', page: segment.page, label: `표${table}`, source: segment.source, scientificSpans: segment.scientificSpans }] }
      return []
    })
    const pages = pdf ? Array.from({ length: pdf.numPages }, (_, index): ContextAnchor => ({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${index + 1}`, type: 'page', page: index + 1, label: `페이지${index + 1}`, source: `Page ${index + 1} of ${activePaper.title}` })) : []
    return [...anchors, ...pages]
  }, [activePaper?.arxivId, activePaper?.title, allSegments, pdf])

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { onAnchorCatalog(anchorCatalog) }, [anchorCatalog])
  useEffect(() => { onWorkspaceState({ library, openPaperIds: tabs, activePaperId: activeId, libraryPath: settings.libraryPath }) }, [library, tabs, activeId, settings.libraryPath])
  useEffect(() => {
    if (!command) return
    if (command.type === 'search') setFinderOpen(true)
    else if (command.type === 'choose-folder') void chooseFolder()
    else if (command.type === 'open-paper' && command.paperId) { const paper = library.find((item) => item.arxivId === command.paperId); if (paper) openPaper(paper) }
    else if (command.type === 'navigate-anchor' && command.anchor) {
      const paper = library.find((item) => item.arxivId === command.anchor!.paperId); if (paper) openPaper(paper)
      setPendingAnchor(command.anchor)
    }
  }, [command?.id])
  useEffect(() => {
    if (!pendingAnchor || pendingAnchor.paperId !== activeId || pdfPaperId !== pendingAnchor.paperId || !pdf) return
    // A source request owns the new paper's initial view. Cached translation
    // restoration must not switch it back to translated-only after PDF loading.
    arrangedRef.current = true
    // Explicit source navigation owns layout/resize scrolls until the reader takes over.
    // An old page restoration timer must not replay after the source pane is opened.
    explicitAnchorTarget.current = pendingAnchor
    navigationTarget.current = undefined
    window.clearTimeout(navigationTimer.current)
    window.clearTimeout(positionSaveTimer.current)
    setPendingTranslationPage(undefined)
    const sourceGroup = groupHolding(layout, 'original')
    if (!sourceGroup) { openPane('original'); return }
    if (sourceGroup.active !== 'original') { applyLayout(activateKind(layout, 'original')); return }
    if (loadStatus?.phase === 'analyzing') return
    let cancelled = false; let timer = 0
    const anchor = pendingAnchor
    setHighlighted(anchor.anchorId); setPageNumber(anchor.page); setFocusedFigure(undefined)
    async function locate() {
      let waitForTarget = allSegments.some(segment => segment.id === anchor.anchorId)
      if (/^(figure-p|source-)/.test(anchor.anchorId)) {
        const saved = await window.prism.readSavedFigure(anchor.paperId, anchor.anchorId).catch(() => undefined)
        if (cancelled || explicitAnchorTarget.current !== anchor) return
        if (saved?.rect && saved.page === anchor.page) { waitForTarget = true; setFocusedFigure({ paperId: anchor.paperId, page: anchor.page, anchorId: anchor.anchorId, rect: saved.rect }) }
      }
      const pageSelector = `[data-page="original-${anchor.page}"]`
      if (explicitAnchorTarget.current !== anchor) return
      window.document.querySelector(pageSelector)?.scrollIntoView({ block: 'center' })
      const deadline = performance.now() + 3000
      function center() {
        if (cancelled) return
        const page = window.document.querySelector(pageSelector)
        const target = page?.querySelector(`[data-saved-figure="${CSS.escape(anchor.anchorId)}"], [data-anchor="${CSS.escape(anchor.anchorId)}"]`)
        if ((!page?.classList.contains('rendered') || (waitForTarget && !target)) && performance.now() < deadline) { timer = window.setTimeout(center, 50); return }
        centerExplicitAnchor()
        setPendingAnchor(undefined)
      }
      timer = window.setTimeout(center, 50)
    }
    void locate()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [pendingAnchor, activeId, pdf, pdfPaperId, layout, loadStatus?.phase])
  useEffect(() => {
    Promise.all([window.prism.getSettings(), window.prism.listLibrary()]).then(([saved, papers]) => { setSettings(saved); setLibrary(papers); if (papers[0]) { setTabs([papers[0].arxivId]); setActiveId(papers[0].arxivId) } }).catch((reason) => setError(String(reason)))
    const offProgress = window.prism.onTranslationProgress((payload) => { const event = payload as { arxivId?: string; completedSegments?: number; totalSegments?: number; segments?: TranslationSegment[] }; if (event.arxivId) setTranslating(true, event.arxivId); if (event.arxivId === activeIdRef.current && event.segments) { setTranslation(event.segments); setCacheExists((event.completedSegments ?? 0) > 0); setTranslating(true); setTranslationProgress({ completed: event.completedSegments ?? 0, total: event.totalSegments ?? 0 }) } })
    const offDone = window.prism.onTranslationDone((payload) => { const event = payload as { arxivId?: string; segments?: TranslationSegment[]; warning?: string }; if (event.arxivId) setTranslating(false, event.arxivId); if (event.arxivId === activeIdRef.current) { if (event.warning) setError(event.warning); if (event.segments) { setTranslation(event.segments); setCacheExists(true); const done = event.segments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.translation).length; setTranslationProgress({ completed: done, total: event.segments.filter(segment => ['text', 'heading', 'caption'].includes(segment.kind)).length }) } setTranslating(false) } })
    const offError = window.prism.onTranslationError((payload) => { const event = payload as { arxivId?: string; message?: string }; if (event.arxivId) setTranslating(false, event.arxivId); if (event.arxivId === activeIdRef.current) { setError(event.message ?? '번역에 실패했습니다.'); setTranslating(false) } })
    return () => { offProgress(); offDone(); offError() }
  }, [])

  useEffect(() => {
    if (!activePaper) { setPdf(undefined); setPdfPaperId(undefined); return }
    if (explicitAnchorTarget.current?.paperId !== activePaper.arxivId) explicitAnchorTarget.current = undefined
    const remembered = readReadingPosition(activePaper.pdfPath)
    lastReadingPane.current = null; lastReadingPosition.current = remembered; navigationTarget.current = remembered
    window.clearTimeout(navigationTimer.current)
    setComparisonReturn(undefined); setPageDraft(undefined); setPdf(undefined); setPdfPaperId(undefined)
    let disposed = false; let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined; setPageNumber(remembered?.page ?? 1); setAllSegments([]); setTranslation([]); setFigureAssets([]); setCacheExists(false); setError('')
    const stored = readStoredLayout(activePaper.arxivId); layoutRef.current = stored.layout; arrangedRef.current = stored.stored; setLayout(stored.layout); setLoadStatus({ phase: 'pdf', completed: 0, total: 0 })
    Promise.all([window.prism.readPaperPdf(activePaper.arxivId), window.prism.readLatexStructure(activePaper.arxivId), window.prism.readPaperFigures(activePaper.arxivId)]).then(async ([data, latex, figures]) => {
      void Promise.all(figures.map(prepareFigureAsset)).then((preparedFigures) => { if (!disposed) setFigureAssets(preparedFigures) })
      if (disposed) return; loadingTask = pdfjs.getDocument({ data, ...pdfOptions }); const loaded = await loadingTask.promise; if (disposed) return; if (navigationTarget.current) navigationTarget.current = { ...navigationTarget.current, page: Math.min(navigationTarget.current.page, loaded.numPages) }; setPdfPaperId(activePaper.arxivId); setPdf(loaded); setLoadStatus({ phase: 'analyzing', completed: 0, total: loaded.numPages })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      const segments: TranslationSegment[] = []
      for (let page = 1; page <= loaded.numPages; page += 1) {
        if (disposed) return
        const pdfPage = await loaded.getPage(page); const text = await pdfPage.getTextContent()
        const items = text.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]
        const weights = await collectSourceFontWeights(pdfPage, items)
        const pageSegments = segmentsFromItems(page, items).map(segment => ({ ...segment, sourceFontWeight: dominantSourceWeight(segment, items, weights) }))
        const geometry = await captureGlyphGeometry(pdfPage, items, pageSegments)
        if (disposed) return
        segments.push(...pageSegments.map(segment => geometry.ok ? { ...segment, preciseRects: geometry.rectangles.get(segment.id), scientificSpans: geometry.scientificSpans.get(segment.id) } : segment))
        if (!disposed) setLoadStatus({ phase: 'analyzing', completed: page, total: loaded.numPages })
        if (page % 2 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      if (disposed) return
      const source = enrichWithLatex(segments, latex); const translatable = source.segments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind)).length
      setSourceStatus({ mode: source.matched > translatable * .35 ? 'latex' : 'pdf', matched: source.matched, total: translatable })
      setAllSegments(source.segments); void window.prism.savePaperAnchors(activePaper.arxivId, source.segments)
      const cache = await window.prism.readTranslation(activePaper.arxivId); if (disposed) return
      if (cache?.segments.length) {
        const byId = new Map(cache.segments.map((segment) => [segment.id, segment]))
        const bySource = new Map(cache.segments.filter((segment) => segment.translation).map((segment) => [segment.source.replace(/\s+/g, ' ').trim(), segment.translation]))
        const candidates = source.segments.map((segment) => ({ ...segment, translation: (byId.get(segment.id)?.source === segment.source ? byId.get(segment.id)?.translation : undefined) ?? bySource.get(segment.source.replace(/\s+/g, ' ').trim()) }))
        const restored = reuseTranslations(source.segments, candidates).filter(segment => segment.translation)
        setCacheExists(restored.some(segment => ['text', 'heading', 'caption'].includes(segment.kind))); setTranslation(restored); setTranslationProgress({ completed: restored.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind)).length, total: translatable }); if (!arrangedRef.current) applyLayout(withTranslated(layoutRef.current), activePaper.arxivId)
      }
      else if (settings.autoTranslate && translationProvider?.available && !autoStartedRef.current.has(activePaper.arxivId)) {
        autoStartedRef.current.add(activePaper.arxivId); setTranslating(true); setTranslationProgress({ completed: 0, total: translatable }); if (!arrangedRef.current) applyLayout(withTranslated(layoutRef.current), activePaper.arxivId)
        void window.prism.startTranslation(activePaper.arxivId, source.segments, { force: false }).catch((reason) => { setTranslating(false); setError(reason instanceof Error ? reason.message : String(reason)) })
      }
      setLoadStatus(undefined)
    }).catch((reason) => { if (!disposed) { setLoadStatus(undefined); setError(reason instanceof Error ? reason.message : String(reason)) } })
    const persist = () => saveReadingPosition(activePaper.pdfPath, navigationTarget.current ?? lastReadingPosition.current)
    window.addEventListener('beforeunload', persist)
    return () => { disposed = true; void loadingTask?.destroy().catch(() => {}); persist(); window.clearTimeout(positionSaveTimer.current); window.clearTimeout(navigationTimer.current); window.removeEventListener('beforeunload', persist) }
  }, [activePaper?.pdfPath, reloadAttempt])
  function setTranslating(running: boolean, paperId = activeId) { if (paperId) setTranslationJobs(current => ({ ...current, [paperId]: running })) }
  function openPaper(paper: PaperRecord) { setTabs((current) => current.includes(paper.arxivId) ? current : [...current, paper.arxivId]); setActiveId(paper.arxivId) }
  function closeTab(id: string) { setTabs((current) => { const next = current.filter((value) => value !== id); if (activeId === id) setActiveId(next.at(-1)); return next }) }
  async function recoverMissingPaper() {
    setRecovering(true); setRecoveryNotice('')
    try {
      const result = await window.prism.reconnectPaperStorage()
      if (result?.noteWarnings) setRecoveryNotice(`${result.noteWarnings}개 노트의 PDF 속성은 변경된 형식 또는 편집 충돌로 갱신하지 못했습니다. 노트에서 확인해 주세요.`)
      if (result && !result.restored) setError('같은 원본을 찾지 못했습니다. 논문별 하위 폴더가 들어 있는 위치를 선택해 주세요.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRecovering(false) }
  }
  async function chooseFolder() { const next = await window.prism.chooseWorkspace(); if (next) { const papers = await window.prism.listLibrary(); setSettings(next); setLibrary(papers); setTabs(papers[0] ? [papers[0].arxivId] : []); setActiveId(papers[0]?.arxivId); if (!papers.length) setFinderOpen(true) } }
  async function updateSettings(patch: Partial<AppSettings>) { setSettings(await window.prism.updateSettings(patch)) }
  async function startTranslation(force = false) { if (!activePaper || !allSegments.length) return; setTranslationTargetPage(pageNumber); queueReadingPosition(); setTranslating(true); setTranslationProgress({ completed: 0, total: translatableSegments.length }); if (force) setTranslation([]); applyLayout(withTranslated(layoutRef.current), activePaper.arxivId); try { await window.prism.startTranslation(activePaper.arxivId, allSegments, { force, pages: !force && translationScope === 'page' ? [pageNumber] : undefined }) } catch (reason) { setTranslating(false); setError(reason instanceof Error ? reason.message : String(reason)) } }
  async function cancelTranslation() { if (!activePaper) return; try { await window.prism.cancelTranslation(activePaper.arxivId); setTranslating(false) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  function tagSegment(segment: TranslationSegment) { const anchor = anchorCatalog.find((item) => item.anchorId === segment.id); if (anchor) onTagAnchor(anchor) }
  /** A node in the structure map points at a heading; the reader goes there the same way a note link does. */
  function openAnchorFromMap(anchorId: string, page: number) {
    setPageNumber(page)
    const anchor = anchorCatalog.find((item) => item.anchorId === anchorId)
    if (anchor) setPendingAnchor(anchor); else scrollToPage(page)
  }
  function findSegmentNotes(segment: TranslationSegment) { const anchor = anchorCatalog.find((item) => item.anchorId === segment.id); if (anchor) void showBacklinks(anchor) }
  async function saveFigure(page: number, dataUrl: string, preview: string, rect: { x: number; y: number; width: number; height: number }, sourceFigure?: PaperFigureAsset) { if (!activePaper) return; const number = Date.now().toString(36); const figureId = sourceFigure ? `source-${sourceFigure.id}-${number}` : `figure-p${page}-${number}`; try { const imagePath = await window.prism.savePaperFigure(activePaper.arxivId, figureId, dataUrl, { page, rect, sourceFigureId: sourceFigure?.id, sourcePath: sourceFigure?.sourcePath, caption: sourceFigure?.caption }); onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: figureId, type: 'figure', page, label: `피겨${page}-${sourceFigure ? sourceFigure.order + 1 : number.slice(-3)}`, source: `${sourceFigure ? `Matched LaTeX figure ${sourceFigure.order + 1}. Caption: ${sourceFigure.caption ?? 'unknown'}. Source asset: ${sourceFigure.sourcePath ?? 'unavailable'}. ` : ''}Saved figure image: ${imagePath}. Normalized bounds: ${JSON.stringify(rect)}`, preview }); if (!sourceFigure) setFigureSelect(false) } catch (reason) { setError(String(reason)) } }
  function scrollAnchor(pane: HTMLDivElement | null): ReadingPosition {
    if (!pane) return { page: pageNumber, progress: 0 }
    const pages = [...pane.querySelectorAll<HTMLElement>('.continuous-page')]
    const marker = pane.scrollTop + pane.clientHeight * .28
    const current = pages.find((page) => page.offsetTop + page.offsetHeight >= marker) ?? pages.at(-1)
    if (!current) return { page: pageNumber, progress: 0 }
    const page = Number(current?.dataset.page?.split('-').at(-1)) || pageNumber
    const next = pages[pages.indexOf(current) + 1]
    const span = Math.max(1, (next?.offsetTop ?? (current.offsetTop + current.offsetHeight + 18)) - current.offsetTop)
    const markerY = pane.getBoundingClientRect().top + pane.clientHeight * .28
    const anchors = [...current.querySelectorAll<HTMLElement>('[data-anchor]')].filter(item => item.getBoundingClientRect().height > 0)
    const closest = anchors.reduce<HTMLElement | undefined>((best, item) => !best || Math.abs(item.getBoundingClientRect().top - markerY) < Math.abs(best.getBoundingClientRect().top - markerY) ? item : best, undefined)
    const matching = closest ? anchors.filter(item => item.dataset.anchor === closest.dataset.anchor).map(item => item.getBoundingClientRect()) : []
    const top = Math.min(...matching.map(rect => rect.top)); const bottom = Math.max(...matching.map(rect => rect.bottom))
    return { page, progress: Math.max(0, Math.min(1, (marker - current.offsetTop) / span)), anchorId: closest?.dataset.anchor, anchorProgress: closest ? Math.max(0, Math.min(1, (markerY - top) / Math.max(1, bottom - top))) : undefined }
  }
  const lastReadingPane = useRef<HTMLDivElement | null>(null)
  const syncedScrollPositions = useRef(new WeakMap<HTMLDivElement, number>())
  function centerExplicitAnchor() {
    const anchor = explicitAnchorTarget.current
    const pane = sourceScrollRef.current
    if (!anchor || anchor.paperId !== activeIdRef.current || !pane?.clientWidth) return
    const page = pane.querySelector<HTMLElement>(`[data-page="original-${anchor.page}"]`)
    if (!page?.classList.contains('rendered')) return
    const target = page.querySelector<HTMLElement>(`[data-saved-figure="${CSS.escape(anchor.anchorId)}"], [data-anchor="${CSS.escape(anchor.anchorId)}"]`) ?? page
    const bounds = target.getBoundingClientRect(); const viewport = pane.getBoundingClientRect()
    pane.scrollTop += (bounds.top + bounds.bottom) / 2 - (viewport.top + pane.clientTop + pane.clientHeight / 2)
    syncedScrollPositions.current.set(pane, pane.scrollTop)
    paneWidths.current.set(pane, pane.clientWidth)
    lastReadingPane.current = pane
    lastReadingPosition.current = { ...scrollAnchor(pane), page: anchor.page }
    setPageNumber(anchor.page)
    if (bothDocumentsOpen && syncScrollEnabled) syncScroll(pane, translatedScrollRef.current)
    if (activePaper) saveReadingPosition(activePaper.pdfPath, lastReadingPosition.current)
  }
  function readingScroll(pane: HTMLDivElement, other: HTMLDivElement | null) {
    if (explicitAnchorTarget.current?.paperId === activeIdRef.current) return
    // Layout can dispatch scroll before ResizeObserver sees the changed width.
    // Do not replace the last reading anchor with a position from that interim layout.
    const previousWidth = paneWidths.current.get(pane)
    if (previousWidth !== undefined && previousWidth !== pane.clientWidth && lastReadingPosition.current) {
      navigationTarget.current ??= lastReadingPosition.current
      restoreNavigation()
      return
    }
    const expected = syncedScrollPositions.current.get(pane)
    if (expected !== undefined) { syncedScrollPositions.current.delete(pane); if (Math.abs(pane.scrollTop - expected) < 2) return }
    if (!pane.clientWidth || syncLock.current || navigationTarget.current) return
    lastReadingPane.current = pane
    lastReadingPosition.current = scrollAnchor(pane)
    setPageNumber(lastReadingPosition.current.page)
    window.clearTimeout(positionSaveTimer.current)
    const path = activePaper?.pdfPath; const position = lastReadingPosition.current
    if (path) positionSaveTimer.current = window.setTimeout(() => saveReadingPosition(path, position), 250)
    if (bothDocumentsOpen && syncScrollEnabled) syncScroll(pane, other)
  }
  useEffect(() => {
    const panes = [sourceScrollRef.current, translatedScrollRef.current].filter((pane): pane is HTMLDivElement => Boolean(pane))
    const measure = () => {
      const resized = panes.some(pane => { const previous = paneWidths.current.get(pane); paneWidths.current.set(pane, pane.clientWidth); return previous !== undefined && previous !== pane.clientWidth })
      if (explicitAnchorTarget.current?.paperId === activeIdRef.current) { centerExplicitAnchor(); return }
      if (resized && !navigationTarget.current && lastReadingPosition.current) navigationTarget.current = lastReadingPosition.current
      if (navigationTarget.current) { restoreNavigation(); return }
      const pane = lastReadingPane.current?.clientWidth ? lastReadingPane.current : panes.find(item => item.clientWidth > 0)
      if (pane) { lastReadingPosition.current = scrollAnchor(pane); setPageNumber(lastReadingPosition.current.page) }
    }
    const observer = new ResizeObserver(measure)
    for (const pane of panes) { observer.observe(pane); pane.querySelectorAll('.continuous-page').forEach(page => observer.observe(page)) }
    measure()
    const interrupt = () => { explicitAnchorTarget.current = undefined; navigationTarget.current = undefined; window.clearTimeout(navigationTimer.current) }
    const keyInterrupt = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt() }
    for (const pane of panes) { pane.addEventListener('wheel', interrupt, { passive: true }); pane.addEventListener('pointerdown', interrupt); pane.addEventListener('keydown', keyInterrupt) }
    return () => { observer.disconnect(); for (const pane of panes) { pane.removeEventListener('wheel', interrupt); pane.removeEventListener('pointerdown', interrupt); pane.removeEventListener('keydown', keyInterrupt) } }
  }, [pdf, layout])
  function restoreScrollAnchor(pane: HTMLDivElement | null, anchor: ReadingPosition) {
    if (!pane?.clientWidth) return
    const current = pane.querySelector<HTMLElement>(`.continuous-page[data-page$="-${anchor.page}"]`)
    if (!current) return
    if (anchor.align === 'top') { pane.scrollTop = Math.max(0, current.offsetTop - 18); return }
    if (anchor.anchorId) {
      const matches = [...current.querySelectorAll<HTMLElement>('[data-anchor]')].filter(item => item.dataset.anchor === anchor.anchorId).map(item => item.getBoundingClientRect()).filter(rect => rect.height > 0)
      if (matches.length) {
        const top = Math.min(...matches.map(rect => rect.top)); const bottom = Math.max(...matches.map(rect => rect.bottom))
        pane.scrollTop += top + (bottom - top) * (anchor.anchorProgress ?? 0) - pane.getBoundingClientRect().top - pane.clientHeight * .28
        return
      }
    }
    const next = current.nextElementSibling as HTMLElement | null
    const span = Math.max(1, (next?.offsetTop ?? (current.offsetTop + current.offsetHeight + 18)) - current.offsetTop)
    pane.scrollTop = Math.max(0, current.offsetTop + span * anchor.progress - pane.clientHeight * .28)
  }
  function scrollToPage(targetPage: number) {
    explicitAnchorTarget.current = undefined
    navigationTarget.current = { page: Math.max(1, Math.min(pdf?.numPages ?? targetPage, targetPage)), progress: 0, align: 'top' }
    if (activePaper) saveReadingPosition(activePaper.pdfPath, navigationTarget.current)
    restoreNavigation()
  }
  function restoreNavigation() {
    if (explicitAnchorTarget.current?.paperId === activeIdRef.current) { centerExplicitAnchor(); return }
    const target = navigationTarget.current
    if (!target) return
    syncLock.current = true
    for (const pane of [sourceScrollRef.current, translatedScrollRef.current]) if (pane) { restoreScrollAnchor(pane, target); syncedScrollPositions.current.set(pane, pane.scrollTop) }
    setPageNumber(target.page)
    window.clearTimeout(navigationTimer.current)
    navigationTimer.current = window.setTimeout(() => {
      if (navigationTarget.current !== target) return
      lastReadingPosition.current = target; navigationTarget.current = undefined
    }, 750)
    requestAnimationFrame(() => { syncLock.current = false })
  }
  function queueReadingPosition() {
    explicitAnchorTarget.current = undefined
    // A just-submitted page jump is already authoritative even while its reflow settles.
    // Format/layout changes must carry that target forward, not revive the previous page.
    navigationTarget.current = navigationTarget.current ?? lastReadingPosition.current ?? { page: pageNumber, progress: 0, align: 'top' }
    window.clearTimeout(navigationTimer.current)
    setPendingTranslationPage(navigationTarget.current.page)
  }
  useEffect(() => {
    if (!pendingTranslationPage) return
    const frame = requestAnimationFrame(() => {
      if (!navigationTarget.current) navigationTarget.current = { page: pendingTranslationPage, progress: 0, align: 'top' }
      restoreNavigation(); setPendingTranslationPage(undefined)
    })
    return () => cancelAnimationFrame(frame)
  }, [layout, pendingTranslationPage, translationFormat])
  function setPaneZoom(mode: 'original' | 'translated', value: number) {
    if (mode === 'original' || syncZoomEnabled) setSourceFit(false)
    if (mode === 'translated' || syncZoomEnabled) setTranslatedFit(false)
    const activePane = mode === 'original' ? sourceScrollRef.current : translatedScrollRef.current
    zoomAnchorRef.current = navigationTarget.current ?? scrollAnchor(activePane)
    if (syncZoomEnabled) { setSourceScale(value); setTranslatedScale(value) } else if (mode === 'original') setSourceScale(value); else setTranslatedScale(value)
  }
  function fitPane(mode: 'original' | 'translated') {
    zoomAnchorRef.current = navigationTarget.current ?? scrollAnchor(mode === 'original' ? sourceScrollRef.current : translatedScrollRef.current)
    if (mode === 'original' || syncZoomEnabled) setSourceFit(true)
    if (mode === 'translated' || syncZoomEnabled) setTranslatedFit(true)
  }
  function changeZoom(mode: 'original' | 'translated', direction: -1 | 1) {
    const pane = mode === 'original' ? sourceScrollRef.current : translatedScrollRef.current
    const fitted = mode === 'original' ? sourceFit : translationFormat === 'paper' && translatedFit
    const renderedScale = Number(pane?.querySelector<HTMLElement>(`[data-page="${mode}-${pageNumber}"]`)?.dataset.renderScale)
    const current = fitted && renderedScale > 0 ? renderedScale : mode === 'original' ? sourceScale : translatedScale
    const target = direction > 0 ? zoomLevels.find(value => value > current + .001) : [...zoomLevels].reverse().find(value => value < current - .001)
    if (target) setPaneZoom(mode, target)
  }
  useEffect(() => {
    const pairs: Array<[HTMLDivElement | null, 'original' | 'translated']> = [[sourceScrollRef.current, 'original'], [translatedScrollRef.current, 'translated']]
    const cleanups = pairs.flatMap(([pane, mode]) => { if (!pane) return []; const zoomWheel = (event: WheelEvent) => { if (!event.ctrlKey) return; event.preventDefault(); changeZoom(mode, event.deltaY < 0 ? 1 : -1) }; pane.addEventListener('wheel', zoomWheel, { passive: false }); return [() => pane.removeEventListener('wheel', zoomWheel)] })
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [sourceScale, translatedScale, sourceFit, translatedFit, translationFormat, pageNumber, syncZoomEnabled, activePaper?.arxivId, pdf, layout])
  useEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor) return
    const restore = () => { restoreScrollAnchor(sourceScrollRef.current, anchor); restoreScrollAnchor(translatedScrollRef.current, anchor) }
    const frame = requestAnimationFrame(restore); const timeout = window.setTimeout(restore, 180)
    zoomAnchorRef.current = undefined
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timeout) }
  }, [sourceScale, translatedScale, sourceFit, translatedFit])
  function syncScroll(from: HTMLDivElement, to: HTMLDivElement | null) {
    if (!to || syncLock.current) return
    syncLock.current = true; restoreScrollAnchor(to, scrollAnchor(from))
    syncedScrollPositions.current.set(to, to.scrollTop)
    requestAnimationFrame(() => { syncLock.current = false })
  }
  const pages = pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []
  const pageRenderer = (mode: 'original' | 'translated') => pages.map((page) => <PdfPage key={`${mode}-${page}`} document={pdf!} pageNumber={page} scale={mode === 'original' ? sourceScale : translatedScale} fitWidth={mode === 'original' ? sourceFit : translationFormat === 'paper' && translatedFit} translationFormat={translationFormat} segments={allSegments.filter((segment) => segment.page === page)} translation={translationMap} mode={mode} highlighted={highlighted} figureSelect={figureSelect && mode === 'original'} sourceFigures={matchedFigures.filter((figure) => allSegments.find((segment) => segment.id === figure.captionAnchorId)?.page === page)} onHighlight={setHighlighted} onTag={tagSegment} onFindNotes={findSegmentNotes} onCaptureError={setError} focusedFigure={mode === 'original' && focusedFigure && focusedFigure.paperId === activeId && focusedFigure.page === page ? focusedFigure : undefined} onFigure={(targetPage, data, preview, rect, sourceFigure) => void saveFigure(targetPage, data, preview, rect, sourceFigure)} />)
  const comparisonPreference = useRef<'dual' | 'stacked' | undefined>(undefined)
  useEffect(() => {
    const dismissMenus = (event: PointerEvent) => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>('.reader-toolbar-menu[open]')) {
        if (!menu.contains(event.target as Node)) menu.open = false
      }
    }
    document.addEventListener('pointerdown', dismissMenus)
    return () => document.removeEventListener('pointerdown', dismissMenus)
  }, [])
  function closeToolbarMenu(element: HTMLElement) {
    const details = element.closest('details')
    if (details) { details.open = false; details.querySelector('summary')?.focus() }
  }
  function readLarger(kind: 'original' | 'translated') {
    queueReadingPosition()
    const next = kind === 'original' ? panePresets.original() : panePresets.translated()
    if (!activeId || (!comparisonReturn && !bothDocumentsOpen)) { applyLayout(next); return }
    // Temporary reading space must not replace the saved comparison arrangement.
    if (comparisonReturn?.paperId !== activeId) setComparisonReturn({ paperId: activeId, layout, sourceScale, translatedScale, sourceFit, translatedFit })
    layoutRef.current = next; setLayout(next)
  }
  function chooseComparison(element: HTMLElement, explicit?: 'dual' | 'stacked') {
    if (!explicit && comparisonReturn && comparisonReturn.paperId === activeId) {
      queueReadingPosition()
      setSourceScale(comparisonReturn.sourceScale); setTranslatedScale(comparisonReturn.translatedScale)
      setSourceFit(comparisonReturn.sourceFit); setTranslatedFit(comparisonReturn.translatedFit)
      layoutRef.current = comparisonReturn.layout; setLayout(comparisonReturn.layout); setComparisonReturn(undefined)
      closeToolbarMenu(element); return
    }
    if (explicit) comparisonPreference.current = explicit
    const choice = explicit ?? comparisonPreference.current ?? ((element.closest('.paper-workspace')?.clientWidth ?? window.innerWidth) < 960 ? 'stacked' : 'dual')
    queueReadingPosition(); applyLayout(choice === 'stacked' ? panePresets.stacked() : panePresets.dual())
    closeToolbarMenu(element)
  }
  function toolbarMenuKey(event: React.KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() }
  }
  const paneZoom = (mode: 'original' | 'translated') => {
    const value = mode === 'original' ? sourceScale : translatedScale
    const paperZoom = mode === 'original' || translationFormat === 'paper'
    const fitted = paperZoom && (mode === 'original' ? sourceFit : translatedFit)
    return <div className="zoom-control"><button onClick={() => changeZoom(mode, -1)} disabled={!fitted && value <= zoomLevels[0]} title="축소"><ZoomOut size={13} /></button><select aria-label={mode === 'original' ? '원문 배율' : paperZoom ? '번역 배율' : '번역 글자 크기'} value={fitted ? 'fit' : value} onChange={(event) => event.target.value === 'fit' ? fitPane(mode) : setPaneZoom(mode, Number(event.target.value))}>{paperZoom && <option value="fit">너비 맞춤</option>}{zoomLevels.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}</select><button onClick={() => changeZoom(mode, 1)} disabled={!fitted && value >= zoomLevels.at(-1)!} title="확대"><ZoomIn size={13} /></button></div>
  }

  return <section className="reader-pane paper-workspace">
    {recoveryNotice && <div className="paper-error" role="status">{recoveryNotice}<button aria-label="알림 닫기" onClick={() => setRecoveryNotice('')}><X size={13} /></button></div>}
    <div className="editor-tabs"><button className="icon-button" aria-label={sidebarOpen ? '라이브러리 접기' : '라이브러리 펼치기'} title={sidebarOpen ? '라이브러리 접기' : '라이브러리 펼치기'} onClick={onToggleSidebar}><PanelLeftClose size={18} /></button><div className="tab-strip">{tabs.map((id) => { const paper = library.find((item) => item.arxivId === id); return paper ? <div key={id} className={`paper-tab ${id === activeId ? 'active' : ''}`}>
      <button className="paper-tab-title" onClick={() => setActiveId(id)}><FileText size={13} /><span>{paper.title}</span></button>

      <i title="논문 닫기" onClick={(event) => { event.stopPropagation(); closeTab(id) }}><X size={12} /></i>
    </div> : null })}<button className="add-tab" onClick={() => setFinderOpen(true)}><Plus size={15} /></button></div></div>
    {activePaper && pdf ? <><div className="paper-toolbar reader-toolbar-compact">
      <div className="page-nav"><button aria-label="이전 페이지" disabled={pageNumber <= 1} onClick={() => scrollToPage(pageNumber - 1)}><ArrowLeft size={14} /></button><form className="page-jump" onSubmit={event => { event.preventDefault(); const target = Number(pageDraft); if (pageDraft?.trim() && Number.isInteger(target) && target > 0) scrollToPage(target); setPageDraft(undefined); (event.currentTarget.querySelector('input') as HTMLInputElement)?.blur() }}><input aria-label="페이지 번호" title="번호 입력 후 Enter로 이동" inputMode="numeric" value={pageDraft ?? String(pageNumber)} onFocus={event => event.currentTarget.select()} onChange={event => setPageDraft(event.target.value)} onBlur={() => setPageDraft(undefined)} onKeyDown={event => { if (event.key === 'Escape') { setPageDraft(undefined); event.currentTarget.blur() } }} /><span>/ {pdf.numPages}</span></form><button aria-label="다음 페이지" disabled={pageNumber >= pdf.numPages} onClick={() => scrollToPage(pageNumber + 1)}><ArrowRight size={14} /></button></div>
      <div className="reader-actions">
        <div className="document-mode" aria-label="읽기 보기">
          <button className={describeLayout(layout) === describeLayout(panePresets.original()) ? 'active' : ''} onClick={() => readLarger('original')} title="원문을 넓게 읽기">{bothDocumentsOpen ? '원문 크게' : '원문'}</button>
          <button className={describeLayout(layout) === describeLayout(panePresets.translated()) ? 'active' : ''} onClick={() => readLarger('translated')} title="번역을 넓게 읽기">{bothDocumentsOpen ? '번역 크게' : '한국어'}</button>
          <button className={bothDocumentsOpen ? 'active' : ''} title="원문과 한국어 비교. 좁은 화면에서는 위아래로 엽니다." onClick={event => chooseComparison(event.currentTarget)}>{comparisonReturn?.paperId === activeId ? '비교로 복귀' : bothDocumentsOpen && layout.type === 'split' ? layout.dir === 'row' ? '좌우 비교' : '상하 비교' : '비교'}</button>
          <details className="reader-toolbar-menu comparison-options" onKeyDown={toolbarMenuKey}>
            <summary aria-label="비교 배치 선택" title="비교 배치 선택">⌄</summary>
            <div className="reader-toolbar-popover">
              <button aria-pressed={bothDocumentsOpen && layout.type === 'split' && layout.dir === 'row'} onClick={event => chooseComparison(event.currentTarget, 'dual')}><Columns2 size={14} /> 좌우 비교</button>
              <button aria-pressed={bothDocumentsOpen && layout.type === 'split' && layout.dir === 'col'} onClick={event => chooseComparison(event.currentTarget, 'stacked')}><Rows2 size={14} /> 상하 비교</button>
              {bothDocumentsOpen && <><label><input type="checkbox" checked={syncScrollEnabled} onChange={event => setSyncScrollEnabled(event.target.checked)} /> 같은 위치로 스크롤</label><label><input type="checkbox" checked={syncZoomEnabled} onChange={event => { setSyncZoomEnabled(event.target.checked); if (event.target.checked) setTranslatedScale(sourceScale) }} /> 확대 배율 함께 변경</label></>}
            </div>
          </details>
        </div>
        <button className="reader-memo-action" title="현재 페이지를 출처로 메모를 남깁니다" onClick={() => void showBacklinks({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${pageNumber}`, type: 'page', page: pageNumber, label: `페이지${pageNumber}`, source: `Page ${pageNumber} of ${activePaper.title}` })}><BookOpen size={14} /> 페이지 메모</button>
        <div className="translation-control translation-compact">
          <button className={translating ? 'cancel-translation' : 'translate-action'} aria-label={translating ? '번역 중지' : `${translationScope === 'page' ? `현재 ${pageNumber}페이지` : '본문 전체'} AI 번역`} title={`${translationScope === 'page' ? `현재 ${translating ? translationTargetPage : pageNumber}페이지` : '본문 전체 · 참고문헌 제외'} · ${settings.translationModel ?? '번역 모델 설정 필요'}`} onClick={() => translating ? void cancelTranslation() : void startTranslation()} disabled={!translating && (!translationProvider?.available || !allSegments.length || scopedMissing === 0)}>
            {translating ? <><Square size={11} fill="currentColor" /> {translationProgress.completed}/{translationProgress.total} · 중지</> : !scopedSegments.length ? '원문 유지' : scopedMissing === 0 ? `${translationScope === 'page' ? `${pageNumber}쪽` : '본문'} 번역${scopedOriginalProse ? ' · 원문 포함' : '됨'}` : `${translationScope === 'page' ? `${pageNumber}쪽` : '본문'} AI 번역 · ${scopedMissing}문장`}
          </button>
          <details className="reader-toolbar-menu translation-options" onKeyDown={toolbarMenuKey}>
            <summary aria-label="번역 범위 및 모델 설정" title="번역 범위 및 모델 설정">⌄</summary>
            <div className="reader-toolbar-popover">
              <label><span>번역 범위</span><select className="translation-scope" aria-label="번역 범위" disabled={translating} value={translationScope} onChange={event => setTranslationScope(event.target.value as 'page' | 'all')}><option value="page">현재 {translating ? translationTargetPage : pageNumber}페이지</option><option value="all">본문 전체 · 참고문헌 제외</option></select></label>
              <label><span>번역 CLI</span><select aria-label="번역 CLI" value={settings.translationProvider} disabled={translating} onChange={event => { const provider = event.target.value as ProviderId; void updateSettings({ translationProvider: provider, translationModel: providers.find(item => item.id === provider)?.models[0]?.id }) }}>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · 설치 필요'}</option>)}</select></label>
              <label><span>모델</span><select aria-label="번역 모델" value={settings.translationModel} disabled={translating} onChange={event => void updateSettings({ translationModel: event.target.value })}>{translationProvider?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
              <label className="auto-translate-toggle"><input type="checkbox" checked={settings.autoTranslate} onChange={event => void updateSettings({ autoTranslate: event.target.checked })} /> 새 논문 자동 번역 · AI 사용</label>
              {hasCachedTranslation && <small>{translatedCount}문장 저장됨</small>}
              {hasCachedTranslation && <button disabled={translating} onClick={event => { closeToolbarMenu(event.currentTarget); void startTranslation(true) }}>본문 처음부터 다시 번역 · AI 사용</button>}
            </div>
          </details>
        </div>
        <details className="reader-toolbar-menu reader-more" onKeyDown={toolbarMenuKey}>
          <summary>더보기</summary>
          <div className="reader-toolbar-popover">
            <button onClick={event => { closeToolbarMenu(event.currentTarget); if (settings.libraryPath) setEditingPaper({ paper: activePaper, libraryPath: settings.libraryPath, document: pdf }) }}><FileText size={14} /> 논문 제목 편집</button>
            <button onClick={event => { closeToolbarMenu(event.currentTarget); queueReadingPosition(); openPane('map') }}><Sigma size={14} /> 구조 맵</button>
            <button onClick={event => { closeToolbarMenu(event.currentTarget); setFigureSelect(value => !value) }}><Image size={14} /> {figureSelect ? '피겨 캡처 끝내기' : '피겨 캡처'}</button>
            <button onClick={event => { closeToolbarMenu(event.currentTarget); onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${pageNumber}`, type: 'page', page: pageNumber, label: `페이지${pageNumber}`, source: `Page ${pageNumber} of ${activePaper.title}` }) }}><Tag size={14} /> 현재 페이지 근거로 담기</button>
          </div>
        </details>
      </div>
    </div>
    {figureSelect && <div className="reader-capture-status" role="status"><span>피겨를 클릭하거나 영역을 드래그하세요.</span><button onClick={() => setFigureSelect(false)}>캡처 끝내기</button></div>}

      {backlinkPanel && <section className="reader-evidence-backlinks" aria-label="PDF 근거 관련 노트"><header><div><BookOpen size={14} /><span><strong>{backlinkPanel.anchor.label} 관련 노트</strong><small>{backlinkPanel.anchor.paperTitle} · p.{backlinkPanel.anchor.page}</small></span></div><button aria-label="관련 노트 닫기" onClick={closeBacklinks}><X size={13} /></button></header>{backlinkPanel.anchor.type !== 'page' && backlinkPanel.anchor.source && <blockquote className="reader-capture-source">{backlinkPanel.anchor.source}</blockquote>}<form className="reader-capture" onSubmit={(event) => { event.preventDefault(); void captureAnchor() }}><input autoFocus aria-label="노트 메모" value={captureMemo} onChange={(event) => setCaptureMemo(event.target.value)} placeholder="한 줄 메모 (선택) · Enter로 논문 노트에 담기" /><div className="reader-capture-row"><input list="prism-concept-options" aria-label="정의하는 개념" value={captureConcept} onChange={(event) => setCaptureConcept(event.target.value)} placeholder="이 문장이 정의하는 개념 (선택)" /><datalist id="prism-concept-options">{conceptOptions.map((title) => <option key={title} value={title} />)}</datalist><button type="submit" aria-label="논문 노트에 담기" disabled={captureSaving}><Plus size={12} /> {captureSaving ? '저장 중…' : '노트에 담기'}</button></div></form>{captureStatus && <p className="reader-capture-status" role="status">{captureStatus}</p>}<div>{backlinkPanel.loading ? <p>관련 노트를 찾는 중…</p> : backlinkPanel.error ? <p>{backlinkPanel.error}</p> : backlinkPanel.items.length ? backlinkPanel.items.map((item) => <button key={item.nodeId} onClick={() => void window.prism.openKnowledgeNodeInNotes(item.nodeId)}><span><small>{item.nodeType} · {item.relativePath}</small><strong>{item.title}</strong><p>{item.excerpt}</p></span><ExternalLink size={13} /></button>) : <p>이 PDF 위치를 참조하는 지식 노트가 없습니다.</p>}</div></section>}

      {!loadStatus && allSegments.length === 0 && <p className="reader-notice" role="status">이 PDF에서 텍스트를 찾지 못했습니다. 원문 읽기와 피겨 캡처는 사용할 수 있습니다. 번역하려면 텍스트 인식(OCR)이 된 PDF를 가져와 주세요.</p>}

      {loadStatus?.phase === 'analyzing' && <div className="paper-analysis-status" role="status"><LoaderCircle className="spin" size={13} /><span>논문 구조와 참조 위치를 분석하고 있어요</span><div><i style={{ width: `${loadStatus.total ? loadStatus.completed / loadStatus.total * 100 : 0}%` }} /></div><strong>{loadStatus.completed} / {loadStatus.total}페이지</strong></div>}
      {error && <div className="paper-error">{error}<button onClick={() => setError('')}><X size={13} /></button></div>}
      <PaperPanes
        layout={layout} onLayout={applyLayout}
        views={{
          original: <div className="document-scroll" ref={sourceScrollRef} onScroll={(event) => readingScroll(event.currentTarget, translatedScrollRef.current)}>{pageRenderer('original')}</div>,
          map: <PaperMap paperId={activePaper?.arxivId} revision={allSegments.length} onOpenAnchor={openAnchorFromMap} />,
          translated: <div className="document-scroll translated-document" ref={translatedScrollRef} onScroll={(event) => readingScroll(event.currentTarget, sourceScrollRef.current)}>{pageRenderer('translated')}</div>,
        }}
        headers={{
          original: paneZoom('original'),
          translated: <><select aria-label="번역 보기 방식" className="translation-format" value={translationFormat} onChange={event => { const format = event.target.value as 'paper' | 'flow'; queueReadingPosition(); setTranslationFormat(format); localStorage.setItem('prism.translation-format', format) }}><option value="paper">지면 유지</option><option value="flow">텍스트 재배치</option></select><span className="pane-note" aria-live="polite" title={pageTranslationDetail}>{pageTranslationLabel}{pageTranslated > 0 && (preservedParagraphCount || protectedProseCount) ? ' · 원문 포함' : ''}</span>{paneZoom('translated')}</>,
        }}
      />
    </> : activePaper && error ? <div className="reader-empty library-empty" role="alert"><FileText size={32} strokeWidth={1.5} /><h1>논문을 열지 못했습니다</h1><p>{error}</p>{activePaper.externalAssets && <button disabled={recovering} onClick={() => void recoverMissingPaper()}><FolderOpen size={17} />{recovering ? '논문 확인 중…' : '이동한 폴더 다시 연결'}</button>}<button disabled={recovering} onClick={() => setReloadAttempt(value => value + 1)}>다시 시도</button></div> : <div className="reader-empty library-empty"><div className="paper-stack"><div /><div /><FileText size={32} strokeWidth={1.5} /></div><h1>{activePaper ? 'PDF를 불러오는 중…' : '읽고, 이해하고, 연결하세요'}</h1><p>{settings.libraryPath ? '가지고 있는 PDF를 가져오거나 새로운 논문을 찾아보세요.' : '논문과 노트를 보관할 폴더 하나면 시작할 수 있어요. AI 연결은 나중에 해도 됩니다.'}</p><button onClick={() => settings.libraryPath ? setFinderOpen(true) : void chooseFolder()}>{settings.libraryPath ? <Search size={17} /> : <FolderOpen size={17} />} {settings.libraryPath ? '첫 논문 가져오기' : '보관 폴더 선택하고 시작'}</button><small className="welcome-note">노트는 내 컴퓨터의 Markdown 파일로 저장됩니다. Obsidian에서도 열 수 있어요.</small></div>}
    {editingPaper && <PaperTitleDialog paper={editingPaper.paper} libraryPath={editingPaper.libraryPath} readPdfTitle={async () => { const metadata = await editingPaper.document.getMetadata(); const info = metadata.info as { Title?: unknown }; return typeof info?.Title === 'string' ? info.Title : '' }} onClose={() => setEditingPaper(undefined)} />}
    {finderOpen && <Finder library={library} settings={settings} onChooseFolder={() => void chooseFolder()} onOpen={openPaper} onDownloaded={(paper) => { setLibrary((current) => current.some((item) => item.arxivId === paper.arxivId) ? current : [paper, ...current]); openPaper(paper); setFinderOpen(false) }} onSettings={(patch) => void updateSettings(patch)} onClose={() => setFinderOpen(false)} />}
  </section>
}
