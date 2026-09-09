export type SecondHop = { parentId: string; relation: KnowledgeRelationView }
export type SecondHopResult = { entries: SecondHop[]; limited: boolean; failures: number }
export const secondHopLimits = { neighbours: 16, entries: 24 } as const

/** Cancellation stops subsequent IPC calls; an already dispatched IPC cannot be recalled. */
export async function loadSecondHop(nodeId: string, approved: KnowledgeRelationView[], list: (id: string) => Promise<KnowledgeRelationView[]>, cancelled: () => boolean): Promise<SecondHopResult | undefined> {
  const parents = [...new Set(approved.map(edge => edge.other.id))].filter(id => id !== nodeId)
  // Visiting a node and drawing an edge are different operations. Distinct
  // parents may support AND contradict the same target; preserve both edges.
  // Direct edges are already rendered, and inverse views share the same ID.
  const seenEdges = new Set(approved.map(edge => edge.id))
  const entries: SecondHop[] = []
  let failures = 0
  let limited = parents.length > secondHopLimits.neighbours
  for (const parentId of parents.slice(0, secondHopLimits.neighbours)) {
    if (cancelled()) return undefined
    let relations: KnowledgeRelationView[]
    try { relations = await list(parentId) } catch { if (cancelled()) return undefined; failures++; continue }
    if (cancelled()) return undefined
    for (const relation of relations) {
      if (seenEdges.has(relation.id) || relation.reviewStatus !== 'approved' || relation.type === 'mentions') continue
      if (entries.length === secondHopLimits.entries) return { entries, limited: true, failures }
      seenEdges.add(relation.id); entries.push({ parentId, relation })
    }
  }
  return { entries, limited, failures }
}
