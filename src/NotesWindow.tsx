import { useEffect, useMemo, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import './notes.css'
import { BookOpen, FilePlus2, FolderOpen, Inbox, LayoutTemplate, Network, NotebookPen, PanelRight, Plus, Search, Settings2, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import NoteDocument from './NoteDocument'
import NoteRecoveryNotice from './NoteRecoveryNotice'
import ThemeControl from './ThemeControl'
import { useDialogFocus } from './useDialogFocus'
import ConnectionsPanel from './ConnectionsPanel'
import CurationQueue from './CurationQueue'
import GraphView from './GraphView'
import TemplateManager from './TemplateManager'
import { autoSectionLabels, creatableTypes, isStub, treeTypes, typeLabels } from './knowledgeModel'
import { createContextRequestGate, noteContextSignature } from './contextRequestGate'
import { linkCreatedNote } from './linkCreatedNote'

type MainView = 'doc' | 'curation' | 'graph'
const emptyRelations: KnowledgeRelationView[] = []
const emptyBacklinks: KnowledgeBacklink[] = []
type ContextOwner = { libraryPath: string | undefined; activeId: string | undefined; nodes: KnowledgeNodeRecord[] }
type NoteContext = { owner: ContextOwner; relations: KnowledgeRelationView[]; backlinks: KnowledgeBacklink[]; citations?: CitationLinks; citationsLoading: boolean }

const noteGuides: Record<KnowledgeNodeType, { hint: string; example: string }> = {
  paper: { hint: '논문 한 편의 읽기 기록입니다. PDF는 리더에서 가져오세요.', example: '논문 제목' },
  concept: { hint: '여러 논문에서 다시 만날 용어를 내 말로 정리합니다.', example: '예: 단일 세포 RNA 시퀀싱' },
  claim: { hint: '근거를 붙여 검토할 문장을 적습니다.', example: '예: 온도가 높을수록 반응 속도가 증가한다' },
  question: { hint: '읽다가 생긴 질문을 모으고 답하는 노트에 연결합니다.', example: '예: 이 결과가 다른 조건에서도 성립할까?' },
  project: { hint: '내 연구 주제에 필요한 논문과 아이디어를 모읍니다.', example: '예: 학위 논문 실험 설계' },
  insight: { hint: '논문에서 얻은 나의 해석입니다.', example: '새롭게 알게 된 점' },
}

/**
 * The Notes window is a vault workspace: activity rail, node tree, tabbed documents, and a standing
 * connections panel. Knowledge nodes are no longer hidden behind a modal — everything the graph holds
 * is one click away in the tree.
 */
export default function NotesWindow() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchMounted = useRef(true)
  useEffect(() => {
    searchMounted.current = true
    return () => { searchMounted.current = false; searchRun.current++ }
  }, [])
  useDialogFocus(settingsOpen, '.note-settings-dialog', 'button[aria-label="노트 설정"]')
  const [libraryPath, setLibraryPath] = useState<string>()
  const [nodes, setNodes] = useState<KnowledgeNodeRecord[]>([])
  const [anchors, setAnchors] = useState<EvidenceAnchor[]>([])
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [pendingOpenId, setPendingOpenId] = useState<string>()
  const [view, setView] = useState<MainView>('doc')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ResearchSearchResult[]>()
  const [collapsed, setCollapsed] = useState<Set<KnowledgeNodeType>>(() => new Set())
  const creationOwner = useMemo(() => ({ libraryPath, activeId }), [libraryPath, activeId])
  const creationOwnerRef = useRef(creationOwner); creationOwnerRef.current = creationOwner
  const [creating, setCreating] = useState<{ nodeType: KnowledgeNodeType; title: string; templateId: string; linkPaper?: boolean; paper?: { id: string; title: string; owner: typeof creationOwner } }>()
  const [createBusy, setCreateBusy] = useState(false)
  const createLock = useRef(false)
  const searchRun = useRef(0)
  const searchInFlight = useRef(false)
  const searchComposing = useRef(false)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchInvalidated, setSearchInvalidated] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error'; undo?: { label: string; run: () => void | Promise<void> } }>()
  const [deleteReadyId, setDeleteReadyId] = useState<string>()
  const [curation, setCuration] = useState<CurationQueue>()
  // Which notes wrote something the researcher has not looked at yet.
  const [unread, setUnread] = useState<Record<string, { at: number; sections: string[] }>>({})
  const [context, setContext] = useState<NoteContext>()
  const contextGate = useRef(createContextRequestGate<ContextOwner>())
  const nodesRun = useRef(0)
  const contextSignature = useMemo(() => noteContextSignature(nodes), [nodes])
  // Retain the owner across equivalent reloads, while revisions of *other* notes
  // still invalidate backlinks and indirect connections after an external edit.
  const contextOwner = useMemo(() => ({ libraryPath, activeId, nodes }), [libraryPath, activeId, contextSignature])
  const contextOwnerRef = useRef(contextOwner)
  contextOwnerRef.current = contextOwner
  contextGate.current.setOwner(contextOwner)
  const ownedContext = context?.owner === contextOwner ? context : undefined
  const relations = ownedContext?.relations ?? emptyRelations
  const backlinks = ownedContext?.backlinks ?? emptyBacklinks
  const citations = ownedContext?.citations
  const citationsLoading = ownedContext?.citationsLoading ?? false
  const [sideOpen, setSideOpen] = useState(() => window.localStorage.getItem('prism.notes.sideOpen') !== 'off')
  // Everything a model writes in a note is off until a CLI is chosen, and the choice used to live in the
  // Reader's translation toolbar — another window, next to an unrelated setting. It belongs where the writing
  // it turns on happens.
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [settings, setSettings] = useState<AppSettings>()
  useEffect(() => window.prism.onSettingsChanged(next => {
    setSettings(next)
    if (next.libraryPath !== libraryPath) { contextGate.current.invalidate(); nodesRun.current++; setLibraryPath(next.libraryPath); setNodes([]); setContext(undefined); searchRun.current++; setSearchResults(undefined); setSearchInvalidated(searchInFlight.current); setQuery(''); setOpenIds([]); setActiveId(undefined); void reloadNodes(); void reloadCuration() }
  }), [libraryPath])
  const searchRef = useRef<HTMLInputElement>(null)
  const activeIdRef = useRef<string | undefined>(undefined)

  const active = nodes.find((node) => node.id === activeId)
  const openNodes = openIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is KnowledgeNodeRecord => Boolean(node))
  // The four primary folders always show, even when empty: the vault should tell you what kinds of notes exist.
  const grouped = useMemo(() => treeTypes
    .map((type) => ({ type, items: nodes.filter((node) => node.nodeType === type).sort((left, right) => left.title.localeCompare(right.title)) }))
    .filter((group) => group.items.length || creatableTypes.includes(group.type)), [nodes])
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase()
    if (!text) return undefined
    return nodes.filter((node) => `${node.title} ${node.relativePath} ${node.preview}`.toLocaleLowerCase().includes(text)).slice(0, 60)
  }, [nodes, query])
  const relationCount = useMemo(() => relations.filter((item) => item.reviewStatus === 'approved').length, [relations])
  const understoodCount = useMemo(() => nodes.filter((node) => node.status === 'understood' || node.status === 'established').length, [nodes])

  function notify(text: string, tone: 'info' | 'error' = 'info', undo?: { label: string; run: () => void | Promise<void> }) { setNotice({ text, tone, undo }) }
  useEffect(() => { if (!notice || notice.tone === 'error') return; const timer = window.setTimeout(() => setNotice(undefined), notice.undo ? 12000 : 6000); return () => window.clearTimeout(timer) }, [notice])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  async function reloadNodes() {
    const run = ++nodesRun.current
    try {
      const next = await window.prism.getSettings()
      if (run !== nodesRun.current) return
      if (next.libraryPath !== contextOwnerRef.current.libraryPath) {
        contextGate.current.invalidate(); setContext(undefined); setNodes([]); setOpenIds([]); setActiveId(undefined)
      }
      setLibraryPath(next.libraryPath); setSettings(next)
      if (!next.libraryPath) { setNodes([]); return }
      const [nextNodes, nextTemplates, nextAnchors] = await Promise.all([window.prism.listKnowledgeNodes(), window.prism.listTemplates(), window.prism.listEvidenceAnchors()])
      if (run !== nodesRun.current) return
      setNodes(nextNodes); setTemplates(nextTemplates); setAnchors(nextAnchors)
      setOpenIds((current) => current.filter((id) => nextNodes.some((node) => node.id === id)))
      setActiveId((current) => current && nextNodes.some((node) => node.id === current) ? current : undefined)
    } catch (reason) { if (run === nodesRun.current) notify(String(reason), 'error') }
  }
  async function reloadCuration() {
    try { setCuration(await window.prism.listCurationQueue()) } catch { setCuration(undefined) }
  }
  async function reloadUnread() {
    try { setUnread(await window.prism.listAutoUnread()) } catch { setUnread({}) }
  }
  async function reloadContext(refreshCitations?: boolean) {
    const owner = contextOwnerRef.current
    const isCurrent = contextGate.current.begin(owner)
    const id = owner.activeId
    const node = owner.nodes.find((item) => item.id === id)
    if (!owner.libraryPath || !id || !node) { setContext(undefined); return }
    const hasCitations = node.nodeType === 'paper' && Boolean(node.arxivId)
    setContext({ owner, relations: emptyRelations, backlinks: emptyBacklinks, citationsLoading: hasCitations })
    const update = (patch: Partial<NoteContext>) => setContext(previous => isCurrent() && previous?.owner === owner ? { ...previous, ...patch } : previous)
    try {
      const [nextRelations, nextBacklinks] = await Promise.all([window.prism.listKnowledgeRelations(id), window.prism.listKnowledgeBacklinks(id)])
      if (!isCurrent()) return
      update({ relations: nextRelations, backlinks: nextBacklinks })
    } catch (reason) { if (!isCurrent()) return; notify(String(reason), 'error') }
    if (!isCurrent() || !hasCitations || !node.arxivId) return
    try {
      const next = await window.prism.listPaperCitations(node.arxivId, { refresh: refreshCitations ?? false })
      if (isCurrent()) update({ citations: next })
    } catch (reason) { if (isCurrent() && refreshCitations) notify(String(reason), 'error') }
    finally { if (isCurrent()) update({ citationsLoading: false }) }
  }

  useEffect(() => { window.document.title = 'Prism Notes'; void reloadNodes().then(reloadCuration).then(reloadUnread) }, [])
  useEffect(() => { window.prism.listProviders().then(setProviders).catch(() => setProviders([])) }, [])

  async function chooseKnowledgeModel(patch: Partial<AppSettings>) {
    try { setSettings(await window.prism.updateSettings(patch)) }
    catch (reason) { notify(String(reason), 'error') }
  }

  useEffect(() => { void reloadContext(); return () => contextGate.current.invalidate() }, [contextOwner])
  useEffect(() => () => { nodesRun.current++; contextGate.current.invalidate() }, [])
  useEffect(() => window.prism.onOpenKnowledgeNode((id) => { setPendingOpenId(id) }), [])
  // Initial settings/tree reads can reset activeId. Consume external navigation
  // only once that requested record is in the loaded vault, never against an empty tree.
  useEffect(() => {
    if (libraryPath && pendingOpenId && nodes.some(node => node.id === pendingOpenId)) openNode(pendingOpenId)
  }, [libraryPath, nodes, pendingOpenId])
  /**
   * The library folder is shared with Obsidian and the Reader, so outside changes show up without a manual
   * refresh. One save arrives as a burst of events and a sweep as one per note; reloading the tree, the
   * templates and the anchors for each of them puts real work in front of whatever the researcher is
   * actually waiting for, so a burst is answered once. The queue is more expensive still and waits until the
   * window is looked at.
   */
  useEffect(() => {
    let pending: number | undefined
    const stop = window.prism.onVaultChanged(() => {
      if (pending) window.clearTimeout(pending)
      pending = window.setTimeout(() => { pending = undefined; void reloadNodes(); void reloadUnread() }, 300)
    })
    return () => { if (pending) window.clearTimeout(pending); stop() }
  }, [])
  useEffect(() => {
    const onFocus = () => { void reloadNodes(); void reloadCuration(); void reloadUnread() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  function openNode(id: string) {
    setPendingOpenId(undefined)
    setView('doc')
    setOpenIds((current) => current.includes(id) ? current : [...current, id].slice(-8))
    setActiveId(id)
  }
  function closeTab(id: string) {
    setOpenIds((current) => {
      const next = current.filter((item) => item !== id)
      if (id === activeIdRef.current) setActiveId(next.at(-1))
      return next
    })
  }
  async function chooseLibrary() {
    const result = await window.prism.chooseWorkspace()
    if (result) { await reloadNodes(); await reloadCuration() }
  }
  async function createNode() {
    if (createLock.current) return
    if (!creating?.title.trim()) { notify('새 노트의 제목을 입력하세요.'); return }
    createLock.current = true; setCreateBusy(true)
    const destinationVault = libraryPath
    const paper = creating.paper
    try {
      const result = await window.prism.createKnowledgeNode({ title: creating.title.trim(), nodeType: creating.nodeType, templateId: creating.templateId || undefined })
      setCreating(undefined); changeQuery('')
      let linkError: string | undefined
      if (creating.linkPaper && paper && ['concept', 'claim', 'question'].includes(creating.nodeType)) {
        try {
          const outcome = await linkCreatedNote(result.id, paper.id, () => creationOwnerRef.current === paper.owner,
            id => window.prism.readKnowledgeNode(id), request => window.prism.createKnowledgeRelation(request))
          if (outcome === 'stale') linkError = '열린 논문이나 볼트가 바뀌어 연결하지 않았습니다.'
        } catch (reason) { linkError = String(reason) }
      }
      if (creationOwnerRef.current.libraryPath === destinationVault) { await reloadNodes(); if (creationOwnerRef.current.libraryPath === destinationVault) openNode(result.id) }
      if (linkError) notify(`노트는 만들었습니다. ${linkError} 노트에서 관계를 다시 지정해 주세요.`, 'error')
    } catch (reason) { notify(String(reason), 'error') }
    finally { createLock.current = false; setCreateBusy(false) }
  }
  function beginCreate(nodeType: KnowledgeNodeType, title: string) {
    const paper = active?.nodeType === 'paper' && view === 'doc' && libraryPath ? { id: active.id, title: active.title, owner: creationOwner } : undefined
    setCreating({ nodeType, title, templateId: '', paper, linkPaper: Boolean(paper) })
  }
  /** Deleting from the tree is one click, so it has to be one click back: the trash entry is kept for undo. */
  async function deleteNode(target: KnowledgeNodeRecord) {
    if (deleteReadyId !== target.id) {
      setDeleteReadyId(target.id)
      notify(`'${target.title}'을(를) 삭제하려면 한 번 더 누르세요.`)
      window.setTimeout(() => setDeleteReadyId((current) => current === target.id ? undefined : current), 4000)
      return
    }
    setDeleteReadyId(undefined)
    try {
      const result = await window.prism.deleteKnowledgeNode(target.id)
      setNodes(result.nodes)
      setOpenIds((current) => current.filter((id) => id !== target.id))
      setActiveId((current) => current === target.id ? undefined : current)
      await reloadCuration()
      notify(`'${result.title}'을(를) 휴지통으로 보냈습니다.`, 'info', {
        label: '실행 취소',
        run: async () => {
          try {
            const restored = await window.prism.restoreKnowledgeNode(result.trashed)
            setNodes(restored.nodes); setNotice(undefined); openNode(restored.id); await reloadCuration()
          } catch (reason) { notify(String(reason), 'error') }
        },
      })
    } catch (reason) { notify(String(reason), 'error') }
  }
  async function runSearch() {
    if (searchInFlight.current || searchComposing.current) return
    const text = query.trim()
    const run = ++searchRun.current
    if (!text) { setSearchResults(undefined); setSearchBusy(false); return }
    searchInFlight.current = true
    setSearchInvalidated(false)
    setSearchBusy(true)
    setSearchResults(undefined)
    try {
      const results = await window.prism.searchResearchKnowledge(text)
      if (run === searchRun.current) setSearchResults(results)
    } catch (reason) { if (run === searchRun.current) notify(String(reason), 'error') }
    finally {
      searchInFlight.current = false
      if (searchMounted.current) {
        setSearchBusy(false)
      }
    }
  }
  function changeQuery(text: string) {
    searchRun.current++; setQuery(text); setSearchResults(undefined); setSearchInvalidated(searchInFlight.current)
  }
  function toggleSide() { setSideOpen((value) => { window.localStorage.setItem('prism.notes.sideOpen', value ? 'off' : 'on'); return !value }) }
  function toggleGroup(type: KnowledgeNodeType) {
    setCollapsed((current) => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next })
  }

  const treeRow = (node: KnowledgeNodeRecord, excerpt?: string, searchResult = false) => <div key={node.id} className={`tree-row${searchResult ? ' tree-search-result' : ''}${node.id === activeId && view === 'doc' ? ' active' : ''}`}>
    <button
      className={`tree-file${isStub(node) ? ' is-stub' : ''}`}
      title={unread[node.id] ? `자동으로 새로 쓰인 내용이 있습니다: ${unread[node.id].sections.map((section) => autoSectionLabels[section] ?? section).join(' · ')}` : node.relativePath}
      onClick={() => openNode(node.id)}
    >
      <span className="tree-note-title">{node.title}</span>
      {unread[node.id] && <i className="tree-unread" aria-label="읽지 않은 자동 기록" />}
      {excerpt && <small className="tree-note-excerpt">{excerpt}</small>}
    </button>
    <button
      className={`tree-delete${deleteReadyId === node.id ? ' is-ready' : ''}`}
      aria-label={`${node.title} 삭제`} title={deleteReadyId === node.id ? '한 번 더 누르면 휴지통으로' : '휴지통으로 보내기'}
      onClick={(event) => { event.stopPropagation(); void deleteNode(node) }}
    ><Trash2 size={11} /></button>
  </div>

  return <main className={`notes-window${sideOpen && view === 'doc' ? ' has-side' : ''}`}>
    {/* Six unlabelled glyphs are six guesses. The words are short enough to fit next to them. */}
    <nav className="notes-rail" aria-label="작업 영역">
      <button aria-label="논문 리더" title="논문 리더 창으로" onClick={() => void window.prism.openPaperInReader()}><BookOpen size={17} /><b>리더</b></button>
      <button aria-label="노트" title="노트" aria-pressed={view === 'doc'} onClick={() => setView('doc')}><NotebookPen size={17} /><b>노트</b></button>
      <button aria-label="정리 대기열" title="정리 대기열" aria-pressed={view === 'curation'} onClick={() => { setView('curation'); void reloadCuration() }}>
        <Inbox size={17} />{curation?.total ? <em>{curation.total}</em> : null}<b>정리</b>
      </button>
      <button aria-label="지식 그래프" title="볼트 전체 지식 그래프 — 노트 사이의 관계. 논문 한 편의 구조는 리더의 구조 맵에 있습니다." aria-pressed={view === 'graph'} onClick={() => setView('graph')}><Network size={17} /><b>지식 그래프</b></button>
      <button aria-label="검색" title="볼트 검색" onClick={() => searchRef.current?.focus()}><Search size={17} /><b>검색</b></button>
      <span className="rail-spacer" />
      <button aria-label="연결 패널" title="연결 패널 접기/펼치기" aria-pressed={sideOpen} onClick={toggleSide}><PanelRight size={17} /><b>연결</b></button>
      <button aria-label="노트 양식" title="노트 양식" onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={17} /><b>양식</b></button>
      <button aria-label="노트 설정" title="노트 설정" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><b>설정</b></button>
    </nav>

    <aside className="notes-tree" aria-label="볼트">
      <button className="tree-vault" title={libraryPath ?? '라이브러리 폴더를 선택하세요'} onClick={() => void chooseLibrary()}>
        <FolderOpen size={13} /><b>{libraryPath ? libraryPath.split(/[\\/]/).filter(Boolean).at(-1) : '라이브러리 선택'}</b>
      </button>
      <div className="tree-search">
        <button type="button" aria-label="노트 검색 실행" title="본문까지 검색" disabled={searchBusy || !query.trim()} onClick={() => void runSearch()}><Search size={12} /></button>
        <input
          ref={searchRef} aria-label="노트 검색" value={query} placeholder="노트 검색 · Enter로 본문까지"
          onChange={(event) => { changeQuery(event.target.value) }}
          onCompositionStart={() => { searchComposing.current = true }}
          onCompositionEnd={() => { searchComposing.current = false }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || searchComposing.current) return
            if (event.key === 'Enter') { event.preventDefault(); void runSearch() }
            if (event.key === 'Escape') changeQuery('')
          }}
        />
        {query && <button aria-label="검색 지우기" onClick={() => { changeQuery('') }}><X size={11} /></button>}
      </div>
      {query && !searchBusy && !searchResults && <p className="tree-search-status">Enter를 누르면 본문까지 검색합니다.</p>}
      {searchBusy && <p className="tree-search-status" role="status">{searchInvalidated ? '이전 검색을 마무리하는 중… 완료 후 다시 검색해 주세요.' : '노트에서 찾는 중…'}</p>}
      <button className="tree-new" disabled={!libraryPath || createBusy} onClick={() => beginCreate('concept', query.trim())}><FilePlus2 size={12} /> 새 노트</button>

      {creating && <div className="tree-create">
        <div className="create-types">{creatableTypes.map((type) => <button key={type} className={creating.nodeType === type ? 'active' : ''} aria-pressed={creating.nodeType === type} onClick={() => setCreating({ ...creating, nodeType: type, templateId: '' })}>{typeLabels[type]}</button>)}</div>
        <p className="create-guide" id="create-note-guide">{noteGuides[creating.nodeType].hint}</p>
        {creating.paper && ['concept', 'claim', 'question'].includes(creating.nodeType) && <label className="create-paper-link"><input type="checkbox" checked={Boolean(creating.linkPaper)} disabled={createBusy || creationOwner !== creating.paper.owner} onChange={event => setCreating({ ...creating, linkPaper: event.target.checked })} /><span>이 논문과 연결 · {creating.paper.title}<small>{creationOwner === creating.paper.owner ? '새 노트에서 논문으로 ‘관련’ 관계를 만듭니다.' : '열린 논문이 바뀌어 연결하지 않습니다.'}</small></span></label>}
        <input autoFocus disabled={createBusy} aria-describedby="create-note-guide" aria-label="새 노트 제목" value={creating.title} placeholder={noteGuides[creating.nodeType].example} onChange={(event) => setCreating({ ...creating, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void createNode(); if (event.key === 'Escape') setCreating(undefined) }} />
        <select aria-label="새 노트 양식" value={creating.templateId} onChange={(event) => setCreating({ ...creating, templateId: event.target.value })}>
          <option value="">기본 양식</option>
          {templates.filter((template) => template.nodeType === creating.nodeType).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <div className="create-actions"><button onClick={() => setCreating(undefined)}>취소</button><button className="primary" disabled={createBusy || !creating.title.trim()} onClick={() => void createNode()}>{createBusy ? '만드는 중…' : '만들기'}</button></div>
      </div>}

      <div className="tree-body">
        {searchResults ? <div className="tree-group">
          <div className="tree-folder is-static"><span>제목·본문 검색 결과</span><em>{searchResults.length}</em></div>
          {searchResults.length ? searchResults.map((result) => treeRow(result.node, result.excerpt, true)) : <p className="tree-empty">일치하는 노트가 없습니다.</p>}
        </div>
          : filtered ? <div className="tree-group">
            <div className="tree-folder is-static"><span>제목·미리보기 결과</span><em>{filtered.length}</em></div>
            {filtered.length ? filtered.map((node) => treeRow(node, node.preview, true)) : !searchBusy && <p className="tree-empty">제목·미리보기에는 일치하는 내용이 없습니다. Enter를 누르면 본문까지 검색합니다.</p>}
          </div>
            : libraryPath ? grouped.map((group) => <div className="tree-group" key={group.type}>
              <div className="tree-folder-row">
                <button className="tree-folder" aria-expanded={!collapsed.has(group.type)} onClick={() => toggleGroup(group.type)}>
                  <i className={`kind-dot kind-${group.type}`} /><span>{typeLabels[group.type]}</span><em>{group.items.length}</em>
                </button>
                {creatableTypes.includes(group.type) && <button
                  className="tree-add" aria-label={`${typeLabels[group.type]} 노트 추가`} title={`${typeLabels[group.type]} 노트 추가`}
                  onClick={() => { setCollapsed((current) => { const next = new Set(current); next.delete(group.type); return next }); beginCreate(group.type, query.trim()) }}
                ><Plus size={12} /></button>}
              </div>
              {!collapsed.has(group.type) && (group.items.length
                ? group.items.map((node) => treeRow(node))
                : <p className="tree-folder-empty">{group.type === 'paper' ? '리더에서 논문을 저장하면 여기에 쌓입니다.' : '아직 없습니다. + 로 추가하세요.'}</p>)}
            </div>)
              : <p className="tree-empty">먼저 라이브러리 폴더를 선택하세요.</p>}
      </div>

      {curation && curation.total > 0 && <button className="tree-queue" onClick={() => { setView('curation'); void reloadCuration() }}>
        <strong>정리 대기 {curation.total}건</strong>
        <small>{[curation.memos.length ? `승격 후보 ${curation.memos.length}` : '', curation.stubs.filter((stub) => stub.ready).length ? `정리할 개념 ${curation.stubs.filter((stub) => stub.ready).length}` : '', curation.pendingRelations.length ? `검토 관계 ${curation.pendingRelations.length}` : ''].filter(Boolean).join(' · ') || '항목 확인'}</small>
      </button>}
    </aside>

    <section className="notes-main">
      {libraryPath && <NoteRecoveryNotice key={libraryPath} onRestored={reloadNodes} />}
      <div className="notes-tabs" role="tablist" aria-label="열린 노트">
        {openNodes.map((node) => <div key={node.id} className={`notes-tab${node.id === activeId && view === 'doc' ? ' on' : ''}`}>
          <button role="tab" aria-selected={node.id === activeId && view === 'doc'} onClick={() => { setView('doc'); setActiveId(node.id) }}>
            <i className={`kind-dot kind-${node.nodeType}`} />{node.title}
          </button>
          <button className="tab-close" aria-label={`${node.title} 탭 닫기`} onClick={() => closeTab(node.id)}><X size={11} /></button>
        </div>)}
        {view === 'curation' && <div className="notes-tab on"><button role="tab" aria-selected="true"><Inbox size={11} /> 정리 대기열</button></div>}
        {view === 'graph' && <div className="notes-tab on"><button role="tab" aria-selected="true"><Network size={11} /> 볼트 지식 그래프</button></div>}
      </div>

      {notice && <div className={`notes-notice${notice.tone === 'error' ? ' is-error' : ''}`} role="status">
        <span>{notice.text}</span>
        {notice.undo && <button className="notice-undo" onClick={() => void notice.undo?.run()}><Undo2 size={12} /> {notice.undo.label}</button>}
        <button aria-label="알림 닫기" onClick={() => setNotice(undefined)}><X size={12} /></button>
      </div>}

      {view === 'graph'
        ? <GraphView activeId={activeId} onOpenNode={openNode} onNotify={notify} />
        : view === 'curation'
        ? <CurationQueue onOpenNode={openNode} onChanged={async () => { await reloadNodes(); await reloadContext() }} onCount={() => void reloadCuration()} />
        : active
          ? <NoteDocument
            key={`${libraryPath}:${active.id}`} node={active} nodes={nodes} anchors={anchors} relations={relations} templates={templates}
            onReloadNodes={reloadNodes} onReloadContext={reloadContext} onOpenNode={openNode} onNotify={notify}
            onOpenCuration={() => { setView('curation'); void reloadCuration() }}
            autoUnread={unread[active.id]} onAutoUnreadChange={reloadUnread}
            contextKey={`${relations.length}:${backlinks.length}`}
          />
          : <div className="notes-blank">
            <div className="notes-start">
              <span className="notes-start-eyebrow">나의 연구 노트</span>
              <h1>한 편에서 얻은 지식을, 다음 논문으로.</h1>
              <p>논문에서 남긴 메모를 열고, 반복해서 등장하는 개념이나 질문을 연결해 보세요.</p>
              <div className="blank-actions">
                {!libraryPath ? <button onClick={() => void chooseLibrary()}><FolderOpen size={15} /> 노트 폴더 선택</button>
                  : <button onClick={() => void window.prism.openPaperInReader()}><BookOpen size={15} /> 논문 읽으며 메모하기</button>}
                <button disabled={!libraryPath} onClick={() => beginCreate('concept', '')}><FilePlus2 size={15} /> 개념 노트 만들기</button>
              </div>
              <ol className="notes-start-steps">
                <li><strong>읽고 남기기</strong><span>리더에서 문장이나 그림을 선택해 메모와 함께 저장합니다.</span></li>
                <li><strong>내 말로 정리하기</strong><span>용어는 개념, 검토할 문장은 주장, 궁금한 점은 질문으로 모읍니다.</span></li>
                <li><strong>노트 연결하기</strong><span>본문에 <kbd>[[</kbd>를 입력해 다른 노트를 연결합니다. 근거가 있다면 관계 유형도 지정하세요.</span></li>
              </ol>
              {nodes.filter(node => node.nodeType === 'paper').length > 0 && <div className="notes-start-papers"><h2>논문 노트에서 이어가기</h2>{nodes.filter(node => node.nodeType === 'paper').slice(0, 3).map(node => <button key={node.id} onClick={() => openNode(node.id)}><BookOpen size={14} /><span>{node.title}</span></button>)}</div>}
              <p className="notes-start-storage">노트는 선택한 폴더에 Markdown으로 저장됩니다. 같은 폴더를 Obsidian 볼트로 열 수 있습니다.</p>
            </div>
          </div>}
    </section>

    {sideOpen && view === 'doc' && <ConnectionsPanel
      node={view === 'doc' ? active : undefined} relations={relations} backlinks={backlinks} citations={citations}
      citationsLoading={citationsLoading} onOpenNode={openNode} onOpenFullGraph={() => setView('graph')}
      onRefreshCitations={() => void reloadContext(true)}
    />}

    <footer className="notes-status">
      <span>{libraryPath ? libraryPath.split(/[\\/]/).filter(Boolean).at(-1) : '라이브러리 없음'}</span>
      {/* What the library holds, and how much of it the researcher has actually written into. */}
      <span title="사용자가 직접 쓴 문장이 있는 노트">노드 {nodes.length} · 이해함 {understoodCount}</span>
      {active && <span>이 노트 · 관계 {relationCount} · 백링크 {backlinks.length}</span>}
      <label className="status-model status-push" title="AI 정리 버튼을 직접 누를 때만 이 CLI와 모델을 사용합니다. 노트를 열거나 읽음으로 표시해도 AI를 호출하지 않습니다.">
        <Sparkles size={11} />
        <select
          aria-label="AI 정리 CLI" value={settings?.knowledgeProvider ?? ''}
          onChange={(event) => { const id = event.target.value as ProviderId | ''; void chooseKnowledgeModel(id ? { knowledgeProvider: id, knowledgeModel: providers.find((item) => item.id === id)?.models[0]?.id } : { knowledgeProvider: null as unknown as undefined }) }}
        >
          <option value="">AI 정리 없음</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · 설치 필요'}</option>)}
        </select>
        {settings?.knowledgeProvider && <select aria-label="AI 정리 모델" value={settings.knowledgeModel ?? ''} onChange={(event) => void chooseKnowledgeModel({ knowledgeModel: event.target.value })}>
          {providers.find((provider) => provider.id === settings.knowledgeProvider)?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>}
      </label>
      <span>markdown</span>
    </footer>

    {settingsOpen && <div className="note-history-backdrop" onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
      <section className="note-history-dialog note-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="note-settings-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSettingsOpen(false) } }}>
        <header><h2 id="note-settings-title">노트 설정</h2><button aria-label="노트 설정 닫기" onClick={() => setSettingsOpen(false)}><X size={18} /></button></header>
        <div className="note-settings-body"><ThemeControl /><p>리더와 노트에 함께 적용합니다. 원문 PDF는 인쇄 색상을 유지합니다.</p>
          <button onClick={() => { setSettingsOpen(false); void chooseLibrary() }}><FolderOpen size={14} /> 노트 폴더 선택</button>
          <p>같은 폴더를 Obsidian 볼트로 열 수 있습니다.</p>
        </div>
      </section>
    </div>}
    {templatesOpen && <TemplateManager onClose={() => { setTemplatesOpen(false); void reloadNodes() }} />}
  </main>
}
