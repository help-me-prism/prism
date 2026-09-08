import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { GripVertical, X } from 'lucide-react'
import {
  activateKind, closeKind, describeLayout, moveKindToGroup, paneKinds, paneShortTitles, paneTitles, placePanes,
  resizeSplit, splitGroupWithKind, type PaneKind, type PaneNode, type PaneRect, type PaneSide,
} from './panes'
import './paper-panes.css'

/**
 * The reader's windows, drawn from the layout tree.
 *
 * One rule shapes this file: a view is never remounted by rearranging it. The PDF pane holds rendered canvases
 * and a scroll position that cost seconds to rebuild, so the views are rendered once, in a fixed order, and
 * *positioned* into whichever group owns them. Only the chrome — tab bars, seams, the drop outline — is rebuilt
 * as the tree changes. Dragging a tab across the workbench is then a repaint, not a reload.
 */

const TAB_BAR = 30
/** How far into a group a drop counts as "split this side" rather than "add a tab here". */
const EDGE = 0.22
/** Small pointer moves are clicks. A tab only starts travelling after the pointer means it. */
const DRAG_START = 4

type Props = {
  layout: PaneNode
  onLayout: (next: PaneNode) => void
  /** The content of each window. A kind with no entry here is one this reader cannot draw yet. */
  views: Partial<Record<PaneKind, ReactNode>>
  /** Controls for the right-hand side of a group's tab bar, shown for whichever of its tabs is active. */
  headers?: Partial<Record<PaneKind, ReactNode>>
}

type DragState = { kind: PaneKind; x: number; y: number; moved: boolean; target?: { groupId: string; side: PaneSide; rect: PaneRect } }

