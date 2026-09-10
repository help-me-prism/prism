import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

const openFigureEvent = 'prism-open-figure-preview'

export function openFigurePreview(anchor: ContextAnchor) {
  window.dispatchEvent(new CustomEvent<ContextAnchor>(openFigureEvent, { detail: anchor }))
}

/** Hosts the shared full-size viewer without rendering a persistent attachment
 * strip. Figure thumbnails now live only in the tag's hover popover. */
export default function FigureAttachments() {
  const [selected, setSelected] = useState<ContextAnchor>()
  useEffect(() => {
    const open = (event: Event) => setSelected((event as CustomEvent<ContextAnchor>).detail)
    window.addEventListener(openFigureEvent, open)
    return () => window.removeEventListener(openFigureEvent, open)
  }, [])
  useDialogFocus(Boolean(selected), '.figure-preview-dialog', '.composer-editor')
  return <>
    {selected && createPortal(<div className="figure-preview-backdrop" onClick={event => { if (event.target === event.currentTarget) setSelected(undefined) }}>
      <section className="figure-preview-dialog" role="dialog" aria-modal="true" aria-label="첨부 이미지 확인" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSelected(undefined) } }}>
        <header><span>{selected.label} · {selected.page}쪽</span><button type="button" aria-label="이미지 확인 닫기" onClick={() => setSelected(undefined)}><X size={18} /></button></header>
        <SavedFigurePreview key={`${selected.paperId}:${selected.anchorId}`} anchor={selected} />
      </section>
    </div>, document.body)}
  </>
}

function SavedFigurePreview({ anchor }: { anchor: ContextAnchor }) {
  const [original, setOriginal] = useState<{ dataUrl: string; width: number; height: number }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<'fit' | 'actual'>('fit')
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    void (async () => {
      try {
        const saved = await window.prism.readSavedFigure(anchor.paperId, anchor.anchorId)
        if (!saved.dataUrl.startsWith('data:image/')) throw new Error('저장된 이미지 형식이 올바르지 않습니다.')
        const decoded = new Image()
        decoded.src = saved.dataUrl
        await decoded.decode()
        if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error('저장된 이미지를 읽을 수 없습니다.')
        if (!cancelled) setOriginal({ dataUrl: saved.dataUrl, width: decoded.naturalWidth, height: decoded.naturalHeight })
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '원본 이미지를 불러오지 못했습니다.')
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [anchor.paperId, anchor.anchorId, attempt])
  const preview = anchor.preview?.startsWith('data:image/') ? anchor.preview : undefined
  const changeView = (next: 'fit' | 'actual') => {
    setView(next)
    stage.current?.scrollTo({ left: 0, top: 0 })
  }
  return <>
    <div className="figure-preview-controls" aria-label="이미지 배율">
      <div><button type="button" aria-pressed={view === 'fit'} onClick={() => changeView('fit')}>맞춤 보기</button><button type="button" aria-pressed={view === 'actual'} disabled={!original} onClick={() => changeView('actual')}>100% 원본 배율</button></div>
      {original && <span>{original.width} × {original.height}px</span>}
    </div>
    {loading && <p className="figure-preview-status" role="status">원본 이미지 불러오는 중…</p>}
    {error && <div className="figure-preview-error" role="alert"><span>원본을 불러오지 못했습니다.{preview ? ' 미리보기를 표시합니다.' : ''} {error}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div>}
    <div ref={stage} className={`figure-preview-stage ${view}`} tabIndex={0} role="region" aria-label={view === 'actual' ? '원본 이미지 · 방향키로 이동' : '첨부 이미지'}>
      {(original || preview) ? <img src={original?.dataUrl ?? preview} alt={`${anchor.paperTitle}의 ${anchor.label}`} style={view === 'actual' && original ? { width: original.width, height: original.height } : undefined} /> : <p>표시할 미리보기가 없습니다.</p>}
    </div>
    <p className="figure-preview-caption">{anchor.paperTitle}{view === 'actual' && ' · 스크롤하거나 방향키로 이미지를 이동할 수 있습니다.'}</p>
  </>
}
