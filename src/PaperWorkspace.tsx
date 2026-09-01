import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Columns2, Download, ExternalLink, FileText,
  FolderOpen, Image, Languages, LoaderCircle, NotebookPen, PanelLeftClose, Plus, Search,
  Settings2, Tag, X,
} from 'lucide-react'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type PdfTextItem = { str: string; width: number; height: number; transform: number[]; hasEOL?: boolean; fontName?: string }
type ItemRect = { left: number; top: number; width: number; height: number }
type ViewMode = 'original' | 'translated' | 'dual'

function shortHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}

function isEquation(text: string) {
  const compact = text.replace(/\s/g, '')
  if (!compact) return false
  const symbols = (compact.match(/[=+\-×÷∑∫√∞≈≠≤≥<>^_{}()[\]\\|]/g) ?? []).length
  const letters = (compact.match(/[A-Za-z가-힣]/g) ?? []).length
  return (symbols >= 2 && symbols / compact.length > .12) || (letters === 0 && symbols > 0)
}

function segmentsFromItems(page: number, items: PdfTextItem[]): TranslationSegment[] {
  let combined = ''
  const ranges: Array<{ start: number; end: number; itemIndex: number }> = []
  const bodyHeights = items.filter((item) => item.str.trim().length > 20).map((item) => Math.max(1, Math.abs(item.height || item.transform[3]))).sort((a, b) => a - b)
  const bodyHeight = bodyHeights[Math.floor(bodyHeights.length / 2)] ?? 10
  let previous: PdfTextItem | undefined
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]; const value = item.str.trim()
    if (!value) continue
    if (previous && combined) {
      const previousY = previous.transform[5]; const nextY = item.transform[5]
      const height = Math.max(5, Math.abs(previous.height || previous.transform[3]))
      const nextHeight = Math.max(1, Math.abs(item.height || item.transform[3]))
      const verticalGap = Math.abs(previousY - nextY)
      const columnReset = nextY > previousY + height * 1.2
      const paragraphGap = previous.hasEOL && Math.abs(previousY - nextY) > height * 1.55
      const headingBoundary = /^(?:abstract|references|acknowledg(?:e)?ments?|appendix|figure\s+\d+|table\s+\d+|\d+(?:\.\d+)*\s+[A-Z])/i.test(value)
      const displayGap = verticalGap > height * 1.8
      const fontSizeBoundary = verticalGap > height * .75 && (nextHeight < height * .8 || nextHeight > height * 1.2)
      const joinHyphen = previous.str.trimEnd().endsWith('-') && !columnReset
      combined += joinHyphen ? '' : (columnReset || paragraphGap || headingBoundary || displayGap || fontSizeBoundary ? '\n\n' : ' ')
    }
    const start = combined.length; combined += value
    ranges.push({ start, end: combined.length, itemIndex }); previous = item
  }

  const parts: Array<{ text: string; start: number; end: number }> = []
  for (const paragraphMatch of combined.matchAll(/[^\n]+/g)) {
    const paragraph = paragraphMatch[0].trim()
    if (!paragraph) continue
    const paragraphStart = paragraphMatch.index + paragraphMatch[0].indexOf(paragraph)
    if (isEquation(paragraph) && paragraph.length < 260) {
      parts.push({ text: paragraph, start: paragraphStart, end: paragraphStart + paragraph.length }); continue
    }
    const sentences = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(paragraph)]
      : paragraph.split(/(?<=[.!?])\s+/).map((segment, index, all) => ({ segment, index: all.slice(0, index).join(' ').length + (index ? 1 : 0) }))
    for (const sentence of sentences) {
      const text = sentence.segment.trim()
      if (text.length < 2) continue
      const start = paragraphStart + sentence.index + sentence.segment.indexOf(text)
      parts.push({ text, start, end: start + text.length })
    }
  }
  const preliminary = parts.map((part, index) => {
    const matchedRanges = ranges.filter((range) => range.end > part.start && range.start < part.end)
    const itemSlices = matchedRanges.map((range) => ({
      itemIndex: range.itemIndex,
      start: Math.max(0, Math.min(1, (Math.max(part.start, range.start) - range.start) / Math.max(1, range.end - range.start))),
      end: Math.max(0, Math.min(1, (Math.min(part.end, range.end) - range.start) / Math.max(1, range.end - range.start))),
    })).filter((slice) => slice.end > slice.start)
    const matchedItems = itemSlices.map((slice) => items[slice.itemIndex])
    const heights = matchedItems.map((item) => Math.max(1, Math.abs(item.height || item.transform[3])))
    const averageHeight = heights.reduce((sum, value) => sum + value, 0) / Math.max(1, heights.length)
    const punctuation = (part.text.match(/[.!?;:]/g) ?? []).length
    const digits = (part.text.match(/\d/g) ?? []).length
    const numberedHeading = /^\d+(?:\.\d+)+\s+/.test(part.text) || (/^\d+\s+[A-Z]/.test(part.text) && averageHeight > bodyHeight * 1.08)
    const sectionHeading = numberedHeading || /^(?:abstract$|references$|acknowledg(?:e)?ments?$|appendix\b)/i.test(part.text)
    const caption = /^(?:figure|fig\.|table)\s*\d+/i.test(part.text)
    const shortFragments = matchedItems.filter((item) => item.str.trim().length < 32).length
    const lineYs = new Set(matchedItems.map((item) => Math.round(item.transform[5] / 3)))
    const likelyGraphicOrTable = !sectionHeading && !caption && punctuation === 0 && (
      (shortFragments >= 2 && shortFragments === matchedItems.length && lineYs.size <= 3)
      || (digits / Math.max(1, part.text.length) > .22 && matchedItems.length >= 4)
    )
    const kind: TranslationSegment['kind'] = isEquation(part.text) ? 'equation'
      : caption ? 'caption'
        : sectionHeading || (punctuation === 0 && part.text.length < 140 && averageHeight > bodyHeight * 1.08) ? 'heading'
          : likelyGraphicOrTable ? 'artifact' : 'text'
    return { id: `p${page}-s${index}-${shortHash(part.text)}`, page, source: part.text, kind, itemIndexes: itemSlices.map((slice) => slice.itemIndex), itemSlices }
  })
  const classified = preliminary.map((segment, index) => {
    if (segment.kind === 'heading' && preliminary[index + 1]?.kind === 'caption' && !/^(?:figure|table)/i.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    return segment
  })
  const merged: TranslationSegment[] = []
  for (let index = 0; index < classified.length; index += 1) {
    const current = classified[index]; const next = classified[index + 1]; const after = classified[index + 2]
    if (current.kind === 'equation' && next?.kind === 'artifact' && after?.kind === 'equation') {
      const source = `${current.source} ${next.source} ${after.source}`.replace(/\s+/g, ' ').trim()
      merged.push({ ...current, id: `p${page}-eq-${shortHash(source)}`, source, itemIndexes: [...(current.itemIndexes ?? []), ...(next.itemIndexes ?? []), ...(after.itemIndexes ?? [])], itemSlices: [...(current.itemSlices ?? []), ...(next.itemSlices ?? []), ...(after.itemSlices ?? [])] })
      index += 2; continue
    }
    merged.push(current)
  }
  return merged
}

