import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './notes.css'
import { AlertTriangle, CheckSquare, Code2, Columns2, ExternalLink, Eye, FileImage, FileText, FolderOpen, Heading2, Inbox, LayoutTemplate, Lightbulb, Link2, List, ListOrdered, MessageSquareQuote, Minus, PanelRight, PenLine, Quote, RefreshCw, Save, Search, Sigma, StickyNote, Table2, X } from 'lucide-react'
import MarkdownEditor, { type MarkdownBlockCommand, type MarkdownEditorHandle, type WikiLinkOption } from './MarkdownEditor'
import TemplateManager from './TemplateManager'
import KnowledgeManager from './KnowledgeManager'

type EditorMode = 'live' | 'read' | 'split'

const knowledgeTypeLabels: Record<KnowledgeNodeType, string> = { paper: 'Paper', concept: 'Concept', claim: 'Claim', insight: 'Insight', question: 'Question', project: 'Project' }
const relationLabels: Partial<Record<KnowledgeRelationType, string>> = { defines: '정의함', uses: '사용함', supports: '지지함', contradicts: '반박함', extends: '확장함', raises: '질문 제기', answers: '답함', mentions: '언급함', discusses: '다룸', presents: '제시함', related: '관련' }

function vaultTarget(libraryPath: string | undefined, filePath: string) {
  if (!libraryPath) return undefined
  const root = libraryPath.replaceAll('\\', '/').replace(/\/$/, '')
  const file = filePath.replaceAll('\\', '/')
  if (!file.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) return undefined
  return file.slice(root.length + 1).replace(/\.md$/i, '')
}

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
  const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNodeRecord[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState<NoteSnapshot>()
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [requestedKnowledgeId, setRequestedKnowledgeId] = useState<string>()
  const [requestedView, setRequestedView] = useState<'curation'>()
  const [curationCount, setCurationCount] = useState<number>()
  const [contextOpen, setContextOpen] = useState(() => window.localStorage.getItem('prism.notes.contextOpen') !== 'off')
  const [backlinks, setBacklinks] = useState<KnowledgeBacklink[]>([])
  const [relations, setRelations] = useState<KnowledgeRelationView[]>([])
  const [citations, setCitations] = useState<CitationLinks>()
  const [citationsLoading, setCitationsLoading] = useState(false)
  const [mode, setMode] = useState<EditorMode>(() => {
    const stored = window.localStorage.getItem('prism.notes.editorMode')
    return stored === 'read' || stored === 'split' ? stored : 'live'
  })
  const activeIdRef = useRef<string | undefined>(undefined); const noteRef = useRef(''); const dirtyRef = useRef(false); const revisionRef = useRef<string | undefined>(undefined)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const active = library.find((paper) => paper.arxivId === activeId)
  const paperNode = knowledgeNodes.find((node) => node.nodeType === 'paper' && node.arxivId === activeId)
  const approvedRelations = relations.filter((item) => item.reviewStatus === 'approved' && item.type !== 'mentions')
  const wikiLinks = useMemo(() => {
    const links = new Map<string, WikiLinkOption>()
    for (const node of knowledgeNodes) {
      const target = node.relativePath.replace(/\.md$/i, '')
      links.set(target.toLocaleLowerCase(), { id: node.id, label: node.title, target, description: knowledgeTypeLabels[node.nodeType], searchText: `${node.nodeType} ${node.preview}`, preview: node.preview, evidenceCount: node.evidenceCount })
    }
    for (const paper of library) {
      const target = vaultTarget(libraryPath, paper.notePath)
      if (!target || paper.arxivId === activeId) continue
      links.set(target.toLocaleLowerCase(), { id: `library-paper-${paper.arxivId}`, label: paper.title, target, description: `Paper · arXiv ${paper.arxivId}`, searchText: `${paper.arxivId} ${paper.authors.join(' ')}`, preview: paper.summary })
    }
    return [...links.values()]
  }, [knowledgeNodes, library, libraryPath, activeId])
  const filteredWikiLinks = useMemo(() => {
    const query = linkQuery.trim().toLocaleLowerCase()
    const score = (option: WikiLinkOption) => {
      if (!query) return 0
      const label = option.label.toLocaleLowerCase()
      if (label.startsWith(query)) return 0
      if (label.includes(query)) return 1
      if (`${option.target} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(query)) return 2
      return 3
    }
    return wikiLinks
      .filter((option) => !query || `${option.label} ${option.target} ${option.description} ${option.searchText ?? ''} ${option.preview ?? ''}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label))
      .slice(0, 80)
  }, [wikiLinks, linkQuery])

  async function refresh() {
    try {
      const [papers, settings] = await Promise.all([window.prism.listLibrary(), window.prism.getSettings()]); setLibrary(papers); setLibraryPath(settings.libraryPath)
      setKnowledgeNodes(settings.libraryPath ? await window.prism.listKnowledgeNodes() : [])
      if (settings.libraryPath) window.prism.listCurationQueue().then((queue) => setCurationCount(queue.total)).catch(() => setCurationCount(undefined))
      setActiveId((current) => current && papers.some((paper) => paper.arxivId === current) ? current : papers[0]?.arxivId)
    } catch (reason) { setError(String(reason)) }
  }

  useEffect(() => { window.document.title = 'Prism Notes'; void refresh() }, [])
  async function loadContext(nodeId: string, arxivId: string, refreshCitations?: boolean) {
    try {
      const [nextBacklinks, nextRelations] = await Promise.all([window.prism.listKnowledgeBacklinks(nodeId), window.prism.listKnowledgeRelations(nodeId)])
      if (activeIdRef.current !== arxivId) return
      setBacklinks(nextBacklinks); setRelations(nextRelations)
    } catch (reason) { setError(String(reason)) }
    if (refreshCitations !== undefined) setCitationsLoading(true)
    try {
      const next = await window.prism.listPaperCitations(arxivId, { refresh: refreshCitations ?? false })
      if (activeIdRef.current === arxivId) setCitations(next)
    } catch (reason) { if (refreshCitations) setError(String(reason)) }
    finally { setCitationsLoading(false) }
  }
  useEffect(() => { setBacklinks([]); setRelations([]); setCitations(undefined); if (paperNode && activeId) void loadContext(paperNode.id, activeId) }, [paperNode?.id, activeId])
  async function addCitationRelation(entry: CitationEntry, direction: 'references' | 'citations') {
    if (!paperNode || !entry.nodeId || !activeId) return
    if (!(await saveCurrentNote(false, true))) return
    const sourceId = direction === 'references' ? paperNode.id : entry.nodeId
    const targetId = direction === 'references' ? entry.nodeId : paperNode.id
    try {
      const snapshot = await window.prism.readKnowledgeNode(sourceId)
      const result = await window.prism.createKnowledgeRelation({ sourceId, targetId, type: 'extends', creator: 'user', expectedRevision: snapshot.revision })
      if (!result.saved) { setError('노트가 외부에서 변경되어 관계를 만들지 않았습니다.'); return }
      if (sourceId === paperNode.id) { revisionRef.current = result.snapshot.revision; noteRef.current = result.snapshot.content; dirtyRef.current = false; setNote(result.snapshot.content); setSaved(true) }
      setNotice(`'${entry.title}'와(과) 확장함 관계를 만들었습니다. 인용 목록은 자동 레이어이고, 이 관계는 직접 승인한 수동 레이어입니다.`)
      void loadContext(paperNode.id, activeId)
    } catch (reason) { setError(String(reason)) }
  }
  function toggleContext() { setContextOpen((value) => { window.localStorage.setItem('prism.notes.contextOpen', value ? 'off' : 'on'); return !value }) }
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { noteRef.current = note }, [note])
  useEffect(() => {
    const flush = () => { void saveCurrentNote(false, true) }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])
  useEffect(() => window.prism.onOpenKnowledgeNode((id) => { setRequestedKnowledgeId(id); setKnowledgeOpen(true) }), [])
  useEffect(() => {
    if (!activeId) { setNote(''); setLoaded(false); return }
    let disposed = false; setLoaded(false); setError(''); setNotice(''); setConflict(undefined)
    window.prism.readPaperNote(activeId).then((snapshot) => { if (!disposed) { noteRef.current = snapshot.content; revisionRef.current = snapshot.revision; dirtyRef.current = false; setNote(snapshot.content); setLoaded(true); setSaved(true) } }).catch((reason) => setError(String(reason)))
    return () => { disposed = true }
  }, [activeId])

  async function saveCurrentNote(force = false, createStubs = false) {
    const paperId = activeIdRef.current
    if (!paperId || !dirtyRef.current) return true
    if (conflict && !force) return false
    const content = noteRef.current
    try {
      const result = await window.prism.savePaperNote(paperId, { content, expectedRevision: revisionRef.current, force, createStubs })
      if (!result.saved) { setConflict(result.conflict); setNotice(''); setSaved(false); return false }
      revisionRef.current = result.snapshot.revision
      setConflict(undefined)
      if (activeIdRef.current === paperId && noteRef.current === content) { dirtyRef.current = false; setSaved(true); if (force) setNotice('내 편집본으로 안전하게 저장했습니다.') }
      if (result.stubs?.length) { setKnowledgeNodes(await window.prism.listKnowledgeNodes()); setNotice(`[[링크]]에서 새 Concept ${result.stubs.length}개를 Inbox에 만들었습니다: ${result.stubs.join(', ')}`) }
      if (createStubs && paperNode) void loadContext(paperNode.id, paperId)
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
    if (await saveCurrentNote(false, true)) setActiveId(paperId)
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
    editorRef.current?.applyBlock(command)
    selectMode('live')
  }

  function insertWikiLink(option: WikiLinkOption) {
    editorRef.current?.insertWikiLink(option)
    setLinkOpen(false); setLinkQuery(''); selectMode('live')
  }

  const contextVisible = contextOpen && Boolean(active) && !knowledgeOpen && !templatesOpen
  return <main className={`notes-window${contextVisible ? ' has-context' : ''}`}>
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
            <button aria-label="노트 링크 찾기" onClick={() => setLinkOpen((value) => !value)}><Link2 size={13} /> 링크</button>
            <button aria-label="연구 지식 관리" onClick={() => setKnowledgeOpen(true)}><Lightbulb size={13} /> 지식</button>
            <button aria-label="정리 대기열" className={curationCount ? 'has-count' : ''} onClick={() => { setRequestedView('curation'); setKnowledgeOpen(true) }}><Inbox size={13} /> 정리{curationCount ? <em>{curationCount}</em> : null}</button>
            <button aria-label="개인 템플릿 관리" onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={13} /> 템플릿</button>
            <button className={mode === 'live' ? 'active' : ''} aria-pressed={mode === 'live'} onClick={() => selectMode('live')}><PenLine size={13} /> Live Edit</button>
            <button className={mode === 'read' ? 'active' : ''} aria-pressed={mode === 'read'} onClick={() => selectMode('read')}><Eye size={13} /> 읽기</button>
            <button className={mode === 'split' ? 'active' : ''} aria-pressed={mode === 'split'} onClick={() => selectMode('split')}><Columns2 size={13} /> 분할</button>
            <button className={contextOpen ? 'is-on' : ''} aria-label="연결 패널" aria-pressed={contextOpen} title="백링크·관계·인용 패널" onClick={toggleContext}><PanelRight size={13} /> 연결{backlinks.length + approvedRelations.length ? <em>{backlinks.length + approvedRelations.length}</em> : null}</button>
          </div>
        </div>
        {linkOpen && <section className="notes-link-picker" aria-label="노트 링크 찾기"><header><div><Search size={13} /><input autoFocus aria-label="노트 링크 검색" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="논문명, arXiv ID, Concept, Claim 검색" /></div><button aria-label="노트 링크 찾기 닫기" onClick={() => setLinkOpen(false)}><X size={13} /></button></header><div>{filteredWikiLinks.length ? filteredWikiLinks.map((option) => <button key={option.id} onClick={() => insertWikiLink(option)}><span><small>{option.description}</small><strong>{option.label}</strong><i>{option.target}</i></span><Link2 size={13} /></button>) : <p>일치하는 논문이나 지식 노트가 없습니다.</p>}</div><footer><span><kbd>[[</kbd> 입력 후 검색</span><span><kbd>↑↓</kbd> 선택</span><span><kbd>Tab</kbd> 삽입</span></footer></section>}
        <div className={`notes-document mode-${mode}`}>
          <MarkdownEditor ref={editorRef} key={active.arxivId} value={note} onChange={updateNote} onBlur={() => void saveCurrentNote(false, true)} disabled={!loaded} liveEdit={mode === 'live'} label={`${active.title} Markdown 노트`} wikiLinks={wikiLinks} slashActions={['link']} onSlashAction={() => setLinkOpen(true)} />
          {mode !== 'live' && <MarkdownPreview content={note} />}
        </div>
      </> : <div className="notes-empty"><StickyNote size={36} /><h1>논문 노트를 선택하세요</h1><p>라이브러리에 저장된 Markdown 파일을 별도 창에서 편집합니다.</p></div>}
      {error && <div className="notes-error">{error}</div>}
      {templatesOpen && <TemplateManager onClose={() => setTemplatesOpen(false)} />}
      {knowledgeOpen && <KnowledgeManager initialNodeId={requestedKnowledgeId} initialView={requestedView} onClose={() => { setKnowledgeOpen(false); setRequestedKnowledgeId(undefined); setRequestedView(undefined); void refresh() }} />}
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
    {contextVisible && active && <aside className="notes-context" aria-label="연결된 지식">
      <header><PanelRight size={14} /><strong>연결</strong><button aria-label="연결 패널 닫기" onClick={toggleContext}><X size={13} /></button></header>
      <div className="notes-context-body">
        <section aria-label="백링크"><header><span>백링크</span><small>{backlinks.length}</small></header>{backlinks.length ? backlinks.map((item) => <button key={item.nodeId} onClick={() => { setRequestedKnowledgeId(item.nodeId); setKnowledgeOpen(true) }}><small>{knowledgeTypeLabels[item.nodeType]}</small><strong>{item.title}</strong><p>{item.excerpt}</p></button>) : <p>이 논문을 링크한 노트가 아직 없습니다.</p>}</section>
        <section aria-label="관계"><header><span>관계</span><small>{approvedRelations.length}</small></header>{approvedRelations.length ? approvedRelations.map((item) => <button key={item.id} onClick={() => { setRequestedKnowledgeId(item.other.id); setKnowledgeOpen(true) }}><small>{item.direction === 'outgoing' ? `→ ${relationLabels[item.type] ?? item.type}` : `← ${relationLabels[item.type] ?? item.type}`} · {knowledgeTypeLabels[item.other.nodeType]}</small><strong>{item.other.title}</strong></button>) : <p>승인된 관계가 없습니다. 정리 대기열에서 AI 제안을 승인하거나 지식 창에서 관계를 만드세요.</p>}{relations.some((item) => item.reviewStatus === 'pending') && <button className="notes-context-link" onClick={() => { setRequestedView('curation'); setKnowledgeOpen(true) }}><Inbox size={12} /> 검토 대기 관계 {relations.filter((item) => item.reviewStatus === 'pending').length}개</button>}</section>
        <section aria-label="인용 레이어" className="notes-citations"><header><span>인용 (자동)</span><small>{citations ? `${citations.references.length} / ${citations.citations.length}` : ''}</small><button aria-label="Semantic Scholar에서 인용 새로고침" disabled={citationsLoading || !paperNode} title="Semantic Scholar에서 참고문헌과 피인용 논문을 불러옵니다" onClick={() => paperNode && activeId && void loadContext(paperNode.id, activeId, true)}><RefreshCw size={12} /></button></header>
          {citationsLoading ? <p>Semantic Scholar에서 불러오는 중…</p> : !citations || !citations.fetchedAt ? <p>{citations?.error ? citations.error : '아직 불러오지 않았습니다. 새로고침을 누르면 참고문헌과 피인용 논문을 가져옵니다.'}</p> : <>
            <small className="notes-citations-meta">{new Date(citations.fetchedAt).toLocaleDateString()} 기준{citations.stale ? ' · 오래됨' : ''}{citations.error ? ` · ${citations.error}` : ''}</small>
            <details open><summary>참고문헌 {citations.references.length}편 · 라이브러리 {citations.references.filter((item) => item.inLibrary).length}편</summary>{citations.references.slice(0, 40).map((item, index) => <div key={`${item.arxivId ?? item.title}-${index}`} className={`notes-citation${item.inLibrary ? ' in-library' : ''}`}><span><strong>{item.title}</strong><small>{[item.year, item.authors.slice(0, 2).join(', '), item.citationCount !== undefined ? `인용 ${item.citationCount}` : ''].filter(Boolean).join(' · ')}</small></span>{item.inLibrary && item.nodeId ? approvedRelations.some((relation) => relation.other.id === item.nodeId && relation.type === 'extends') ? <em>확장함</em> : <button title="이 논문이 참고문헌을 확장한다는 수동 관계를 만듭니다" onClick={() => void addCitationRelation(item, 'references')}>확장함 관계</button> : item.arxivId ? <a href={`https://arxiv.org/abs/${item.arxivId}`} title="arXiv에서 열기" onClick={(event) => { event.preventDefault(); void window.prism.openArxiv(item.arxivId!) }}><ExternalLink size={11} /></a> : null}</div>)}</details>
            <details><summary>이 논문을 인용 {citations.citations.length}편 · 라이브러리 {citations.citations.filter((item) => item.inLibrary).length}편</summary>{citations.citations.slice(0, 40).map((item, index) => <div key={`${item.arxivId ?? item.title}-${index}`} className={`notes-citation${item.inLibrary ? ' in-library' : ''}`}><span><strong>{item.title}</strong><small>{[item.year, item.authors.slice(0, 2).join(', '), item.citationCount !== undefined ? `인용 ${item.citationCount}` : ''].filter(Boolean).join(' · ')}</small></span>{item.inLibrary && item.nodeId ? approvedRelations.some((relation) => relation.other.id === item.nodeId && relation.type === 'extends') ? <em>확장함</em> : <button title="인용한 논문이 이 논문을 확장한다는 수동 관계를 만듭니다" onClick={() => void addCitationRelation(item, 'citations')}>확장함 관계</button> : item.arxivId ? <a href={`https://arxiv.org/abs/${item.arxivId}`} title="arXiv에서 열기" onClick={(event) => { event.preventDefault(); void window.prism.openArxiv(item.arxivId!) }}><ExternalLink size={11} /></a> : null}</div>)}</details>
          </>}
        </section>
      </div>
    </aside>}
  </main>
}
