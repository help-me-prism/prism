import { useEffect, useRef } from 'react'
import { scientificTranslationParts } from './scientificTranslationParts'
import { evidenceInlineMathHtml } from '../evidenceInlineMath'
import type { ScientificSpan } from '../../electron/scientificSource'

function ScientificGlyph({ source, scale, span }: { source: HTMLCanvasElement; scale: number; span: ScientificSpan }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const padding = .5
  const { rect } = span
  useEffect(() => {
    if (!canvas.current || source.width <= 0 || source.height <= 0) return
    const density = source.width / Math.max(1, parseFloat(source.style.width) || source.width)
    const factor = scale * density
    const x = Math.max(0, rect.left - padding) * factor, y = Math.max(0, rect.top - padding) * factor
    const width = Math.min(source.width - x, (rect.width + padding * 2) * factor)
    const height = Math.min(source.height - y, (rect.height + padding * 2) * factor)
    if (width <= 0 || height <= 0) return
    canvas.current.width = Math.ceil(width); canvas.current.height = Math.ceil(height)
    canvas.current.getContext('2d')?.drawImage(source, x, y, width, height, 0, 0, canvas.current.width, canvas.current.height)
  }, [source, scale, rect.left, rect.top, rect.width, rect.height])
  return <canvas ref={canvas} className="inline-scientific-glyph" role="img" aria-label={span.latex} title={span.latex} style={{
    width: `${(rect.width + padding * 2) / rect.fontSize}em`, height: `${(rect.height + padding * 2) / rect.fontSize}em`,
    verticalAlign: `${(span.baseline - rect.top - rect.height - padding) / rect.fontSize}em`,
  }}>{span.text}</canvas>
}

export default function ScientificTranslationText({ sourceText, text, spans, canvas, scale }: {
  sourceText: string; text: string; spans?: unknown; canvas: HTMLCanvasElement | null; scale: number;
}) {
  if (!canvas) return <span className="translated-inline-math" dangerouslySetInnerHTML={{ __html: evidenceInlineMathHtml(text) }} />
  return <>{scientificTranslationParts(sourceText, text, spans).map((part, index) => part.science
    ? <ScientificGlyph key={index} source={canvas} scale={scale} span={part.science} />
    : <span key={index} className="translated-inline-math" dangerouslySetInnerHTML={{ __html: evidenceInlineMathHtml(part.text) }} />)}</>
}