function matchTokens(value: string) {
  return value.toLowerCase().replace(/\$[^$]*\$/g, ' math ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1)
}

function enrichWithLatex(segments: TranslationSegment[], structure: LatexStructure | null) {
  if (!structure?.blocks.length) return { segments: segments.map((segment) => ({ ...segment, sourceMode: 'pdf' as const })), matched: 0 }
  const prose = structure.blocks.filter((block) => ['paragraph', 'heading', 'caption'].includes(block.kind)).map((block) => ({ ...block, tokens: new Set(matchTokens(block.source)) }))
  let matched = 0
  const enriched = segments.map((segment) => {
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
    return { ...segment, sourceMode: 'latex' as const, blockId: best.block.id, sectionTitle: best.block.section, paragraphContext: best.block.source.slice(0, 12_000) }
  })
  return { segments: enriched, matched }
}

function Finder({ library, settings, onChooseFolder, onOpen, onDownloaded, onSettings, onClose }: {
  library: PaperRecord[]; settings: AppSettings; onChooseFolder: () => void; onOpen: (paper: PaperRecord) => void
  onDownloaded: (paper: PaperRecord) => void; onSettings: (patch: Partial<AppSettings>) => void; onClose: () => void
}) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<ArxivPaper[]>([])
  const [suggestions, setSuggestions] = useState<Array<{ title: string; authorsYear?: string }>>([])
  const [searching, setSearching] = useState(false); const [downloading, setDownloading] = useState<string>(); const [error, setError] = useState('')

  useEffect(() => {
    if (query.trim().length < 2) { setSuggestions([]); return }
    let disposed = false
    const timeout = window.setTimeout(() => window.prism.autocompletePapers(query).then((value) => { if (!disposed) setSuggestions(value) }), 280)
    return () => { disposed = true; window.clearTimeout(timeout) }
  }, [query])

  async function search(nextQuery = query) {
    if (!nextQuery.trim()) return
    setQuery(nextQuery); setSuggestions([]); setSearching(true); setError('')
    try { setResults(await window.prism.searchArxiv(nextQuery)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setSearching(false) }
  }
  async function download(paper: ArxivPaper) {
    if (!settings.libraryPath) { onChooseFolder(); return }
    setDownloading(paper.arxivId); setError('')
    try { onDownloaded(await window.prism.downloadPaper(paper)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setDownloading(undefined) }
  }

  return <div className="finder-backdrop"><section className="paper-finder">
    <header><div><span className="finder-icon">arXiv</span><div><h2>논문 찾기</h2><p>제목, 키워드, arXiv ID 또는 링크를 입력하세요.</p></div></div><button onClick={onClose}><X size={18} /></button></header>
    {!settings.libraryPath && <button className="folder-callout" onClick={onChooseFolder}><FolderOpen size={18} /><span><strong>라이브러리 폴더가 필요합니다</strong><small>PDF, 소스, 번역, Markdown 노트를 저장할 위치를 선택하세요.</small></span><ArrowRight size={16} /></button>}
    <div className="finder-search-wrap"><div className="finder-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder="예: attention is all you need, 1706.03762, arxiv.org/abs/…" /><button onClick={() => void search()} disabled={searching}>{searching ? <LoaderCircle className="spin" size={16} /> : '검색'}</button></div>
      {suggestions.length > 0 && <div className="search-suggestions">{suggestions.map((item) => <button key={`${item.title}-${item.authorsYear}`} onMouseDown={(event) => event.preventDefault()} onClick={() => void search(item.title)}><Search size={13} /><span><strong>{item.title}</strong><small>{item.authorsYear}</small></span></button>)}</div>}
    </div>
    <div className="finder-options"><label><input type="checkbox" checked={settings.autoTranslate} onChange={(event) => onSettings({ autoTranslate: event.target.checked })} /><span>저장 직후 설정된 모델로 한국어 번역 시작</span></label><small><Settings2 size={12} /> 번역 모델은 논문 화면에서 미리 설정할 수 있습니다.</small></div>
    {error && <div className="finder-error">{error}</div>}
    <div className="finder-content">{results.length > 0 ? <><p className="result-label">ARXIV RESULTS · 관련도와 인용 수를 함께 반영</p>{results.map((paper, index) => {
      const saved = library.find((item) => item.arxivId === paper.arxivId)
      return <article className="paper-result" key={paper.arxivId}><div><div className="paper-result-meta"><span>#{index + 1}</span><span>{paper.arxivId}</span><span>{paper.categories[0]}</span><span>{paper.published.slice(0, 10)}</span>{typeof paper.citationCount === 'number' && <span>인용 {paper.citationCount.toLocaleString()}</span>}</div><h3>{paper.title}</h3><p className="authors">{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ` 외 ${paper.authors.length - 4}명` : ''}</p><p className="abstract">{paper.summary}</p></div><div className="result-actions"><button onClick={() => void window.prism.openArxiv(paper.arxivId)} title="arXiv에서 보기"><ExternalLink size={14} /></button>{saved ? <button className="primary" onClick={() => { onOpen(saved); onClose() }}><Check size={14} /> 열기</button> : <button className="primary" onClick={() => void download(paper)} disabled={downloading === paper.arxivId}>{downloading === paper.arxivId ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} 저장</button>}</div></article>
    })}</> : library.length > 0 ? <><p className="result-label">MY LIBRARY · {library.length}</p>{library.map((paper) => <button className="library-result" key={paper.arxivId} onClick={() => { onOpen(paper); onClose() }}><FileText size={18} /><span><strong>{paper.title}</strong><small>{paper.arxivId} · {paper.authors.slice(0, 2).join(', ')}</small></span><ArrowRight size={15} /></button>)}</> : <div className="finder-empty"><BookOpen size={34} strokeWidth={1.4} /><h3>첫 논문을 찾아보세요</h3><p>저장하면 PDF와 가능한 경우 arXiv 원본 소스도 함께 내려받습니다.</p></div>}</div>
  </section></div>
}

function segmentRects(segment: TranslationSegment, itemRects: ItemRect[]) {
  if (segment.itemSlices?.length) return segment.itemSlices.map((slice) => {
    const rect = itemRects[slice.itemIndex]
    if (!rect) return undefined
    return { left: rect.left + rect.width * slice.start, top: rect.top, width: Math.max(2, rect.width * (slice.end - slice.start)), height: rect.height }
  }).filter(Boolean) as ItemRect[]
  return (segment.itemIndexes ?? []).map((index) => itemRects[index]).filter(Boolean)
}

function translationLines(segment: TranslationSegment, itemRects: ItemRect[]) {
  const rects = segmentRects(segment, itemRects).sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: ItemRect[][] = []
  for (const rect of rects) { const line = lines.find((candidate) => Math.abs(candidate[0].top - rect.top) < Math.max(4, rect.height * .55)); if (line) line.push(rect); else lines.push([rect]) }
  const boxes = lines.map((line) => ({ left: Math.min(...line.map((r) => r.left)), top: Math.min(...line.map((r) => r.top)), width: Math.max(...line.map((r) => r.left + r.width)) - Math.min(...line.map((r) => r.left)), height: Math.max(...line.map((r) => r.height)) }))
  const text = segment.translation ?? ''; let cursor = 0; const total = boxes.reduce((sum, box) => sum + box.width, 0)
  return boxes.map((box, index) => { const take = index === boxes.length - 1 ? text.length - cursor : Math.max(1, Math.round(text.length * box.width / Math.max(1, total))); const value = text.slice(cursor, cursor + take); cursor += take; return { box, text: value } })
}

function PdfPage({ document: pdfDocument, pageNumber, scale, segments, translation, mode, highlighted, figureSelect, onHighlight, onTag, onVisible, onFigure }: {
  document: PdfDocument; pageNumber: number; scale: number; segments: TranslationSegment[]; translation: Map<string, string>; mode: 'original' | 'translated'
  highlighted?: string; figureSelect: boolean; onHighlight: (id?: string) => void; onTag: (segment: TranslationSegment) => void; onVisible: (page: number) => void
  onFigure: (page: number, dataUrl: string, rect: { x: number; y: number; width: number; height: number }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const pageRef = useRef<HTMLDivElement>(null); const [itemRects, setItemRects] = useState<ItemRect[]>([])
  const [pageSize, setPageSize] = useState({ width: 612 * scale, height: 792 * scale })
  const [selection, setSelection] = useState<{ startX: number; startY: number; x: number; y: number }>()
  useEffect(() => {
    if (!canvasRef.current) return
    let cancelled = false; let renderTask: ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | undefined
    pdfDocument.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return
      const viewport = page.getViewport({ scale }); setPageSize({ width: viewport.width, height: viewport.height }); const ratio = window.devicePixelRatio || 1; const canvas = canvasRef.current; const context = canvas.getContext('2d')!
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); await renderTask.promise
      const content = await page.getTextContent(); const items = content.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]
      if (!cancelled) setItemRects(items.map((item) => { const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]); const height = Math.max(5, Math.hypot(item.transform[2], item.transform[3]) * scale); return { left: x, top: y - height, width: Math.max(2, item.width * scale), height } }))
    }).catch(() => undefined)
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdfDocument, pageNumber, scale])
  useEffect(() => { if (!pageRef.current) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && entry.intersectionRatio > .3) onVisible(pageNumber) }, { threshold: [.3, .6] }); observer.observe(pageRef.current); return () => observer.disconnect() }, [pageNumber, onVisible])

  function point(event: ReactPointerEvent) { const box = pageRef.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top } }
  function finishFigure(event: ReactPointerEvent) {
    if (!selection || !canvasRef.current) return
    const end = point(event); const x = Math.max(0, Math.min(selection.startX, end.x)); const y = Math.max(0, Math.min(selection.startY, end.y)); const width = Math.abs(end.x - selection.startX); const height = Math.abs(end.y - selection.startY); setSelection(undefined)
    if (width < 24 || height < 24) return
    const source = canvasRef.current; const ratioX = source.width / source.clientWidth; const ratioY = source.height / source.clientHeight
    const crop = window.document.createElement('canvas'); crop.width = Math.round(width * ratioX); crop.height = Math.round(height * ratioY); crop.getContext('2d')!.drawImage(source, x * ratioX, y * ratioY, width * ratioX, height * ratioY, 0, 0, crop.width, crop.height)
    onFigure(pageNumber, crop.toDataURL('image/png'), { x: x / source.clientWidth, y: y / source.clientHeight, width: width / source.clientWidth, height: height / source.clientHeight })
  }
  const translatedSegments = segments.map((segment) => ({ ...segment, translation: translation.get(segment.id) ?? segment.translation }))
  return <div className={`continuous-page ${mode}`} ref={pageRef} data-page={`${mode}-${pageNumber}`} style={pageSize}><canvas ref={canvasRef} />
    {mode === 'translated' && <div className="translated-text-layer">{translatedSegments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.translation).flatMap((segment) => translationLines(segment, itemRects).map((line, index) => <span key={`${segment.id}-${index}`} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} style={line.box} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)}>{line.text}</span>))}</div>}
    <div className="anchor-layer">{segments.filter((segment) => segment.kind !== 'artifact').flatMap((segment) => segmentRects(segment, itemRects).map((rect, rectIndex) => <span key={`${segment.id}-${rectIndex}`} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} style={rect} title="클릭하여 채팅에 태그" onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} />))}</div>
    {figureSelect && <div className="figure-capture-layer" onPointerDown={(event) => { const value = point(event); event.currentTarget.setPointerCapture(event.pointerId); setSelection({ startX: value.x, startY: value.y, x: value.x, y: value.y }) }} onPointerMove={(event) => { if (!selection) return; const value = point(event); setSelection((current) => current ? { ...current, x: value.x, y: value.y } : undefined) }} onPointerUp={finishFigure}>{selection && <span style={{ left: Math.min(selection.startX, selection.x), top: Math.min(selection.startY, selection.y), width: Math.abs(selection.x - selection.startX), height: Math.abs(selection.y - selection.startY) }} />}</div>}
    <span className="page-badge">{pageNumber}</span>
  </div>
}

