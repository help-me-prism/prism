import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Focus, Link2, Maximize2, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { relationLabels, typeLabels } from './knowledgeModel'
import { allNodeTypes, defaultGraphFilter, graphView, neighbourhood, neighbours, type GraphFilter, type GraphViewNode, type GraphView as GraphViewData } from './graph/model'
import { GraphSimulation } from './graph/layout'
import { edgeLegend, edgeStyle, nodeColor } from './graph/palette'

/**
 * The whole vault at once. It is deliberately not the way to find a note — the tree and search are — but it is
 * the only place that answers "what have I actually connected, and what is floating alone".
 *
 * Drawn on a canvas rather than in SVG: a vault of a few thousand notes is an ordinary outcome of a few years
 * of reading, and that many DOM nodes will not pan at sixty frames a second.
 */
/**
 * `all` draws the vault. The other two draw the same nodes and ask something of them: what the vault nearly
 * connected, and what it has quietly become about. Both are computed, not stored, and both show the number
 * that says whether to believe them.
 */
type GraphMode = 'all' | 'missing' | 'groups'
const modeLabels: Record<GraphMode, string> = { all: '전체', missing: '놓친 연결', groups: '덩어리' }

export default function GraphView({ activeId, onOpenNode, onNotify }: {
  activeId?: string
  onOpenNode: (id: string) => void
  onNotify: (text: string, tone?: 'info' | 'error') => void
}) {
  const [graph, setGraph] = useState<KnowledgeGraph>()
  const [insights, setInsights] = useState<KnowledgeGraphInsights>()
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [mode, setMode] = useState<GraphMode>('all')
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

  /** The suggestions, keyed for drawing, with anything the researcher has since connected dropped. */
  const suggestions = useMemo(() => {
    if (mode !== 'missing' || !insights) return []
    return insights.similar.pairs.filter((pair) => byId.has(pair.a) && byId.has(pair.b))
  }, [mode, insights, byId])
  const suggestionEnds = useMemo(() => new Set(suggestions.flatMap((pair) => [pair.a, pair.b])), [suggestions])
  const groupOf = useMemo(() => {
    const map = new Map<string, { index: number; name: string }>()
    if (mode !== 'groups' || !insights?.clusters.clear) return map
    insights.clusters.clusters.forEach((cluster, index) => {
      for (const member of cluster.members) map.set(member, { index, name: cluster.name })
    })
    return map
  }, [mode, insights])
  /** Six hues that do not collide with the node-type colours, so a group reads as a region rather than a kind. */
  const groupColor = (index: number) => `hsl(${(index * 47 + 18) % 360} 34% 52%)`

  const load = useCallback(async (announce?: boolean) => {
    setLoading(true)
    try {
      const next = await window.prism.listKnowledgeGraph()
      setGraph(next)
      setInsights(undefined)
      if (announce) onNotify(`그래프를 다시 읽었습니다. 노드 ${next.nodes.length} · 연결 ${next.edges.length}`)
    } catch (reason) { onNotify(String(reason), 'error') }
    finally { setLoading(false) }
  }, [onNotify])

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true)
    try { setInsights(await window.prism.listKnowledgeGraphInsights()) }
    catch (reason) { onNotify(String(reason), 'error') }
    finally { setInsightsLoading(false) }
  }, [onNotify])

  useEffect(() => { void load() }, [load])
  // The groups and the near-misses cost a second pass over the vault, so they wait until they are asked for.
  useEffect(() => { if (mode !== 'all' && !insights && !insightsLoading) void loadInsights() }, [mode, insights, insightsLoading, loadInsights])
  // Narrowing to "the note I have open" has to keep meaning that when a different note is opened.
  useEffect(() => { setFocusCenter((current) => current === undefined ? undefined : activeId) }, [activeId])
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
    const k = Math.min(size.current.width / (width + 190), size.current.height / (height + 110), 2.4)
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
  const refit = useRef(false)
  useEffect(() => {
    if (!simulation.current) simulation.current = new GraphSimulation({ width: size.current.width, height: size.current.height })
    const sim = simulation.current
    sim.groupPull = mode === 'groups' && groupOf.size ? 0.055 : 0
    sim.setGraph(
      view.nodes.map((node) => ({ id: node.id, radius: node.radius, degree: node.degree, group: mode === 'groups' ? groupOf.get(node.id)?.name : undefined })),
      view.edges.map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId })),
    )
    const signature = `${view.nodes.length}:${view.edges.length}:${focusCenter ?? ''}:${mode}:${groupOf.size}`
    if (fitted.current !== signature) {
      // A big vault takes a couple of seconds to come to rest, and a frozen window is a worse thing to look at
      // than a moving one: settle a small graph outright, and let a large one settle where it can be watched.
      sim.settle(view.nodes.length > 600 ? 40 : 220)
      fit()
      refit.current = true
      fitted.current = signature
    }
    dirty.current = true
  }, [view, focusCenter, fit, mode, groupOf])

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
    // The groups are drawn under everything: a region you can point at, not another thing on top of the lines.
    if (mode === 'groups' && groupOf.size) {
      const regions = new Map<number, { x: number; y: number; count: number; name: string; maxX: number; maxY: number; minX: number; minY: number }>()
      for (const node of view.nodes) {
        const group = groupOf.get(node.id)
        const point = sim.byId.get(node.id)
        if (!group || !point) continue
        const screen = toScreen(point.x, point.y)
        const region = regions.get(group.index) ?? { x: 0, y: 0, count: 0, name: group.name, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        region.x += screen.x; region.y += screen.y; region.count += 1
        region.minX = Math.min(region.minX, screen.x); region.maxX = Math.max(region.maxX, screen.x)
        region.minY = Math.min(region.minY, screen.y); region.maxY = Math.max(region.maxY, screen.y)
        regions.set(group.index, region)
      }
      for (const [index, region] of regions) {
        const padding = 26 * Math.min(k, 1.4)
        context.globalAlpha = 0.09
        context.fillStyle = groupColor(index)
        const x = region.minX - padding; const y = region.minY - padding
        const width_ = region.maxX - region.minX + padding * 2; const height_ = region.maxY - region.minY + padding * 2
        const radius = Math.min(46, width_ / 2, height_ / 2)
        context.beginPath()
        context.moveTo(x + radius, y)
        context.arcTo(x + width_, y, x + width_, y + height_, radius)
        context.arcTo(x + width_, y + height_, x, y + height_, radius)
        context.arcTo(x, y + height_, x, y, radius)
        context.arcTo(x, y, x + width_, y, radius)
        context.closePath()
        context.fill()
        context.globalAlpha = 1
        context.fillStyle = groupColor(index)
        context.font = `600 ${Math.min(Math.max(13 * k, 11), 17)}px Inter, system-ui, sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'bottom'
        context.fillText(region.name, region.x / region.count, y - 5)
      }
    }
    for (const edge of view.edges) {
      const source = sim.byId.get(edge.sourceId)
      const target = sim.byId.get(edge.targetId)
      if (!source || !target) continue
      const style = edgeStyle(edge.type, edge.origin, edge.approved)
      const incident = edge.sourceId === highlight || edge.targetId === highlight
      // In the suggestion mode the existing structure steps back so the proposals are the only bright thing.
      const alpha = highlight ? (incident ? 0.95 : 0.05) : searching ? 0.14 : mode === 'missing' ? 0.22 : 0.55
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
      // Direction is a question about one note, not about the whole vault: fifty arrowheads on screen at once
      // are fifty things to look at and nothing to read. They appear for whatever the reader is pointing at.
      if (style.arrow && incident && k > 0.6) {
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

    if (mode === 'missing') {
      context.setLineDash([5, 4])
      for (const pair of suggestions) {
        const a = sim.byId.get(pair.a); const b = sim.byId.get(pair.b)
        if (!a || !b) continue
        const from = toScreen(a.x, a.y); const to = toScreen(b.x, b.y)
        const lit = !highlight || pair.a === highlight || pair.b === highlight
        context.globalAlpha = lit ? 0.9 : 0.12
        context.strokeStyle = '#7760aa'
        context.lineWidth = (0.9 + pair.score * 2.4) * Math.min(k, 1.5)
        context.beginPath()
        context.moveTo(from.x, from.y)
        context.lineTo(to.x, to.y)
        context.stroke()
      }
      context.setLineDash([])
    }

    const onScreen: Array<{ node: GraphViewNode; x: number; y: number; radius: number }> = []
    for (const node of view.nodes) {
      const point = sim.byId.get(node.id)
      if (!point) continue
      const screen = toScreen(point.x, point.y)
      if (screen.x < -60 || screen.y < -60 || screen.x > width + 60 || screen.y > height + 60) continue
      const radius = Math.max(point.radius * k, 2.2)
      onScreen.push({ node, x: screen.x, y: screen.y, radius })
      const faded = mode === 'missing' && suggestionEnds.size && !suggestionEnds.has(node.id)
      context.globalAlpha = dim(node.id) * (faded ? 0.3 : 1)
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
    }

    /**
     * Labels are drawn last and only where they fit. Naming every node at once turns the middle of any real
     * vault into a wall of overlapping text that names nothing; the well-connected notes get their names, the
     * rest get theirs on hover. What the reader asked about always wins the space.
     */
    context.textAlign = 'center'
    context.textBaseline = 'top'
    context.lineJoin = 'round'
    const priority = (node: GraphViewNode) =>
      (node.id === highlight ? 1e6 : 0) + (node.id === activeId ? 5e5 : 0) + (node.match ? 2e5 : 0)
      + (mode === 'missing' && suggestionEnds.has(node.id) ? 4e5 : 0) + (related?.has(node.id) ? 1e5 : 0) + node.degree
    // Node circles claim their own space first: a name written across a node hides the thing it is naming.
    const claimed: Array<[number, number, number, number]> = onScreen.map(({ x, y, radius }) => [x - radius, y - radius, x + radius, y + radius])
    // The status line and the legend sit over the canvas; a name written under them is a name nobody can read.
    claimed.push([0, height - 26, width, height])
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      !claimed.some(([a0, b0, a1, b1]) => x0 < a1 && x1 > a0 && y0 < b1 && y1 > b0)
    for (const entry of [...onScreen].sort((left, right) => priority(right.node) - priority(left.node))) {
      const { node, x, y, radius } = entry
      const forced = node.id === highlight || node.id === activeId || (related?.has(node.id) ?? false)
      if (radius < 2.5 && !forced) continue
      if (!forced && !node.match && k < 0.55) continue
      const label = node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title
      const size = Math.min(Math.max(10 * k, 9), 13)
      context.font = `${node.id === highlight ? 600 : 400} ${size}px Inter, system-ui, sans-serif`
      const half = context.measureText(label).width / 2 + 2
      // Under the node reads best; above it is the second try, and only then is the name left for the hover.
      const below = y + radius + 3
      const above = y - radius - size - 4
      const top = free(x - half, below, x + half, below + size + 2) ? below
        : free(x - half, above, x + half, above + size + 2) ? above
          : forced ? below : undefined
      if (top === undefined) continue
      // A name running off the edge of the canvas is half a name; it waits for the hover instead.
      if (x - half < 2 || x + half > width - 2) continue
      claimed.push([x - half, top, x + half, top + size + 2])
      // A halo, not a box: a label has to stay readable where it crosses an edge without hiding it.
      context.globalAlpha = dim(node.id) * 0.85
      context.strokeStyle = '#f4f2ed'
      context.lineWidth = 3
      context.strokeText(label, x, top)
      context.globalAlpha = dim(node.id)
      context.fillStyle = node.id === highlight || node.id === activeId ? '#3c352c' : '#6f675d'
      context.fillText(label, x, top)
    }
    context.globalAlpha = 1
  }, [view, byId, adjacency, hoverId, selectedId, activeId, filter.query, mode, suggestions, suggestionEnds, groupOf])

  useEffect(() => {
    const loop = () => {
      const sim = simulation.current
      if (sim && !sim.settled) { sim.tick(); dirty.current = true }
      // A graph left to settle on screen ends up somewhere else than where it was framed; frame it again.
      else if (sim && refit.current) { refit.current = false; fit() }
      if (dirty.current) { dirty.current = false; draw() }
      frame.current = window.requestAnimationFrame(loop)
    }
    frame.current = window.requestAnimationFrame(loop)
    return () => { if (frame.current) window.cancelAnimationFrame(frame.current) }
  }, [draw, fit])

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
  /**
   * What each layer would add, counted over the whole vault rather than over what is currently drawn. A number
   * that changed when you pressed the button would be describing the answer instead of the question.
   */
  const layers = useMemo(() => {
    let links = 0; let proposed = 0
    for (const edge of graph?.edges ?? []) {
      if (edge.reviewStatus === 'rejected') continue
      if (edge.origin === 'link') links += 1
      else if (edge.type === 'mentions' || edge.reviewStatus === 'pending') proposed += 1
    }
    return { links, proposed }
  }, [graph])
  const activeNode = activeId ? graph?.nodes.find((node) => node.id === activeId) : undefined

  return <div className="graph-view">
    <div className="graph-modes" role="tablist" aria-label="지식 그래프 보기">
      {(['all', 'missing', 'groups'] as GraphMode[]).map((value) => <button
        key={value} role="tab" aria-selected={mode === value} className={mode === value ? 'on' : ''}
        onClick={() => { setMode(value); setSelectedId(undefined) }}
      >
        {value === 'missing' ? <Link2 size={12} /> : value === 'groups' ? <Sparkles size={12} /> : null}
        {modeLabels[value]}
      </button>)}
      {mode === 'missing' && <span className="graph-mode-note">
        {insightsLoading ? '볼트를 읽는 중…'
          : !insights ? ''
            : suggestions.length ? `내용이 가까운데 이어지지 않은 ${suggestions.length}쌍 · 기준 ${insights.similar.threshold.toFixed(2)} (이 볼트 중앙값 ${insights.similar.median.toFixed(2)})`
              : '이 볼트에서는 이어질 만한데 안 이어진 쌍이 없습니다.'}
      </span>}
      {mode === 'groups' && <span className="graph-mode-note">
        {insightsLoading ? '볼트를 읽는 중…'
          : !insights ? ''
            : insights.clusters.clear ? `덩어리 ${insights.clusters.clusters.length}개 · 뚜렷함 Q=${insights.clusters.modularity.toFixed(2)}`
              : `덩어리가 뚜렷하지 않습니다 (Q=${insights.clusters.modularity.toFixed(2)}). 연결이 더 쌓이면 갈라집니다.`}
      </span>}
    </div>

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
        {/* Each toggle says what it puts on the canvas and how much of it, so pressing one is not a guess. */}
        <button
          className={filter.showLinks ? 'on' : ''} aria-pressed={filter.showLinks} disabled={!layers.links}
          title={layers.links ? '본문에 [[제목]]으로 쓴 링크를 옅은 점선으로 함께 그립니다. 관계 유형이 붙은 연결은 이 스위치와 무관하게 늘 보입니다.' : '본문에 쓴 [[링크]]가 아직 없습니다.'}
          onClick={() => setFilter((current) => ({ ...current, showLinks: !current.showLinks }))}
        >본문 링크{layers.links ? <em>{layers.links}</em> : null}</button>
        <button
          className={filter.showProposed ? 'on' : ''} aria-pressed={filter.showProposed} disabled={!layers.proposed}
          title={layers.proposed ? `아직 승인하지 않은 AI 제안 ${layers.proposed}개를 얇은 점선으로 겹쳐 봅니다. 승인은 정리 대기열에서 합니다.` : '검토를 기다리는 AI 제안이 없습니다.'}
          onClick={() => setFilter((current) => ({ ...current, showProposed: !current.showProposed }))}
        >AI 제안{layers.proposed ? <em>{layers.proposed}</em> : null}</button>
        <button
          className={!filter.hideIsolated ? 'on' : ''} aria-pressed={!filter.hideIsolated}
          title="아직 아무 데도 연결되지 않은 노트까지 함께 봅니다. 기본은 숨김입니다."
          onClick={() => setFilter((current) => ({ ...current, hideIsolated: !current.hideIsolated }))}
        >혼자 있는 노트{view.hidden && filter.hideIsolated ? <em>{view.hidden}</em> : null}</button>
        {activeNode && <button
          className={focusCenter ? 'on' : ''} aria-pressed={Boolean(focusCenter)}
          title={`'${activeNode.title}'에서 두 다리 안에 닿는 노트만 남깁니다.`}
          onClick={() => { setFocusCenter(focusCenter ? undefined : activeId) }}
        ><Focus size={12} /> 연 노트 주변만</button>}
        <button title="화면에 맞추기" aria-label="화면에 맞추기" onClick={fit}><Maximize2 size={12} /></button>
        <button title="그래프 다시 읽기" aria-label="그래프 다시 읽기" disabled={loading} onClick={() => void load(true)}><RefreshCw size={12} /></button>
      </div>
    </div>

    <div className="graph-stage" ref={wrapRef}>
      <canvas
        ref={canvasRef} className="graph-canvas-full" role="img"
        aria-label={`볼트 지식 그래프. 노드 ${view.nodes.length}개, 연결 ${view.edges.length}개`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!dragging.current) setHoverId(undefined) }}
        onDoubleClick={onDoubleClick} onWheel={onWheel}
      />
      {/* An empty graph is usually a vault with nothing connected yet, not a broken filter — say which. */}
      {!loading && !view.nodes.length && <p className="graph-view-empty">
        {!graph?.nodes.length ? '아직 노트가 없습니다. 리더에서 논문을 저장하거나 새 노트를 만드세요.'
          : view.hidden ? `아직 연결된 노트가 없습니다. 노트 ${view.hidden}개가 혼자 있어 숨겨졌습니다 — 본문에서 [[로 링크하거나 '고립 숨김'을 끄세요.`
            : '이 조건에 보이는 노트가 없습니다. 위의 필터를 켜 보세요.'}
      </p>}
      {loading && <p className="graph-view-empty">볼트를 읽는 중…</p>}

      <div className="graph-status">
        <span>노트 {view.nodes.length} · 연결 {view.edges.length}{view.hidden && filter.hideIsolated ? ` · 혼자 있는 노트 ${view.hidden} 숨김` : ''}</span>
        {focusCenter && activeNode && <span className="graph-status-focus">‘{activeNode.title}’ 주변 2단계만</span>}
        {mode === 'missing' && suggestions.length ? <span className="graph-status-focus">제안 {suggestions.length}쌍</span> : null}
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="graph-legend graph-legend-full">
        {edgeLegend.map((entry) => <span key={entry.label}>
          <i className="edge-dash" style={{ background: entry.color, opacity: entry.dash ? 0.65 : 1 }} />{entry.label}
        </span>)}
      </div>
    </div>

    {mode === 'missing' && !selected && <aside className="graph-inspect" aria-label="놓친 연결">
      <header><Link2 size={13} /><strong>이어볼 만한 쌍</strong></header>
      <div className="graph-inspect-meta">
        <span>{suggestions.length}쌍</span>
        {insights && <span>{insights.similar.compared}쌍 비교</span>}
        {insights?.similar.thin.length ? <span>{insights.similar.thin.length}개는 내용이 적어 제외</span> : null}
      </div>
      <div className="graph-inspect-list">
        {insightsLoading && <p className="side-empty">유사도를 계산하는 중…</p>}
        {!insightsLoading && !suggestions.length && <p className="side-empty">이 볼트에는 제안할 쌍이 없습니다. 노트를 더 쓰면 다시 봐 주세요.</p>}
        {suggestions.map((pair) => {
          const a = byId.get(pair.a)!; const b = byId.get(pair.b)!
          return <button
            key={`${pair.a}|${pair.b}`} className="pair-row"
            onMouseEnter={() => setHoverId(pair.a)} onMouseLeave={() => setHoverId(undefined)}
            onClick={() => setSelectedId(pair.a)} onDoubleClick={() => onOpenNode(pair.a)}
          >
            <span className="pair-score">{pair.score.toFixed(2)}</span>
            {/* One note per line: two long titles side by side turn every row into a paragraph. */}
            <span className="pair-end"><i className={`kind-dot kind-${a.nodeType}`} /><b>{a.title}</b></span>
            <span className="pair-end"><em>⟷</em><i className={`kind-dot kind-${b.nodeType}`} /><b>{b.title}</b></span>
            {/* The words the two notes share, so the suggestion can be judged rather than trusted. */}
            <small>{pair.shared.join(' · ')}</small>
          </button>
        })}
      </div>
    </aside>}

    {mode === 'groups' && !selected && <aside className="graph-inspect" aria-label="덩어리">
      <header><Sparkles size={13} /><strong>이 볼트의 덩어리</strong></header>
      <div className="graph-inspect-meta">
        <span title="모듈러리티: 덩어리 안의 연결이 우연보다 얼마나 조밀한가. 0.3 위면 갈라진 것이 뜻이 있습니다.">Q {insights?.clusters.modularity.toFixed(2) ?? '–'}</span>
        {insights?.clusters.loose.length ? <span>{insights.clusters.loose.length}개는 어디에도 안 묶임</span> : null}
      </div>
      <div className="graph-inspect-list">
        {insightsLoading && <p className="side-empty">덩어리를 찾는 중…</p>}
        {!insightsLoading && !insights?.clusters.clear && insights
          && <p className="side-empty">연결이 아직 고르게 퍼져 있어 갈래가 나뉘지 않습니다. 관계를 더 승인하면 달라집니다.</p>}
        {insights?.clusters.clear && insights.clusters.clusters.map((cluster, index) => <button
          key={cluster.id} className="group-row"
          onMouseEnter={() => setHoverId(cluster.nameId)} onMouseLeave={() => setHoverId(undefined)}
          onClick={() => setSelectedId(cluster.nameId)} onDoubleClick={() => onOpenNode(cluster.nameId)}
        >
          <span className="group-name"><i style={{ background: groupColor(index) }} />{cluster.name}</span>
          <small>노트 {cluster.members.length} · 안쪽 연결 {cluster.inside} · 밖으로 {cluster.crossing}</small>
        </button>)}
      </div>
    </aside>}

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
