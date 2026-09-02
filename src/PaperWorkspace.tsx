import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Columns2, Download, ExternalLink, FileText,
  FolderOpen, Image, Languages, Link2, LoaderCircle, PanelLeftClose, Plus, Search,
  Settings2, Sigma, Square, Table2, Tag, Unlink2, X, ZoomIn, ZoomOut,
} from 'lucide-react'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type PdfTextItem = { str: string; width: number; height: number; transform: number[]; hasEOL?: boolean; fontName?: string }
type PdfTextStyle = { ascent?: number; descent?: number; vertical?: boolean }
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
  const proseWords = text.match(/[A-Za-z]{3,}/g)?.length ?? 0
  if (proseWords >= 4) return false
  const symbols = (compact.match(/[=+\-×÷∑∫√∞≈≠≤≥<>^_{}()[\]\\|\u2200-\u22ff︷︸]/g) ?? []).length
  const letters = (compact.match(/[A-Za-z가-힣]/g) ?? []).length
  return (symbols >= 2 && symbols / compact.length > .12) || (letters === 0 && symbols > 0)
}

function isPdfMetadataArtifact(text: string) {
  if (!text) return false
  if (text.includes('\u0000') || /<\/?latexit\b|sha1_base64\s*=|<\?xml\b/i.test(text)) return true
  const compact = text.replace(/\s/g, '')
  return compact.length > 120 && /^[A-Za-z0-9+/=]+$/.test(compact) && /[+/=]/.test(compact)
}

function displayTranslation(text: string) {
  return text.replace(/\u000f/g, 'ε').replace(/[\u0000-\u0008\u000b\u000c\u000e\u0010-\u001f\u007f]/g, '')
}

function segmentsFromItems(page: number, items: PdfTextItem[]): TranslationSegment[] {
  let combined = ''
  const ranges: Array<{ start: number; end: number; itemIndex: number }> = []
  const bodyHeights = items.filter((item) => item.str.trim().length > 20).map((item) => Math.max(1, Math.abs(item.height || item.transform[3]))).sort((a, b) => a - b)
  const bodyHeight = bodyHeights[Math.floor(bodyHeights.length / 2)] ?? 10
  let previous: PdfTextItem | undefined
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]; const value = item.str.trim()
    if (!value || isPdfMetadataArtifact(value)) continue
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
      if (joinHyphen && combined.endsWith('-')) { combined = combined.slice(0, -1); const lastRange = ranges.at(-1); if (lastRange) lastRange.end -= 1 }
      combined += joinHyphen ? '' : (columnReset || paragraphGap || headingBoundary || displayGap || fontSizeBoundary ? '\n\n' : ' ')
    }
    const start = combined.length; combined += value
    ranges.push({ start, end: combined.length, itemIndex }); previous = item
  }

  const parts: Array<{ text: string; start: number; end: number; blockId: string; paragraphContext: string }> = []
  let paragraphIndex = 0
  for (const paragraphMatch of combined.matchAll(/[^\n]+/g)) {
    const paragraph = paragraphMatch[0].trim()
    if (!paragraph) continue
    const blockId = `pdf-p${page}-b${paragraphIndex++}`
    const paragraphStart = paragraphMatch.index + paragraphMatch[0].indexOf(paragraph)
    if (isEquation(paragraph) && paragraph.length < 260) {
      parts.push({ text: paragraph, start: paragraphStart, end: paragraphStart + paragraph.length, blockId, paragraphContext: paragraph }); continue
    }
    const sentences = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(paragraph)]
      : paragraph.split(/(?<=[.!?])\s+/).map((segment, index, all) => ({ segment, index: all.slice(0, index).join(' ').length + (index ? 1 : 0) }))
    for (const sentence of sentences) {
      const text = sentence.segment.trim()
      if (text.length < 2) continue
      const start = paragraphStart + sentence.index + sentence.segment.indexOf(text)
      parts.push({ text, start, end: start + text.length, blockId, paragraphContext: paragraph })
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
    const caption = /^(?:figure|fig\.|table|algorithm)\s*\d+/i.test(part.text)
    const shortFragments = matchedItems.filter((item) => item.str.trim().length < 32).length
    const lineYs = new Set(matchedItems.map((item) => Math.round(item.transform[5] / 3)))
    const digitRatio = digits / Math.max(1, part.text.length)
    const numericLayout = digits >= 6 && digitRatio > .12 && matchedItems.length >= 5
    const likelyGraphicOrTable = !caption && (numericLayout || (!sectionHeading && (
      (shortFragments >= 2 && shortFragments === matchedItems.length && lineYs.size <= 3)
      || (digitRatio > .18 && matchedItems.length >= 4)
    )))
    const kind: TranslationSegment['kind'] = isEquation(part.text) ? 'equation'
      : caption ? 'caption'
        : likelyGraphicOrTable ? 'artifact'
          : sectionHeading || (punctuation === 0 && part.text.length < 140 && averageHeight > bodyHeight * 1.08) ? 'heading' : 'text'
    return { id: `p${page}-s${index}-${shortHash(part.text)}`, page, source: part.text, kind, blockId: part.blockId, paragraphContext: part.paragraphContext, itemIndexes: itemSlices.map((slice) => slice.itemIndex), itemSlices }
  })
  const shortLayoutFragments = preliminary.filter((segment) => ['text', 'heading'].includes(segment.kind) && segment.source.length < 38 && !/[.!?:]$/.test(segment.source)).length
  const denseLayoutPage = shortLayoutFragments >= 6 && shortLayoutFragments / Math.max(1, preliminary.length) > .18
  const classified = preliminary.map((segment, index) => {
    if (segment.kind === 'heading' && preliminary[index + 1]?.kind === 'caption' && !/^(?:figure|table|algorithm)/i.test(segment.source)) return { ...segment, kind: 'artifact' as const }
    const semanticHeading = /^(?:abstract|references|acknowledg(?:e)?ments?|appendix\b|\d+(?:\.\d+)*\s+)/i.test(segment.source)
    if (denseLayoutPage && ['text', 'heading'].includes(segment.kind) && !semanticHeading && segment.source.length < 38 && !/[.!?:]$/.test(segment.source)) return { ...segment, kind: 'artifact' as const }
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
    const figurePdf = await pdfjs.getDocument({ data }).promise; const page = await figurePdf.getPage(1); const base = page.getViewport({ scale: 1 }); const renderScale = Math.min(2, 560 / Math.max(1, base.width)); const viewport = page.getViewport({ scale: renderScale })
    const canvas = window.document.createElement('canvas'); canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height)); await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    return { ...asset, preview: canvas.toDataURL('image/jpeg', .86) }
  } catch { return asset }
}

