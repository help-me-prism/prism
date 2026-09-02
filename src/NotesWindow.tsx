import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './notes.css'
import { AlertTriangle, CheckSquare, Code2, Columns2, Eye, FileImage, FileText, FolderOpen, Heading2, List, ListOrdered, MessageSquareQuote, Minus, PenLine, Quote, RefreshCw, Save, Sigma, StickyNote, Table2 } from 'lucide-react'
import MarkdownEditor, { type MarkdownBlockCommand, type MarkdownEditorHandle } from './MarkdownEditor'

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
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState<NoteSnapshot>()
  const [mode, setMode] = useState<EditorMode>(() => {
    const stored = window.localStorage.getItem('prism.notes.editorMode')
    return stored === 'read' || stored === 'split' ? stored : 'live'
  })
  const activeIdRef = useRef<string | undefined>(undefined); const noteRef = useRef(''); const dirtyRef = useRef(false); const revisionRef = useRef<string | undefined>(undefined)
  const editorRef = useRef<MarkdownEditorHandle>(null)
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
    let disposed = false; setLoaded(false); setError(''); setNotice(''); setConflict(undefined)
    window.prism.readPaperNote(activeId).then((snapshot) => { if (!disposed) { noteRef.current = snapshot.content; revisionRef.current = snapshot.revision; dirtyRef.current = false; setNote(snapshot.content); setLoaded(true); setSaved(true) } }).catch((reason) => setError(String(reason)))
    return () => { disposed = true }
  }, [activeId])

  async function saveCurrentNote(force = false) {
    const paperId = activeIdRef.current
    if (!paperId || !dirtyRef.current) return true
    if (conflict && !force) return false
    const content = noteRef.current
    try {
      const result = await window.prism.savePaperNote(paperId, { content, expectedRevision: revisionRef.current, force })
      if (!result.saved) { setConflict(result.conflict); setNotice(''); setSaved(false); return false }
      revisionRef.current = result.snapshot.revision
      setConflict(undefined)
      if (activeIdRef.current === paperId && noteRef.current === content) { dirtyRef.current = false; setSaved(true); if (force) setNotice('내 편집본으로 안전하게 저장했습니다.') }
      return true
    } catch (reason) { setError(String(reason)); return false }
  }

  useEffect(() => {
    if (!activeId || !loaded || saved || conflict) return
    const timeout = window.setTimeout(() => void saveCurrentNote(), 300)
    return () => window.clearTimeout(timeout)
  }, [activeId, note, loaded, saved, conflict])

  useEffect(() => {
    if (!activeId || !loaded) return
    let disposed = false; let checking = false
    const checkDisk = async () => {
      if (checking || disposed) return
      checking = true
      try {
        const snapshot = await window.prism.readPaperNote(activeId)
        if (disposed || snapshot.revision === revisionRef.current) return
        if (dirtyRef.current) {
          setConflict(snapshot); setNotice('')
        } else {
          revisionRef.current = snapshot.revision; noteRef.current = snapshot.content; setNote(snapshot.content); setSaved(true); setNotice('외부 편집기의 변경 내용을 불러왔습니다.')
        }
      } catch (reason) { if (!disposed) setError(String(reason)) }
      finally { checking = false }
    }
    const timer = window.setInterval(() => void checkDisk(), 1200)
    const onFocus = () => void checkDisk()
    window.addEventListener('focus', onFocus)
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [activeId, loaded])

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

  function useDiskVersion() {
    if (!conflict) return
    revisionRef.current = conflict.revision; noteRef.current = conflict.content; dirtyRef.current = false
    setNote(conflict.content); setConflict(undefined); setSaved(true); setNotice('디스크의 최신 버전을 불러왔습니다.')
  }

  function selectMode(nextMode: EditorMode) {
    window.localStorage.setItem('prism.notes.editorMode', nextMode)
    setMode(nextMode)
  }

  function insertBlock(command: MarkdownBlockCommand) {
    selectMode('live')
    window.requestAnimationFrame(() => editorRef.current?.applyBlock(command))
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
        {notice && <div className="notes-notice" role="status"><RefreshCw size={13} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="알림 닫기">×</button></div>}
        <div className="notes-toolbar">
          <div className="notes-block-tools" aria-label="블록 삽입 도구" aria-disabled={!loaded}>
            <button disabled={!loaded} aria-label="제목 블록 삽입" title="제목" onClick={() => insertBlock('heading')}><Heading2 size={14} /></button>
            <button disabled={!loaded} aria-label="글머리표 목록 삽입" title="글머리표 목록" onClick={() => insertBlock('bullet')}><List size={14} /></button>
            <button disabled={!loaded} aria-label="번호 목록 삽입" title="번호 목록" onClick={() => insertBlock('ordered')}><ListOrdered size={14} /></button>
            <button disabled={!loaded} aria-label="체크박스 삽입" title="체크박스" onClick={() => insertBlock('task')}><CheckSquare size={14} /></button>
            <button disabled={!loaded} aria-label="인용 블록 삽입" title="인용" onClick={() => insertBlock('quote')}><Quote size={14} /></button>
            <button disabled={!loaded} aria-label="Callout 삽입" title="Callout" onClick={() => insertBlock('callout')}><MessageSquareQuote size={14} /></button>
            <button disabled={!loaded} aria-label="표 삽입" title="표" onClick={() => insertBlock('table')}><Table2 size={14} /></button>
            <button disabled={!loaded} aria-label="코드 블록 삽입" title="코드 블록" onClick={() => insertBlock('code')}><Code2 size={14} /></button>
            <button disabled={!loaded} aria-label="수식 블록 삽입" title="수식 블록" onClick={() => insertBlock('math')}><Sigma size={14} /></button>
            <button disabled={!loaded} aria-label="이미지 삽입" title="이미지" onClick={() => insertBlock('image')}><FileImage size={14} /></button>
            <button disabled={!loaded} aria-label="구분선 삽입" title="구분선" onClick={() => insertBlock('divider')}><Minus size={14} /></button>
          </div>
          <div className="notes-modebar" aria-label="노트 보기 모드">
            <button className={mode === 'live' ? 'active' : ''} aria-pressed={mode === 'live'} onClick={() => selectMode('live')}><PenLine size={13} /> Live Edit</button>
            <button className={mode === 'read' ? 'active' : ''} aria-pressed={mode === 'read'} onClick={() => selectMode('read')}><Eye size={13} /> 읽기</button>
            <button className={mode === 'split' ? 'active' : ''} aria-pressed={mode === 'split'} onClick={() => selectMode('split')}><Columns2 size={13} /> 분할</button>
          </div>
        </div>
        <div className={`notes-document mode-${mode}`}>
          <MarkdownEditor ref={editorRef} key={active.arxivId} value={note} onChange={updateNote} onBlur={() => void saveCurrentNote()} disabled={!loaded} liveEdit={mode === 'live'} label={`${active.title} Markdown 노트`} />
          {mode !== 'live' && <MarkdownPreview content={note} />}
        </div>
      </> : <div className="notes-empty"><StickyNote size={36} /><h1>논문 노트를 선택하세요</h1><p>라이브러리에 저장된 Markdown 파일을 별도 창에서 편집합니다.</p></div>}
      {error && <div className="notes-error">{error}</div>}
      {conflict && <div className="notes-conflict-backdrop" role="presentation">
        <section className="notes-conflict" role="dialog" aria-modal="true" aria-labelledby="notes-conflict-title">
          <header><AlertTriangle size={18} /><div><h2 id="notes-conflict-title">외부 변경과 충돌했습니다</h2><p>다른 편집기에서 이 파일을 변경했습니다. 두 버전을 비교한 뒤 보존할 내용을 선택하세요.</p></div></header>
          <div className="notes-conflict-compare">
            <article><h3>내 편집본</h3><pre>{note}</pre></article>
            <article><h3>디스크 최신 버전</h3><small>{new Date(conflict.modifiedAt).toLocaleString()}</small><pre>{conflict.content}</pre></article>
          </div>
          <footer><button onClick={useDiskVersion}>디스크 버전 사용</button><button className="primary" onClick={() => void saveCurrentNote(true)}>내 편집본으로 덮어쓰기</button></footer>
        </section>
      </div>}
    </section>
  </main>
}
