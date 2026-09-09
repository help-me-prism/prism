import { useEffect, useMemo, useRef, useState } from 'react'
import { copySavedEvidence } from './noteEvidenceCopy'
import { wikiTargetResolver } from '../electron/wikiTargets'
import { scientificPreviewText } from '../electron/scientificSource'
import { AlertTriangle, BookOpen, ChevronDown, Check, ExternalLink, Link2, MoreHorizontal, PenLine, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import MarkdownEditor, { type MarkdownEditorHandle, type MarkdownSlashAction, type WikiLinkOption } from './MarkdownEditor'
import NoteHistoryDialog from './NoteHistoryDialog'
import { embeddedEvidence, evidenceMarkdown, evidenceTypeLabel, removeEvidence, replaceEvidence, type EmbeddedEvidence } from './evidence'
import {
  autoSectionLabels, claimOriginLabels, fileName, nodePath, primaryRelationTypes, readingStatusLabels,
  relationLabels, relationTypesFor, scopeConflict, statusLabels, typeLabels,
} from './knowledgeModel'
import { insertMineSection, mineHeadings, minePrompts, noteMine, type MineSection } from '../electron/noteContract'

type Picker =
  | { kind: 'link'; query: string }
  | { kind: 'relation'; query: string; type: KnowledgeRelationType }
  | { kind: 'evidence'; query: string; relink?: EmbeddedEvidence }
  | { kind: 'evidence-claim'; query: string; evidence: EmbeddedEvidence; type: 'supports' | 'contradicts' | 'extends' }
  | { kind: 'copy-evidence'; query: string; evidence: EmbeddedEvidence }
  | { kind: 'answer'; query: string }

/**
 * One document view for every node type. Papers and knowledge notes are the same kind of thing now,
 * so the editor, properties, and evidence all live here instead of behind a modal.
 */
export default function NoteDocument({ node, nodes, anchors, relations, templates, onReloadNodes, onReloadContext, onOpenNode, onNotify, onOpenCuration, autoUnread, onAutoUnreadChange, contextKey }: {
  node: KnowledgeNodeRecord
  nodes: KnowledgeNodeRecord[]
  anchors: EvidenceAnchor[]
  relations: KnowledgeRelationView[]
  templates: TemplateRecord[]
  onReloadNodes: () => Promise<void> | void
  onReloadContext: () => Promise<void> | void
  onOpenNode: (id: string) => void
  onNotify: (message: string, tone?: 'info' | 'error') => void
  autoUnread?: { at: number; sections: string[] }
  onAutoUnreadChange: () => void | Promise<void>
  onOpenCuration: () => void; contextKey: string }) {
  const [snapshot, setSnapshot] = useState<NoteSnapshot>()
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(true)
  const [conflict, setConflict] = useState<NoteSnapshot>()
  const [picker, setPicker] = useState<Picker>()
  const [creatingEvidenceClaim, setCreatingEvidenceClaim] = useState(false)
  const evidenceClaimBusy = useRef(false)
  const [createdEvidenceClaim, setCreatedEvidenceClaim] = useState<{ node: KnowledgeNodeRecord; sourceId: string; vaultId: string; evidenceKey: string; linked: boolean; error?: string }>()
  const createdEvidenceClaims = useRef(new Map<string, KnowledgeNodeRecord>())
  const claimOwner = useRef({ id: node.id, token: {} })
  if (claimOwner.current.id !== node.id) claimOwner.current = { id: node.id, token: {} }
  useEffect(() => () => { claimOwner.current = { id: '', token: {} } }, [])
  useEffect(() => { setCreatingEvidenceClaim(false) }, [node.id])
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteReady, setDeleteReady] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  // Properties are metadata about the note, not the note. They start closed so the writing is the first thing on screen.
  const [propsOpen, setPropsOpen] = useState(() => window.localStorage.getItem('prism.notes.propsOpen') === 'on')
  const [pendingContradiction, setPendingContradiction] = useState<{ message: string; run: () => Promise<void> }>()
  const [suggesting, setSuggesting] = useState(false)
  const [digesting, setDigesting] = useState(false)
  const digestedRef = useRef<string | undefined>(undefined)
  const vaultIdRef = useRef<string | undefined>(undefined)
  const contentRef = useRef(''); const dirtyRef = useRef(false); const revisionRef = useRef<string | undefined>(undefined); const nodeIdRef = useRef(node.id); const stubScanRef = useRef('')
  const editorRef = useRef<MarkdownEditorHandle>(null)

  const linkedEvidence = useMemo(() => embeddedEvidence(content), [content])
  const approved = relations.filter((item) => item.reviewStatus === 'approved' && item.origin !== 'link')
  const linked = relations.filter((item) => item.reviewStatus === 'approved' && item.origin === 'link')
  const pending = relations.filter((item) => item.reviewStatus === 'pending')
  const relationGroups = useMemo(() => {
    const groups = new Map<string, KnowledgeRelationView[]>()
    for (const item of approved) {
      const key = `${item.direction}:${item.type}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
  }, [approved])
  const wikiLinks = useMemo<WikiLinkOption[]>(() => nodes.filter((item) => item.id !== node.id).map((item) => ({
    id: item.id, label: item.title, target: nodePath(item), aliases: item.aliases, description: typeLabels[item.nodeType],
    searchText: `${item.nodeType} ${item.preview} ${(item.aliases ?? []).join(' ')}`, preview: item.preview, evidenceCount: item.evidenceCount,
  })), [nodes, node.id])
  const evidenceLinks = useMemo(() => anchors
    .filter((anchor) => !linkedEvidence.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId))
    .map((anchor) => ({ id: `${anchor.paperId}-${anchor.anchorId}`, label: anchor.label, description: `${evidenceTypeLabel(anchor.type)} · ${anchor.paperTitle} · p.${anchor.page}`, searchText: `${anchor.paperTitle} ${anchor.source}`, markdown: evidenceMarkdown(anchor) })), [anchors, linkedEvidence])
  const nodeTemplates = useMemo(() => templates.filter((item) => item.nodeType === node.nodeType), [templates, node.nodeType])
  const mineSections = useMemo(() => noteMine[node.nodeType] ?? [], [node.nodeType])

  useEffect(() => { nodeIdRef.current = node.id }, [node.id])
  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => {
    let disposed = false
    setLoadError(''); setSnapshot(undefined); setContent(''); setSaved(true); setConflict(undefined); setPicker(undefined); setMenuOpen(false); setHistoryOpen(false); setDeleteReady(false)
    dirtyRef.current = false
    // Finish the initial deterministic sections before exposing an editable snapshot.
    // Otherwise the first keystroke races our own background write and looks external.
    ;(async () => {
      const openingKey = `${node.id}:${node.nodeType === 'paper' ? '' : contextKey}`
      if (digestedRef.current !== openingKey) {
        await window.prism.refreshPaperDigest(node.id, { useModel: false }).catch(() => undefined)
        if (disposed) return
        digestedRef.current = openingKey
      }
      return window.prism.readKnowledgeNode(node.id, vaultIdRef.current)
    })().then((next) => {
      if (disposed || !next) return
      vaultIdRef.current = next.vaultId; revisionRef.current = next.revision; contentRef.current = next.content; stubScanRef.current = next.content
      setSnapshot(next); setContent(next.content)
    }).catch((reason) => { if (!disposed) { setLoadError(String(reason)); if (loadAttempt === 0) onNotify(String(reason), 'error') } })
    return () => { disposed = true }
  }, [node.id, loadAttempt])
  /**
   * Opening a note is one read, and a read that never answered left the note on "불러오는 중" for good — the
   * only way out was clicking another note and back. It happens when the read lands while the vault is busy
   * being written to, which is exactly when a note is most likely to be opened. Asking again costs one file
   * read; asking forever would only turn a missing file into a stream of complaints, so it asks three times.
   */
  useEffect(() => {
    if (snapshot || loadAttempt >= 3) return
    const retry = window.setTimeout(() => setLoadAttempt((value) => value + 1), 2500)
    return () => window.clearTimeout(retry)
  }, [snapshot, node.id, loadAttempt])
  // A new note starts its own count, without provoking a second read when the count is already clean.
  useEffect(() => { setLoadAttempt((value) => value === 0 ? value : 0) }, [node.id])

  async function save(force = false) {
    const id = nodeIdRef.current
    if (!dirtyRef.current || !revisionRef.current) return true
    if (conflict && !force) return false
    const value = contentRef.current
    try {
      const result = await window.prism.saveKnowledgeNode(id, { content: value, expectedRevision: revisionRef.current, force, vaultId: vaultIdRef.current })
      if (!result.saved) { setConflict(result.conflict); setSaved(false); return false }
      revisionRef.current = result.snapshot.revision
      setConflict(undefined); setSnapshot(result.snapshot)
      if (nodeIdRef.current === id && contentRef.current === value) { dirtyRef.current = false; setSaved(true) }
      return true
    } catch (reason) { onNotify(String(reason), 'error'); return false }
  }

  async function restoreHistory(value: string) {
    const id = node.id
    if (!(await save())) throw new Error('현재 편집 내용의 저장 충돌을 먼저 해결해 주세요.')
    if (nodeIdRef.current !== id || !revisionRef.current) throw new Error('노트를 다시 열어 주세요.')
    const result = await window.prism.saveKnowledgeNode(id, { content: value, expectedRevision: revisionRef.current, vaultId: vaultIdRef.current })
    if (nodeIdRef.current !== id) return
    const next = result.saved ? result.snapshot : result.conflict
    revisionRef.current = next.revision; contentRef.current = next.content; dirtyRef.current = false
    setSnapshot(next); setContent(next.content); setSaved(true); setConflict(undefined)
    if (!result.saved) throw new Error('외부 변경이 발견되어 복원하지 않았습니다. 현재 내용을 갱신했으니 확인 후 다시 선택해 주세요.')
    await onReloadNodes(); await onReloadContext()
    onNotify('선택한 버전으로 복원했습니다. 복원 전 내용도 저장 이력에 남아 있습니다.')
  }

  /** Links are free; the note behind one is written only once. Runs after editing settles, never on every keystroke. */
  async function settle() {
    const id = nodeIdRef.current
    if (!(await save())) return
    if (stubScanRef.current === contentRef.current) return
    stubScanRef.current = contentRef.current
    try {
      const { stubs, added } = await window.prism.syncNoteLinks(id)
      if (stubs.length) onNotify(`[[링크]]에서 새 개념 ${stubs.length}개를 만들었습니다: ${stubs.join(', ')}`)
      if (stubs.length) await onReloadNodes()
      if (stubs.length || added) await onReloadContext(); else await onReloadContext()
    } catch { /* the note may have been deleted or renamed meanwhile */ }
  }

  useEffect(() => {
    if (saved || conflict || !snapshot) return
    const quick = window.setTimeout(() => void save(), 400)
    return () => window.clearTimeout(quick)
  }, [content, saved, conflict, snapshot])
  // The link scan is deliberately independent of the save state: saving clears `saved`, and the scan
  // still has to run once typing stops.
  useEffect(() => {
    if (!snapshot || conflict) return
    const later = window.setTimeout(() => void settle(), 2200)
    return () => window.clearTimeout(later)
  }, [content, snapshot, conflict])
  useEffect(() => {
    const flush = () => { void save() }
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); void save() }
  }, [node.id])
  /**
   * Obsidian and the Reader write the same files, so an open note has to follow the disk. It used to ask
   * fifty times a minute, and asking cost a read of the whole library each time; now the main process names
   * the files that moved and only a document that is one of them re-reads.
   *
   * The slow check stays, at a fifteenth of the old rate. An event is a single shot: one that arrives while
   * this note is still loading, or a beat before the write it announces is readable, leaves the document
   * permanently behind with nothing left to correct it. Polling was what made a missed signal self-heal, and
   * that is worth one cached read every few seconds.
   */
  useEffect(() => {
    if (!snapshot) return
    let disposed = false; let checking = false
    const check = async () => {
      if (checking || disposed) return
      checking = true
      try {
        const next = await window.prism.readKnowledgeNode(node.id, vaultIdRef.current)
        if (disposed || next.revision === revisionRef.current) return
        if (dirtyRef.current) setConflict(next)
        else {
          vaultIdRef.current = next.vaultId; revisionRef.current = next.revision; contentRef.current = next.content
          setSnapshot(next); setContent(next.content); setSaved(true)
          void onReloadContext()
        }
      } catch { /* the note may have been renamed or deleted elsewhere */ }
      finally { checking = false }
    }
    const stopWatching = window.prism.onVaultChanged(({ paths }) => { if (paths.some((item) => item.toLowerCase() === node.relativePath.toLowerCase())) void check() })
    const timer = window.setInterval(() => void check(), 4000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    // The tree reloads for its own reasons and carries a revision with it; following that as well means the
    // document does not depend on any one signal arriving.
    if (node.revision !== revisionRef.current) void check()
    return () => { disposed = true; stopWatching(); window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [node.id, node.relativePath, node.revision, snapshot?.revision])

  function edit(value: string) { contentRef.current = value; dirtyRef.current = true; setContent(value); setSaved(false) }
  /** Clicking a rendered evidence card jumps back to the PDF; the card itself is not editable text. */
  function bindEvidenceClicks(element: HTMLDivElement | null) {
    if (!element || element.dataset.evidenceBound) return
    element.dataset.evidenceBound = 'true'
    element.addEventListener('prism-open-evidence', (event) => {
      const anchor = (event as CustomEvent<EvidenceAnchorRef>).detail
      void window.prism.openEvidenceAnchor(anchor).catch((reason) => onNotify(String(reason), 'error'))
    })
  }

  async function updateProperty(patch: KnowledgePropertyPatch) {
    if (dirtyRef.current && !(await save())) return
    try {
      // The properties render before the file finishes loading; fetch the revision rather than dropping the edit.
      if (!revisionRef.current) revisionRef.current = (await window.prism.readKnowledgeNode(node.id, vaultIdRef.current)).revision
      const result = await window.prism.updateKnowledgeProperties(node.id, patch, revisionRef.current)
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 속성을 저장하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true)
      await onReloadNodes()
    } catch (reason) { onNotify(String(reason), 'error') }
  }

  /**
   * Keeps the mechanical part of a paper note current. The deterministic pass costs nothing and runs when the
   * note opens; the model pass is explicit because it spends the researcher's own CLI quota.
   */
  async function refreshDigest(useModel: boolean) {
    if (digesting || suggesting) return
    if (useModel && dirtyRef.current && !(await save())) return
    // Asking for a model rewrite without a model configured used to run the free pass and report "nothing to
    // update", which is true and useless. The choice is one click away in the status bar; say so.
    if (useModel) {
      const settings = await window.prism.getSettings().catch(() => undefined)
      if (!settings?.knowledgeProvider || !settings.knowledgeModel) { onNotify('아래 상태 표시줄에서 AI 정리 CLI를 고르면 모델이 요약과 정의를 다시 씁니다.'); return }
    }
    setDigesting(true)
    try {
      const result = await window.prism.refreshPaperDigest(node.id, { useModel })
      if (result.updated) {
        const next = await window.prism.readKnowledgeNode(node.id, vaultIdRef.current)
        if (nodeIdRef.current === node.id && !dirtyRef.current) {
          vaultIdRef.current = next.vaultId; revisionRef.current = next.revision; contentRef.current = next.content; stubScanRef.current = next.content
          setSnapshot(next); setContent(next.content); setSaved(true)
        }
      }
      if (result.updated) await onAutoUnreadChange()
      if (useModel) onNotify(result.updated ? `자동 정리를 갱신했습니다. 대화 ${result.chatMessages}건을 반영했습니다.` : '갱신할 내용이 없습니다.')
    } catch (reason) { if (useModel) onNotify(String(reason), 'error') }
    finally { setDigesting(false) }
  }
  // Opening a note is the moment it should already be written. A concept or claim is written out of its
  // links, so it is also rewritten whenever a link to it appears or goes away.
  const digestKey = `${node.id}:${node.nodeType === 'paper' ? '' : contextKey}`
  useEffect(() => {
    if (!snapshot || digestedRef.current === digestKey) return
    digestedRef.current = digestKey
    void refreshDigest(false)
  }, [digestKey, snapshot])

  async function runModelSuggestions() {
    if (node.nodeType !== 'paper' || suggesting || digesting) return
    if (dirtyRef.current && !(await save())) return
    const settings = await window.prism.getSettings().catch(() => undefined)
    if (!settings?.knowledgeProvider || !settings.knowledgeModel) { onNotify('아래 상태 표시줄에서 AI 정리 CLI와 모델을 고른 뒤 이 버튼을 누르세요. 이 논문의 연결 후보만 제안합니다.'); return }
    setSuggesting(true); onNotify(`${settings.knowledgeModel}이(가) 이 노트를 읽고 관계와 승격 후보를 제안하는 중입니다.`)
    try {
      const summary = await window.prism.runModelSuggestions(node.id)
      await onReloadContext()
      onNotify(`제안 완료: 관계 ${summary.relationsCreated}개, 필기 힌트 ${summary.candidates}개, 새 개념 ${summary.concepts}개가 정리 대기열에 있습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
    finally { setSuggesting(false) }
  }

  async function addRelation(target: KnowledgeNodeRecord, type: KnowledgeRelationType, confirmed = false) {
    const warning = type === 'contradicts' && !confirmed ? scopeConflict(node, target) : undefined
    if (warning) { setPendingContradiction({ message: warning, run: () => addRelation(target, type, true) }); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.createKnowledgeRelation({ sourceId: node.id, targetId: target.id, type, creator: 'user', expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 관계를 추가하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true); setPicker(undefined)
      await onReloadContext(); await onReloadNodes()
      onNotify(`${target.title}와(과) '${relationLabels[type]}' 관계를 만들었습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  /**
   * A question is answered by something else, so the `answers` relation belongs in the answering note —
   * which left the one screen where the answer is obvious, the question's own, with no way to record it.
   * Picking the answering note here writes the relation over there.
   */
  async function addAnswer(source: KnowledgeNodeRecord) {
    try {
      const other = await window.prism.readKnowledgeNode(source.id)
      const result = await window.prism.createKnowledgeRelation({ sourceId: source.id, targetId: node.id, type: 'answers', creator: 'user', expectedRevision: other.revision })
      if (!result.saved) { onNotify('답하는 노트가 외부에서 변경되어 관계를 추가하지 않았습니다.', 'error'); return }
      setPicker(undefined)
      await onReloadContext(); await onReloadNodes()
      onNotify(`'${source.title}'이(가) 이 질문에 답한다고 기록했습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  async function deleteRelation(item: KnowledgeRelationView) {
    if (item.direction !== 'outgoing') { onNotify('이 노트에서 만든 관계만 삭제할 수 있습니다. 반대쪽 노트에서 지우세요.'); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.deleteKnowledgeRelation({ id: item.id, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 관계를 삭제하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true)
      await onReloadContext()
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  async function reviewRelation(item: KnowledgeRelationView, decision: 'approved' | 'rejected') {
    if (item.direction !== 'outgoing') { onOpenCuration(); return }
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.reviewKnowledgeRelation({ id: item.id, decision, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 검토 결과를 저장하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true)
      await onReloadContext()
      onNotify(decision === 'approved' ? 'AI 관계를 승인해 노트와 그래프에 반영했습니다.' : 'AI 관계를 거절했습니다.')
    } catch (reason) { onNotify(String(reason), 'error') }
  }

  function insertEvidence(anchor: EvidenceAnchor, relink?: EmbeddedEvidence) {
    if (relink) { edit(replaceEvidence(contentRef.current, relink, anchor)); setPicker(undefined); onNotify('새 PDF 위치로 재연결했습니다.'); return }
    if (linkedEvidence.some((item) => item.paperId === anchor.paperId && item.anchorId === anchor.anchorId)) { onNotify('이미 이 노트에 연결된 근거입니다.'); return }
    editorRef.current?.insertText(evidenceMarkdown(anchor)); setPicker(undefined)
  }
  async function connectEvidenceClaim(evidence: EmbeddedEvidence, target: KnowledgeNodeRecord, type: 'supports' | 'contradicts' | 'extends', confirmed = false): Promise<boolean> {
    const owner = claimOwner.current.token, vaultId = vaultIdRef.current
    const current = () => claimOwner.current.token === owner && vaultIdRef.current === vaultId
    const warning = type === 'contradicts' && !confirmed ? scopeConflict(node, target) : undefined
    if (warning) { setPendingContradiction({ message: warning, run: async () => { await connectEvidenceClaim(evidence, target, type, true) } }); return false }
    if (dirtyRef.current && !(await save())) return false
    if (!current() || dirtyRef.current || !revisionRef.current || !vaultId) return false
    const sourceContent = contentRef.current
    const evidenceAnchor: RelationEvidenceAnchor = { paperId: evidence.paperId, anchorId: evidence.anchorId, type: evidence.type, page: evidence.page, label: evidence.label }
    let relationSaved = false
    try {
      const result = await window.prism.createKnowledgeRelation({ sourceId: node.id, targetId: target.id, type, creator: 'user', evidenceAnchor, expectedRevision: revisionRef.current, vaultId })
      if (!current()) return result.saved
      if (!result.saved) { onNotify('노트가 외부에서 변경되어 근거 관계를 저장하지 않았습니다.', 'error'); return false }
      relationSaved = true
      if (contentRef.current !== sourceContent || dirtyRef.current) { await onReloadContext(); onNotify('관계를 저장했습니다. 연결 중 작성한 내용은 보존했습니다.'); return true }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true); setPicker(undefined)
      await onReloadContext()
      onNotify(`이 근거를 '${target.title}'에 '${relationLabels[type]}' 관계로 연결했습니다.`)
      return true
    } catch (reason) { if (current()) onNotify(relationSaved ? `관계는 저장됐지만 화면을 갱신하지 못했습니다: ${String(reason)}` : String(reason), 'error'); return relationSaved }
  }
  async function createEvidenceClaim() {
    if (picker?.kind !== 'evidence-claim' || evidenceClaimBusy.current) return
    const title = picker.query.replace(/\s+/g, ' ').trim(), evidence = picker.evidence, type = picker.type
    const sourceId = node.id, owner = claimOwner.current.token, vaultId = vaultIdRef.current
    if (!title || !vaultId) return
    const current = () => claimOwner.current.token === owner && vaultIdRef.current === vaultId
    evidenceClaimBusy.current = true; setCreatingEvidenceClaim(true)
    const key = JSON.stringify([vaultId, sourceId, evidence.paperId, evidence.anchorId, title.toLocaleLowerCase()])
    let target = createdEvidenceClaims.current.get(key)
    try {
      if (!(await save()) || !current() || dirtyRef.current) return
      if (!target) {
        const matches = nodes.filter(item => item.nodeType === 'claim' && item.title.toLocaleLowerCase() === title.toLocaleLowerCase())
        if (matches.length > 1) throw new Error('같은 제목의 주장이 여러 개입니다. 위 목록에서 연결할 주장을 선택해 주세요.')
        target = matches[0]
      }
      if (!target) {
        const live = anchors.find(anchor => anchor.paperId === evidence.paperId && anchor.anchorId === evidence.anchorId && anchor.sourceHash === evidence.sourceHash)
        const body = `# ${title}\n\n${evidenceMarkdown({ ...evidence, scientificSpans: live?.scientificSpans, availability: 'linked' })}\n`
        const result = await window.prism.createKnowledgeNode({ nodeType: 'claim', title, body, vaultId })
        target = result.nodes.find(item => item.id === result.id)
        if (!target) throw new Error('만든 주장을 목록에서 확인하지 못했습니다. 노트 목록을 새로 확인해 주세요.')
        createdEvidenceClaims.current.set(key, target)
      }
      if (!current()) return
      setCreatedEvidenceClaim({ node: target, sourceId, vaultId, evidenceKey: JSON.stringify([evidence.paperId, evidence.anchorId, type]), linked: false })
      await onReloadNodes()
      if (!current()) return
      const linked = await connectEvidenceClaim(evidence, target, type)
      if (current()) setCreatedEvidenceClaim({ node: target, sourceId, vaultId, evidenceKey: JSON.stringify([evidence.paperId, evidence.anchorId, type]), linked, ...(!linked ? { error: '주장 노트는 준비됐습니다. 관계 연결은 완료되지 않았습니다. 같은 제목으로 다시 시도하면 이 노트를 사용합니다.' } : {}) })
    } catch (reason) {
      if (current()) {
        const error = reason instanceof Error ? reason.message : String(reason)
        if (target) setCreatedEvidenceClaim({ node: target, sourceId, vaultId, evidenceKey: JSON.stringify([evidence.paperId, evidence.anchorId, type]), linked: false, error: `주장 노트는 준비됐지만 연결을 완료하지 못했습니다: ${error}` })
        onNotify(error, 'error')
      }
    } finally { evidenceClaimBusy.current = false; if (current()) setCreatingEvidenceClaim(false) }
  }
  async function copyEvidence(evidence: EmbeddedEvidence, target: KnowledgeNodeRecord) {
    const sourceId = node.id
    const sourceContent = contentRef.current
    try {
      const result = await copySavedEvidence(save,
        () => nodeIdRef.current === sourceId && contentRef.current === sourceContent && !dirtyRef.current,
        () => window.prism.copyKnowledgeEvidence({ sourceNodeId: sourceId, targetNodeId: target.id, blockId: evidence.blockId, expectedTargetRevision: target.revision }))
      if (!result) { onNotify('근거 복사 전에 원본 노트의 저장을 완료해 주세요. 편집 중이거나 저장 충돌이 있으면 복사하지 않습니다.'); return }
      if (!result.saved) { await onReloadNodes(); onNotify('대상 노트가 외부에서 변경되어 복사하지 않았습니다. 다시 선택해 주세요.', 'error'); return }
      setPicker(undefined); await onReloadNodes(); onNotify(`근거 카드를 '${target.title}'에 복사했습니다.`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }

  async function createLinkedNode(nodeType: 'concept' | 'claim', rawTitle: string) {
    // A typed link may carry its folder ("Concepts/flow matching"); the note is named after the last segment.
    const title = rawTitle.split('/').at(-1)?.trim() ?? rawTitle.trim()
    if (!title) return undefined
    const existing = nodes.find((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())
    if (existing) return { id: existing.id, label: existing.title, target: nodePath(existing), description: typeLabels[existing.nodeType], preview: existing.preview, evidenceCount: existing.evidenceCount }
    try {
      const created = await window.prism.createKnowledgeNode({ nodeType, title })
      const next = created.nodes.find((item) => item.id === created.id)
      await onReloadNodes()
      if (!next) return undefined
      return { id: next.id, label: next.title, target: nodePath(next), description: typeLabels[next.nodeType], preview: next.preview, evidenceCount: next.evidenceCount }
    } catch (reason) { onNotify(String(reason), 'error'); return undefined }
  }
  /** Follows a `[[link]]` in the body: same-name notes open, unresolved ones are created on the spot. */
  function openWikiLink(target: string) {
    const match = wikiTargetResolver(nodes)(target)
    if (match) { onOpenNode(match.id); return }
    onNotify(`'${target}'의 연결 대상을 확정하지 못했습니다. 노트 이름이나 경로를 확인해 주세요.`)
  }
  async function insertLink(target: KnowledgeNodeRecord) {
    editorRef.current?.insertWikiLink({ id: target.id, label: target.title, target: nodePath(target), description: typeLabels[target.nodeType] })
    setPicker(undefined)
  }
  async function applyTemplateSections(templateId: string) {
    if (dirtyRef.current && !(await save())) return
    if (!revisionRef.current) return
    try {
      const result = await window.prism.applyTemplateSections({ nodeId: node.id, templateId, expectedRevision: revisionRef.current })
      if (!result.saved) { onNotify('파일이 외부에서 변경되어 섹션을 추가하지 않았습니다.', 'error'); return }
      revisionRef.current = result.snapshot.revision; contentRef.current = result.snapshot.content
      setSnapshot(result.snapshot); setContent(result.snapshot.content); setSaved(true); setMenuOpen(false)
      onNotify(result.addedHeadings.length ? `누락된 섹션 ${result.addedHeadings.length}개를 추가했습니다: ${result.addedHeadings.join(', ')}` : '이 양식의 섹션이 이미 모두 있습니다.')
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  /** Old templates leave a page of empty headings; clearing them is the difference between a note and a form. */
  async function pruneSections() {
    if (dirtyRef.current && !(await save())) return
    try {
      const result = await window.prism.pruneEmptySections(node.id)
      if (!result.removed.length) { onNotify('비어 있는 섹션이 없습니다.'); return }
      const next = await window.prism.readKnowledgeNode(node.id, vaultIdRef.current)
      vaultIdRef.current = next.vaultId; revisionRef.current = next.revision; contentRef.current = next.content; stubScanRef.current = next.content
      setSnapshot(next); setContent(next.content); setSaved(true)
      onNotify(`빈 섹션 ${result.removed.length}개를 지웠습니다: ${result.removed.join(', ')}`)
    } catch (reason) { onNotify(String(reason), 'error') }
  }
  /**
   * The one place in the note that is the researcher's. It is created when they ask for it and never before,
   * so a note is never a page of empty headings; once it exists the cursor lands inside it, because aiming
   * between two hidden HTML comments is not something to ask of anyone.
   */
  async function openMineSection(section: MineSection) {
    if (editorRef.current?.focusMineSection(section)) return
    const next = insertMineSection(contentRef.current, section)
    if (next === contentRef.current) { editorRef.current?.moveToEnd(); return }
    edit(next)
    // The editor has to receive the new text before there is anywhere to put the cursor.
    window.setTimeout(() => editorRef.current?.focusMineSection(section), 0)
  }

  async function removeNode() {
    if (!deleteReady) { setDeleteReady(true); onNotify('한 번 더 누르면 이 노트를 휴지통으로 보냅니다.'); return }
    try { await window.prism.deleteKnowledgeNode(node.id); setMenuOpen(false); setDeleteReady(false); await onReloadNodes(); onNotify('노트를 휴지통으로 보냈습니다.') }
    catch (reason) { onNotify(String(reason), 'error') }
  }

  function runSlashAction(action: MarkdownSlashAction) {
    if (action === 'link') { setPicker({ kind: 'link', query: '' }); return }
    if (action === 'evidence') { setPicker({ kind: 'evidence', query: '' }); return }
    const type: KnowledgeRelationType = action === 'supports' ? 'supports' : action === 'contradicts' ? 'contradicts' : (availableRelationTypes[0] ?? 'uses')
    openRelationPicker(type)
  }
  const availableRelationTypes = useMemo(() => primaryRelationTypes.filter((type) => nodes.some((other) => other.id !== node.id && relationTypesFor(node, other).includes(type))), [nodes, node])
  /** Turning a plain link into a typed relation: pre-select the target so it is one click, not a search. */
  function upgradeLink(item: KnowledgeRelationView) {
    const target = nodes.find((candidate) => candidate.id === item.other.id)
    const types = target ? relationTypesFor(node, target) : []
    if (!target || !types.length) { onNotify('이 조합에는 지정할 관계 유형이 없습니다. 링크로 두어도 그래프에는 나타납니다.'); return }
    setPicker({ kind: 'relation', query: target.title, type: types[0] })
  }
  function openRelationPicker(type?: KnowledgeRelationType) {
    const next = type && availableRelationTypes.includes(type) ? type : availableRelationTypes[0]
    if (!next) { onNotify('이 노트에서 만들 수 있는 관계가 없습니다. 본문에서 [[링크]]로 연결하세요.'); return }
    setPicker({ kind: 'relation', query: '', type: next })
  }

  const pickerTargets = useMemo(() => {
    if (!picker) return []
    const query = picker.query.trim().toLocaleLowerCase()
    const match = (item: { title: string; preview: string; relativePath: string }) => !query || `${item.title} ${item.preview} ${item.relativePath}`.toLocaleLowerCase().includes(query)
    if (picker.kind === 'relation') return nodes.filter((item) => item.id !== node.id && relationTypesFor(node, item).includes(picker.type) && match(item)).slice(0, 40)
    if (picker.kind === 'evidence-claim') return nodes.filter((item) => item.nodeType === 'claim' && item.id !== node.id && match(item)).slice(0, 40)
    if (picker.kind === 'copy-evidence') return nodes.filter((item) => item.id !== node.id && match(item)).slice(0, 40)
    if (picker.kind === 'link') return nodes.filter((item) => item.id !== node.id && match(item)).slice(0, 40)
    if (picker.kind === 'answer') return nodes.filter((item) => item.id !== node.id && relationTypesFor(item, node).includes('answers') && match(item)).slice(0, 40)
    return []
  }, [picker, nodes, node])
  const pickerAnchors = useMemo(() => {
    if (picker?.kind !== 'evidence') return []
    const query = picker.query.trim().toLocaleLowerCase()
    return anchors.filter((anchor) => !query || `${anchor.paperTitle} ${anchor.label} ${anchor.source}`.toLocaleLowerCase().includes(query)).slice(0, 60)
  }, [picker, anchors])

  const ready = Boolean(snapshot)
  /**
   * A property earns a row by changing what Prism does with the note. Importance, confidence, evidence kind
   * and projects were stored and read by nothing, and the type row repeated the coloured chip above the
   * title — six dropdowns that only ever asked to be filled in. They stay in the frontmatter so the files
   * keep working in Obsidian; they are simply no longer homework.
   *
   * What is left: status decides what the curation queue, the open-question list and the archive still want
   * from a note, reading status tracks progress without an AI call, and a claim's origin and scope are
   * what the contradiction guard and the model read before saying two claims disagree.
   */
  const properties: Array<{ key: string; label: string; value: React.ReactNode }> = [
    { key: 'status', label: '상태', value: <select aria-label="노트 상태" disabled={!ready} value={node.status} onChange={(event) => void updateProperty({ status: event.target.value as KnowledgeStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> },
  ]
  if (node.nodeType === 'paper') properties.push({ key: 'reading', label: '읽기', value: <select aria-label="논문 읽기 상태" disabled={!ready} value={node.readingStatus ?? 'to_read'} onChange={(event) => void updateProperty({ readingStatus: event.target.value as KnowledgeReadingStatus })}>{Object.entries(readingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> })
  if (node.nodeType === 'claim') {
    properties.push({ key: 'origin', label: '출처', value: <select aria-label="주장 출처" disabled={!ready} value={node.claimOrigin ?? 'paper'} onChange={(event) => void updateProperty({ claimOrigin: event.target.value as ClaimOrigin })}>{Object.entries(claimOriginLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> })
    properties.push({ key: 'scope', label: '적용 범위', value: <span className="prop-inline"><PropertyText disabled={!ready} label="도메인" placeholder="예: 이미지 생성" value={node.scopeDomain ?? ''} onCommit={(value) => void updateProperty({ scopeDomain: value })} /><PropertyText disabled={!ready} label="조건" placeholder="예: 대규모 데이터" value={node.scopeRegime ?? ''} onCommit={(value) => void updateProperty({ scopeRegime: value })} /></span> })
  }

  return <article className="note-doc" aria-label={`${node.title} 노트`}>
    {historyOpen && <NoteHistoryDialog nodeId={node.id} vaultId={vaultIdRef.current} onClose={() => setHistoryOpen(false)} onRestore={restoreHistory} />}
    <header className="note-doc-head">
      <div className="note-doc-title">
        <span className={`node-kind kind-${node.nodeType}`}><i /> {typeLabels[node.nodeType]}</span>
        <h1>{node.title}</h1>
        <small title={node.relativePath}>{fileName(node)}</small>
      </div>
      <div className="note-doc-actions">
        <span className={`note-save ${ready && saved ? 'is-saved' : ''}`} role="status">{!ready ? '불러오는 중…' : saved ? '저장됨' : '저장 중…'}</span>
        {digesting && <span className="note-digesting" role="status">정리 중…</span>}
        {node.nodeType === 'paper' && node.arxivId && <button className="ghost" title="이 논문을 리더 창에서 엽니다" onClick={() => void window.prism.openPaperInReader(node.arxivId!)}><BookOpen size={13} /> 리더에서 열기</button>}
        {/^## (?:메모|Notes)\s*$/m.test(content) && <button className="ghost" title="저장한 메모와 AI 답변이 있는 구간으로 이동합니다" onClick={() => editorRef.current?.focusSection(content.match(/^## (메모|Notes)\s*$/m)?.[1] ?? '메모')}><PenLine size={13} /> 메모 보기</button>}
        <button className="ghost" title="본문에 다른 노트 링크를 넣습니다" onClick={() => setPicker({ kind: 'link', query: '' })}><Link2 size={13} /> 링크</button>
        {node.nodeType === 'question'
          ? <button className="ghost" title="이 질문에 답하는 논문이나 주장을 연결합니다" onClick={() => setPicker({ kind: 'answer', query: '' })}><Link2 size={13} /> 답 연결</button>
          : availableRelationTypes.length > 0 && <button className="ghost" title="정의·지지·반박처럼 연결의 의미를 지정합니다" onClick={() => openRelationPicker()}><Link2 size={13} /> 관계</button>}
        <button className="ghost" title="PDF 문장·수식·표·피겨를 근거 카드로 넣습니다" onClick={() => setPicker({ kind: 'evidence', query: '' })}><Plus size={13} /> 근거</button>
        <div className="note-doc-menu">
          <button className="ghost icon" aria-label="노트 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={14} /></button>
          {menuOpen && <div className="note-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); setHistoryOpen(true) }}>저장 이력</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void window.prism.openKnowledgeNodeInObsidian({ nodeId: node.id }).catch((reason) => onNotify(String(reason), 'error')) }}><ExternalLink size={12} /> Obsidian에서 열기</button>
            <button role="menuitem" disabled={digesting || suggesting} title="선택한 AI 모델로 이 노트의 자동 구간만 갱신합니다. CLI 사용량이 소모됩니다." onClick={() => { setMenuOpen(false); void refreshDigest(true) }}><Sparkles size={12} /> {digesting ? '정리 중…' : 'AI로 다시 정리하기'}</button>
            <button role="menuitem" title="내용이 하나도 없는 제목만 지웁니다" onClick={() => { setMenuOpen(false); void pruneSections() }}><Trash2 size={12} /> 빈 양식 섹션 정리</button>
            {node.nodeType === 'paper' && <button role="menuitem" disabled={suggesting || digesting} title="선택한 AI 모델로 이 논문의 관계 후보를 제안합니다. CLI 사용량이 소모됩니다." onClick={() => { setMenuOpen(false); void runModelSuggestions() }}><Sparkles size={12} /> {suggesting ? '제안 중…' : 'AI로 이 논문 연결 제안'}</button>}
            {nodeTemplates.map((template) => <button key={template.id} role="menuitem" onClick={() => void applyTemplateSections(template.id)}>양식 적용 · {template.name}</button>)}
            <button role="menuitem" className={deleteReady ? 'danger' : ''} onClick={() => void removeNode()}><Trash2 size={12} /> {deleteReady ? '삭제 확인' : '휴지통으로 보내기'}</button>
          </div>}
        </div>
      </div>
    </header>

    <div className="note-doc-scroll">
      <div className="note-doc-inner">
        <details className="note-props" open={propsOpen} onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setPropsOpen(open); window.localStorage.setItem('prism.notes.propsOpen', open ? 'on' : 'off') }}>
          <summary><ChevronDown size={12} /> 속성 {properties.length + relationGroups.length}개</summary>
          <table>
            <tbody>
              {properties.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.value}</td></tr>)}
              {relationGroups.map(([key, items]) => {
                const [direction, type] = key.split(':') as ['outgoing' | 'incoming', KnowledgeRelationType]
                return <tr key={key}><td>{direction === 'outgoing' ? relationLabels[type] : `${relationLabels[type]} (받음)`}</td><td className="prop-relations">
                  {items.map((item) => <span key={item.id} className="rel-chip"><button onClick={() => onOpenNode(item.other.id)}>{item.other.title}</button>{item.direction === 'outgoing' && <button className="rel-remove" aria-label={`${item.other.title} 관계 삭제`} onClick={() => void deleteRelation(item)}><X size={10} /></button>}</span>)}
                </td></tr>
              })}
              {linked.length > 0 && <tr className="prop-linked"><td title="본문에 적은 [[링크]]에서 자동으로 만들어집니다">링크</td><td className="prop-relations">
                {linked.map((item) => <span key={item.id} className="rel-chip is-link">
                  <button onClick={() => onOpenNode(item.other.id)}>{item.direction === 'incoming' ? '← ' : ''}{item.other.title}</button>
                  {item.direction === 'outgoing' && <button className="rel-upgrade" title="이 링크에 관계 유형을 지정합니다" aria-label={`${item.other.title} 관계 지정`} onClick={() => upgradeLink(item)}>관계 지정</button>}
                </span>)}
              </td></tr>}
              {pending.length > 0 && <tr className="prop-pending"><td>검토 대기</td><td>
                {pending.map((item) => <span key={item.id} className="rel-chip is-pending"><button onClick={() => onOpenNode(item.other.id)}>{relationLabels[item.type]} · {item.other.title}</button>{item.direction === 'outgoing' && <><button className="rel-approve" aria-label={`${item.other.title} 관계 승인`} onClick={() => void reviewRelation(item, 'approved')}><Check size={10} /></button><button className="rel-remove" aria-label={`${item.other.title} 관계 거절`} onClick={() => void reviewRelation(item, 'rejected')}><X size={10} /></button></>}</span>)}
              </td></tr>}
              <tr className="prop-add"><td /><td>{availableRelationTypes.length > 0 && <button onClick={() => openRelationPicker()}><Plus size={11} /> 관계 추가</button>}{node.nodeType === 'question' && <button onClick={() => setPicker({ kind: 'answer', query: '' })}><Plus size={11} /> 답 연결</button>}</td></tr>
            </tbody>
          </table>
        </details>

        {snapshot ? <div className="note-body" ref={bindEvidenceClicks}>
          <MarkdownEditor
            ref={editorRef} key={node.id} value={content} onChange={edit} onBlur={() => void settle()}
            liveEdit label={`${node.title} 본문`} wikiLinks={wikiLinks} evidenceLinks={evidenceLinks}
            onCreateWikiLink={createLinkedNode} onOpenWikiLink={openWikiLink} slashActions={['link', 'evidence', 'relation', 'supports', 'contradicts']} onSlashAction={runSlashAction}
          />
          <p className="note-hint">{mineSections.map((section) => <button key={section} className="note-write-mine" title={`${minePrompts[section]} — 자동 기록이 절대 건드리지 않는 칸입니다`} onClick={() => void openMineSection(section)}><PenLine size={11} /> {mineHeadings[section]}</button>)}<button className="note-insert-block" onClick={() => editorRef.current?.openInsertMenu()}><Plus size={11} /> 블록 삽입</button><span><kbd>/</kbd> 블록 · <kbd>[[</kbd> 노트 링크(클릭하면 이동) · <kbd>@</kbd> PDF 근거</span><button className="note-digest-run" disabled={digesting || suggesting} title="선택한 AI 모델로 이 노트의 자동 구간만 갱신합니다. CLI 사용량이 소모됩니다." onClick={() => void refreshDigest(true)}><Sparkles size={11} /> {digesting ? '정리 중…' : 'AI로 이 노트 정리'}</button></p>
        </div> : <div className="note-loading" role={loadAttempt >= 3 ? "alert" : "status"}>{loadAttempt >= 3 ? <><p>노트를 불러오지 못했습니다. 저장 위치와 파일을 확인해 주세요.</p>{loadError && <p>{loadError}</p>}<button type="button" onClick={() => setLoadAttempt(0)}>다시 시도</button></> : "노트를 불러오는 중…"}</div>}

        {linkedEvidence.length > 0 && <details className="note-evidence" open>
          <summary>PDF 근거 {linkedEvidence.length}개</summary>
          {linkedEvidence.map((item) => {
            const current = anchors.find((anchor) => anchor.paperId === item.paperId && anchor.anchorId === item.anchorId)
            const broken = !current || current.sourceHash !== item.sourceHash
            return <div key={item.blockId} className={`evidence-row${broken ? ' is-broken' : ''}`}>
              <button className="evidence-open" onClick={() => void window.prism.openEvidenceAnchor(item).catch((reason) => onNotify(String(reason), 'error'))}>
                <small>{broken ? '재연결 필요' : `${evidenceTypeLabel(item.type)} · p.${item.page}`} · {item.paperTitle}</small>
                <span>{scientificPreviewText(item.source, !broken ? current?.scientificSpans : undefined)}</span>
              </button>
              <div className="evidence-actions">
                {broken && <button onClick={() => setPicker({ kind: 'evidence', query: item.paperTitle, relink: item })}>재연결</button>}
                <button onClick={() => setPicker({ kind: 'evidence-claim', query: '', evidence: item, type: 'supports' })}>주장에 연결</button>
                <button onClick={() => setPicker({ kind: 'copy-evidence', query: '', evidence: item })}>복사</button>
                <button aria-label={`${item.label} 근거 링크 삭제`} onClick={() => { edit(removeEvidence(contentRef.current, item)); onNotify('근거 링크만 제거했습니다. PDF 원문과 다른 노트는 그대로입니다.') }}><X size={11} /></button>
              </div>
            </div>
          })}
        </details>}

        {/* The tree says a note wrote something; this is where that claim is retired, once it has been read. */}
        {autoUnread && <div className="note-auto-read">
          <span>자동으로 <b>{autoUnread.sections.map((section) => autoSectionLabels[section] ?? section).join(' · ')}</b>{autoUnread.sections.length > 1 ? '를' : '을'} 새로 썼습니다.</span>
          <button onClick={() => { void window.prism.clearAutoUnread(node.id).then(() => onAutoUnreadChange()).catch((reason) => onNotify(String(reason), 'error')) }}><Check size={12} /> 읽었어요</button>
        </div>}
      </div>
    </div>

    {picker && <section className="note-picker" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPicker(undefined); editorRef.current?.focus() } }} aria-label={picker.kind === 'evidence' ? 'PDF 근거 선택' : picker.kind === 'relation' ? '관계 대상 선택' : picker.kind === 'evidence-claim' ? '근거를 연결할 주장 선택' : picker.kind === 'copy-evidence' ? '근거를 복사할 노트 선택' : picker.kind === 'answer' ? '이 질문에 답하는 노트 선택' : '연결할 노트 선택'}>
      <header>
        <div><Search size={13} /><input autoFocus aria-label="노트 및 근거 검색" value={picker.query} placeholder={picker.kind === 'evidence' ? '논문 제목, 문장, 수식 검색' : '제목, 본문 검색'} onChange={(event) => setPicker({ ...picker, query: event.target.value })} /></div>
        <button aria-label="선택 닫기" onClick={() => setPicker(undefined)}><X size={13} /></button>
      </header>
      {picker.kind === 'relation' && <nav className="picker-types" aria-label="관계 유형">{availableRelationTypes.map((type) => <button key={type} className={picker.type === type ? 'active' : ''} aria-pressed={picker.type === type} onClick={() => setPicker({ ...picker, type })}>{relationLabels[type]}</button>)}</nav>}
      {picker.kind === 'relation' && <p className="picker-direction">이 노트 → {relationLabels[picker.type]} → 아래에서 선택할 노트</p>}
      {picker.kind === 'relation' && <p className="picker-direction">‘관련’은 지지나 상하 관계를 단정하지 않는 연결입니다. 정확한 출처 문장이나 피겨는 ‘근거’로 남기세요.</p>}
      {picker.kind === 'link' && <p className="picker-direction">본문에 노트 링크를 넣습니다. 지지·반박 같은 의미를 정하려면 ‘관계’를 사용하세요.</p>}
      {picker.kind === 'evidence-claim' && <nav className="picker-types" aria-label="근거 관계 유형">{(['supports', 'contradicts', 'extends'] as const).map((type) => <button key={type} className={picker.type === type ? 'active' : ''} aria-pressed={picker.type === type} onClick={() => setPicker({ ...picker, type })}>{relationLabels[type]}</button>)}</nav>}
      <div className="picker-list">
        {picker.kind === 'evidence'
          ? pickerAnchors.length ? pickerAnchors.map((anchor) => <button key={`${anchor.paperId}-${anchor.anchorId}`} onClick={() => insertEvidence(anchor, picker.relink)}><small>{evidenceTypeLabel(anchor.type)} · p.{anchor.page} · {anchor.paperTitle}</small><strong>{scientificPreviewText(anchor.source, anchor.scientificSpans)}</strong></button>)
            : <p role="status">{anchors.length ? '검색어와 일치하는 PDF 근거가 없습니다. 논문 제목이나 문장의 다른 단어로 검색해 보세요.' : '저장된 PDF 근거가 없습니다. 리더에서 논문을 열면 문장·수식·표 근거를 선택할 수 있습니다.'}</p>
          : pickerTargets.length ? pickerTargets.map((target) => <button key={target.id} onClick={() => {
            if (picker.kind === 'answer') void addAnswer(target)
            else if (picker.kind === 'relation') void addRelation(target, picker.type)
            else if (picker.kind === 'evidence-claim') void connectEvidenceClaim(picker.evidence, target, picker.type)
            else if (picker.kind === 'copy-evidence') void copyEvidence(picker.evidence, target)
            else void insertLink(target)
          }}><small>{typeLabels[target.nodeType]} · {target.relativePath}</small><strong>{target.title}</strong></button>)
            : <p>조건에 맞는 노트가 없습니다.</p>}
      </div>
      {picker.kind === 'evidence-claim' && <footer style={{ flexDirection: 'column' }}>
        {createdEvidenceClaim?.sourceId === node.id && createdEvidenceClaim.vaultId === vaultIdRef.current && createdEvidenceClaim.evidenceKey === JSON.stringify([picker.evidence.paperId, picker.evidence.anchorId, picker.type]) && createdEvidenceClaim.node.title.toLocaleLowerCase() === picker.query.trim().toLocaleLowerCase()
          ? createdEvidenceClaim.linked ? <p>이 주장은 연결했습니다. 아래 ‘주장 열기’에서 내용을 확인하세요.</p>
            : <><p>이미 준비한 주장에 ‘{relationLabels[picker.type]}’ 관계 연결을 다시 시도합니다.</p><button disabled={creatingEvidenceClaim} onClick={() => void createEvidenceClaim()}>{creatingEvidenceClaim ? '주장 준비 및 연결 중…' : '준비한 주장에 연결 다시 시도'}</button></>
          : nodes.some(item => item.nodeType === 'claim' && item.title.toLocaleLowerCase() === picker.query.trim().toLocaleLowerCase())
            ? <p>같은 제목의 주장이 있습니다. 위 목록에서 연결할 주장을 선택해 주세요.</p>
            : <><p>선택한 PDF 근거를 새 주장에 담고 ‘{relationLabels[picker.type]}’ 관계로 연결합니다. 주장 제목을 입력해 주세요.</p><button disabled={!picker.query.trim() || creatingEvidenceClaim} onClick={() => void createEvidenceClaim()}>{creatingEvidenceClaim ? '주장 준비 및 연결 중…' : '이 근거로 주장 만들고 연결'}</button></>}
      </footer>}
      {picker.kind === 'link' && picker.query.trim() && !nodes.some((item) => item.title.toLocaleLowerCase() === picker.query.trim().toLocaleLowerCase()) && <footer>
        <button onClick={async () => { const option = await createLinkedNode('concept', picker.query.trim()); if (option) { editorRef.current?.insertWikiLink(option); setPicker(undefined) } }}>'{picker.query.trim()}' 개념으로 만들기</button>
        <button onClick={async () => { const option = await createLinkedNode('claim', picker.query.trim()); if (option) { editorRef.current?.insertWikiLink(option); setPicker(undefined) } }}>주장으로 만들기</button>
      </footer>}
    </section>}

    {createdEvidenceClaim?.sourceId === node.id && createdEvidenceClaim.vaultId === vaultIdRef.current && <section className="note-recovery-notice" aria-label="준비한 주장">
      <p role="status">{createdEvidenceClaim.error ?? `주장 '${createdEvidenceClaim.node.title}'을 열어 근거와 본문을 검토할 수 있습니다.`}</p>
      <button onClick={async () => { const target = createdEvidenceClaim; const owner = claimOwner.current.token; if (await save() && claimOwner.current.token === owner && !dirtyRef.current && vaultIdRef.current === target.vaultId) onOpenNode(target.node.id) }}>주장 열기 · {createdEvidenceClaim.node.title}</button>
      <button aria-label="준비한 주장 안내 닫기" onClick={() => setCreatedEvidenceClaim(undefined)}>닫기</button>
    </section>}

    {pendingContradiction && <section className="note-scope-warning" role="alertdialog" aria-label="스코프 경고">
      <div><strong>두 주장의 적용 범위가 겹치지 않습니다</strong><p>{pendingContradiction.message} 모순이 아니라 조건 차이일 수 있습니다.</p></div>
      <footer><button onClick={() => setPendingContradiction(undefined)}>취소</button><button className="primary" onClick={() => { const run = pendingContradiction.run; setPendingContradiction(undefined); void run() }}>그래도 반박으로 연결</button></footer>
    </section>}

    {conflict && <div className="notes-conflict-backdrop" role="presentation">
      <section className="notes-conflict" role="dialog" aria-modal="true" aria-labelledby="notes-conflict-title">
        <header><AlertTriangle size={18} /><div><h2 id="notes-conflict-title">외부 변경과 충돌했습니다</h2><p>다른 편집기에서 이 파일을 바꿨습니다. 두 버전을 비교한 뒤 보존할 내용을 고르세요.</p></div></header>
        <div className="notes-conflict-compare">
          <article><h3>내 편집본</h3><pre>{content}</pre></article>
          <article><h3>디스크 최신 버전</h3><small>{new Date(conflict.modifiedAt).toLocaleString()}</small><pre>{conflict.content}</pre></article>
        </div>
        <footer>
          <button onClick={() => { revisionRef.current = conflict.revision; contentRef.current = conflict.content; dirtyRef.current = false; setContent(conflict.content); setSnapshot(conflict); setConflict(undefined); setSaved(true) }}>디스크 버전 사용</button>
          <button className="primary" onClick={() => void save(true)}>내 편집본으로 덮어쓰기</button>
        </footer>
      </section>
    </div>}
  </article>
}

function PropertyText({ label, value, placeholder, disabled, onCommit }: { label: string; value: string; placeholder?: string; disabled?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return <input
    className="prop-text" aria-label={label} value={draft} placeholder={placeholder} disabled={disabled}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft.trim() !== value.trim()) onCommit(draft.trim()) }}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}
  />
}
