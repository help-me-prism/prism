import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  BookOpen, Bot, Check, ChevronDown, Circle, FileText, FolderOpen, MessageSquareText,
  Plus, RefreshCw, SendHorizontal, Settings2, Sparkles, Square, StickyNote,
  Trash2, Undo2, X,
} from 'lucide-react'
import PaperWorkspace from './PaperWorkspace'

type JsonRecord = Record<string, unknown>

const suggestions = [
  '이 논문의 핵심 기여를 세 가지로 정리해줘',
  '연구 방법론의 한계는 무엇일까?',
  '처음 읽는 사람을 위한 배경지식을 설명해줘',
]

let sequence = 0
function uniqueId(prefix: string) {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

function makeSession(provider: ProviderId = 'codex', model = provider === 'codex' ? 'gpt-5.6-sol' : 'sonnet'): ChatSession {
  const now = Date.now()
  return { id: uniqueId('session'), title: '새 대화', provider, model, messages: [], createdAt: now, updatedAt: now }
}

const referencePattern = /\[?@((?:문장|수식|피겨|페이지)\d+(?:-[A-Za-z0-9]+)?)\]?/g

function referencedAnchors(text: string, anchors: ContextAnchor[]) {
  const byLabel = new Map(anchors.map((anchor) => [anchor.label, anchor]))
  const result: ContextAnchor[] = []; const seen = new Set<string>()
  for (const match of text.matchAll(referencePattern)) {
    const anchor = byLabel.get(match[1]); if (!anchor) continue
    const key = `${anchor.paperId}:${anchor.anchorId}`
    if (!seen.has(key)) { seen.add(key); result.push(anchor) }
  }
  return result
}

function MessageContent({ text, anchors, onNavigate }: { text: string; anchors?: ContextAnchor[]; onNavigate?: (anchor: ContextAnchor) => void }) {
  if (!text) return null
  const byLabel = new Map((anchors ?? []).map((anchor) => [anchor.label, anchor]))
  const nodes: ReactNode[] = []; let cursor = 0
  for (const match of text.matchAll(referencePattern)) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const anchor = byLabel.get(match[1])
    nodes.push(anchor
      ? <AnchorChip key={`${match.index}-${anchor.anchorId}`} anchor={anchor} onNavigate={onNavigate} />
      : match[0])
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

function AnchorChip({ anchor, onRemove, onNavigate }: { anchor: ContextAnchor; onRemove?: () => void; onNavigate?: (anchor: ContextAnchor) => void }) {
  const content = <><span className="anchor-symbol">@</span><span>{anchor.label}</span><small>{anchor.paperId}</small>{onRemove && <X size={11} />}<span className={`anchor-popover ${anchor.preview ? 'image' : ''}`}>{anchor.preview ? <img src={anchor.preview} alt={`${anchor.label} 미리보기`} /> : <><strong>{anchor.paperTitle}</strong>{anchor.source.slice(0, 500)}</>}</span></>
  return onRemove
    ? <button type="button" className="anchor-token" title={anchor.source} onClick={onRemove}>{content}</button>
    : <button type="button" className="anchor-token" title="논문의 해당 위치로 이동" onClick={() => onNavigate?.(anchor)}>{content}</button>
}

function withoutReferences(text: string) { return text.replace(referencePattern, ' ').replace(/\s{2,}/g, ' ').trim() }

function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [contextAnchors, setContextAnchors] = useState<ContextAnchor[]>([])
  const [anchorCatalog, setAnchorCatalog] = useState<ContextAnchor[]>([])
  const [workspaceState, setWorkspaceState] = useState<WorkspaceSnapshot>({ library: [], openPaperIds: [] })
  const [workspaceCommand, setWorkspaceCommand] = useState<WorkspaceCommand>()
  const [contextPaperIds, setContextPaperIds] = useState<string[]>([])
  const [paperContextOpen, setPaperContextOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(0)
  const [deletedSession, setDeletedSession] = useState<{ session: ChatSession; index: number }>()
  const endRef = useRef<HTMLDivElement>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const activeProvider = providers.find((provider) => provider.id === activeSession?.provider)
  const isRunning = activeSession ? runningIds.includes(activeSession.id) : false
  const selectedPapers = workspaceState.library.filter((paper) => contextPaperIds.includes(paper.arxivId))
  const tagQuery = input.match(/(?:^|\s)@([^\s@]*)$/)?.[1]
  const tagSuggestions = tagQuery !== undefined ? anchorCatalog.filter((anchor) => anchor.label.toLowerCase().includes(tagQuery.toLowerCase())).slice(0, 8) : []

  useEffect(() => { setTagSuggestionIndex(0) }, [tagQuery, anchorCatalog])
  useEffect(() => {
    if (!deletedSession) return
    const timeout = window.setTimeout(() => setDeletedSession(undefined), 6000)
    return () => window.clearTimeout(timeout)
  }, [deletedSession])
  useEffect(() => {
    if (!settingsOpen) return
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [settingsOpen])

  useEffect(() => {
    Promise.all([window.prism.listProviders(), window.prism.loadSessions()]).then(([providerList, savedSessions]) => {
      setProviders(providerList)
      const usable = savedSessions.filter((session) => session?.id && Array.isArray(session.messages))
      const initial = usable.length ? usable : [makeSession('codex', providerList.find((item) => item.id === 'codex')?.models[0]?.id)]
      setSessions(initial)
      setActiveSessionId(initial[0].id)
      setHydrated(true)
    }).catch((reason) => {
      const initial = makeSession()
      setSessions([initial])
      setActiveSessionId(initial.id)
      setErrors({ [initial.id]: String(reason) })
      setHydrated(true)
    })

    const offEvent = window.prism.onChatEvent((payload) => {
      if (!payload || typeof payload !== 'object') return
      const event = payload as JsonRecord
      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
      if (!sessionId) return
      if (event.type === 'thread.started' && typeof event.providerThreadId === 'string') {
        setSessions((current) => current.map((session) => session.id === sessionId
          ? { ...session, providerThreadId: event.providerThreadId as string, updatedAt: Date.now() }
          : session))
      }
      if (event.type === 'text.delta' && typeof event.messageId === 'string' && typeof event.text === 'string') {
        setSessions((current) => current.map((session) => {
          if (session.id !== sessionId) return session
          const exists = session.messages.some((message) => message.id === event.messageId)
          const messages = exists
            ? session.messages.map((message) => message.id === event.messageId ? { ...message, text: message.text + event.text } : message)
            : [...session.messages, { id: event.messageId as string, role: 'assistant' as const, text: event.text as string, createdAt: Date.now() }]
          return { ...session, messages, updatedAt: Date.now() }
        }))
      }
    })
    const offDone = window.prism.onChatDone((payload) => {
      if (!payload || typeof payload !== 'object') return
      const sessionId = (payload as JsonRecord).sessionId
      if (typeof sessionId === 'string') setRunningIds((current) => current.filter((id) => id !== sessionId))
    })
    const offError = window.prism.onChatError((payload) => {
      if (!payload || typeof payload !== 'object') return
      const event = payload as JsonRecord
      if (typeof event.sessionId === 'string' && typeof event.message === 'string') {
        setErrors((current) => ({ ...current, [event.sessionId as string]: event.message as string }))
        setRunningIds((current) => current.filter((id) => id !== event.sessionId))
      }
    })
    return () => { offEvent(); offDone(); offError() }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timeout = window.setTimeout(() => {
      const compactSessions = sessions.map((session) => ({ ...session, messages: session.messages.map((message) => ({ ...message, anchors: message.anchors?.map(({ preview: _preview, ...anchor }) => anchor) })) }))
      window.prism.saveSessions(compactSessions).catch((reason) => {
        console.error('Session save failed:', reason)
        if (activeSessionId) setErrors((current) => ({ ...current, [activeSessionId]: `대화를 자동 저장하지 못했습니다: ${String(reason)}` }))
      })
    }, 350)
    return () => { window.clearTimeout(timeout) }
  }, [sessions, hydrated, activeSessionId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages, isRunning])

  useEffect(() => {
    const id = workspaceState.activePaperId
    if (id) setContextPaperIds((current) => current.includes(id) ? current : [...current, id])
  }, [workspaceState.activePaperId])
  useEffect(() => { setContextPaperIds((current) => current.filter((id) => workspaceState.library.some((paper) => paper.arxivId === id))) }, [workspaceState.library])

  const canSend = useMemo(() => Boolean(input.trim() && activeSession && !isRunning && activeProvider?.available), [input, activeSession, isRunning, activeProvider])
  const orderedSessions = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions])

  function updateSession(sessionId: string, updater: (session: ChatSession) => ChatSession) {
    setSessions((current) => current.map((session) => session.id === sessionId ? updater(session) : session))
  }

  function newChat(provider = activeSession?.provider ?? 'codex', model?: string) {
    const providerData = providers.find((item) => item.id === provider)
    const session = makeSession(provider, model ?? providerData?.models[0]?.id)
    setSessions((current) => [session, ...current])
    setActiveSessionId(session.id)
    setInput('')
    setContextAnchors([])
  }

  function deleteSession(sessionId: string) {
    if (runningIds.includes(sessionId) || sessions.length <= 1) return
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === sessionId)
      const removed = current[index]
      if (!removed) return current
      const remaining = current.filter((session) => session.id !== sessionId)
      setDeletedSession({ session: removed, index })
      if (activeSessionId === sessionId) setActiveSessionId(remaining[Math.min(index, remaining.length - 1)].id)
      return remaining
    })
  }

  function undoDeleteSession() {
    if (!deletedSession) return
    setSessions((current) => {
      if (current.some((session) => session.id === deletedSession.session.id)) return current
      const next = [...current]
      next.splice(Math.min(deletedSession.index, next.length), 0, deletedSession.session)
      return next
    })
    setActiveSessionId(deletedSession.session.id)
    setDeletedSession(undefined)
  }

  async function refreshProviders() {
    try { setProviders(await window.prism.listProviders()) }
    catch (reason) { if (activeSession) setErrors((current) => ({ ...current, [activeSession.id]: String(reason) })) }
  }

  function changeProvider(provider: ProviderId) {
    if (!activeSession) return
    const model = providers.find((item) => item.id === provider)?.models[0]?.id ?? (provider === 'codex' ? 'gpt-5.6-sol' : 'sonnet')
    if (activeSession.messages.length) {
      newChat(provider, model)
      return
    }
    updateSession(activeSession.id, (session) => ({ ...session, provider, model, providerThreadId: undefined, updatedAt: Date.now() }))
  }

  async function send(text = input) {
    const rawPrompt = text.trim()
    const typedAnchors = referencedAnchors(rawPrompt, anchorCatalog)
    const selectedAnchors = [...contextAnchors, ...typedAnchors].filter((anchor, index, all) => all.findIndex((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId) === index)
    const prompt = withoutReferences(rawPrompt)
    if (!prompt || !activeSession || isRunning || !activeProvider?.available) return
    const sessionId = activeSession.id
    const assistantId = uniqueId('assistant')
    const paperContext = selectedPapers.length ? `<paper_context>\n${selectedPapers.map((paper) => `<paper id="${paper.arxivId}" title=${JSON.stringify(paper.title)} />`).join('\n')}\n</paper_context>` : ''
    const anchorContext = selectedAnchors.length ? `<prism_context>\n${selectedAnchors.map((anchor) => `<anchor ref="@${anchor.label}" type="${anchor.type}" paper="${anchor.paperId}" stable_id="${anchor.anchorId}" page="${anchor.page}">\n${anchor.source.slice(0, 4000)}\n</anchor>`).join('\n')}\n</prism_context>\nKeep every [@...] reference distinct and answer by explicitly relating the referenced anchors.` : ''
    const promptWithContext = [prompt, paperContext, anchorContext].filter(Boolean).join('\n\n')
    const now = Date.now()
    setInput('')
    setErrors((current) => { const next = { ...current }; delete next[sessionId]; return next })
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.messages.length ? session.title : prompt.replace(/\s+/g, ' ').slice(0, 34),
      updatedAt: now,
      messages: [
        ...session.messages,
        { id: uniqueId('user'), role: 'user', text: prompt, createdAt: now, anchors: selectedAnchors },
        { id: assistantId, role: 'assistant', text: '', createdAt: now + 1, anchors: selectedAnchors },
      ],
    }))
    setContextAnchors([])
    setRunningIds((current) => [...current, sessionId])
    try {
      await window.prism.sendMessage({
        prompt: promptWithContext, sessionId, messageId: assistantId, provider: activeSession.provider,
        model: activeSession.model, providerThreadId: activeSession.providerThreadId,
      })
    } catch (reason) {
      setContextAnchors(selectedAnchors)
      setRunningIds((current) => current.filter((id) => id !== sessionId))
      setErrors((current) => ({ ...current, [sessionId]: reason instanceof Error ? reason.message : String(reason) }))
      updateSession(sessionId, (session) => ({ ...session, messages: session.messages.filter((message) => message.id !== assistantId) }))
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void send() }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (tagSuggestions.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setTagSuggestionIndex((index) => (index + 1) % tagSuggestions.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setTagSuggestionIndex((index) => (index - 1 + tagSuggestions.length) % tagSuggestions.length); return }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); chooseTag(tagSuggestions[tagSuggestionIndex] ?? tagSuggestions[0]); return }
      if (event.key === 'Escape') { event.preventDefault(); setInput((current) => current.replace(/(?:^|\s)@[^\s@]*$/, '')); return }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
  }

  function consumeReferences(value: string, includeTrailingToken = false) {
    const found = referencedAnchors(value, anchorCatalog).filter((anchor) => {
      const match = value.match(new RegExp(`\\[?@${anchor.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?`))
      return Boolean(match && (includeTrailingToken || (match.index ?? 0) + match[0].length < value.length))
    })
    if (found.length) setContextAnchors((current) => [...current, ...found].filter((anchor, index, all) => all.findIndex((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId) === index))
    const cleaned = found.reduce((current, anchor) => current.replace(new RegExp(`\\[?@${anchor.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?\\s*`, 'g'), ' '), value).replace(/\s{2,}/g, ' ').trimStart()
    setInput(cleaned)
  }

  function chooseTag(anchor: ContextAnchor) {
    setContextAnchors((current) => current.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId) ? current : [...current, anchor])
    setInput((current) => current.replace(/(?:^|\s)@[^\s@]*$/, (match) => match.startsWith(' ') ? ' ' : ''))
  }

  function runWorkspaceCommand(type: WorkspaceCommand['type'], paperId?: string, anchor?: ContextAnchor) { setWorkspaceCommand({ id: Date.now() + Math.random(), type, paperId, anchor }) }
  function navigateAnchor(anchor: ContextAnchor) { runWorkspaceCommand('navigate-anchor', anchor.paperId, anchor) }

  useEffect(() => {
    if (!input.includes('@')) return
    const timeout = window.setTimeout(() => consumeReferences(input, true), 450)
    return () => window.clearTimeout(timeout)
  }, [input, anchorCatalog])

  if (!activeSession) return <main className="app-shell loading-app">Prism을 준비하고 있어요…</main>

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">P</span><span>Prism</span></div>
        <div className="document-title"><FileText size={14} /><span>{activeSession.title}</span></div>
      </header>

      <div className="workspace">
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-actions">
              <button className="new-paper" onClick={() => runWorkspaceCommand('search')}><Plus size={16} /> 논문 열기</button>
            </div>
            <nav>
              <p className="nav-label">WORKSPACE</p>
              <button className="nav-item active"><BookOpen size={17} /> Reader <span>{workspaceState.openPaperIds.length}</span></button>
              <button className="nav-item" aria-label="Notes 열기" onClick={() => void window.prism.openNotes()}><StickyNote size={17} /> Notes <span>{workspaceState.library.length}</span></button>
              <button className="repository-card" onClick={() => runWorkspaceCommand('choose-folder')} title={workspaceState.libraryPath ?? '라이브러리 폴더를 선택하세요'}><FolderOpen size={16} /><span><small>CURRENT LIBRARY</small><strong>{workspaceState.libraryPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? '폴더 선택'}</strong></span></button>
              <div className="paper-tree-heading"><p className="nav-label">PAPERS</p><button onClick={() => runWorkspaceCommand('search')} title="arXiv 검색"><Plus size={13} /></button></div>
              <div className="paper-tree">{workspaceState.library.length ? workspaceState.library.map((paper) => <button key={paper.arxivId} className={paper.arxivId === workspaceState.activePaperId ? 'selected' : ''} onClick={() => runWorkspaceCommand('open-paper', paper.arxivId)}><FileText size={13} /><span><strong>{paper.title}</strong><small>{paper.arxivId}</small></span></button>) : <small>선택한 폴더에 저장된 논문이 없습니다.</small>}</div>
              <div className="session-heading"><p className="nav-label">CHATS</p><button onClick={() => newChat()} aria-label="새 대화"><Plus size={14} /></button></div>
              <div className="session-list">
                {orderedSessions.map((session) => (
                  <div key={session.id} className={`session-item ${session.id === activeSession.id ? 'selected' : ''}`}>
                    <button className="session-select" onClick={() => setActiveSessionId(session.id)} aria-current={session.id === activeSession.id ? 'page' : undefined}>
                      <span className={`session-provider provider-${session.provider}`}>{session.provider === 'codex' ? 'C' : 'A'}</span>
                      <span className="session-copy"><strong>{session.title}</strong><small>{session.model}{runningIds.includes(session.id) ? ' · 응답 중…' : ''}</small></span>
                    </button>
                    <button className="delete-session" onClick={() => deleteSession(session.id)} disabled={sessions.length <= 1 || runningIds.includes(session.id)} aria-label={`${session.title} 대화 삭제`} title={sessions.length <= 1 ? '마지막 대화는 삭제할 수 없습니다' : '대화 삭제'}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </nav>
            <div className="sidebar-footer">
              <div className="provider-badge"><span className={`status-dot ${activeProvider?.available ? 'online' : ''}`} /><div><strong>{activeProvider?.name ?? activeSession.provider}</strong><small>{activeProvider?.status ?? '확인 중…'}</small></div></div>
              <button className="icon-button" aria-label="설정" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
            </div>
          </aside>
        )}

        <PaperWorkspace providers={providers} sidebarOpen={sidebarOpen} command={workspaceCommand} onWorkspaceState={setWorkspaceState} onToggleSidebar={() => setSidebarOpen((value) => !value)} onAnchorCatalog={setAnchorCatalog} onTagAnchor={(anchor) => {
          setContextAnchors((current) => current.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId) ? current : [...current, anchor])
        }} />

        <aside className="chat-pane">
          <div className="chat-header">
            <div><span className="ai-icon"><Sparkles size={15} /></span><strong>AI Research Assistant</strong></div>
            <div className="header-buttons"><button onClick={() => newChat()} title="새 대화" aria-label="새 대화"><Plus size={17} /></button><button onClick={() => setSettingsOpen(true)} title="앱 설정" aria-label="앱 설정"><Settings2 size={17} /></button></div>
          </div>
          <div className="model-bar">
            <label><span>CLI</span><select value={activeSession.provider} disabled={isRunning} onChange={(event) => changeProvider(event.target.value as ProviderId)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.available ? '' : ' · 설치 필요'}</option>)}</select></label>
            <label className="model-select"><span>MODEL</span><select value={activeSession.model} disabled={isRunning} onChange={(event) => updateSession(activeSession.id, (session) => ({ ...session, model: event.target.value, updatedAt: Date.now() }))}>{activeProvider?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          </div>
          <div className="paper-context-bar"><button onClick={() => setPaperContextOpen((value) => !value)}><BookOpen size={13} /><span>{selectedPapers.length ? selectedPapers.map((paper) => paper.arxivId).join(', ') : '논문 컨텍스트 없음'}</span><ChevronDown size={12} /></button>{paperContextOpen && <div className="paper-context-menu"><header>AI가 보고 있는 논문</header>{workspaceState.library.map((paper) => { const selected = contextPaperIds.includes(paper.arxivId); return <button key={paper.arxivId} onClick={() => setContextPaperIds((current) => selected ? current.filter((id) => id !== paper.arxivId) : [...current, paper.arxivId])}><span className={selected ? 'checked' : ''}>{selected && <Check size={11} />}</span><div><strong>{paper.title}</strong><small>{paper.arxivId}</small></div></button> })}</div>}</div>

          <div className="messages">
            {activeSession.messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="welcome-orbit"><Bot size={27} /></div><h2>무엇이 궁금한가요?</h2>
                <p>{activeProvider?.name ?? 'AI'} · {activeProvider?.models.find((model) => model.id === activeSession.model)?.name ?? activeSession.model}<br />세션은 이 기기에 자동 저장됩니다.</p>
                <div className="suggestions">{suggestions.map((suggestion) => <button key={suggestion} disabled={!activeProvider?.available} onClick={() => void send(suggestion)}>{suggestion}<SendHorizontal size={13} /></button>)}</div>
              </div>
            ) : activeSession.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-label">{message.role === 'user' ? 'You' : activeProvider?.name ?? 'Prism'}</div>
                {message.anchors?.length ? <div className={`message-anchors ${message.role}`}>{message.anchors.map((anchor) => <AnchorChip key={`${anchor.paperId}-${anchor.anchorId}`} anchor={anchor} onNavigate={navigateAnchor} />)}</div> : null}
                <div className={`message-body ${message.role === 'assistant' && isRunning && !message.text ? 'streaming-empty' : ''}`}>{message.text ? <MessageContent text={message.role === 'user' ? withoutReferences(message.text) : message.text} anchors={message.anchors} onNavigate={navigateAnchor} /> : message.role === 'assistant' ? '●' : ''}{message.role === 'assistant' && isRunning && message === activeSession.messages.at(-1) && <span className="stream-caret" />}</div>
              </article>
            ))}
            {errors[activeSession.id] && <div className="error-banner"><Circle size={10} fill="currentColor" /><span>{errors[activeSession.id]}</span><button onClick={() => setErrors((current) => ({ ...current, [activeSession.id]: '' }))}><X size={14} /></button></div>}
            <div ref={endRef} />
          </div>

          <div className="composer-wrap">
            {!activeProvider?.available && <div className="cli-warning">{activeProvider?.name ?? activeSession.provider} CLI를 설치하고 로그인해 주세요.</div>}
            <form className="composer" onSubmit={onSubmit}>
              {contextAnchors.length > 0 && <div className="context-chips">{contextAnchors.map((anchor) => <AnchorChip key={`${anchor.paperId}-${anchor.anchorId}`} anchor={anchor} onRemove={() => setContextAnchors((current) => current.filter((item) => item.paperId !== anchor.paperId || item.anchorId !== anchor.anchorId))} />)}</div>}
              {tagSuggestions.length > 0 && <div className="tag-suggestions" role="listbox" aria-label="논문 참조 추천">{tagSuggestions.map((anchor, index) => <button type="button" role="option" aria-selected={index === tagSuggestionIndex} className={index === tagSuggestionIndex ? 'active' : ''} key={`${anchor.paperId}-${anchor.anchorId}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setTagSuggestionIndex(index)} onClick={() => chooseTag(anchor)}><span>@</span><div><strong>{anchor.label}</strong><small>{anchor.paperId} · p.{anchor.page}</small></div></button>)}</div>}
              <textarea value={input} onChange={(event) => consumeReferences(event.target.value)} onBlur={() => consumeReferences(input, true)} onKeyDown={onKeyDown} placeholder="논문에 대해 질문하세요…" rows={1} disabled={!activeProvider?.available} aria-label="AI에게 질문" aria-autocomplete="list" />
              <div className="composer-bottom">
                <button type="button" className="context-button" onClick={() => setPaperContextOpen((value) => !value)}><MessageSquareText size={14} /> 논문 {selectedPapers.length}개 <ChevronDown size={12} /></button>
                {isRunning ? <button type="button" className="send-button stop" onClick={() => void window.prism.cancelMessage(activeSession.id)} aria-label="생성 중지"><Square size={13} fill="currentColor" /></button> : <button className="send-button" disabled={!canSend} aria-label="보내기"><SendHorizontal size={16} /></button>}
              </div>
            </form>
            <p className="composer-note">자동 저장 · 실시간 스트리밍 · CLI는 읽기 전용으로 실행됩니다</p>
          </div>
        </aside>
      </div>
      {settingsOpen && <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><section className="app-settings" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
        <header><div><Settings2 size={18} /><div><h2 id="app-settings-title">Prism 설정</h2><p>연결 상태와 로컬 작업 환경을 확인합니다.</p></div></div><button onClick={() => setSettingsOpen(false)} aria-label="설정 닫기"><X size={18} /></button></header>
        <div className="settings-section"><div className="settings-heading"><div><strong>AI CLI 연결</strong><small>터미널에서 로그인한 로컬 CLI를 사용합니다.</small></div><button onClick={() => void refreshProviders()}><RefreshCw size={14} /> 다시 확인</button></div>
          <div className="provider-list">{providers.map((provider) => <div key={provider.id}><span className={`status-dot ${provider.available ? 'online' : ''}`} /><div><strong>{provider.name}</strong><small>{provider.status}</small></div><span>{provider.available ? '사용 가능' : '설치 또는 로그인 필요'}</span></div>)}</div>
        </div>
        <div className="settings-section"><strong>라이브러리</strong><p>논문 PDF, 번역, 피겨와 Markdown 노트는 선택한 로컬 폴더에 저장됩니다.</p><button className="settings-action" onClick={() => { setSettingsOpen(false); runWorkspaceCommand('choose-folder') }}><FolderOpen size={15} /> 라이브러리 폴더 변경</button></div>
        <div className="settings-section shortcuts"><strong>키보드</strong><div><span>메시지 전송</span><kbd>Enter</kbd><span>줄바꿈</span><kbd>Shift + Enter</kbd><span>참조 선택</span><kbd>↑ ↓ · Enter</kbd></div></div>
      </section></div>}
      {deletedSession && <div className="undo-toast" role="status"><span><strong>대화를 삭제했습니다.</strong><small>6초 동안 되돌릴 수 있습니다.</small></span><button onClick={undoDeleteSession}><Undo2 size={14} /> 실행 취소</button></div>}
    </main>
  )
}

export default App
