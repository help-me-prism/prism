import { useEffect, useState } from 'react'

export default function StorageSettings({ onChooseVault }: { onChooseVault: () => void }) {
  const [settings, setSettings] = useState<AppSettings>()
  const [error, setError] = useState('')
  useEffect(() => { window.prism.getSettings().then(setSettings).catch(reason => setError(String(reason))) }, [])
  async function choose(reset = false) {
    try { const next = await window.prism.choosePaperStorage(reset); if (next) setSettings(next) }
    catch (reason) { setError(String(reason)) }
  }
  return <div className="settings-section storage-settings">
    <strong>파일 보관 위치</strong>
    <p>노트 폴더는 Obsidian에서 볼트로 열 수 있습니다.</p>
    <label>노트 · Obsidian 볼트<output>{settings?.libraryPath ?? '아직 선택하지 않았습니다'}</output></label>
    <button className="settings-action" onClick={onChooseVault}>노트 볼트 선택</button>
    <label>새 논문의 PDF · 번역 · 피겨<output>{settings?.paperStoragePath ?? '노트 볼트 안에 함께 보관'}</output></label>
    <div className="storage-actions"><button className="settings-action" onClick={() => void choose()}>별도 폴더 선택</button>{settings?.paperStoragePath && <button className="settings-action" onClick={() => void choose(true)}>볼트에 함께 보관</button>}</div>
    <p>변경한 위치에는 새로 가져오는 논문을 저장합니다. 기존 파일은 원래 위치에서 계속 열립니다.</p>
    {error && <p role="alert">{error}</p>}
  </div>
}
