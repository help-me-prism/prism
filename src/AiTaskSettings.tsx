import { useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'

export type ModelTask = 'guide' | 'translation' | 'memory' | 'knowledge'

// One row per job the app can hand to a model. The name says what the researcher gets;
// the explanation says when it runs and what it costs, which is what decides the choice.
const tasks: Array<{ id: ModelTask; name: string; when: string; detail: string }> = [
  { id: 'translation', name: '논문 한국어 번역', when: '논문을 번역할 때',
    detail: '선택한 페이지나 본문 전체를 한국어로 옮깁니다. 수식·표·그림은 원문 그대로 두고, 숫자가 바뀐 문장은 저장하지 않고 원문을 유지합니다.' },
  { id: 'guide', name: '처음 읽기 요약', when: '논문을 처음 열 때',
    detail: '논문을 처음 열 때 핵심 원문을 골라 짧은 읽기 노트를 만듭니다. 같은 논문을 다시 열면 앞서 만든 결과를 그대로 씁니다.' },
  { id: 'memory', name: '대화 기억 정리', when: '대화가 끝났을 때',
    detail: '사용자가 직접 말한 연구 목적·남은 의문·판단을 근거와 함께 선별합니다. 기존 기억은 명시적인 변경 근거가 있을 때만 갱신합니다. 주제가 불명확한 이해 확인이나 일반적인 요약 요청은 저장하지 않습니다.' },
  { id: 'knowledge', name: '노트 정리·연결 제안', when: '직접 실행할 때만',
    detail: '노트를 정리하거나 논문 사이의 연결 후보를 찾습니다. 자동으로 돌지 않고, 버튼을 눌렀을 때만 실행합니다.' },
]

const toggles: Array<{ key: 'autoTranslate' | 'autoReadingGuide' | 'autoMemory' | 'showAiHighlights'; label: string; note?: string }> = [
  { key: 'autoTranslate', label: '새 논문을 저장하면 바로 번역 시작' },
  { key: 'autoReadingGuide', label: '논문을 처음 열면 읽기 요약 자동 생성' },
  { key: 'autoMemory', label: '대화가 끝나면 필요한 내용만 자동으로 노트에 기록', note: '직접 고친 문장은 유지합니다. 줄 끝이나 반복 공백만 바뀐 경우에는 계속 갱신할 수 있습니다.' },
  { key: 'showAiHighlights', label: '읽기 요약이 고른 문장을 본문에 표시' },
]

export default function AiTaskSettings({ providers }: { providers: ProviderInfo[] }) {
  const [settings, setSettings] = useState<AppSettings>()
  const [error, setError] = useState('')
  const [openDetail, setOpenDetail] = useState<ModelTask>()
  useEffect(() => {
    void window.prism.getSettings().then(setSettings).catch(reason => setError(String(reason)))
    return window.prism.onSettingsChanged(setSettings)
  }, [])
  async function update(patch: Partial<AppSettings>) {
    try { setSettings(await window.prism.updateSettings(patch)); setError('') } catch (reason) { setError(String(reason)) }
  }
  if (!settings) return <p>설정을 불러오는 중…</p>

  return <div className="settings-section ai-task-settings">
    <strong>작업별 AI</strong>
    <p>작업마다 어떤 CLI와 모델을 쓸지 정합니다. 이름 옆 <HelpCircle size={12} aria-hidden />를 누르면 그 작업이 언제 무엇을 하는지 볼 수 있습니다.</p>

    <table className="ai-task-table">
      <thead><tr><th scope="col">작업</th><th scope="col">CLI</th><th scope="col">모델</th></tr></thead>
      <tbody>{tasks.map(task => {
        const providerKey = `${task.id}Provider` as const, modelKey = `${task.id}Model` as const
        const provider = settings[providerKey] ?? (task.id === 'knowledge' ? '' : 'codex')
        const model = settings[modelKey] ?? (provider === 'claude' ? 'haiku' : 'gpt-5.6-luna')
        const models = providers.find(item => item.id === provider)?.models ?? []
        const open = openDetail === task.id
        return <tr key={task.id} data-task={task.id}>
          <th scope="row">
            <span className="task-name">
              {task.name}
              <button type="button" className="task-help" aria-expanded={open} aria-label={`${task.name} 설명`}
                onClick={() => setOpenDetail(open ? undefined : task.id)}><HelpCircle size={13} /></button>
            </span>
            <small>{task.when}</small>
            {open && <p className="task-detail" role="note">{task.detail}</p>}
          </th>
          <td><select aria-label={`${task.name} CLI`} value={provider} onChange={event => {
            const next = event.target.value as ProviderId
            void update({ [providerKey]: next, [modelKey]: next === 'claude' ? 'haiku' : 'gpt-5.6-luna' })
          }}>
            {!provider && <option value="" disabled>선택 필요</option>}
            {(['codex', 'claude'] as const).map(id => <option value={id} key={id}>
              {id === 'codex' ? 'Codex' : 'Claude'}{providers.find(item => item.id === id)?.available ? '' : ' · 연결 필요'}
            </option>)}
          </select></td>
          <td><select disabled={!provider} aria-label={`${task.name} 모델`} value={model}
            onChange={event => void update({ [modelKey]: event.target.value })}>
            {!models.some(item => item.id === model) && <option value={model}>{model}</option>}
            {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></td>
        </tr>
      })}</tbody>
    </table>

    <label className="ai-task-concurrency">논문 하나의 동시 번역 수 <select aria-label="논문 하나의 동시 번역 수" value={settings.translationConcurrency ?? 3}
      onChange={event => void update({ translationConcurrency: Number(event.target.value) })}>
      <option value={1}>1 · 순차 처리</option><option value={2}>2</option><option value={3}>3 · 기본</option>
    </select></label>
    <p>여러 논문을 번역해도 같은 CLI의 번역·요약·정리 작업은 전체 3개까지 동시에 실행합니다. 사용 한도 오류가 잦으면 동시 번역 수를 줄여 주세요.</p>

    <div className="ai-task-toggles">
      <strong>자동 실행</strong>
      {toggles.map(item => <label key={item.key}>
        <input type="checkbox" checked={settings[item.key] !== false} onChange={event => void update({ [item.key]: event.target.checked })} />
        <span>{item.label}{item.note && <small>{item.note}</small>}</span>
      </label>)}
    </div>

    <small>질문(채팅)에 쓰는 모델은 대화창 위에서 대화방마다 따로 고릅니다.</small>
    {error && <p role="alert">{error}</p>}
  </div>
}
