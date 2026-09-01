import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Columns2, Download, ExternalLink, FileText,
  FolderOpen, Languages, LoaderCircle, NotebookPen, PanelLeftClose, Plus, Search, Tag, X,
} from 'lucide-react'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type PdfTextItem = { str: string; width: number; height: number; transform: number[] }
type ItemRect = { left: number; top: number; width: number; height: number }

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
  items.forEach((item, itemIndex) => {
    const text = item.str.trim()
    if (!text) return
    if (combined && !combined.endsWith('-')) combined += ' '
    const start = combined.length
    combined += text
    ranges.push({ start, end: combined.length, itemIndex })
  })
  const sentenceParts = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(combined)].map((part) => ({ text: part.segment.trim(), start: part.index, end: part.index + part.segment.length }))
    : combined.split(/(?<=[.!?])\s+/).map((text, index, all) => ({ text: text.trim(), start: all.slice(0, index).join(' ').length + (index ? 1 : 0), end: all.slice(0, index + 1).join(' ').length }))
  return sentenceParts.filter((part) => part.text).map((part, index) => ({
    id: `p${page}-s${index}-${shortHash(part.text)}`,
    page,
    source: part.text,
    kind: isEquation(part.text) ? 'equation' : 'text',
    itemIndexes: ranges.filter((range) => range.end > part.start && range.start < part.end).map((range) => range.itemIndex),
  }))
}

