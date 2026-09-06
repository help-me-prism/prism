import { useEffect, useMemo, useRef, useState } from 'react'
import { GraphSimulation } from './layout'
import { edgeStyle, nodeRadius } from './palette'

export type MiniNode = { id: string; title: string; nodeType: KnowledgeNodeType; kind: 'center' | 'hop1' | 'hop2' | 'citation' }
export type MiniEdge = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; origin: RelationOrigin; approved: boolean; label: string }

/**
 * The graph beside the note. It ran on a fixed ring before, which put the second hop wherever there was room
 * rather than next to the neighbour it belongs to — the picture said something the vault did not. It now uses
 * the same force layout as the full view, so distance on screen means distance in the graph.
 *
 * SVG rather than canvas here: a dozen nodes are cheaper as elements than as a repainted bitmap, and they come
 * with hit testing, focus and titles for free.
 */
export default function MiniGraph({ nodes, edges, height = 250, onOpenNode }: {
  nodes: MiniNode[]
  edges: MiniEdge[]
  height?: number
  onOpenNode: (id: string) => void
}) {
  const width = 320
  const [hoverId, setHoverId] = useState<string>()
  const [, setVersion] = useState(0)
  const simulation = useRef<GraphSimulation | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)
  const dragging = useRef<{ id: string; pointerId: number } | undefined>(undefined)
  const svgRef = useRef<SVGSVGElement>(null)

  const degrees = useMemo(() => {
    const map = new Map<string, number>()
    for (const edge of edges) {
      map.set(edge.sourceId, (map.get(edge.sourceId) ?? 0) + 1)
      map.set(edge.targetId, (map.get(edge.targetId) ?? 0) + 1)
    }
    return map
  }, [edges])

  const signature = `${nodes.map((node) => node.id).join(',')}|${edges.map((edge) => edge.id).join(',')}`
  useEffect(() => {
    if (!simulation.current) simulation.current = new GraphSimulation({ width, height, linkDistance: 46, charge: 1250, gravity: 0.014 })
    const sim = simulation.current
    sim.setGraph(nodes.map((node) => ({ id: node.id, radius: node.kind === 'center' ? 9 : nodeRadius(degrees.get(node.id) ?? 0, 4.5), degree: degrees.get(node.id) ?? 0 })), edges.map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId })))
    // The note the panel is about belongs in the middle: it is the one thing the reader is not looking for.
    const center = nodes.find((node) => node.kind === 'center')
    if (center) sim.pin(center.id, width / 2, height / 2)
    sim.settle()
    setVersion((value) => value + 1)
  }, [signature, height, degrees])

  useEffect(() => {
    const loop = () => {
      const sim = simulation.current
      if (sim && !sim.settled) { sim.tick(); setVersion((value) => value + 1) }
      frame.current = window.requestAnimationFrame(loop)
    }
    frame.current = window.requestAnimationFrame(loop)
    return () => { if (frame.current) window.cancelAnimationFrame(frame.current) }
  }, [])

  const sim = simulation.current
  const positioned = nodes.map((node) => ({ node, point: sim?.byId.get(node.id) })).filter((entry): entry is { node: MiniNode; point: NonNullable<typeof entry.point> } => Boolean(entry.point))
  /**
   * A well-connected note spreads wider than the panel is; rather than clipping it, the whole drawing is
   * scaled to fit. Held near 1 so the labels stay the size the rest of the panel is written in.
   */
  const fitted = (() => {
    if (!sim || !sim.nodes.length) return { k: 1, tx: 0, ty: 0 }
    const { minX, minY, maxX, maxY } = sim.bounds()
    const pad = 16
    const k = Math.min(Math.max(Math.min((width - pad * 2) / Math.max(maxX - minX, 1), (height - pad * 2) / Math.max(maxY - minY, 1)), 0.45), 1.15)
    return { k, tx: width / 2 - (minX + maxX) / 2 * k, ty: height / 2 - (minY + maxY) / 2 * k }
  })()
  const related = useMemo(() => {
    if (!hoverId) return undefined
    const set = new Set<string>([hoverId])
    for (const edge of edges) {
      if (edge.sourceId === hoverId) set.add(edge.targetId)
      if (edge.targetId === hoverId) set.add(edge.sourceId)
    }
    return set
  }, [hoverId, edges])

  function pointerPosition(event: React.PointerEvent) {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * width
    const y = (event.clientY - rect.top) / rect.height * height
    return { x: (x - fitted.tx) / fitted.k, y: (y - fitted.ty) / fitted.k }
  }
  function startDrag(event: React.PointerEvent, id: string) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = { id, pointerId: event.pointerId }
  }
  function moveDrag(event: React.PointerEvent) {
    if (!dragging.current) return
    const point = pointerPosition(event)
    simulation.current?.pin(dragging.current.id, point.x, point.y)
    setVersion((value) => value + 1)
  }
  function endDrag(event: React.PointerEvent) {
    if (!dragging.current) return
    event.currentTarget.releasePointerCapture(dragging.current.pointerId)
    dragging.current = undefined
  }

  /**
   * Which nodes get to say their name. Naming all of them overlaps every label with its neighbours' at this
   * size; the note the panel is about comes first, then whatever is best connected, and a name that would land
   * on one already written is left for the hover.
   */
  const named = (() => {
    const width_ = (text: string) => {
      let total = 0
      for (const character of text) total += character.codePointAt(0)! > 0x1100 ? 8.6 : 4.7
      return total
    }
    const rank = (node: MiniNode) => (node.kind === 'center' ? 1e6 : node.kind === 'hop2' ? 0 : 1e3) + (degrees.get(node.id) ?? 0)
    const claimed: Array<[number, number, number, number]> = []
    const chosen = new Set<string>()
    for (const { node, point } of [...positioned].sort((left, right) => rank(right.node) - rank(left.node))) {
      if (node.kind === 'hop2' && node.id !== hoverId) continue
      const half = width_(node.title.length > 15 ? `${node.title.slice(0, 14)}…` : node.title) / 2 + 1
      const top = point.y + point.radius + 3
      const box: [number, number, number, number] = [point.x - half, top, point.x + half, top + 10]
      const forced = node.kind === 'center' || node.id === hoverId
      if (!forced && claimed.some(([x0, y0, x1, y1]) => box[0] < x1 && box[2] > x0 && box[1] < y1 && box[3] > y0)) continue
      claimed.push(box)
      chosen.add(node.id)
    }
    return chosen
  })()

  return <svg
    ref={svgRef} className="mini-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="연결 그래프"
    onPointerMove={moveDrag} onPointerUp={endDrag} onPointerLeave={(event) => { endDrag(event); setHoverId(undefined) }}
  >
    <g transform={`translate(${fitted.tx.toFixed(2)} ${fitted.ty.toFixed(2)}) scale(${fitted.k.toFixed(3)})`}>
    {edges.map((edge) => {
      const source = sim?.byId.get(edge.sourceId)
      const target = sim?.byId.get(edge.targetId)
      if (!source || !target) return null
      const style = edgeStyle(edge.type, edge.origin, edge.approved)
      const faded = related ? !(related.has(edge.sourceId) && related.has(edge.targetId)) : false
      return <g key={edge.id} className="mini-edge" data-relation={edge.type} data-origin={edge.origin} opacity={faded ? 0.15 : 0.85}>
        <line
          x1={source.x} y1={source.y} x2={target.x} y2={target.y}
          stroke={style.color} strokeWidth={style.width} strokeDasharray={style.dash.join(' ') || undefined}
        />
        <title>{edge.label}</title>
      </g>
    })}
    {positioned.map(({ node, point }) => {
      const faded = related ? !related.has(node.id) : false
      const label = node.title.length > 15 ? `${node.title.slice(0, 14)}…` : node.title
      return <g
        key={node.id} className={`mini-node kind-${node.nodeType}${node.kind === 'center' ? ' is-center' : ''}${node.kind === 'citation' ? ' is-auto' : ''}`}
        opacity={faded ? 0.2 : 1} tabIndex={0} role="button" aria-label={`${node.title} 열기`}
        onPointerDown={(event) => startDrag(event, node.id)}
        onPointerEnter={() => { if (!dragging.current) setHoverId(node.id) }}
        onClick={() => onOpenNode(node.id)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenNode(node.id) } }}
      >
        <circle cx={point.x} cy={point.y} r={point.radius} />
        {named.has(node.id) && <text x={point.x} y={point.y + point.radius + 9}>{label}</text>}
        <title>{node.title}</title>
      </g>
    })}
    </g>
  </svg>
}
