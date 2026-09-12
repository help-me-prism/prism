import { useMemo } from 'react'
import { ArrowUpRight, BookOpen, Lightbulb } from 'lucide-react'
import { readRecallField, recallSections, type RecallSection } from '../electron/paperRecall'
import { scientificPreviewText } from '../electron/scientificSource'
import { type EmbeddedEvidence, evidenceTypeLabel } from './evidence'

const prompts = {
  restate: { title: '기억할 핵심', hint: '나중의 내가 이 논문을 떠올릴 수 있게, 내 말로 한 줄.', placeholder: '무엇을 어떻게 해결했고, 어떤 결과를 보여줬나요?' },
  unresolved: { title: '남은 질문', hint: '결과를 어디까지 믿을 수 있을까요?', placeholder: '아직 이해하지 못한 점이나 확인하고 싶은 한계는?' },
  apply: { title: '내 연구에 쓸 아이디어', hint: '내가 바꿔볼 조건과, 가장 먼저 확인할 것을 적어보세요.', placeholder: '이 방법을 내 데이터에 적용한다면? 먼저 어떤 실험을 해볼까요?' },
}

export default function PaperRecall({ content, evidence, onChange, onBlur, onFullNote, onOpenEvidence, readingStatus, onRead, disabled }: {
  content: string; evidence: EmbeddedEvidence[]; onChange: (section: RecallSection, value: string) => void; onBlur: () => void;
  onFullNote: () => void; onOpenEvidence: (item: EmbeddedEvidence) => void; readingStatus?: KnowledgeReadingStatus; onRead: () => void; disabled: boolean
}) {
  const fields = useMemo(() => recallSections.map(section => {
    try { return { section, value: readRecallField(content, section), error: '' } }
    catch (reason) { return { section, value: '', error: reason instanceof Error ? reason.message : String(reason) } }
  }), [content])
  return <section className="paper-recall" aria-label="논문 되짚기">
    <div className="paper-recall-intro"><div><span className="recall-eyebrow">읽은 것을 내 것으로</span><h2>이 논문에서 무엇을 가져갈까요?</h2><p>핵심 한 줄이면 시작하기에 충분합니다. 질문과 아이디어는 떠오를 때 덧붙이세요.</p></div><span className="recall-personal"><Lightbulb size={15} /> 내 생각</span></div>
    <div className="recall-fields">{fields.map(({ section, value, error }, index) => <div className={`recall-field recall-field-${section}`} key={section}>
      <label htmlFor={`recall-${section}`}><span className="recall-step">0{index + 1}</span><span>{prompts[section].title}{index > 0 && <small>선택</small>}</span></label>
      <p id={`recall-hint-${section}`}>{prompts[section].hint}</p>
      {error ? <p role="alert">{error} <button onClick={onFullNote}>전체 노트 열기</button></p> : <textarea id={`recall-${section}`} aria-label={prompts[section].title} aria-describedby={`recall-hint-${section}`} rows={section === 'restate' ? 2 : 3} placeholder={prompts[section].placeholder} value={value} disabled={disabled} onChange={event => onChange(section, event.target.value)} onBlur={onBlur} />}
    </div>)}</div>
    <details className="recall-evidence"><summary><BookOpen size={15} /><span>기억을 도와줄 근거와 메모</span><small>{evidence.length ? `PDF 근거 ${evidence.length}개` : '저장한 기록 보기'}</small></summary>
      <p>읽으면서 저장한 기록이 필요하면 이곳에서 확인하세요.</p>
      {evidence.slice(0, 4).map(item => <button className="recall-source" key={item.blockId} onClick={() => onOpenEvidence(item)}><span><small>{evidenceTypeLabel(item.type)} · p.{item.page}</small><span>{scientificPreviewText(item.source, undefined)}</span></span><ArrowUpRight size={15} /></button>)}
      <button className="recall-full-link" onClick={onFullNote}>메모·AI 답변과 전체 노트 보기 <ArrowUpRight size={14} /></button>
    </details>
    <footer className="recall-done"><span>{readingStatus === 'read' ? '읽기를 마친 논문입니다. 생각은 언제든 고칠 수 있어요.' : '여기까지 읽었다면, 읽은 논문으로 표시해두세요.'}</span><button disabled={disabled || readingStatus === 'read'} onClick={onRead}>{readingStatus === 'read' ? '읽음' : '읽기 마침'}</button></footer>
  </section>
}
