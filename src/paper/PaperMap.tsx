import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Network, RefreshCw, Sparkles } from 'lucide-react'
import { NODE_HEIGHT, NODE_WIDTH, edgePath, layoutMap } from './mapLayout'
import './paper-map.css'

/**
 * The paper's argument, drawn.
 *
 * Two things keep this honest. Every node is a section the paper actually has, and clicking one takes the
 * reader to the page it came from — a claim the map makes can always be checked against the paper in the
 * window next door. And where a line came from is visible in the line itself: solid is the paper's own order,
 * dashed is something a model read into it.
 */

/** Kept in step with .map-tip in the stylesheet, so the tip knows whether it fits beside a node. */
const TIP_WIDTH = 250

type RoleInfo = { name: string; note: string }
const roles: Record<StructureRole, RoleInfo> = {
  problem: { name: '문제', note: '논문 전체가 겨냥하는 출발점' },
  background: { name: '배경', note: '방법을 읽기 전에 필요한 선행 연구' },
  method: { name: '방법', note: '논문이 제안하는 것 자체' },
  component: { name: '구성', note: '방법을 이루는 단위' },
  rationale: { name: '근거', note: '왜 이 방법이어야 하는지에 대한 논증' },
  experiment: { name: '실험', note: '주장을 검증하는 자리' },
  result: { name: '결과', note: '실험이 낸 숫자와 그 해석' },
  limit: { name: '한계·향후', note: '논문이 스스로 남겨둔 다음 문제' },
}
const edgeKinds: Record<StructureEdgeType, { name: string; dash?: string }> = {
  then: { name: '순서' },
  part: { name: '구성' },
  needs: { name: '전제', dash: '5 4' },
  supports: { name: '근거', dash: '5 4' },
  branches: { name: '분기', dash: '2 4' },
  contrasts: { name: '대비', dash: '5 4' },
}

type Props = {
  paperId?: string
  /** Bumped when the reader finishes analysing a paper, so a map opened too early picks up the anchors. */
  revision?: number
  onOpenAnchor: (anchorId: string, page: number) => void
}

