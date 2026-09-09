import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { blankGutterPieces, flowProseLines, type FlowGlyphRect, type FlowProseLine } from './flowProseGeometry'

/** Only for validated precise prose slices. Equations, tables and figures keep their existing renderer. */
export default function FlowProseExcerpt({ source, rects, label, fallback = null }: {
  source: HTMLCanvasElement; rects: readonly FlowGlyphRect[]; label: string; fallback?: ReactNode;
}) {
  const lines = useMemo(() => flowProseLines(rects), [rects])
  if (!lines) return <>{fallback}</>
  return <span className="flow-prose-excerpt" role="img" aria-label={label} style={{ display: 'block', width: '100%', fontSize: 'inherit', textAlign: 'left' }}>
    {lines.map((line, index) => <LinePixels key={index} source={source} line={line} />)}
  </span>
}

function LinePixels({ source, line }: { source: HTMLCanvasElement; line: FlowProseLine }) {
  const [rendered, setRendered] = useState<{ canvas: HTMLCanvasElement; pieces: Array<{ left: number; width: number }>; fontPixels: number }>()
  useEffect(() => {
    const canvas = document.createElement('canvas')
    const ratio = source.width / Math.max(1, parseFloat(source.style.width) || source.width)
    canvas.width = Math.max(1, Math.ceil(line.rect.width * ratio))
    canvas.height = Math.max(1, Math.ceil(line.rect.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    // Copy only the precise sentence slices; never repaint neighboring prose inside its union box.
    for (const slice of line.slices) context.drawImage(source,
      slice.left * ratio, slice.top * ratio, slice.width * ratio, slice.height * ratio,
      (slice.left - line.rect.left) * ratio, (slice.top - line.rect.top) * ratio, slice.width * ratio, slice.height * ratio)
    const fontPixels = line.rect.fontSize! * ratio
    setRendered({ canvas, pieces: blankGutterPieces(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, fontPixels), fontPixels })
  }, [source, line])
  return <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', rowGap: '.3em', minHeight: `${Math.max(1.48, line.heightEm)}em`, maxWidth: '100%' }}>
    {rendered?.pieces.map(piece => <WordPixels key={piece.left} {...rendered} piece={piece} />)}
  </span>
}

function WordPixels({ canvas, piece, fontPixels }: { canvas: HTMLCanvasElement; piece: { left: number; width: number }; fontPixels: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = ref.current
    if (!target) return
    target.width = piece.width; target.height = canvas.height
    target.getContext('2d')?.drawImage(canvas, piece.left, 0, piece.width, canvas.height, 0, 0, piece.width, canvas.height)
  }, [canvas, piece.left, piece.width])
  // A single oversized unbreakable token scales intact to the pane: never crop its glyphs.
  return <canvas ref={ref} aria-hidden="true" style={{ display: 'block', flex: '0 1 auto', width: `${piece.width / fontPixels}em`, height: 'auto', maxWidth: '100%', margin: 0 }} />
}