export default function PaperWorkspace({ providers, onToggleSidebar, onTagAnchor }: { providers: ProviderInfo[]; sidebarOpen: boolean; onToggleSidebar: () => void; onTagAnchor: (anchor: ContextAnchor) => void }) {
  const [settings, setSettings] = useState<AppSettings>({ translationProvider: 'codex', translationModel: 'gpt-5.6-terra', autoTranslate: true })
  const [library, setLibrary] = useState<PaperRecord[]>([]); const [tabs, setTabs] = useState<string[]>([]); const [activeId, setActiveId] = useState<string>()
  const [finderOpen, setFinderOpen] = useState(false); const [panel, setPanel] = useState<'notes' | null>(null); const [pdf, setPdf] = useState<PdfDocument>()
  const [pageNumber, setPageNumber] = useState(1); const [scale, setScale] = useState(1); const [allSegments, setAllSegments] = useState<TranslationSegment[]>([])
  const [translation, setTranslation] = useState<TranslationSegment[]>([]); const [highlighted, setHighlighted] = useState<string>(); const [viewMode, setViewMode] = useState<ViewMode>('original')
  const [cacheExists, setCacheExists] = useState(false)
  const [sourceStatus, setSourceStatus] = useState<{ mode: 'latex' | 'pdf'; matched: number; total: number }>({ mode: 'pdf', matched: 0, total: 0 })
  const [translating, setTranslating] = useState(false); const [translationProgress, setTranslationProgress] = useState({ completed: 0, total: 0 }); const [figureSelect, setFigureSelect] = useState(false)
  const [note, setNote] = useState(''); const [noteLoaded, setNoteLoaded] = useState(false); const [error, setError] = useState('')
  const activeIdRef = useRef<string | undefined>(undefined); const autoStartedRef = useRef(new Set<string>()); const sourceScrollRef = useRef<HTMLDivElement>(null); const translatedScrollRef = useRef<HTMLDivElement>(null); const syncLock = useRef(false)
  const activePaper = library.find((paper) => paper.arxivId === activeId); const translationProvider = providers.find((provider) => provider.id === settings.translationProvider)
  const translationMap = useMemo(() => new Map(translation.map((segment) => [segment.id, segment.translation ?? ''])), [translation])
  const translatableSegments = allSegments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind))
  const translatedCount = translation.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.translation).length
  const hasCachedTranslation = cacheExists
  const translationPercent = translationProgress.total ? Math.round(translationProgress.completed / translationProgress.total * 100) : (hasCachedTranslation ? 100 : 0)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => {
    Promise.all([window.prism.getSettings(), window.prism.listLibrary()]).then(([saved, papers]) => { setSettings(saved); setLibrary(papers); if (papers[0]) { setTabs([papers[0].arxivId]); setActiveId(papers[0].arxivId) } else setFinderOpen(true) }).catch((reason) => setError(String(reason)))
    const offProgress = window.prism.onTranslationProgress((payload) => { const event = payload as { arxivId?: string; completedSegments?: number; totalSegments?: number; segments?: TranslationSegment[] }; if (event.arxivId === activeIdRef.current && event.segments) { setTranslation(event.segments); setTranslating(true); setTranslationProgress({ completed: event.completedSegments ?? 0, total: event.totalSegments ?? 0 }) } })
    const offDone = window.prism.onTranslationDone((payload) => { const event = payload as { arxivId?: string; segments?: TranslationSegment[] }; if (event.arxivId === activeIdRef.current) { if (event.segments) { setTranslation(event.segments); setCacheExists(true); const done = event.segments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.translation).length; setTranslationProgress({ completed: done, total: done }) } setTranslating(false) } })
    const offError = window.prism.onTranslationError((payload) => { const event = payload as { arxivId?: string; message?: string }; if (event.arxivId === activeIdRef.current) { setError(event.message ?? '번역에 실패했습니다.'); setTranslating(false) } })
    return () => { offProgress(); offDone(); offError() }
  }, [])

  useEffect(() => {
    if (!activePaper) { setPdf(undefined); return }
    let disposed = false; setPageNumber(1); setAllSegments([]); setTranslation([]); setCacheExists(false); setError(''); setViewMode('original')
    Promise.all([window.prism.readPaperPdf(activePaper.arxivId), window.prism.readLatexStructure(activePaper.arxivId)]).then(async ([data, latex]) => {
      const loaded = await pdfjs.getDocument({ data }).promise; if (disposed) return; setPdf(loaded)
      const segments: TranslationSegment[] = []
      for (let page = 1; page <= loaded.numPages; page += 1) { const pdfPage = await loaded.getPage(page); const text = await pdfPage.getTextContent(); segments.push(...segmentsFromItems(page, text.items.filter((item) => 'str' in item) as unknown as PdfTextItem[])) }
      if (disposed) return
      const source = enrichWithLatex(segments, latex); const translatable = source.segments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind)).length
      setSourceStatus({ mode: source.matched > translatable * .35 ? 'latex' : 'pdf', matched: source.matched, total: translatable })
      setAllSegments(source.segments); void window.prism.savePaperAnchors(activePaper.arxivId, source.segments)
      const cache = await window.prism.readTranslation(activePaper.arxivId); if (disposed) return
      if (cache?.segments.length) {
        const byId = new Map(cache.segments.map((segment) => [segment.id, segment.translation]))
        const bySource = new Map(cache.segments.filter((segment) => segment.translation).map((segment) => [segment.source.replace(/\s+/g, ' ').trim(), segment.translation]))
        const restored = source.segments.map((segment) => ({ ...segment, translation: byId.get(segment.id) ?? bySource.get(segment.source.replace(/\s+/g, ' ').trim()) })).filter((segment) => segment.translation)
        setCacheExists(true); setTranslation(restored); setTranslationProgress({ completed: restored.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind)).length, total: translatable }); setViewMode('dual')
      }
      else if (settings.autoTranslate && translationProvider?.available && !autoStartedRef.current.has(activePaper.arxivId)) {
        autoStartedRef.current.add(activePaper.arxivId); setTranslating(true); setTranslationProgress({ completed: 0, total: translatable }); setViewMode('dual')
        void window.prism.startTranslation(activePaper.arxivId, source.segments, { force: false }).catch((reason) => { setTranslating(false); setError(reason instanceof Error ? reason.message : String(reason)) })
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    setNoteLoaded(false); window.prism.readPaperNote(activePaper.arxivId).then((content) => { if (!disposed) { setNote(content); setNoteLoaded(true) } })
    return () => { disposed = true }
  }, [activePaper?.arxivId])

  useEffect(() => { if (!activePaper || !noteLoaded) return; const timeout = window.setTimeout(() => window.prism.savePaperNote(activePaper.arxivId, note).catch((reason) => setError(String(reason))), 500); return () => window.clearTimeout(timeout) }, [note, noteLoaded, activePaper?.arxivId])
  function openPaper(paper: PaperRecord) { setTabs((current) => current.includes(paper.arxivId) ? current : [...current, paper.arxivId]); setActiveId(paper.arxivId) }
  function closeTab(id: string) { setTabs((current) => { const next = current.filter((value) => value !== id); if (activeId === id) setActiveId(next.at(-1)); return next }) }
  async function chooseFolder() { const next = await window.prism.chooseWorkspace(); if (next) { setSettings(next); setLibrary(await window.prism.listLibrary()) } }
  async function updateSettings(patch: Partial<AppSettings>) { setSettings(await window.prism.updateSettings(patch)) }
  async function startTranslation() { if (!activePaper || !allSegments.length) return; const force = hasCachedTranslation; setTranslating(true); setTranslationProgress({ completed: 0, total: translatableSegments.length }); if (force) setTranslation([]); setViewMode('dual'); try { await window.prism.startTranslation(activePaper.arxivId, allSegments, { force }) } catch (reason) { setTranslating(false); setError(reason instanceof Error ? reason.message : String(reason)) } }
  function tagSegment(segment: TranslationSegment) { if (!activePaper) return; const sameKind = allSegments.filter((item) => item.kind === segment.kind); const number = sameKind.findIndex((item) => item.id === segment.id) + 1; onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: segment.kind === 'equation' ? 'equation' : 'sentence', page: segment.page, label: `${segment.kind === 'equation' ? '수식' : '문장'}${number}`, source: segment.source }) }
  async function saveFigure(page: number, dataUrl: string, rect: { x: number; y: number; width: number; height: number }) { if (!activePaper) return; const number = Date.now().toString(36); const figureId = `figure-p${page}-${number}`; try { const imagePath = await window.prism.savePaperFigure(activePaper.arxivId, figureId, dataUrl, { page, rect }); onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: figureId, type: 'figure', page, label: `피겨${page}-${number.slice(-3)}`, source: `Saved figure region from page ${page}. Image: ${imagePath}. Normalized bounds: ${JSON.stringify(rect)}` }); setFigureSelect(false) } catch (reason) { setError(String(reason)) } }
  function syncScroll(from: HTMLDivElement, to: HTMLDivElement | null) { if (!to || syncLock.current) return; syncLock.current = true; const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight); to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight); requestAnimationFrame(() => { syncLock.current = false }) }
  const pages = pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []
  const pageRenderer = (mode: 'original' | 'translated') => pages.map((page) => <PdfPage key={`${mode}-${page}`} document={pdf!} pageNumber={page} scale={scale} segments={allSegments.filter((segment) => segment.page === page)} translation={translationMap} mode={mode} highlighted={highlighted} figureSelect={figureSelect && mode === 'original'} onHighlight={setHighlighted} onTag={tagSegment} onVisible={setPageNumber} onFigure={(targetPage, data, rect) => void saveFigure(targetPage, data, rect)} />)

  return <section className="reader-pane paper-workspace">
    <div className="editor-tabs"><button className="icon-button" onClick={onToggleSidebar}><PanelLeftClose size={18} /></button><div className="tab-strip">{tabs.map((id) => { const paper = library.find((item) => item.arxivId === id); return paper ? <button key={id} className={`paper-tab ${id === activeId ? 'active' : ''}`} onClick={() => setActiveId(id)}><FileText size={13} /><span>{paper.title}</span><i onClick={(event) => { event.stopPropagation(); closeTab(id) }}><X size={12} /></i></button> : null })}<button className="add-tab" onClick={() => setFinderOpen(true)}><Plus size={15} /></button></div></div>
    {activePaper && pdf ? <><div className="paper-toolbar"><div className="page-nav"><button disabled={pageNumber <= 1} onClick={() => window.document.querySelector(`[data-page$="-${pageNumber - 1}"]`)?.scrollIntoView()}><ArrowLeft size={14} /></button><span>{pageNumber} / {pdf.numPages}</span><button disabled={pageNumber >= pdf.numPages} onClick={() => window.document.querySelector(`[data-page$="-${pageNumber + 1}"]`)?.scrollIntoView()}><ArrowRight size={14} /></button></div><div className="paper-title-mini"><strong>{activePaper.title}</strong><small>{activePaper.arxivId} · {sourceStatus.mode === 'latex' ? `LaTeX 우선 ${sourceStatus.matched}/${sourceStatus.total}` : 'PDF fallback'}</small></div><div className="reader-actions"><div className="document-mode"><button className={viewMode === 'original' ? 'active' : ''} onClick={() => setViewMode('original')}>원문</button><button className={viewMode === 'translated' ? 'active' : ''} onClick={() => setViewMode('translated')}>한국어</button><button className={viewMode === 'dual' ? 'active' : ''} onClick={() => setViewMode('dual')}><Columns2 size={13} /> 병기</button></div><select value={scale} onChange={(event) => setScale(Number(event.target.value))}><option value={.7}>70%</option><option value={.85}>85%</option><option value={1}>100%</option><option value={1.15}>115%</option></select><button className={figureSelect ? 'active' : ''} onClick={() => setFigureSelect((value) => !value)} title="PDF에서 영역을 드래그해 피겨로 저장하고 태그"><Image size={14} /> 피겨 태그</button><button onClick={() => onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${pageNumber}`, type: 'page', page: pageNumber, label: `페이지${pageNumber}`, source: `Page ${pageNumber} of ${activePaper.title}` })}><Tag size={14} /> 페이지</button><button className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><NotebookPen size={14} /> 노트</button></div></div>
      <div className="translation-control"><Languages size={14} /><label><span>번역 CLI</span><select value={settings.translationProvider} disabled={translating} onChange={(event) => { const provider = event.target.value as ProviderId; void updateSettings({ translationProvider: provider, translationModel: providers.find((item) => item.id === provider)?.models[0]?.id }) }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · 설치 필요'}</option>)}</select></label><label><span>모델</span><select value={settings.translationModel} disabled={translating} onChange={(event) => void updateSettings({ translationModel: event.target.value })}>{translationProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label className="auto-translate-toggle"><input type="checkbox" checked={settings.autoTranslate} onChange={(event) => void updateSettings({ autoTranslate: event.target.checked })} /> 자동 번역</label>{(translating || hasCachedTranslation) && <div className="translation-meter" title={`${translationProgress.completed || translatedCount} / ${translationProgress.total || translatableSegments.length}문장`}><span><i style={{ width: `${translationPercent}%` }} /></span><strong>{translating ? `${translationProgress.completed}/${translationProgress.total}문장 · ${translationPercent}%` : `${translatedCount}문장 번역됨`}</strong></div>}<button onClick={() => void startTranslation()} disabled={translating || !translationProvider?.available || !allSegments.length}>{translating ? <><LoaderCircle className="spin" size={13} /> 번역 중</> : hasCachedTranslation ? '재번역' : '번역 시작'}</button>{figureSelect && <strong className="capture-hint">PDF 위 피겨 영역을 드래그하세요</strong>}</div>
      {error && <div className="paper-error">{error}<button onClick={() => setError('')}><X size={13} /></button></div>}
      <div className={`paper-content document-layout ${panel ? 'with-sidecar' : ''} mode-${viewMode}`}>
        {(viewMode === 'original' || viewMode === 'dual') && <div className="document-column"><header><FileText size={13} /> 원문 PDF</header><div className="document-scroll" ref={sourceScrollRef} onScroll={(event) => viewMode === 'dual' && syncScroll(event.currentTarget, translatedScrollRef.current)}>{pageRenderer('original')}</div></div>}
        {(viewMode === 'translated' || viewMode === 'dual') && <div className="document-column translated-document"><header><Languages size={13} /> 한국어 문서 <span>{translating ? `번역 중 ${translationPercent}%` : hasCachedTranslation ? '저장됨' : '번역 대기'}</span></header><div className="document-scroll" ref={translatedScrollRef} onScroll={(event) => viewMode === 'dual' && syncScroll(event.currentTarget, sourceScrollRef.current)}>{pageRenderer('translated')}</div></div>}
        {panel === 'notes' && <aside className="note-panel"><header><div><NotebookPen size={16} /><span><strong>Paper note</strong><small>Markdown · 자동 저장</small></span></div><button onClick={() => setPanel(null)}><X size={16} /></button></header><textarea value={note} onChange={(event) => setNote(event.target.value)} spellCheck={false} /><footer><span>{activePaper.notePath}</span><span>Obsidian compatible</span></footer></aside>}
      </div>
    </> : <div className="reader-empty library-empty"><div className="paper-stack"><div /><div /><FileText size={32} strokeWidth={1.5} /></div><h1>{activePaper ? 'PDF를 불러오는 중…' : '논문 워크스페이스'}</h1><p>{settings.libraryPath ? 'arXiv에서 논문을 찾아 라이브러리에 추가하세요.' : '먼저 PDF와 노트를 저장할 라이브러리 폴더를 선택하세요.'}</p><button onClick={() => settings.libraryPath ? setFinderOpen(true) : void chooseFolder()}>{settings.libraryPath ? <Search size={17} /> : <FolderOpen size={17} />} {settings.libraryPath ? 'arXiv 논문 찾기' : '라이브러리 폴더 선택'}</button></div>}
    {finderOpen && <Finder library={library} settings={settings} onChooseFolder={() => void chooseFolder()} onOpen={openPaper} onDownloaded={(paper) => { setLibrary((current) => current.some((item) => item.arxivId === paper.arxivId) ? current : [paper, ...current]); openPaper(paper); setFinderOpen(false) }} onSettings={(patch) => void updateSettings(patch)} onClose={() => setFinderOpen(false)} />}
  </section>
}
