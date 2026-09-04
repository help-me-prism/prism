import { listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { listKnowledgeRelationRecords } from './relations.js'

export type KnowledgeDataViews = {
  projects: KnowledgeNodeRecord[]
  unansweredQuestions: KnowledgeNodeRecord[]
  unsupportedClaims: KnowledgeNodeRecord[]
  projectContexts: { project: KnowledgeNodeRecord; concepts: KnowledgeNodeRecord[]; insights: KnowledgeNodeRecord[] }[]
  conflictingPapers: { relationId: string; left: KnowledgeNodeRecord; right: KnowledgeNodeRecord }[]
}

const unique = (nodes: KnowledgeNodeRecord[]) => [...new Map(nodes.map((node) => [node.id, node])).values()]

export async function listKnowledgeDataViews(libraryPath: string): Promise<KnowledgeDataViews> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const approvedRelations = (await listKnowledgeRelationRecords(libraryPath)).filter((relation) => relation.reviewStatus === 'approved')
  const approvedEvidenceTargets = new Set(approvedRelations
    .filter((relation) => relation.type === 'supports' || relation.type === 'evidence_for')
    .map((relation) => relation.targetId))
  const answeredQuestions = new Set(approvedRelations.filter((relation) => relation.type === 'answers').map((relation) => relation.targetId))
  const projects = nodes.filter((node) => node.nodeType === 'project' && node.status !== 'archived')
  const unansweredQuestions = nodes.filter((node) => node.nodeType === 'question' && node.status !== 'established' && node.status !== 'archived' && !answeredQuestions.has(node.id))
  const unsupportedClaims: KnowledgeNodeRecord[] = []

  for (const claim of nodes.filter((node) => node.nodeType === 'claim' && node.status !== 'archived')) {
    const snapshot = await readKnowledgeNode(libraryPath, claim.id)
    const hasEmbeddedEvidence = /<!--\s*prism-evidence:[^>]+-->/.test(snapshot.content)
    if (hasEmbeddedEvidence) continue
    if (!approvedEvidenceTargets.has(claim.id)) unsupportedClaims.push(claim)
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const projectContexts = projects.map((project) => {
    const linked = approvedRelations.flatMap((relation) => relation.sourceId === project.id ? [nodesById.get(relation.targetId)] : relation.targetId === project.id ? [nodesById.get(relation.sourceId)] : []).filter((node): node is KnowledgeNodeRecord => Boolean(node))
    // Nodes may also opt into a project through the `projects` frontmatter list instead of a Project node relation.
    const tagged = nodes.filter((node) => node.id !== project.id && node.projects?.some((name) => name.toLocaleLowerCase() === project.title.toLocaleLowerCase()))
    const all = [...linked, ...tagged]
    return {
      project,
      concepts: unique(all.filter((node) => node.nodeType === 'concept')),
      insights: unique(all.filter((node) => node.nodeType === 'insight' || (node.nodeType === 'claim' && node.claimOrigin === 'mine'))),
    }
  })

  const conflictingPapers: KnowledgeDataViews['conflictingPapers'] = []
  const seenPairs = new Set<string>()
  const addPair = (relationId: string, left: KnowledgeNodeRecord, right: KnowledgeNodeRecord) => {
    const key = `${left.id}:${right.id}`
    if (left.id === right.id || seenPairs.has(key)) return
    seenPairs.add(key); conflictingPapers.push({ relationId, left, right })
  }
  // Legacy direct Paper ↔ Paper contradictions.
  for (const relation of approvedRelations) {
    if (relation.type !== 'contradicts') continue
    const left = nodesById.get(relation.sourceId); const right = nodesById.get(relation.targetId)
    if (left?.nodeType === 'paper' && right?.nodeType === 'paper') addPair(relation.id, left, right)
  }
  // Claim-level opposition: one Paper supports a Claim that another Paper contradicts.
  const byClaim = new Map<string, { supports: KnowledgeNodeRecord[]; contradicts: Array<{ relationId: string; paper: KnowledgeNodeRecord }> }>()
  for (const relation of approvedRelations) {
    const source = nodesById.get(relation.sourceId); const target = nodesById.get(relation.targetId)
    if (source?.nodeType !== 'paper' || target?.nodeType !== 'claim') continue
    const entry = byClaim.get(target.id) ?? { supports: [], contradicts: [] }
    if (relation.type === 'supports') entry.supports.push(source)
    else if (relation.type === 'contradicts') entry.contradicts.push({ relationId: relation.id, paper: source })
    byClaim.set(target.id, entry)
  }
  for (const entry of byClaim.values()) for (const left of entry.supports) for (const right of entry.contradicts) addPair(right.relationId, left, right.paper)

  return { projects, unansweredQuestions, unsupportedClaims, projectContexts, conflictingPapers }
}
