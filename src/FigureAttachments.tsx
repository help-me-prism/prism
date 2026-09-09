import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

/** The image preview never replaces the source reference sent to the backend. */
export default function FigureAttachments({ anchors }: { anchors: ContextAnchor[] }) {
  const [selected, setSelected] = useState<ContextAnchor>()
  useEffect(() => {
    if (selected && !anchors.some(anchor => anchor.paperId === selected.paperId && anchor.anchorId === selected.anchorId)) setSelected(undefined)
  }, [anchors, selected])
  useDialogFocus(Boolean(selected), '.figure-preview-dialog', '.composer-editor')
  const figures = anchors.filter((anchor, index) => anchor.type === 'figure' &&
    anchors.findIndex(other => other.paperId === anchor.paperId && other.anchorId === anchor.anchorId) === index)
  if (!figures.length) return null
  return <>
    <div className="figure-attachments" aria-label="질문에 첨부할 이미지">
      {figures.map(anchor => <button type="button" key={`${anchor.paperId}:${anchor.anchorId}`} className="figure-attachment" title={`${anchor.label} · ${anchor.page}쪽 이미지 확인`} onClick={() => setSelected(anchor)} disabled={!anchor.preview?.startsWith('data:image/')}>
        {anchor.preview?.startsWith('data:image/') && <img src={anchor.preview} alt="" />}
        <span>{anchor.label} · {anchor.page}쪽</span>
      </button>)}
    </div>
    {selected && createPortal(<div className="figure-preview-backdrop" onClick={event => { if (event.target === event.currentTarget) setSelected(undefined) }}>
      <section className="figure-preview-dialog" role="dialog" aria-modal="true" aria-label="첨부 이미지 확인" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSelected(undefined) } }}>
        <header><span>{selected.label} · {selected.page}쪽</span><button type="button" aria-label="이미지 확인 닫기" onClick={() => setSelected(undefined)}><X size={18} /></button></header>
        <img src={selected.preview} alt={`${selected.paperTitle}의 ${selected.label}`} />
        <p>{selected.paperTitle}</p>
      </section>
    </div>, document.body)}
  </>
}
