import type { KnowledgeGraphEdge, KnowledgeGraphNode } from './knowledgeGraph.js'

/**
 * The groups a vault falls into on its own.
 *
 * Label propagation was the obvious first choice and the wrong one: its answer depends on the order nodes are
 * visited, ties are broken arbitrarily, and on a well-connected vault it happily collapses everything into one
 * label. Worse, it reports nothing about how good the split is, so a meaningless partition looks exactly like a
 * meaningful one. This is modularity optimisation (Louvain's local-moving phase, repeated over the graph it
 * builds from its own result), which maximises a number — and that number is returned, so the view can say
 * "these groups are not real" instead of drawing them anyway.
 */

export type KnowledgeCluster = {
  id: string
  /** The note the group is named after, chosen for being *characteristic* rather than merely busy. */
  name: string
  nameId: string
  members: string[]
  inside: number
  crossing: number
}
export type ClusterReport = {
  clusters: KnowledgeCluster[]
  /** Newman's Q. Above ~0.3 the split means something; below it the vault is one lump and should be shown as one. */
  modularity: number
  clear: boolean
  loose: string[]
}

const meaningful = 0.3

type Link = { a: number; b: number; weight: number }

/** One pass of local moving: each node joins the neighbouring community that gains the most modularity. */
function localMoving(size: number, links: Link[], strength: number[], total: number, seed: number[]) {
  const community = [...seed]
  const communityStrength = new Array<number>(size).fill(0)
  for (let node = 0; node < size; node += 1) communityStrength[community[node]] += strength[node]
  const neighbours: Array<Array<{ node: number; weight: number }>> = Array.from({ length: size }, () => [])
  for (const link of links) {
    if (link.a === link.b) continue
    neighbours[link.a].push({ node: link.b, weight: link.weight })
    neighbours[link.b].push({ node: link.a, weight: link.weight })
  }

  let improved = true
  for (let round = 0; round < 24 && improved; round += 1) {
    improved = false
    // A fixed sweep order is what makes two runs on the same vault give the same groups.
    for (let node = 0; node < size; node += 1) {
      const current = community[node]
      const weights = new Map<number, number>()
      for (const edge of neighbours[node]) weights.set(community[edge.node], (weights.get(community[edge.node]) ?? 0) + edge.weight)
      communityStrength[current] -= strength[node]
      let best = current
      let bestGain = (weights.get(current) ?? 0) - communityStrength[current] * strength[node] / (2 * total)
      for (const [candidate, weight] of weights) {
        if (candidate === current) continue
        const gain = weight - communityStrength[candidate] * strength[node] / (2 * total)
        // Ties go to the lower index, which is the caller's order: stable, not arbitrary.
        if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && candidate < best)) { best = candidate; bestGain = gain }
      }
      communityStrength[best] += strength[node]
      if (best !== current) { community[node] = best; improved = true }
    }
  }
  return community
}

function modularityOf(links: Link[], strength: number[], community: number[], total: number) {
  if (!total) return 0
  let inside = 0
  for (const link of links) if (community[link.a] === community[link.b]) inside += link.weight * (link.a === link.b ? 1 : 2)
  const byCommunity = new Map<number, number>()
  for (let node = 0; node < strength.length; node += 1) byCommunity.set(community[node], (byCommunity.get(community[node]) ?? 0) + strength[node])
  let expected = 0
  for (const value of byCommunity.values()) expected += (value / (2 * total)) ** 2
  return inside / (2 * total) - expected
}

/**
 * Names the group after the note whose connections are *concentrated* in it. A concept every paper uses has the
 * highest degree in whatever group it lands in while describing none of them, so the score multiplies inside
 * degree by the share of that node's edges which stay inside.
 */
