import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { placePaperBlocks, type PaperRect } from './paperLayout'

export default function PaperTranslationLayout({ items, sourceWidth, sourceHeight, fontScale = 1 }: {
  items: Array<{ id: string; rect: PaperRect; kind: string; fontSize?: number; lineHeight?: number; firstLineIndent?: number; content: ReactNode }>;
  sourceWidth: number; sourceHeight: number; fontScale?: number;
}) {
  const root = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ tops: number[]; height: number; ratio: number }>({ tops: [], height: sourceHeight, ratio: 1 })
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => {
      if (!element.clientWidth) return
      const ratio = element.clientWidth / Math.max(1, sourceWidth)
      const heights = [...element.children].map(child => (child as HTMLElement).offsetHeight)
      const tops = placePaperBlocks(items.map(item => item.rect), heights, ratio)
      const lastBottom = Math.max(0, ...items.map((_, index) => tops[index] + (heights[index] ?? 0)))
      // Header/footer crops already include the original page margins. Adding
      // another fixed margin made every translated page drift from its source.
      const bottomMargin = Math.max(0, sourceHeight - Math.max(0, ...items.map(item => item.rect.top + item.rect.height))) * ratio
      const next = { tops, height: Math.max(sourceHeight * ratio, lastBottom + bottomMargin), ratio }
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); [...element.children].forEach(child => observer.observe(child))
    measure()
    return () => observer.disconnect()
  }, [items, sourceWidth, sourceHeight, fontScale])
  return <div ref={root} className="paper-translation-layout" style={{ height: layout.height, fontSize: 10 * layout.ratio * fontScale }}>
    {items.map((item, index) => <section key={item.id} data-source-rect={JSON.stringify(item.rect)} className={`paper-layout-block reading-block ${item.kind}`} style={{
      fontSize: (item.fontSize ?? 10) * layout.ratio * fontScale, lineHeight: item.lineHeight, textIndent: (item.firstLineIndent ?? 0) * layout.ratio, left: `${item.rect.left / sourceWidth * 100}%`, width: `${item.rect.width / sourceWidth * 100}%`, top: layout.tops[index] ?? item.rect.top,
    }}>{item.content}</section>)}
  </div>
}
