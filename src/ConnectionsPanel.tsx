import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { relationLabels, typeLabels } from './knowledgeModel'

type Hop2 = { parentId: string; relation: KnowledgeRelationView }

/**
 * The always-visible right stack: a local graph, backlinks, the automatic citation layer, and pending suggestions.
 * The manual graph and the citation layer are drawn separately on purpose — approved edges must never be
 * buried under thousands of citations.
 */
export default function ConnectionsPanel({ node, relations, backlinks, citations, citationsLoading, onOpenNode, onRefreshCitations, onAddCitationRelation }: {
  node?: KnowledgeNodeRecord
  relations: KnowledgeRelationView[]
  backlinks: KnowledgeBacklink[]
  citations?: CitationLinks
  citationsLoading: boolean
  onOpenNode: (id: string) => void
  onRefreshCitations: () => void
  onAddCitationRelation: (entry: CitationEntry, direction: 'references' | 'citations') => void
}) {
  const [hops, setHops] = useState<1 | 2>(1)
  const [showCitations, setShowCitations] = useState(false)
  const [secondHop, setSecondHop] = useState<Hop2[]>([])
  // Link relations belong in the graph: they are what the researcher actually wrote in the note.
  const approved = useMemo(() => relations.filter((item) => item.reviewStatus === 'approved' && (item.origin === 'link' || item.type !== 'mentions')), [relations])
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

  const ring = (index: number, count: number, radius: number) => {
    const angle = Math.PI * 2 * index / Math.max(count, 1) - Math.PI / 2
    return { x: 160 + Math.cos(angle) * radius * 1.35, y: 118 + Math.sin(angle) * radius }
  }
  const primary = [...approved.map((item) => ({ kind: 'manual' as const, item })), ...citationNeighbours.map((item) => ({ kind: 'citation' as const, item }))]

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
        </div>
      </header>
      {node ? <>
        <div className="graph-canvas">
          <svg viewBox="0 0 320 236" role="img" aria-label={`${node.title} 연결 그래프`}>
            {primary.map((entry, index) => {
              const point = ring(index, primary.length, 62)
              const contra = entry.kind === 'manual' && entry.item.type === 'contradicts'
              const link = entry.kind === 'manual' && entry.item.origin === 'link'
              return <path key={`edge-${index}`} className={`graph-edge${contra ? ' contra' : ''}${link ? ' link' : ''}${entry.kind === 'citation' ? ' auto' : ''}`} d={`M160 118 L ${point.x} ${point.y}`} />
            })}
            {secondHop.map((entry, index) => {
              const parentIndex = primary.findIndex((item) => item.kind === 'manual' && item.item.other.id === entry.parentId)
              if (parentIndex < 0) return null
              const parent = ring(parentIndex, primary.length, 62)
              const point = ring(parentIndex + (index + 1) / (secondHop.length + 1) - 0.5, primary.length, 100)
              return <path key={`hop2-${index}`} className="graph-edge hop2" d={`M${parent.x} ${parent.y} L ${point.x} ${point.y}`} />
            })}
            {secondHop.map((entry, index) => {
              const parentIndex = primary.findIndex((item) => item.kind === 'manual' && item.item.other.id === entry.parentId)
              if (parentIndex < 0) return null
              const point = ring(parentIndex + (index + 1) / (secondHop.length + 1) - 0.5, primary.length, 100)
              return <g key={`hop2n-${index}`} className={`graph-node hop2 kind-${entry.relation.other.nodeType}`} onClick={() => onOpenNode(entry.relation.other.id)}>
                <circle cx={point.x} cy={point.y} r="4.5" />
                <title>{relationLabels[entry.relation.type]} · {entry.relation.other.title}</title>
              </g>
            })}
            {primary.map((entry, index) => {
              const point = ring(index, primary.length, 62)
              const target = entry.kind === 'manual' ? entry.item.other : { id: entry.item.nodeId!, title: entry.item.title, nodeType: 'paper' as KnowledgeNodeType }
              const label = target.title.length > 14 ? `${target.title.slice(0, 13)}…` : target.title
              return <g key={`node-${index}`} className={`graph-node kind-${target.nodeType}${entry.kind === 'citation' ? ' auto' : ''}`} onClick={() => onOpenNode(target.id)}>
                <circle cx={point.x} cy={point.y} r="6.5" />
                <text x={point.x} y={point.y + (point.y > 118 ? 15 : -10)}>{label}</text>
                <title>{entry.kind === 'manual' ? `${entry.item.direction === 'outgoing' ? '→' : '←'} ${entry.item.origin === 'link' ? '링크' : relationLabels[entry.item.type]} · ${target.title}` : `인용 관계 · ${target.title}`}</title>
              </g>
            })}
            <g className={`graph-node is-center kind-${node.nodeType}`}>
              <circle cx="160" cy="118" r="9.5" />
              <text x="160" y="140">{node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title}</text>
            </g>
          </svg>
          {!primary.length && <p className="graph-empty">아직 연결이 없습니다. 본문에서 <kbd>[[</kbd>로 링크하거나 속성의 <b>관계 추가</b>를 쓰세요.</p>}
        </div>
        <div className="graph-legend">
          {(['paper', 'concept', 'claim', 'question'] as KnowledgeNodeType[]).map((type) => <span key={type}><i className={`kind-dot kind-${type}`} />{typeLabels[type]}</span>)}
          <span><i className="kind-dot is-contra" />반박</span>
        </div>
      </> : null}
    </section>}

    {backlinks.length > 0 && <section className="side-sec side-links">
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
