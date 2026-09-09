/** One reading destination, with every approved relationship and its mention context. */
export function connectedNoteRows(relations: KnowledgeRelationView[], backlinks: KnowledgeBacklink[]) {
  const rows = new Map<string, { id: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; relations: KnowledgeRelationView[]; excerpt?: string }>()
  for (const relation of relations) {
    if (relation.reviewStatus !== 'approved' || relation.type === 'mentions') continue
    const row = rows.get(relation.other.id) ?? { ...relation.other, relations: [] }
    if (!row.relations.some(item => item.id === relation.id)) row.relations.push(relation)
    rows.set(row.id, row)
  }
  for (const backlink of backlinks) {
    const row = rows.get(backlink.nodeId) ?? { id: backlink.nodeId, title: backlink.title, nodeType: backlink.nodeType, relativePath: backlink.relativePath, relations: [] }
    rows.set(row.id, { ...row, excerpt: backlink.excerpt })
  }
  return [...rows.values()]
}

export function connectionDescription(relation: Pick<KnowledgeRelationView, 'type' | 'origin' | 'direction'>, label: string) {
  if (relation.type === 'related') return '관련 노트'
  const outgoing = relation.direction === 'outgoing'
  if (relation.origin === 'link' || relation.type === 'link') return outgoing ? '이 노트에서 언급' : '이 노트를 언급'
  if (!outgoing && relation.type === 'raises') return '이 노트의 질문을 제기함'
  if (!outgoing && relation.type === 'answers') return '이 노트의 질문에 답함'
  if (!outgoing && relation.type === 'evidence_for') return '이 노트의 근거'
  if (relation.type === 'derived_from') return outgoing ? '이 노트의 출발점' : '이 노트에서 출발함'
  return `${outgoing ? '이 노트가' : '이 노트를'} ${label}`
}
