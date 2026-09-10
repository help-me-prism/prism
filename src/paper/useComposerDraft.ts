import { useEffect, useState, type SetStateAction } from 'react'
import { durableAnchorPreview } from './anchorPreview'
type Draft = { text: string; anchors: ContextAnchor[] }
const blank = (): Draft => ({ text: '', anchors: [] })
const prefix = 'prism.composer-draft.v1:'
function read(key: string): { draft: Draft; error: string } {
  try {
    const raw = localStorage.getItem(prefix + key)
    if (!raw) return { draft: blank(), error: '' }
    const draft = JSON.parse(raw)
    if (typeof draft.text !== 'string' || !Array.isArray(draft.anchors)
      || draft.anchors.some((a: ContextAnchor) => !a || typeof a.paperId !== 'string' || typeof a.anchorId !== 'string')) throw new Error('Invalid draft')
    return { draft, error: '' }
  } catch { return { draft: blank(), error: '질문 초안을 읽지 못했습니다. 기존 저장 데이터는 유지됩니다.' } }
}
export function useComposerDraft(key: string) {
  const [state, setState] = useState(() => ({ key, ...read(key), edited: false }))
  const current = state.key === key ? state : { key, ...read(key), edited: false }
  if (state.key !== key) setState(current)
  useEffect(() => {
    if (!state.edited) return
    try {
      const draft = { text: state.draft.text, anchors: state.draft.anchors.map(durableAnchorPreview) }
      if (!draft.text && !draft.anchors.length) localStorage.removeItem(prefix + state.key)
      else localStorage.setItem(prefix + state.key, JSON.stringify(draft))
    } catch { setState(value => value.key === state.key ? { ...value, edited: false, error: '질문 초안을 기기에 보관하지 못했습니다. 앱을 닫기 전에 내용을 복사해 주세요.' } : value) }
  }, [state])
  const update = (change: (draft: Draft) => Draft) => setState(value => value.key === key ? { ...value, draft: change(value.draft), edited: true, error: '' } : value)
  return { input: current.draft.text, anchors: current.draft.anchors, error: current.error,
    setInput: (text: string) => update(draft => ({ ...draft, text })),
    setAnchors: (anchors: SetStateAction<ContextAnchor[]>) => update(draft => ({ ...draft, anchors: typeof anchors === 'function' ? anchors(draft.anchors) : anchors })) }
}
