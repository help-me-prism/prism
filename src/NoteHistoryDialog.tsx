import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

type HistoryEntry = { id: string; createdAt: number; kind: 'before' | 'draft' | 'displaced'; size: number }
type Props = { nodeId: string; vaultId?: string; onClose: () => void; onRestore: (content: string) => Promise<void> }
const labels: Record<HistoryEntry['kind'], string> = { draft: 'Prism 편집본', before: '저장 시작 때 원본', displaced: '파일 교체 직전 원본' }
const descriptions = { draft: 'Prism에서 저장하려던 내용입니다. 실제 파일에 저장되지 않았을 수도 있습니다.', before: 'Prism이 저장을 시작하며 읽어 둔 파일 내용입니다.', displaced: '새 내용으로 바꾸기 직전의 파일입니다. 다른 앱에서 편집한 내용이 포함될 수 있습니다.' }

export default function NoteHistoryDialog(props: Props) {
  return createPortal(<HistoryContents key={`${props.vaultId}:${props.nodeId}`} {...props} />, document.body)
}

function HistoryContents({ nodeId, vaultId, onClose, onRestore }: Props) {
  const titleId = useId()
  const hintId = useId()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState('')
  const [loaded, setLoaded] = useState<{ id: string; content: string }>()
  const [listing, setListing] = useState(true)
  const [reading, setReading] = useState(false)
  const [listError, setListError] = useState('')
  const [readError, setReadError] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [listAttempt, setListAttempt] = useState(0)
  const [readAttempt, setReadAttempt] = useState(0)
  const [restoring, setRestoring] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useDialogFocus(true, '.note-history-dialog')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let cancelled = false
    setListing(true); setListError('')
    void (async () => {
      try {
        const result = await window.prism.listNoteHistory(nodeId, vaultId)
        if (cancelled) return
        const sorted = [...result].sort((a, b) => b.createdAt - a.createdAt)
        setEntries(sorted); setSelected(sorted[0]?.id ?? '')
      } catch (error) {
        if (!cancelled) setListError(error instanceof Error ? error.message : '저장 이력을 불러오지 못했습니다.')
      } finally { if (!cancelled) setListing(false) }
    })()
    return () => { cancelled = true }
  }, [nodeId, vaultId, listAttempt])
  useEffect(() => {
    let cancelled = false
    setLoaded(undefined); setReadError(''); setRestoreError('')
    if (!selected) { setReading(false); return }
    setReading(true)
    void (async () => {
      try {
        const content = await window.prism.readNoteHistory(nodeId, selected, vaultId)
        if (!cancelled) setLoaded({ id: selected, content })
      } catch (error) {
        if (!cancelled) setReadError(error instanceof Error ? error.message : '이 버전의 내용을 불러오지 못했습니다.')
      } finally { if (!cancelled) setReading(false) }
    })()
    return () => { cancelled = true }
  }, [nodeId, vaultId, selected, readAttempt])
  const close = () => { if (!busy.current) onClose() }
  const restore = async () => {
    if (busy.current || reading || loaded?.id !== selected) return
    busy.current = true; setRestoring(true); setRestoreError('')
    try {
      await onRestore(loaded.content)
      if (mounted.current) onClose()
    } catch (error) {
      if (mounted.current) setRestoreError(error instanceof Error ? error.message : '복원하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      busy.current = false
      if (mounted.current) setRestoring(false)
    }
  }
  const activeEntry = entries.find(entry => entry.id === selected)
  return <div className="note-history-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section className="note-history-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <header><h2 id={titleId}>저장 이력</h2><button type="button" aria-label="저장 이력 닫기" disabled={restoring} onClick={close}><X size={18} /></button></header>
      <p className="note-history-hint" id={hintId}>저장 과정에서 보관한 내용을 확인하고 복원할 수 있습니다. 복원 전의 현재 내용도 저장 이력에 남습니다.</p>
      {listing ? <p className="note-history-message" role="status">저장 이력을 불러오는 중…</p> : listError ? <div className="note-history-message" role="alert"><p>{listError}</p><button type="button" onClick={() => setListAttempt(value => value + 1)}>다시 시도</button></div> : !entries.length ? <p className="note-history-message">아직 저장 이력이 없습니다. 노트를 저장하면 이곳에서 이전 내용을 확인할 수 있습니다.</p> : <div className="note-history-body">
        <nav className="note-history-list" aria-label="저장된 버전"><ul>{entries.map(entry => <li key={entry.id}><button type="button" aria-current={selected === entry.id ? 'true' : undefined} disabled={restoring} onClick={() => setSelected(entry.id)}><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{labels[entry.kind]}</span></button></li>)}</ul></nav>
        <div className="note-history-preview" aria-busy={reading}>
          {reading || (!readError && loaded?.id !== selected) ? <p role="status">내용을 불러오는 중…</p> : readError ? <div role="alert"><p>{readError}</p><button type="button" onClick={() => setReadAttempt(value => value + 1)}>다시 시도</button></div> : <><h3>{activeEntry ? labels[activeEntry.kind] : '저장된 내용'}</h3>{activeEntry && <p>{descriptions[activeEntry.kind]}</p>}<pre tabIndex={0} aria-label="선택한 버전의 전체 내용">{loaded?.content || '(빈 노트)'}</pre></>}
        </div>
      </div>}
      {restoreError && <p className="note-history-error" role="alert">{restoreError}</p>}
      <footer>{restoring && <span role="status">복원 내용을 저장하는 중…</span>}<button type="button" disabled={restoring} onClick={close}>취소</button><button type="button" className="note-history-restore" disabled={listing || reading || restoring || !loaded || loaded.id !== selected || Boolean(listError || readError)} onClick={() => void restore()}>{restoring ? '복원 중…' : '이 버전으로 복원'}</button></footer>
    </section>
  </div>
}
