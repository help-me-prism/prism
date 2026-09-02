import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  BookOpen, Bot, Check, ChevronDown, ChevronUp, Circle, FileText, FolderOpen, Image,
  MessageSquareText, Plus, RefreshCw, RotateCcw, SendHorizontal, Settings2, Sigma, Table2,
  Sparkles, Square, StickyNote, TextQuote, Trash2, Undo2, X,
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

const referencePattern = /\[?@((?:문장|수식|표|피겨|페이지)\d+(?:-[A-Za-z0-9]+)?)\]?/g

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

function normalizeMathDelimiters(value: string) {
  return value.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (index % 2) return part
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_token, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
      .replace(/\\\(([^\n]*?)\\\)/g, (_token, math: string) => `$${math.trim()}$`)
  }).join('')
}

function MessageContent({ text, anchors, onNavigate }: { text: string; anchors?: ContextAnchor[]; onNavigate?: (anchor: ContextAnchor) => void }) {
  if (!text) return null
  const anchorList = anchors ?? []; const byLabel = new Map(anchorList.map((anchor, index) => [anchor.label, { anchor, index }]))
  const placed = anchorList.map((anchor, index) => ({ anchor, index })).filter(({ anchor }) => typeof anchor.textOffset === 'number').sort((a, b) => (b.anchor.textOffset ?? 0) - (a.anchor.textOffset ?? 0) || b.index - a.index)
  const withPlacementMarkers = placed.reduce((value, { anchor, index }) => {
    const offset = Math.max(0, Math.min(value.length, anchor.textOffset ?? 0))
    return `${value.slice(0, offset)}\uE000${index}\uE001${value.slice(offset)}`
  }, text)
  const markdown = normalizeMathDelimiters(withPlacementMarkers.replace(referencePattern, (token, label: string) => {
    const match = byLabel.get(label)
    return match ? `[@${label}](#prism-anchor-${match.index})` : token
  }).replace(/\uE000(\d+)\uE001/g, (_token, index: string) => `[@${anchorList[Number(index)]?.label}](#prism-anchor-${index})`))
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
    a: ({ href, children }) => {
      const index = href?.match(/^#prism-anchor-(\d+)$/)?.[1]
      const anchor = index === undefined ? undefined : anchorList[Number(index)]
      return anchor ? <AnchorChip anchor={anchor} onNavigate={onNavigate} /> : <a href={href} target="_blank" rel="noreferrer">{children}</a>
    },
  }}>{markdown}</ReactMarkdown>
}

function AnchorChip({ anchor, onRemove, onNavigate }: { anchor: ContextAnchor; onRemove?: () => void; onNavigate?: (anchor: ContextAnchor) => void }) {
  const Icon = anchor.type === 'equation' ? Sigma : anchor.type === 'table' ? Table2 : anchor.type === 'figure' ? Image : anchor.type === 'page' ? FileText : TextQuote
  const content = <><span className={`anchor-symbol type-${anchor.type}`}><Icon size={10} /></span><span>{anchor.label}</span><small>{anchor.paperId}</small>{onRemove && <X size={11} />}<span className={`anchor-popover ${anchor.preview ? 'image' : ''}`}>{anchor.preview ? <img src={anchor.preview} alt={`${anchor.label} 미리보기`} /> : <><strong>{anchor.paperTitle}</strong>{anchor.source.slice(0, 500)}</>}</span></>
  return onRemove
    ? <button type="button" className="anchor-token" title={anchor.source} onClick={onRemove}>{content}</button>
    : <button type="button" className="anchor-token" title="논문의 해당 위치로 이동" onClick={() => onNavigate?.(anchor)}>{content}</button>
}

function withoutReferences(text: string) { return text.replace(referencePattern, ' ').replace(/\s{2,}/g, ' ').trim() }

function placementKey(anchor: ContextAnchor) { return anchor.placementId ?? `${anchor.paperId}-${anchor.anchorId}` }