const percent = (rect: PaneRect) => ({ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` })

function sideRect(rect: PaneRect, side: PaneSide): PaneRect {
  if (side === 'left') return { ...rect, width: rect.width / 2 }
  if (side === 'right') return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 }
  if (side === 'top') return { ...rect, height: rect.height / 2 }
  if (side === 'bottom') return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 }
  return rect
}

export default function PaperPanes({ layout, onLayout, views, headers }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState>()
  const placed = placePanes(layout)
  const drawable = (kind: PaneKind) => views[kind] !== undefined

  /** Pointer position as a share of the workbench, which is the coordinate system the tree is written in. */
  function pointAt(event: PointerEvent | ReactPointerEvent) {
    const host = hostRef.current?.getBoundingClientRect()
    if (!host || !host.width || !host.height) return undefined
    return { x: ((event.clientX - host.left) / host.width) * 100, y: ((event.clientY - host.top) / host.height) * 100 }
  }

  function dropTarget(event: PointerEvent) {
    const point = pointAt(event)
    if (!point) return undefined
    const hit = placed.groups.find(({ rect }) =>
      point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height)
    if (!hit) return undefined
    const across = (point.x - hit.rect.left) / hit.rect.width
    const down = (point.y - hit.rect.top) / hit.rect.height
    const side: PaneSide = across < EDGE ? 'left' : across > 1 - EDGE ? 'right' : down < EDGE ? 'top' : down > 1 - EDGE ? 'bottom' : 'center'
    return { groupId: hit.group.id, side, rect: sideRect(hit.rect, side) }
  }

  function startTabDrag(event: ReactPointerEvent<HTMLButtonElement>, kind: PaneKind) {
    if (event.button !== 0) return
    const origin = { x: event.clientX, y: event.clientY }
    setDrag({ kind, x: origin.x, y: origin.y, moved: false })
    const move = (moveEvent: PointerEvent) => {
      const far = Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) > DRAG_START
      setDrag((current) => current && { ...current, x: moveEvent.clientX, y: moveEvent.clientY, moved: current.moved || far, target: current.moved || far ? dropTarget(moveEvent) : undefined })
    }
    const stop = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      setDrag((current) => {
        if (current?.moved) {
          const target = dropTarget(upEvent)
          if (target) onLayout(target.side === 'center'
            ? moveKindToGroup(layout, target.groupId, kind)
            : splitGroupWithKind(layout, target.groupId, kind, target.side))
        }
        return undefined
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function startSashDrag(event: ReactPointerEvent<HTMLDivElement>, handle: (typeof placed.handles)[number]) {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      const point = pointAt(moveEvent)
      if (!point) return
      const share = handle.dir === 'row'
        ? ((point.x - handle.parent.left) / handle.parent.width) * 100
        : ((point.y - handle.parent.top) / handle.parent.height) * 100
      onLayout(resizeSplit(layout, handle.splitId, handle.index, share))
    }
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return <div className={`pane-workbench${drag?.moved ? ' dragging' : ''}`} ref={hostRef}>
    {placed.groups.map(({ group, rect }) => {
      const tabs = group.tabs.filter(drawable)
      return <div key={group.id} className="pane-chrome" data-group={group.id} data-tabs={tabs.join(',')} style={{ ...percent(rect), height: `${TAB_BAR}px` }}>
        <div className="pane-tabs" role="tablist" aria-label="이 논문의 창">
          {tabs.map((kind) => <button
            key={kind} role="tab" aria-selected={group.active === kind} title={`${paneTitles[kind]} · 드래그해서 옮기기`}
            className={`pane-tab${group.active === kind ? ' on' : ''}${drag?.moved && drag.kind === kind ? ' travelling' : ''}`}
            onPointerDown={(event) => startTabDrag(event, kind)}
            onClick={() => onLayout(activateKind(layout, kind))}
          >
            <GripVertical className="pane-grip" size={11} />
            <span>{paneShortTitles[kind]}</span>
            <i role="presentation" title={`${paneTitles[kind]} 닫기`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onLayout(closeKind(layout, kind)) }}><X size={11} /></i>
          </button>)}
          <span className="pane-tab-filler" />
          {group.active && drawable(group.active) ? headers?.[group.active] : undefined}
        </div>
      </div>
    })}

    {paneKinds.filter(drawable).map((kind) => {
      const owner = placed.groups.find(({ group }) => group.active === kind)
      if (!owner) return <div key={kind} className="pane-body" data-pane={kind} data-shown="false" style={{ display: 'none' }}>{views[kind]}</div>
      const { rect } = owner
      return <div key={kind} className="pane-body" data-pane={kind} data-shown="true" style={{
        left: `${rect.left}%`, width: `${rect.width}%`,
        top: `calc(${rect.top}% + ${TAB_BAR}px)`, height: `calc(${rect.height}% - ${TAB_BAR}px)`,
      }}>{views[kind]}</div>
    })}

    {placed.groups.filter(({ group }) => !group.tabs.filter(drawable).length).map(({ group, rect }) =>
      <div key={`empty-${group.id}`} className="pane-empty" style={{ ...percent(rect), top: `calc(${rect.top}% + ${TAB_BAR}px)`, height: `calc(${rect.height}% - ${TAB_BAR}px)` }}>
        <span>창을 여기로 끌어다 놓으세요</span>
      </div>)}

    {placed.handles.map((handle) => <div
      key={handle.id} role="separator" aria-orientation={handle.dir === 'row' ? 'vertical' : 'horizontal'}
      aria-label={handle.dir === 'row' ? '좌우 폭 조절' : '위아래 높이 조절'}
      className={`pane-sash ${handle.dir}`}
      style={handle.dir === 'row'
        ? { left: `${handle.pos}%`, top: `${handle.start}%`, height: `${handle.extent}%` }
        : { top: `${handle.pos}%`, left: `${handle.start}%`, width: `${handle.extent}%` }}
      onPointerDown={(event) => startSashDrag(event, handle)}
    />)}

    {drag?.moved && drag.target && <div className={`pane-drop ${drag.target.side}`} style={percent(drag.target.rect)} />}
    {drag?.moved && <div className="pane-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{paneShortTitles[drag.kind]}</div>}
  </div>
}

export { describeLayout }
