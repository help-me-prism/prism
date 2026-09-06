import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Focus, Maximize2, RefreshCw, Search, X } from 'lucide-react'
import { relationLabels, typeLabels } from './knowledgeModel'
import { allNodeTypes, defaultGraphFilter, graphView, neighbourhood, neighbours, type GraphFilter, type GraphView as GraphViewData } from './graph/model'
import { GraphSimulation } from './graph/layout'
import { edgeStyle, nodeColor } from './graph/palette'

/**
 * The whole vault at once. It is deliberately not the way to find a note — the tree and search are — but it is
 * the only place that answers "what have I actually connected, and what is floating alone".
 *
 * Drawn on a canvas rather than in SVG: a vault of a few thousand notes is an ordinary outcome of a few years
 * of reading, and that many DOM nodes will not pan at sixty frames a second.
 */
export default function GraphView({ activeId, onOpenNode, onNotify }: {
  activeId?: string
  onOpenNode: (id: string) => void
  onNotify: (text: string, tone?: 'info' | 'error') => void
}) {
  const [graph, setGraph] = useState<KnowledgeGraph>()
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<GraphFilter>(defaultGraphFilter)
  const [selectedId, setSelectedId] = useState<string>()
  const [hoverId, setHoverId] = useState<string>()
  const [focusCenter, setFocusCenter] = useState<string>()
  const [zoom, setZoom] = useState(1)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simulation = useRef<GraphSimulation | undefined>(undefined)
  const camera = useRef({ x: 0, y: 0, k: 1 })
  const size = useRef({ width: 900, height: 640 })
  const dragging = useRef<{ kind: 'pan' | 'node'; id?: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)
  const dirty = useRef(true)

  const view: GraphViewData = useMemo(() => {
    if (!graph) return { nodes: [], edges: [], hidden: 0 }
    const full = graphView(graph, filter)
    return focusCenter ? neighbourhood(full, focusCenter, 2) : full
  }, [graph, filter, focusCenter])

  const byId = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view])
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of view.edges) {
      if (!map.has(edge.sourceId)) map.set(edge.sourceId, new Set())
      if (!map.has(edge.targetId)) map.set(edge.targetId, new Set())
      map.get(edge.sourceId)!.add(edge.targetId)
      map.get(edge.targetId)!.add(edge.sourceId)
    }
    return map
  }, [view])

  const load = useCallback(async (announce?: boolean) => {
    setLoading(true)
    try {
      const next = await window.prism.listKnowledgeGraph()
      setGraph(next)
      if (announce) onNotify(`그래프를 다시 읽었습니다. 노드 ${next.nodes.length} · 연결 ${next.edges.length}`)
    } catch (reason) { onNotify(String(reason), 'error') }
    finally { setLoading(false) }
  }, [onNotify])

  useEffect(() => { void load() }, [load])
  // A save arrives as a burst of file events; the whole graph is too expensive to rebuild once per event.
  useEffect(() => {
    let pending: number | undefined
    const stop = window.prism.onVaultChanged(() => {
      if (pending) window.clearTimeout(pending)
      pending = window.setTimeout(() => { pending = undefined; void load() }, 600)
    })
    return () => { if (pending) window.clearTimeout(pending); stop() }
  }, [load])

  /** Fits the drawn graph into the canvas, with room for the labels that sit under the outermost nodes. */
  const fit = useCallback(() => {
    const sim = simulation.current
    if (!sim || !sim.nodes.length) return
    const { minX, minY, maxX, maxY } = sim.bounds()
    const width = Math.max(maxX - minX, 1)
    const height = Math.max(maxY - minY, 1)
    const k = Math.min(size.current.width / (width + 90), size.current.height / (height + 90), 2.4)
    camera.current = {
      k,
      x: size.current.width / 2 - (minX + width / 2) * k,
      y: size.current.height / 2 - (minY + height / 2) * k,
    }
    setZoom(k)
    dirty.current = true
  }, [])

  // The layout keeps the positions of nodes that survive a filter change, so only a genuinely new set is fitted.
  const fitted = useRef('')
  useEffect(() => {
    if (!simulation.current) simulation.current = new GraphSimulation({ width: size.current.width, height: size.current.height })
    const sim = simulation.current
    sim.setGraph(view.nodes.map((node) => ({ id: node.id, radius: node.radius, degree: node.degree })), view.edges.map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId })))
    const signature = `${view.nodes.length}:${view.edges.length}:${focusCenter ?? ''}`
    if (fitted.current !== signature) { sim.settle(); fit(); fitted.current = signature }
    dirty.current = true
  }, [view, focusCenter, fit])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      size.current = { width: rect.width, height: rect.height }
      simulation.current?.resize(rect.width, rect.height)
      dirty.current = true
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const toScreen = (x: number, y: number) => ({ x: x * camera.current.k + camera.current.x, y: y * camera.current.k + camera.current.y })
  const toWorld = (x: number, y: number) => ({ x: (x - camera.current.x) / camera.current.k, y: (y - camera.current.y) / camera.current.k })

  const nodeAt = (screenX: number, screenY: number) => {
    const sim = simulation.current
    if (!sim) return undefined
    const point = toWorld(screenX, screenY)
    let best: string | undefined
    let bestDistance = Infinity
    for (const node of sim.nodes) {
      const dx = node.x - point.x
      const dy = node.y - point.y
      const distance = dx * dx + dy * dy
      const reach = (node.radius + 4 / camera.current.k) ** 2
      if (distance < reach && distance < bestDistance) { best = node.id; bestDistance = distance }
    }
    return best
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const sim = simulation.current
    if (!canvas || !sim) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ratio = window.devicePixelRatio || 1
    const { width, height } = size.current
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)

    const highlight = hoverId ?? selectedId
    const related = highlight ? adjacency.get(highlight) ?? new Set<string>() : undefined
    const searching = Boolean(filter.query.trim())
    const { k } = camera.current
    const dim = (id: string) => {
      if (highlight) return id === highlight || related!.has(id) ? 1 : 0.12
      if (searching) return byId.get(id)?.match ? 1 : 0.22
      return 1
    }

    context.lineCap = 'round'
    for (const edge of view.edges) {
      const source = sim.byId.get(edge.sourceId)
      const target = sim.byId.get(edge.targetId)
      if (!source || !target) continue
      const style = edgeStyle(edge.type, edge.origin, edge.approved)
      const alpha = highlight
        ? (edge.sourceId === highlight || edge.targetId === highlight ? 0.95 : 0.06)
        : searching ? 0.18 : 0.7
      if (alpha < 0.08) continue
      const from = toScreen(source.x, source.y)
      const to = toScreen(target.x, target.y)
      context.globalAlpha = alpha
      context.strokeStyle = style.color
      context.lineWidth = Math.max(style.width * Math.min(k, 1.6), 0.6)
      context.setLineDash(style.dash.map((value) => value * Math.min(k, 1.5)))
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
      context.setLineDash([])
      // Direction only matters once an edge is legible; below that an arrowhead is noise.
      if (style.arrow && k > 0.85) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x)
        const tip = target.radius * k + 3
        const x = to.x - Math.cos(angle) * tip
        const y = to.y - Math.sin(angle) * tip
        context.fillStyle = style.color
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(x - Math.cos(angle - 0.42) * 6, y - Math.sin(angle - 0.42) * 6)
        context.lineTo(x - Math.cos(angle + 0.42) * 6, y - Math.sin(angle + 0.42) * 6)
        context.closePath()
        context.fill()
      }
    }

    const labelled = view.nodes.length <= 120 || k > 1.05
    context.textAlign = 'center'
    context.textBaseline = 'top'
    for (const node of view.nodes) {
      const point = sim.byId.get(node.id)
      if (!point) continue
      const screen = toScreen(point.x, point.y)
      const radius = Math.max(point.radius * k, 2.2)
      if (screen.x < -60 || screen.y < -60 || screen.x > width + 60 || screen.y > height + 60) continue
      context.globalAlpha = dim(node.id)
      context.fillStyle = nodeColor(node.nodeType)
      context.beginPath()
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
      context.fill()
      if (node.id === selectedId || node.id === hoverId || node.id === activeId) {
        context.strokeStyle = node.id === activeId && node.id !== selectedId ? '#7760aa' : '#3c352c'
        context.lineWidth = 2
        context.stroke()
      } else if (k > 0.6) {
        context.strokeStyle = '#f4f2ed'
        context.lineWidth = 1.2
        context.stroke()
      }

      const named = labelled || node.match || node.id === highlight || node.id === activeId || (related?.has(node.id) ?? false)
      if (!named || radius < 2.5) continue
      const label = node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title
      // A halo, not a box: labels have to stay readable where they cross an edge without hiding it.
      context.font = `${node.id === highlight ? 600 : 400} ${Math.min(Math.max(10 * k, 9), 13)}px Inter, system-ui, sans-serif`
      context.globalAlpha = dim(node.id) * 0.85
      context.strokeStyle = '#f4f2ed'
      context.lineWidth = 3
      context.lineJoin = 'round'
      context.strokeText(label, screen.x, screen.y + radius + 3)
      context.globalAlpha = dim(node.id)
      context.fillStyle = node.id === highlight || node.id === activeId ? '#3c352c' : '#6f675d'
      context.fillText(label, screen.x, screen.y + radius + 3)
    }
    context.globalAlpha = 1
  }, [view, byId, adjacency, hoverId, selectedId, activeId, filter.query])

  useEffect(() => {
    const loop = () => {
      const sim = simulation.current
      if (sim && !sim.settled) { sim.tick(); dirty.current = true }
      if (dirty.current) { dirty.current = false; draw() }
      frame.current = window.requestAnimationFrame(loop)
    }
    frame.current = window.requestAnimationFrame(loop)
    return () => { if (frame.current) window.cancelAnimationFrame(frame.current) }
  }, [draw])

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const id = nodeAt(x, y)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = id
      ? { kind: 'node', id, startX: x, startY: y, originX: 0, originY: 0, moved: false }
      : { kind: 'pan', startX: x, startY: y, originX: camera.current.x, originY: camera.current.y, moved: false }
  }
  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const drag = dragging.current
    if (!drag) {
      const id = nodeAt(x, y)
      if (id !== hoverId) setHoverId(id)
      return
    }
    if (Math.abs(x - drag.startX) > 2 || Math.abs(y - drag.startY) > 2) drag.moved = true
    if (drag.kind === 'pan') {
      camera.current = { ...camera.current, x: drag.originX + (x - drag.startX), y: drag.originY + (y - drag.startY) }
    } else if (drag.id) {
      const point = toWorld(x, y)
      simulation.current?.pin(drag.id, point.x, point.y)
    }
    dirty.current = true
  }
  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragging.current
    dragging.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag) return
    if (drag.kind === 'node' && drag.id && !drag.moved) setSelectedId(drag.id === selectedId ? undefined : drag.id)
    if (drag.kind === 'pan' && !drag.moved) setSelectedId(undefined)
    // A node let go where it was put stays there: the researcher arranging the graph is the best layout there is.
  }
  function onDoubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const id = nodeAt(event.clientX - rect.left, event.clientY - rect.top)
    if (id) onOpenNode(id)
  }
  function onWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const before = toWorld(x, y)
    const k = Math.min(Math.max(camera.current.k * Math.exp(-event.deltaY * 0.0016), 0.12), 4)
    camera.current = { ...camera.current, k }
    const after = toWorld(x, y)
    camera.current = { ...camera.current, x: camera.current.x + (after.x - before.x) * k, y: camera.current.y + (after.y - before.y) * k }
    setZoom(k)
    dirty.current = true
  }

  function toggleType(type: KnowledgeNodeType) {
    setFilter((current) => {
      const types = new Set(current.types)
      if (types.has(type)) types.delete(type); else types.add(type)
      return { ...current, types: types.size ? types : new Set(allNodeTypes) }
    })
  }

  const selected = selectedId ? byId.get(selectedId) : undefined
  const selectedNeighbours = useMemo(() => selected ? neighbours(view, selected.id) : [], [view, selected])
  const counts = useMemo(() => {
    const result = new Map<KnowledgeNodeType, number>()
    for (const node of graph?.nodes ?? []) result.set(node.nodeType, (result.get(node.nodeType) ?? 0) + 1)
    return result
  }, [graph])

  return <div className="graph-view">
    <div className="graph-toolbar">
      <div className="graph-types">
        {allNodeTypes.filter((type) => counts.get(type)).map((type) => <button
          key={type} className={`graph-chip kind-${type}${filter.types.has(type) ? ' on' : ''}`}
          aria-pressed={filter.types.has(type)} onClick={() => toggleType(type)}
        ><i className={`kind-dot kind-${type}`} />{typeLabels[type]}<em>{counts.get(type)}</em></button>)}
      </div>
      <div className="graph-search">
        <Search size={12} />
        <input
          aria-label="그래프에서 노트 찾기" placeholder="이름으로 찾기" value={filter.query}
          onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
        />
        {filter.query && <button aria-label="찾기 지우기" onClick={() => setFilter((current) => ({ ...current, query: '' }))}><X size={11} /></button>}
      </div>
      <div className="graph-toggles">
        <button className={filter.showLinks ? 'on' : ''} aria-pressed={filter.showLinks} title="본문에 쓴 [[링크]]를 엣지로 봅니다" onClick={() => setFilter((current) => ({ ...current, showLinks: !current.showLinks }))}>링크</button>
        <button className={filter.showProposed ? 'on' : ''} aria-pressed={filter.showProposed} title="아직 승인하지 않은 AI 제안과 자동 추출 관계" onClick={() => setFilter((current) => ({ ...current, showProposed: !current.showProposed }))}>AI 제안</button>
        <button className={filter.hideIsolated ? 'on' : ''} aria-pressed={filter.hideIsolated} title="연결이 하나도 없는 노트를 숨깁니다" onClick={() => setFilter((current) => ({ ...current, hideIsolated: !current.hideIsolated }))}>고립 숨김</button>
        {activeId && <button className={focusCenter ? 'on' : ''} aria-pressed={Boolean(focusCenter)} title="열려 있는 노트에서 2홉까지만 봅니다" onClick={() => { setFocusCenter(focusCenter ? undefined : activeId) }}><Focus size={12} /> 이 노트 중심</button>}
        <button title="화면에 맞추기" aria-label="화면에 맞추기" onClick={fit}><Maximize2 size={12} /></button>
        <button title="그래프 다시 읽기" aria-label="그래프 다시 읽기" disabled={loading} onClick={() => void load(true)}><RefreshCw size={12} /></button>
      </div>
    </div>

    <div className="graph-stage" ref={wrapRef}>
      <canvas
        ref={canvasRef} className="graph-canvas-full" role="img"
        aria-label={`볼트 전체 그래프. 노드 ${view.nodes.length}개, 연결 ${view.edges.length}개`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!dragging.current) setHoverId(undefined) }}
        onDoubleClick={onDoubleClick} onWheel={onWheel}
      />
      {!loading && !view.nodes.length && <p className="graph-view-empty">
        {graph?.nodes.length ? '이 조건에 보이는 노트가 없습니다. 위의 필터를 켜 보세요.' : '아직 노트가 없습니다. 리더에서 논문을 저장하거나 새 노트를 만드세요.'}
      </p>}
      {loading && <p className="graph-view-empty">볼트를 읽는 중…</p>}

      <div className="graph-status">
        <span>노드 {view.nodes.length} · 연결 {view.edges.length}{view.hidden && filter.hideIsolated ? ` · 고립 ${view.hidden} 숨김` : ''}</span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="graph-legend graph-legend-full">
        {(['supports', 'contradicts', 'defines', 'answers', 'link'] as KnowledgeRelationType[]).map((type) => {
          const style = edgeStyle(type, type === 'link' ? 'link' : 'manual', true)
          return <span key={type}><i className="edge-dash" style={{ background: style.color, opacity: style.dash.length ? 0.6 : 1 }} />{relationLabels[type]}</span>
        })}
      </div>
    </div>

    {selected && <aside className="graph-inspect" aria-label="선택한 노트">
      <header>
        <i className={`kind-dot kind-${selected.nodeType}`} />
        <strong>{selected.title}</strong>
        <button aria-label="선택 해제" onClick={() => setSelectedId(undefined)}><X size={12} /></button>
      </header>
      <div className="graph-inspect-meta">
        <span>{typeLabels[selected.nodeType]}</span><span>연결 {selected.degree}</span>
      </div>
      <div className="graph-inspect-actions">
        <button className="primary" onClick={() => onOpenNode(selected.id)}>노트 열기</button>
        <button onClick={() => { setFocusCenter(selected.id); setSelectedId(selected.id) }}><Crosshair size={11} /> 여기 중심으로</button>
      </div>
      <div className="graph-inspect-list">
        {selectedNeighbours.length ? selectedNeighbours.map(({ node, edge, direction }) => <button key={edge.id} onClick={() => setSelectedId(node.id)} onDoubleClick={() => onOpenNode(node.id)}>
          <span><i className={`kind-dot kind-${node.nodeType}`} />{node.title}</span>
          <small>{direction === 'outgoing' ? '→' : '←'} {edge.origin === 'link' ? '링크' : relationLabels[edge.type]}{edge.approved ? '' : ' · 미승인'}</small>
        </button>) : <p className="side-empty">연결이 없습니다.</p>}
      </div>
    </aside>}
  </div>
}