function textWithPlacedReferences(text: string, anchors: ContextAnchor[]) {
  return anchors.map((anchor, index) => ({ anchor, index })).filter(({ anchor }) => typeof anchor.textOffset === 'number').sort((a, b) => (b.anchor.textOffset ?? 0) - (a.anchor.textOffset ?? 0) || b.index - a.index).reduce((value, { anchor }) => {
    const offset = Math.max(0, Math.min(text.length, anchor.textOffset ?? 0))
    return `${value.slice(0, offset)}[@${anchor.label}]${value.slice(offset)}`
  }, text)
}

function InlineComposer({ text, anchors, disabled, focusPlacementId, onChange, onCaretChange, onKeyDown }: {
  text: string; anchors: ContextAnchor[]; disabled: boolean; focusPlacementId?: string
  onChange: (text: string, anchors: ContextAnchor[]) => void; onCaretChange: (offset: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastFocusedPlacementRef = useRef<string | undefined>(undefined)
  const composingRef = useRef(false)
  function editorSnapshot() {
    const root = editorRef.current; if (!root) return { text: '', anchors: [] as ContextAnchor[] }
    const byPlacement = new Map(anchors.map((anchor) => [placementKey(anchor), anchor])); let value = ''; const placed: ContextAnchor[] = []
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { value += node.textContent ?? ''; return }
      if (!(node instanceof HTMLElement)) return
      const placementId = node.dataset.placementId
      if (placementId) { const anchor = byPlacement.get(placementId); if (anchor) placed.push({ ...anchor, placementId, textOffset: value.length }); return }
      if (node.tagName === 'BR') { value += '\n'; return }
      const startsBlock = node !== root && node.tagName === 'DIV' && value.length > 0 && !value.endsWith('\n')
      if (startsBlock) value += '\n'
      node.childNodes.forEach(walk)
    }
    root.childNodes.forEach(walk)
    return { text: value.replace(/\n{3,}/g, '\n\n'), anchors: placed }
  }

  function readEditor() { const snapshot = editorSnapshot(); onChange(snapshot.text, snapshot.anchors) }

  function caretOffset() {
    const root = editorRef.current; const selection = window.getSelection()
    if (!root || !selection?.rangeCount || !selection.focusNode || !root.contains(selection.focusNode)) return
    const range = document.createRange(); range.selectNodeContents(root); range.setEnd(selection.focusNode, selection.focusOffset)
    const wrapper = document.createElement('div'); wrapper.append(range.cloneContents()); wrapper.querySelectorAll('[data-placement-id]').forEach((node) => node.remove()); wrapper.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
    onCaretChange((wrapper.textContent ?? '').length)
  }

  useEffect(() => {
    const root = editorRef.current; if (!root) return
    if (composingRef.current) return
    const snapshot = editorSnapshot(); const sameAnchors = snapshot.anchors.length === anchors.length && snapshot.anchors.every((anchor, index) => placementKey(anchor) === placementKey(anchors[index]) && anchor.textOffset === anchors[index].textOffset)
    if (snapshot.text !== text || !sameAnchors) {
      root.replaceChildren(); const ordered = anchors.map((anchor, index) => ({ anchor, index })).sort((a, b) => (a.anchor.textOffset ?? 0) - (b.anchor.textOffset ?? 0) || a.index - b.index); let cursor = 0
      for (const { anchor } of ordered) {
        const offset = Math.max(cursor, Math.min(text.length, anchor.textOffset ?? 0)); if (offset > cursor) root.append(document.createTextNode(text.slice(cursor, offset)))
        const wrapper = document.createElement('span'); wrapper.className = 'composer-anchor'; wrapper.dataset.placementId = placementKey(anchor); wrapper.contentEditable = 'false'
        const chip = document.createElement('span'); chip.className = 'anchor-token composer-anchor-label'; chip.title = anchor.source
        const symbol = document.createElement('span'); symbol.className = `anchor-symbol type-${anchor.type}`; symbol.textContent = anchor.type === 'equation' ? '∑' : anchor.type === 'table' ? '▦' : anchor.type === 'figure' ? '▧' : anchor.type === 'page' ? '▤' : '¶'
        const label = document.createElement('span'); label.textContent = anchor.label; const paper = document.createElement('small'); paper.textContent = anchor.paperId
        const close = document.createElement('button'); close.type = 'button'; close.className = 'composer-anchor-remove'; close.textContent = '×'; close.title = `${anchor.label} 태그 삭제`; close.setAttribute('aria-label', `${anchor.label} 태그 삭제`)
        chip.append(symbol, label, paper); close.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); wrapper.remove(); readEditor(); onCaretChange(offset) }); wrapper.append(chip, close); root.append(wrapper); cursor = offset
      }
      if (cursor < text.length) root.append(document.createTextNode(text.slice(cursor)))
    }
    if (focusPlacementId && lastFocusedPlacementRef.current !== focusPlacementId) {
      const token = root.querySelector(`[data-placement-id="${CSS.escape(focusPlacementId)}"]`); if (!token) return
      const range = document.createRange(); range.setStartAfter(token); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); root.focus()
      const anchor = anchors.find((item) => placementKey(item) === focusPlacementId); lastFocusedPlacementRef.current = focusPlacementId; onCaretChange(anchor?.textOffset ?? text.length)
    }
  }, [text, anchors, focusPlacementId, onChange, onCaretChange])

  return <div ref={editorRef} className="composer-editor" contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-label="AI에게 질문" aria-multiline="true" aria-autocomplete="list" data-placeholder="논문에 대해 질문하세요…" onInput={(event) => { if (!composingRef.current && !event.nativeEvent.isComposing) readEditor(); caretOffset() }} onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false; readEditor(); caretOffset() }} onKeyUp={caretOffset} onMouseUp={caretOffset} onFocus={caretOffset} onPaste={(event) => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')) }} onKeyDown={onKeyDown} />
}

