import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus2, Lightbulb, Save, Trash2, X } from 'lucide-react'
import MarkdownEditor from './MarkdownEditor'

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
  const loadingRef = useRef(0)
  const active = nodes.find((node) => node.id === activeId)
  const compatibleTemplates = useMemo(() => templates.filter((template) => template.nodeType === newType), [templates, newType])

  useEffect(() => {
    Promise.all([window.prism.listKnowledgeNodes(), window.prism.listTemplates()]).then(([items, availableTemplates]) => {
      setNodes(items); setTemplates(availableTemplates)
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
            <div className="knowledge-heading"><div><small>{typeLabels[active.nodeType]} · {active.relativePath}</small><h3>{active.title}</h3></div><div className="knowledge-properties"><label><span>상태</span><select aria-label="지식 노트 상태" value={active.status} onChange={(event) => void updateProperty({ status: event.target.value as KnowledgeStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>중요도</span><select aria-label="지식 노트 중요도" value={active.importance} onChange={(event) => void updateProperty({ importance: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>확신도</span><select aria-label="지식 노트 확신도" value={active.confidence} onChange={(event) => void updateProperty({ confidence: event.target.value as KnowledgeLevel })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div>
            <div className="knowledge-editor"><MarkdownEditor key={active.id} value={content} onChange={(value) => { setContent(value); setDirty(true); setError('') }} onBlur={() => undefined} liveEdit label={`${active.title} 지식 노트`} /></div>
          </> : <div className="knowledge-loading">노트를 불러오는 중…</div>}
        </main>
      </div>
      <footer><span>{error || (dirty ? '저장되지 않은 본문 변경이 있습니다.' : active ? `${statusLabels[active.status]} · 중요도 ${levelLabels[active.importance]} · 확신도 ${levelLabels[active.confidence]}` : '')}</span><div>{active && <button className={deleteReady ? 'danger' : ''} onClick={() => void remove()}><Trash2 size={13} /> {deleteReady ? '삭제 확인' : '삭제'}</button>}{dirty && <button onClick={discard}>변경 취소</button>}{active && <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={13} /> 저장</button>}</div></footer>
    </section>
  </div>
}