function Finder({ library, settings, onChooseFolder, onOpen, onDownloaded, onSettings, onClose }: {
  library: PaperRecord[]; settings: AppSettings; onChooseFolder: () => void; onOpen: (paper: PaperRecord) => void
  onDownloaded: (paper: PaperRecord) => void; onSettings: (patch: Partial<AppSettings>) => void; onClose: () => void
}) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<ArxivPaper[]>([])
  const [suggestions, setSuggestions] = useState<Array<{ title: string; authorsYear?: string }>>([])
  const [searching, setSearching] = useState(false); const [downloading, setDownloading] = useState<string>(); const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    if (query.trim().length < 2) { setSuggestions([]); return }
    let disposed = false
    const timeout = window.setTimeout(() => window.prism.autocompletePapers(query).then((value) => { if (!disposed) setSuggestions(value) }).catch(() => { if (!disposed) setSuggestions([]) }), 280)
    return () => { disposed = true; window.clearTimeout(timeout) }
  }, [query])

  async function search(nextQuery = query) {
    if (!nextQuery.trim()) return
    setQuery(nextQuery); setSuggestions([]); setSearching(true); setHasSearched(true); setError('')
    try { setResults(await window.prism.searchArxiv(nextQuery)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setSearching(false) }
  }
  async function download(paper: ArxivPaper) {
    if (!settings.libraryPath) { onChooseFolder(); return }
    setDownloading(paper.arxivId); setError('')
    try { onDownloaded(await window.prism.downloadPaper(paper)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setDownloading(undefined) }
  }

  return <div className="finder-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="paper-finder" role="dialog" aria-modal="true" aria-labelledby="paper-finder-title">
    <header><div><span className="finder-icon">arXiv</span><div><h2 id="paper-finder-title">논문 찾기</h2><p>제목, 키워드, arXiv ID 또는 링크를 입력하세요.</p></div></div><button onClick={onClose} aria-label="논문 찾기 닫기"><X size={18} /></button></header>
    {!settings.libraryPath && <button className="folder-callout" onClick={onChooseFolder}><FolderOpen size={18} /><span><strong>라이브러리 폴더가 필요합니다</strong><small>PDF, 소스, 번역, Markdown 노트를 저장할 위치를 선택하세요.</small></span><ArrowRight size={16} /></button>}
    <div className="finder-search-wrap"><div className="finder-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder="예: attention is all you need, 1706.03762, arxiv.org/abs/…" aria-label="arXiv 논문 검색어" /><button onClick={() => void search()} disabled={searching || !query.trim()}>{searching ? <LoaderCircle className="spin" size={16} /> : '검색'}</button></div>
      {suggestions.length > 0 && <div className="search-suggestions">{suggestions.map((item) => <button key={`${item.title}-${item.authorsYear}`} onMouseDown={(event) => event.preventDefault()} onClick={() => void search(item.title)}><Search size={13} /><span><strong>{item.title}</strong><small>{item.authorsYear}</small></span></button>)}</div>}
    </div>
    <div className="finder-options"><label><input type="checkbox" checked={settings.autoTranslate} onChange={(event) => onSettings({ autoTranslate: event.target.checked })} /><span>저장 직후 설정된 모델로 한국어 번역 시작</span></label><small><Settings2 size={12} /> 번역 모델은 논문 화면에서 미리 설정할 수 있습니다.</small></div>
    {error && <div className="finder-error">{error}</div>}
    <div className="finder-content">{results.length > 0 ? <><p className="result-label">ARXIV RESULTS · 관련도와 인용 수를 함께 반영</p>{results.map((paper, index) => {
      const saved = library.find((item) => item.arxivId === paper.arxivId)
      return <article className="paper-result" key={paper.arxivId}><div><div className="paper-result-meta"><span>#{index + 1}</span><span>{paper.arxivId}</span><span>{paper.categories[0]}</span><span>{paper.published.slice(0, 10)}</span>{typeof paper.citationCount === 'number' && <span>인용 {paper.citationCount.toLocaleString()}</span>}</div><h3>{paper.title}</h3><p className="authors">{paper.authors.slice(0, 4).join(', ')}{paper.authors.length > 4 ? ` 외 ${paper.authors.length - 4}명` : ''}</p><p className="abstract">{paper.summary}</p></div><div className="result-actions"><button onClick={() => void window.prism.openArxiv(paper.arxivId)} title="arXiv에서 보기"><ExternalLink size={14} /></button>{saved ? <button className="primary" onClick={() => { onOpen(saved); onClose() }}><Check size={14} /> 열기</button> : <button className="primary" onClick={() => void download(paper)} disabled={downloading === paper.arxivId}>{downloading === paper.arxivId ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} 저장</button>}</div></article>
    })}</> : hasSearched && !searching ? <div className="finder-empty no-results"><Search size={32} strokeWidth={1.4} /><h3>검색 결과가 없습니다</h3><p>논문 제목을 줄이거나 arXiv ID를 직접 입력해 보세요.</p><button onClick={() => { setQuery(''); setHasSearched(false) }}>검색어 지우기</button></div> : library.length > 0 ? <><p className="result-label">MY LIBRARY · {library.length}</p>{library.map((paper) => <button className="library-result" key={paper.arxivId} onClick={() => { onOpen(paper); onClose() }}><FileText size={18} /><span><strong>{paper.title}</strong><small>{paper.arxivId} · {paper.authors.slice(0, 2).join(', ')}</small></span><ArrowRight size={15} /></button>)}</> : <div className="finder-empty"><BookOpen size={34} strokeWidth={1.4} /><h3>첫 논문을 찾아보세요</h3><p>저장하면 원문 PDF와 가능한 LaTeX 소스, 번역과 Markdown 노트를 한 폴더에서 관리합니다.</p><div className="finder-steps"><span><b>1</b> 논문 검색</span><span><b>2</b> 로컬 저장</span><span><b>3</b> 읽고 질문하기</span></div></div>}</div>
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

function translationBlocks(segments: TranslationSegment[], itemRects: ItemRect[], scale: number, pageWidth: number) {
  const protectedRects = segments.filter((segment) => ['equation', 'table', 'artifact'].includes(segment.kind)).flatMap((segment) => segmentRects(segment, itemRects))
  const overlapArea = (left: number, top: number, width: number, height: number) => protectedRects.reduce((sum, rect) => {
    const overlapWidth = Math.max(0, Math.min(left + width, rect.left + rect.width) - Math.max(left, rect.left))
    const overlapHeight = Math.max(0, Math.min(top + height, rect.top + rect.height) - Math.max(top, rect.top))
    return sum + overlapWidth * overlapHeight
  }, 0)
  const groups = new Map<string, TranslationSegment[]>()
  for (const segment of segments) {
    if (!['text', 'heading', 'caption'].includes(segment.kind) || !segment.translation) continue
    const key = segment.blockId ?? segment.id; const current = groups.get(key) ?? []; current.push(segment); groups.set(key, current)
  }
  return [...groups.entries()].flatMap(([key, blockSegments]) => {
    const rects = blockSegments.flatMap((segment) => segmentRects(segment, itemRects))
    if (!rects.length) return []
    const sourceLeft = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top))
    const sourceWidth = Math.max(...rects.map((rect) => rect.left + rect.width)) - sourceLeft; const sourceHeight = Math.max(...rects.map((rect) => rect.top + rect.height)) - top
    const pageGutter = 18 * scale; const minimumWidth = Math.min(180 * scale, pageWidth * .38)
    const width = Math.min(pageWidth - pageGutter * 2, Math.max(sourceWidth, minimumWidth))
    const possibleLefts = [sourceLeft, sourceLeft + sourceWidth - width, sourceLeft - (width - sourceWidth) / 2].map((value) => Math.max(pageGutter, Math.min(value, pageWidth - pageGutter - width)))
    const left = possibleLefts.sort((a, b) => overlapArea(a, top, width, sourceHeight) - overlapArea(b, top, width, sourceHeight))[0]
    const heights = rects.map((rect) => rect.height).sort((a, b) => a - b); const baseSize = (heights[Math.floor(heights.length / 2)] ?? 10) * .9
    const units = blockSegments.reduce((sum, segment) => sum + [...(segment.translation ?? '')].reduce((value, character) => value + (/[가-힣]/.test(character) ? 1 : .58), 0), 0)
    const fitSize = Math.sqrt(Math.max(1, width * sourceHeight) / Math.max(1, units * 1.38)); const fontSize = Math.max(6.4 * scale, Math.min(11.2 * scale, baseSize, fitSize * 1.18))
    const lines = Math.max(1, Math.ceil(units * fontSize / Math.max(1, width))); const height = Math.max(sourceHeight, lines * fontSize * 1.38)
    return [{ key, segments: blockSegments, box: { left, top, width, height }, fontSize }]
  })
}

