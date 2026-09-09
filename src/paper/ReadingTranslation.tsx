import { useEffect, useRef } from 'react'

type Rect = { left: number; top: number; width: number; height: number }
export function OriginalExcerpt({ source, rect, label }: { source: HTMLCanvasElement; rect: Rect; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    const ratio = source.width / Math.max(1, parseFloat(source.style.width) || source.width)
    const left = Math.max(0, rect.left - 3); const top = Math.max(0, rect.top - 3)
    const width = Math.min(source.width / ratio - left, rect.width + 6)
    const height = Math.min(source.height / ratio - top, rect.height + 6)
    if (width <= 0 || height <= 0) return
    canvas.current.width = Math.round(width * ratio); canvas.current.height = Math.round(height * ratio)
    canvas.current.style.width = `${width}px`
    canvas.current.getContext('2d')?.drawImage(source, left * ratio, top * ratio, width * ratio, height * ratio, 0, 0, canvas.current.width, canvas.current.height)
  }, [source, rect.left, rect.top, rect.width, rect.height])
  return <canvas ref={canvas} role="img" aria-label={label} />
}

export default function ReadingTranslation({ segments, translation, source, ready, rectangles, figures, highlighted, onHighlight, onTag, onFindNotes }: {
  segments: TranslationSegment[]; translation: Map<string, string>; source: HTMLCanvasElement | null; ready: boolean;
  rectangles: (segment: TranslationSegment) => Rect[]; figures: Rect[]; highlighted?: string;
  onHighlight: (id?: string) => void; onTag: (segment: TranslationSegment) => void; onFindNotes: (segment: TranslationSegment) => void;
}) {
  const groups = new Map<string, TranslationSegment[]>()
  for (const segment of segments) {
    const key = `${segment.kind}-${segment.blockId ?? segment.id}`
    groups.set(key, [...groups.get(key) ?? [], segment])
  }
  const blocks = [...groups.entries()].map(([id, items]) => {
    const boxes = items.flatMap(rectangles)
    const left = Math.min(...boxes.map(box => box.left)); const top = Math.min(...boxes.map(box => box.top))
    return { id, items, rect: boxes.length ? { left, top, width: Math.max(...boxes.map(box => box.left + box.width)) - left, height: Math.max(...boxes.map(box => box.top + box.height)) - top } : undefined }
  })
  // Follow the parser's reading order. Embedded bitmap figures join their nearest caption.
  const placed = new Set<number>()
  const crop = (rect: Rect, label: string) => source && ready ? <OriginalExcerpt source={source} rect={rect} label={label} /> : null
  return <div className="reading-translation">
    {blocks.map(block => {
      const kind = block.items[0].kind
      const preserved = ['equation', 'table', 'artifact'].includes(kind)
      if (preserved && block.rect && figures.some(rect => block.rect!.left >= rect.left - 5 && block.rect!.top >= rect.top - 5 && block.rect!.left + block.rect!.width <= rect.left + rect.width + 5 && block.rect!.top + block.rect!.height <= rect.top + rect.height + 5)) return null
      const associated = kind === 'caption' && block.rect ? figures.map((rect, index) => ({ rect, index })).filter(({ rect, index }) => !placed.has(index) && rect.top + rect.height <= block.rect!.top + 8 && block.rect!.top - rect.top - rect.height < 180 && rect.left < block.rect!.left + block.rect!.width && rect.left + rect.width > block.rect!.left) : []
      associated.forEach(({ index }) => placed.add(index))
      return <section key={block.id} className={`reading-block ${kind}`}>
        {associated.map(({ rect, index }) => <figure key={index}>{crop(rect, '원문 피겨')}</figure>)}
        {preserved && block.rect ? <button className="original-excerpt" title="원문 근거를 질문에 추가" onClick={() => onTag(block.items[0])} onContextMenu={event => { event.preventDefault(); onFindNotes(block.items[0]) }}>{crop(block.rect, kind === 'equation' ? '원문 수식' : '원문 표 또는 도해')}</button> : block.items.map(segment => <span key={segment.id} data-anchor={segment.id} tabIndex={0} role="button" className={`${translation.has(segment.id) ? '' : 'untranslated'} ${highlighted === segment.id ? 'highlighted' : ''}`} onMouseEnter={() => onHighlight(segment.id)} onMouseLeave={() => onHighlight(undefined)} onClick={() => onTag(segment)} onKeyDown={event => { if (event.key === 'Enter') onTag(segment); if (event.key === 'ContextMenu') onFindNotes(segment) }} onContextMenu={event => { event.preventDefault(); onFindNotes(segment) }}>{translation.get(segment.id) || segment.source}{' '}</span>)}
      </section>
    })}
    {figures.map((rect, index) => !placed.has(index) && <figure key={index}>{crop(rect, '원문 피겨')}</figure>)}
  </div>
}
