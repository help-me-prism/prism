import { useState } from 'react'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'
import './paper-title.css'

export default function PaperTitleDialog({ paper, libraryPath, readPdfTitle, onClose }: {
  paper: PaperRecord; libraryPath: string; readPdfTitle: () => Promise<string>; onClose: () => void;
}) {
  const [title, setTitle] = useState(paper.title)
  const [savedTitle, setSavedTitle] = useState(paper.title)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  useDialogFocus(true, '.paper-title-dialog')
  async function fromPdf() {
    setReading(true); setError('')
    try {
      const candidate = (await readPdfTitle()).replace(/\s+/g, ' ').trim()
      if (!candidate) setError('이 PDF에는 제목 정보가 없습니다. 제목을 직접 입력해 주세요.')
      else setTitle(candidate.slice(0, 1000))
    } catch { setError('PDF의 제목 정보를 읽지 못했습니다. 제목을 직접 입력해 주세요.') }
    finally { setReading(false) }
  }
  async function save() {
    if (busy || reading || !title.trim()) return
    setBusy(true); setError(''); setWarnings([])
    try {
      const result = await window.prism.updatePaperTitle({ paperId: paper.arxivId, title, expectedTitle: savedTitle, libraryPath })
      setTitle(result.paper.title); setSavedTitle(result.paper.title)
      if (result.warnings.length) setWarnings(result.warnings)
      else onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <div className="paper-title-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form className="paper-title-dialog" role="dialog" aria-modal="true" aria-labelledby="paper-title-heading" onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() } }}>
      <header><h2 id="paper-title-heading">논문 제목 편집</h2><button type="button" aria-label="제목 편집 닫기" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <label htmlFor="paper-title-input">제목</label>
      <textarea id="paper-title-input" autoFocus rows={3} maxLength={1000} value={title} disabled={busy || reading} onFocus={event => event.currentTarget.select()} onChange={event => setTitle(event.target.value)} />
      <button type="button" className="pdf-title-suggestion" disabled={busy || reading} onClick={() => void fromPdf()}>{reading ? 'PDF 정보 읽는 중…' : 'PDF에 저장된 제목 가져오기'}</button>
      <p className="paper-title-hint">논문 목록과 탭에 표시할 제목입니다.</p>
      {error && <p className="paper-title-error" role="alert">{error}</p>}
      {warnings.length > 0 && <div className="paper-title-error" role="alert"><p>논문 목록의 제목은 저장했습니다.</p>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      <footer><button type="button" disabled={busy} onClick={onClose}>{warnings.length ? '닫기' : '취소'}</button><button type="submit" className="primary" disabled={busy || reading || !title.trim() || title.trim() === savedTitle}>{busy ? '저장 중…' : '저장'}</button></footer>
    </form>
  </div>
}
