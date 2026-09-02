import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FilePlus2, Link2, RefreshCw, Search, Lightbulb, Save, Sparkles, Trash2, X } from 'lucide-react'
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor'
import { embeddedEvidence, evidenceMarkdown, evidenceTypeLabel, removeEvidence, replaceEvidence, type EmbeddedEvidence } from './evidence'

const typeLabels: Record<KnowledgeNodeType, string> = { paper: 'Paper', concept: 'Concept', claim: 'Claim', insight: 'Insight', question: 'Question' }
const statusLabels: Record<KnowledgeStatus, string> = { inbox: 'Inbox', developing: '발전 중', established: '정리됨', archived: '보관됨' }
const levelLabels: Record<KnowledgeLevel, string> = { low: '낮음', medium: '보통', high: '높음' }

export default function KnowledgeManager({ onClose }: { onClose: () => void }) {
  const [nodes, setNodes] = useState<KnowledgeNodeRecord[]>([])
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [snapshot, setSnapshot] = useState<NoteSnapshot>()
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<KnowledgeNodeType>('concept')
  const [newTemplateId, setNewTemplateId] = useState('')
  const [deleteReady, setDeleteReady] = useState(false)
  const [error, setError] = useState('')
  const [anchors, setAnchors] = useState<EvidenceAnchor[]>([])
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceQuery, setEvidenceQuery] = useState('')
  const [evidenceType, setEvidenceType] = useState<EvidenceAnchorRef['type'] | 'all'>('all')
  const [relinking, setRelinking] = useState<EmbeddedEvidence>()
  const [promoting, setPromoting] = useState<EmbeddedEvidence>()
  const [promotionType, setPromotionType] = useState<'claim' | 'insight' | 'question'>('claim')
  const [promotionTitle, setPromotionTitle] = useState('')
  const loadingRef = useRef(0)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const active = nodes.find((node) => node.id === activeId)
  const compatibleTemplates = useMemo(() => templates.filter((template) => template.nodeType === newType), [templates, newType])
  const linkedEvidence = useMemo(() => embeddedEvidence(content), [content])
  const matchingAnchors = useMemo(() => {
    const query = evidenceQuery.trim().toLocaleLowerCase()
    return anchors.filter((anchor) => (evidenceType === 'all' || anchor.type === evidenceType) && (!query || `${anchor.paperTitle} ${anchor.label} ${anchor.source}`.toLocaleLowerCase().includes(query))).slice(0, 80)
  }, [anchors, evidenceQuery, evidenceType])

  useEffect(() => {
    Promise.all([window.prism.listKnowledgeNodes(), window.prism.listTemplates(), window.prism.listEvidenceAnchors()]).then(([items, availableTemplates, availableAnchors]) => {
      setNodes(items); setTemplates(availableTemplates); setAnchors(availableAnchors)
      if (items[0]) void openNode(items[0].id, true)
    }).catch((reason) => setError(String(reason)))
  }, [])
  useEffect(() => {
    const preferred = compatibleTemplates.find((template) => template.isDefault) ?? compatibleTemplates[0]
    setNewTemplateId(preferred?.id ?? '')
  }, [newType, compatibleTemplates])

  async function openNode(id: string, force = false) {
    if (dirty && !force) { setError('현재 노트를 저장하거나 변경을 취소한 뒤 이동하세요.'); return }
    const request = ++loadingRef.current
    try {
      const next = await window.prism.readKnowledgeNode(id)
      if (request !== loadingRef.current) return
      setActiveId(id); setSnapshot(next); setContent(next.content); setDirty(false); setCreating(false); setDeleteReady(false); setError('')
    } catch (reason) { setError(String(reason)) }
  }
  function startCreate() {
    if (dirty) { setError('현재 노트를 저장하거나 변경을 취소한 뒤 새 노트를 만드세요.'); return }
    setCreating(true); setActiveId(undefined); setSnapshot(undefined); setContent(''); setNewTitle(''); setDeleteReady(false); setError('')
  }
  async function create() {
    if (!newTitle.trim()) { setError('새 지식 노트의 제목을 입력하세요.'); return }
    try {
      const result = await window.prism.createKnowledgeNode({ title: newTitle, nodeType: newType, templateId: newTemplateId || undefined })
      setNodes(result.nodes); await openNode(result.id, true)
    } catch (reason) { setError(String(reason)) }
  }
  async function save() {
    if (!activeId || !snapshot) return
    try {
      const result = await window.prism.saveKnowledgeNode(activeId, { content, expectedRevision: snapshot.revision })
      if (!result.saved) { setError('파일이 외부에서 변경되어 저장하지 않았습니다. 창을 다시 열어 두 버전을 확인하세요.'); return }
      setSnapshot(result.snapshot); setDirty(false); setError(''); setNodes(await window.prism.listKnowledgeNodes())
    } catch (reason) { setError(String(reason)) }
  }
  async function updateProperty(patch: KnowledgePropertyPatch) {
    if (!activeId || !snapshot || dirty) { setError('본문 변경을 먼저 저장한 뒤 속성을 변경하세요.'); return }
    try {
      const result = await window.prism.updateKnowledgeProperties(activeId, patch, snapshot.revision)
      if (!result.saved) { setError('파일이 외부에서 변경되어 속성을 저장하지 않았습니다.'); return }
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setNodes(await window.prism.listKnowledgeNodes()); setError('')
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
  async function openEvidence(item: EvidenceAnchorRef) {
    try { await window.prism.openEvidenceAnchor(item); setError('Reader에서 PDF 원문 위치를 열었습니다.') }
    catch (reason) { setError(String(reason)) }
  }
  async function refreshEvidence() {
    try { setAnchors(await window.prism.listEvidenceAnchors()); setError('PDF 앵커 목록을 새로고침했습니다.') }
    catch (reason) { setError(String(reason)) }
  }
  function beginRelink(item: EmbeddedEvidence) { setRelinking(item); setEvidenceOpen(true); setEvidenceQuery(item.paperTitle); setError('대체할 PDF 위치를 선택하세요.') }
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
        <aside><button className="knowledge-new" onClick={startCreate}><FilePlus2 size={13} /> 새 지식 노트</button><div>{nodes.map((node) => <button key={node.id} className={node.id === activeId ? 'active' : ''} onClick={() => void openNode(node.id)}><span><small>{typeLabels[node.nodeType]}</small><strong>{node.title}</strong><i>{node.relativePath}</i></span><em className={`knowledge-status status-${node.status}`}>{statusLabels[node.status]}</em></button>)}</div></aside>
        <main>
          {creating || (!active && !nodes.length) ? <div className="knowledge-create"><h3>새 지식 노트</h3><p>유형과 템플릿을 선택하면 일반 Markdown 파일로 생성됩니다.</p><label><span>유형</span><select aria-label="새 지식 노트 유형" value={newType} onChange={(event) => setNewType(event.target.value as KnowledgeNodeType)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>제목</span><input autoFocus aria-label="새 지식 노트 제목" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="예: Score matching과 노이즈 예측의 관계" /></label><label><span>템플릿</span><select aria-label="새 지식 노트 템플릿" value={newTemplateId} onChange={(event) => setNewTemplateId(event.target.value)}>{compatibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.isDefault ? ' · 기본값' : ''}</option>)}</select></label><button className="primary" onClick={() => void create()}>노트 만들기</button></div> : active && snapshot ? <>
            <div className="knowledge-heading"><div><small>{typeLabels[active.nodeType]} · {active.relativePath}</small><h3>{active.title}</h3></div><div className="knowledge-properties"><label><span>상태</span><select aria-label="지식 노트 상태" value={active.status} onChange={(event) => void updateProperty({ status: event.target.value as KnowledgeStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>중요도</span><select aria-label="지식 노트 중요도" value={active.importance} onChange={(event) => void updateProperty({ importance: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>확신도</span><select aria-label="지식 노트 확신도" value={active.confidence} onChange={(event) => void updateProperty({ confidence: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="knowledge-add-evidence" aria-label="PDF 근거 추가" onClick={() => setEvidenceOpen((value) => !value)}><Link2 size={13} /> 근거 추가</button></div></div>
            {evidenceOpen && <section className="evidence-picker" aria-label="PDF 근거 선택"><header><div><Search size={14} /><input autoFocus aria-label="PDF 근거 검색" value={evidenceQuery} onChange={(event) => setEvidenceQuery(event.target.value)} placeholder={relinking ? '대체할 PDF 위치 검색' : '논문 제목, 문장, 수식 검색'} /></div><select aria-label="PDF 근거 유형" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as typeof evidenceType)}><option value="all">모든 유형</option>{(['sentence', 'equation', 'table', 'figure', 'page'] as const).map((type) => <option key={type} value={type}>{evidenceTypeLabel(type)}</option>)}</select><button aria-label="PDF 앵커 새로고침" title="Reader의 최신 앵커 불러오기" onClick={() => void refreshEvidence()}><RefreshCw size={13} /></button><button aria-label="PDF 근거 선택 닫기" onClick={() => { setEvidenceOpen(false); setRelinking(undefined) }}><X size={14} /></button></header><div>{matchingAnchors.length ? matchingAnchors.map((anchor) => <button key={`${anchor.paperId}-${anchor.anchorId}`} onClick={() => addEvidence(anchor)}><span><small>{evidenceTypeLabel(anchor.type)} · p.{anchor.page} · {anchor.label}</small><strong>{anchor.paperTitle}</strong><p>{anchor.source}</p></span><Link2 size={14} /></button>) : <p className="evidence-empty">저장된 PDF 앵커가 없습니다. Reader에서 논문을 열면 문장·수식·표 앵커가 생성됩니다.</p>}</div></section>}
            {linkedEvidence.length > 0 && <section className="evidence-strip" aria-label="연결된 PDF 근거"><header><span>연결된 근거</span><small>{linkedEvidence.length}</small></header><div>{linkedEvidence.map((item) => { const current = anchors.find((anchor) => anchor.paperId === item.paperId && anchor.anchorId === item.anchorId); const broken = !current || current.sourceHash !== item.sourceHash; return <article className={broken ? 'needs-relink' : ''} key={item.blockId}><button className="evidence-open" onClick={() => void openEvidence(item)}><span><small>{broken ? '재연결 필요' : `${evidenceTypeLabel(item.type)} · p.${item.page}`}</small><strong>{item.paperTitle}</strong><p>{item.source}</p></span><ExternalLink size={14} /></button><div className="evidence-card-actions">{broken && <button onClick={() => beginRelink(item)}>재연결</button>}<button onClick={() => beginPromotion(item)}><Sparkles size={10} /> 승격</button></div><button className="evidence-unlink" aria-label={`${item.label} 근거 링크 삭제`} onClick={() => unlinkEvidence(item)}><X size={12} /></button></article> })}</div></section>}
            <div className="knowledge-editor"><MarkdownEditor ref={editorRef} key={active.id} value={content} onChange={(value) => { setContent(value); setDirty(true); setError('') }} onBlur={() => undefined} liveEdit label={`${active.title} 지식 노트`} /></div>
            {promoting && <section className="evidence-promote" role="dialog" aria-modal="true" aria-labelledby="evidence-promote-title"><header><div><Sparkles size={15} /><span><h4 id="evidence-promote-title">근거를 지식 노트로 승격</h4><p>원래 PDF 근거와 출처 노트 링크를 그대로 유지합니다.</p></span></div><button aria-label="근거 승격 닫기" onClick={() => setPromoting(undefined)}><X size={14} /></button></header><div><label><span>노트 유형</span><select aria-label="승격 노트 유형" value={promotionType} onChange={(event) => setPromotionType(event.target.value as typeof promotionType)}><option value="claim">Claim</option><option value="insight">Insight</option><option value="question">Question</option></select></label><label><span>제목</span><input autoFocus aria-label="승격 노트 제목" value={promotionTitle} onChange={(event) => setPromotionTitle(event.target.value)} /></label></div><footer><button onClick={() => setPromoting(undefined)}>취소</button><button className="primary" onClick={() => void promote()}>승격하기</button></footer></section>}
          </> : <div className="knowledge-loading">노트를 불러오는 중…</div>}
        </main>
      </div>
      <footer><span>{error || (dirty ? '저장되지 않은 본문 변경이 있습니다.' : active ? `${statusLabels[active.status]} · 중요도 ${levelLabels[active.importance]} · 확신도 ${levelLabels[active.confidence]}` : '')}</span><div>{active && <button className={deleteReady ? 'danger' : ''} onClick={() => void remove()}><Trash2 size={13} /> {deleteReady ? '삭제 확인' : '삭제'}</button>}{dirty && <button onClick={discard}>변경 취소</button>}{active && <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={13} /> 저장</button>}</div></footer>
    </section>
  </div>
}
