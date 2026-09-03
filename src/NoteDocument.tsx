import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, ChevronDown, Check, ExternalLink, Link2, MoreHorizontal, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import MarkdownEditor, { type MarkdownEditorHandle, type MarkdownSlashAction, type WikiLinkOption } from './MarkdownEditor'
import { embeddedEvidence, evidenceMarkdown, evidenceTypeLabel, removeEvidence, replaceEvidence, type EmbeddedEvidence } from './evidence'
import {
  claimOriginLabels, evidenceKindLabels, fileName, levelLabels, nodePath, primaryRelationTypes, readingStatusLabels,
  relationLabels, relationTypesFor, scopeConflict, splitList, statusLabels, typeLabels,
} from './knowledgeModel'

type Picker =
  | { kind: 'link'; query: string }
  | { kind: 'relation'; query: string; type: KnowledgeRelationType }
  | { kind: 'evidence'; query: string; relink?: EmbeddedEvidence }
  | { kind: 'evidence-claim'; query: string; evidence: EmbeddedEvidence; type: 'supports' | 'contradicts' | 'extends' }
  | { kind: 'copy-evidence'; query: string; evidence: EmbeddedEvidence }

/**
 * One document view for every node type. Papers and knowledge notes are the same kind of thing now,
 * so the editor, properties, and evidence all live here instead of behind a modal.
 */
