import { listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { listKnowledgeRelationRecords } from './relations.js'

export type KnowledgeDataViews = {
  projects: KnowledgeNodeRecord[]
  unansweredQuestions: KnowledgeNodeRecord[]
  unsupportedClaims: KnowledgeNodeRecord[]
  projectContexts: { project: KnowledgeNodeRecord; concepts: KnowledgeNodeRecord[]; insights: KnowledgeNodeRecord[] }[]
  conflictingPapers: { relationId: string; left: KnowledgeNodeRecord; right: KnowledgeNodeRecord }[]
}

export async function listKnowledgeDataViews(libraryPath: string): Promise<KnowledgeDataViews> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const approvedRelations = (await listKnowledgeRelationRecords(libraryPath)).filter((relation) => relation.reviewStatus === 'approved')
  const approvedEvidenceTargets = new Set(approvedRelations
    .filter((relation) => relation.type === 'supports' || relation.type === 'evidence_for')
    .map((relation) => relation.targetId))
  const projects = nodes.filter((node) => node.nodeType === 'project' && node.status !== 'archived')
  const unansweredQuestions = nodes.filter((node) => node.nodeType === 'question' && node.status !== 'established' && node.status !== 'archived')
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
    return {
      project,
      concepts: [...new Map(linked.filter((node) => node.nodeType === 'concept').map((node) => [node.id, node])).values()],
      insights: [...new Map(linked.filter((node) => node.nodeType === 'insight').map((node) => [node.id, node])).values()],
    }
  })
  const conflictingPapers = approvedRelations.flatMap((relation) => {
    if (relation.type !== 'contradicts') return []
    const left = nodesById.get(relation.sourceId); const right = nodesById.get(relation.targetId)
    return left?.nodeType === 'paper' && right?.nodeType === 'paper' ? [{ relationId: relation.id, left, right }] : []
  })

  return { projects, unansweredQuestions, unsupportedClaims, projectContexts, conflictingPapers }
}
