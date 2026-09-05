import { useEffect, useMemo, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import './notes.css'
import { BookOpen, FilePlus2, FolderOpen, Inbox, LayoutTemplate, Network, NotebookPen, Plus, Search, Settings2, Trash2, Undo2, X } from 'lucide-react'
import NoteDocument from './NoteDocument'
import ConnectionsPanel from './ConnectionsPanel'
import CurationQueue from './CurationQueue'
import TemplateManager from './TemplateManager'
import { autoSectionLabels, creatableTypes, isStub, treeTypes, typeFolders, typeLabels } from './knowledgeModel'

type MainView = 'doc' | 'curation'

/**
 * The Notes window is a vault workspace: activity rail, node tree, tabbed documents, and a standing
 * connections panel. Knowledge nodes are no longer hidden behind a modal — everything the graph holds
 * is one click away in the tree.
 */
export default function NotesWindow() {
  const [libraryPath, setLibraryPath] = useState<string>()
  const [nodes, setNodes] = useState<KnowledgeNodeRecord[]>([])
  const [anchors, setAnchors] = useState<EvidenceAnchor[]>([])
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [view, setView] = useState<MainView>('doc')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ResearchSearchResult[]>()
  const [collapsed, setCollapsed] = useState<Set<KnowledgeNodeType>>(() => new Set())
  const [creating, setCreating] = useState<{ nodeType: KnowledgeNodeType; title: string; templateId: string }>()
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error'; undo?: { label: string; run: () => void | Promise<void> } }>()
  const [deleteReadyId, setDeleteReadyId] = useState<string>()
  const [curation, setCuration] = useState<CurationQueue>()
  // Which notes wrote something the researcher has not looked at yet.
  const [unread, setUnread] = useState<Record<string, { at: number; sections: string[] }>>({})
  const [relations, setRelations] = useState<KnowledgeRelationView[]>([])
  const [backlinks, setBacklinks] = useState<KnowledgeBacklink[]>([])
  const [citations, setCitations] = useState<CitationLinks>()
  const [citationsLoading, setCitationsLoading] = useState(false)
  const [sideOpen, setSideOpen] = useState(() => window.localStorage.getItem('prism.notes.sideOpen') !== 'off')
  const searchRef = useRef<HTMLInputElement>(null)
  const activeIdRef = useRef<string | undefined>(undefined)
  const nodesRef = useRef<KnowledgeNodeRecord[]>([])

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

  function notify(text: string, tone: 'info' | 'error' = 'info', undo?: { label: string; run: () => void | Promise<void> }) { setNotice({ text, tone, undo }) }
  useEffect(() => { if (!notice || notice.tone === 'error') return; const timer = window.setTimeout(() => setNotice(undefined), notice.undo ? 12000 : 6000); return () => window.clearTimeout(timer) }, [notice])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  async function reloadNodes() {
    try {
      const settings = await window.prism.getSettings()
      setLibraryPath(settings.libraryPath)
      if (!settings.libraryPath) { setNodes([]); return }
      const [nextNodes, nextTemplates, nextAnchors] = await Promise.all([window.prism.listKnowledgeNodes(), window.prism.listTemplates(), window.prism.listEvidenceAnchors()])
      setNodes(nextNodes); setTemplates(nextTemplates); setAnchors(nextAnchors)
      setOpenIds((current) => current.filter((id) => nextNodes.some((node) => node.id === id)))
      setActiveId((current) => current && nextNodes.some((node) => node.id === current) ? current : undefined)
    } catch (reason) { notify(String(reason), 'error') }
  }
  async function reloadCuration() {
    try { setCuration(await window.prism.listCurationQueue()) } catch { setCuration(undefined) }
  }
  async function reloadUnread() {
    try { setUnread(await window.prism.listAutoUnread()) } catch { setUnread({}) }
  }
  async function reloadContext(refreshCitations?: boolean) {
    const id = activeIdRef.current
    const node = nodesRef.current.find((item) => item.id === id)
    if (!id || !node) { setRelations([]); setBacklinks([]); setCitations(undefined); return }
    try {
      const [nextRelations, nextBacklinks] = await Promise.all([window.prism.listKnowledgeRelations(id), window.prism.listKnowledgeBacklinks(id)])
      if (activeIdRef.current !== id) return
      setRelations(nextRelations); setBacklinks(nextBacklinks)
    } catch (reason) { notify(String(reason), 'error') }
    if (node.nodeType !== 'paper' || !node.arxivId) { setCitations(undefined); return }
    if (refreshCitations) setCitationsLoading(true)
    try {
      const next = await window.prism.listPaperCitations(node.arxivId, { refresh: refreshCitations ?? false })
      if (activeIdRef.current === id) setCitations(next)
    } catch (reason) { if (refreshCitations) notify(String(reason), 'error') }
    finally { setCitationsLoading(false) }
  }

  useEffect(() => { window.document.title = 'Prism Notes'; void reloadNodes().then(reloadCuration).then(writeEveryNote).then(reloadUnread) }, [])

  /**
   * A library where only the note you happened to open is written is not a library that is written. The
   * deterministic pass costs a file read per note, so it runs once for everything when the window opens.
   */
  async function writeEveryNote() {
    const all = await window.prism.listKnowledgeNodes().catch(() => [])
    let changed = false
    for (const node of all) {
      const result = await window.prism.refreshPaperDigest(node.id, { useModel: false }).catch(() => undefined)
      if (result?.updated) changed = true
    }
    if (changed) await reloadNodes()
  }
  useEffect(() => { setRelations([]); setBacklinks([]); setCitations(undefined); void reloadContext() }, [activeId, nodes.length])
  useEffect(() => window.prism.onOpenKnowledgeNode((id) => { openNode(id) }), [])
  // The library folder is shared with Obsidian and the Reader, so pick up outside changes without a manual refresh.
  useEffect(() => {
    const onFocus = () => { void reloadNodes(); void reloadCuration(); void reloadUnread() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  function openNode(id: string) {
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
    if (!creating?.title.trim()) { notify('새 노트의 제목을 입력하세요.'); return }
    try {
      const result = await window.prism.createKnowledgeNode({ title: creating.title.trim(), nodeType: creating.nodeType, templateId: creating.templateId || undefined })
      setCreating(undefined); await reloadNodes(); openNode(result.id)
    } catch (reason) { notify(String(reason), 'error') }
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
    const text = query.trim()
    if (!text) { setSearchResults(undefined); return }
    try { setSearchResults(await window.prism.searchResearchKnowledge(text)) }
    catch (reason) { notify(String(reason), 'error') }
  }
  async function addCitationRelation(entry: CitationEntry, direction: 'references' | 'citations') {
    if (!active || !entry.nodeId) return
    const sourceId = direction === 'references' ? active.id : entry.nodeId
    const targetId = direction === 'references' ? entry.nodeId : active.id
    try {
      const snapshot = await window.prism.readKnowledgeNode(sourceId)
      const result = await window.prism.createKnowledgeRelation({ sourceId, targetId, type: 'extends', creator: 'user', expectedRevision: snapshot.revision })
      if (!result.saved) { notify('노트가 외부에서 변경되어 관계를 만들지 않았습니다.', 'error'); return }
      await reloadContext(); notify(`'${entry.title}'와(과) 확장함 관계를 만들었습니다. 인용 목록은 자동 레이어이고 이 관계는 직접 승인한 것입니다.`)
    } catch (reason) { notify(String(reason), 'error') }
  }
  function toggleSide() { setSideOpen((value) => { window.localStorage.setItem('prism.notes.sideOpen', value ? 'off' : 'on'); return !value }) }
  function toggleGroup(type: KnowledgeNodeType) {
    setCollapsed((current) => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next })
  }

  const treeRow = (node: KnowledgeNodeRecord, excerpt?: string) => <div key={node.id} className={`tree-row${node.id === activeId && view === 'doc' ? ' active' : ''}`}>
    <button
      className={`tree-file${isStub(node) ? ' is-stub' : ''}`}
      title={unread[node.id] ? `자동으로 새로 쓰인 내용이 있습니다: ${unread[node.id].sections.map((section) => autoSectionLabels[section] ?? section).join(' · ')}` : node.relativePath}
      onClick={() => openNode(node.id)}
    >
      <span>{node.title}</span>
      {unread[node.id] && <i className="tree-unread" aria-label="읽지 않은 자동 기록" />}
      {excerpt && <small>{excerpt}</small>}
    </button>
    <button
      className={`tree-delete${deleteReadyId === node.id ? ' is-ready' : ''}`}
      aria-label={`${node.title} 삭제`} title={deleteReadyId === node.id ? '한 번 더 누르면 휴지통으로' : '휴지통으로 보내기'}
      onClick={(event) => { event.stopPropagation(); void deleteNode(node) }}
    ><Trash2 size={11} /></button>
  </div>

  return <main className={`notes-window${sideOpen ? ' has-side' : ''}`}>
    {/* Six unlabelled glyphs are six guesses. The words are short enough to fit next to them. */}
    <nav className="notes-rail" aria-label="작업 영역">
      <button aria-label="논문 리더" title="논문 리더 창으로" onClick={() => void window.prism.openPaperInReader()}><BookOpen size={17} /><b>리더</b></button>
      <button aria-label="노트" title="노트" aria-pressed={view === 'doc'} onClick={() => setView('doc')}><NotebookPen size={17} /><b>노트</b></button>
      <button aria-label="정리 대기열" title="정리 대기열" aria-pressed={view === 'curation'} onClick={() => { setView('curation'); void reloadCuration() }}>
        <Inbox size={17} />{curation?.total ? <em>{curation.total}</em> : null}<b>정리</b>
      </button>
      <button aria-label="검색" title="볼트 검색" onClick={() => searchRef.current?.focus()}><Search size={17} /><b>검색</b></button>
      <span className="rail-spacer" />
      <button aria-label="연결 패널" title="연결 패널 접기/펼치기" aria-pressed={sideOpen} onClick={toggleSide}><Network size={17} /><b>연결</b></button>
      <button aria-label="노트 양식" title="노트 양식" onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={17} /><b>양식</b></button>
      <button aria-label="라이브러리 폴더" title="라이브러리 폴더 선택" onClick={() => void chooseLibrary()}><Settings2 size={17} /><b>볼트</b></button>
    </nav>

    <aside className="notes-tree" aria-label="볼트">
      <button className="tree-vault" title={libraryPath ?? '라이브러리 폴더를 선택하세요'} onClick={() => void chooseLibrary()}>
        <FolderOpen size={13} /><b>{libraryPath ? libraryPath.split(/[\\/]/).filter(Boolean).at(-1) : '라이브러리 선택'}</b>
      </button>
      <div className="tree-search">
        <Search size={12} />
        <input
          ref={searchRef} aria-label="노트 검색" value={query} placeholder="제목 검색 · Enter로 의미 검색"
          onChange={(event) => { setQuery(event.target.value); setSearchResults(undefined) }}
          onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); if (event.key === 'Escape') { setQuery(''); setSearchResults(undefined) } }}
        />
        {query && <button aria-label="검색 지우기" onClick={() => { setQuery(''); setSearchResults(undefined) }}><X size={11} /></button>}
      </div>
      <button className="tree-new" onClick={() => setCreating({ nodeType: 'concept', title: query.trim(), templateId: '' })}><FilePlus2 size={12} /> 새 노트</button>

      {creating && <div className="tree-create">
        <div className="create-types">{creatableTypes.map((type) => <button key={type} className={creating.nodeType === type ? 'active' : ''} aria-pressed={creating.nodeType === type} onClick={() => setCreating({ ...creating, nodeType: type, templateId: '' })}>{typeLabels[type]}</button>)}</div>
        <input autoFocus aria-label="새 노트 제목" value={creating.title} placeholder="제목" onChange={(event) => setCreating({ ...creating, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void createNode(); if (event.key === 'Escape') setCreating(undefined) }} />
        <select aria-label="새 노트 양식" value={creating.templateId} onChange={(event) => setCreating({ ...creating, templateId: event.target.value })}>
          <option value="">기본 양식</option>
          {templates.filter((template) => template.nodeType === creating.nodeType).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <div className="create-actions"><button onClick={() => setCreating(undefined)}>취소</button><button className="primary" onClick={() => void createNode()}>만들기</button></div>
      </div>}

      <div className="tree-body">
        {searchResults ? <div className="tree-group">
          <div className="tree-folder is-static"><span>의미 검색 결과</span><em>{searchResults.length}</em></div>
          {searchResults.length ? searchResults.map((result) => treeRow(result.node, result.excerpt)) : <p className="tree-empty">일치하는 노트가 없습니다.</p>}
        </div>
          : filtered ? <div className="tree-group">
            <div className="tree-folder is-static"><span>검색 결과</span><em>{filtered.length}</em></div>
            {filtered.length ? filtered.map((node) => treeRow(node)) : <p className="tree-empty">일치하는 제목이 없습니다. Enter를 누르면 본문까지 검색합니다.</p>}
          </div>
            : libraryPath ? grouped.map((group) => <div className="tree-group" key={group.type}>
              <div className="tree-folder-row">
                <button className="tree-folder" aria-expanded={!collapsed.has(group.type)} onClick={() => toggleGroup(group.type)}>
                  <i className={`kind-dot kind-${group.type}`} /><span>{typeFolders[group.type]}</span><em>{group.items.length}</em>
                </button>
                {creatableTypes.includes(group.type) && <button
                  className="tree-add" aria-label={`${typeLabels[group.type]} 노트 추가`} title={`${typeLabels[group.type]} 노트 추가`}
                  onClick={() => { setCollapsed((current) => { const next = new Set(current); next.delete(group.type); return next }); setCreating({ nodeType: group.type, title: query.trim(), templateId: '' }) }}
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
      <div className="notes-tabs" role="tablist" aria-label="열린 노트">
        {openNodes.map((node) => <div key={node.id} className={`notes-tab${node.id === activeId && view === 'doc' ? ' on' : ''}`}>
          <button role="tab" aria-selected={node.id === activeId && view === 'doc'} onClick={() => { setView('doc'); setActiveId(node.id) }}>
            <i className={`kind-dot kind-${node.nodeType}`} />{node.title}
          </button>
          <button className="tab-close" aria-label={`${node.title} 탭 닫기`} onClick={() => closeTab(node.id)}><X size={11} /></button>
        </div>)}
        {view === 'curation' && <div className="notes-tab on"><button role="tab" aria-selected="true"><Inbox size={11} /> 정리 대기열</button></div>}
      </div>

      {notice && <div className={`notes-notice${notice.tone === 'error' ? ' is-error' : ''}`} role="status">
        <span>{notice.text}</span>
        {notice.undo && <button className="notice-undo" onClick={() => void notice.undo?.run()}><Undo2 size={12} /> {notice.undo.label}</button>}
        <button aria-label="알림 닫기" onClick={() => setNotice(undefined)}><X size={12} /></button>
      </div>}

      {view === 'curation'
        ? <CurationQueue onOpenNode={openNode} onChanged={async () => { await reloadNodes(); await reloadContext() }} onCount={() => void reloadCuration()} />
        : active
          ? <NoteDocument
            key={active.id} node={active} nodes={nodes} anchors={anchors} relations={relations} templates={templates}
            onReloadNodes={reloadNodes} onReloadContext={reloadContext} onOpenNode={openNode} onNotify={notify}
            onOpenCuration={() => { setView('curation'); void reloadCuration() }}
            autoUnread={unread[active.id]} onAutoUnreadChange={reloadUnread}
            contextKey={`${relations.length}:${backlinks.length}`}
          />
          : <div className="notes-blank">
            <p>왼쪽에서 노트를 열거나</p>
            <div className="blank-actions">
              <button onClick={() => void window.prism.openPaperInReader()}><BookOpen size={13} /> 리더 열기</button>
              <button onClick={() => setCreating({ nodeType: 'concept', title: '', templateId: '' })}><FilePlus2 size={13} /> 새 노트</button>
            </div>
          </div>}
    </section>

    {sideOpen && <ConnectionsPanel
      node={view === 'doc' ? active : undefined} relations={relations} backlinks={backlinks} citations={citations}
      citationsLoading={citationsLoading} onOpenNode={openNode}
      onRefreshCitations={() => void reloadContext(true)} onAddCitationRelation={addCitationRelation}
    />}

    <footer className="notes-status">
      <span>{libraryPath ? libraryPath.split(/[\\/]/).filter(Boolean).at(-1) : '라이브러리 없음'}</span>
      <span>노드 {nodes.length}</span>
      {active && <span>이 노트 · 관계 {relationCount} · 백링크 {backlinks.length}</span>}
      <span className="status-push">markdown</span>
    </footer>

    {templatesOpen && <TemplateManager onClose={() => { setTemplatesOpen(false); void reloadNodes() }} />}
  </main>
}
