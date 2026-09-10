import { useEffect, useState } from 'react'
import type { AiRun } from '../electron/aiUsageTypes'

const labels: Record<string, string> = { context: '대화 문맥 정리', chat: '질문', translation: '번역', digest: '노트 정리', knowledge: '연결 제안', structure: '구조 분석' }
const number = (value?: number) => value === undefined ? '미제공' : value.toLocaleString()
export default function AiUsageHistory() {
  const [runs, setRuns] = useState<AiRun[]>()
  const [error, setError] = useState('')
  async function refresh() {
    try { setRuns((await window.prism.readAiUsage()).slice(-10).reverse()); setError('') }
    catch { setError('사용 기록을 읽지 못했습니다.') }
  }
  useEffect(() => { void refresh() }, [])
  return <div className="settings-section"><strong>AI 사용 기록</strong>
    <p>최근 작업의 입력·캐시·출력 토큰과 시간을 확인합니다. 캐시 토큰은 입력에 포함됩니다. CLI가 제공하지 않은 값은 추정하지 않습니다.</p>
    <button className="settings-action" onClick={() => void refresh()}>최근 사용 기록 {runs ? '새로고침' : '보기'}</button>
    {error && <p role="alert">{error}</p>}
    {runs?.length === 0 && <p>아직 기록된 AI 작업이 없습니다.</p>}
    {runs?.map(run => <p key={run.id}><strong>{labels[run.task] ?? run.task} · {run.model}</strong><br />
      {new Date(run.startedAt).toLocaleString()} · {(run.durationMs / 1000).toFixed(1)}초 · {run.status === 'completed' ? '완료' : '실패/중지'}<br />
      {run.measurement === 'last-request' ? '마지막 모델 요청: ' : ''}입력 {number(run.inputTokens)} · 캐시 {number(run.cachedInputTokens)} · 출력 {number(run.outputTokens)}<br />
      <small>앱이 보낸 텍스트 {number(run.inputCharacters)}자{run.inputComposition && <> · 질문 {number(run.inputComposition.question)} · 논문 발췌 {number(run.inputComposition.paperEvidence)} · 첨부 근거 {number(run.inputComposition.selectedEvidence)} · 안내 {number(run.inputComposition.instructions)}</>}<br />문자 수에는 CLI의 이전 대화·시스템 지침·도구·이미지가 포함되지 않습니다. 항목별 토큰 수는 CLI가 제공하지 않습니다.</small></p>)}
    {runs && <small>최대 500개 작업을 이 기기에 보관합니다. 질문·논문 본문은 이 기록에 저장하지 않습니다.</small>}
  </div>
}
