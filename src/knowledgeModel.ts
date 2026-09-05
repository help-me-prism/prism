/** Shared vocabulary for the knowledge graph UI. Kept in one place so the tree, document, and panels agree. */

export const typeLabels: Record<KnowledgeNodeType, string> = { paper: '논문', concept: '개념', claim: '주장', insight: '해석', question: '질문', project: '프로젝트' }
export const typeFolders: Record<KnowledgeNodeType, string> = { paper: 'papers', concept: 'concepts', claim: 'claims', insight: 'insights', question: 'questions', project: 'projects' }
export const statusLabels: Record<KnowledgeStatus, string> = { inbox: '수집됨', developing: '발전 중', established: '정리됨', archived: '보관됨' }
export const readingStatusLabels: Record<KnowledgeReadingStatus, string> = { to_read: '읽을 예정', reading: '읽는 중', read: '읽음', paused: '보류' }
export const levelLabels: Record<KnowledgeLevel, string> = { low: '낮음', medium: '보통', high: '높음' }
export const claimOriginLabels: Record<ClaimOrigin, string> = { paper: '논문의 주장', mine: '내 해석' }
export const evidenceKindLabels: Record<EvidenceKind, string> = { theory: '이론', experiment: '실험', anecdote: '일화', idea: '아이디어' }
export const relationLabels: Record<KnowledgeRelationType, string> = {
  defines: '정의함', uses: '사용함', supports: '지지함', contradicts: '반박함', extends: '확장함', raises: '질문 제기', answers: '답함',
  mentions: '언급함', discusses: '다룸', presents: '제시함', explains: '설명함', evidence_for: '근거임', derived_from: '출발함', related: '관련',
}
/** Types offered when creating a note. Insight and Project stay readable but are no longer authored as nodes. */
export const creatableTypes: KnowledgeNodeType[] = ['paper', 'concept', 'claim', 'question']
export const treeTypes: KnowledgeNodeType[] = ['paper', 'concept', 'claim', 'question', 'insight', 'project']
export const primaryRelationTypes: KnowledgeRelationType[] = ['defines', 'uses', 'supports', 'contradicts', 'extends', 'raises', 'answers']

/** Every relation must answer a query the researcher actually runs; pairs without one only get a plain link. */
export function relationTypesFor(source: KnowledgeNodeRecord, target: KnowledgeNodeRecord): KnowledgeRelationType[] {
  switch (`${source.nodeType}>${target.nodeType}`) {
    case 'paper>concept': return ['defines', 'uses']
    case 'claim>concept': return ['uses']
    case 'paper>claim': return ['supports', 'contradicts']
    case 'claim>claim': return ['supports', 'contradicts', 'extends']
    case 'paper>paper': case 'concept>concept': return ['extends']
    case 'paper>question': case 'claim>question': return ['raises', 'answers']
    default: return []
  }
}

/** A contradiction only means something when both claims talk about the same conditions. */
export function scopeConflict(left: KnowledgeNodeRecord, right: KnowledgeNodeRecord) {
  const differs = (a?: string, b?: string) => Boolean(a && b && a.trim().toLocaleLowerCase() !== b.trim().toLocaleLowerCase())
  if (left.nodeType !== 'claim' || right.nodeType !== 'claim') return undefined
  if (differs(left.scopeDomain, right.scopeDomain)) return `도메인이 다릅니다: '${left.scopeDomain}' vs '${right.scopeDomain}'.`
  if (differs(left.scopeRegime, right.scopeRegime)) return `조건이 다릅니다: '${left.scopeRegime}' vs '${right.scopeRegime}'.`
  return undefined
}

/** A concept that only exists because something linked to it: no body yet, waiting in the queue. */
export function isStub(node: KnowledgeNodeRecord) { return node.nodeType === 'concept' && node.status === 'inbox' }

/** The generated sections, by the heading they carry in the file — used to name what changed. */
export const autoSectionLabels: Record<string, string> = {
  overview: '한눈에', confusion: '내가 헷갈린 것', focus: '내가 주목한 것', sources: '어디서 나왔나',
  support: '지지 근거', against: '반박', answers: '지금까지 나온 답', asked: '대화에서 물어본 것',
  definition: '정의', stake: '무엇에 달려 있나',
}

export function nodePath(node: Pick<KnowledgeNodeRecord, 'relativePath'>) { return node.relativePath.replace(/\.md$/i, '') }
export function fileName(node: Pick<KnowledgeNodeRecord, 'relativePath'>) { return node.relativePath.split('/').at(-1) ?? node.relativePath }
export function splitList(value: string) { return value.split(/[,、]/).map((item) => item.trim()).filter(Boolean) }
