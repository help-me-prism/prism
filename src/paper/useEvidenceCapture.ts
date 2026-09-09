import { useEffect, useRef, useState } from 'react'

type Panel = { anchor: ContextAnchor; items: EvidenceBacklink[]; loading: boolean; error?: string }
type Draft = { memo: string; concept: string; status: string; version: number; saving: boolean }
type View = { scope: object; key: string; panel: Panel; conceptOptions: string[] }

/** Session-only drafts are owned by a vault, paper, and exact source anchor. */
export function useEvidenceCapture({ libraryPath, activePaperId }: { libraryPath?: string; activePaperId?: string }) {
  const scopeKey = JSON.stringify([libraryPath, activePaperId])
  const scope = useRef({ key: scopeKey, owner: {} })
  const request = useRef(0)
  if (scope.current.key !== scopeKey) { scope.current = { key: scopeKey, owner: {} }; request.current++ }
  const owner = scope.current.owner
  const mounted = useRef(true)
  const drafts = useRef(new Map<string, Draft>())
  const [view, setView] = useState<View>()
  const currentView = useRef<View | undefined>(undefined)
  const [, redraw] = useState(0)
  const visible = view?.scope === owner ? view : undefined
  currentView.current = visible
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++ } }, [])
  const draftFor = (key: string) => {
    let draft = drafts.current.get(key)
    if (!draft) { draft = { memo: '', concept: '', status: '', version: 0, saving: false }; drafts.current.set(key, draft) }
    return draft
  }
  const refresh = () => { if (mounted.current) redraw(value => value + 1) }
  const owns = (expected: object, run: number, key: string) => mounted.current && scope.current.owner === expected && request.current === run && currentView.current?.key === key

  async function load(anchor: ContextAnchor, key: string, expected: object, run: number) {
    // Both IPCs use the currently selected vault; stale results must never be applied.
    await Promise.all([
      window.prism.listKnowledgeNodes().then(nodes => {
        if (owns(expected, run, key)) setView(value => value?.scope === expected && value.key === key ? { ...value, conceptOptions: nodes.filter(node => node.nodeType === 'concept').map(node => node.title) } : value)
      }).catch(() => { /* Optional suggestions do not hide the evidence or draft. */ }),
      window.prism.listEvidenceBacklinks(anchor).then(items => {
        if (owns(expected, run, key)) setView(value => value?.scope === expected && value.key === key ? { ...value, panel: { anchor, items, loading: false } } : value)
      }).catch(reason => {
        if (owns(expected, run, key)) setView(value => value?.scope === expected && value.key === key ? { ...value, panel: { anchor, items: [], loading: false, error: String(reason) } } : value)
      }),
    ])
  }
  function show(anchor: ContextAnchor) {
    if (!libraryPath || anchor.paperId !== activePaperId || scope.current.owner !== owner) return
    const key = JSON.stringify([libraryPath, anchor.paperId, anchor.anchorId]); draftFor(key)
    const next: View = { scope: owner, key, panel: { anchor, items: [], loading: true }, conceptOptions: [] }
    const run = ++request.current; currentView.current = next; setView(next)
    void load(anchor, key, owner, run)
  }
  function close() { request.current++; currentView.current = undefined; setView(undefined) }
  function edit(field: 'memo' | 'concept', value: string) {
    const active = currentView.current
    if (!active || active.scope !== scope.current.owner) return
    const draft = draftFor(active.key); draft[field] = value; draft.version++; draft.status = ''; refresh()
  }
  async function capture() {
    const active = currentView.current
    if (!active || active.scope !== scope.current.owner || !libraryPath) return
    const draft = draftFor(active.key)
    if (draft.saving) return
    const version = draft.version, memo = draft.memo, concept = draft.concept.trim(), run = request.current
    draft.saving = true; draft.status = ''; refresh()
    try {
      const settings = await window.prism.getSettings()
      if (settings.libraryPath !== libraryPath || !owns(active.scope, run, active.key)) {
        draft.status = '읽기 위치가 변경되어 저장하지 않았습니다. 이 근거를 다시 열어 저장해 주세요.'; return
      }
      const result = await window.prism.capturePaperNote({ kind: 'evidence', libraryPath, paperId: active.panel.anchor.paperId, anchorId: active.panel.anchor.anchorId, memo, concept: concept || undefined })
      if (draft.version === version) {
        draft.memo = ''; draft.concept = ''
        draft.status = result.warning ?? (result.concept ? `논문 노트와 개념 '${result.concept}'의 정의 비교 표에 담았습니다.` : '논문 노트의 메모 섹션에 담았습니다.')
      } else draft.status = [result.warning, '제출한 메모를 저장했습니다. 저장 중 작성한 내용은 입력창에 남아 있습니다.'].filter(Boolean).join(' ')
      if (owns(active.scope, run, active.key)) void load(active.panel.anchor, active.key, active.scope, run)
    } catch (reason) { draft.status = reason instanceof Error ? reason.message : String(reason) }
    finally { draft.saving = false; refresh() }
  }
  const draft = visible && draftFor(visible.key)
  return { panel: visible?.panel, memo: draft?.memo ?? '', concept: draft?.concept ?? '', status: draft?.status ?? '', conceptOptions: visible?.conceptOptions ?? [], saving: draft?.saving ?? false,
    show, close, setMemo: (value: string) => edit('memo', value), setConcept: (value: string) => edit('concept', value), capture }
}
