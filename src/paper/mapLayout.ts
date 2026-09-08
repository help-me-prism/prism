/**
 * Left to right, in the order the argument runs.
 *
 * The vault graph uses a force layout because a vault has no direction — notes relate to each other and the
 * shape that falls out is the answer. A paper is the opposite: it starts somewhere, it ends somewhere, and the
 * reader wants to see that. So this is a layered layout — every node sits one column to the right of whatever
 * it follows, and columns are ordered to keep the lines between them from crossing.
 *
 * Small enough to read, and deterministic: the same structure always draws the same picture.
 */

export type MapNodeInput = { id: string }
export type MapEdgeInput = { id: string; from: string; to: string }
/** `band` is which line of the map a node ended up on once the flow was wrapped to the pane's width. */
export type PlacedMapNode = { id: string; layer: number; row: number; band: number; x: number; y: number }
export type MapPlacement = {
  nodes: PlacedMapNode[]
  byId: Map<string, PlacedMapNode>
  /** Edges that would have made the picture cyclic and were left undrawn, so the caller can say so. */
  dropped: string[]
  width: number
  height: number
}

export const NODE_WIDTH = 156
export const NODE_HEIGHT = 76
export const COLUMN_GAP = 34
export const ROW_GAP = 18
const PADDING = 16
/** Room between wrapped lines for the connector that carries the flow from the end of one to the start of the next. */
const BAND_GAP = 40

const pitchX = NODE_WIDTH + COLUMN_GAP
const pitchY = NODE_HEIGHT + ROW_GAP

/** Whether following edges out of `from` ever reaches `to`; used to refuse an edge that would close a loop. */
function reaches(out: Map<string, string[]>, from: string, to: string) {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const at = stack.pop()!
    if (at === to) return true
    if (seen.has(at)) continue
    seen.add(at)
    stack.push(...(out.get(at) ?? []))
  }
  return false
}

/**
 * Layers by longest path: a node sits one column past its furthest predecessor, so an edge always points
 * rightwards and the eye can follow the argument without doubling back.
 */
function assignLayers(ids: string[], edges: MapEdgeInput[]) {
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]))
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of edges) {
    incoming.get(edge.to)?.push(edge.from)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const layer = new Map<string, number>(ids.map((id) => [id, 0]))
  // Repeated relaxation rather than a topological sort: the graph is acyclic and tiny, and this cannot get stuck.
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false
    for (const id of ids) {
      const best = (incoming.get(id) ?? []).reduce((highest, from) => Math.max(highest, (layer.get(from) ?? 0) + 1), 0)
      if (best !== layer.get(id)) { layer.set(id, best); changed = true }
    }
    if (!changed) break
  }
  return { layer, incoming, outgoing }
}

/** Orders each column so lines run as straight as they can: a node sits opposite the average of its neighbours. */
function orderRows(columns: string[][], incoming: Map<string, string[]>, outgoing: Map<string, string[]>) {
  const rowOf = new Map<string, number>()
  columns.forEach((column) => column.forEach((id, index) => rowOf.set(id, index)))
  const median = (id: string, neighbours: Map<string, string[]>) => {
    const rows = (neighbours.get(id) ?? []).map((other) => rowOf.get(other)).filter((row): row is number => row !== undefined)
    return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : undefined
  }
  for (let sweep = 0; sweep < 4; sweep += 1) {
    const forward = sweep % 2 === 0
    const order = forward ? columns : [...columns].reverse()
    for (const column of order) {
      const keyed = column.map((id, index) => ({ id, key: median(id, forward ? incoming : outgoing) ?? index, index }))
      keyed.sort((left, right) => left.key - right.key || left.index - right.index)
      column.splice(0, column.length, ...keyed.map((entry) => entry.id))
      column.forEach((id, index) => rowOf.set(id, index))
    }
  }
  return rowOf
}

export function layoutMap(nodes: MapNodeInput[], edges: MapEdgeInput[], maxWidth = Infinity): MapPlacement {
  const ids = nodes.map((node) => node.id)
  const known = new Set(ids)
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]))
  const kept: MapEdgeInput[] = []
  const dropped: string[] = []
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) { dropped.push(edge.id); continue }
    if (reaches(outgoing, edge.to, edge.from)) { dropped.push(edge.id); continue }
    outgoing.get(edge.from)!.push(edge.to)
    kept.push(edge)
  }

  const { layer, incoming, outgoing: forward } = assignLayers(ids, kept)
  const depth = ids.reduce((highest, id) => Math.max(highest, layer.get(id) ?? 0), 0)
  const columns: string[][] = Array.from({ length: depth + 1 }, () => [])
  for (const id of ids) columns[layer.get(id) ?? 0].push(id)
  const rowOf = orderRows(columns, incoming, forward)

  /**
   * A paper's flow is longer than a pane is wide, so the columns wrap like lines of text: still left to right,
   * but continued on the next line instead of disappearing off the edge. One line is the fallback, which is
   * what an unbounded width gives.
   */
  const perBand = Math.max(1, Math.floor((maxWidth - PADDING * 2 + COLUMN_GAP) / pitchX))
  const bands: string[][][] = []
  columns.forEach((column, index) => {
    if (index % perBand === 0) bands.push([])
    bands[bands.length - 1].push(column)
  })

  const placed: PlacedMapNode[] = []
  let top = PADDING
  let widest = 0
  bands.forEach((band, bandIndex) => {
    const tallest = band.reduce((highest, column) => Math.max(highest, column.length), 1)
    band.forEach((column, columnIndex) => {
      // Each column is centred against the tallest in its band, so a short column reads as a branch off the spine.
      const offset = (tallest - column.length) / 2
      for (const id of column) {
        const row = rowOf.get(id) ?? 0
        placed.push({
          id, band: bandIndex, layer: bandIndex * perBand + columnIndex, row,
          x: PADDING + columnIndex * pitchX, y: top + (row + offset) * pitchY,
        })
      }
    })
    widest = Math.max(widest, band.length * pitchX - COLUMN_GAP)
    top += tallest * pitchY - ROW_GAP + (bandIndex < bands.length - 1 ? BAND_GAP : 0)
  })

  return {
    nodes: placed,
    byId: new Map(placed.map((node) => [node.id, node])),
    dropped,
    width: PADDING * 2 + widest,
    height: top + PADDING,
  }
}

/**
 * A left-to-right curve between two node boxes, flat when the row does not change. An edge that continues on
 * the next line leaves to the right, runs along the gap between the lines, and comes back in from the left —
 * the same shape a sentence takes when it wraps.
 */
export function edgePath(from: PlacedMapNode, to: PlacedMapNode) {
  const x1 = from.x + NODE_WIDTH
  const y1 = from.y + NODE_HEIGHT / 2
  const x2 = to.x - 6
  const y2 = to.y + NODE_HEIGHT / 2
  if (to.band !== from.band) {
    const out = x1 + 12
    const back = Math.max(6, x2 - 12)
    const gap = from.band < to.band ? (from.y + NODE_HEIGHT + to.y) / 2 : (to.y + NODE_HEIGHT + from.y) / 2
    return `M ${x1} ${y1} H ${out} V ${gap} H ${back} V ${y2} H ${x2}`
  }
  const bend = Math.max(20, (x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}
