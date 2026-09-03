import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FilePlus2, Inbox, LayoutDashboard, Link2, Network, RefreshCw, Search, Lightbulb, Save, Sparkles, PanelsTopLeft, Trash2, X } from 'lucide-react'
import CurationQueue from './CurationQueue'
import MarkdownEditor, { type MarkdownEditorHandle, type MarkdownSlashAction } from './MarkdownEditor'
import { embeddedEvidence, evidenceMarkdown, evidenceTypeLabel, removeEvidence, replaceEvidence, type EmbeddedEvidence } from './evidence'

const typeLabels: Record<KnowledgeNodeType, string> = { paper: 'Paper', concept: 'Concept', claim: 'Claim', insight: 'Insight', question: 'Question', project: 'Project' }
const statusLabels: Record<KnowledgeStatus, string> = { inbox: 'Inbox', developing: '발전 중', established: '정리됨', archived: '보관됨' }
const readingStatusLabels: Record<KnowledgeReadingStatus, string> = { to_read: '읽을 예정', reading: '읽는 중', read: '읽음', paused: '보류' }
const levelLabels: Record<KnowledgeLevel, string> = { low: '낮음', medium: '보통', high: '높음' }
const creatableTypes: KnowledgeNodeType[] = ['paper', 'concept', 'claim', 'question']
const claimOriginLabels: Record<ClaimOrigin, string> = { paper: '논문의 주장', mine: '내 해석' }
const evidenceKindLabels: Record<EvidenceKind, string> = { theory: '이론', experiment: '실험', anecdote: '일화', idea: '아이디어' }
const relationLabels: Record<KnowledgeRelationType, string> = { defines: '정의함', uses: '사용함', supports: '지지함', contradicts: '반박함', extends: '확장함', raises: '질문 제기', answers: '답함', mentions: '언급함', discusses: '다룸', presents: '제시함', explains: '설명함', evidence_for: '근거임', derived_from: '출발함', related: '관련' }
const primaryRelationTypes: KnowledgeRelationType[] = ['defines', 'uses', 'supports', 'contradicts', 'extends', 'raises', 'answers']
// Every relation must answer a query the researcher actually runs; pairs without one only get a plain link.
function relationTypesFor(source: KnowledgeNodeRecord, target: KnowledgeNodeRecord): KnowledgeRelationType[] {
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
// A contradiction only means something when both claims talk about the same conditions.
function scopeConflict(left: KnowledgeNodeRecord, right: KnowledgeNodeRecord) {
  const differs = (a?: string, b?: string) => Boolean(a && b && a.trim().toLocaleLowerCase() !== b.trim().toLocaleLowerCase())
  if (left.nodeType !== 'claim' || right.nodeType !== 'claim') return undefined
  if (differs(left.scopeDomain, right.scopeDomain)) return `도메인이 다릅니다: '${left.scopeDomain}' vs '${right.scopeDomain}'.`
  if (differs(left.scopeRegime, right.scopeRegime)) return `조건이 다릅니다: '${left.scopeRegime}' vs '${right.scopeRegime}'.`
  return undefined
}
const suggestionLabels: Record<KnowledgeSuggestion['kind'], string> = { duplicate_concept: '중복 개념', supports: '지지 관계', contradicts: '반박 관계', evidence_gap: '근거 공백', research_gap: '연구 질문' }

export default function KnowledgeManager({ onClose, initialNodeId, initialView }: { onClose: () => void; initialNodeId?: string; initialView?: 'curation' }) {
  const [nodes, setNodes] = useState<KnowledgeNodeRecord[]>([])
  const [curationOpen, setCurationOpen] = useState(initialView === 'curation')
  const [curationCount, setCurationCount] = useState<number>()
  const [settings, setSettings] = useState<AppSettings>()
  const [modelRunning, setModelRunning] = useState(false)
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [snapshot, setSnapshot] = useState<NoteSnapshot>()
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<KnowledgeNodeType>('concept')
  const [newTemplateId, setNewTemplateId] = useState('')
  const [newVariables, setNewVariables] = useState<Record<string, string>>({})
  const [deleteReady, setDeleteReady] = useState(false)
  const [error, setError] = useState('')
  const [anchors, setAnchors] = useState<EvidenceAnchor[]>([])
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceQuery, setEvidenceQuery] = useState('')
  const [evidenceType, setEvidenceType] = useState<EvidenceAnchorRef['type'] | 'all'>('all')
  const [relinking, setRelinking] = useState<EmbeddedEvidence>()
  const [promoting, setPromoting] = useState<EmbeddedEvidence>()
  const [copying, setCopying] = useState<EmbeddedEvidence>()
  const [copyQuery, setCopyQuery] = useState('')
  const [claimingEvidence, setClaimingEvidence] = useState<EmbeddedEvidence>()
  const [evidenceClaimQuery, setEvidenceClaimQuery] = useState('')
  const [evidenceRelationType, setEvidenceRelationType] = useState<'supports' | 'contradicts' | 'extends'>('supports')
  const [promotionType, setPromotionType] = useState<'claim' | 'question'>('claim')
  const [promotionTitle, setPromotionTitle] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkRelationType, setLinkRelationType] = useState<KnowledgeRelationType | 'none'>('none')
  const [backlinks, setBacklinks] = useState<KnowledgeBacklink[]>([])
  const [allRelations, setRelations] = useState<KnowledgeRelationView[]>([])
  const [showAutoRelations, setShowAutoRelations] = useState(false)
  const [pendingContradiction, setPendingContradiction] = useState<{ message: string; run: () => Promise<void> }>()
  const relations = useMemo(() => allRelations.filter((item) => showAutoRelations || item.type !== 'mentions'), [allRelations, showAutoRelations])
  const [relationOpen, setRelationOpen] = useState(false)
  const [relationQuery, setRelationQuery] = useState('')
  const [relationType, setRelationType] = useState<KnowledgeRelationType>('uses')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphHops, setGraphHops] = useState<1 | 2>(1)
  const [graphTypes, setGraphTypes] = useState<Set<KnowledgeNodeType>>(() => new Set(['paper', 'concept', 'claim', 'question', 'insight', 'project']))
  const [graphRelationTypes, setGraphRelationTypes] = useState<Set<KnowledgeRelationType>>(() => new Set())
  const [secondHop, setSecondHop] = useState<Array<{ parentId: string; relation: KnowledgeRelationView }>>([])
  const [dataViewOpen, setDataViewOpen] = useState(false)
  const [dataViews, setDataViews] = useState<KnowledgeDataViews>({ projects: [], unansweredQuestions: [], unsupportedClaims: [], projectContexts: [], conflictingPapers: [] })
  const [viewsLoading, setViewsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [sectionTemplateOpen, setSectionTemplateOpen] = useState(false)
  const [sectionTemplateId, setSectionTemplateId] = useState('')
  const loadingRef = useRef(0)
  const searchRef = useRef(0)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const active = nodes.find((node) => node.id === activeId)
  const availableRelationTypes = useMemo(() => active ? primaryRelationTypes.filter((type) => nodes.some((node) => node.id !== active.id && relationTypesFor(active, node).includes(type))) : [] as KnowledgeRelationType[], [active, nodes])
  const compatibleTemplates = useMemo(() => templates.filter((template) => template.nodeType === newType).sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite) || (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0) || Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name)), [templates, newType])
  const activeTemplates = useMemo(() => templates.filter((template) => template.nodeType === active?.nodeType), [templates, active?.nodeType])
  const linkedEvidence = useMemo(() => embeddedEvidence(content), [content])
  const graphEdges = useMemo(() => relations.filter((item) => graphTypes.has(item.other.nodeType) && (graphRelationTypes.size === 0 || graphRelationTypes.has(item.type))), [relations, graphTypes, graphRelationTypes])
  const graphEdgeKey = graphEdges.map((item) => item.id).join(',')
  useEffect(() => {
    if (!graphOpen || graphHops !== 2 || !active) { setSecondHop([]); return }
    let disposed = false
    void (async () => {
      const results: Array<{ parentId: string; relation: KnowledgeRelationView }> = []; const seen = new Set<string>([active.id, ...graphEdges.map((item) => item.other.id)])
      for (const edge of graphEdges) {
        try {
          for (const relation of await window.prism.listKnowledgeRelations(edge.other.id)) {
            if (seen.has(relation.other.id) || relation.reviewStatus !== 'approved' || relation.type === 'mentions' || !graphTypes.has(relation.other.nodeType)) continue
            seen.add(relation.other.id); results.push({ parentId: edge.other.id, relation })
          }
        } catch { /* a neighbour may have been deleted meanwhile */ }
      }
      if (!disposed) setSecondHop(results.slice(0, 36))
    })()
    return () => { disposed = true }
  }, [graphOpen, graphHops, active?.id, graphEdgeKey, graphTypes])
  const matchingNodes = useMemo(() => {
    const query = linkQuery.trim().toLocaleLowerCase()
    return nodes.filter((node) => node.id !== activeId && active && (linkRelationType === 'none' || relationTypesFor(active, node).includes(linkRelationType)) && (!query || `${node.title} ${node.nodeType} ${node.relativePath}`.toLocaleLowerCase().includes(query))).slice(0, 60)
  }, [nodes, activeId, active, linkQuery, linkRelationType])
  const matchingRelationNodes = useMemo(() => {
    const query = relationQuery.trim().toLocaleLowerCase()
    return nodes.filter((node) => node.id !== activeId && active && relationTypesFor(active, node).includes(relationType) && (!query || `${node.title} ${node.nodeType} ${node.relativePath}`.toLocaleLowerCase().includes(query))).slice(0, 60)
  }, [nodes, activeId, active, relationQuery, relationType])
  const visibleNodes = searchQuery.trim() ? searchResults.map((result) => result.node) : nodes
  const matchingAnchors = useMemo(() => {
    const query = evidenceQuery.trim().toLocaleLowerCase()
    return anchors.filter((anchor) => (evidenceType === 'all' || anchor.type === evidenceType) && (!query || `${anchor.paperTitle} ${anchor.label} ${anchor.source}`.toLocaleLowerCase().includes(query))).slice(0, 80)
  }, [anchors, evidenceQuery, evidenceType])
  const copyTargets = useMemo(() => {
    const query = copyQuery.trim().toLocaleLowerCase()
    return nodes.filter((node) => node.id !== activeId && (!query || `${node.title} ${node.nodeType} ${node.relativePath}`.toLocaleLowerCase().includes(query))).slice(0, 60)
  }, [nodes, activeId, copyQuery])
  const evidenceClaimTargets = useMemo(() => {
    const query = evidenceClaimQuery.trim().toLocaleLowerCase()
    return nodes.filter((node) => node.nodeType === 'claim' && node.id !== activeId && (!query || `${node.title} ${node.relativePath} ${node.preview}`.toLocaleLowerCase().includes(query))).slice(0, 60)
  }, [nodes, activeId, evidenceClaimQuery])
  const editorEvidenceLinks = useMemo(() => anchors.filter((anchor) => !linkedEvidence.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId)).map((anchor) => ({ id: `${anchor.paperId}-${anchor.anchorId}`, label: anchor.label, description: `${evidenceTypeLabel(anchor.type)} · ${anchor.paperTitle} · p.${anchor.page}`, searchText: `${anchor.paperTitle} ${anchor.source}`, markdown: evidenceMarkdown(anchor) })), [anchors, linkedEvidence])
  const viewSections = [
    { key: 'projects', title: '프로젝트', description: '진행 중인 연구 문맥', empty: '진행 중인 Project가 없습니다.', items: dataViews.projects },
    { key: 'contexts', title: '프로젝트 지식 문맥', description: '승인된 관계 또는 projects 속성으로 연결된 Concept과 내 해석', empty: '프로젝트에 연결된 개념과 아이디어가 없습니다.', items: dataViews.projectContexts.flatMap((context) => [...context.concepts, ...context.insights].map((node) => ({ ...node, title: `${context.project.title} · ${node.title}` }))) },
    { key: 'conflicts', title: '충돌하는 논문', description: '승인된 반박 관계의 Paper 쌍', empty: '서로 반박하는 Paper가 없습니다.', items: dataViews.conflictingPapers.map((pair) => ({ ...pair.left, title: `${pair.left.title} ↔ ${pair.right.title}`, relativePath: `${pair.left.relativePath} · ${pair.right.relativePath}` })) },
    { key: 'questions', title: '미완성 질문', description: '아직 정리되지 않은 Question', empty: '열린 Question이 없습니다.', items: dataViews.unansweredQuestions },
    { key: 'claims', title: '근거 없는 Claim', description: 'PDF 근거나 승인된 지지가 필요함', empty: '모든 Claim에 근거가 있습니다.', items: dataViews.unsupportedClaims },
  ]

  useEffect(() => {
    Promise.all([window.prism.listKnowledgeNodes(), window.prism.listTemplates(), window.prism.listEvidenceAnchors(), window.prism.listKnowledgeDataViews()]).then(([items, availableTemplates, availableAnchors, availableViews]) => {
      setNodes(items); setTemplates(availableTemplates); setAnchors(availableAnchors); setDataViews(availableViews)
      const initial = items.find((item) => item.id === initialNodeId) ?? items[0]
      if (initial && initialView !== 'curation') void openNode(initial.id, true)
    }).catch((reason) => setError(String(reason)))
    window.prism.listCurationQueue().then((queue) => setCurationCount(queue.total)).catch(() => undefined)
    window.prism.getSettings().then(setSettings).catch(() => undefined)
  }, [])
  useEffect(() => { if (initialNodeId && initialNodeId !== activeId) void openNode(initialNodeId) }, [initialNodeId])
  useEffect(() => {
    const query = searchQuery.trim(); const request = ++searchRef.current
    if (!query) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    const timeout = window.setTimeout(() => window.prism.searchResearchKnowledge(query).then((results) => { if (request === searchRef.current) { setSearchResults(results); setSearching(false) } }).catch((reason) => { if (request === searchRef.current) { setSearching(false); setError(String(reason)) } }), 160)
    return () => window.clearTimeout(timeout)
  }, [searchQuery, nodes.length])
  useEffect(() => {
    const preferred = compatibleTemplates.find((template) => template.isDefault) ?? compatibleTemplates[0]
    setNewTemplateId(preferred?.id ?? '')
  }, [newType, compatibleTemplates])
  useEffect(() => {
    if (!activeTemplates.length) { setSectionTemplateId(''); return }
    if (!activeTemplates.some((template) => template.id === sectionTemplateId)) setSectionTemplateId(activeTemplates.find((template) => template.id === active?.templateId)?.id ?? activeTemplates.find((template) => template.isDefault)?.id ?? activeTemplates[0].id)
  }, [active?.id, active?.templateId, activeTemplates, sectionTemplateId])

  async function openNode(id: string, force = false) {
    if (dirty && !force) { setError('현재 노트를 저장하거나 변경을 취소한 뒤 이동하세요.'); return }
    const request = ++loadingRef.current
    try {
      const [next, nextBacklinks, nextRelations] = await Promise.all([window.prism.readKnowledgeNode(id), window.prism.listKnowledgeBacklinks(id), window.prism.listKnowledgeRelations(id)])
      if (request !== loadingRef.current) return
      const nextNode = nodes.find((node) => node.id === id); const suitable = templates.filter((template) => template.nodeType === nextNode?.nodeType)
      setActiveId(id); setSnapshot(next); setContent(next.content); setBacklinks(nextBacklinks); setRelations(nextRelations); setDirty(false); setCreating(false); setCurationOpen(false); setDeleteReady(false); setLinkOpen(false); setRelationOpen(false); setGraphOpen(false); setSuggestionsOpen(false); setSectionTemplateOpen(false); setCopying(undefined); setCopyQuery(''); setClaimingEvidence(undefined); setEvidenceClaimQuery(''); setSectionTemplateId(suitable.find((template) => template.id === nextNode?.templateId)?.id ?? suitable.find((template) => template.isDefault)?.id ?? suitable[0]?.id ?? ''); setDataViewOpen(false); setError('')
    } catch (reason) { setError(String(reason)) }
  }
  function startCreate() {
    if (dirty) { setError('현재 노트를 저장하거나 변경을 취소한 뒤 새 노트를 만드세요.'); return }
    setCreating(true); setDataViewOpen(false); setCurationOpen(false); setSuggestionsOpen(false); setActiveId(undefined); setSnapshot(undefined); setContent(''); setNewTitle(''); setNewVariables({}); setDeleteReady(false); setError('')
  }
  async function openDataViews() {
    if (dirty) { setError('현재 노트를 저장하거나 변경을 취소한 뒤 데이터 보기를 여세요.'); return }
    setDataViewOpen(true); setCurationOpen(false); setCreating(false); setViewsLoading(true); setLinkOpen(false); setRelationOpen(false); setGraphOpen(false); setSuggestionsOpen(false); setError('')
    try { setDataViews(await window.prism.listKnowledgeDataViews()) }
    catch (reason) { setError(String(reason)) }
    finally { setViewsLoading(false) }
  }
  function openCuration() {
    if (dirty) { setError('현재 노트를 저장하거나 변경을 취소한 뒤 정리 대기열을 여세요.'); return }
    setCurationOpen(true); setDataViewOpen(false); setCreating(false); setLinkOpen(false); setRelationOpen(false); setGraphOpen(false); setSuggestionsOpen(false); setError('')
  }
  async function refreshAfterCuration() {
    setNodes(await window.prism.listKnowledgeNodes()); setDataViews(await window.prism.listKnowledgeDataViews()); setAnchors(await window.prism.listEvidenceAnchors())
  }
  async function create() {
    if (!newTitle.trim()) { setError('새 지식 노트의 제목을 입력하세요.'); return }
    try {
      const variables = Object.fromEntries(Object.entries(newVariables).filter(([, value]) => value.trim()))
      const result = await window.prism.createKnowledgeNode({ title: newTitle, nodeType: newType, templateId: newTemplateId || undefined, variables })
      setNodes(result.nodes); setTemplates(await window.prism.listTemplates()); await openNode(result.id, true)
    } catch (reason) { setError(String(reason)) }
  }
  async function save() {
    if (!activeId || !snapshot) return
    try {
      const result = await window.prism.saveKnowledgeNode(activeId, { content, expectedRevision: snapshot.revision, createStubs: true })
      if (!result.saved) { setError('파일이 외부에서 변경되어 저장하지 않았습니다. 창을 다시 열어 두 버전을 확인하세요.'); return }
      setSnapshot(result.snapshot); setDirty(false); setNodes(await window.prism.listKnowledgeNodes())
      setError(result.stubs?.length ? `[[링크]]에서 새 Concept ${result.stubs.length}개를 Inbox에 만들었습니다: ${result.stubs.join(', ')}` : '')
    } catch (reason) { setError(String(reason)) }
  }
  async function updateProperty(patch: KnowledgePropertyPatch) {
    if (!activeId || !snapshot || dirty) { setError('본문 변경을 먼저 저장한 뒤 속성을 변경하세요.'); return }
    try {
      const result = await window.prism.updateKnowledgeProperties(activeId, patch, snapshot.revision)
      if (!result.saved) { setError('파일이 외부에서 변경되어 속성을 저장하지 않았습니다.'); return }
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setNodes(await window.prism.listKnowledgeNodes()); setError('')
      // Finishing a paper is the natural moment for the model to propose edges; the researcher still approves each one.
      if (patch.readingStatus === 'read' && settings?.knowledgeProvider && settings.knowledgeModel) void runModelSuggestionsFor(activeId)
    } catch (reason) { setError(String(reason)) }
  }
  async function runModelSuggestionsFor(paperNodeId: string) {
    if (modelRunning) return
    if (!settings?.knowledgeProvider || !settings.knowledgeModel) { setError('Reader 설정에서 지식 제안 CLI와 모델을 먼저 고르세요.'); return }
    setModelRunning(true); setError(`${settings.knowledgeModel}이(가) 논문 노트를 읽고 관계·승격 후보를 제안하는 중… 결과는 정리 대기열에 검토 대기로 들어갑니다.`)
    try {
      const summary = await window.prism.runModelSuggestions(paperNodeId)
      const queue = await window.prism.listCurationQueue(); setCurationCount(queue.total)
      setError(`모델 제안 완료: 관계 ${summary.relationsCreated}개 검토 대기, 필기 힌트 ${summary.candidates}개, 새 Concept ${summary.concepts}개 (무시 ${summary.relationsSkipped}개).`)
      if (!dirty) openCuration()
    } catch (reason) { setError(String(reason)) }
    finally { setModelRunning(false) }
  }
  async function applyMissingSections() {
    if (!active || !snapshot || dirty || !sectionTemplateId) { setError('본문 변경을 먼저 저장하고 템플릿을 선택하세요.'); return }
    try {
      const result = await window.prism.applyTemplateSections({ nodeId: active.id, templateId: sectionTemplateId, expectedRevision: snapshot.revision })
      if (!result.saved) { setError('파일이 외부에서 변경되어 섹션을 추가하지 않았습니다.'); return }
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSectionTemplateOpen(false); setNodes(await window.prism.listKnowledgeNodes())
      setError(result.addedHeadings.length ? `기존 본문은 유지하고 누락된 섹션 ${result.addedHeadings.length}개를 추가했습니다: ${result.addedHeadings.join(', ')}` : '이 템플릿의 섹션이 이미 모두 있습니다.')
    } catch (reason) { setError(String(reason)) }
  }
  function discard() { if (snapshot) { setContent(snapshot.content); setDirty(false); setError('') } }
  function addEvidence(anchor: EvidenceAnchor) {
    if (relinking) {
      setContent(replaceEvidence(content, relinking, anchor)); setDirty(true); setRelinking(undefined); setEvidenceOpen(false); setEvidenceQuery(''); setError('새 PDF 위치로 재연결했습니다. 저장하면 확정됩니다.'); return
    }
    if (linkedEvidence.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId)) { setError('이미 이 노트에 연결된 근거입니다.'); return }
    editorRef.current?.insertText(evidenceMarkdown(anchor)); setEvidenceOpen(false); setEvidenceQuery(''); setError('근거 카드를 삽입했습니다. 저장하면 Markdown에 보존됩니다.')
  }
  function unlinkEvidence(item: EmbeddedEvidence) { setContent(removeEvidence(content, item)); setDirty(true); setError('근거 링크만 제거했습니다. PDF 원문은 변경되지 않습니다.') }
  async function copyEvidenceTo(target: KnowledgeNodeRecord) {
    if (!active || !copying) return
    try {
      const result = await window.prism.copyKnowledgeEvidence({ sourceNodeId: active.id, targetNodeId: target.id, blockId: copying.blockId, expectedTargetRevision: target.revision })
      if (!result.saved) { setNodes(await window.prism.listKnowledgeNodes()); setError('대상 노트가 외부에서 변경되어 근거를 복사하지 않았습니다. 다시 선택해 주세요.'); return }
      setNodes(await window.prism.listKnowledgeNodes()); setCopying(undefined); setCopyQuery(''); setError(`근거 카드를 '${target.title}'에 복사했습니다.`)
    } catch (reason) { setError(String(reason)) }
  }
  function evidenceRelation(item: EmbeddedEvidence, targetId?: string) {
    return relations.find((relation) => relation.direction === 'outgoing' && relation.creator === 'user' && relation.reviewStatus === 'approved'
      && relation.evidenceAnchor?.paperId === item.paperId && relation.evidenceAnchor.anchorId === item.anchorId && (!targetId || relation.targetId === targetId))
  }
  function beginEvidenceClaim(item: EmbeddedEvidence) {
    if (dirty) { setError('근거 카드를 저장한 뒤 Claim에 연결하세요.'); return }
    const existing = evidenceRelation(item)
    setClaimingEvidence(item); setEvidenceClaimQuery(''); setEvidenceRelationType(existing && ['supports', 'contradicts', 'extends'].includes(existing.type) ? existing.type as typeof evidenceRelationType : 'supports')
  }
  async function connectEvidenceClaim(target: KnowledgeNodeRecord, confirmed = false) {
    if (!active || !snapshot || !claimingEvidence) return
    const warning = evidenceRelationType === 'contradicts' && !confirmed ? scopeConflict(active, target) : undefined
    if (warning) { setPendingContradiction({ message: warning, run: () => connectEvidenceClaim(target, true) }); return }
    const evidenceAnchor: RelationEvidenceAnchor = { paperId: claimingEvidence.paperId, anchorId: claimingEvidence.anchorId, type: claimingEvidence.type, page: claimingEvidence.page, label: claimingEvidence.label }
    const existing = evidenceRelation(claimingEvidence, target.id)
    try {
      const result = existing
        ? await window.prism.updateKnowledgeRelation({ id: existing.id, type: evidenceRelationType, evidenceAnchor, expectedRevision: snapshot.revision })
        : await window.prism.createKnowledgeRelation({ sourceId: active.id, targetId: target.id, type: evidenceRelationType, creator: 'user', evidenceAnchor, expectedRevision: snapshot.revision })
      if (!result.saved) { setError('노트가 외부에서 변경되어 근거 관계를 저장하지 않았습니다.'); return }
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setRelations(result.relations); setNodes(await window.prism.listKnowledgeNodes()); setClaimingEvidence(undefined); setEvidenceClaimQuery(''); setDirty(false); setError(`이 근거를 '${target.title}'에 '${relationLabels[evidenceRelationType]}' 관계로 연결했습니다.`)
    } catch (reason) { setError(String(reason)) }
  }
  async function addKnowledgeLink(node: KnowledgeNodeRecord) {
    if (!active || !snapshot) return
    editorRef.current?.insertText(`[[${node.relativePath.replace(/\.md$/i, '')}|${node.title}]]`)
    setLinkOpen(false); setLinkQuery('')
    if (linkRelationType === 'none') { setError(`${node.title}을(를) Obsidian 호환 링크로 추가했습니다.`); return }
    try {
      const nextContent = editorRef.current?.getValue() ?? content
      const linkSave = await window.prism.saveKnowledgeNode(active.id, { content: nextContent, expectedRevision: snapshot.revision })
      if (!linkSave.saved) { setError('파일이 외부에서 변경되어 링크와 관계를 저장하지 않았습니다.'); return }
      const relation = await window.prism.createKnowledgeRelation({ sourceId: active.id, targetId: node.id, type: linkRelationType, creator: 'user', expectedRevision: linkSave.snapshot.revision })
      if (!relation.saved) { setSnapshot(linkSave.snapshot); setContent(linkSave.snapshot.content); setDirty(false); setError('링크는 저장했지만 외부 변경 때문에 관계는 추가하지 않았습니다.'); return }
      setSnapshot(relation.snapshot); setContent(relation.snapshot.content); setRelations(relation.relations); setDirty(false); setNodes(await window.prism.listKnowledgeNodes()); setError(`${node.title} 링크와 '${relationLabels[linkRelationType]}' 관계를 함께 추가했습니다.`)
    } catch (reason) { setError(String(reason)) }
  }
  async function createWikiLinkNode(nodeType: 'concept' | 'claim', title: string) {
    try {
      const created = await window.prism.createKnowledgeNode({ nodeType, title }); const items = created.nodes; const node = items.find((item) => item.id === created.id)
      setNodes(items); if (!node) return undefined
      setError(`${typeLabels[nodeType]} '${node.title}'을(를) 만들었습니다.`)
      return { id: node.id, label: node.title, target: node.relativePath.replace(/\.md$/i, ''), description: typeLabels[node.nodeType], preview: node.preview, evidenceCount: node.evidenceCount }
    } catch (reason) { setError(String(reason)); return undefined }
  }
  async function createFromLinkPicker(nodeType: 'concept' | 'claim') {
    const title = linkQuery.trim(); if (!title) return
    const option = await createWikiLinkNode(nodeType, title)
    if (!option) return
    const items = await window.prism.listKnowledgeNodes(); const node = items.find((item) => item.id === option.id)
    if (node) { setNodes(items); await addKnowledgeLink(node) }
  }
  function openRelationPicker(type: KnowledgeRelationType | undefined = availableRelationTypes[0]) {
    if (!type) { setError('현재 노트에서 만들 수 있는 관계가 없습니다. 링크로 연결하세요.'); return }
    if (!availableRelationTypes.includes(type)) { setError(`현재 노트에서 '${relationLabels[type]}' 관계로 연결할 대상이 없습니다.`); return }
    setRelationType(type); setRelationQuery(''); setRelationOpen(true); setLinkOpen(false); setEvidenceOpen(false); setGraphOpen(false)
  }
  function runSlashAction(action: MarkdownSlashAction) {
    if (action === 'link') { setLinkOpen(true); setRelationOpen(false); return }
    if (action === 'evidence') { setEvidenceOpen(true); setRelationOpen(false); return }
    if (action === 'graph') { setGraphOpen(true); setRelationOpen(false); return }
    openRelationPicker(action === 'supports' ? 'supports' : action === 'contradicts' ? 'contradicts' : undefined)
  }
  async function addRelation(target: KnowledgeNodeRecord, type = relationType, confirmed = false) {
    if (!active || !snapshot) return
    const warning = type === 'contradicts' && !confirmed ? scopeConflict(active, target) : undefined
    if (warning) { setPendingContradiction({ message: warning, run: () => addRelation(target, type, true) }); return }
    try {
      let baseSnapshot = snapshot
      if (dirty) {
        const saved = await window.prism.saveKnowledgeNode(active.id, { content: editorRef.current?.getValue() ?? content, expectedRevision: snapshot.revision })
        if (!saved.saved) { setError('파일이 외부에서 변경되어 명령과 관계를 저장하지 않았습니다.'); return }
        baseSnapshot = saved.snapshot
      }
      const result = await window.prism.createKnowledgeRelation({ sourceId: active.id, targetId: target.id, type, creator: 'user', expectedRevision: baseSnapshot.revision })
      if (!result.saved) { setError('파일이 외부에서 변경되어 관계를 추가하지 않았습니다.'); return }
      editorRef.current?.moveToEnd(); setSnapshot(result.snapshot); setContent(result.snapshot.content); setRelations(result.relations); setNodes(await window.prism.listKnowledgeNodes()); setDirty(false); setRelationOpen(false); setRelationQuery(''); setError(`${target.title}와(과) '${relationLabels[type]}' 관계를 추가했습니다.`)
    } catch (reason) { setError(String(reason)) }
  }
  async function deleteRelation(item: KnowledgeRelationView) {
    if (!snapshot || dirty || item.direction !== 'outgoing') { setError('이 노트에서 만든 관계만 삭제할 수 있습니다.'); return }
    try {
      const result = await window.prism.deleteKnowledgeRelation({ id: item.id, expectedRevision: snapshot.revision })
      if (!result.saved) { setError('파일이 외부에서 변경되어 관계를 삭제하지 않았습니다.'); return }
      editorRef.current?.moveToEnd(); setSnapshot(result.snapshot); setContent(result.snapshot.content); setRelations(result.relations); setNodes(await window.prism.listKnowledgeNodes()); setError('관계와 해당 Markdown 블록을 삭제했습니다.')
    } catch (reason) { setError(String(reason)) }
  }
  async function openSuggestions() {
    if (!active || dirty) { setError('본문 변경을 먼저 저장하거나 취소한 뒤 AI 제안을 확인하세요.'); return }
    setSuggestionsOpen(true); setSuggestionsLoading(true); setGraphOpen(false); setError('')
    try { setSuggestions(await window.prism.suggestKnowledge(active.id)) }
    catch (reason) { setError(String(reason)); setSuggestionsOpen(false) }
    finally { setSuggestionsLoading(false) }
  }
  async function addSuggestedRelation(suggestion: KnowledgeSuggestion) {
    if (!suggestion.target || !suggestion.proposedRelation || dirty) { setError('관계로 만들 수 있는 제안이 아닙니다.'); return }
    try {
      const sourceSnapshot = await window.prism.readKnowledgeNode(suggestion.source.id)
      const result = await window.prism.createKnowledgeRelation({ sourceId: suggestion.source.id, targetId: suggestion.target.id, type: suggestion.proposedRelation, creator: 'ai', expectedRevision: sourceSnapshot.revision })
      if (!result.saved) { setError('제안의 출발 노트가 외부에서 변경되어 관계를 만들지 않았습니다.'); return }
      setSuggestions((items) => items.filter((item) => item.id !== suggestion.id))
      if (suggestion.source.id === activeId) { setSnapshot(result.snapshot); setContent(result.snapshot.content); setRelations(result.relations) }
      setError(suggestion.source.id === activeId ? 'AI 관계를 검토 목록에 추가했습니다. 승인하기 전에는 Markdown과 검색 근거에 반영되지 않습니다.' : `${suggestion.source.title}에서 AI 관계를 검토할 수 있습니다.`)
    } catch (reason) { setError(String(reason)) }
  }
  async function reviewRelation(item: KnowledgeRelationView, decision: 'approved' | 'rejected') {
    if (!snapshot || dirty || item.direction !== 'outgoing' || item.creator !== 'ai' || item.reviewStatus !== 'pending') { setError('출발 노트의 검토 대기 중인 AI 관계만 승인하거나 거절할 수 있습니다.'); return }
    try {
      const result = await window.prism.reviewKnowledgeRelation({ id: item.id, decision, expectedRevision: snapshot.revision })
      if (!result.saved) { setError('파일이 외부에서 변경되어 관계 검토 결과를 저장하지 않았습니다.'); return }
      if (decision === 'approved') editorRef.current?.moveToEnd()
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setRelations(result.relations)
      setNodes(await window.prism.listKnowledgeNodes()); setDataViews(await window.prism.listKnowledgeDataViews())
      setError(decision === 'approved' ? 'AI 관계를 승인해 Markdown과 연구 검색 근거에 반영했습니다.' : 'AI 관계를 거절했습니다. Markdown 본문은 변경하지 않았습니다.')
    } catch (reason) { setError(String(reason)) }
  }
  async function openEvidence(item: EvidenceAnchorRef) {
    try { await window.prism.openEvidenceAnchor(item); setError('Reader에서 PDF 원문 위치를 열었습니다.') }
    catch (reason) { setError(String(reason)) }
  }
  async function openInObsidian(blockId?: string) {
    if (!active) return
    try { await window.prism.openKnowledgeNodeInObsidian({ nodeId: active.id, blockId }); setError(blockId ? 'Obsidian에서 근거 블록을 열었습니다.' : 'Obsidian에서 현재 노트를 열었습니다.') }
    catch (reason) { setError(`Obsidian을 열지 못했습니다. ${String(reason)}`) }
  }
  async function refreshEvidence() {
    try { setAnchors(await window.prism.listEvidenceAnchors()); setError('PDF 앵커 목록을 새로고침했습니다.') }
    catch (reason) { setError(String(reason)) }
  }
  function beginRelink(item: EmbeddedEvidence) { setRelinking(item); setEvidenceOpen(true); setEvidenceQuery(item.paperTitle); setEvidenceType(item.type); setError('대체할 PDF 위치를 선택하세요.') }
  function beginPromotion(item: EmbeddedEvidence) { setPromoting(item); setPromotionType('claim'); setPromotionTitle(`${item.label}에서 도출한 주장`); setError('') }
  async function promote() {
    if (!promoting || !active || !promotionTitle.trim()) { setError('승격할 지식 노트 제목을 입력하세요.'); return }
    const anchor = anchors.find((item) => item.paperId === promoting.paperId && item.anchorId === promoting.anchorId)
      ?? { ...promoting, availability: 'needs-relink' as const }
    try {
      const created = await window.prism.createKnowledgeNode({ nodeType: promotionType, title: promotionTitle })
      const next = await window.prism.readKnowledgeNode(created.id)
      const origin = active.relativePath.replace(/\.md$/i, '')
      const contentWithEvidence = `${next.content.trimEnd()}\n\n${evidenceMarkdown(anchor)}\n\n> [!note] 출처 노트\n> [[${origin}|${active.title}]]\n`
      const saved = await window.prism.saveKnowledgeNode(created.id, { content: contentWithEvidence, expectedRevision: next.revision })
      if (!saved.saved) { setError('승격 중 대상 파일이 변경되어 저장하지 않았습니다.'); return }
      setNodes(await window.prism.listKnowledgeNodes()); setPromoting(undefined); await openNode(created.id, true); setError(`${typeLabels[promotionType]} 노트로 승격하고 원래 근거를 유지했습니다.`)
    } catch (reason) { setError(String(reason)) }
  }
  async function remove() {
    if (!activeId || dirty) { setError('본문 변경을 먼저 저장하거나 취소하세요.'); return }
    if (!deleteReady) { setDeleteReady(true); setError('삭제를 한 번 더 누르면 이 노트를 휴지통으로 이동합니다.'); return }
    try {
      const remaining = await window.prism.deleteKnowledgeNode(activeId); setNodes(remaining); setActiveId(undefined); setSnapshot(undefined); setContent(''); setDeleteReady(false); setError('')
      if (remaining[0]) await openNode(remaining[0].id, true); else setCreating(true)
    } catch (reason) { setError(String(reason)) }
  }

  return <div className="knowledge-manager-backdrop">
    <section className="knowledge-manager" role="dialog" aria-modal="true" aria-labelledby="knowledge-manager-title">
      <header><div><Lightbulb size={18} /><span><h2 id="knowledge-manager-title">연구 지식</h2><p>생각을 근거가 연결되는 Markdown 지식 노트로 발전시킵니다.</p></span></div><button aria-label="연구 지식 닫기" onClick={() => dirty ? setError('변경 내용을 저장하거나 취소한 뒤 닫으세요.') : onClose()}><X size={16} /></button></header>
      <div className="knowledge-manager-body">
        <aside><button className="knowledge-new" onClick={startCreate}><FilePlus2 size={13} /> 새 지식 노트</button><button className={`knowledge-overview-button knowledge-curation-button${curationOpen ? ' active' : ''}`} aria-label="정리 대기열" onClick={openCuration}><Inbox size={13} /><span><strong>정리 대기열</strong><i>{curationCount === undefined ? '계산 중' : `${curationCount}개 결정 대기`}</i></span></button><button className={`knowledge-overview-button${dataViewOpen ? ' active' : ''}`} aria-label="지식 데이터 보기" onClick={() => void openDataViews()}><LayoutDashboard size={13} /><span><strong>연구 현황</strong><i>{dataViews.projects.length} 프로젝트 · {dataViews.unansweredQuestions.length} 질문 · {dataViews.unsupportedClaims.length} 무근거</i></span></button><label className="knowledge-search"><Search size={13} /><input aria-label="지식 노트 검색" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="제목, 본문, 의미 검색" />{searching && <span>검색 중</span>}</label><div>{visibleNodes.map((node) => { const result = searchResults.find((item) => item.node.id === node.id); return <button key={node.id} className={!dataViewOpen && !curationOpen && node.id === activeId ? 'active' : ''} onClick={() => void openNode(node.id)}><span><small>{typeLabels[node.nodeType]}</small><strong>{node.title}</strong><i>{result?.excerpt || node.relativePath}</i></span><em className={`knowledge-status status-${node.status}`}>{statusLabels[node.status]}</em></button> })}{searchQuery.trim() && !searching && !visibleNodes.length ? <p className="knowledge-search-empty">일치하는 지식이 없습니다.</p> : null}</div></aside>
        <main>
          {curationOpen ? <CurationQueue onOpenNode={(id) => void openNode(id, true)} onChanged={refreshAfterCuration} onCount={setCurationCount} /> : dataViewOpen ? <section className="knowledge-data-views" aria-label="연구 지식 데이터 보기"><header><div><LayoutDashboard size={17} /><span><h3>연구 현황</h3><p>Markdown과 승인된 관계에서 다시 계산한 작업 목록입니다.</p></span></div>{viewsLoading && <small>새로고침 중…</small>}</header><div>{viewSections.map((section) => <article key={section.key} className={`knowledge-data-view view-${section.key}`}><header><span><strong>{section.title}</strong><small>{section.description}</small></span><em>{section.items.length}</em></header><div>{section.items.length ? section.items.map((node) => <button key={node.id} onClick={() => void openNode(node.id)}><span><small>{typeLabels[node.nodeType]} · {statusLabels[node.status]}</small><strong>{node.title}</strong><i>{node.relativePath}</i></span><ExternalLink size={13} /></button>) : <p>{section.empty}</p>}</div></article>)}</div></section> : creating || (!active && !nodes.length) ? <div className="knowledge-create"><h3>새 지식 노트</h3><p>유형과 템플릿을 선택하면 일반 Markdown 파일로 생성됩니다.</p><label><span>유형</span><select aria-label="새 지식 노트 유형" value={newType} onChange={(event) => setNewType(event.target.value as KnowledgeNodeType)}>{creatableTypes.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</select></label><label><span>제목</span><input autoFocus aria-label="새 지식 노트 제목" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="예: Score matching과 노이즈 예측의 관계" /></label><label><span>템플릿</span><select aria-label="새 지식 노트 템플릿" value={newTemplateId} onChange={(event) => setNewTemplateId(event.target.value)}>{compatibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.isFavorite ? '★ ' : ''}{template.name}{template.isDefault ? ' · 기본값' : template.lastUsedAt ? ' · 최근 사용' : ''}</option>)}</select></label><details className="knowledge-template-variables"><summary>템플릿 변수 채우기 <small>선택 사항</small></summary><div>{[['authors', '저자'], ['year', '연도'], ['arxiv_id', 'arXiv ID'], ['doi', 'DOI'], ['paper_link', '논문 링크'], ['current_project', '현재 프로젝트'], ['selected_anchor', '선택 근거']] .map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={`템플릿 변수 ${label}`} value={newVariables[key] ?? ''} onChange={(event) => setNewVariables((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div></details><button className="primary" onClick={() => void create()}>노트 만들기</button></div> : active && snapshot ? <>
            <div className="knowledge-heading">
              <div className="knowledge-title-row"><div><small>{typeLabels[active.nodeType]} · {active.relativePath}</small><h3>{active.title}</h3></div><div className="knowledge-title-actions"><button aria-label="로컬 관계 그래프" onClick={() => setGraphOpen(true)}><Network size={12} /> 그래프</button><button aria-label="누락된 템플릿 섹션 추가" onClick={() => setSectionTemplateOpen((value) => !value)}><PanelsTopLeft size={12} /> 템플릿 섹션</button><button aria-label="AI 연구 제안 보기" onClick={() => void openSuggestions()}><Sparkles size={12} /> AI 제안</button>{active.nodeType === 'paper' && <button aria-label="모델로 관계 제안" disabled={modelRunning} title={settings?.knowledgeProvider && settings.knowledgeModel ? `${settings.knowledgeModel}에게 이 논문의 관계와 승격 후보를 묻습니다` : 'Reader 설정에서 지식 제안 CLI를 선택하세요'} onClick={() => void runModelSuggestionsFor(active.id)}><Sparkles size={12} /> {modelRunning ? '제안 중…' : '모델 제안'}</button>}<button aria-label="현재 노트를 Obsidian에서 열기" onClick={() => void openInObsidian()}><ExternalLink size={12} /> Obsidian</button></div></div>
              <div className="knowledge-properties"><label><span>상태</span><select aria-label="지식 노트 상태" value={active.status} onChange={(event) => void updateProperty({ status: event.target.value as KnowledgeStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{active.nodeType === 'paper' && <label><span>읽기</span><select aria-label="Paper 읽기 상태" value={active.readingStatus ?? 'to_read'} onChange={(event) => void updateProperty({ readingStatus: event.target.value as KnowledgeReadingStatus })}>{Object.entries(readingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<label><span>중요도</span><select aria-label="지식 노트 중요도" value={active.importance} onChange={(event) => void updateProperty({ importance: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>확신도</span><select aria-label="지식 노트 확신도" value={active.confidence} onChange={(event) => void updateProperty({ confidence: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{active.nodeType === 'claim' && <><label><span>출처</span><select aria-label="Claim 출처" value={active.claimOrigin ?? 'paper'} onChange={(event) => void updateProperty({ claimOrigin: event.target.value as ClaimOrigin })}>{Object.entries(claimOriginLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>근거 종류</span><select aria-label="Claim 근거 종류" value={active.evidenceKind ?? ''} onChange={(event) => void updateProperty({ evidenceKind: event.target.value as EvidenceKind | '' })}><option value="">미정</option>{Object.entries(evidenceKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}<button aria-label="지식 링크 추가" onClick={() => setLinkOpen((value) => !value)}><Link2 size={13} /> 링크</button><button aria-label="지식 관계 추가" onClick={() => relationOpen ? setRelationOpen(false) : openRelationPicker()}><Link2 size={13} /> 관계</button><button className="knowledge-add-evidence" aria-label="PDF 근거 추가" onClick={() => setEvidenceOpen((value) => !value)}><Link2 size={13} /> 근거</button></div>
              <div className="knowledge-scope" aria-label="스코프와 프로젝트">
                {active.nodeType === 'claim' && <><PropertyText label="도메인" placeholder="예: 이미지 생성" value={active.scopeDomain ?? ''} onCommit={(value) => void updateProperty({ scopeDomain: value })} /><PropertyText label="조건" placeholder="예: 대규모 데이터, 픽셀 공간" value={active.scopeRegime ?? ''} onCommit={(value) => void updateProperty({ scopeRegime: value })} /><PropertyText label="가정 (쉼표 구분)" placeholder="예: 가우시안 노이즈, 고정 스케줄" value={(active.scopeAssumptions ?? []).join(', ')} onCommit={(value) => void updateProperty({ scopeAssumptions: splitList(value) })} /></>}
                <PropertyText label="프로젝트 (쉼표 구분)" placeholder="예: Diffusion objective 연구" value={(active.projects ?? []).join(', ')} onCommit={(value) => void updateProperty({ projects: splitList(value) })} />
              </div>
            </div>
            {pendingContradiction && <section className="knowledge-scope-warning" role="alertdialog" aria-label="스코프 경고"><div><strong>두 Claim의 스코프가 겹치지 않습니다</strong><p>{pendingContradiction.message} 모순이 아니라 조건 차이일 수 있습니다.</p></div><footer><button onClick={() => setPendingContradiction(undefined)}>취소</button><button className="primary" onClick={() => { const run = pendingContradiction.run; setPendingContradiction(undefined); void run() }}>그래도 반박으로 연결</button></footer></section>}
            {sectionTemplateOpen && <section className="template-section-picker" aria-label="누락된 템플릿 섹션 추가"><div><strong>누락 섹션만 추가</strong><small>같은 제목의 섹션과 기존 본문은 그대로 둡니다.</small></div><select aria-label="섹션을 가져올 템플릿" value={sectionTemplateId} onChange={(event) => setSectionTemplateId(event.target.value)}>{activeTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.id === active.templateId ? ' · 생성에 사용' : ''}</option>)}</select><button disabled={!sectionTemplateId || dirty} onClick={() => void applyMissingSections()}>추가</button><button aria-label="템플릿 섹션 선택 닫기" onClick={() => setSectionTemplateOpen(false)}><X size={13} /></button></section>}
            {linkOpen && <section className="knowledge-link-picker" aria-label="지식 노트 연결"><header><select aria-label="링크 관계 유형" value={linkRelationType} onChange={(event) => setLinkRelationType(event.target.value as typeof linkRelationType)}><option value="none">관계 없음</option>{availableRelationTypes.map((value) => <option key={value} value={value}>{relationLabels[value]}</option>)}</select><div><Search size={14} /><input autoFocus aria-label="연결할 지식 노트 검색" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="제목, 유형, 경로 검색" /></div><button aria-label="지식 노트 연결 닫기" onClick={() => setLinkOpen(false)}><X size={14} /></button></header><div>{matchingNodes.length ? matchingNodes.map((node) => <button key={node.id} onClick={() => void addKnowledgeLink(node)}><span><small>{typeLabels[node.nodeType]} · {node.relativePath}</small><strong>{node.title}</strong></span><Link2 size={13} /></button>) : <p>이 관계로 연결할 수 있는 노트가 없습니다.</p>}{linkQuery.trim() && !nodes.some((node) => node.title.toLocaleLowerCase() === linkQuery.trim().toLocaleLowerCase()) && <footer className="knowledge-inline-create"><button onClick={() => void createFromLinkPicker('concept')}>Concept로 만들기</button><button onClick={() => void createFromLinkPicker('claim')}>Claim으로 만들기</button></footer>}</div></section>}
            {relationOpen && <section className="knowledge-link-picker relation-picker" aria-label="지식 관계 선택"><nav className="relation-type-buttons" aria-label="지식 관계 유형">{availableRelationTypes.map((value) => <button key={value} className={relationType === value ? 'active' : ''} aria-pressed={relationType === value} onClick={() => setRelationType(value)}>{relationLabels[value]}</button>)}</nav><header><div><Search size={14} /><input autoFocus aria-label="관계 대상 검색" value={relationQuery} onChange={(event) => setRelationQuery(event.target.value)} placeholder="관계를 맺을 노트 검색" /></div><button aria-label="지식 관계 닫기" onClick={() => setRelationOpen(false)}><X size={14} /></button></header><div>{matchingRelationNodes.length ? matchingRelationNodes.map((node) => <button key={node.id} onClick={() => void addRelation(node)}><span><small>{typeLabels[node.nodeType]} · {node.relativePath}</small><strong>{node.title}</strong></span><span className="relation-choice">{relationLabels[relationType]}</span></button>) : <p>이 관계로 연결할 수 있는 노트가 없습니다.</p>}</div></section>}
            {evidenceOpen && <section className="evidence-picker" aria-label="PDF 근거 선택"><header><div><Search size={14} /><input autoFocus aria-label="PDF 근거 검색" value={evidenceQuery} onChange={(event) => setEvidenceQuery(event.target.value)} placeholder={relinking ? '대체할 PDF 위치 검색' : '논문 제목, 문장, 수식 검색'} /></div><select aria-label="PDF 근거 유형" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as typeof evidenceType)}><option value="all">모든 유형</option>{(['sentence', 'section', 'equation', 'table', 'figure', 'page'] as const).map((type) => <option key={type} value={type}>{evidenceTypeLabel(type)}</option>)}</select><button aria-label="PDF 앵커 새로고침" title="Reader의 최신 앵커 불러오기" onClick={() => void refreshEvidence()}><RefreshCw size={13} /></button><button aria-label="PDF 근거 선택 닫기" onClick={() => { setEvidenceOpen(false); setRelinking(undefined) }}><X size={14} /></button></header><div>{matchingAnchors.length ? matchingAnchors.map((anchor) => <button key={`${anchor.paperId}-${anchor.anchorId}`} onClick={() => addEvidence(anchor)}><span><small>{evidenceTypeLabel(anchor.type)} · p.{anchor.page} · {anchor.label}</small><strong>{anchor.paperTitle}</strong><p>{anchor.source}</p></span><Link2 size={14} /></button>) : <p className="evidence-empty">저장된 PDF 앵커가 없습니다. Reader에서 논문을 열면 문장·섹션·수식·표 앵커가 생성됩니다.</p>}</div></section>}
            {copying && <section className="evidence-copy-picker" aria-label="근거 카드 복사"><header><div><Search size={14} /><input autoFocus aria-label="근거 복사 대상 검색" value={copyQuery} onChange={(event) => setCopyQuery(event.target.value)} placeholder="복사할 노트 검색" /></div><button aria-label="근거 카드 복사 닫기" onClick={() => { setCopying(undefined); setCopyQuery('') }}><X size={14} /></button></header><div>{copyTargets.length ? copyTargets.map((node) => <button key={node.id} onClick={() => void copyEvidenceTo(node)}><span><small>{typeLabels[node.nodeType]} · {node.relativePath}</small><strong>{node.title}</strong></span><Link2 size={13} /></button>) : <p>복사할 다른 지식 노트가 없습니다.</p>}</div></section>}
            {claimingEvidence && <section className="knowledge-link-picker evidence-claim-picker" aria-label="근거를 기존 Claim에 연결"><header><select aria-label="근거 Claim 관계 유형" value={evidenceRelationType} onChange={(event) => setEvidenceRelationType(event.target.value as typeof evidenceRelationType)}><option value="supports">지지함</option><option value="contradicts">반박함</option>{active.nodeType !== 'paper' && <option value="extends">확장함</option>}</select><div><Search size={14} /><input autoFocus aria-label="근거 연결 Claim 검색" value={evidenceClaimQuery} onChange={(event) => setEvidenceClaimQuery(event.target.value)} placeholder="의미, 제목으로 Claim 검색" /></div><button aria-label="근거 Claim 연결 닫기" onClick={() => { setClaimingEvidence(undefined); setEvidenceClaimQuery('') }}><X size={14} /></button></header><div>{evidenceClaimTargets.length ? evidenceClaimTargets.map((node) => { const existing = evidenceRelation(claimingEvidence, node.id); return <button key={node.id} onClick={() => void connectEvidenceClaim(node)}><span><small>Claim · {node.relativePath}</small><strong>{node.title}</strong></span><span className="relation-choice">{existing ? `연결됨 · ${relationLabels[existing.type]}` : relationLabels[evidenceRelationType]}</span></button> }) : <p>연결할 다른 Claim이 없습니다.</p>}</div></section>}
            {linkedEvidence.length > 0 && <section className="evidence-strip" aria-label="연결된 PDF 근거"><header><span>연결된 근거</span><small>{linkedEvidence.length}</small></header><div>{linkedEvidence.map((item) => { const current = anchors.find((anchor) => anchor.paperId === item.paperId && anchor.anchorId === item.anchorId); const broken = !current || current.sourceHash !== item.sourceHash; const directRelation = evidenceRelation(item); return <article className={broken ? 'needs-relink' : ''} key={item.blockId}><button className="evidence-open" onClick={() => void openEvidence(item)}><span><small>{broken ? '재연결 필요' : `${evidenceTypeLabel(item.type)} · p.${item.page}`}</small><strong>{item.paperTitle}</strong><p>{item.source}</p></span><ExternalLink size={14} /></button><div className="evidence-card-actions">{broken && <button onClick={() => beginRelink(item)}>재연결</button>}<button onClick={() => { setCopying(item); setCopyQuery('') }}>복사</button><button onClick={() => beginEvidenceClaim(item)}>{directRelation ? '관계 변경' : 'Claim 연결'}</button><button onClick={() => beginPromotion(item)}><Sparkles size={10} /> 승격</button><button aria-label={`${item.label} Obsidian에서 열기`} onClick={() => void openInObsidian(item.blockId)}><ExternalLink size={10} /> Obsidian</button></div><button className="evidence-unlink" aria-label={`${item.label} 근거 링크 삭제`} onClick={() => unlinkEvidence(item)}><X size={12} /></button></article> })}</div></section>}
            {backlinks.length > 0 && <section className="knowledge-backlinks" aria-label="이 노트를 연결한 노트"><header><span>백링크</span><small>{backlinks.length}</small></header><div>{backlinks.map((item) => <button key={item.nodeId} onClick={() => void openNode(item.nodeId)}><span><small>{typeLabels[item.nodeType]} · {item.relativePath}</small><strong>{item.title}</strong><p>{item.excerpt}</p></span><ExternalLink size={13} /></button>)}</div></section>}
            {(relations.length > 0 || allRelations.length > 0) && <section className="knowledge-relations" aria-label="지식 관계"><header><span>관계</span><small>{relations.length}</small>{allRelations.some((item) => item.type === 'mentions') && <button className="relation-auto-toggle" aria-pressed={showAutoRelations} onClick={() => setShowAutoRelations((value) => !value)}>{showAutoRelations ? '자동 관계 숨기기' : `자동 관계 ${allRelations.filter((item) => item.type === 'mentions').length}개 보기`}</button>}</header><div>{relations.map((item) => <article key={item.id} className={`relation-status-${item.reviewStatus}`}><button onClick={() => void openNode(item.other.id)}><span><small>{item.direction === 'outgoing' ? '내가' : item.other.title} → {relationLabels[item.type]} → {item.direction === 'outgoing' ? item.other.title : '이 노트'}</small><strong>{item.other.title}</strong><p>{item.creator === 'user' ? '사용자' : 'AI'} · {item.reviewStatus === 'approved' ? '승인' : item.reviewStatus === 'pending' ? item.direction === 'outgoing' ? '검토 필요' : '출발 노트에서 검토' : '거절'}</p></span><ExternalLink size={13} /></button>{item.direction === 'outgoing' && item.creator === 'ai' && item.reviewStatus === 'pending' && <div className="relation-review-actions"><button aria-label={`${item.other.title} AI 관계 승인`} onClick={() => void reviewRelation(item, 'approved')}>승인</button><button aria-label={`${item.other.title} AI 관계 거절`} onClick={() => void reviewRelation(item, 'rejected')}>거절</button></div>}{item.direction === 'outgoing' && <button className="relation-delete" aria-label={`${item.other.title} 관계 삭제`} onClick={() => void deleteRelation(item)}><X size={11} /></button>}</article>)}</div></section>}
            <div className="knowledge-editor"><MarkdownEditor ref={editorRef} key={active.id} value={content} onChange={(value) => { setContent(value); setDirty(true); setError('') }} onBlur={() => undefined} wikiLinks={nodes.filter((node) => node.id !== active.id).map((node) => ({ id: node.id, label: node.title, target: node.relativePath.replace(/\.md$/i, ''), description: typeLabels[node.nodeType], preview: node.preview, evidenceCount: node.evidenceCount }))} evidenceLinks={editorEvidenceLinks} onCreateWikiLink={createWikiLinkNode} slashActions={['relation', 'supports', 'contradicts', 'link', 'evidence', 'graph']} onSlashAction={runSlashAction} liveEdit label={`${active.title} 지식 노트`} /></div>
            {promoting && <section className="evidence-promote" role="dialog" aria-modal="true" aria-labelledby="evidence-promote-title"><header><div><Sparkles size={15} /><span><h4 id="evidence-promote-title">근거를 지식 노트로 승격</h4><p>원래 PDF 근거와 출처 노트 링크를 그대로 유지합니다.</p></span></div><button aria-label="근거 승격 닫기" onClick={() => setPromoting(undefined)}><X size={14} /></button></header><div><label><span>노트 유형</span><select aria-label="승격 노트 유형" value={promotionType} onChange={(event) => setPromotionType(event.target.value as typeof promotionType)}><option value="claim">Claim</option><option value="question">Question</option></select></label><label><span>제목</span><input autoFocus aria-label="승격 노트 제목" value={promotionTitle} onChange={(event) => setPromotionTitle(event.target.value)} /></label></div><footer><button onClick={() => setPromoting(undefined)}>취소</button><button className="primary" onClick={() => void promote()}>승격하기</button></footer></section>}
            {suggestionsOpen && <section className="knowledge-suggestions" role="dialog" aria-modal="true" aria-labelledby="knowledge-suggestions-title"><header><div><Sparkles size={15} /><span><h4 id="knowledge-suggestions-title">AI 연구 제안</h4><p>로컬 지식과 승인된 관계를 분석했으며, 관계는 직접 검토해야 확정됩니다.</p></span></div><button aria-label="AI 연구 제안 닫기" onClick={() => setSuggestionsOpen(false)}><X size={14} /></button></header><div>{suggestionsLoading ? <p className="suggestions-empty">로컬 지식 그래프를 분석하는 중…</p> : suggestions.length ? suggestions.map((suggestion) => <article key={suggestion.id} className={`suggestion-${suggestion.kind}`}><header><span>{suggestionLabels[suggestion.kind]}</span><em>{Math.round(suggestion.confidence * 100)}%</em></header><strong>{suggestion.target ? `${suggestion.source.title} → ${suggestion.target.title}` : suggestion.source.title}</strong><p>{suggestion.reason}</p><footer>{suggestion.proposedRelation && suggestion.target ? <button onClick={() => void addSuggestedRelation(suggestion)}><Sparkles size={11} /> 검토에 추가</button> : <button onClick={() => void openNode(suggestion.source.id)}><ExternalLink size={11} /> 노트 열기</button>}</footer></article>) : <p className="suggestions-empty">지금 검토할 연구 제안이 없습니다.</p>}</div></section>}
            {graphOpen && <section className="knowledge-local-graph" role="dialog" aria-modal="true" aria-labelledby="knowledge-local-graph-title">
              <header><div><Network size={15} /><span><h4 id="knowledge-local-graph-title">로컬 관계 그래프</h4><p>{graphHops === 2 ? '현재 노트에서 두 단계까지 승인된 관계를 보여줍니다.' : '현재 노트와 직접 연결된 관계만 보여줍니다.'}</p></span></div><button aria-label="로컬 관계 그래프 닫기" onClick={() => setGraphOpen(false)}><X size={14} /></button></header>
              <nav className="local-graph-filters" aria-label="그래프 필터">
                <div>{(['paper', 'concept', 'claim', 'question'] as KnowledgeNodeType[]).map((type) => <button key={type} className={graphTypes.has(type) ? 'active' : ''} aria-pressed={graphTypes.has(type)} onClick={() => setGraphTypes((current) => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next })}>{typeLabels[type]}</button>)}</div>
                <div>{primaryRelationTypes.map((type) => <button key={type} className={graphRelationTypes.has(type) ? 'active' : ''} aria-pressed={graphRelationTypes.has(type)} onClick={() => setGraphRelationTypes((current) => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next })}>{relationLabels[type]}</button>)}</div>
                <div><button className={graphHops === 2 ? 'active' : ''} aria-pressed={graphHops === 2} onClick={() => setGraphHops(graphHops === 2 ? 1 : 2)}>2홉</button><button className={showAutoRelations ? 'active' : ''} aria-pressed={showAutoRelations} onClick={() => setShowAutoRelations((value) => !value)}>자동 관계</button></div>
              </nav>
              <div className={`local-graph-canvas${graphEdges.length ? '' : ' is-empty'}`}>
                <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {graphEdges.map((item, index) => { const point = ringPoint(index, graphEdges.length, 30, 28); return <g key={item.id}><line className={`status-${item.reviewStatus}`} x1="50" y1="50" x2={point.x} y2={point.y} /><text x={(50 + point.x) / 2} y={(50 + point.y) / 2 - 1}>{item.direction === 'outgoing' ? '→' : '←'} {relationLabels[item.type]}</text></g> })}
                  {secondHop.map((entry, index) => { const parentIndex = graphEdges.findIndex((item) => item.other.id === entry.parentId); if (parentIndex < 0) return null; const parent = ringPoint(parentIndex, graphEdges.length, 30, 28); const point = outerPoint(parentIndex, graphEdges.length, index, secondHop); return <g key={`${entry.parentId}-${entry.relation.id}`} className="hop-2"><line x1={parent.x} y1={parent.y} x2={point.x} y2={point.y} /><text x={(parent.x + point.x) / 2} y={(parent.y + point.y) / 2 - 1}>{relationLabels[entry.relation.type]}</text></g> })}
                </svg>
                <div className="local-graph-center"><small>{typeLabels[active.nodeType]}</small><strong>{active.title}</strong></div>
                {graphEdges.map((item, index) => { const point = ringPoint(index, graphEdges.length, 30, 28); return <button key={item.id} className={`local-graph-node status-${item.reviewStatus}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => void openNode(item.other.id)}><small>{typeLabels[item.other.nodeType]}</small><strong>{item.other.title}</strong><span>{item.creator === 'ai' ? 'AI · ' : ''}{item.reviewStatus === 'pending' ? '검토 필요' : relationLabels[item.type]}</span></button> })}
                {secondHop.map((entry, index) => { const parentIndex = graphEdges.findIndex((item) => item.other.id === entry.parentId); if (parentIndex < 0) return null; const point = outerPoint(parentIndex, graphEdges.length, index, secondHop); return <button key={`${entry.parentId}-${entry.relation.id}-node`} className="local-graph-node hop-2" style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => void openNode(entry.relation.other.id)}><small>{typeLabels[entry.relation.other.nodeType]}</small><strong>{entry.relation.other.title}</strong></button> })}
                {!graphEdges.length && <div className="local-graph-empty"><Network size={22} /><strong>{relations.length ? '필터에 맞는 관계가 없습니다' : '아직 연결된 관계가 없습니다'}</strong><p>{relations.length ? '위의 유형·관계 필터를 조정하세요.' : <>관계 버튼 또는 <kbd>/관계</kbd> 명령으로 첫 연결을 만드세요.</>}</p>{!relations.length && <button onClick={() => { setGraphOpen(false); openRelationPicker() }}>관계 추가</button>}</div>}
              </div>
            </section>}
          </> : <div className="knowledge-loading">노트를 불러오는 중…</div>}
        </main>
      </div>
      <footer><span>{error || (curationOpen ? '승인·승격·병합·삭제만 결정합니다. 결정하지 않은 항목은 그대로 남습니다.' : dataViewOpen ? '항목을 선택하면 해당 Markdown 노트를 엽니다.' : dirty ? '저장되지 않은 본문 변경이 있습니다.' : active ? `${statusLabels[active.status]} · 중요도 ${levelLabels[active.importance]} · 확신도 ${levelLabels[active.confidence]}` : '')}</span><div>{active && !dataViewOpen && !curationOpen && <button className={deleteReady ? 'danger' : ''} onClick={() => void remove()}><Trash2 size={13} /> {deleteReady ? '삭제 확인' : '삭제'}</button>}{dirty && <button onClick={discard}>변경 취소</button>}{active && !dataViewOpen && !curationOpen && <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={13} /> 저장</button>}</div></footer>
    </section>
  </div>
}

function splitList(value: string) { return value.split(/[,、]/).map((item) => item.trim()).filter(Boolean) }

function PropertyText({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => { if (draft.trim() !== value.trim()) onCommit(draft.trim()) }
  return <label className="knowledge-property-text"><span>{label}</span><input aria-label={label} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /></label>
}

function ringPoint(index: number, count: number, radiusX: number, radiusY: number) {
  const angle = Math.PI * 2 * index / Math.max(count, 1) - Math.PI / 2
  return { x: 50 + Math.cos(angle) * radiusX, y: 50 + Math.sin(angle) * radiusY }
}
// Second-hop nodes fan out around their parent's angle so a busy neighbour does not pile its links on one spot.
function outerPoint(parentIndex: number, parentCount: number, index: number, all: Array<{ parentId: string }>) {
  const siblings = all.filter((entry) => entry.parentId === all[index].parentId)
  const position = siblings.indexOf(all[index])
  const base = Math.PI * 2 * parentIndex / Math.max(parentCount, 1) - Math.PI / 2
  const spread = Math.min(0.9, 0.35 * Math.max(siblings.length - 1, 0))
  const angle = base - spread / 2 + (siblings.length > 1 ? spread * position / (siblings.length - 1) : 0)
  return { x: 50 + Math.cos(angle) * 46, y: 50 + Math.sin(angle) * 44 }
}
