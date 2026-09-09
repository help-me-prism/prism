import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

type Kind = 'draft' | 'before' | 'displaced'
type Recovery = { id: string; noteFile: string; relativePath: string; createdAt: number; kinds: Kind[] }
const labels: Record<Kind, string> = { draft: 'Prism 편집본', before: '저장 시작 때 원본', displaced: '파일 교체 직전 원본' }
const descriptions = { draft: 'Prism에서 저장하려던 내용입니다. 실제 파일에 저장되지 않았을 수도 있습니다.', before: 'Prism이 저장을 시작하며 읽어 둔 파일 내용입니다.', displaced: '새 내용으로 바꾸기 직전의 파일입니다. 다른 앱에서 편집한 내용이 포함될 수 있습니다.' }

export default function NoteRecoveryNotice({ onRestored }: { onRestored: () => Promise<void> | void }) {
  const [entries, setEntries] = useState<Recovery[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let disposed = false
    let sequence = 0
    const reload = async () => {
      const request = ++sequence
      try {
        const result = await window.prism.listPendingNoteRecoveries()
        if (!disposed && request === sequence) { setEntries(result); setError('') }
      } catch (reason) { if (!disposed && request === sequence) setError(reason instanceof Error ? reason.message : '복구 가능한 노트를 확인하지 못했습니다.') }
    }
    void reload()
    const stop = window.prism.onVaultChanged(() => void reload())
    return () => { disposed = true; stop() }
  }, [attempt])
  return <>
    {(entries.length > 0 || error) && <div className="note-recovery-notice">
      <span>{error ? `복구 가능한 노트를 확인하지 못했습니다. ${error}` : `파일을 찾을 수 없는 노트의 복구본 ${entries.length}건이 있습니다.`}</span>
      {error && <button type="button" title={error} onClick={() => setAttempt(value => value + 1)}>다시 확인</button>}
      {entries.length > 0 && <button type="button" onClick={() => setOpen(true)}>내용 확인</button>}
    </div>}
    {open && <RecoveryDialog entries={entries} onClose={() => setOpen(false)} onRestored={async () => { setAttempt(value => value + 1); await onRestored() }} />}
  </>
}

function RecoveryDialog({ entries, onClose, onRestored }: { entries: Recovery[]; onClose: () => void; onRestored: () => Promise<void> }) {
  const title = useId()
  const hint = useId()
  const descriptionId = useId()
  const [entry, setEntry] = useState<Recovery | undefined>(entries[0])
  const [kind, setKind] = useState<Kind | undefined>(entries[0]?.kinds[0])
  const [loaded, setLoaded] = useState<{ key: string; content: string }>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [restoring, setRestoring] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  const selectionKey = entry && kind ? `${entry.id}:${kind}` : ''
  useDialogFocus(true, '.note-recovery-dialog')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let cancelled = false
    setLoaded(undefined); setReadError(''); setError('')
    if (!entry || !kind) { setReading(false); return }
    setReading(true)
    void window.prism.readPendingNoteRecovery(entry.id, kind).then(content => {
      if (!cancelled) setLoaded({ key: selectionKey, content })
    }).catch(reason => { if (!cancelled) setReadError(reason instanceof Error ? reason.message : '복구본을 읽지 못했습니다.') }).finally(() => { if (!cancelled) setReading(false) })
    return () => { cancelled = true }
  }, [entry?.id, kind, selectionKey, attempt])
  const close = () => { if (!busy.current) onClose() }
  const restore = async () => {
    if (busy.current || !entry || !kind || reading || loaded?.key !== selectionKey) return
    busy.current = true; setRestoring(true); setError('')
    try {
      await window.prism.recoverPendingNote(entry.id, kind)
      if (!mounted.current) return
      await onRestored()
      if (mounted.current) onClose()
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '복구하지 못했습니다. 복구본은 그대로 보존됩니다.') }
    finally { busy.current = false; if (mounted.current) setRestoring(false) }
  }
  return createPortal(<div className="note-history-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section className="note-history-dialog note-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={hint} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <header><h2 id={title}>중단된 노트 복구</h2><button type="button" aria-label="노트 복구 닫기" disabled={restoring} onClick={close}><X size={18} /></button></header>
      <p className="note-history-hint" id={hint}>현재 파일을 찾을 수 없는 노트의 보관본입니다. 내용을 확인하고 원래 위치에 복구할 수 있습니다. 같은 위치에 파일이 있으면 덮어쓰지 않습니다.</p>
      <div className="note-history-body">
        <nav className="note-history-list" aria-label="복구 가능한 노트"><ul>{entries.map(item => <li key={item.id}><button type="button" disabled={restoring} aria-current={entry?.id === item.id ? 'true' : undefined} onClick={() => { setEntry(item); setKind(item.kinds[0]) }}><strong className="note-recovery-filename">{item.noteFile}</strong><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time><span className="note-recovery-path">{item.relativePath}</span></button></li>)}</ul></nav>
        <div className="note-history-preview" aria-busy={reading}>
          {entry ? <><label className="note-recovery-version">복구할 버전<select aria-describedby={descriptionId} disabled={restoring} value={kind ?? ''} onChange={event => setKind(event.target.value as Kind)}>{entry.kinds.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>{kind && <p id={descriptionId}>{descriptions[kind]}</p>}
            {reading || (!readError && loaded?.key !== selectionKey) ? <p role="status">내용을 불러오는 중…</p> : readError ? <div role="alert"><p>{readError}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div> : <pre tabIndex={0} aria-describedby={descriptionId} aria-label="복구할 버전의 전체 내용">{loaded?.content || '(빈 노트)'}</pre>}
          </> : <p>복구할 노트를 선택하세요.</p>}
        </div>
      </div>
      {error && <p className="note-history-error" role="alert">{error}</p>}
      <footer>{restoring && <span role="status">노트를 복구하는 중…</span>}<button type="button" disabled={restoring} onClick={close}>취소</button><button type="button" className="note-history-restore" disabled={restoring || reading || !loaded || loaded.key !== selectionKey || Boolean(readError)} onClick={() => void restore()}>이 버전으로 노트 복구</button></footer>
    </section>
  </div>, document.body)
}