function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [trashedSessions, setTrashedSessions] = useState<ChatSession[]>([])
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
  const [trashOpen, setTrashOpen] = useState(false)
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(0)
  const [composerCaret, setComposerCaret] = useState(0)
  const [focusPlacementId, setFocusPlacementId] = useState<string>()
  const [deletedSession, setDeletedSession] = useState<{ session: ChatSession; index: number }>()
  const [followChat, setFollowChat] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const activeProvider = providers.find((provider) => provider.id === activeSession?.provider)
  const isRunning = activeSession ? runningIds.includes(activeSession.id) : false
  const selectedPapers = workspaceState.library.filter((paper) => contextPaperIds.includes(paper.arxivId))
  const tagMatch = input.slice(0, composerCaret).match(/(?:^|\s)@([^\s@]*)$/)
  const tagQuery = tagMatch?.[1]
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
      const restoredTrash = usable.filter((session) => session.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
      const active = usable.filter((session) => !session.deletedAt)
      const initial = active.length ? active : [makeSession('codex', providerList.find((item) => item.id === 'codex')?.models[0]?.id)]
      setSessions(initial)
      setTrashedSessions(restoredTrash)
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
      const compactSessions = [...sessions, ...trashedSessions].map((session) => ({ ...session, messages: session.messages.map((message) => ({ ...message, anchors: message.anchors?.map(({ preview: _preview, ...anchor }) => anchor) })) }))
      window.prism.saveSessions(compactSessions).catch((reason) => {
        console.error('Session save failed:', reason)
        if (activeSessionId) setErrors((current) => ({ ...current, [activeSessionId]: `대화를 자동 저장하지 못했습니다: ${String(reason)}` }))
      })
    }, 350)
    return () => { window.clearTimeout(timeout) }
  }, [sessions, trashedSessions, hydrated, activeSessionId])

  useEffect(() => {
    if (followChat) endRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [activeSession?.messages, isRunning, followChat])
  useEffect(() => {
    setFollowChat(true)
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'auto' }))
  }, [activeSessionId])

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
    setComposerCaret(0); setFocusPlacementId(undefined)
  }

  function deleteSession(sessionId: string) {
    if (runningIds.includes(sessionId) || sessions.length <= 1) return
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === sessionId)
      const removed = current[index]
      if (!removed) return current
      const remaining = current.filter((session) => session.id !== sessionId)
      const trashed = { ...removed, deletedAt: Date.now() }
      setTrashedSessions((items) => [trashed, ...items.filter((item) => item.id !== sessionId)].slice(0, 100))
      setDeletedSession({ session: trashed, index })
      if (activeSessionId === sessionId) setActiveSessionId(remaining[Math.min(index, remaining.length - 1)].id)
      return remaining
    })
  }

  function undoDeleteSession() {
    if (!deletedSession) return
    setSessions((current) => {
      if (current.some((session) => session.id === deletedSession.session.id)) return current
      const next = [...current]
      next.splice(Math.min(deletedSession.index, next.length), 0, { ...deletedSession.session, deletedAt: undefined })
      return next
    })
    setTrashedSessions((current) => current.filter((session) => session.id !== deletedSession.session.id))
    setActiveSessionId(deletedSession.session.id)
    setDeletedSession(undefined)
  }

  function restoreSession(sessionId: string) {
    const restored = trashedSessions.find((session) => session.id === sessionId)
    if (!restored) return
    setTrashedSessions((current) => current.filter((session) => session.id !== sessionId))
    setSessions((current) => [{ ...restored, deletedAt: undefined, updatedAt: Date.now() }, ...current])
    setActiveSessionId(sessionId); setTrashOpen(false); setDeletedSession(undefined)
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
    const leadingWhitespace = text.length - text.trimStart().length
    const rawPrompt = text.trim()
    const typedAnchors = referencedAnchors(rawPrompt, anchorCatalog)
    const selectedAnchors = [...contextAnchors.map((anchor) => ({ ...anchor, textOffset: typeof anchor.textOffset === 'number' ? Math.max(0, anchor.textOffset - leadingWhitespace) : undefined })), ...typedAnchors]
    const prompt = rawPrompt
    if (!prompt || !activeSession || isRunning || !activeProvider?.available) return
    const sessionId = activeSession.id
    const assistantId = uniqueId('assistant')
    const paperContext = selectedPapers.length ? `<paper_context>\n${selectedPapers.map((paper) => `<paper id="${paper.arxivId}" title=${JSON.stringify(paper.title)} />`).join('\n')}\n</paper_context>` : ''
    const inlinePrompt = textWithPlacedReferences(prompt, selectedAnchors)
    const assistantAnchors = selectedAnchors.map(({ placementId: _placementId, textOffset: _textOffset, ...anchor }) => anchor).filter((anchor, index, all) => all.findIndex((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId) === index)
    const anchorContext = selectedAnchors.length ? `<prism_context>\n${selectedAnchors.map((anchor, occurrence) => { const offset = anchor.textOffset ?? 0; return `<anchor ref="@${anchor.label}" occurrence="${occurrence + 1}" text_offset="${offset}" before=${JSON.stringify(prompt.slice(Math.max(0, offset - 40), offset))} after=${JSON.stringify(prompt.slice(offset, offset + 40))} type="${anchor.type}" paper="${anchor.paperId}" stable_id="${anchor.anchorId}" page="${anchor.page}">\n${anchor.source.slice(0, 4000)}\n</anchor>` }).join('\n')}\n</prism_context>\nThe [@...] references occur at the exact positions shown in the user request. Preserve their order and interpret each reference using its surrounding sentence.` : ''
    const promptWithContext = [inlinePrompt, paperContext, anchorContext].filter(Boolean).join('\n\n')
    const now = Date.now()
    setFollowChat(true)
    setInput('')
    setComposerCaret(0); setFocusPlacementId(undefined)
    setErrors((current) => { const next = { ...current }; delete next[sessionId]; return next })
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.messages.length ? session.title : prompt.replace(/\s+/g, ' ').slice(0, 34),
      updatedAt: now,
      messages: [
        ...session.messages,
        { id: uniqueId('user'), role: 'user', text: prompt, createdAt: now, anchors: selectedAnchors },
        { id: assistantId, role: 'assistant', text: '', createdAt: now + 1, anchors: assistantAnchors },
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
      setInput(prompt); setComposerCaret(prompt.length)
      setRunningIds((current) => current.filter((id) => id !== sessionId))
      setErrors((current) => ({ ...current, [sessionId]: reason instanceof Error ? reason.message : String(reason) }))
      updateSession(sessionId, (session) => ({ ...session, messages: session.messages.filter((message) => message.id !== assistantId) }))
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void send() }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (tagSuggestions.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setTagSuggestionIndex((index) => (index + 1) % tagSuggestions.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setTagSuggestionIndex((index) => (index - 1 + tagSuggestions.length) % tagSuggestions.length); return }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); chooseTag(tagSuggestions[tagSuggestionIndex] ?? tagSuggestions[0]); return }
      if (event.key === 'Escape') { event.preventDefault(); removeTagQuery(); return }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); document.execCommand('insertText', false, '\n') }
  }

  function consumeReferences(value: string, includeTrailingToken = false) {
    const byLabel = new Map(anchorCatalog.map((anchor) => [anchor.label, anchor])); const matches = [...value.matchAll(referencePattern)].filter((match) => byLabel.has(match[1]) && (includeTrailingToken || (match.index ?? 0) + match[0].length < value.length))
    if (!matches.length) { setInput(value); return }
    let cleaned = ''; let sourceCursor = 0; let removed = 0; const additions: ContextAnchor[] = []
    for (const match of matches) {
      const start = match.index ?? 0; const end = start + match[0].length; cleaned += value.slice(sourceCursor, start)
      const anchor = byLabel.get(match[1]); if (anchor) additions.push({ ...anchor, placementId: uniqueId('placement'), textOffset: start - removed })
      removed += end - start; sourceCursor = end
    }
    cleaned += value.slice(sourceCursor)
    setContextAnchors((current) => [
      ...current.map((anchor) => ({ ...anchor, textOffset: Math.max(0, (anchor.textOffset ?? 0) - matches.filter((match) => (match.index ?? 0) < (anchor.textOffset ?? 0)).reduce((sum, match) => sum + match[0].length, 0)) })),
      ...additions,
    ])
    setInput(cleaned); setComposerCaret(Math.max(0, composerCaret - removed)); setFocusPlacementId(additions.at(-1)?.placementId)
  }

  function chooseTag(anchor: ContextAnchor) {
    const before = input.slice(0, composerCaret); const match = before.match(/(?:^|\s)@[^\s@]*$/); const tokenStart = match ? composerCaret - match[0].length + (match[0].startsWith(' ') ? 1 : 0) : composerCaret
    const tokenLength = composerCaret - tokenStart; const placementId = uniqueId('placement')
    setInput(`${input.slice(0, tokenStart)}${input.slice(composerCaret)}`)
    setContextAnchors((current) => [...current.map((item) => ({ ...item, textOffset: (item.textOffset ?? 0) > tokenStart ? Math.max(tokenStart, (item.textOffset ?? 0) - tokenLength) : item.textOffset })), { ...anchor, placementId, textOffset: tokenStart }])
    setComposerCaret(tokenStart); setFocusPlacementId(placementId)
  }

  function removeTagQuery() {
    const before = input.slice(0, composerCaret); const match = before.match(/(?:^|\s)@[^\s@]*$/); if (!match) return
    const start = composerCaret - match[0].length + (match[0].startsWith(' ') ? 1 : 0); setInput(`${input.slice(0, start)}${input.slice(composerCaret)}`); setComposerCaret(start)
  }

  function insertAnchor(anchor: ContextAnchor) {
    const placementId = uniqueId('placement'); const offset = Math.max(0, Math.min(input.length, composerCaret))
    setContextAnchors((current) => [...current, { ...anchor, placementId, textOffset: offset }]); setFocusPlacementId(placementId)
  }

  function runWorkspaceCommand(type: WorkspaceCommand['type'], paperId?: string, anchor?: ContextAnchor) { setWorkspaceCommand({ id: Date.now() + Math.random(), type, paperId, anchor }) }
  function navigateAnchor(anchor: ContextAnchor) { runWorkspaceCommand('navigate-anchor', anchor.paperId, anchor) }

  useEffect(() => window.prism.onOpenEvidenceAnchor((anchor) => navigateAnchor({ ...anchor, paperTitle: '', source: '' })), [])

  useEffect(() => {
    if (!input.includes('@')) return
    const timeout = window.setTimeout(() => consumeReferences(input, true), 450)
    return () => window.clearTimeout(timeout)
  }, [input, anchorCatalog])

  if (!activeSession) return <main className="app-shell loading-app">Prism을 준비하고 있어요…</main>

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand"><img className="brand-mark" src="./icon.png" alt="" /><span>Prism</span></div>
        <div className="document-title"><FileText size={14} /><span>{activeSession.title}</span></div>
      </header>

      <div className="workspace">
        {sidebarOpen && (
          <aside className="sidebar">
            <button className="repository-card sidebar-repository" onClick={() => runWorkspaceCommand('choose-folder')} title={workspaceState.libraryPath ?? '라이브러리 폴더를 선택하세요'}><FolderOpen size={16} /><span><small>CURRENT LIBRARY</small><strong>{workspaceState.libraryPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? '폴더 선택'}</strong></span></button>
            <div className="sidebar-actions">
              <button className="new-paper" onClick={() => runWorkspaceCommand('search')}><Plus size={16} /> 논문 열기</button>
            </div>
            <nav>
              <p className="nav-label">WORKSPACE</p>
              <button className="nav-item active"><BookOpen size={17} /> Reader <span>{workspaceState.openPaperIds.length}</span></button>
              <button className="nav-item" aria-label="Notes 열기" onClick={() => void window.prism.openNotes()}><StickyNote size={17} /> Notes <span>{workspaceState.library.length}</span></button>
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
              <div className="trash-heading"><button onClick={() => setTrashOpen((value) => !value)} aria-expanded={trashOpen}><Trash2 size={13} /><span>휴지통</span><small>{trashedSessions.length}</small>{trashOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button></div>
              {trashOpen && <div className="trash-list">{trashedSessions.length ? trashedSessions.map((session) => <div key={session.id} className="trash-item"><span><strong>{session.title}</strong><small>{new Date(session.deletedAt ?? session.updatedAt).toLocaleDateString()}</small></span><button onClick={() => restoreSession(session.id)} title="대화 복원" aria-label={`${session.title} 대화 복원`}><RotateCcw size={12} /></button></div>) : <small>삭제된 대화가 없습니다.</small>}</div>}
            </nav>
            <div className="sidebar-footer">
              <div className="provider-badge"><span className={`status-dot ${activeProvider?.available ? 'online' : ''}`} /><div><strong>{activeProvider?.name ?? activeSession.provider}</strong><small>{activeProvider?.status ?? '확인 중…'}</small></div></div>
              <button className="icon-button" aria-label="설정" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
            </div>
          </aside>
        )}

        <PaperWorkspace providers={providers} sidebarOpen={sidebarOpen} command={workspaceCommand} onWorkspaceState={setWorkspaceState} onToggleSidebar={() => setSidebarOpen((value) => !value)} onAnchorCatalog={setAnchorCatalog} onTagAnchor={insertAnchor} />

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

          <div className="messages" ref={messagesRef} onScroll={(event) => { const pane = event.currentTarget; setFollowChat(pane.scrollHeight - pane.scrollTop - pane.clientHeight < 56) }}>
            {activeSession.messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="welcome-orbit"><Bot size={27} /></div><h2>무엇이 궁금한가요?</h2>
                <p>{activeProvider?.name ?? 'AI'} · {activeProvider?.models.find((model) => model.id === activeSession.model)?.name ?? activeSession.model}<br />세션은 이 기기에 자동 저장됩니다.</p>
                <div className="suggestions">{suggestions.map((suggestion) => <button key={suggestion} disabled={!activeProvider?.available} onClick={() => void send(suggestion)}>{suggestion}<SendHorizontal size={13} /></button>)}</div>
              </div>
            ) : activeSession.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-label">{message.role === 'user' ? 'You' : activeProvider?.name ?? 'Prism'}</div>
                <div className={`message-body ${message.role === 'assistant' && isRunning && !message.text ? 'streaming-empty' : ''}`}>
                  {message.role === 'user' && message.anchors?.length && !message.anchors.some((anchor) => typeof anchor.textOffset === 'number') ? <span className="inline-message-anchors">{message.anchors.map((anchor) => <AnchorChip key={placementKey(anchor)} anchor={anchor} onNavigate={navigateAnchor} />)}</span> : null}
                  {message.text ? <MessageContent text={message.role === 'user' && !message.anchors?.some((anchor) => typeof anchor.textOffset === 'number') ? withoutReferences(message.text) : message.text} anchors={message.anchors} onNavigate={navigateAnchor} /> : message.role === 'assistant' ? '●' : ''}{message.role === 'assistant' && isRunning && message === activeSession.messages.at(-1) && <span className="stream-caret" />}
                </div>
              </article>
            ))}
            {errors[activeSession.id] && <div className="error-banner"><Circle size={10} fill="currentColor" /><span>{errors[activeSession.id]}</span><button onClick={() => setErrors((current) => ({ ...current, [activeSession.id]: '' }))}><X size={14} /></button></div>}
            <div ref={endRef} />
            {!followChat && <button className="jump-latest" onClick={() => { setFollowChat(true); endRef.current?.scrollIntoView({ behavior: 'smooth' }) }}><ChevronDown size={13} /> 최신 답변으로</button>}
          </div>

          <div className="composer-wrap">
            {!activeProvider?.available && <div className="cli-warning">{activeProvider?.name ?? activeSession.provider} CLI를 설치하고 로그인해 주세요.</div>}
            <form className="composer" onSubmit={onSubmit}>
              {tagSuggestions.length > 0 && <div className="tag-suggestions" role="listbox" aria-label="논문 참조 추천">{tagSuggestions.map((anchor, index) => <button type="button" role="option" aria-selected={index === tagSuggestionIndex} className={index === tagSuggestionIndex ? 'active' : ''} key={`${anchor.paperId}-${anchor.anchorId}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setTagSuggestionIndex(index)} onClick={() => chooseTag(anchor)}><span>@</span><div><strong>{anchor.label}</strong><small>{anchor.paperId} · p.{anchor.page}</small></div></button>)}</div>}
              <InlineComposer text={input} anchors={contextAnchors} disabled={!activeProvider?.available} focusPlacementId={focusPlacementId} onCaretChange={setComposerCaret} onKeyDown={onKeyDown} onChange={(value, anchors) => { setInput(value); setContextAnchors(anchors); setFocusPlacementId(undefined) }} />
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
      {deletedSession && <div className="undo-toast" role="status"><span><strong>대화를 휴지통으로 옮겼습니다.</strong><small>휴지통에서도 언제든 복원할 수 있습니다.</small></span><button onClick={undoDeleteSession}><Undo2 size={14} /> 실행 취소</button></div>}
    </main>
  )
}

export default App