export default function PaperMap({ paperId, revision, onOpenAnchor }: Props) {
  const [structure, setStructure] = useState<PaperStructure>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string>()
  const [hovered, setHovered] = useState<string>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState(880)
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState('')
  const [captured, setCaptured] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true); setError('')
    try { setStructure(await window.prism.readPaperStructure(id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setStructure(undefined) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!paperId) { setStructure(undefined); return }
    setSelected(undefined); setExpanded(new Set())
    void load(paperId)
  }, [paperId, revision, load])

  /**
   * The whole flow first, the parts on request. A paper's outline runs to twenty-odd headings, which is a map
   * nobody can read at a glance; the top-level sections are the argument, and a section's parts are one click
   * away on the section they belong to.
   */
  const childrenOf = useMemo(() => {
    const children = new Map<string, string[]>()
    for (const edge of structure?.edges ?? []) if (edge.type === 'part') children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to])
    return children
  }, [structure])
  const visibleNodes = useMemo(() => {
    const nodes = structure?.nodes ?? []
    const shown = new Set(nodes.filter((node) => node.level === 1).map((node) => node.id))
    let grew = true
    while (grew) {
      grew = false
      for (const id of [...shown]) {
        if (!expanded.has(id)) continue
        for (const child of childrenOf.get(id) ?? []) if (!shown.has(child)) { shown.add(child); grew = true }
      }
    }
    return nodes.filter((node) => shown.has(node.id))
  }, [structure, expanded, childrenOf])
  const visibleEdges = useMemo(() => {
    const shown = new Set(visibleNodes.map((node) => node.id))
    return (structure?.edges ?? []).filter((edge) => shown.has(edge.from) && shown.has(edge.to))
  }, [structure, visibleNodes])
  const placement = useMemo(() => layoutMap(visibleNodes, visibleEdges, available), [visibleNodes, visibleEdges, available])

  // The flow wraps to whatever width the pane has, so the map is measured first and laid out to fit.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => setAvailable(Math.max(220, body.clientWidth - 24))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [])
  // Only a pane too narrow for one column falls back to shrinking the map.
  const scale = placement.width > available ? Math.max(0.6, available / placement.width) : 1


  const nodesById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes])
  const drawnEdges = visibleEdges.filter((edge) => !placement.dropped.includes(edge.id))
  const touching = useMemo(() => {
    if (!selected) return undefined
    const near = new Set([selected])
    for (const edge of drawnEdges) if (edge.from === selected || edge.to === selected) { near.add(edge.from); near.add(edge.to) }
    return near
  }, [selected, visibleEdges])

  const selectedNode = selected ? nodesById.get(selected) : undefined
  const selectedRelations = selected
    ? drawnEdges.filter((edge) => edge.from === selected || edge.to === selected).filter((edge) => edge.type !== 'part' || edge.from === selected)
    : []
  const focused = hovered ?? selected
  const focusedNode = focused ? nodesById.get(focused) : undefined
  const focusedPlace = focused ? placement.byId.get(focused) : undefined

  /**
   * The model pass. It can only change roles, write summaries, and relate sections that already exist; if too
   * little of it survives validation the main process keeps the outline and says so in the map's own notes.
   */
  async function analyse() {
    if (!paperId || running) return
    setRunning(true); setRunNote(''); setError('')
    try {
      const run = await window.prism.refinePaperStructure(paperId)
      setRunNote(`${run.model} · 역할 ${run.rolesChanged}개 · 요약 ${run.summaries}개 · 연결 ${run.edgesAdded}개${run.dropped ? ` · 버린 연결 ${run.dropped}개` : ''}`)
      await load(paperId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRunning(false) }
  }

  function choose(node: StructureNode) {
    setSelected(node.id)
    setCaptured('')
    onOpenAnchor(node.anchorId, node.page)
  }

  /** The same capture the reader uses on a sentence, so a section lands in the paper note like any other evidence. */
  async function capture(node: StructureNode) {
    if (!paperId) return
    try {
      await window.prism.capturePaperNote({ kind: 'evidence', paperId, anchorId: node.anchorId })
      setCaptured(`§${node.section}을 논문 노트에 담았습니다.`)
    } catch (reason) { setCaptured(reason instanceof Error ? reason.message : String(reason)) }
  }

  if (!paperId) return <div className="paper-map"><div className="map-empty"><Network size={22} strokeWidth={1.5} /><p>논문을 열면 구조 맵이 만들어집니다.</p></div></div>

  return <div className="paper-map">
    <div className="map-bar">
      <span className="map-source">
        <i className={structure?.source === 'model' ? 'model' : 'outline'} />
        {structure?.source === 'model' ? `모델 분석${structure.model ? ` · ${structure.model.model}` : ''}` : '논문 목차'}
      </span>
      {structure?.nodes.length ? <span className="map-count">{visibleNodes.length}/{structure.nodes.length}개 구간</span> : undefined}
      {childrenOf.size > 0 && <button className="map-refresh" onClick={() => setExpanded((current) => new Set(current.size ? [] : childrenOf.keys()))}>{expanded.size ? '세부 접기' : '세부 펼치기'}</button>}
      <span className="map-spacer" />
      {(loading || running) && <LoaderCircle className="spin" size={13} />}
      <button className="map-refresh" disabled={running} title="설정한 지식 CLI가 각 구간의 역할과 구간 사이의 관계를 읽습니다. 논문에 없는 것은 저장 전에 버려집니다." onClick={() => void analyse()}>
        <Sparkles size={12} /> {running ? '분석 중…' : '모델로 분석'}
      </button>
      <button className="map-refresh" title="구조를 다시 읽습니다" onClick={() => paperId && void load(paperId)}><RefreshCw size={12} /> 새로고침</button>
    </div>

    {runNote && <p className="map-note done">{runNote}</p>}
    {structure?.notes.map((note) => <p key={note} className="map-note">{note}</p>)}
    {error && <p className="map-note error">{error}</p>}

    <div className="map-body" ref={bodyRef} onClick={() => setSelected(undefined)}>
      {!visibleNodes.length && !loading && !structure?.notes.length && !error
        ? <div className="map-empty"><Network size={22} strokeWidth={1.5} /><p>이 논문에서 그릴 구조를 찾지 못했습니다.</p></div>
        : <>
          <div className="map-scaler" style={{ transform: `scale(${scale})`, width: placement.width * scale, height: placement.height * scale }}>
            <div className={`map-plane${selected ? ' focused' : ''}`} style={{ width: placement.width, height: placement.height }}>
              <svg width={placement.width} height={placement.height} aria-hidden="true">
                {drawnEdges.map((edge) => {
                  const from = placement.byId.get(edge.from); const to = placement.byId.get(edge.to)
                  if (!from || !to) return undefined
                  const lit = !touching || (touching.has(edge.from) && touching.has(edge.to))
                  return <path
                    key={edge.id} d={edgePath(from, to)} className={`map-edge ${edge.type}${lit ? ' lit' : ''}`}
                    strokeDasharray={edgeKinds[edge.type].dash} fill="none"
                  />
                })}
              </svg>
              {visibleNodes.map((node) => {
                const place = placement.byId.get(node.id)
                if (!place) return undefined
                return <button
                  key={node.id} type="button" data-role={node.role} data-node={node.id}
                  className={`map-node${selected === node.id ? ' on' : ''}${touching && !touching.has(node.id) ? ' dim' : ''}`}
                  style={{ left: place.x, top: place.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
                  title={node.labelKo ? node.label : undefined}
                  onClick={(event) => { event.stopPropagation(); choose(node) }}
                  onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(undefined)}
                  onFocus={() => setHovered(node.id)} onBlur={() => setHovered(undefined)}
                >
                  <span className="map-role">{roles[node.role].name}{node.roleOrigin === 'model' && <i title="모델이 정한 역할">·</i>}</span>
                  <span className="map-label">{node.labelKo ?? node.label}</span>
                  <span className="map-where">§{node.section} · p.{node.page}</span>
                </button>
              })}
              {visibleNodes.map((node) => {
                const place = placement.byId.get(node.id); const kids = childrenOf.get(node.id) ?? []
                if (!place || !kids.length) return undefined
                const open = expanded.has(node.id)
                return <button
                  key={`expand-${node.id}`} type="button" className={`map-expand${open ? ' open' : ''}`}
                  style={{ left: place.x + NODE_WIDTH - 32, top: place.y + NODE_HEIGHT - 10 }}
                  title={open ? '이 구간의 세부를 접습니다' : `이 구간의 세부 ${kids.length}개를 펼칩니다`}
                  onClick={(event) => { event.stopPropagation(); setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next }) }}
                >{open ? '−' : `+${kids.length}`}</button>
              })}
            </div>
          </div>

          {focusedNode && focusedPlace && <div
            className="map-tip"
            // Beside the node, or on its other side when that would run off the pane.
            style={{
              left: (focusedPlace.x + NODE_WIDTH + 10) * scale + TIP_WIDTH <= available
                ? (focusedPlace.x + NODE_WIDTH + 10) * scale
                : Math.max(4, (focusedPlace.x - 10) * scale - TIP_WIDTH),
              top: Math.max(4, (focusedPlace.y - 2) * scale),
            }}
          >
            <span className="tip-role">{roles[focusedNode.role].name} — {roles[focusedNode.role].note}</span>
            <span className="tip-title">{focusedNode.labelKo ? `${focusedNode.labelKo} · ${focusedNode.label}` : focusedNode.label}</span>
            {focusedNode.summary && <span className="tip-summary">{focusedNode.summary}</span>}
            <span className="tip-go">클릭 → 원문 §{focusedNode.section} · p.{focusedNode.page} 로 이동</span>
          </div>}
        </>}
    </div>

    {selectedNode && <div className="map-selection">
      <span className="sel-role" data-role={selectedNode.role}>{roles[selectedNode.role].name}</span>
      <span className="sel-title"><strong>{selectedNode.labelKo ?? selectedNode.label}</strong><small>§{selectedNode.section} · p.{selectedNode.page}</small></span>
      {selectedNode.summary && <em className="sel-summary">{selectedNode.summary}</em>}
      {selectedRelations.map((edge) => <span key={edge.id} className={`sel-relation ${edge.type}`} title={edge.why ?? ''}>
        {edgeKinds[edge.type].name} {edge.from === selectedNode.id ? '→' : '←'} {nodesById.get(edge.from === selectedNode.id ? edge.to : edge.from)?.label ?? ''}
        {edge.why ? ` · ${edge.why}` : ''}
      </span>)}
      <span className="map-spacer" />
      {captured && <span className="sel-note">{captured}</span>}
      <button onClick={() => onOpenAnchor(selectedNode.anchorId, selectedNode.page)}>원문에서 보기</button>
      <button onClick={() => void capture(selectedNode)}>노트에 담기</button>
    </div>}

    <div className="map-legend">
      <span className="legend-head">역할</span>
      {(Object.keys(roles) as StructureRole[]).map((role) => <span key={role} className="legend-item"><i data-role={role} /> {roles[role].name}</span>)}
      <span className="map-spacer" />
      <span className="legend-head">연결</span>
      <span className="legend-item"><b className="line solid" /> 논문 순서</span>
      <span className="legend-item"><b className="line dashed" /> 모델 추론</span>
    </div>
  </div>
}
