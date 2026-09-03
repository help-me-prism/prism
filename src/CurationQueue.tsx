import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Check, GitMerge, Inbox, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'

import { relationLabels, typeLabels } from './knowledgeModel'

/**
 * Curation queue: the weekly batch view. Nothing here writes structure automatically —
 * every row is a decision the researcher makes (approve, promote, merge, start, delete).
 */
export default function CurationQueue({ onOpenNode, onChanged, onCount }: { onOpenNode: (id: string) => void; onChanged: () => void | Promise<void>; onCount?: (count: number) => void }) {
  const [queue, setQueue] = useState<CurationQueue>()
  const [concepts, setConcepts] = useState<KnowledgeNodeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [promoting, setPromoting] = useState<{ memo: CurationMemo; nodeType: 'claim' | 'question'; title: string }>()
  const [merging, setMerging] = useState<{ stub: CurationStub; query: string; similar?: KnowledgeSuggestion[] }>()
  const [deleteReadyId, setDeleteReadyId] = useState<string>()

  async function load() {
    setLoading(true)
    try {
      const [next, nodes] = await Promise.all([window.prism.listCurationQueue(), window.prism.listKnowledgeNodes()])
      setQueue(next); setConcepts(nodes.filter((node) => node.nodeType === 'concept')); onCount?.(next.total)
    } catch (reason) { setMessage(String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function run(action: () => Promise<string>) {
    try { setMessage(await action()); await load(); await onChanged() }
    catch (reason) { setMessage(String(reason)) }
  }
  function reviewRelation(item: CurationPendingRelation, decision: 'approved' | 'rejected') {
    return run(async () => {
      const snapshot = await window.prism.readKnowledgeNode(item.source.id)
      const result = await window.prism.reviewKnowledgeRelation({ id: item.relation.id, decision, expectedRevision: snapshot.revision })
      if (!result.saved) throw new Error('출발 노트가 외부에서 변경되어 검토 결과를 저장하지 않았습니다.')
      return decision === 'approved' ? `'${item.source.title} → ${item.target.title}' 관계를 승인했습니다.` : 'AI 관계를 거절했습니다.'
    })
  }
  function startStub(stub: CurationStub) {
    return run(async () => {
      const snapshot = await window.prism.readKnowledgeNode(stub.node.id)
      const result = await window.prism.updateKnowledgeProperties(stub.node.id, { status: 'developing' }, snapshot.revision)
      if (!result.saved) throw new Error('노트가 외부에서 변경되어 상태를 바꾸지 않았습니다.')
      onOpenNode(stub.node.id)
      return `'${stub.node.title}' 정리를 시작합니다. 정의 비교 표를 채우세요.`
    })
  }
  function deleteStub(stub: CurationStub) {
    if (deleteReadyId !== stub.node.id) { setDeleteReadyId(stub.node.id); setMessage('한 번 더 누르면 스텁을 휴지통으로 보냅니다. 링크는 그대로 남습니다.'); return }
    setDeleteReadyId(undefined)
    return run(async () => { await window.prism.deleteKnowledgeNode(stub.node.id); return `'${stub.node.title}' 스텁을 휴지통으로 보냈습니다.` })
  }
  // The local suggestion engine knows which concepts overlap; surface it exactly where merging is decided.
  async function findSimilar(stub: CurationStub) {
    try {
      const suggestions = await window.prism.suggestKnowledge(stub.node.id)
      setMerging({ stub, query: '', similar: suggestions.filter((item) => item.kind === 'duplicate_concept' && item.target) })
    } catch (reason) { setMessage(String(reason)) }
  }
  function merge(stub: CurationStub, target: KnowledgeNodeRecord) {
    setMerging(undefined)
    return run(async () => { await window.prism.mergeConcepts({ sourceId: stub.node.id, targetId: target.id }); return `'${stub.node.title}'을(를) '${target.title}'에 병합하고 링크를 옮겼습니다.` })
  }
  function reviewSuggestion(paperNodeId: string, id: string, decision: 'accepted' | 'rejected', label: string) {
    return run(async () => { await window.prism.reviewModelSuggestion({ paperNodeId, id, decision }); return decision === 'accepted' ? `'${label}' Concept 스텁을 Inbox에 만들었습니다.` : `'${label}' 제안을 무시했습니다.` })
  }
  function promote() {
    if (!promoting) return
    const { memo, nodeType, title } = promoting
    setPromoting(undefined)
    return run(async () => {
      const result = await window.prism.promoteMemo({ paperNodeId: memo.paper.id, blockId: memo.blockId, memo: memo.memo, nodeType, title })
      onOpenNode(result.id)
      return `'${title}' ${nodeType === 'claim' ? '주장' : '질문'} 노트로 승격하고 근거와 출처를 유지했습니다.`
    })
  }
  const mergeTargets = useMemo(() => {
    if (!merging) return []
    const query = merging.query.trim().toLocaleLowerCase()
    const similarIds = new Set((merging.similar ?? []).map((item) => item.target?.id))
    return concepts
      .filter((node) => node.id !== merging.stub.node.id && (!query || `${node.title} ${node.preview}`.toLocaleLowerCase().includes(query)))
      .sort((left, right) => Number(similarIds.has(right.id)) - Number(similarIds.has(left.id)) || left.title.localeCompare(right.title))
      .slice(0, 30)
  }, [concepts, merging])

  return <section className="curation-queue" aria-label="정리 대기열">
    <header><div><Inbox size={17} /><span><h3>정리 대기열</h3><p>읽는 동안 쌓인 링크, 필기, AI 제안을 한 번에 결정합니다. 자동으로 확정되는 것은 없습니다.</p></span></div><button aria-label="정리 대기열 새로고침" onClick={() => void load()}><RefreshCw size={13} /></button></header>
    {message && <p className="curation-message" role="status">{message}</p>}
    {queue?.modelRuns.length ? <p className="curation-runs">최근 모델 제안: {queue.modelRuns.slice(0, 3).map((run) => `${run.paperTitle} (${new Date(run.ranAt).toLocaleDateString()} · ${run.model} · 관계 ${run.relationsCreated}개)`).join(' · ')}</p> : null}
    {loading && !queue ? <p className="curation-empty">대기열을 계산하는 중…</p> : queue && <div className="curation-sections">
      <article className={`curation-section${queue.pendingRelations.length ? '' : ' is-empty'}`}>
        <header><span><strong>AI 관계 제안</strong><small>승인해야 노트와 그래프에 반영됩니다</small></span><em>{queue.pendingRelations.length}</em></header>
        {queue.pendingRelations.length ? queue.pendingRelations.map((item) => <div key={item.relation.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(item.source.id)}><small>{typeLabels[item.source.nodeType]} → {relationLabels[item.relation.type] ?? item.relation.type} → {typeLabels[item.target.nodeType]}</small><strong>{item.source.title} → {item.target.title}</strong>{item.relation.evidenceAnchor && <p>근거: {item.relation.evidenceAnchor.label} (p.{item.relation.evidenceAnchor.page})</p>}</button><div className="curation-actions"><button onClick={() => void reviewRelation(item, 'approved')}><Check size={11} /> 승인</button><button onClick={() => void reviewRelation(item, 'rejected')}><X size={11} /> 거절</button></div></div>) : <p className="curation-empty">검토할 AI 관계가 없습니다.</p>}
      </article>
      <article className={`curation-section${queue.stubs.length ? '' : ' is-empty'}`}>
        <header><span><strong>링크만 있는 개념</strong><small>백링크 2개 이상이면 노트를 쓸 가치가 증명된 것입니다</small></span><em>{queue.stubs.length}</em></header>
        {queue.stubs.length ? queue.stubs.map((stub) => <div key={stub.node.id} className={`curation-item${stub.ready ? ' is-ready' : ''}`}><button className="curation-open" onClick={() => onOpenNode(stub.node.id)}><small>{stub.ready ? '정리할 때가 됨' : '아직 링크 부족'} · 백링크 {stub.backlinks}</small><strong>{stub.node.title}</strong></button><div className="curation-actions"><button onClick={() => void startStub(stub)}><ArrowUpRight size={11} /> 정리 시작</button><button onClick={() => void findSimilar(stub)}><GitMerge size={11} /> 병합</button><button className={deleteReadyId === stub.node.id ? 'danger' : ''} onClick={() => void deleteStub(stub)}><Trash2 size={11} /> {deleteReadyId === stub.node.id ? '삭제 확인' : '삭제'}</button></div>{merging?.stub.node.id === stub.node.id && <div className="curation-form"><input autoFocus aria-label="병합 대상 개념 검색" value={merging.query} placeholder="병합할 개념 검색" onChange={(event) => setMerging({ ...merging, query: event.target.value })} />{merging.similar?.length ? <p className="curation-similar">비슷한 개념: {merging.similar.map((item) => item.target!.title).join(', ')}</p> : null}<div className="curation-choices">{mergeTargets.length ? mergeTargets.map((target) => <button key={target.id} onClick={() => void merge(stub, target)}>{target.title}<small>{merging.similar?.some((item) => item.target?.id === target.id) ? '의미가 비슷함' : target.status === 'inbox' ? '스텁' : target.relativePath}</small></button>) : <p>병합할 다른 개념이 없습니다.</p>}</div><button className="curation-cancel" onClick={() => setMerging(undefined)}>취소</button></div>}</div>) : <p className="curation-empty">정리를 기다리는 개념이 없습니다.</p>}
      </article>
      <article className={`curation-section${queue.memos.length ? '' : ' is-empty'}`}>
        <header><span><strong>승격 대기 필기</strong><small>근거 카드 아래에 쓴 메모입니다. 문장은 직접 다듬어 승격합니다</small></span><em>{queue.memos.length}</em></header>
        {queue.memos.length ? queue.memos.map((memo) => { const key = `${memo.paper.id}:${memo.blockId}:${memo.memo.slice(0, 40)}`; const open = promoting?.memo === memo; return <div key={key} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(memo.paper.id)}><small>{memo.paper.title}{memo.anchorLabel ? ` · ${memo.anchorLabel}` : ''}</small><strong>{memo.memo}</strong>{memo.anchorSource && <p>{memo.anchorSource}</p>}{memo.aiHint && <span className="curation-ai-hint">AI: {memo.aiHint.kind === 'claim' ? 'Claim감' : 'Question감'}{memo.aiHint.why ? ` · ${memo.aiHint.why}` : ''}</span>}</button><div className="curation-actions"><button onClick={() => setPromoting(open && promoting?.nodeType === 'claim' ? undefined : { memo, nodeType: 'claim', title: memo.memo.split('\n')[0].slice(0, 120) })}><Sparkles size={11} /> 주장으로</button><button onClick={() => setPromoting(open && promoting?.nodeType === 'question' ? undefined : { memo, nodeType: 'question', title: memo.memo.split('\n')[0].slice(0, 120) })}><Sparkles size={11} /> 질문으로</button>{memo.aiHint && <button aria-label="AI 힌트 무시" onClick={() => void reviewSuggestion(memo.paper.id, memo.aiHint!.id, 'rejected', memo.aiHint!.kind === 'claim' ? 'Claim감' : 'Question감')}><X size={11} /> 힌트 무시</button>}</div>{open && promoting && <div className="curation-form"><label><span>{promoting.nodeType === 'claim' ? '주장 문장 (내 말로)' : '질문 문장'}</span><input autoFocus aria-label="승격 노트 제목" value={promoting.title} onChange={(event) => setPromoting({ ...promoting, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void promote() } }} /></label><div className="curation-form-actions"><button className="curation-cancel" onClick={() => setPromoting(undefined)}>취소</button><button className="primary" onClick={() => void promote()}>승격하기</button></div></div>}</div> }) : <p className="curation-empty">승격을 기다리는 필기가 없습니다. Reader에서 문장을 우클릭해 메모를 담으세요.</p>}
      </article>
      <article className={`curation-section${queue.conceptSuggestions.length ? '' : ' is-empty'}`}>
        <header><span><strong>AI가 제안한 새 개념</strong><small>수락하면 빈 노트가 만들어집니다. 정의는 직접 씁니다</small></span><em>{queue.conceptSuggestions.length}</em></header>
        {queue.conceptSuggestions.length ? queue.conceptSuggestions.map((item) => <div key={item.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(item.paperNodeId)}><small>{item.paperTitle}에서 제안</small><strong>{item.title}</strong>{item.reason && <p>{item.reason}</p>}</button><div className="curation-actions"><button onClick={() => void reviewSuggestion(item.paperNodeId, item.id, 'accepted', item.title)}><Check size={11} /> 스텁 만들기</button><button onClick={() => void reviewSuggestion(item.paperNodeId, item.id, 'rejected', item.title)}><X size={11} /> 거절</button></div></div>) : <p className="curation-empty">제안된 새 개념이 없습니다.</p>}
      </article>
      <article className={`curation-section${queue.unsupportedClaims.length ? '' : ' is-empty'}`}>
        <header><span><strong>근거 없는 주장</strong><small>PDF 근거 카드나 승인된 지지 관계가 필요합니다</small></span><em>{queue.unsupportedClaims.length}</em></header>
        {queue.unsupportedClaims.length ? queue.unsupportedClaims.map((node) => <div key={node.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(node.id)}><small>주장 · {node.relativePath}</small><strong>{node.title}</strong></button></div>) : <p className="curation-empty">모든 주장에 근거가 있습니다.</p>}
      </article>
      <article className={`curation-section${queue.unansweredQuestions.length ? '' : ' is-empty'}`}>
        <header><span><strong>열린 질문</strong><small>답하는 관계가 승인되거나 정리됨 상태가 되면 사라집니다</small></span><em>{queue.unansweredQuestions.length}</em></header>
        {queue.unansweredQuestions.length ? queue.unansweredQuestions.map((node) => <div key={node.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(node.id)}><small>질문 · {node.relativePath}</small><strong>{node.title}</strong></button></div>) : <p className="curation-empty">열린 질문이 없습니다.</p>}
      </article>
    </div>}
  </section>
}
