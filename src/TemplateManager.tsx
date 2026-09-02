import { useEffect, useMemo, useState } from 'react'
import { Copy, FilePlus2, Save, Star, Trash2, X } from 'lucide-react'
import MarkdownEditor from './MarkdownEditor'

const typeLabels: Record<KnowledgeNodeType, string> = { paper: 'Paper', concept: 'Concept', claim: 'Claim', insight: 'Insight', question: 'Question' }
type Draft = { id?: string; name: string; nodeType: KnowledgeNodeType; content: string; revision?: string }

function fromTemplate(template: TemplateRecord): Draft {
  return { id: template.id, name: template.name, nodeType: template.nodeType, content: template.content, revision: template.revision }
}

export default function TemplateManager({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [draft, setDraft] = useState<Draft>({ name: '새 Paper 템플릿', nodeType: 'paper', content: '# {{title}}\n\n' })
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteReady, setDeleteReady] = useState(false)
  const selected = useMemo(() => templates.find((template) => template.id === draft.id), [templates, draft.id])

  useEffect(() => {
    window.prism.listTemplates().then((items) => { setTemplates(items); if (items[0]) setDraft(fromTemplate(items[0])); setLoading(false) }).catch((reason) => { setError(String(reason)); setLoading(false) })
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !dirty) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [dirty, onClose])

  function choose(template: TemplateRecord) {
    if (dirty) { setError('현재 템플릿을 저장하거나 변경을 취소한 뒤 이동하세요.'); return }
    setDraft(fromTemplate(template)); setDeleteReady(false); setError('')
  }
  function change(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch })); setDirty(true); setDeleteReady(false); setError('') }
  function createNew() {
    if (dirty) { setError('현재 템플릿을 저장하거나 변경을 취소한 뒤 새로 만드세요.'); return }
    setDraft({ name: '새 Paper 템플릿', nodeType: 'paper', content: '# {{title}}\n\n' }); setDeleteReady(false); setError('')
  }
  async function save() {
    if (!draft.name.trim()) { setError('템플릿 이름을 입력하세요.'); return }
    try {
      const result = await window.prism.saveTemplate({ id: draft.id, name: draft.name, nodeType: draft.nodeType, content: draft.content, expectedRevision: draft.revision })
      if (!result.saved) { setError('템플릿 파일이 외부에서 변경되었습니다. 목록을 다시 열어 최신 버전을 확인하세요.'); return }
      setTemplates(result.templates)
      const current = result.templates.find((template) => template.id === result.id)
      if (current) setDraft(fromTemplate(current))
      setDirty(false); setError('')
    } catch (reason) { setError(String(reason)) }
  }
  async function duplicate() {
    try {
      const result = await window.prism.saveTemplate({ name: `${draft.name} 복사본`, nodeType: draft.nodeType, content: draft.content })
      if (!result.saved) return
      setTemplates(result.templates)
      const copy = result.templates.find((template) => template.id === result.id)
      if (copy) setDraft(fromTemplate(copy))
      setDirty(false); setDeleteReady(false); setError('')
    } catch (reason) { setError(String(reason)) }
  }
  async function remove() {
    if (!draft.id) return
    if (!deleteReady) { setDeleteReady(true); setError('삭제를 한 번 더 누르면 템플릿을 휴지통으로 이동합니다.'); return }
    try {
      const items = await window.prism.deleteTemplate(draft.id); setTemplates(items)
      setDraft(items[0] ? fromTemplate(items[0]) : { name: '새 Paper 템플릿', nodeType: 'paper', content: '# {{title}}\n\n' })
      setDirty(false); setDeleteReady(false); setError('')
    } catch (reason) { setError(String(reason)) }
  }
  async function makeDefault() {
    if (!draft.id || dirty) { setError('템플릿을 먼저 저장하세요.'); return }
    try { setTemplates(await window.prism.setDefaultTemplate(draft.nodeType, draft.id)); setError('') } catch (reason) { setError(String(reason)) }
  }
  function discardChanges() {
    if (selected) setDraft(fromTemplate(selected))
    else setDraft({ name: '새 Paper 템플릿', nodeType: 'paper', content: '# {{title}}\n\n' })
    setDirty(false); setDeleteReady(false); setError('')
  }

  return <div className="template-manager-backdrop">
    <section className="template-manager" role="dialog" aria-modal="true" aria-labelledby="template-manager-title">
      <header><div><h2 id="template-manager-title">개인 템플릿</h2><p>Markdown 파일로 보관되어 Obsidian에서도 그대로 편집할 수 있습니다.</p></div><button aria-label="템플릿 닫기" onClick={() => dirty ? setError('변경 내용을 저장하거나 취소한 뒤 닫으세요.') : onClose()}><X size={16} /></button></header>
      <div className="template-manager-body">
        <aside><button className="template-new" onClick={createNew}><FilePlus2 size={13} /> 새 템플릿</button><div>{templates.map((template) => <button key={template.id} className={template.id === draft.id ? 'active' : ''} onClick={() => choose(template)}><span><small>{typeLabels[template.nodeType]}</small><strong>{template.name}</strong></span>{template.isDefault && <Star size={12} fill="currentColor" aria-label="기본 템플릿" />}</button>)}</div></aside>
        <main>
          {loading ? <div className="template-loading">템플릿을 불러오는 중…</div> : <>
            <div className="template-fields"><label><span>이름</span><input aria-label="템플릿 이름" value={draft.name} onChange={(event) => change({ name: event.target.value })} /></label><label><span>노트 유형</span><select aria-label="템플릿 노트 유형" value={draft.nodeType} onChange={(event) => change({ nodeType: event.target.value as KnowledgeNodeType })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
            <div className="template-editor"><MarkdownEditor key={draft.id ?? 'new'} value={draft.content} onChange={(content) => change({ content })} onBlur={() => undefined} liveEdit label="템플릿 본문" /></div>
          </>}
        </main>
      </div>
      <footer><span>{error || (dirty ? '저장되지 않은 변경 사항이 있습니다.' : selected?.isDefault ? `${typeLabels[selected.nodeType]} 기본 템플릿` : '')}</span><div>{draft.id && <button className={deleteReady ? 'danger' : ''} onClick={() => void remove()}><Trash2 size={13} /> {deleteReady ? '삭제 확인' : '삭제'}</button>}<button disabled={dirty || !draft.id || selected?.isDefault} onClick={() => void makeDefault()}><Star size={13} /> 기본값</button><button onClick={() => void duplicate()}><Copy size={13} /> 복제</button>{dirty && <button onClick={discardChanges}>변경 취소</button>}<button className="primary" disabled={!dirty && Boolean(draft.id)} onClick={() => void save()}><Save size={13} /> 저장</button></div></footer>
    </section>
  </div>
}