function Finder({ library, settings, onChooseFolder, onOpen, onDownloaded, onClose }: {
  library: PaperRecord[]
  settings: AppSettings
  onChooseFolder: () => void
  onOpen: (paper: PaperRecord) => void
  onDownloaded: (paper: PaperRecord) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ArxivPaper[]>([])
  const [searching, setSearching] = useState(false)
  const [downloading, setDownloading] = useState<string>()
  const [error, setError] = useState('')

  async function search() {
    if (!query.trim()) return
    setSearching(true); setError('')
    try { setResults(await window.prism.searchArxiv(query)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSearching(false) }
  }

  async function download(paper: ArxivPaper) {
    if (!settings.libraryPath) { onChooseFolder(); return }
    setDownloading(paper.arxivId); setError('')
    try { onDownloaded(await window.prism.downloadPaper(paper)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setDownloading(undefined) }
  }

  return (
    <div className="finder-backdrop">
      <section className="paper-finder">
        <header><div><span className="finder-icon">arXiv</span><div><h2>논문 찾기</h2><p>제목, 키워드, arXiv ID 또는 링크를 입력하세요.</p></div></div><button onClick={onClose}><X size={18} /></button></header>
        {!settings.libraryPath && <button className="folder-callout" onClick={onChooseFolder}><FolderOpen size={18} /><span><strong>라이브러리 폴더가 필요합니다</strong><small>PDF, 번역, Markdown 노트를 저장할 위치를 선택하세요.</small></span><ArrowRight size={16} /></button>}
        <div className="finder-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder="예: attention is all you need, 1706.03762, arxiv.org/abs/…" /><button onClick={() => void search()} disabled={searching}>{searching ? <LoaderCircle className="spin" size={16} /> : '검색'}</button></div>
        {error && <div className="finder-error">{error}</div>}
        <div className="finder-content">
          {results.length > 0 ? <>
            <p className="result-label">ARXIV RESULTS · {results.length}</p>
            {results.map((paper) => {
              const saved = library.find((item) => item.arxivId === paper.arxivId)
              return <article className="paper-result" key={paper.arxivId}>
                <div><div className="paper-result-meta"><span>{paper.arxivId}</span><span>{paper.categories[0]}</span><span>{paper.published.slice(0, 10)}</span></div><h3>{paper.title}</h3><p className="authors">{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ` 외 ${paper.authors.length - 4}명` : ''}</p><p className="abstract">{paper.summary}</p></div>
                <div className="result-actions"><button onClick={() => void window.prism.openArxiv(paper.arxivId)} title="arXiv에서 보기"><ExternalLink size={14} /></button>{saved ? <button className="primary" onClick={() => { onOpen(saved); onClose() }}><Check size={14} /> 열기</button> : <button className="primary" onClick={() => void download(paper)} disabled={downloading === paper.arxivId}>{downloading === paper.arxivId ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} 저장</button>}</div>
              </article>
            })}
          </> : library.length > 0 ? <><p className="result-label">MY LIBRARY · {library.length}</p>{library.map((paper) => <button className="library-result" key={paper.arxivId} onClick={() => { onOpen(paper); onClose() }}><FileText size={18} /><span><strong>{paper.title}</strong><small>{paper.arxivId} · {paper.authors.slice(0, 2).join(', ')}</small></span><ArrowRight size={15} /></button>)}</> : <div className="finder-empty"><BookOpen size={34} strokeWidth={1.4} /><h3>첫 논문을 찾아보세요</h3><p>검색 결과에서 저장을 누르면 PDF가 자동으로 라이브러리에 추가됩니다.</p></div>}
        </div>
      </section>
    </div>
  )
}

export default function PaperWorkspace({ providers, onToggleSidebar, onTagAnchor }: { providers: ProviderInfo[]; sidebarOpen: boolean; onToggleSidebar: () => void; onTagAnchor: (anchor: ContextAnchor) => void }) {
  const [settings, setSettings] = useState<AppSettings>({ translationProvider: 'codex', translationModel: 'gpt-5.6-terra' })
  const [library, setLibrary] = useState<PaperRecord[]>([])
  const [tabs, setTabs] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [finderOpen, setFinderOpen] = useState(false)
  const [panel, setPanel] = useState<'translation' | 'notes' | null>('translation')
  const [pdf, setPdf] = useState<PdfDocument>()
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.1)
  const [allSegments, setAllSegments] = useState<TranslationSegment[]>([])
  const [translation, setTranslation] = useState<TranslationSegment[]>([])
  const [highlighted, setHighlighted] = useState<string>()
  const [itemRects, setItemRects] = useState<ItemRect[]>([])
  const [translating, setTranslating] = useState(false)
  const [translationProgress, setTranslationProgress] = useState('')
  const [note, setNote] = useState('')
  const [noteLoaded, setNoteLoaded] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeIdRef = useRef<string | undefined>(undefined)

  const activePaper = library.find((paper) => paper.arxivId === activeId)
  const pageSegments = useMemo(() => {
    const translated = new Map(translation.map((segment) => [segment.id, segment.translation]))
    return allSegments.filter((segment) => segment.page === pageNumber).map((segment) => ({ ...segment, translation: translated.get(segment.id) ?? segment.translation }))
  }, [allSegments, translation, pageNumber])
  const highlightedSegment = pageSegments.find((segment) => segment.id === highlighted)
  const translationProvider = providers.find((provider) => provider.id === settings.translationProvider)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    Promise.all([window.prism.getSettings(), window.prism.listLibrary()]).then(([savedSettings, papers]) => {
      setSettings(savedSettings); setLibrary(papers)
      if (papers[0]) { setTabs([papers[0].arxivId]); setActiveId(papers[0].arxivId) }
      else setFinderOpen(true)
    }).catch((reason) => setError(String(reason)))
    const offProgress = window.prism.onTranslationProgress((payload) => {
      const event = payload as { arxivId?: string; completed?: number; total?: number; segments?: TranslationSegment[] }
      if (event.arxivId === activeIdRef.current && event.segments) { setTranslation(event.segments); setTranslationProgress(`${event.completed}/${event.total}`) }
    })
    const offDone = window.prism.onTranslationDone((payload) => {
      const event = payload as { arxivId?: string; segments?: TranslationSegment[] }
      if (event.arxivId === activeIdRef.current) {
        if (event.segments) setTranslation(event.segments)
        setTranslating(false); setTranslationProgress('완료')
      }
    })
    const offError = window.prism.onTranslationError((payload) => {
      const event = payload as { arxivId?: string; message?: string }
      if (event.arxivId === activeIdRef.current) {
        setError(event.message ?? '번역에 실패했습니다.')
        setTranslating(false)
      }
    })
    return () => { offProgress(); offDone(); offError() }
  }, [])

  useEffect(() => {
    if (!activePaper) { setPdf(undefined); return }
    let disposed = false
    setPageNumber(1); setAllSegments([]); setTranslation([]); setError('')
    window.prism.readPaperPdf(activePaper.arxivId).then(async (data) => {
      const document = await pdfjs.getDocument({ data }).promise
      if (disposed) return
      setPdf(document)
      const segments: TranslationSegment[] = []
      for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
        const page = await document.getPage(pageIndex)
        const text = await page.getTextContent()
        segments.push(...segmentsFromItems(pageIndex, text.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]))
      }
      if (!disposed) {
        setAllSegments(segments)
        void window.prism.savePaperAnchors(activePaper.arxivId, segments)
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    window.prism.readTranslation(activePaper.arxivId).then((cache) => { if (!disposed && cache) setTranslation(cache.segments) })
    setNoteLoaded(false)
    window.prism.readPaperNote(activePaper.arxivId).then((content) => { if (!disposed) { setNote(content); setNoteLoaded(true) } })
    return () => { disposed = true }
  }, [activePaper?.arxivId])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | undefined
    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return
      const viewport = page.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')!
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await renderTask.promise
      const content = await page.getTextContent()
      const items = content.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]
      setItemRects(items.map((item) => {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
        const height = Math.max(5, Math.hypot(item.transform[2], item.transform[3]) * scale)
        return { left: x, top: y - height, width: Math.max(2, item.width * scale), height }
      }))
    }).catch((reason) => { if (!cancelled && reason?.name !== 'RenderingCancelledException') setError(String(reason)) })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, pageNumber, scale])

  useEffect(() => {
    if (!activePaper || !noteLoaded) return
    const timeout = window.setTimeout(() => { window.prism.savePaperNote(activePaper.arxivId, note).catch((reason) => setError(String(reason))) }, 500)
    return () => { window.clearTimeout(timeout) }
  }, [note, noteLoaded, activePaper?.arxivId])

  function openPaper(paper: PaperRecord) {
    setTabs((current) => current.includes(paper.arxivId) ? current : [...current, paper.arxivId])
    setActiveId(paper.arxivId)
  }
  function closeTab(arxivId: string) {
    setTabs((current) => {
      const next = current.filter((id) => id !== arxivId)
      if (activeId === arxivId) setActiveId(next.at(-1))
      return next
    })
  }
  async function chooseFolder() {
    const next = await window.prism.chooseWorkspace()
    if (next) { setSettings(next); setLibrary(await window.prism.listLibrary()) }
  }
  async function updateTranslationSetting(patch: Partial<AppSettings>) {
    const next = await window.prism.updateSettings(patch)
    setSettings(next)
  }
  async function startTranslation() {
    if (!activePaper || !allSegments.length) return
    setTranslating(true); setError(''); setTranslationProgress('준비 중…'); setPanel('translation')
    try { await window.prism.startTranslation(activePaper.arxivId, allSegments) }
    catch (reason) { setTranslating(false); setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  function tagSegment(segment: TranslationSegment) {
    if (!activePaper) return
    onTagAnchor({
      paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id,
      type: segment.kind === 'equation' ? 'equation' : 'sentence', page: segment.page,
      label: `${segment.kind === 'equation' ? '수식' : '문장'} p.${segment.page}`, source: segment.source,
    })
  }

  return <section className="reader-pane paper-workspace">
    <div className="editor-tabs">
      <button className="icon-button" onClick={onToggleSidebar}><PanelLeftClose size={18} /></button>
      <div className="tab-strip">{tabs.map((id) => { const paper = library.find((item) => item.arxivId === id); return paper ? <button key={id} className={`paper-tab ${id === activeId ? 'active' : ''}`} onClick={() => setActiveId(id)}><FileText size={13} /><span>{paper.title}</span><i onClick={(event) => { event.stopPropagation(); closeTab(id) }}><X size={12} /></i></button> : null })}<button className="add-tab" onClick={() => setFinderOpen(true)}><Plus size={15} /></button></div>
    </div>
    {activePaper && pdf ? <>
      <div className="paper-toolbar">
        <div className="page-nav"><button disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)}><ArrowLeft size={14} /></button><span>{pageNumber} / {pdf.numPages}</span><button disabled={pageNumber >= pdf.numPages} onClick={() => setPageNumber((page) => page + 1)}><ArrowRight size={14} /></button></div>
        <div className="paper-title-mini"><strong>{activePaper.title}</strong><small>{activePaper.arxivId}</small></div>
        <div className="reader-actions"><select value={scale} onChange={(event) => setScale(Number(event.target.value))}><option value={.85}>85%</option><option value={1}>100%</option><option value={1.1}>110%</option><option value={1.3}>130%</option><option value={1.5}>150%</option></select><button onClick={() => onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${pageNumber}`, type: 'page', page: pageNumber, label: `페이지 ${pageNumber}`, source: `Page ${pageNumber} of ${activePaper.title}` })}><Tag size={14} /> 페이지 태그</button><button className={panel === 'translation' ? 'active' : ''} onClick={() => setPanel(panel === 'translation' ? null : 'translation')}><Languages size={14} /> 번역</button><button className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><NotebookPen size={14} /> 노트</button></div>
      </div>
      <div className={`paper-content ${panel ? 'with-sidecar' : ''}`}>
        <div className="pdf-scroll"><div className="pdf-page" style={{ width: canvasRef.current?.style.width }}><canvas ref={canvasRef} />
          <div className="anchor-layer">{pageSegments.flatMap((segment) => (segment.itemIndexes ?? []).map((itemIndex) => { const rect = itemRects[itemIndex]; return rect ? <span key={`${segment.id}-${itemIndex}`} className={segment.id === highlighted ? 'highlighted' : ''} style={rect} title="클릭하여 채팅에 태그" onMouseEnter={() => setHighlighted(segment.id)} onMouseLeave={() => setHighlighted(undefined)} onClick={() => tagSegment(segment)} /> : null }))}</div>
          {highlightedSegment && <div className="anchor-chip">{highlightedSegment.kind === 'equation' ? '수식' : '문장'} · {highlightedSegment.id.split('-').slice(0, 2).join(':')}</div>}
        </div></div>
        {panel === 'translation' && <aside className="translation-panel">
          <header><div><Languages size={16} /><span><strong>한국어 번역</strong><small>{translation.length ? `${settings.translationProvider} · ${settings.translationModel}` : '아직 번역되지 않음'}</small></span></div><button onClick={() => setPanel(null)}><X size={16} /></button></header>
          <div className="translation-settings"><select value={settings.translationProvider} disabled={translating} onChange={(event) => { const provider = event.target.value as ProviderId; const model = providers.find((item) => item.id === provider)?.models[0]?.id; void updateTranslationSetting({ translationProvider: provider, translationModel: model }) }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · 설치 필요'}</option>)}</select><select value={settings.translationModel} disabled={translating} onChange={(event) => void updateTranslationSetting({ translationModel: event.target.value })}>{translationProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select><button onClick={() => void startTranslation()} disabled={translating || !translationProvider?.available || !allSegments.length}>{translating ? <><LoaderCircle className="spin" size={13} /> {translationProgress}</> : translation.length ? '누락분 번역' : '전체 번역'}</button></div>
          <div className="translation-copy">{pageSegments.map((segment) => <p key={segment.id} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} title="클릭하여 채팅에 태그" onMouseEnter={() => setHighlighted(segment.id)} onMouseLeave={() => setHighlighted(undefined)} onClick={() => tagSegment(segment)}><span>{segment.translation || (segment.kind === 'equation' ? segment.source : '번역 대기 중')}</span><small>{segment.id}</small></p>)}</div>
        </aside>}
        {panel === 'notes' && <aside className="note-panel"><header><div><NotebookPen size={16} /><span><strong>Paper note</strong><small>Markdown · 자동 저장</small></span></div><button onClick={() => setPanel(null)}><X size={16} /></button></header><textarea value={note} onChange={(event) => setNote(event.target.value)} spellCheck={false} /><footer><span>{activePaper.notePath}</span><span>Obsidian compatible</span></footer></aside>}
      </div>
    </> : <div className="reader-empty library-empty"><div className="paper-stack"><div /><div /><FileText size={32} strokeWidth={1.5} /></div><h1>{activePaper ? 'PDF를 불러오는 중…' : '논문 워크스페이스'}</h1><p>{settings.libraryPath ? 'arXiv에서 논문을 찾아 라이브러리에 추가하세요.' : '먼저 PDF와 노트를 저장할 라이브러리 폴더를 선택하세요.'}</p><button onClick={() => settings.libraryPath ? setFinderOpen(true) : void chooseFolder()}>{settings.libraryPath ? <Search size={17} /> : <FolderOpen size={17} />} {settings.libraryPath ? 'arXiv 논문 찾기' : '라이브러리 폴더 선택'}</button></div>}
    {error && <div className="workspace-error">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}
    {finderOpen && <Finder library={library} settings={settings} onChooseFolder={() => void chooseFolder()} onOpen={openPaper} onDownloaded={(paper) => { setLibrary((current) => current.some((item) => item.arxivId === paper.arxivId) ? current : [paper, ...current]); openPaper(paper); setFinderOpen(false) }} onClose={() => setFinderOpen(false)} />}
  </section>
}
