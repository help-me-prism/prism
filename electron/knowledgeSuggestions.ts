import { createHash } from 'node:crypto'
import { knowledgePlainText, listKnowledgeNodes, readKnowledgeNode, type KnowledgeNodeRecord } from './knowledge.js'
import { listKnowledgeDataViews } from './knowledgeViews.js'
import { listKnowledgeRelationRecords, type KnowledgeRelationType } from './relations.js'
import { searchResearchKnowledge } from './researchSearch.js'

export type KnowledgeSuggestionKind = 'duplicate_concept' | 'supports' | 'contradicts' | 'evidence_gap' | 'research_gap'
export type KnowledgeSuggestion = { id: string; kind: KnowledgeSuggestionKind; source: KnowledgeNodeRecord; target?: KnowledgeNodeRecord; proposedRelation?: KnowledgeRelationType; confidence: number; reason: string }

function suggestionId(kind: KnowledgeSuggestionKind, sourceId: string, targetId = '') { return `suggestion-${createHash('sha256').update(`${kind}:${sourceId}:${targetId}`).digest('hex').slice(0, 20)}` }
function linkTargets(source: string) {
  const searchable = source.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
  return [...searchable.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => ({ index: match.index ?? 0, target: match[1].split('|', 1)[0].split('#', 1)[0].replace(/\.md$/i, '').replaceAll('\\', '/').trim() }))
}
function targetNode(nodes: KnowledgeNodeRecord[], target: string) {
  const normalized = target.toLocaleLowerCase(); const base = normalized.split('/').at(-1)
  return nodes.find((node) => { const nodePath = node.relativePath.replace(/\.md$/i, '').toLocaleLowerCase(); return nodePath === normalized || (!normalized.includes('/') && nodePath.split('/').at(-1) === base) })
}

export async function suggestKnowledge(libraryPath: string, nodeId: string): Promise<KnowledgeSuggestion[]> {
  const nodes = await listKnowledgeNodes(libraryPath); const active = nodes.find((node) => node.id === nodeId)
  if (!active) throw new Error('지식 노트를 찾을 수 없습니다.')
  const relations = await listKnowledgeRelationRecords(libraryPath); const endpointPairs = new Set(relations.map((relation) => `${relation.sourceId}:${relation.targetId}`))
  const suggestions: KnowledgeSuggestion[] = []

  const activeMarkdown = (await readKnowledgeNode(libraryPath, active.id)).content
  for (const link of linkTargets(activeMarkdown)) {
    const target = targetNode(nodes, link.target); if (!target || target.nodeType !== 'claim' || endpointPairs.has(`${active.id}:${target.id}`)) continue
    const lineStart = activeMarkdown.lastIndexOf('\n', link.index) + 1; const lineEnd = activeMarkdown.indexOf('\n', link.index); const line = activeMarkdown.slice(lineStart, lineEnd < 0 ? activeMarkdown.length : lineEnd)
    const kind = /반박|모순|contradict|refut|disagree/i.test(line) ? 'contradicts' : /지지|뒷받침|근거|support|confirm|agree/i.test(line) ? 'supports' : undefined
    if (kind) suggestions.push({ id: suggestionId(kind, active.id, target.id), kind, source: active, target, proposedRelation: kind, confidence: .92, reason: `명시적 내부 링크 주변에서 '${kind === 'supports' ? '지지' : '반박'}' 표현을 찾았습니다: ${line.trim().slice(0, 160)}` })
  }

  if (active.nodeType === 'concept') {
    const activeText = knowledgePlainText(activeMarkdown).slice(0, 800)
    const matches = await searchResearchKnowledge(libraryPath, `${active.title} ${activeText}`, 20)
    for (const other of nodes.filter((node) => node.nodeType === 'concept' && node.id !== active.id && node.status !== 'archived')) {
      if (relations.some((relation) => (relation.sourceId === active.id && relation.targetId === other.id) || (relation.sourceId === other.id && relation.targetId === active.id))) continue
      const match = matches.find((result) => result.node.id === other.id)
      if (match && match.semanticScore >= .22) suggestions.push({ id: suggestionId('duplicate_concept', active.id, other.id), kind: 'duplicate_concept', source: active, target: other, proposedRelation: 'related', confidence: Math.min(.97, match.semanticScore), reason: `두 Concept의 제목과 본문 표현이 유사합니다(로컬 의미 점수 ${match.semanticScore.toFixed(2)}). 병합 여부를 검토하세요.` })
    }
  }

  const views = await listKnowledgeDataViews(libraryPath)
  for (const claim of views.unsupportedClaims.slice(0, 20)) suggestions.push({ id: suggestionId('evidence_gap', claim.id), kind: 'evidence_gap', source: claim, confidence: 1, reason: '승인된 지지 관계나 PDF 근거 카드가 없는 Claim입니다.' })
  for (const question of views.unansweredQuestions.slice(0, 20)) suggestions.push({ id: suggestionId('research_gap', question.id), kind: 'research_gap', source: question, confidence: 1, reason: '아직 정리됨 상태가 아닌 Question입니다.' })

  const order: Record<KnowledgeSuggestionKind, number> = { supports: 0, contradicts: 0, duplicate_concept: 1, evidence_gap: 2, research_gap: 3 }
  return suggestions.sort((left, right) => order[left.kind] - order[right.kind] || right.confidence - left.confidence || left.source.title.localeCompare(right.source.title))
}
