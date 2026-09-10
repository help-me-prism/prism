import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [promotingApply, setPromotingApply] = useState<{ node: KnowledgeNodeRecord; line: string; title: string }>()
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
    return run(async () => { await window.prism.reviewModelSuggestion({ paperNodeId, id, decision }); return decision === 'accepted' ? `'${label}' 노트를 만들었습니다.` : `'${label}' 제안을 무시했습니다.` })
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
  // Their own sentence becomes a Claim they own; the paper did not make it, so it inherits no evidence.
  function promoteApply() {
    if (!promotingApply) return
    const { node, line, title } = promotingApply
    setPromotingApply(undefined)
    return run(async () => {
      const result = await window.prism.promoteApplyNote({ nodeId: node.id, line, title })
      onOpenNode(result.id)
      return `'${title}'을(를) 내 주장으로 올렸습니다. 근거를 붙이면 대기열에서 빠집니다.`
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
    {loading && !queue ? <p className="curation-empty">대기열을 계산하는 중…</p> : queue && (queue.total === 0
      ? <p className="curation-empty">지금 결정할 것이 없습니다. 논문을 읽고 문장을 담으면 여기에 쌓입니다.</p>
      : <div className="curation-sections">
      {queue.pendingRelations.length > 0 && <article className="curation-section">
        <header><span><strong>AI 관계 제안</strong><small>승인해야 노트와 그래프에 반영됩니다</small></span><em>{queue.pendingRelations.length}</em></header>
        {queue.pendingRelations.map((item) => <div key={item.relation.id} className="curation-item">
          <div className="curation-relation-detail">
            <button type="button" className="curation-open" title="출발 노트 열기" onClick={() => onOpenNode(item.source.id)}><small>{typeLabels[item.source.nodeType]} → {relationLabels[item.relation.type] ?? item.relation.type} → {typeLabels[item.target.nodeType]}</small><strong>{item.source.title} → {item.target.title}</strong></button>
            {item.relation.evidenceAnchor && <RelationEvidenceButton anchor={item.relation.evidenceAnchor} />}
          </div>
          <div className="curation-actions"><button onClick={() => void reviewRelation(item, 'approved')}><Check size={11} /> 승인</button><button onClick={() => void reviewRelation(item, 'rejected')}><X size={11} /> 거절</button></div>
        </div>)}
      </article>}
      {queue.stubs.length > 0 && <article className="curation-section">
        <header><span><strong>링크만 있는 개념</strong><small>여러 노트에서 다시 등장한 개념부터 정의를 정리해 보세요</small></span><em>{queue.stubs.length}</em></header>
        {queue.stubs.map((stub) => <div key={stub.node.id} className={`curation-item${stub.ready ? ' is-ready' : ''}`}><button className="curation-open" onClick={() => onOpenNode(stub.node.id)}><small>{stub.ready ? '정리할 때가 됨' : '정의 작성 전'} · 백링크 {stub.backlinks}</small><strong>{stub.node.title}</strong></button><div className="curation-actions"><button onClick={() => void startStub(stub)}><ArrowUpRight size={11} /> 정리 시작</button><button onClick={() => void findSimilar(stub)}><GitMerge size={11} /> 병합</button><button className={deleteReadyId === stub.node.id ? 'danger' : ''} onClick={() => void deleteStub(stub)}><Trash2 size={11} /> {deleteReadyId === stub.node.id ? '삭제 확인' : '삭제'}</button></div>{merging?.stub.node.id === stub.node.id && <div className="curation-form"><input autoFocus aria-label="병합 대상 개념 검색" value={merging.query} placeholder="병합할 개념 검색" onChange={(event) => setMerging({ ...merging, query: event.target.value })} />{merging.similar?.length ? <p className="curation-similar">비슷한 개념: {merging.similar.map((item) => item.target!.title).join(', ')}</p> : null}<div className="curation-choices">{mergeTargets.length ? mergeTargets.map((target) => <button key={target.id} onClick={() => void merge(stub, target)}>{target.title}<small>{merging.similar?.some((item) => item.target?.id === target.id) ? '의미가 비슷함' : target.status === 'inbox' ? '스텁' : target.relativePath}</small></button>) : <p>병합할 다른 개념이 없습니다.</p>}</div><button className="curation-cancel" onClick={() => setMerging(undefined)}>취소</button></div>}</div>)}
      </article>}
      {queue.memos.length > 0 && <article className="curation-section">
        <header><span><strong>노트로 정리할 메모</strong><small>근거 카드 아래에 쓴 메모입니다. 문장은 직접 다듬어 승격합니다</small></span><em>{queue.memos.length}</em></header>
        {queue.memos.map((memo) => { const key = `${memo.paper.id}:${memo.blockId}:${memo.memo.slice(0, 40)}`; const open = promoting?.memo === memo; return <div key={key} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(memo.paper.id)}><small>{memo.paper.title}{memo.anchorLabel ? ` · ${memo.anchorLabel}` : ''}</small><strong>{memo.memo}</strong>{memo.anchorSource && <p>{memo.anchorSource}</p>}{memo.aiHint && <span className="curation-ai-hint">AI: {memo.aiHint.kind === 'claim' ? 'Claim감' : 'Question감'}{memo.aiHint.why ? ` · ${memo.aiHint.why}` : ''}</span>}</button><div className="curation-actions"><button onClick={() => setPromoting(open && promoting?.nodeType === 'claim' ? undefined : { memo, nodeType: 'claim', title: memo.memo.split('\n')[0].slice(0, 120) })}><Sparkles size={11} /> 주장으로</button><button onClick={() => setPromoting(open && promoting?.nodeType === 'question' ? undefined : { memo, nodeType: 'question', title: memo.memo.split('\n')[0].slice(0, 120) })}><Sparkles size={11} /> 질문으로</button>{memo.aiHint && <button aria-label="AI 힌트 무시" onClick={() => void reviewSuggestion(memo.paper.id, memo.aiHint!.id, 'rejected', memo.aiHint!.kind === 'claim' ? 'Claim감' : 'Question감')}><X size={11} /> 힌트 무시</button>}</div>{open && promoting && <div className="curation-form"><label><span>{promoting.nodeType === 'claim' ? '주장 문장 (내 말로)' : '질문 문장'}</span><input autoFocus aria-label="승격 노트 제목" value={promoting.title} onChange={(event) => setPromoting({ ...promoting, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void promote() } }} /></label><div className="curation-form-actions"><button className="curation-cancel" onClick={() => setPromoting(undefined)}>취소</button><button className="primary" onClick={() => void promote()}>노트로 만들기</button></div></div>}</div> })}
      </article>}
      {queue.claimSuggestions.length > 0 && <article className="curation-section">
        <header><span><strong>이 논문이 하는 주장</strong><small>논문 본문에서 그대로 뽑은 문장입니다. 받아들이면 논문의 주장으로 노트가 생깁니다</small></span><em>{queue.claimSuggestions.length}</em></header>
        {queue.claimSuggestions.map((item) => <div key={item.id} className="curation-item">
          <button className="curation-open" onClick={() => onOpenNode(item.paperNodeId)}><small>{item.paperTitle}</small><strong>{item.sentence}</strong>{item.why && <p>{item.why}</p>}</button>
          <div className="curation-actions"><button onClick={() => void reviewSuggestion(item.paperNodeId, item.id, 'accepted', item.sentence.slice(0, 30))}><Check size={11} /> 주장으로</button><button onClick={() => void reviewSuggestion(item.paperNodeId, item.id, 'rejected', item.sentence.slice(0, 30))}><X size={11} /> 거절</button></div>
        </div>)}
      </article>}
      {queue.conceptSuggestions.length > 0 && <article className="curation-section">
        <header><span><strong>AI가 제안한 새 개념</strong><small>수락하면 빈 노트가 만들어집니다. 정의는 직접 씁니다</small></span><em>{queue.conceptSuggestions.length}</em></header>
        {queue.conceptSuggestions.map((item) => <div key={item.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(item.paperNodeId)}><small>{item.paperTitle}에서 제안</small><strong>{item.title}</strong>{item.reason && <p>{item.reason}</p>}</button><div className="curation-actions"><button onClick={() => void reviewSuggestion(item.paperNodeId, item.id, 'accepted', item.title)}><Check size={11} /> 개념 노트 만들기</button><button onClick={() => void reviewSuggestion(item.paperNodeId, item.id, 'rejected', item.title)}><X size={11} /> 거절</button></div></div>)}
      </article>}
      {queue.applyNotes.length > 0 && <article className="curation-section">
        <header><span><strong>내 연구에 쓸 곳</strong><small>논문을 읽다 적은 당신의 문장입니다. 주장으로 올리면 근거를 붙일 수 있습니다</small></span><em>{queue.applyNotes.length}</em></header>
        {queue.applyNotes.map((item) => { const key = `${item.node.id}:${item.line.slice(0, 40)}`; const open = promotingApply?.line === item.line && promotingApply.node.id === item.node.id; return <div key={key} className="curation-item">
          <button className="curation-open" onClick={() => onOpenNode(item.node.id)}><small>{item.node.title}</small><strong>{item.line}</strong></button>
          <div className="curation-actions"><button onClick={() => setPromotingApply(open ? undefined : { node: item.node, line: item.line, title: item.line.slice(0, 120) })}><Sparkles size={11} /> 내 주장으로</button></div>
          {open && promotingApply && <div className="curation-form"><label><span>주장 문장 (내 말로)</span><input autoFocus aria-label="승격 노트 제목" value={promotingApply.title} onChange={(event) => setPromotingApply({ ...promotingApply, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void promoteApply() } }} /></label><div className="curation-form-actions"><button className="curation-cancel" onClick={() => setPromotingApply(undefined)}>취소</button><button className="primary" onClick={() => void promoteApply()}>노트로 만들기</button></div></div>}
        </div> })}
      </article>}
      {queue.conflicts.length > 0 && <article className="curation-section">
        <header><span><strong>서로 반대로 말하는 논문</strong><small>한 주장을 두고 한쪽은 지지하고 한쪽은 반박합니다. 조건과 근거를 비교하세요. 결론이 다른 이유를 노트에 남길 수 있습니다</small></span><em>{queue.conflicts.length}</em></header>
        {queue.conflicts.map((item) => <div key={`${item.left.id}:${item.right.id}`} className="curation-item">
          <button className="curation-open" onClick={() => onOpenNode(item.claim?.id ?? item.left.id)}>
            <small>{item.claim ? `주장 · ${item.claim.title}` : '논문끼리 직접 반박'}</small>
            <strong>{item.left.title} ↔ {item.right.title}</strong>
          </button>
          <div className="curation-actions">
            <button onClick={() => onOpenNode(item.left.id)}>{item.left.title.slice(0, 18)} 열기</button>
            <button onClick={() => onOpenNode(item.right.id)}>{item.right.title.slice(0, 18)} 열기</button>
          </div>
        </div>)}
      </article>}
      {queue.unsupportedClaims.length > 0 && <article className="curation-section">
        <header><span><strong>근거 없는 주장</strong><small>PDF 근거 카드나 승인된 지지 관계가 필요합니다</small></span><em>{queue.unsupportedClaims.length}</em></header>
        {queue.unsupportedClaims.map((node) => <div key={node.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(node.id)}><small>주장 · {node.relativePath}</small><strong>{node.title}</strong></button></div>)}
      </article>}
      {queue.unansweredQuestions.length > 0 && <article className="curation-section">
        <header><span><strong>열린 질문</strong><small>답하는 관계가 승인되거나 정리됨 상태가 되면 사라집니다</small></span><em>{queue.unansweredQuestions.length}</em></header>
        {queue.unansweredQuestions.map((node) => <div key={node.id} className="curation-item"><button className="curation-open" onClick={() => onOpenNode(node.id)}><small>질문 · {node.relativePath}</small><strong>{node.title}</strong></button></div>)}
      </article>}
    </div>)}
  </section>
}

function RelationEvidenceButton({ anchor }: { anchor: RelationEvidenceAnchor }) {
  const busy = useRef(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  async function openEvidence() {
    if (busy.current) return
    busy.current = true; setOpening(true); setError('')
    try { await window.prism.openEvidenceAnchor(anchor) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '원문 근거를 열지 못했습니다.') }
    finally { busy.current = false; setOpening(false) }
  }
  return <div className="curation-relation-evidence">
    <button type="button" disabled={opening} onClick={() => void openEvidence()} title={`${anchor.label} · p.${anchor.page} 원문 확인`}>
      <ArrowUpRight size={13} aria-hidden="true" /><span>{opening ? '원문 여는 중…' : error ? '원문 근거 다시 열기' : '원문 근거 열기'} · {anchor.label} (p.{anchor.page})</span>
    </button>
    {opening && <span className="curation-evidence-status" role="status">논문 원문으로 이동하고 있습니다.</span>}
    {error && <p className="curation-evidence-error" role="alert">{error} 위 버튼을 눌러 다시 시도할 수 있습니다.</p>}
  </div>
}