function PdfPage({ document: pdfDocument, pageNumber, scale, segments, translation, mode, highlighted, figureSelect, sourceFigures, onHighlight, onTag, onFindNotes, onVisible, onFigure }: {
  document: PdfDocument; pageNumber: number; scale: number; segments: TranslationSegment[]; translation: Map<string, string>; mode: 'original' | 'translated'
  highlighted?: string; figureSelect: boolean; onHighlight: (id?: string) => void; onTag: (segment: TranslationSegment) => void; onFindNotes: (segment: TranslationSegment) => void; onVisible: (page: number) => void
  sourceFigures: Array<PaperFigureAsset & { captionAnchorId?: string; preview?: string }>
  onFigure: (page: number, dataUrl: string, preview: string, rect: { x: number; y: number; width: number; height: number }, sourceFigure?: PaperFigureAsset) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const preservedCanvasRef = useRef<HTMLCanvasElement>(null); const pageRef = useRef<HTMLDivElement>(null); const [itemRects, setItemRects] = useState<ItemRect[]>([])
  const [detectedFigureRects, setDetectedFigureRects] = useState<ItemRect[]>([])
  const [pageSize, setPageSize] = useState({ width: 612 * scale, height: 792 * scale })
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
    setRendered(false)
    let cancelled = false; let renderTask: ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | undefined
    pdfDocument.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return
      const viewport = page.getViewport({ scale }); setPageSize({ width: viewport.width, height: viewport.height }); const ratio = window.devicePixelRatio || 1; const canvas = canvasRef.current; const context = canvas.getContext('2d')!
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); await renderTask.promise
      if (!cancelled) setRendered(true)
      const content = await page.getTextContent(); const items = content.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]; const styles = content.styles as Record<string, PdfTextStyle>
      if (!cancelled) setItemRects(items.map((item) => {
        const tx = pdfjs.Util.transform(viewport.transform, item.transform); const height = Math.max(5, Math.hypot(tx[2], tx[3])); const style = item.fontName ? styles[item.fontName] : undefined
        const ascent = typeof style?.ascent === 'number' ? style.ascent : typeof style?.descent === 'number' ? 1 + style.descent : .8
        return { left: tx[4], top: tx[5] - height * ascent, width: Math.max(2, item.width * scale), height }
      }))
      try {
        const operators = await page.getOperatorList(); let transform = [1, 0, 0, 1, 0, 0]; const stack: number[][] = []; const figures: ItemRect[] = []
        for (let index = 0; index < operators.fnArray.length; index += 1) {
          const operation = operators.fnArray[index]; const args = operators.argsArray[index] as unknown[]
          if (operation === pdfjs.OPS.save) stack.push([...transform])
          else if (operation === pdfjs.OPS.restore) transform = stack.pop() ?? [1, 0, 0, 1, 0, 0]
          else if (operation === pdfjs.OPS.transform && args.length >= 6) transform = pdfjs.Util.transform(transform, args.slice(0, 6).map(Number))
          else if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(operation)) {
            const matrix = pdfjs.Util.transform(viewport.transform, transform); const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]])
            const left = Math.min(...corners.map((corner) => corner[0])); const top = Math.min(...corners.map((corner) => corner[1])); const width = Math.max(...corners.map((corner) => corner[0])) - left; const height = Math.max(...corners.map((corner) => corner[1])) - top
            const area = width * height; if (width > 72 * scale && height > 55 * scale && area > 7_500 * scale * scale && area < viewport.width * viewport.height * .78) figures.push({ left, top, width, height })
          }
        }
        if (!cancelled) setDetectedFigureRects(figures.filter((figure, index, all) => all.findIndex((candidate) => Math.abs(candidate.left - figure.left) < 3 && Math.abs(candidate.top - figure.top) < 3 && Math.abs(candidate.width - figure.width) < 3 && Math.abs(candidate.height - figure.height) < 3) === index))
      } catch { if (!cancelled) setDetectedFigureRects([]) }
    }).catch(() => undefined)
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdfDocument, pageNumber, scale, nearViewport])
  useEffect(() => { if (!pageRef.current) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && entry.intersectionRatio > .3) onVisible(pageNumber) }, { threshold: [.3, .6] }); observer.observe(pageRef.current); return () => observer.disconnect() }, [pageNumber, onVisible])
  useEffect(() => {
    const source = canvasRef.current; const preserved = preservedCanvasRef.current
    if (mode !== 'translated' || !rendered || !source || !preserved || !itemRects.length) return
    preserved.width = source.width; preserved.height = source.height; preserved.style.width = source.style.width; preserved.style.height = source.style.height
    const context = preserved.getContext('2d')!; context.clearRect(0, 0, preserved.width, preserved.height)
    const ratioX = source.width / Math.max(1, source.clientWidth); const ratioY = source.height / Math.max(1, source.clientHeight)
    const rects = segments.filter((segment) => ['equation', 'table', 'artifact'].includes(segment.kind)).flatMap((segment) => segmentRects(segment, itemRects))
    for (const rect of rects) {
      const padding = Math.max(1, 1.5 * scale); const left = Math.max(0, rect.left - padding); const top = Math.max(0, rect.top - padding); const width = Math.min(pageSize.width - left, rect.width + padding * 2); const height = Math.min(pageSize.height - top, rect.height + padding * 2)
      context.drawImage(source, left * ratioX, top * ratioY, width * ratioX, height * ratioY, left * ratioX, top * ratioY, width * ratioX, height * ratioY)
    }
  }, [mode, rendered, itemRects, segments, scale, pageSize.width, pageSize.height])

  function point(event: ReactPointerEvent) { const box = pageRef.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top } }
  function captureFigure(x: number, y: number, width: number, height: number, sourceFigure?: PaperFigureAsset & { preview?: string }) {
    if (!canvasRef.current) return
    const source = canvasRef.current; const ratioX = source.width / source.clientWidth; const ratioY = source.height / source.clientHeight
    const crop = window.document.createElement('canvas'); crop.width = Math.round(width * ratioX); crop.height = Math.round(height * ratioY); crop.getContext('2d')!.drawImage(source, x * ratioX, y * ratioY, width * ratioX, height * ratioY, 0, 0, crop.width, crop.height)
    const thumbnail = window.document.createElement('canvas'); const thumbnailScale = Math.min(1, 280 / crop.width, 210 / crop.height); thumbnail.width = Math.max(1, Math.round(crop.width * thumbnailScale)); thumbnail.height = Math.max(1, Math.round(crop.height * thumbnailScale)); thumbnail.getContext('2d')!.drawImage(crop, 0, 0, thumbnail.width, thumbnail.height)
    onFigure(pageNumber, crop.toDataURL('image/png'), sourceFigure?.preview ?? thumbnail.toDataURL('image/jpeg', .78), { x: x / source.clientWidth, y: y / source.clientHeight, width: width / source.clientWidth, height: height / source.clientHeight }, sourceFigure)
  }
  function finishFigure(event: ReactPointerEvent) {
    const current = selectionRef.current
    if (!current || !canvasRef.current) return
    const end = point(event); let x = Math.max(0, Math.min(current.startX, end.x)); let y = Math.max(0, Math.min(current.startY, end.y)); let width = Math.abs(end.x - current.startX); let height = Math.abs(end.y - current.startY); selectionRef.current = undefined; setSelection(undefined)
    if (width < 24 || height < 24) {
      width = Math.min(pageSize.width * .72, 520 * scale); height = Math.min(pageSize.height * .34, 320 * scale)
      x = Math.max(0, Math.min(pageSize.width - width, end.x - width / 2)); y = Math.max(0, Math.min(pageSize.height - height, end.y - height / 2))
    }
    captureFigure(x, y, width, height)
  }
  const translatedSegments = segments.map((segment) => ({ ...segment, translation: translation.get(segment.id) ?? segment.translation }))
  const translatedBlocks = translationBlocks(translatedSegments, itemRects, scale, pageSize.width)
  const structuredRegions = segments.filter((segment) => ['equation', 'table'].includes(segment.kind)).flatMap((segment) => {
    const rects = segmentRects(segment, itemRects); if (!rects.length) return []
    const left = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top)); const width = Math.max(...rects.map((rect) => rect.left + rect.width)) - left; const height = Math.max(...rects.map((rect) => rect.top + rect.height)) - top
    return [{ segment, rect: { left, top, width, height } }]
  })
  const sourceFigureRects = sourceFigures.flatMap((figure) => {
    const caption = segments.find((segment) => segment.id === figure.captionAnchorId)
    const rects = caption ? segmentRects(caption, itemRects) : []
    if (!rects.length) return []
    const captionLeft = Math.min(...rects.map((rect) => rect.left)); const captionTop = Math.min(...rects.map((rect) => rect.top)); const captionWidth = Math.max(...rects.map((rect) => rect.left + rect.width)) - captionLeft
    const fullWidth = captionWidth > pageSize.width * .58; const width = fullWidth ? pageSize.width * .82 : pageSize.width * .43
    const left = fullWidth ? pageSize.width * .09 : captionLeft < pageSize.width / 2 ? pageSize.width * .055 : pageSize.width * .515
    const height = Math.min(260 * scale, Math.max(90 * scale, captionTop - 24 * scale)); const top = Math.max(8 * scale, captionTop - height - 5 * scale)
    return [{ figure, rect: { left, top, width, height } }]
  })
  const automaticFigures: Array<{ key: string; figure?: PaperFigureAsset & { preview?: string }; rect: ItemRect }> = detectedFigureRects.length
    ? [...detectedFigureRects.map((rect, index) => ({ key: `pdf-${index}`, figure: sourceFigures[index], rect })), ...sourceFigureRects.slice(detectedFigureRects.length).map(({ figure, rect }) => ({ key: figure.id, figure, rect }))]
    : sourceFigureRects.map(({ figure, rect }) => ({ key: figure.id, figure, rect }))
  return <div className={`continuous-page ${mode} ${rendered ? 'rendered' : 'pending'}`} ref={pageRef} data-page={`${mode}-${pageNumber}`} style={pageSize}><canvas ref={canvasRef} />
    {!rendered && <div className="page-loading"><LoaderCircle className="spin" size={16} /><span>페이지 {pageNumber} 준비 중</span></div>}
    {mode === 'translated' && <div className="translated-text-layer">{translatedBlocks.map((block) => <div key={block.key} className={`translated-block ${block.segments[0].kind}`} style={{ ...block.box, fontSize: block.fontSize }}>{block.segments.map((segment) => <span key={segment.id} className={`translated-sentence ${segment.id === highlighted ? 'highlighted' : ''}`} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)}>{displayTranslation(segment.translation ?? '')}{' '}</span>)}</div>)}</div>}
    {mode === 'translated' && <canvas ref={preservedCanvasRef} className="preserved-structure-canvas" aria-hidden="true" />}
    {mode === 'original' && <div className="source-figure-layer">{automaticFigures.map(({ key, figure, rect }, index) => <button key={key} style={rect} title={`${figure?.caption || `PDF 피겨 ${index + 1}`} · 클릭하여 채팅에 태그`} onClick={() => captureFigure(rect.left, rect.top, rect.width, rect.height, figure)}><Image size={15} /><span>피겨 {figure ? figure.order + 1 : index + 1}</span></button>)}</div>}
    <div className="anchor-layer">{segments.filter((segment) => !['artifact', 'equation', 'table'].includes(segment.kind)).flatMap((segment) => segmentRects(segment, itemRects).map((rect, rectIndex) => <span key={`${segment.id}-${rectIndex}`} data-anchor={segment.id} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} style={rect} title="클릭: 채팅 태그 · 우클릭: 관련 노트" onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onContextMenu={(event) => { event.preventDefault(); onFindNotes(segment) }} />))}</div>
    <div className="structure-anchor-layer">{structuredRegions.map(({ segment, rect }) => <button key={segment.id} data-anchor={segment.id} className={`${segment.kind} ${segment.id === highlighted ? 'highlighted' : ''}`} style={rect} title={`${segment.kind === 'table' ? '표' : '수식'} · 클릭: 채팅 태그 · 우클릭: 관련 노트`} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onContextMenu={(event) => { event.preventDefault(); onFindNotes(segment) }}>{segment.kind === 'table' ? <Table2 size={11} /> : <Sigma size={11} />}</button>)}</div>
    {figureSelect && <div className="figure-capture-layer" onPointerDown={(event) => { const value = point(event); const next = { startX: value.x, startY: value.y, x: value.x, y: value.y }; event.currentTarget.setPointerCapture(event.pointerId); selectionRef.current = next; setSelection(next) }} onPointerMove={(event) => { const current = selectionRef.current; if (!current) return; const value = point(event); const next = { ...current, x: value.x, y: value.y }; selectionRef.current = next; setSelection(next) }} onPointerUp={finishFigure}>{selection && <span style={{ left: Math.min(selection.startX, selection.x), top: Math.min(selection.startY, selection.y), width: Math.abs(selection.x - selection.startX), height: Math.abs(selection.y - selection.startY) }} />}</div>}
    <span className="page-badge">{pageNumber}</span>
  </div>
}

