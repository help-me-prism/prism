import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Maximize2, RefreshCw } from 'lucide-react'
import { relationLabels, typeLabels } from './knowledgeModel'
import MiniGraph, { type MiniEdge, type MiniNode } from './graph/MiniGraph'
import { loadSecondHop, secondHopLimits, type SecondHopResult } from './graph/secondHop'

/**
 * The always-visible right stack: a local graph, backlinks, the automatic citation layer, and pending suggestions.
 * The manual graph and the citation layer are drawn separately on purpose — approved edges must never be
 * buried under thousands of citations.
 */
export default function ConnectionsPanel({ node, relations, backlinks, citations, citationsLoading, onOpenNode, onRefreshCitations, onOpenFullGraph }: {
  node?: KnowledgeNodeRecord
  relations: KnowledgeRelationView[]
  backlinks: KnowledgeBacklink[]
  citations?: CitationLinks
  citationsLoading: boolean
  onOpenNode: (id: string) => void
  onRefreshCitations: () => void
  onOpenFullGraph: () => void
}) {
  const [hops, setHops] = useState<1 | 2>(1)
  const [showCitations, setShowCitations] = useState(false)
  // Link relations belong in the graph: they are what the researcher actually wrote in the note.
  const approved = useMemo(() => relations.filter((item) => item.reviewStatus === 'approved' && item.type !== 'mentions'), [relations])
  // Identity includes the relation-list generation, not just edge IDs: endpoints and
  // review/type metadata can change while IDs remain the same.
  const hopScope = useMemo(() => ({ nodeId: node?.id, approved }), [node?.id, approved, hops])
  const [hopResult, setHopResult] = useState<{ scope: typeof hopScope; result: SecondHopResult }>()
  const currentHop = hops === 2 && hopResult?.scope === hopScope ? hopResult.result : undefined
  const secondHop = currentHop?.entries ?? []

  useEffect(() => {
    if (hops !== 2 || !hopScope.nodeId) { setHopResult(undefined); return }
    let disposed = false
    setHopResult(undefined)
    void loadSecondHop(hopScope.nodeId, hopScope.approved, id => window.prism.listKnowledgeRelations(id), () => disposed)
      .then(result => { if (!disposed && result) setHopResult({ scope: hopScope, result }) })
    return () => { disposed = true }
  }, [hops, hopScope])

  const citationNeighbours = useMemo(() => {
    if (!showCitations || !citations) return []
    return [...citations.references.filter((item) => item.inLibrary).map(item => ({ ...item, direction: 'outgoing' as const })), ...citations.citations.filter((item) => item.inLibrary).map(item => ({ ...item, direction: 'incoming' as const }))]
      .filter((item) => item.nodeId && item.nodeId !== node?.id && !approved.some((edge) => edge.other.id === item.nodeId))
      .slice(0, 10)
  }, [showCitations, citations, approved, node?.id])

  /** Everything the panel draws, in one shape: the note, its relations, its second hop and the citation overlay. */
  const mini = useMemo(() => {
    if (!node) return { nodes: [] as MiniNode[], edges: [] as MiniEdge[] }
    const graphNodes: MiniNode[] = [{ id: node.id, title: node.title, nodeType: node.nodeType, kind: 'center' }]
    const graphEdges: MiniEdge[] = []
    const seen = new Set([node.id])
    const add = (item: MiniNode) => { if (!seen.has(item.id)) { seen.add(item.id); graphNodes.push(item) } }

    for (const relation of approved) {
      add({ id: relation.other.id, title: relation.other.title, nodeType: relation.other.nodeType, kind: 'hop1' })
      const outgoing = relation.direction === 'outgoing'
      graphEdges.push({
        id: relation.id,
        sourceId: outgoing ? node.id : relation.other.id,
        targetId: outgoing ? relation.other.id : node.id,
        type: relation.type, origin: relation.origin ?? 'manual', approved: true,
        label: `${outgoing ? '→' : '←'} ${relation.origin === 'link' ? '링크' : relationLabels[relation.type]} · ${relation.other.title}`,
      })
    }
    for (const entry of secondHop) {
      add({ id: entry.relation.other.id, title: entry.relation.other.title, nodeType: entry.relation.other.nodeType, kind: 'hop2' })
      const outgoing = entry.relation.direction === 'outgoing'
      graphEdges.push({
        id: `hop2-${entry.relation.id}`,
        sourceId: outgoing ? entry.parentId : entry.relation.other.id,
        targetId: outgoing ? entry.relation.other.id : entry.parentId,
        type: entry.relation.type, origin: entry.relation.origin ?? 'manual', approved: true,
        label: `${relationLabels[entry.relation.type]} · ${entry.relation.other.title}`,
      })
    }
    for (const entry of citationNeighbours) {
      add({ id: entry.nodeId!, title: entry.title, nodeType: 'paper', kind: 'citation' })
      graphEdges.push({ id: `citation-${entry.direction}-${entry.nodeId}`, sourceId: entry.direction === 'outgoing' ? node.id : entry.nodeId!, targetId: entry.direction === 'outgoing' ? entry.nodeId! : node.id, type: 'mentions', origin: 'manual', approved: false, label: `${entry.direction === 'outgoing' ? '인용한 논문' : '나를 인용한 논문'} · ${entry.title}` })
    }
    return { nodes: graphNodes, edges: graphEdges }
  }, [node, approved, secondHop, citationNeighbours])

  // A panel of headings over empty boxes reads as broken. Every section here appears only once it has
  // something to show; with nothing open the panel is a single line instead of four hollow ones.
  return <aside className="notes-side" aria-label="연결">
    {!node && <p className="side-idle">노트를 열면 연결·백링크가 여기에 표시됩니다.</p>}
    {node && <section className="side-sec side-graph">
      <header>
        <span>연결 그래프{hops === 2 ? ' · 한 단계 더' : ''}</span>
        <div className="side-chips">
          <button className={hops === 2 ? 'on' : ''} aria-pressed={hops === 2} onClick={() => setHops(hops === 2 ? 1 : 2)}>간접 연결</button>
          <button className={showCitations ? 'on' : ''} aria-pressed={showCitations} title="라이브러리에 있는 인용 논문을 회색 점선으로 겹쳐 봅니다" onClick={() => setShowCitations((value) => !value)}>인용</button>
          <button title="볼트 전체 그래프 열기" aria-label="볼트 전체 그래프 열기" onClick={onOpenFullGraph}><Maximize2 size={11} /></button>
        </div>
      </header>
      <div className="graph-canvas">
        <MiniGraph nodes={mini.nodes} edges={mini.edges} onOpenNode={onOpenNode} />
        {mini.edges.length === 0 && <p className="graph-empty">아직 연결이 없습니다. 본문에서 <kbd>[[</kbd>로 링크하거나 속성의 <b>관계 추가</b>를 쓰세요.</p>}
      </div>
      <div className="graph-legend">
        {(['paper', 'concept', 'claim', 'question'] as KnowledgeNodeType[]).map((type) => <span key={type}><i className={`kind-dot kind-${type}`} />{typeLabels[type]}</span>)}
        <span><i className="kind-dot is-contra" />반박</span>
      </div>
      {hops === 2 && <p className="side-empty" role="status">{!currentHop ? '간접 연결을 불러오는 중…'
        : currentHop.limited ? `일부 간접 연결을 표시합니다. 가까운 노트 ${secondHopLimits.neighbours}개, 간접 연결 ${secondHopLimits.entries}개까지 확인합니다.`
          : currentHop.entries.length === 0 ? '확인된 간접 연결이 없습니다.' : `간접 연결 ${currentHop.entries.length}개`}
        {currentHop && currentHop.failures > 0 ? ` 노트 ${currentHop.failures}개의 연결은 불러오지 못했습니다.` : ''}</p>}
    </section>}

    {node && backlinks.length > 0 && <section className="side-sec side-links">
      <header><span>이 노트를 언급한 노트</span><small>{backlinks.length}</small></header>
      <div className="side-list">
        {backlinks.map((item) => <button key={item.nodeId} onClick={() => onOpenNode(item.nodeId)}>
          <span className="side-row-title"><i className={`kind-dot kind-${item.nodeType}`} />{item.title}</span>
          <small>{item.excerpt}</small>
        </button>)}
      </div>
    </section>}

    {node?.nodeType === 'paper' && <section className="side-sec side-citations">
      <header>
        <span>인용 (자동)</span>
        <small>{citations?.fetchedAt ? `${citations.references.length} / ${citations.citations.length}` : ''}</small>
        <button className="side-refresh" aria-label="Semantic Scholar에서 인용 새로고침" disabled={citationsLoading} onClick={onRefreshCitations}><RefreshCw size={12} /></button>
      </header>
      <div className="side-list">
        <p className="side-empty">인용은 출처 정보입니다. 지지·반박·확장 관계는 내용을 확인한 뒤 노트에서 지정하세요.</p>
        {citationsLoading ? <p className="side-empty">Semantic Scholar에서 불러오는 중…</p>
          : !citations?.fetchedAt ? (citations?.error ? <p className="side-empty">{citations.error}</p> : null)
            : <>
              {([['references', '참고문헌'], ['citations', '이 논문을 인용']] as const).map(([key, label]) => <details key={key} open={key === 'references'}>
                <summary>{label} {citations[key].length}편 · 라이브러리 {citations[key].filter((item) => item.inLibrary).length}편</summary>
                {citations[key].slice(0, 30).map((item, index) => <div key={`${item.arxivId ?? item.title}-${index}`} className={`citation-row${item.inLibrary ? ' in-library' : ''}`}>
                  <span><strong>{item.title}</strong><small>{[item.year, item.authors.slice(0, 2).join(', '), item.citationCount !== undefined ? `인용 ${item.citationCount}` : ''].filter(Boolean).join(' · ')}</small></span>
                  {item.inLibrary && item.nodeId
                    ? <button title="인용 논문 노트 열기" onClick={() => onOpenNode(item.nodeId!)}>노트 열기</button>
                    : item.doi ? <a href={`https://doi.org/${item.doi}`} aria-label={`${item.title} 출판사에서 열기`} onClick={(event) => { event.preventDefault(); void window.prism.openDoi(item.doi!) }}><ExternalLink size={11} /></a>
                    : item.arxivId ? <a href={`https://arxiv.org/abs/${item.arxivId}`} aria-label={`${item.title} arXiv에서 열기`} onClick={(event) => { event.preventDefault(); void window.prism.openArxiv(item.arxivId!) }}><ExternalLink size={11} /></a> : null}
                </div>)}
              </details>)}
              <small className="citation-meta">{new Date(citations.fetchedAt).toLocaleDateString()} 기준{citations.stale ? ' · 오래됨' : ''}</small>
            </>}
      </div>
    </section>}
  </aside>
}
