import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Columns2, Eye, FileText, FolderOpen, PenLine, Save, StickyNote } from 'lucide-react'
import MarkdownEditor from './MarkdownEditor'

type EditorMode = 'live' | 'read' | 'split'

function markdownBody(markdown: string) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  const body = match ? markdown.slice(match[0].length) : markdown
  return body.replace(/<!--[\s\S]*?-->/g, '')
}

function MarkdownPreview({ content }: { content: string }) {
  return <article className="notes-preview"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{markdownBody(content)}</ReactMarkdown></article>
}

export default function NotesWindow() {
  const [library, setLibrary] = useState<PaperRecord[]>([])
  const [libraryPath, setLibraryPath] = useState<string>()
  const [activeId, setActiveId] = useState<string>()
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<EditorMode>(() => {
    const stored = window.localStorage.getItem('prism.notes.editorMode')
    return stored === 'read' || stored === 'split' ? stored : 'live'
  })
  const activeIdRef = useRef<string | undefined>(undefined); const noteRef = useRef(''); const dirtyRef = useRef(false)
  const active = library.find((paper) => paper.arxivId === activeId)

  async function refresh() {
    try {
      const [papers, settings] = await Promise.all([window.prism.listLibrary(), window.prism.getSettings()]); setLibrary(papers); setLibraryPath(settings.libraryPath)
      setActiveId((current) => current && papers.some((paper) => paper.arxivId === current) ? current : papers[0]?.arxivId)
    } catch (reason) { setError(String(reason)) }
  }

  useEffect(() => { window.document.title = 'Prism Notes'; void refresh() }, [])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { noteRef.current = note }, [note])
  useEffect(() => {
    const flush = () => { void saveCurrentNote() }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])
  useEffect(() => {
    if (!activeId) { setNote(''); setLoaded(false); return }
    let disposed = false; setLoaded(false); setError('')
    window.prism.readPaperNote(activeId).then((content) => { if (!disposed) { noteRef.current = content; dirtyRef.current = false; setNote(content); setLoaded(true); setSaved(true) } }).catch((reason) => setError(String(reason)))
    return () => { disposed = true }
  }, [activeId])

  async function saveCurrentNote() {
    const paperId = activeIdRef.current
    if (!paperId || !dirtyRef.current) return true
    const content = noteRef.current
    try {
      await window.prism.savePaperNote(paperId, content)
      if (activeIdRef.current === paperId && noteRef.current === content) { dirtyRef.current = false; setSaved(true) }
      return true
    } catch (reason) { setError(String(reason)); return false }
  }

  useEffect(() => {
    if (!activeId || !loaded || saved) return
    const timeout = window.setTimeout(() => void saveCurrentNote(), 300)
    return () => window.clearTimeout(timeout)
  }, [activeId, note, loaded, saved])

  async function selectPaper(paperId: string) {
    if (paperId === activeIdRef.current) return
    if (await saveCurrentNote()) setActiveId(paperId)
  }

  function updateNote(value: string) {
    noteRef.current = value
    dirtyRef.current = true
    setNote(value)
    setSaved(false)
  }

  function selectMode(nextMode: EditorMode) {
    window.localStorage.setItem('prism.notes.editorMode', nextMode)
    setMode(nextMode)
  }

  return <main className="notes-window">
    <aside className="notes-library">
      <header><img className="brand-mark" src="./icon.png" alt="" /><div><strong>Prism Notes</strong><small>Markdown research notebook</small></div></header>
      <button className={`notes-folder ${libraryPath ? 'configured' : ''}`} title={libraryPath ?? '라이브러리 폴더를 선택하세요'} onClick={async () => { if (!(await saveCurrentNote())) return; const result = await window.prism.chooseWorkspace(); if (result) await refresh() }}><FolderOpen size={15} />{libraryPath ? <span><small>CURRENT REPOSITORY</small><strong>{libraryPath.split(/[\\/]/).filter(Boolean).at(-1)}</strong></span> : '라이브러리 폴더 선택'}</button>
      <p>논문 노트</p>
      <div>{library.map((paper) => <button key={paper.arxivId} className={paper.arxivId === activeId ? 'active' : ''} onClick={() => void selectPaper(paper.arxivId)}><FileText size={14} /><span><strong>{paper.title}</strong><small>{paper.arxivId}</small></span></button>)}</div>
    </aside>
    <section className="notes-editor">
      {active ? <><header><div><StickyNote size={17} /><span><strong>{active.title}</strong><small title={active.notePath}>로컬 Markdown · {active.notePath.split(/[\\/]/).pop()}</small></span></div><div className={`notes-save-status ${saved ? 'saved' : ''}`} role="status"><Save size={13} /> {saved ? '저장됨' : '저장 중…'}</div></header>
        <div className="notes-modebar" aria-label="노트 보기 모드">
          <button className={mode === 'live' ? 'active' : ''} aria-pressed={mode === 'live'} onClick={() => selectMode('live')}><PenLine size={13} /> Live Edit</button>
          <button className={mode === 'read' ? 'active' : ''} aria-pressed={mode === 'read'} onClick={() => selectMode('read')}><Eye size={13} /> 읽기</button>
          <button className={mode === 'split' ? 'active' : ''} aria-pressed={mode === 'split'} onClick={() => selectMode('split')}><Columns2 size={13} /> 분할</button>
        </div>
        <div className={`notes-document mode-${mode}`}>
          <MarkdownEditor key={active.arxivId} value={note} onChange={updateNote} onBlur={() => void saveCurrentNote()} disabled={!loaded} label={`${active.title} Markdown 노트`} />
          {mode !== 'live' && <MarkdownPreview content={note} />}
        </div>
      </> : <div className="notes-empty"><StickyNote size={36} /><h1>논문 노트를 선택하세요</h1><p>라이브러리에 저장된 Markdown 파일을 별도 창에서 편집합니다.</p></div>}
      {error && <div className="notes-error">{error}</div>}
    </section>
  </main>
}
