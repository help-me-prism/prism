import { listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { listKnowledgeRelationRecords } from './relations.js'

export type KnowledgeDataViews = {
  projects: KnowledgeNodeRecord[]
  unansweredQuestions: KnowledgeNodeRecord[]
  unsupportedClaims: KnowledgeNodeRecord[]
}

export async function listKnowledgeDataViews(libraryPath: string): Promise<KnowledgeDataViews> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const approvedEvidenceTargets = new Set((await listKnowledgeRelationRecords(libraryPath))
    .filter((relation) => relation.reviewStatus === 'approved' && (relation.type === 'supports' || relation.type === 'evidence_for'))
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

  return { projects, unansweredQuestions, unsupportedClaims }
}
