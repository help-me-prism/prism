import { Sigma, Table2 } from 'lucide-react'
import { paddedExcerptBounds } from './excerptBounds'
import { useEffect, useRef } from 'react'
import { joinPreservedRegions } from './preservedRegions'
import { figureOverlapsProse } from './figureGeometry'
import PaperTranslationLayout from './PaperTranslationLayout'
import FlowProseExcerpt from './FlowProseExcerpt'
import { clearCropBoundary, sourceParagraphIndent, sourceParagraphLineHeight } from './paperLayout'
import { groupReadingSegments } from './readingBlocks'
import { excerptSlices, mixedProseParagraphs, alignedExcerptSlices, mayMaskExcerpt } from './excerptGeometry'
import { unsafeParagraphIds } from '../../electron/translationScope'
import { publicationDoiRects } from './publicationFurniture'
import ScientificTranslationText from './ScientificTranslationText'

type Rect = { left: number; top: number; width: number; height: number; fontSize?: number }
export function OriginalExcerpt({ source, rect, label, padding = 3, clipRects, alignProse = false, neighbors = [] }: { source: HTMLCanvasElement; rect: Rect; label: string; padding?: number; clipRects?: Rect[]; alignProse?: boolean; neighbors?: Rect[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    // PDF.js can release/reset a source canvas between the render that passed
    // `ready` and this passive effect (for example during a fitted-pane resize).
    // The next completed PDF render remounts the excerpt with fresh pixels.
    if (!canvas.current || source.width <= 0 || source.height <= 0) return
    const ratio = source.width / Math.max(1, parseFloat(source.style.width) || source.width)
    // Fitted PDF viewports can have fractional CSS dimensions. Recalculating a
    // full-page crop from the width ratio can lose a pixel from the other axis.
    if (!padding && !clipRects && rect.left === 0 && rect.top === 0
      && Math.abs(rect.width - (parseFloat(source.style.width) || source.width)) < .001
      && Math.abs(rect.height - (parseFloat(source.style.height) || source.height)) < .001) {
      canvas.current.width = source.width; canvas.current.height = source.height
      canvas.current.style.width = `${rect.width}px`
      canvas.current.getContext('2d')?.drawImage(source, 0, 0)
      return
    }
    const bounded = paddedExcerptBounds(rect, neighbors, padding)
    const { left, top } = bounded
    const width = Math.min(source.width / ratio - left, bounded.width)
    const height = Math.min(source.height / ratio - top, bounded.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    canvas.current.width = Math.round(width * ratio); canvas.current.height = Math.round(height * ratio)
    canvas.current.style.width = `${width}px`
    const context = canvas.current.getContext('2d')
    if (!context) return
    if (clipRects) {
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.current.width, canvas.current.height)
      const slices = alignProse ? alignedExcerptSlices(rect, clipRects) : excerptSlices({ left, top, width, height }, clipRects).map(source => ({ source, destination: source }))
      for (const { source: slice, destination } of slices) {
        context.drawImage(source, slice.left * ratio, slice.top * ratio, slice.width * ratio, slice.height * ratio,
          (destination.left - left) * ratio, (destination.top - top) * ratio, slice.width * ratio, slice.height * ratio)
      }
    } else context.drawImage(source, left * ratio, top * ratio, width * ratio, height * ratio, 0, 0, canvas.current.width, canvas.current.height)
  }, [source, rect.left, rect.top, rect.width, rect.height, padding, clipRects, alignProse, neighbors])
  return <canvas ref={canvas} role="img" aria-label={label} />
}

