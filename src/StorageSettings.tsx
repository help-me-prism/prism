import { useEffect, useState } from 'react'

export default function StorageSettings({ onChooseVault }: { onChooseVault: () => void }) {
  const [settings, setSettings] = useState<AppSettings>()
  const [error, setError] = useState('')
  const [reconnecting, setReconnecting] = useState(false)
  const [recovery, setRecovery] = useState('')
  useEffect(() => { window.prism.getSettings().then(setSettings).catch(reason => setError(String(reason))) }, [])
  async function choose(reset = false) {
    try { const next = await window.prism.choosePaperStorage(reset); if (next) setSettings(next) }
    catch (reason) { setError(String(reason)) }
  }
  async function reconnect() {
    setReconnecting(true); setError(''); setRecovery('')
    try {
      const result = await window.prism.reconnectPaperStorage()
      if (result) setSettings(await window.prism.getSettings())
      if (result?.noteWarnings) setError(`${result.noteWarnings}개 노트의 PDF 링크는 편집 충돌 또는 변경된 형식으로 자동 갱신하지 못했습니다. 노트의 PDF 속성을 확인해 주세요.`)
      if (result) setRecovery(result.restored ? `${result.restored}개 논문을 다시 연결했습니다.${result.skipped ? ` ${result.skipped}개는 같은 원본인지 확인하지 못해 유지했습니다.` : ''}` : '다시 연결할 논문을 찾지 못했습니다. 논문별 하위 폴더가 들어 있는 위치를 선택해 주세요. 이미 연결된 논문은 유지됩니다.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setReconnecting(false) }
  }
  return <div className="settings-section storage-settings">
    <strong>파일 보관 위치</strong>
    <p>노트 폴더는 Obsidian에서 볼트로 열 수 있습니다.</p>
    <label>노트 · Obsidian 볼트<output>{settings?.libraryPath ?? '아직 선택하지 않았습니다'}</output></label>
    <button className="settings-action" onClick={onChooseVault}>노트 볼트 선택</button>
    <label>새 논문의 PDF · 번역 · 피겨<output>{settings?.paperStoragePath ?? '노트 볼트 안에 함께 보관'}</output></label>
    <div className="storage-actions"><button className="settings-action" onClick={() => void choose()}>별도 폴더 선택</button>{settings?.paperStoragePath && <button className="settings-action" onClick={() => void choose(true)}>볼트에 함께 보관</button>}</div>
    <p>변경한 위치에는 새로 가져오는 논문을 저장합니다. 기존 파일은 원래 위치에서 계속 열립니다.</p>
    <button className="settings-action" disabled={reconnecting || !settings?.libraryPath} onClick={() => void reconnect()}>{reconnecting ? '논문 확인 중…' : '이동한 폴더 다시 연결'}</button>
    <p>외부 논문 폴더를 옮겼을 때 사용합니다. 같은 원본인지 확인한 논문만 연결하며 노트는 유지합니다.</p>
    {recovery && <p role="status">{recovery}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
