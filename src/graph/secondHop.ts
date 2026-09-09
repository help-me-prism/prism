export type SecondHop = { parentId: string; relation: KnowledgeRelationView }
export type SecondHopResult = { entries: SecondHop[]; limited: boolean; failures: number }
export const secondHopLimits = { neighbours: 16, entries: 24 } as const

/** Cancellation stops subsequent IPC calls; an already dispatched IPC cannot be recalled. */
export async function loadSecondHop(nodeId: string, approved: KnowledgeRelationView[], list: (id: string) => Promise<KnowledgeRelationView[]>, cancelled: () => boolean): Promise<SecondHopResult | undefined> {
  const parents = [...new Set(approved.map(edge => edge.other.id))].filter(id => id !== nodeId)
  const seen = new Set([nodeId, ...parents])
  const entries: SecondHop[] = []
  let failures = 0
  let limited = parents.length > secondHopLimits.neighbours
  for (const parentId of parents.slice(0, secondHopLimits.neighbours)) {
    if (cancelled()) return undefined
    let relations: KnowledgeRelationView[]
    try { relations = await list(parentId) } catch { if (cancelled()) return undefined; failures++; continue }
    if (cancelled()) return undefined
    for (const relation of relations) {
      if (seen.has(relation.other.id) || relation.reviewStatus !== 'approved' || relation.type === 'mentions') continue
      seen.add(relation.other.id); entries.push({ parentId, relation })
      if (entries.length === secondHopLimits.entries) { limited = true; return { entries, limited, failures } }
    }
  }
  return { entries, limited, failures }
}
