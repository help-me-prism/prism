import { useEffect, useState } from 'react'
export type ModelTask = 'guide' | 'translation' | 'memory' | 'knowledge' | 'structure'
const descriptions: Record<ModelTask, [string, string]> = {
  guide: ['처음 읽기', '논문을 처음 열 때 핵심 원문을 고르고 짧은 읽기 노트를 만듭니다. 원문이 같으면 기존 결과를 재사용합니다.'],
  translation: ['논문 번역', '선택한 페이지 또는 본문을 번역합니다.'],
  memory: ['대화 메모리', '대화가 끝나면 연구 목적·남은 의문·판단 변화를 선별합니다. 인사나 일반 요약 요청은 저장하지 않습니다.'],
  knowledge: ['지식 정리·연결 후보', '명시적으로 실행하는 노트 정리와 논문 연결 후보에 사용합니다.'],
  structure: ['논문 구조 분석', '구조 맵에서 실행하는 AI 구조 분석에 사용합니다.'],
}
export default function TaskSettings({ task, providers }: { task: ModelTask; providers: ProviderInfo[] }) {
  const [settings, setSettings] = useState<AppSettings>()
  const [error, setError] = useState('')
  useEffect(() => { void window.prism.getSettings().then(setSettings).catch(reason => setError(String(reason))); return window.prism.onSettingsChanged(setSettings) }, [])
  async function update(patch: Partial<AppSettings>) { try { setSettings(await window.prism.updateSettings(patch)); setError('') } catch (reason) { setError(String(reason)) } }
  if (!settings) return <p>설정을 불러오는 중…</p>
  const providerKey = `${task}Provider` as const, modelKey = `${task}Model` as const
  const provider = settings[providerKey] ?? (task === 'structure' ? settings.knowledgeProvider : undefined) ?? (task === 'knowledge' || task === 'structure' ? '' : 'codex')
  const model = settings[modelKey] ?? (task === 'structure' ? settings.knowledgeModel : undefined) ?? (provider === 'claude' ? 'haiku' : 'gpt-5.6-luna')
  const models = providers.find(item => item.id === provider)?.models ?? []
  const [title, description] = descriptions[task]
  return <div className="settings-section task-model-settings"><h3>{title}</h3><p>{description}</p>
    <label>사용할 CLI<select aria-label={`${title} CLI`} value={provider} onChange={event => { const next = event.target.value as ProviderId; void update({ [providerKey]: next, [modelKey]: next === 'claude' ? 'haiku' : 'gpt-5.6-luna' }) }}>
      {!provider && <option value="" disabled>CLI 선택 필요</option>}
      {['codex', 'claude'].map(id => <option value={id} key={id}>{id === 'codex' ? 'Codex' : 'Claude'}{providers.find(item => item.id === id)?.available ? '' : ' · 연결 필요'}</option>)}
    </select></label>
    <label>모델<select disabled={!provider} aria-label={`${title} 모델`} value={model} onChange={event => void update({ [modelKey]: event.target.value })}>
      {!models.some(item => item.id === model) && <option value={model}>{model}</option>}{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {task === 'guide' && <><label><input type="checkbox" checked={settings.autoReadingGuide !== false} onChange={event => void update({ autoReadingGuide: event.target.checked })} /> 처음 열 때 자동 정리 · AI 사용</label><label><input type="checkbox" checked={settings.showAiHighlights !== false} onChange={event => void update({ showAiHighlights: event.target.checked })} /> AI 하이라이트 표시</label></>}
    {task === 'memory' && <><label><input type="checkbox" checked={settings.autoMemory !== false} onChange={event => void update({ autoMemory: event.target.checked })} /> 필요한 대화만 자동 메모 · AI 사용</label><p>직접 고친 문장은 유지합니다. 줄 끝·반복 공백만 바꾼 경우에는 AI가 계속 갱신할 수 있습니다.</p></>}
    {task === 'translation' && <label><input type="checkbox" checked={settings.autoTranslate} onChange={event => void update({ autoTranslate: event.target.checked })} /> 새 논문 자동 번역 · AI 사용</label>}
    <small>선택한 작업에 적용합니다. 채팅 모델은 대화창에서 선택합니다.</small>{error && <p role="alert">{error}</p>}
  </div>
}
