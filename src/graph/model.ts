import { nodeRadius } from './palette'

/**
 * What the graph shows, and what it leaves out. Both graphs go through here so the panel and the full view
 * can never disagree about whether an unapproved AI proposal counts as an edge.
 */

export type GraphFilter = {
  types: Set<KnowledgeNodeType>
  /** `[[link]]` edges: what the researcher wrote, without a relation type on it. */
  showLinks: boolean
  /** AI proposals still waiting for a decision, plus automatically extracted `mentions`. */
  showProposed: boolean
  hideIsolated: boolean
  query: string
}

export type GraphViewNode = KnowledgeGraphNode & { degree: number; radius: number; match: boolean }
export type GraphViewEdge = KnowledgeGraphEdge & { approved: boolean }
export type GraphView = { nodes: GraphViewNode[]; edges: GraphViewEdge[]; hidden: number }

export const allNodeTypes: KnowledgeNodeType[] = ['paper', 'concept', 'claim', 'question', 'insight', 'project']

export function defaultGraphFilter(): GraphFilter {
  return { types: new Set(allNodeTypes), showLinks: true, showProposed: false, hideIsolated: true, query: '' }
}

function keeps(edge: KnowledgeGraphEdge, filter: GraphFilter) {
  if (edge.reviewStatus === 'rejected') return false
  if (edge.origin === 'link') return filter.showLinks
  if (edge.type === 'mentions' || edge.reviewStatus === 'pending') return filter.showProposed
  return true
}

/**
 * Filters, counts degree, and marks search hits. A search never removes nodes — the point of a graph is
 * where the match sits among everything else, so the view dims the rest instead.
 */
export function graphView(graph: KnowledgeGraph, filter: GraphFilter): GraphView {
  const visible = new Map<string, KnowledgeGraphNode>()
  for (const node of graph.nodes) if (filter.types.has(node.nodeType)) visible.set(node.id, node)
  const edges = graph.edges
    .filter((edge) => visible.has(edge.sourceId) && visible.has(edge.targetId) && keeps(edge, filter))
    .map((edge) => ({ ...edge, approved: edge.reviewStatus === 'approved' && edge.type !== 'mentions' }))

  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1)
  }

  const text = filter.query.trim().toLocaleLowerCase()
  const nodes: GraphViewNode[] = []
  let hidden = 0
  for (const node of visible.values()) {
    const count = degree.get(node.id) ?? 0
    if (filter.hideIsolated && count === 0) { hidden += 1; continue }
    nodes.push({ ...node, degree: count, radius: nodeRadius(count), match: Boolean(text) && node.title.toLocaleLowerCase().includes(text) })
  }
  return { nodes, edges, hidden }
}

/** Everything within `hops` of one node, for the panel graph and for focusing the full view on a note. */
export function neighbourhood(view: GraphView, centerId: string, hops: number): GraphView {
  if (!view.nodes.some((node) => node.id === centerId)) return { nodes: [], edges: [], hidden: view.hidden }
  const reached = new Set([centerId])
  let frontier = new Set([centerId])
  for (let hop = 0; hop < hops; hop += 1) {
    const next = new Set<string>()
    for (const edge of view.edges) {
      if (frontier.has(edge.sourceId) && !reached.has(edge.targetId)) { reached.add(edge.targetId); next.add(edge.targetId) }
      if (frontier.has(edge.targetId) && !reached.has(edge.sourceId)) { reached.add(edge.sourceId); next.add(edge.sourceId) }
    }
    frontier = next
    if (!frontier.size) break
  }
  return {
    nodes: view.nodes.filter((node) => reached.has(node.id)),
    edges: view.edges.filter((edge) => reached.has(edge.sourceId) && reached.has(edge.targetId)),
    hidden: view.hidden,
  }
}

/** The neighbours of one node, named — the selection panel of the full view lists these. */
export function neighbours(view: GraphView, nodeId: string) {
  const byId = new Map(view.nodes.map((node) => [node.id, node]))
  const result: Array<{ node: GraphViewNode; edge: GraphViewEdge; direction: 'outgoing' | 'incoming' }> = []
  for (const edge of view.edges) {
    if (edge.sourceId === nodeId) { const other = byId.get(edge.targetId); if (other) result.push({ node: other, edge, direction: 'outgoing' }) }
    else if (edge.targetId === nodeId) { const other = byId.get(edge.sourceId); if (other) result.push({ node: other, edge, direction: 'incoming' }) }
  }
  return result.sort((left, right) => right.node.degree - left.node.degree)
}
