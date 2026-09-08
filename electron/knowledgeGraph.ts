import { readVaultSnapshot, type KnowledgeNodeRecord, type KnowledgeStatus, type VaultSnapshot } from './knowledge.js'
import { listKnowledgeRelationRecords, type KnowledgeRelationRecord, type KnowledgeRelationType, type RelationOrigin } from './relations.js'
import { type KnowledgeNodeType } from './templates.js'
import { clusterKnowledgeGraph, type ClusterReport } from './knowledgeClusters.js'
import { missingLinksFrom, type SimilarityReport } from './knowledgeSimilarity.js'

export type KnowledgeGraphNode = { id: string; title: string; nodeType: KnowledgeNodeType; status: KnowledgeStatus; relativePath: string; modifiedAt: number }
export type KnowledgeGraphEdge = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; origin: RelationOrigin; creator: 'user' | 'ai'; reviewStatus: 'pending' | 'approved' | 'rejected' }
export type KnowledgeGraph = { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[]; generatedAt: string }
/** What the graph can say about itself: the groups it falls into, and the links it looks like it is missing. */
export type KnowledgeGraphInsights = { clusters: ClusterReport; similar: SimilarityReport }

function compact(record: KnowledgeNodeRecord): KnowledgeGraphNode {
  return { id: record.id, title: record.title, nodeType: record.nodeType, status: record.status, relativePath: record.relativePath, modifiedAt: record.modifiedAt }
}

/**
 * The whole vault as one graph, read in a single pass: the node list and the link map come from the shared
 * snapshot, the typed edges from the relation sidecar. Nothing here filters by review state — the view decides
 * which layers it is showing, and it can only do that if it is given all of them at once.
 *
 * `[[link]]` edges are also derived live from note content, not only from the sidecar. `syncLinkRelations`
 * records them when Prism saves a note, but the same vault is edited in Obsidian, where nothing runs. A link
 * written there is still a link the researcher wrote, so the graph shows it.
 */
export async function listKnowledgeGraph(libraryPath: string): Promise<KnowledgeGraph> {
  const [snapshot, relations] = await Promise.all([readVaultSnapshot(libraryPath), listKnowledgeRelationRecords(libraryPath)])
  return buildGraph(snapshot, relations)
}

/**
 * The groups and the near-misses, from the same single walk of the vault the graph itself costs. Both are
 * derived rather than stored: nothing here writes to the library, and a stale answer is one refresh away.
 */
export async function listKnowledgeGraphInsights(libraryPath: string): Promise<KnowledgeGraphInsights> {
  const [snapshot, relations] = await Promise.all([readVaultSnapshot(libraryPath), listKnowledgeRelationRecords(libraryPath)])
  const graph = buildGraph(snapshot, relations)
  const linked = new Set(graph.edges
    .filter((edge) => edge.reviewStatus !== 'rejected')
    .map((edge) => (edge.sourceId < edge.targetId ? `${edge.sourceId}|${edge.targetId}` : `${edge.targetId}|${edge.sourceId}`)))
  return {
    clusters: clusterKnowledgeGraph(graph.nodes, graph.edges.filter((edge) => edge.reviewStatus === 'approved' && edge.type !== 'mentions')),
    similar: missingLinksFrom(snapshot.records, (id) => snapshot.contents.get(id) ?? '', { linked }),
  }
}

function buildGraph(snapshot: VaultSnapshot, relations: KnowledgeRelationRecord[]): KnowledgeGraph {
  const nodes = snapshot.records.map(compact)
  const known = new Set(nodes.map((node) => node.id))
  const edges: KnowledgeGraphEdge[] = []
  const pairs = new Set<string>()

  // Two notes are one pair however the relation points: a link is only news when nothing already joins them.
  const pair = (left: string, right: string) => (left < right ? `${left}|${right}` : `${right}|${left}`)

  for (const relation of relations) {
    if (!known.has(relation.sourceId) || !known.has(relation.targetId)) continue
    edges.push({ id: relation.id, sourceId: relation.sourceId, targetId: relation.targetId, type: relation.type, origin: relation.origin ?? 'manual', creator: relation.creator, reviewStatus: relation.reviewStatus })
    if (relation.reviewStatus !== 'rejected') pairs.add(pair(relation.sourceId, relation.targetId))
  }

  /**
   * The generated `관계` sections write every relation back into both notes as a `[[link]]`, so a graph that
   * counted them would draw each relation twice — once typed, once as a faint line pointing the other way.
   */
  for (const [targetId, backlinks] of snapshot.backlinks) {
    if (!known.has(targetId)) continue
    for (const backlink of backlinks) {
      const key = pair(backlink.nodeId, targetId)
      if (!known.has(backlink.nodeId) || pairs.has(key)) continue
      pairs.add(key)
      edges.push({ id: `link-${backlink.nodeId}-${targetId}`, sourceId: backlink.nodeId, targetId, type: 'link', origin: 'link', creator: 'user', reviewStatus: 'approved' })
    }
  }

  return { nodes, edges, generatedAt: new Date().toISOString() }
}
