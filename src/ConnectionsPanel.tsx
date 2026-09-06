import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Maximize2, RefreshCw } from 'lucide-react'
import { relationLabels, typeLabels } from './knowledgeModel'
import MiniGraph, { type MiniEdge, type MiniNode } from './graph/MiniGraph'

type Hop2 = { parentId: string; relation: KnowledgeRelationView }

/**
 * The always-visible right stack: a local graph, backlinks, the automatic citation layer, and pending suggestions.
 * The manual graph and the citation layer are drawn separately on purpose — approved edges must never be
 * buried under thousands of citations.
 */
export default function ConnectionsPanel({ node, relations, backlinks, citations, citationsLoading, onOpenNode, onRefreshCitations, onAddCitationRelation, onOpenFullGraph }: {
  node?: KnowledgeNodeRecord
  relations: KnowledgeRelationView[]
  backlinks: KnowledgeBacklink[]
  citations?: CitationLinks
  citationsLoading: boolean
  onOpenNode: (id: string) => void
  onRefreshCitations: () => void
  onAddCitationRelation: (entry: CitationEntry, direction: 'references' | 'citations') => void
  onOpenFullGraph: () => void
}) {
  const [hops, setHops] = useState<1 | 2>(1)
  const [showCitations, setShowCitations] = useState(false)
  const [secondHop, setSecondHop] = useState<Hop2[]>([])
  // Link relations belong in the graph: they are what the researcher actually wrote in the note.
  const approved = useMemo(() => relations.filter((item) => item.reviewStatus === 'approved' && item.type !== 'mentions'), [relations])
  const edgeKey = approved.map((item) => item.id).join(',')

  useEffect(() => {
    if (hops !== 2 || !node) { setSecondHop([]); return }
    let disposed = false
    void (async () => {
      const seen = new Set<string>([node.id, ...approved.map((item) => item.other.id)])
      const results: Hop2[] = []
      for (const edge of approved) {
        try {
          for (const relation of await window.prism.listKnowledgeRelations(edge.other.id)) {
            if (seen.has(relation.other.id) || relation.reviewStatus !== 'approved' || relation.type === 'mentions') continue
            seen.add(relation.other.id); results.push({ parentId: edge.other.id, relation })
          }
        } catch { /* a neighbour may have been deleted meanwhile */ }
      }
      if (!disposed) setSecondHop(results.slice(0, 24))
    })()
    return () => { disposed = true }
  }, [hops, node?.id, edgeKey])

  const citationNeighbours = useMemo(() => {
    if (!showCitations || !citations) return []
    return [...citations.references.filter((item) => item.inLibrary), ...citations.citations.filter((item) => item.inLibrary)]
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
      graphEdges.push({ id: `citation-${entry.nodeId}`, sourceId: node.id, targetId: entry.nodeId!, type: 'mentions', origin: 'manual', approved: false, label: `인용 관계 · ${entry.title}` })
    }
    return { nodes: graphNodes, edges: graphEdges }
  }, [node, approved, secondHop, citationNeighbours])

  // A panel of headings over empty boxes reads as broken. Every section here appears only once it has
  // something to show; with nothing open the panel is a single line instead of four hollow ones.
  return <aside className="notes-side" aria-label="연결">
    {!node && <p className="side-idle">노트를 열면 연결·백링크가 여기에 표시됩니다.</p>}
    {node && <section className="side-sec side-graph">
      <header>
        <span>연결 그래프{hops === 2 ? ' · 2홉' : ''}</span>
        <div className="side-chips">
          <button className={hops === 2 ? 'on' : ''} aria-pressed={hops === 2} onClick={() => setHops(hops === 2 ? 1 : 2)}>2홉</button>
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
    </section>}

    {node && backlinks.length > 0 && <section className="side-sec side-links">
      <header><span>백링크</span><small>{backlinks.length}</small></header>
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
        {citationsLoading ? <p className="side-empty">Semantic Scholar에서 불러오는 중…</p>
          : !citations?.fetchedAt ? (citations?.error ? <p className="side-empty">{citations.error}</p> : null)
            : <>
              {([['references', '참고문헌'], ['citations', '이 논문을 인용']] as const).map(([key, label]) => <details key={key} open={key === 'references'}>
                <summary>{label} {citations[key].length}편 · 라이브러리 {citations[key].filter((item) => item.inLibrary).length}편</summary>
                {citations[key].slice(0, 30).map((item, index) => <div key={`${item.arxivId ?? item.title}-${index}`} className={`citation-row${item.inLibrary ? ' in-library' : ''}`}>
                  <span><strong>{item.title}</strong><small>{[item.year, item.authors.slice(0, 2).join(', '), item.citationCount !== undefined ? `인용 ${item.citationCount}` : ''].filter(Boolean).join(' · ')}</small></span>
                  {item.inLibrary && item.nodeId
                    ? relations.some((relation) => relation.other.id === item.nodeId && relation.type === 'extends' && relation.reviewStatus === 'approved')
                      ? <em>확장함</em>
                      : <button title="자동 인용을 직접 승인한 확장함 관계로 올립니다" onClick={() => onAddCitationRelation(item, key)}>관계로</button>
                    : item.arxivId ? <a href={`https://arxiv.org/abs/${item.arxivId}`} aria-label={`${item.title} arXiv에서 열기`} onClick={(event) => { event.preventDefault(); void window.prism.openArxiv(item.arxivId!) }}><ExternalLink size={11} /></a> : null}
                </div>)}
              </details>)}
              <small className="citation-meta">{new Date(citations.fetchedAt).toLocaleDateString()} 기준{citations.stale ? ' · 오래됨' : ''}</small>
            </>}
      </div>
    </section>}
  </aside>
}
