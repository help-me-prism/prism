import { useEffect, useState } from 'react'
import { FileText, FolderOpen, Save, StickyNote } from 'lucide-react'

export default function NotesWindow() {
  const [library, setLibrary] = useState<PaperRecord[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState('')
  const active = library.find((paper) => paper.arxivId === activeId)

  async function refresh() {
    try {
      const papers = await window.prism.listLibrary(); setLibrary(papers)
      setActiveId((current) => current && papers.some((paper) => paper.arxivId === current) ? current : papers[0]?.arxivId)
    } catch (reason) { setError(String(reason)) }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!activeId) { setNote(''); setLoaded(false); return }
    let disposed = false; setLoaded(false); setError('')
    window.prism.readPaperNote(activeId).then((content) => { if (!disposed) { setNote(content); setLoaded(true); setSaved(true) } }).catch((reason) => setError(String(reason)))
    return () => { disposed = true }
  }, [activeId])
  useEffect(() => {
    if (!activeId || !loaded || saved) return
    const timeout = window.setTimeout(() => window.prism.savePaperNote(activeId, note).then(() => setSaved(true)).catch((reason) => setError(String(reason))), 500)
    return () => window.clearTimeout(timeout)
  }, [activeId, note, loaded, saved])

  return <main className="notes-window">
    <aside className="notes-library">
      <header><span className="brand-mark">P</span><div><strong>Prism Notes</strong><small>Markdown research notebook</small></div></header>
      <button className="notes-folder" onClick={async () => { const result = await window.prism.chooseWorkspace(); if (result) await refresh() }}><FolderOpen size={15} /> 라이브러리 폴더 선택</button>
      <p>논문 노트</p>
      <div>{library.map((paper) => <button key={paper.arxivId} className={paper.arxivId === activeId ? 'active' : ''} onClick={() => setActiveId(paper.arxivId)}><FileText size={14} /><span><strong>{paper.title}</strong><small>{paper.arxivId}</small></span></button>)}</div>
    </aside>
    <section className="notes-editor">
      {active ? <><header><div><StickyNote size={17} /><span><strong>{active.title}</strong><small>{active.notePath}</small></span></div><span className={saved ? 'saved' : ''}><Save size={13} /> {saved ? '저장됨' : '저장 중…'}</span></header>
        <textarea value={note} onChange={(event) => { setNote(event.target.value); setSaved(false) }} disabled={!loaded} spellCheck={false} aria-label={`${active.title} Markdown 노트`} />
      </> : <div className="notes-empty"><StickyNote size={36} /><h1>논문 노트를 선택하세요</h1><p>라이브러리에 저장된 Markdown 파일을 별도 창에서 편집합니다.</p></div>}
      {error && <div className="notes-error">{error}</div>}
    </section>
  </main>
}