export default function NoteDocument({ node, nodes, anchors, relations, templates, onReloadNodes, onReloadContext, onOpenNode, onNotify, onOpenCuration }: {
  node: KnowledgeNodeRecord
  nodes: KnowledgeNodeRecord[]
  anchors: EvidenceAnchor[]
  relations: KnowledgeRelationView[]
  templates: TemplateRecord[]
  onReloadNodes: () => Promise<void> | void
  onReloadContext: () => Promise<void> | void
  onOpenNode: (id: string) => void
  onNotify: (message: string, tone?: 'info' | 'error') => void
  onOpenCuration: () => void
}) {
  const [snapshot, setSnapshot] = useState<NoteSnapshot>()
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(true)
  const [conflict, setConflict] = useState<NoteSnapshot>()
  const [picker, setPicker] = useState<Picker>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteReady, setDeleteReady] = useState(false)
  const [propsOpen, setPropsOpen] = useState(() => window.localStorage.getItem('prism.notes.propsOpen') !== 'off')
  const [pendingContradiction, setPendingContradiction] = useState<{ message: string; run: () => Promise<void> }>()
  const [suggesting, setSuggesting] = useState(false)
  const contentRef = useRef(''); const dirtyRef = useRef(false); const revisionRef = useRef<string | undefined>(undefined); const nodeIdRef = useRef(node.id); const stubScanRef = useRef('')
  const editorRef = useRef<MarkdownEditorHandle>(null)

  const linkedEvidence = useMemo(() => embeddedEvidence(content), [content])
  const approved = relations.filter((item) => item.reviewStatus === 'approved' && item.type !== 'mentions')
  const pending = relations.filter((item) => item.reviewStatus === 'pending')
  const relationGroups = useMemo(() => {
    const groups = new Map<string, KnowledgeRelationView[]>()
    for (const item of approved) {
      const key = `${item.direction}:${item.type}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
  }, [approved])
  const wikiLinks = useMemo<WikiLinkOption[]>(() => nodes.filter((item) => item.id !== node.id).map((item) => ({
    id: item.id, label: item.title, target: nodePath(item), description: typeLabels[item.nodeType],
    searchText: `${item.nodeType} ${item.preview}`, preview: item.preview, evidenceCount: item.evidenceCount,
  })), [nodes, node.id])
  const evidenceLinks = useMemo(() => anchors
    .filter((anchor) => !linkedEvidence.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId))
    .map((anchor) => ({ id: `${anchor.paperId}-${anchor.anchorId}`, label: anchor.label, description: `${evidenceTypeLabel(anchor.type)} · ${anchor.paperTitle} · p.${anchor.page}`, searchText: `${anchor.paperTitle} ${anchor.source}`, markdown: evidenceMarkdown(anchor) })), [anchors, linkedEvidence])
  const nodeTemplates = useMemo(() => templates.filter((item) => item.nodeType === node.nodeType), [templates, node.nodeType])

  useEffect(() => { nodeIdRef.current = node.id }, [node.id])
  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => {
    let disposed = false
    setSnapshot(undefined); setContent(''); setSaved(true); setConflict(undefined); setPicker(undefined); setMenuOpen(false); setDeleteReady(false)
    dirtyRef.current = false
    window.prism.readKnowledgeNode(node.id).then((next) => {
      if (disposed) return
      revisionRef.current = next.revision; contentRef.current = next.content; stubScanRef.current = next.content
      setSnapshot(next); setContent(next.content)
    }).catch((reason) => onNotify(String(reason), 'error'))
    return () => { disposed = true }
  }, [node.id])

  async function save(force = false) {
    const id = nodeIdRef.current
    if (!dirtyRef.current || !revisionRef.current) return true
    if (conflict && !force) return false
    const value = contentRef.current
    try {
      const result = await window.prism.saveKnowledgeNode(id, { content: value, expectedRevision: revisionRef.current, force })
      if (!result.saved) { setConflict(result.conflict); setSaved(false); return false }
      revisionRef.current = result.snapshot.revision
      setConflict(undefined); setSnapshot(result.snapshot)
      if (nodeIdRef.current === id && contentRef.current === value) { dirtyRef.current = false; setSaved(true) }
      return true
    } catch (reason) { onNotify(String(reason), 'error'); return false }
  }

  /** Links are free; the note behind one is written only once. Runs after editing settles, never on every keystroke. */
  async function settle() {
    const id = nodeIdRef.current
    if (!(await save())) return
    if (stubScanRef.current === contentRef.current) return
    stubScanRef.current = contentRef.current
    try {
      const stubs = await window.prism.ensureLinkStubs(id)
      if (stubs.length) onNotify(`[[링크]]에서 새 개념 ${stubs.length}개를 만들었습니다: ${stubs.join(', ')}`)
      if (stubs.length) await onReloadNodes()
      await onReloadContext()
    } catch { /* the note may have been deleted or renamed meanwhile */ }
  }

  useEffect(() => {
    if (saved || conflict || !snapshot) return
    const quick = window.setTimeout(() => void save(), 400)
    return () => window.clearTimeout(quick)
  }, [content, saved, conflict, snapshot])
  // The link scan is deliberately independent of the save state: saving clears `saved`, and the scan
  // still has to run once typing stops.
  useEffect(() => {
    if (!snapshot || conflict) return
    const later = window.setTimeout(() => void settle(), 2200)
    return () => window.clearTimeout(later)
  }, [content, snapshot, conflict])
  useEffect(() => {
    const flush = () => { void save() }
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); void save() }
  }, [node.id])
  // Obsidian and the Reader write the same files, so keep watching disk while this note is open.
  useEffect(() => {
    if (!snapshot) return
    let disposed = false; let checking = false
    const check = async () => {
      if (checking || disposed) return
      checking = true
      try {
        const next = await window.prism.readKnowledgeNode(node.id)
        if (disposed || next.revision === revisionRef.current) return
        if (dirtyRef.current) setConflict(next)
        else {
          revisionRef.current = next.revision; contentRef.current = next.content
          setSnapshot(next); setContent(next.content); setSaved(true)
          void onReloadContext()
        }
      } catch { /* the note may have been renamed or deleted elsewhere */ }
      finally { checking = false }
    }
    const timer = window.setInterval(() => void check(), 1200)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [node.id, snapshot?.revision])

  function edit(value: string) { contentRef.current = value; dirtyRef.current = true; setContent(value); setSaved(false) }

  async function updateProperty(patch: KnowledgePropertyPatch) {
    if (dirtyRef.current && !(await save())) return
    try {
      // The properties render before the file finishes loading; fetch the revision rather than dropping the edit.
      if (!revisionRef.current) revisionRef.current = (await window.prism.readKnowledgeNode(node.id)).revision
      const result = await window.prism.updateKnowledgeProperties(node.id, patch, revisionRef.current)
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 속성을 저장하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true)
      await onReloadNodes()
      if (patch.readingStatus === 'read') void runModelSuggestions()
    } catch (reason) { onNotify(String(reason), 'error') }
  }

  async function runModelSuggestions() {
    if (node.nodeType !== 'paper' || suggesting) return
    const settings = await window.prism.getSettings().catch(() => undefined)
    if (!settings?.knowledgeProvider || !settings.knowledgeModel) { onNotify('리더 설정에서 지식 제안 CLI를 먼저 고르면 읽음 표시할 때 관계를 제안합니다.'); return }
    setSuggesting(true); onNotify(`${settings.knowledgeModel}이(가) 이 노트를 읽고 관계와 승격 후보를 제안하는 중입니다.`)
    try {
      const summary = await window.prism.runModelSuggestions(node.id)
      await onReloadContext()
      onNotify(`제안 완료: 관계 ${summary.relationsCreated}개, 필기 힌트 ${summary.candidates}개, 새 개념 ${summary.concepts}개가 정리 대기열에 있습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
    finally { setSuggesting(false) }
  }

  async function addRelation(target: KnowledgeNodeRecord, type: KnowledgeRelationType, confirmed = false) {
    const warning = type === 'contradicts' && !confirmed ? scopeConflict(node, target) : undefined
    if (warning) { setPendingContradiction({ message: warning, run: () => addRelation(target, type, true) }); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.createKnowledgeRelation({ sourceId: node.id, targetId: target.id, type, creator: 'user', expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 관계를 추가하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true); setPicker(undefined)
      await onReloadContext(); await onReloadNodes()
      onNotify(`${target.title}와(과) '${relationLabels[type]}' 관계를 만들었습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  async function deleteRelation(item: KnowledgeRelationView) {
    if (item.direction !== 'outgoing') { onNotify('이 노트에서 만든 관계만 삭제할 수 있습니다. 반대쪽 노트에서 지우세요.'); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.deleteKnowledgeRelation({ id: item.id, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 관계를 삭제하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true)
      await onReloadContext()
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  async function reviewRelation(item: KnowledgeRelationView, decision: 'approved' | 'rejected') {
    if (item.direction !== 'outgoing') { onOpenCuration(); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.reviewKnowledgeRelation({ id: item.id, decision, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 검토 결과를 저장하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true)
      await onReloadContext()
      onNotify(decision === 'approved' ? 'AI 관계를 승인해 노트와 그래프에 반영했습니다.' : 'AI 관계를 거절했습니다.')
    } catch (reason) { onNotify(String(reason), 'error') }
  }

  function insertEvidence(anchor: EvidenceAnchor, relink?: EmbeddedEvidence) {
    if (relink) { edit(replaceEvidence(contentRef.current, relink, anchor)); setPicker(undefined); onNotify('새 PDF 위치로 재연결했습니다.'); return }
    if (linkedEvidence.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId)) { onNotify('이미 이 노트에 연결된 근거입니다.'); return }
    editorRef.current?.insertText(evidenceMarkdown(anchor)); setPicker(undefined)
  }
  async function connectEvidenceClaim(evidence: EmbeddedEvidence, target: KnowledgeNodeRecord, type: 'supports' | 'contradicts' | 'extends', confirmed = false) {
    const warning = type === 'contradicts' && !confirmed ? scopeConflict(node, target) : undefined
    if (warning) { setPendingContradiction({ message: warning, run: () => connectEvidenceClaim(evidence, target, type, true) }); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    const evidenceAnchor: RelationEvidenceAnchor = { paperId: evidence.paperId, anchorId: evidence.anchorId, type: evidence.type, page: evidence.page, label: evidence.label }
    try {
      const result = await window.prism.createKnowledgeRelation({ sourceId: node.id, targetId: target.id, type, creator: 'user', evidenceAnchor, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('노트가 외부에서 변경되어 근거 관계를 저장하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true); setPicker(undefined)
      await onReloadContext()
      onNotify(`이 근거를 '${target.title}'에 '${relationLabels[type]}' 관계로 연결했습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  async function copyEvidence(evidence: EmbeddedEvidence, target: KnowledgeNodeRecord) {
    try {
      const result = await window.prism.copyKnowledgeEvidence({ sourceNodeId: node.id, targetNodeId: target.id, blockId: evidence.blockId, expectedTargetRevision: target.revision })
      if (!result.saved) { await onReloadNodes(); onNotify('대상 노트가 외부에서 변경되어 복사하지 않았습니다. 다시 선택해 주세요.', 'error'); return }
      setPicker(undefined); await onReloadNodes(); onNotify(`근거 카드를 '${target.title}'에 복사했습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }

  async function createLinkedNode(nodeType: 'concept' | 'claim', title: string) {
    try {
      const created = await window.prism.createKnowledgeNode({ nodeType, title })
      const next = created.nodes.find((item) => item.id === created.id)
      await onReloadNodes()
      if (!next) return undefined
      return { id: next.id, label: next.title, target: nodePath(next), description: typeLabels[next.nodeType], preview: next.preview, evidenceCount: next.evidenceCount }
    } catch (reason) { onNotify(String(reason), 'error'); return undefined }
  }
  async function insertLink(target: KnowledgeNodeRecord) {
    editorRef.current?.insertWikiLink({ id: target.id, label: target.title, target: nodePath(target), description: typeLabels[target.nodeType] })
    setPicker(undefined)
  }
  async function applyTemplateSections(templateId: string) {
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.applyTemplateSections({ nodeId: node.id, templateId, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 섹션을 추가하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true); setMenuOpen(false)
      onNotify(result.addedHeadings.length ? `누락된 섹션 ${result.addedHeadings.length}개를 추가했습니다: ${result.addedHeadings.join(', ')}` : '이 양식의 섹션이 이미 모두 있습니다.')
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  async function removeNode() {
    if (!deleteReady) { setDeleteReady(true); onNotify('한 번 더 누르면 이 노트를 휴지통으로 보냅니다.'); return }
    try { await window.prism.deleteKnowledgeNode(node.id); setMenuOpen(false); setDeleteReady(false); await onReloadNodes(); onNotify('노트를 휴지통으로 보냈습니다.') }
    catch (reason) { onNotify(String(reason), 'error') }
  }

  function runSlashAction(action: MarkdownSlashAction) {
    if (action === 'link') { setPicker({ kind: 'link', query: '' }); return }
    if (action === 'evidence') { setPicker({ kind: 'evidence', query: '' }); return }
    if (action === 'graph') { onNotify('연결 그래프는 오른쪽 패널에 항상 열려 있습니다.'); return }
    const type: KnowledgeRelationType = action === 'supports' ? 'supports' : action === 'contradicts' ? 'contradicts' : (availableRelationTypes[0] ?? 'uses')
    openRelationPicker(type)
  }
  const availableRelationTypes = useMemo(() => primaryRelationTypes.filter((type) => nodes.some((other) => other.id !== node.id && relationTypesFor(node, other).includes(type))), [nodes, node])
  function openRelationPicker(type?: KnowledgeRelationType) {
    const next = type && availableRelationTypes.includes(type) ? type : availableRelationTypes[0]
    if (!next) { onNotify('이 노트에서 만들 수 있는 관계가 없습니다. 본문에서 [[링크]]로 연결하세요.'); return }
    setPicker({ kind: 'relation', query: '', type: next })
  }

  const pickerTargets = useMemo(() => {
    if (!picker) return []
    const query = picker.query.trim().toLocaleLowerCase()
    const match = (item: { title: string; preview: string; relativePath: string }) => !query || `${item.title} ${item.preview} ${item.relativePath}`.toLocaleLowerCase().includes(query)
    if (picker.kind === 'relation') return nodes.filter((item) => item.id !== node.id && relationTypesFor(node, item).includes(picker.type) && match(item)).slice(0, 40)
    if (picker.kind === 'evidence-claim') return nodes.filter((item) => item.nodeType === 'claim' && item.id !== node.id && match(item)).slice(0, 40)
    if (picker.kind === 'copy-evidence') return nodes.filter((item) => item.id !== node.id && match(item)).slice(0, 40)
    if (picker.kind === 'link') return nodes.filter((item) => item.id !== node.id && match(item)).slice(0, 40)
    return []
  }, [picker, nodes, node])
  const pickerAnchors = useMemo(() => {
    if (picker?.kind !== 'evidence') return []
    const query = picker.query.trim().toLocaleLowerCase()
    return anchors.filter((anchor) => !query || `${anchor.paperTitle} ${anchor.label} ${anchor.source}`.toLocaleLowerCase().includes(query)).slice(0, 60)
  }, [picker, anchors])

  const ready = Boolean(snapshot)
  const properties: Array<{ key: string; label: string; value: React.ReactNode }> = [
    { key: 'type', label: '유형', value: <span className={`node-kind kind-${node.nodeType}`}><i /> {typeLabels[node.nodeType]}</span> },
    { key: 'status', label: '상태', value: <select aria-label="노트 상태" disabled={!ready} value={node.status} onChange={(event) => void updateProperty({ status: event.target.value as KnowledgeStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> },
  ]
  if (node.nodeType === 'paper') properties.push({ key: 'reading', label: '읽기', value: <select aria-label="논문 읽기 상태" disabled={!ready} value={node.readingStatus ?? 'to_read'} onChange={(event) => void updateProperty({ readingStatus: event.target.value as KnowledgeReadingStatus })}>{Object.entries(readingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> })
  if (node.nodeType === 'claim') {
    properties.push({ key: 'origin', label: '출처', value: <select aria-label="주장 출처" disabled={!ready} value={node.claimOrigin ?? 'paper'} onChange={(event) => void updateProperty({ claimOrigin: event.target.value as ClaimOrigin })}>{Object.entries(claimOriginLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> })
    properties.push({ key: 'evidence-kind', label: '근거 종류', value: <select aria-label="주장 근거 종류" disabled={!ready} value={node.evidenceKind ?? ''} onChange={(event) => void updateProperty({ evidenceKind: event.target.value as EvidenceKind | '' })}><option value="">미정</option>{Object.entries(evidenceKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> })
    properties.push({ key: 'scope', label: '적용 범위', value: <span className="prop-inline"><PropertyText disabled={!ready} label="도메인" placeholder="예: 이미지 생성" value={node.scopeDomain ?? ''} onCommit={(value) => void updateProperty({ scopeDomain: value })} /><PropertyText disabled={!ready} label="조건" placeholder="예: 대규모 데이터" value={node.scopeRegime ?? ''} onCommit={(value) => void updateProperty({ scopeRegime: value })} /><PropertyText disabled={!ready} label="가정" placeholder="쉼표로 구분" value={(node.scopeAssumptions ?? []).join(', ')} onCommit={(value) => void updateProperty({ scopeAssumptions: splitList(value) })} /></span> })
  }
  properties.push({ key: 'levels', label: '중요도 · 확신도', value: <span className="prop-inline"><select aria-label="노트 중요도" disabled={!ready} value={node.importance} onChange={(event) => void updateProperty({ importance: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="노트 확신도" disabled={!ready} value={node.confidence} onChange={(event) => void updateProperty({ confidence: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span> })
  properties.push({ key: 'projects', label: '프로젝트', value: <PropertyText disabled={!ready} label="프로젝트" placeholder="쉼표로 구분" value={(node.projects ?? []).join(', ')} onCommit={(value) => void updateProperty({ projects: splitList(value) })} /> })

  return <article className="note-doc" aria-label={`${node.title} 노트`}>
    <header className="note-doc-head">
      <div className="note-doc-title">
        <span className={`node-kind kind-${node.nodeType}`}><i /> {typeLabels[node.nodeType]}</span>
        <h1>{node.title}</h1>
        <small title={node.relativePath}>{fileName(node)}</small>
      </div>
      <div className="note-doc-actions">
        <span className={`note-save ${saved ? 'is-saved' : ''}`} role="status">{saved ? '저장됨' : '저장 중…'}</span>
        {node.nodeType === 'paper' && node.arxivId && <button className="ghost" title="이 논문을 리더 창에서 엽니다" onClick={() => void window.prism.openPaperInReader(node.arxivId!)}><BookOpen size={13} /> 리더에서 열기</button>}
        <button className="ghost" title="본문에 다른 노트 링크를 넣습니다" onClick={() => setPicker({ kind: 'link', query: '' })}><Link2 size={13} /> 링크</button>
        <button className="ghost" title="PDF 문장·수식·표·피겨를 근거 카드로 넣습니다" onClick={() => setPicker({ kind: 'evidence', query: '' })}><Plus size={13} /> 근거</button>
        <div className="note-doc-menu">
          <button className="ghost icon" aria-label="노트 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={14} /></button>
          {menuOpen && <div className="note-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); void window.prism.openKnowledgeNodeInObsidian({ nodeId: node.id }).catch((reason) => onNotify(String(reason), 'error')) }}><ExternalLink size={12} /> Obsidian에서 열기</button>
            {node.nodeType === 'paper' && <button role="menuitem" disabled={suggesting} onClick={() => { setMenuOpen(false); void runModelSuggestions() }}><Sparkles size={12} /> {suggesting ? '제안 중…' : '모델에게 관계 제안 받기'}</button>}
            {nodeTemplates.map((template) => <button key={template.id} role="menuitem" onClick={() => void applyTemplateSections(template.id)}>양식 적용 · {template.name}</button>)}
            <button role="menuitem" className={deleteReady ? 'danger' : ''} onClick={() => void removeNode()}><Trash2 size={12} /> {deleteReady ? '삭제 확인' : '휴지통으로 보내기'}</button>
          </div>}
        </div>
      </div>
    </header>

    <div className="note-doc-scroll">
      <div className="note-doc-inner">
        <details className="note-props" open={propsOpen} onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setPropsOpen(open); window.localStorage.setItem('prism.notes.propsOpen', open ? 'on' : 'off') }}>
          <summary><ChevronDown size={12} /> 속성 {properties.length + relationGroups.length}개</summary>
          <table>
            <tbody>
              {properties.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.value}</td></tr>)}
              {relationGroups.map(([key, items]) => {
                const [direction, type] = key.split(':') as ['outgoing' | 'incoming', KnowledgeRelationType]
                return <tr key={key}><td>{direction === 'outgoing' ? relationLabels[type] : `${relationLabels[type]} (받음)`}</td><td className="prop-relations">
                  {items.map((item) => <span key={item.id} className="rel-chip"><button onClick={() => onOpenNode(item.other.id)}>{item.other.title}</button>{item.direction === 'outgoing' && <button className="rel-remove" aria-label={`${item.other.title} 관계 삭제`} onClick={() => void deleteRelation(item)}><X size={10} /></button>}</span>)}
                </td></tr>
              })}
              {pending.length > 0 && <tr className="prop-pending"><td>검토 대기</td><td>
                {pending.map((item) => <span key={item.id} className="rel-chip is-pending"><button onClick={() => onOpenNode(item.other.id)}>{relationLabels[item.type]} · {item.other.title}</button>{item.direction === 'outgoing' && <><button className="rel-approve" aria-label={`${item.other.title} 관계 승인`} onClick={() => void reviewRelation(item, 'approved')}><Check size={10} /></button><button className="rel-remove" aria-label={`${item.other.title} 관계 거절`} onClick={() => void reviewRelation(item, 'rejected')}><X size={10} /></button></>}</span>)}
              </td></tr>}
              <tr className="prop-add"><td /><td><button onClick={() => openRelationPicker()}><Plus size={11} /> 관계 추가</button></td></tr>
            </tbody>
          </table>
        </details>

        {snapshot ? <div className="note-body">
          <MarkdownEditor
            ref={editorRef} key={node.id} value={content} onChange={edit} onBlur={() => void settle()}
            liveEdit label={`${node.title} 본문`} wikiLinks={wikiLinks} evidenceLinks={evidenceLinks}
            onCreateWikiLink={createLinkedNode} slashActions={['link', 'evidence', 'relation', 'supports', 'contradicts']} onSlashAction={runSlashAction}
          />
          <p className="note-hint"><button onClick={() => editorRef.current?.openInsertMenu()}><Plus size={11} /> 블록 삽입</button><span><kbd>/</kbd> 블록 · <kbd>[[</kbd> 노트 링크 · <kbd>@</kbd> PDF 근거</span></p>
        </div> : <p className="note-loading">노트를 불러오는 중…</p>}

        {linkedEvidence.length > 0 && <details className="note-evidence" open>
          <summary>PDF 근거 {linkedEvidence.length}개</summary>
          {linkedEvidence.map((item) => {
            const current = anchors.find((anchor) => anchor.paperId === item.paperId && anchor.anchorId === item.anchorId)
            const broken = !current || current.sourceHash !== item.sourceHash
            return <div key={item.blockId} className={`evidence-row${broken ? ' is-broken' : ''}`}>
              <button className="evidence-open" onClick={() => void window.prism.openEvidenceAnchor(item).catch((reason) => onNotify(String(reason), 'error'))}>
                <small>{broken ? '재연결 필요' : `${evidenceTypeLabel(item.type)} · p.${item.page}`} · {item.paperTitle}</small>
                <span>{item.source}</span>
              </button>
              <div className="evidence-actions">
                {broken && <button onClick={() => setPicker({ kind: 'evidence', query: item.paperTitle, relink: item })}>재연결</button>}
                <button onClick={() => setPicker({ kind: 'evidence-claim', query: '', evidence: item, type: 'supports' })}>주장에 연결</button>
                <button onClick={() => setPicker({ kind: 'copy-evidence', query: '', evidence: item })}>복사</button>
                <button aria-label={`${item.label} 근거 링크 삭제`} onClick={() => { edit(removeEvidence(contentRef.current, item)); onNotify('근거 링크만 제거했습니다. PDF 원문과 다른 노트는 그대로입니다.') }}><X size={11} /></button>
              </div>
            </div>
          })}
        </details>}
      </div>
    </div>

    {picker && <section className="note-picker" aria-label={picker.kind === 'evidence' ? 'PDF 근거 선택' : picker.kind === 'relation' ? '관계 대상 선택' : picker.kind === 'evidence-claim' ? '근거를 연결할 주장 선택' : picker.kind === 'copy-evidence' ? '근거를 복사할 노트 선택' : '연결할 노트 선택'}>
      <header>
        <div><Search size={13} /><input autoFocus aria-label="노트 및 근거 검색" value={picker.query} placeholder={picker.kind === 'evidence' ? '논문 제목, 문장, 수식 검색' : '제목, 본문 검색'} onChange={(event) => setPicker({ ...picker, query: event.target.value })} /></div>
        <button aria-label="선택 닫기" onClick={() => setPicker(undefined)}><X size={13} /></button>
      </header>
      {picker.kind === 'relation' && <nav className="picker-types" aria-label="관계 유형">{availableRelationTypes.map((type) => <button key={type} className={picker.type === type ? 'active' : ''} aria-pressed={picker.type === type} onClick={() => setPicker({ ...picker, type })}>{relationLabels[type]}</button>)}</nav>}
      {picker.kind === 'evidence-claim' && <nav className="picker-types" aria-label="근거 관계 유형">{(['supports', 'contradicts', 'extends'] as const).map((type) => <button key={type} className={picker.type === type ? 'active' : ''} aria-pressed={picker.type === type} onClick={() => setPicker({ ...picker, type })}>{relationLabels[type]}</button>)}</nav>}
      <div className="picker-list">
        {picker.kind === 'evidence'
          ? pickerAnchors.length ? pickerAnchors.map((anchor) => <button key={`${anchor.paperId}-${anchor.anchorId}`} onClick={() => insertEvidence(anchor, picker.relink)}><small>{evidenceTypeLabel(anchor.type)} · p.{anchor.page} · {anchor.paperTitle}</small><strong>{anchor.source}</strong></button>)
            : <p>저장된 PDF 앵커가 없습니다. 리더에서 논문을 열면 문장·수식·표 앵커가 만들어집니다.</p>
          : pickerTargets.length ? pickerTargets.map((target) => <button key={target.id} onClick={() => {
            if (picker.kind === 'relation') void addRelation(target, picker.type)
            else if (picker.kind === 'evidence-claim') void connectEvidenceClaim(picker.evidence, target, picker.type)
            else if (picker.kind === 'copy-evidence') void copyEvidence(picker.evidence, target)
            else void insertLink(target)
          }}><small>{typeLabels[target.nodeType]} · {target.relativePath}</small><strong>{target.title}</strong></button>)
            : <p>조건에 맞는 노트가 없습니다.</p>}
      </div>
      {picker.kind === 'link' && picker.query.trim() && !nodes.some((item) => item.title.toLocaleLowerCase() === picker.query.trim().toLocaleLowerCase()) && <footer>
        <button onClick={async () => { const option = await createLinkedNode('concept', picker.query.trim()); if (option) { editorRef.current?.insertWikiLink(option); setPicker(undefined) } }}>'{picker.query.trim()}' 개념으로 만들기</button>
        <button onClick={async () => { const option = await createLinkedNode('claim', picker.query.trim()); if (option) { editorRef.current?.insertWikiLink(option); setPicker(undefined) } }}>주장으로 만들기</button>
      </footer>}
    </section>}

    {pendingContradiction && <section className="note-scope-warning" role="alertdialog" aria-label="스코프 경고">
      <div><strong>두 주장의 적용 범위가 겹치지 않습니다</strong><p>{pendingContradiction.message} 모순이 아니라 조건 차이일 수 있습니다.</p></div>
      <footer><button onClick={() => setPendingContradiction(undefined)}>취소</button><button className="primary" onClick={() => { const run = pendingContradiction.run; setPendingContradiction(undefined); void run() }}>그래도 반박으로 연결</button></footer>
    </section>}

    {conflict && <div className="notes-conflict-backdrop" role="presentation">
      <section className="notes-conflict" role="dialog" aria-modal="true" aria-labelledby="notes-conflict-title">
        <header><AlertTriangle size={18} /><div><h2 id="notes-conflict-title">외부 변경과 충돌했습니다</h2><p>다른 편집기에서 이 파일을 바꿨습니다. 두 버전을 비교한 뒤 보존할 내용을 고르세요.</p></div></header>
        <div className="notes-conflict-compare">
          <article><h3>내 편집본</h3><pre>{content}</pre></article>
          <article><h3>디스크 최신 버전</h3><small>{new Date(conflict.modifiedAt).toLocaleString()}</small><pre>{conflict.content}</pre></article>
        </div>
        <footer>
          <button onClick={() => { revisionRef.current = conflict.revision; contentRef.current = conflict.content; dirtyRef.current = false; setContent(conflict.content); setSnapshot(conflict); setConflict(undefined); setSaved(true) }}>디스크 버전 사용</button>
          <button className="primary" onClick={() => void save(true)}>내 편집본으로 덮어쓰기</button>
        </footer>
      </section>
    </div>}
  </article>
}

function PropertyText({ label, value, placeholder, disabled, onCommit }: { label: string; value: string; placeholder?: string; disabled?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return <input
    className="prop-text" aria-label={label} value={draft} placeholder={placeholder} disabled={disabled}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft.trim() !== value.trim()) onCommit(draft.trim()) }}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}
  />
}