export default function ReadingTranslation({ segments, translation, source, ready, rectangles, figures, sourceRects = [], format = 'paper', fontScale = 1, sourceScale = 1, highlighted, onHighlight, onTag, onFindNotes, onFigureRect }: {
  segments: TranslationSegment[]; translation: Map<string, string>; source: HTMLCanvasElement | null; ready: boolean;
  format?: 'paper' | 'flow'; fontScale?: number; sourceScale?: number;
  rectangles: (segment: TranslationSegment) => Rect[]; figures: Rect[]; sourceRects?: Array<Rect & { text?: string }>; highlighted?: string;
  onFigureRect: (rect: Rect) => void; onHighlight: (id?: string) => void; onTag: (segment: TranslationSegment) => void; onFindNotes: (segment: TranslationSegment) => void;
}) {
  // Defense in depth: a bad or stale figure estimate must never replace an
  // abstract with a full-page bitmap while the UI reports successful translation.
  figures = figures.filter(rect => !figureOverlapsProse(rect, segments.map(segment => ({ kind: segment.kind, source: segment.source, rects: rectangles(segment) }))))
  const mixedParagraphs = mixedProseParagraphs(segments)
  const unsafeParagraphs = unsafeParagraphIds(segments)
  // Cached original equations/tables/artifacts are preservation records, not
  // displayed prose translations. They must not trigger page reconstruction.
  const hasProseTranslation = (segment: TranslationSegment) => ['text', 'heading', 'caption'].includes(segment.kind) && Boolean(translation.get(segment.id)?.trim())
  const originalParagraphs = new Set([...mixedParagraphs].filter(id => unsafeParagraphs.has(id) || !segments.some(item => item.blockId === id && hasProseTranslation(item))))
  const intactProseParagraphs = new Set<string>()
  if (format === 'paper') {
    const paragraphs = new Map<string, TranslationSegment[]>()
    for (const segment of segments) if (segment.blockId) {
      const items = paragraphs.get(segment.blockId) ?? []
      items.push(segment); paragraphs.set(segment.blockId, items)
    }
    // A run-in heading and its untranslated body already share correct PDF
    // positions. Keep one original crop instead of introducing layout collisions
    // between their separate ink boxes. Never swallow translated neighboring text.
    for (const [id, items] of paragraphs) if (items.every(item => ['text', 'heading'].includes(item.kind)) && !items.some(hasProseTranslation)) { originalParagraphs.add(id); intactProseParagraphs.add(id) }
  }
  const blocks = joinPreservedRegions(groupReadingSegments(segments, originalParagraphs, segment => translation.get(segment.id) ? 'translated' : 'source').map(({ id, kind, items, original }) => {
    const boxes = items.flatMap(rectangles)
    const left = Math.min(...boxes.map(box => box.left)); const top = Math.min(...boxes.map(box => box.top))
    return { id, kind, items, original, rect: boxes.length ? { left, top, width: Math.max(...boxes.map(box => box.left + box.width)) - left, height: Math.max(...boxes.map(box => box.top + box.height)) - top } : undefined }
  }))
  // Follow the parser's reading order. Embedded bitmap figures join their nearest caption.
  const placed = new Set<number>()
  const clips = (items: TranslationSegment[]) => mayMaskExcerpt(items, mixedParagraphs, originalParagraphs) && (items.every(item => item.preciseRects?.length) || items.every(item => ['text', 'artifact'].includes(item.kind) && item.blockId && mixedParagraphs.has(item.blockId) && !originalParagraphs.has(item.blockId))) ? items.flatMap(rectangles) : undefined
  const crop = (rect: Rect, label: string, clipRects?: Rect[], alignProse = false) => {
    if (!source || !ready) return null
    const original = <OriginalExcerpt source={source} rect={rect} label={label} clipRects={clipRects} alignProse={alignProse} neighbors={sourceRects} />
    return format === 'flow' && alignProse && clipRects ? <FlowProseExcerpt source={source} rects={clipRects} label={label} fallback={original} /> : original
  }
  // Reposition only a precisely located protected sentence between translated prose.
  // Its PDF anchors and source rectangles remain untouched.
  const protectedProse = (items: TranslationSegment[]) => items.length === 1 && items[0].kind === 'artifact' && !!items[0].preciseRects?.length && !!items[0].blockId && mixedParagraphs.has(items[0].blockId) && !originalParagraphs.has(items[0].blockId)
  const figureCrop = (rect: Rect) => <button className="original-excerpt" title="피겨를 질문에 추가" onClick={() => onFigureRect(rect)}>{crop(rect, '원문 피겨')}</button>
  const inlineTag = (segment: TranslationSegment, source: string, index: number) => onTag({ ...segment, id: `${segment.id}-inline-${index}`, kind: 'equation', source, scientificSpans: undefined })
  const text = (items: TranslationSegment[]) => items.map(segment => <span key={segment.id} style={{ fontWeight: segment.sourceFontWeight }} data-anchor={segment.id} tabIndex={0} role="button" className={`${translation.has(segment.id) ? '' : 'untranslated'} ${highlighted === segment.id ? 'highlighted' : ''}`} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onKeyDown={event => { if (event.key === 'Enter') onTag(segment); if (event.key === 'ContextMenu') onFindNotes(segment) }} onContextMenu={event => { event.preventDefault(); onFindNotes(segment) }}><ScientificTranslationText sourceText={segment.source} text={translation.get(segment.id) || segment.source} spans={segment.scientificSpans} canvas={ready ? source : null} scale={sourceScale} onInlineMath={(source, index) => inlineTag(segment, source, index)} />{' '}</span>)
  const intactProseCrop = (items: TranslationSegment[], rect: Rect) => {
    // Keep every original sentence selectable even when its paragraph is one
    // bitmap. These are siblings of the canvas, never nested interactive buttons.
    const bounded = paddedExcerptBounds(rect, sourceRects)
    const { left, top } = bounded
    const sourceWidth = source ? parseFloat(source.style.width) || source.width : rect.left + rect.width + 6
    const sourceHeight = source ? parseFloat(source.style.height) || source.height : rect.top + rect.height + 6
    const width = Math.min(sourceWidth - left, bounded.width), height = Math.min(sourceHeight - top, bounded.height)
    return <div style={{ position: 'relative' }}>{crop(rect, '번역 전 원문 문단')}
      <div className="anchor-layer">{items.flatMap(segment => rectangles(segment).map((box, index) => <span key={`${segment.id}-${index}`} data-anchor={segment.id} role="button" tabIndex={0} aria-label={segment.source.slice(0, 100)} className={highlighted === segment.id ? 'highlighted' : ''} style={{ left: `${(box.left - left) / width * 100}%`, top: `${(box.top - top) / height * 100}%`, width: `${box.width / width * 100}%`, height: `${box.height / height * 100}%`, pointerEvents: 'auto' }} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onKeyDown={event => { if (event.key === 'Enter') onTag(segment); if (event.key === 'ContextMenu') onFindNotes(segment) }} onContextMenu={event => { event.preventDefault(); onFindNotes(segment) }} />))}</div>
    </div>
  }
  const containedInFigure = (rect: Rect) => figures.some(figure => rect.left >= figure.left - 3 && rect.top >= figure.top - 3 && rect.left + rect.width <= figure.left + figure.width + 3 && rect.top + rect.height <= figure.top + figure.height + 3)
  if (format === 'paper' && source && ready) {
    const sourceWidth = parseFloat(source.style.width) || source.width
    const sourceHeight = parseFloat(source.style.height) || source.height
    if (!segments.some(segment => hasProseTranslation(segment) && !originalParagraphs.has(segment.blockId ?? ''))) return <div className="reading-translation paper-format untouched-paper">
      <OriginalExcerpt source={source} rect={{ left: 0, top: 0, width: sourceWidth, height: sourceHeight }} label="아직 번역하지 않은 원문 페이지" padding={0} />
      <div className="anchor-layer">{segments.flatMap(segment => rectangles(segment).map((rect, index) => <span key={`${segment.id}-${index}`} data-anchor={segment.id} role="button" tabIndex={0} aria-label={segment.source.slice(0, 100)} className={highlighted === segment.id ? 'highlighted' : ''} style={{ left: `${rect.left / sourceWidth * 100}%`, top: `${rect.top / sourceHeight * 100}%`, width: `${rect.width / sourceWidth * 100}%`, height: `${rect.height / sourceHeight * 100}%` }} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onKeyDown={event => { if (event.key === 'Enter') onTag(segment) }} onContextMenu={event => { event.preventDefault(); onFindNotes(segment) }} />))}</div>
    </div>
    const items = blocks.flatMap(block => {
      if (!block.rect) return []
      // A detected figure crop commonly includes its caption so the evidence
      // tag remains one visual region. Do not let that crop suppress a real
      // caption translation; layout will place the translated caption after it.
      if (containedInFigure(block.rect) && !block.items.some(hasProseTranslation)) return []
      const kind = block.kind
      const missingProse = block.items.some(segment => ['text', 'heading', 'caption'].includes(segment.kind) && !translation.get(segment.id))
      const preserved = block.original || ['equation', 'table', 'artifact'].includes(kind) || missingProse
      // A nearby wide figure does not establish the caption's text column.
      // Keep its actual source bounds; extra translated lines expand vertically.
      const rect = block.rect
      const startsParagraph = !!block.items[0].blockId && block.items[0] === segments.find(segment => segment.blockId === block.items[0].blockId)
      const firstLineIndent = !preserved && kind === 'text' && startsParagraph && block.items.every(segment => segment.preciseRects?.length)
        ? sourceParagraphIndent(block.items.flatMap(rectangles)) : 0
      const glyphHeights = block.items.flatMap(rectangles).map(box => box.fontSize ?? box.height).filter(height => height > 0).sort((a, b) => a - b)
      const fontSize = (glyphHeights[Math.floor(glyphHeights.length / 2)] ?? 10) * 1.08
      const lineHeight = !preserved && kind === 'text' && startsParagraph && block.items.every(segment => segment.preciseRects?.length)
        ? sourceParagraphLineHeight(block.items.flatMap(rectangles), fontSize) : undefined
      return [{ id: block.id, rect, kind, fontSize, lineHeight, firstLineIndent, content: preserved
        ? block.original && block.items.length > 1 && intactProseParagraphs.has(block.items[0].blockId ?? '') ? intactProseCrop(block.items, block.rect) : <button data-anchor={block.items[0].id} className={`original-excerpt${['equation', 'table'].includes(kind) ? ` structure-anchor ${kind}${highlighted === block.items[0].id ? ' highlighted' : ''}` : ''}`} title={block.original ? '글자와 수식을 온전히 보존하기 위해 이 문단은 원문으로 표시합니다. 클릭하면 질문에 추가합니다.' : kind === 'artifact' ? '문자와 수식을 정확히 보존하기 위해 원문으로 표시합니다. 클릭하면 원문 이미지를 질문에 추가합니다.' : kind === 'table' ? '표 · 클릭: 채팅 태그 · 우클릭: 노트에 담기' : kind === 'equation' ? '수식 · 클릭: 채팅 태그 · 우클릭: 노트에 담기' : '원문 근거를 질문에 추가'} onMouseEnter={() => onHighlight(block.items[0].id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(block.items[0])} onContextMenu={event => { event.preventDefault(); onFindNotes(block.items[0]) }}>{crop(block.rect, protectedProse(block.items) ? '글자와 기호를 보존한 원문 문장' : kind === 'equation' ? '원문 수식' : '원문 표 또는 도해', clips(block.items), protectedProse(block.items))}{/* The source pane marks every equation and table with a green region the
            reader can click. The translated pane showed the same crop with no
            marker at all, so the two panes disagreed about what was tagged. */}
          {kind === 'table' ? <Table2 size={11} /> : kind === 'equation' ? <Sigma size={11} /> : null}</button>
        : text(block.items) }]
    })
    const figureItems = figures.map((rect, index) => ({ id: `figure-${index}`, rect, kind: 'figure', content: <figure>{figureCrop(rect)}</figure> }))
    const contentRects = [...items, ...figureItems].map(item => item.rect)
    const top = Math.max(0, clearCropBoundary(Math.min(sourceHeight, ...contentRects.map(rect => rect.top)) - 2, sourceRects, 'before'))
    const bottom = Math.min(sourceHeight, clearCropBoundary(Math.max(sourceHeight * .92, Math.max(0, ...contentRects.map(rect => rect.top + rect.height)) + 12), sourceRects, 'after'))
    const furniture = contentRects.length ? [
      { left: 0, top: 0, width: sourceWidth, height: top },
      { left: 0, top: bottom, width: sourceWidth, height: sourceHeight - bottom },
    ].filter(rect => rect.height > 1).map((rect, index) => ({ id: `furniture-${index}`, rect, kind: 'furniture', content: <OriginalExcerpt source={source} rect={rect} label='Original page header or footer' padding={0} /> })) : []
    const doiLines = publicationDoiRects(sourceRects, [...contentRects, ...furniture.map(item => item.rect)], sourceWidth, sourceHeight)
      .map((rect, index) => ({ id: `doi-${index}`, rect, kind: 'publication-link', content: <OriginalExcerpt source={source} rect={rect} label="원문 DOI" padding={0} /> }))
    return <div className="reading-translation paper-format"><PaperTranslationLayout items={[...items, ...figureItems, ...furniture, ...doiLines]} sourceWidth={sourceWidth} sourceHeight={sourceHeight} fontScale={fontScale} /></div>
  }
  if (format === 'paper') return null
  return <div className="reading-translation">
    {blocks.map(block => {
      const kind = block.kind
      const preserved = block.original || ['equation', 'table', 'artifact'].includes(kind)
      if (preserved && block.rect && figures.some(rect => block.rect!.left >= rect.left - 5 && block.rect!.top >= rect.top - 5 && block.rect!.left + block.rect!.width <= rect.left + rect.width + 5 && block.rect!.top + block.rect!.height <= rect.top + rect.height + 5)) return null
      const associated = kind === 'caption' && block.rect ? figures.map((rect, index) => ({ rect, index })).filter(({ rect, index }) => !placed.has(index) && rect.top + rect.height <= block.rect!.top + 8 && block.rect!.top - rect.top - rect.height < 180 && rect.left < block.rect!.left + block.rect!.width && rect.left + rect.width > block.rect!.left) : []
      associated.forEach(({ index }) => placed.add(index))
      return <section key={block.id} className={`reading-block ${kind}`}>
        {associated.map(({ rect, index }) => <figure key={index}>{figureCrop(rect)}</figure>)}
        {preserved && block.rect ? <button className="original-excerpt" title={block.original ? '글자와 수식을 온전히 보존하기 위해 이 문단은 원문으로 표시합니다. 클릭하면 질문에 추가합니다.' : kind === 'artifact' ? '문자와 수식을 정확히 보존하기 위해 원문으로 표시합니다. 클릭하면 원문 이미지를 질문에 추가합니다.' : '원문 근거를 질문에 추가'} onClick={() => onTag(block.items[0])} onContextMenu={event => { event.preventDefault(); onFindNotes(block.items[0]) }}>{crop(block.rect, protectedProse(block.items) ? '글자와 기호를 보존한 원문 문장' : kind === 'equation' ? '원문 수식' : '원문 표 또는 도해', clips(block.items), protectedProse(block.items))}</button> : block.items.map(segment => <span key={segment.id} style={{ fontWeight: segment.sourceFontWeight }} data-anchor={segment.id} tabIndex={0} role="button" className={`${translation.has(segment.id) ? '' : 'untranslated'} ${highlighted === segment.id ? 'highlighted' : ''}`} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onKeyDown={event => { if (event.key === 'Enter') onTag(segment); if (event.key === 'ContextMenu') onFindNotes(segment) }} onContextMenu={event => { event.preventDefault(); onFindNotes(segment) }}><ScientificTranslationText sourceText={segment.source} text={translation.get(segment.id) || segment.source} spans={segment.scientificSpans} canvas={ready ? source : null} scale={sourceScale} onInlineMath={(source, index) => inlineTag(segment, source, index)} />{' '}</span>)}
      </section>
    })}
    {figures.map((rect, index) => !placed.has(index) && <figure key={index}>{figureCrop(rect)}</figure>)}
  </div>
}