export default function PaperWorkspace({ providers, command, onToggleSidebar, onTagAnchor, onAnchorCatalog, onWorkspaceState }: { providers: ProviderInfo[]; sidebarOpen: boolean; command?: WorkspaceCommand; onToggleSidebar: () => void; onTagAnchor: (anchor: ContextAnchor) => void; onAnchorCatalog: (anchors: ContextAnchor[]) => void; onWorkspaceState: (state: WorkspaceSnapshot) => void }) {
  const [settings, setSettings] = useState<AppSettings>({ translationProvider: 'codex', translationModel: 'gpt-5.6-terra', autoTranslate: true })
  const [library, setLibrary] = useState<PaperRecord[]>([]); const [tabs, setTabs] = useState<string[]>([]); const [activeId, setActiveId] = useState<string>()
  const [finderOpen, setFinderOpen] = useState(false); const [pdf, setPdf] = useState<PdfDocument>()
  const [pageNumber, setPageNumber] = useState(1); const [sourceScale, setSourceScale] = useState(1); const [translatedScale, setTranslatedScale] = useState(1); const [allSegments, setAllSegments] = useState<TranslationSegment[]>([])
  const [translation, setTranslation] = useState<TranslationSegment[]>([]); const [highlighted, setHighlighted] = useState<string>(); const [viewMode, setViewMode] = useState<ViewMode>('original')
  const [cacheExists, setCacheExists] = useState(false)
  const [backlinkPanel, setBacklinkPanel] = useState<{ anchor: ContextAnchor; items: EvidenceBacklink[]; loading: boolean; error?: string }>()
  const [sourceStatus, setSourceStatus] = useState<{ mode: 'latex' | 'pdf'; matched: number; total: number }>({ mode: 'pdf', matched: 0, total: 0 })
  const [translating, setTranslating] = useState(false); const [translationProgress, setTranslationProgress] = useState({ completed: 0, total: 0 }); const [figureSelect, setFigureSelect] = useState(false)
  const [figureAssets, setFigureAssets] = useState<Array<PaperFigureAsset & { preview?: string }>>([]); const [error, setError] = useState('')
  const [loadStatus, setLoadStatus] = useState<{ phase: 'pdf' | 'analyzing'; completed: number; total: number }>()
  const [syncScrollEnabled, setSyncScrollEnabled] = useState(true); const [syncZoomEnabled, setSyncZoomEnabled] = useState(true); const [dualRatio, setDualRatio] = useState(50); const [pendingAnchor, setPendingAnchor] = useState<ContextAnchor>()
  const activeIdRef = useRef<string | undefined>(undefined); const autoStartedRef = useRef(new Set<string>()); const sourceScrollRef = useRef<HTMLDivElement>(null); const translatedScrollRef = useRef<HTMLDivElement>(null); const documentLayoutRef = useRef<HTMLDivElement>(null); const syncLock = useRef(false)
  const zoomAnchorRef = useRef<{ page: number; progress: number } | undefined>(undefined)
  const activePaper = library.find((paper) => paper.arxivId === activeId); const translationProvider = providers.find((provider) => provider.id === settings.translationProvider)
  const translationMap = useMemo(() => new Map(translation.map((segment) => [segment.id, segment.translation ?? ''])), [translation])
  const translatableSegments = allSegments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind))
  const translatedCount = translation.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.translation).length
  const hasCachedTranslation = cacheExists
  const translationPercent = translationProgress.total ? Math.round(translationProgress.completed / translationProgress.total * 100) : (hasCachedTranslation ? 100 : 0)
  const zoomLevels = [.7, .85, 1, 1.15, 1.3, 1.5, 1.75, 2]
  const captionSegments = allSegments.filter((segment) => segment.kind === 'caption')
  const matchedFigures = figureAssets.map((figure, index) => ({ ...figure, captionAnchorId: captionSegments[index]?.id }))
  const anchorCatalog = useMemo(() => {
    if (!activePaper) return []
    let sentence = 0; let equation = 0; let table = 0
    const anchors = allSegments.flatMap((segment): ContextAnchor[] => {
      if (['text', 'heading', 'caption'].includes(segment.kind)) { sentence += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'sentence', page: segment.page, label: `문장${sentence}`, source: segment.source }] }
      if (segment.kind === 'equation') { equation += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'equation', page: segment.page, label: `수식${equation}`, source: segment.source }] }
      if (segment.kind === 'table') { table += 1; return [{ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: segment.id, type: 'table', page: segment.page, label: `표${table}`, source: segment.source }] }
      return []
    })
    const pages = pdf ? Array.from({ length: pdf.numPages }, (_, index): ContextAnchor => ({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${index + 1}`, type: 'page', page: index + 1, label: `페이지${index + 1}`, source: `Page ${index + 1} of ${activePaper.title}` })) : []
    return [...anchors, ...pages]
  }, [activePaper?.arxivId, allSegments, pdf])

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
    if (!pendingAnchor || pendingAnchor.paperId !== activeId || !allSegments.length) return
    setHighlighted(pendingAnchor.anchorId); setPageNumber(pendingAnchor.page)
    const timeout = window.setTimeout(() => {
      const target = window.document.querySelector(`[data-page="original-${pendingAnchor.page}"] [data-anchor="${CSS.escape(pendingAnchor.anchorId)}"]`) ?? window.document.querySelector(`[data-page="original-${pendingAnchor.page}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setPendingAnchor(undefined)
    }, 120)
    return () => window.clearTimeout(timeout)
  }, [pendingAnchor, activeId, allSegments])
  useEffect(() => {
    Promise.all([window.prism.getSettings(), window.prism.listLibrary()]).then(([saved, papers]) => { setSettings(saved); setLibrary(papers); if (papers[0]) { setTabs([papers[0].arxivId]); setActiveId(papers[0].arxivId) } else setFinderOpen(true) }).catch((reason) => setError(String(reason)))
    const offProgress = window.prism.onTranslationProgress((payload) => { const event = payload as { arxivId?: string; completedSegments?: number; totalSegments?: number; segments?: TranslationSegment[] }; if (event.arxivId === activeIdRef.current && event.segments) { setTranslation(event.segments); setCacheExists((event.completedSegments ?? 0) > 0); setTranslating(true); setTranslationProgress({ completed: event.completedSegments ?? 0, total: event.totalSegments ?? 0 }) } })
    const offDone = window.prism.onTranslationDone((payload) => { const event = payload as { arxivId?: string; segments?: TranslationSegment[] }; if (event.arxivId === activeIdRef.current) { if (event.segments) { setTranslation(event.segments); setCacheExists(true); const done = event.segments.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind) && segment.translation).length; setTranslationProgress({ completed: done, total: done }) } setTranslating(false) } })
    const offError = window.prism.onTranslationError((payload) => { const event = payload as { arxivId?: string; message?: string }; if (event.arxivId === activeIdRef.current) { setError(event.message ?? '번역에 실패했습니다.'); setTranslating(false) } })
    return () => { offProgress(); offDone(); offError() }
  }, [])

  useEffect(() => {
    if (!activePaper) { setPdf(undefined); return }
    let disposed = false; setPageNumber(1); setAllSegments([]); setTranslation([]); setFigureAssets([]); setCacheExists(false); setError(''); setViewMode('original'); setLoadStatus({ phase: 'pdf', completed: 0, total: 0 })
    Promise.all([window.prism.readPaperPdf(activePaper.arxivId), window.prism.readLatexStructure(activePaper.arxivId), window.prism.readPaperFigures(activePaper.arxivId)]).then(async ([data, latex, figures]) => {
      void Promise.all(figures.map(prepareFigureAsset)).then((preparedFigures) => { if (!disposed) setFigureAssets(preparedFigures) })
      const loaded = await pdfjs.getDocument({ data }).promise; if (disposed) return; setPdf(loaded); setLoadStatus({ phase: 'analyzing', completed: 0, total: loaded.numPages })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      const segments: TranslationSegment[] = []
      for (let page = 1; page <= loaded.numPages; page += 1) {
        const pdfPage = await loaded.getPage(page); const text = await pdfPage.getTextContent(); segments.push(...segmentsFromItems(page, text.items.filter((item) => 'str' in item) as unknown as PdfTextItem[]))
        if (!disposed) setLoadStatus({ phase: 'analyzing', completed: page, total: loaded.numPages })
        if (page % 2 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
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
      setLoadStatus(undefined)
    }).catch((reason) => { setLoadStatus(undefined); setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true }
  }, [activePaper?.arxivId])
  function openPaper(paper: PaperRecord) { setTabs((current) => current.includes(paper.arxivId) ? current : [...current, paper.arxivId]); setActiveId(paper.arxivId) }
  function closeTab(id: string) { setTabs((current) => { const next = current.filter((value) => value !== id); if (activeId === id) setActiveId(next.at(-1)); return next }) }
  async function chooseFolder() { const next = await window.prism.chooseWorkspace(); if (next) { const papers = await window.prism.listLibrary(); setSettings(next); setLibrary(papers); setTabs(papers[0] ? [papers[0].arxivId] : []); setActiveId(papers[0]?.arxivId); if (!papers.length) setFinderOpen(true) } }
  async function updateSettings(patch: Partial<AppSettings>) { setSettings(await window.prism.updateSettings(patch)) }
  async function startTranslation() { if (!activePaper || !allSegments.length) return; const force = hasCachedTranslation; setTranslating(true); setTranslationProgress({ completed: 0, total: translatableSegments.length }); if (force) setTranslation([]); setViewMode('dual'); try { await window.prism.startTranslation(activePaper.arxivId, allSegments, { force }) } catch (reason) { setTranslating(false); setError(reason instanceof Error ? reason.message : String(reason)) } }
  async function cancelTranslation() { if (!activePaper) return; try { await window.prism.cancelTranslation(activePaper.arxivId); setTranslating(false) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  function tagSegment(segment: TranslationSegment) { const anchor = anchorCatalog.find((item) => item.anchorId === segment.id); if (anchor) onTagAnchor(anchor) }
  async function showBacklinks(anchor: ContextAnchor) {
    setBacklinkPanel({ anchor, items: [], loading: true })
    try { setBacklinkPanel({ anchor, items: await window.prism.listEvidenceBacklinks(anchor), loading: false }) }
    catch (reason) { setBacklinkPanel({ anchor, items: [], loading: false, error: String(reason) }) }
  }
  function findSegmentNotes(segment: TranslationSegment) { const anchor = anchorCatalog.find((item) => item.anchorId === segment.id); if (anchor) void showBacklinks(anchor) }
  async function saveFigure(page: number, dataUrl: string, preview: string, rect: { x: number; y: number; width: number; height: number }, sourceFigure?: PaperFigureAsset) { if (!activePaper) return; const number = Date.now().toString(36); const figureId = sourceFigure ? `source-${sourceFigure.id}-${number}` : `figure-p${page}-${number}`; try { const imagePath = await window.prism.savePaperFigure(activePaper.arxivId, figureId, dataUrl, { page, rect, sourceFigureId: sourceFigure?.id, sourcePath: sourceFigure?.sourcePath, caption: sourceFigure?.caption }); onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: figureId, type: 'figure', page, label: `피겨${page}-${sourceFigure ? sourceFigure.order + 1 : number.slice(-3)}`, source: `${sourceFigure ? `Matched LaTeX figure ${sourceFigure.order + 1}. Caption: ${sourceFigure.caption ?? 'unknown'}. Source asset: ${sourceFigure.sourcePath ?? 'unavailable'}. ` : ''}Saved figure image: ${imagePath}. Normalized bounds: ${JSON.stringify(rect)}`, preview }); if (!sourceFigure) setFigureSelect(false) } catch (reason) { setError(String(reason)) } }
  function scrollAnchor(pane: HTMLDivElement | null) {
    if (!pane) return { page: pageNumber, progress: 0 }
    const pages = [...pane.querySelectorAll<HTMLElement>('.continuous-page')]
    const marker = pane.scrollTop + pane.clientHeight * .28
    const current = pages.find((page) => page.offsetTop + page.offsetHeight >= marker) ?? pages.at(-1)
    if (!current) return { page: pageNumber, progress: 0 }
    const page = Number(current?.dataset.page?.split('-').at(-1)) || pageNumber
    const next = pages[pages.indexOf(current) + 1]
    const span = Math.max(1, (next?.offsetTop ?? (current.offsetTop + current.offsetHeight + 18)) - current.offsetTop)
    return { page, progress: Math.max(0, Math.min(1, (marker - current.offsetTop) / span)) }
  }
  function restoreScrollAnchor(pane: HTMLDivElement | null, anchor: { page: number; progress: number }) {
    if (!pane) return
    const current = pane.querySelector<HTMLElement>(`.continuous-page[data-page$="-${anchor.page}"]`)
    if (!current) return
    const next = current.nextElementSibling as HTMLElement | null
    const span = Math.max(1, (next?.offsetTop ?? (current.offsetTop + current.offsetHeight + 18)) - current.offsetTop)
    pane.scrollTop = Math.max(0, current.offsetTop + span * anchor.progress - pane.clientHeight * .28)
  }
  function scrollToPage(targetPage: number) {
    for (const pane of [sourceScrollRef.current, translatedScrollRef.current]) {
      const target = pane?.querySelector<HTMLElement>(`.continuous-page[data-page$="-${targetPage}"]`)
      if (pane && target) pane.scrollTo({ top: Math.max(0, target.offsetTop - 18), behavior: 'smooth' })
    }
  }
  function setPaneZoom(mode: 'original' | 'translated', value: number) {
    const activePane = mode === 'original' ? sourceScrollRef.current : translatedScrollRef.current
    zoomAnchorRef.current = scrollAnchor(activePane)
    if (syncZoomEnabled) { setSourceScale(value); setTranslatedScale(value) } else if (mode === 'original') setSourceScale(value); else setTranslatedScale(value)
  }
  function changeZoom(mode: 'original' | 'translated', direction: -1 | 1) { const current = mode === 'original' ? sourceScale : translatedScale; const target = direction > 0 ? zoomLevels.find((value) => value > current + .001) : [...zoomLevels].reverse().find((value) => value < current - .001); if (target) setPaneZoom(mode, target) }
  useEffect(() => {
    const pairs: Array<[HTMLDivElement | null, 'original' | 'translated']> = [[sourceScrollRef.current, 'original'], [translatedScrollRef.current, 'translated']]
    const cleanups = pairs.flatMap(([pane, mode]) => { if (!pane) return []; const zoomWheel = (event: WheelEvent) => { if (!event.ctrlKey) return; event.preventDefault(); changeZoom(mode, event.deltaY < 0 ? 1 : -1) }; pane.addEventListener('wheel', zoomWheel, { passive: false }); return [() => pane.removeEventListener('wheel', zoomWheel)] })
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [sourceScale, translatedScale, syncZoomEnabled, activePaper?.arxivId, pdf, viewMode])
  useEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor) return
    const restore = () => { restoreScrollAnchor(sourceScrollRef.current, anchor); restoreScrollAnchor(translatedScrollRef.current, anchor) }
    const frame = requestAnimationFrame(restore); const timeout = window.setTimeout(restore, 180)
    zoomAnchorRef.current = undefined
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timeout) }
  }, [sourceScale, translatedScale])
  function syncScroll(from: HTMLDivElement, to: HTMLDivElement | null) {
    if (!to || syncLock.current) return
    syncLock.current = true; restoreScrollAnchor(to, scrollAnchor(from))
    requestAnimationFrame(() => { syncLock.current = false })
  }
  function startResize(event: ReactPointerEvent<HTMLDivElement>) { const layout = documentLayoutRef.current; if (!layout) return; event.currentTarget.setPointerCapture(event.pointerId); const move = (moveEvent: PointerEvent) => { const rect = layout.getBoundingClientRect(); setDualRatio(Math.max(25, Math.min(75, (moveEvent.clientX - rect.left) / rect.width * 100))) }; const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop) }
  const pages = pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []
  const pageRenderer = (mode: 'original' | 'translated') => pages.map((page) => <PdfPage key={`${mode}-${page}`} document={pdf!} pageNumber={page} scale={mode === 'original' ? sourceScale : translatedScale} segments={allSegments.filter((segment) => segment.page === page)} translation={translationMap} mode={mode} highlighted={highlighted} figureSelect={figureSelect && mode === 'original'} sourceFigures={matchedFigures.filter((figure) => allSegments.find((segment) => segment.id === figure.captionAnchorId)?.page === page)} onHighlight={setHighlighted} onTag={tagSegment} onFindNotes={findSegmentNotes} onVisible={setPageNumber} onFigure={(targetPage, data, preview, rect, sourceFigure) => void saveFigure(targetPage, data, preview, rect, sourceFigure)} />)
  const paneZoom = (mode: 'original' | 'translated') => { const value = mode === 'original' ? sourceScale : translatedScale; return <div className="zoom-control"><button onClick={() => changeZoom(mode, -1)} disabled={value <= zoomLevels[0]} title="축소"><ZoomOut size={13} /></button><select value={value} onChange={(event) => setPaneZoom(mode, Number(event.target.value))}>{zoomLevels.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}</select><button onClick={() => changeZoom(mode, 1)} disabled={value >= zoomLevels.at(-1)!} title="확대"><ZoomIn size={13} /></button></div> }

  return <section className="reader-pane paper-workspace">
    <div className="editor-tabs"><button className="icon-button" onClick={onToggleSidebar}><PanelLeftClose size={18} /></button><div className="tab-strip">{tabs.map((id) => { const paper = library.find((item) => item.arxivId === id); return paper ? <button key={id} className={`paper-tab ${id === activeId ? 'active' : ''}`} onClick={() => setActiveId(id)}><FileText size={13} /><span>{paper.title}</span><i onClick={(event) => { event.stopPropagation(); closeTab(id) }}><X size={12} /></i></button> : null })}<button className="add-tab" onClick={() => setFinderOpen(true)}><Plus size={15} /></button></div></div>
    {activePaper && pdf ? <><div className="paper-toolbar"><div className="page-nav"><button disabled={pageNumber <= 1} onClick={() => scrollToPage(pageNumber - 1)}><ArrowLeft size={14} /></button><span>{pageNumber} / {pdf.numPages}</span><button disabled={pageNumber >= pdf.numPages} onClick={() => scrollToPage(pageNumber + 1)}><ArrowRight size={14} /></button></div><div className="paper-title-mini"><strong>{activePaper.title}</strong><small>{activePaper.arxivId} · {sourceStatus.mode === 'latex' ? `LaTeX 우선 ${sourceStatus.matched}/${sourceStatus.total}` : 'PDF fallback'} · 소스 피겨 {figureAssets.length}</small></div><div className="reader-actions"><div className="document-mode"><button className={viewMode === 'original' ? 'active' : ''} onClick={() => setViewMode('original')}>원문</button><button className={viewMode === 'translated' ? 'active' : ''} onClick={() => setViewMode('translated')}>한국어</button><button className={viewMode === 'dual' ? 'active' : ''} onClick={() => setViewMode('dual')}><Columns2 size={13} /> 병기</button></div>{viewMode === 'dual' && <><button className={syncScrollEnabled ? 'active' : ''} onClick={() => setSyncScrollEnabled((value) => !value)} title="두 문서 스크롤 동기화">{syncScrollEnabled ? <Link2 size={13} /> : <Unlink2 size={13} />} 스크롤</button><button className={syncZoomEnabled ? 'active' : ''} onClick={() => { setSyncZoomEnabled((value) => !value); if (!syncZoomEnabled) setTranslatedScale(sourceScale) }} title="두 문서 확대 배율 동기화">{syncZoomEnabled ? <Link2 size={13} /> : <Unlink2 size={13} />} 확대</button></>}<button className={figureSelect ? 'active' : ''} onClick={() => setFigureSelect((value) => !value)} title="자동 인식되지 않은 피겨 영역을 클릭하거나 드래그해 캡처"><Image size={14} /> 피겨 캡처</button><button onClick={() => onTagAnchor({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${pageNumber}`, type: 'page', page: pageNumber, label: `페이지${pageNumber}`, source: `Page ${pageNumber} of ${activePaper.title}` })}><Tag size={14} /> 페이지</button><button title="현재 PDF 페이지를 참조하는 지식 노트" onClick={() => void showBacklinks({ paperId: activePaper.arxivId, paperTitle: activePaper.title, anchorId: `p${pageNumber}`, type: 'page', page: pageNumber, label: `페이지${pageNumber}`, source: `Page ${pageNumber} of ${activePaper.title}` })}><BookOpen size={14} /> 관련 노트</button></div></div>
      {backlinkPanel && <section className="reader-evidence-backlinks" aria-label="PDF 근거 관련 노트"><header><div><BookOpen size={14} /><span><strong>{backlinkPanel.anchor.label} 관련 노트</strong><small>{backlinkPanel.anchor.paperTitle} · p.{backlinkPanel.anchor.page}</small></span></div><button aria-label="관련 노트 닫기" onClick={() => setBacklinkPanel(undefined)}><X size={13} /></button></header><div>{backlinkPanel.loading ? <p>관련 노트를 찾는 중…</p> : backlinkPanel.error ? <p>{backlinkPanel.error}</p> : backlinkPanel.items.length ? backlinkPanel.items.map((item) => <button key={item.nodeId} onClick={() => void window.prism.openKnowledgeNodeInNotes(item.nodeId)}><span><small>{item.nodeType} · {item.relativePath}</small><strong>{item.title}</strong><p>{item.excerpt}</p></span><ExternalLink size={13} /></button>) : <p>이 PDF 위치를 참조하는 지식 노트가 없습니다.</p>}</div></section>}
      <div className="translation-control"><Languages size={14} /><label><span>번역 CLI</span><select value={settings.translationProvider} disabled={translating} onChange={(event) => { const provider = event.target.value as ProviderId; void updateSettings({ translationProvider: provider, translationModel: providers.find((item) => item.id === provider)?.models[0]?.id }) }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · 설치 필요'}</option>)}</select></label><label><span>모델</span><select value={settings.translationModel} disabled={translating} onChange={(event) => void updateSettings({ translationModel: event.target.value })}>{translationProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label className="auto-translate-toggle"><input type="checkbox" checked={settings.autoTranslate} onChange={(event) => void updateSettings({ autoTranslate: event.target.checked })} /> 자동 번역</label>{(translating || hasCachedTranslation) && <div className="translation-meter" title={`${translationProgress.completed || translatedCount} / ${translationProgress.total || translatableSegments.length}문장`}><span><i style={{ width: `${translationPercent}%` }} /></span><strong>{translating ? `${translationProgress.completed}/${translationProgress.total}문장 · ${translationPercent}%` : `${translatedCount}문장 번역됨`}</strong></div>}<button className={translating ? 'cancel-translation' : ''} onClick={() => translating ? void cancelTranslation() : void startTranslation()} disabled={!translating && (!translationProvider?.available || !allSegments.length)}>{translating ? <><Square size={11} fill="currentColor" /> 번역 중지</> : hasCachedTranslation ? '재번역' : '번역 시작'}</button>{figureSelect && <strong className="capture-hint">피겨를 클릭하거나 영역을 드래그하세요</strong>}</div>
      {loadStatus?.phase === 'analyzing' && <div className="paper-analysis-status" role="status"><LoaderCircle className="spin" size={13} /><span>논문 구조와 참조 위치를 분석하고 있어요</span><div><i style={{ width: `${loadStatus.total ? loadStatus.completed / loadStatus.total * 100 : 0}%` }} /></div><strong>{loadStatus.completed} / {loadStatus.total}페이지</strong></div>}
      {error && <div className="paper-error">{error}<button onClick={() => setError('')}><X size={13} /></button></div>}
      <div ref={documentLayoutRef} className={`paper-content document-layout mode-${viewMode}`} style={viewMode === 'dual' ? { gridTemplateColumns: `${dualRatio}% 7px calc(${100 - dualRatio}% - 7px)` } : undefined}>
        {(viewMode === 'original' || viewMode === 'dual') && <div className="document-column"><header><span><FileText size={13} /> 원문 PDF</span>{paneZoom('original')}</header><div className="document-scroll" ref={sourceScrollRef} onScroll={(event) => viewMode === 'dual' && syncScrollEnabled && syncScroll(event.currentTarget, translatedScrollRef.current)}>{pageRenderer('original')}</div></div>}
        {viewMode === 'dual' && <div className="panel-resizer" onPointerDown={startResize} title="드래그하여 원문/한국어 패널 너비 조절"><span /></div>}
        {(viewMode === 'translated' || viewMode === 'dual') && <div className="document-column translated-document"><header><span><Languages size={13} /> 한국어 문서 <i>{translating ? `번역 중 ${translationPercent}%` : hasCachedTranslation ? '저장됨' : '번역 대기'}</i></span>{paneZoom('translated')}</header><div className="document-scroll" ref={translatedScrollRef} onScroll={(event) => viewMode === 'dual' && syncScrollEnabled && syncScroll(event.currentTarget, sourceScrollRef.current)}>{pageRenderer('translated')}</div></div>}
      </div>
    </> : <div className="reader-empty library-empty"><div className="paper-stack"><div /><div /><FileText size={32} strokeWidth={1.5} /></div><h1>{activePaper ? 'PDF를 불러오는 중…' : '논문 워크스페이스'}</h1><p>{settings.libraryPath ? 'arXiv에서 논문을 찾아 라이브러리에 추가하세요.' : '먼저 PDF와 노트를 저장할 라이브러리 폴더를 선택하세요.'}</p><button onClick={() => settings.libraryPath ? setFinderOpen(true) : void chooseFolder()}>{settings.libraryPath ? <Search size={17} /> : <FolderOpen size={17} />} {settings.libraryPath ? 'arXiv 논문 찾기' : '라이브러리 폴더 선택'}</button></div>}
    {finderOpen && <Finder library={library} settings={settings} onChooseFolder={() => void chooseFolder()} onOpen={openPaper} onDownloaded={(paper) => { setLibrary((current) => current.some((item) => item.arxivId === paper.arxivId) ? current : [paper, ...current]); openPaper(paper); setFinderOpen(false) }} onSettings={(patch) => void updateSettings(patch)} onClose={() => setFinderOpen(false)} />}
  </section>
}