function nameOf(members: string[], nodes: Map<string, KnowledgeGraphNode>, inside: Map<string, number>, degree: Map<string, number>) {
  const ranked = [...members]
    .filter((id) => nodes.has(id))
    .map((id) => {
      const within = inside.get(id) ?? 0
      const all = degree.get(id) ?? 1
      const kind = nodes.get(id)!.nodeType
      // A group called after a concept says what it is about; called after a paper it only says where it started.
      const preference = kind === 'concept' ? 2.2 : kind === 'project' ? 1.4 : kind === 'paper' ? 0.8 : 0.6
      return { id, score: within * (within / all) * preference, title: nodes.get(id)!.title }
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
  return ranked[0] ?? { id: members[0], title: nodes.get(members[0])?.title ?? '이름 없음' }
}

export function clusterKnowledgeGraph(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]): ClusterReport {
  const drawn = nodes.filter((node) => edges.some((edge) => edge.sourceId === node.id || edge.targetId === node.id))
  const index = new Map(drawn.map((node, position) => [node.id, position]))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const links: Link[] = []
  const merged = new Map<string, Link>()
  for (const edge of edges) {
    const a = index.get(edge.sourceId); const b = index.get(edge.targetId)
    if (a === undefined || b === undefined || a === b) continue
    // A `[[link]]` restating a relation should not count twice, and a typed relation is the stronger claim.
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const weight = edge.origin === 'link' ? 0.6 : 1
    const existing = merged.get(key)
    if (existing) existing.weight = Math.max(existing.weight, weight)
    else { const link = { a: Math.min(a, b), b: Math.max(a, b), weight }; merged.set(key, link); links.push(link) }
  }
  if (!drawn.length || !links.length) return { clusters: [], modularity: 0, clear: false, loose: nodes.map((node) => node.id) }

  const strength = new Array<number>(drawn.length).fill(0)
  for (const link of links) { strength[link.a] += link.weight; strength[link.b] += link.weight }
  const total = links.reduce((sum, link) => sum + link.weight, 0)

  // Local moving, then the same again on the graph of the communities it found — one aggregation level is
  // enough to pull a vault of a few thousand notes into groups a person can hold in their head.
  let community = localMoving(drawn.length, links, strength, total, drawn.map((_, position) => position))
  for (let level = 0; level < 2; level += 1) {
    const labels = [...new Set(community)].sort((left, right) => left - right)
    const compact = new Map(labels.map((label, position) => [label, position]))
    const superLinks = new Map<string, Link>()
    for (const link of links) {
      const a = compact.get(community[link.a])!; const b = compact.get(community[link.b])!
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const existing = superLinks.get(key)
      if (existing) existing.weight += link.weight
      else superLinks.set(key, { a: Math.min(a, b), b: Math.max(a, b), weight: link.weight })
    }
    const superList = [...superLinks.values()]
    const superStrength = new Array<number>(labels.length).fill(0)
    for (const link of superList) {
      superStrength[link.a] += link.weight
      if (link.a !== link.b) superStrength[link.b] += link.weight
    }
    const moved = localMoving(labels.length, superList, superStrength, total, labels.map((_, position) => position))
    const next = community.map((label) => moved[compact.get(label)!])
    if (next.every((label, position) => label === community[position])) break
    community = next
  }

  const modularity = modularityOf(links, strength, community, total)
  const inside = new Map<string, number>()
  const degree = new Map<string, number>()
  for (const link of links) {
    const a = drawn[link.a].id; const b = drawn[link.b].id
    degree.set(a, (degree.get(a) ?? 0) + 1); degree.set(b, (degree.get(b) ?? 0) + 1)
    if (community[link.a] === community[link.b]) {
      inside.set(a, (inside.get(a) ?? 0) + 1); inside.set(b, (inside.get(b) ?? 0) + 1)
    }
  }

  const grouped = new Map<number, string[]>()
  drawn.forEach((node, position) => {
    const label = community[position]
    if (!grouped.has(label)) grouped.set(label, [])
    grouped.get(label)!.push(node.id)
  })

  const loose: string[] = nodes.filter((node) => !index.has(node.id)).map((node) => node.id)
  const clusters: KnowledgeCluster[] = []
  for (const members of grouped.values()) {
    if (members.length < 2) { loose.push(...members); continue }
    const named = nameOf(members, byId, inside, degree)
    let insideCount = 0; let crossing = 0
    for (const link of links) {
      const a = drawn[link.a].id; const b = drawn[link.b].id
      const hasA = members.includes(a); const hasB = members.includes(b)
      if (hasA && hasB) insideCount += 1
      else if (hasA || hasB) crossing += 1
    }
    clusters.push({ id: named.id, name: named.title, nameId: named.id, members, inside: insideCount, crossing })
  }
  clusters.sort((left, right) => right.members.length - left.members.length || left.name.localeCompare(right.name))
  return { clusters, modularity: Number(modularity.toFixed(4)), clear: modularity >= meaningful && clusters.length > 1, loose }
}
