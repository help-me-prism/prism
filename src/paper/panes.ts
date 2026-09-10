/**
 * How the reader's windows are arranged, as data.
 *
 * The reader used to have three fixed modes — original, translated, and the two side by side — which is a
 * layout tree with the branches nailed shut. A paper has more than two things worth looking at (the PDF, the
 * translation, the structure map), and which of them belong on screen together is the researcher's call, not
 * ours. So the arrangement is a tree of splits whose leaves are groups of tabs, and the old modes are three
 * of the shapes it can take.
 *
 * Everything here is plain data and pure functions: the tree survives a JSON round trip, so a paper reopens
 * in the arrangement it was left in, and every operation returns a new tree rather than mutating the old one.
 */

export const paneKinds = ['original', 'translated'] as const
export type PaneKind = (typeof paneKinds)[number]

export type PaneGroup = { type: 'group'; id: string; tabs: PaneKind[]; active?: PaneKind }
export type PaneSplit = { type: 'split'; id: string; dir: 'row' | 'col'; children: PaneNode[]; sizes: number[] }
export type PaneNode = PaneGroup | PaneSplit

/** Where something sits inside the workbench, in percent, so the tree never has to know about pixels. */
export type PaneRect = { left: number; top: number; width: number; height: number }
/** Which part of a group a dragged tab was dropped on: an edge splits, the middle joins. */
export type PaneSide = 'left' | 'right' | 'top' | 'bottom' | 'center'

export type PlacedGroup = { group: PaneGroup; rect: PaneRect }
/** One draggable seam. `pos` is the seam itself; `start`/`extent` are how far it runs across the other axis. */
export type PaneHandle = { id: string; splitId: string; index: number; dir: 'row' | 'col'; pos: number; start: number; extent: number; parent: PaneRect }
export type PlacedPanes = { groups: PlacedGroup[]; handles: PaneHandle[] }

/** A split never collapses a pane to nothing: below this share of its parent, dragging the seam stops. */
const MIN_SHARE = 12

let counter = 0
function nextId() { counter += 1; return `pane-${counter}` }

export function paneGroup(tabs: PaneKind[], active?: PaneKind, id = nextId()): PaneGroup {
  return { type: 'group', id, tabs: [...tabs], active: active && tabs.includes(active) ? active : tabs[0] }
}
export function paneSplit(dir: 'row' | 'col', children: PaneNode[], sizes?: number[], id = nextId()): PaneSplit {
  return { type: 'split', id, dir, children, sizes: normalize(sizes ?? children.map(() => 100 / children.length), children.length) }
}

function normalize(sizes: number[], count: number) {
  const usable = sizes.slice(0, count).map((size) => (Number.isFinite(size) && size > 0 ? size : 1))
  while (usable.length < count) usable.push(1)
  const total = usable.reduce((sum, size) => sum + size, 0)
  return usable.map((size) => (size / total) * 100)
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/* ------------------------------------------------------------------ reading */

export function paneGroups(node: PaneNode): PaneGroup[] {
  return node.type === 'group' ? [node] : node.children.flatMap(paneGroups)
}
/** Every kind currently on screen, in the order the tree lays them out. */
export function openKinds(node: PaneNode): PaneKind[] {
  return paneGroups(node).flatMap((group) => group.tabs)
}
export function groupHolding(node: PaneNode, kind: PaneKind) {
  return paneGroups(node).find((group) => group.tabs.includes(kind))
}
export function isVisible(node: PaneNode, kind: PaneKind) {
  return paneGroups(node).some((group) => group.active === kind)
}

/**
 * Where each group and seam lands. Percentages, computed top-down: a split hands each child the share of its
 * own rectangle that `sizes` says, so the same tree describes the layout at any window size.
 */
export function placePanes(node: PaneNode, rect: PaneRect = { left: 0, top: 0, width: 100, height: 100 }): PlacedPanes {
  if (node.type === 'group') return { groups: [{ group: node, rect }], handles: [] }
  const groups: PlacedGroup[] = []
  const handles: PaneHandle[] = []
  const along = node.dir === 'row' ? rect.width : rect.height
  let offset = node.dir === 'row' ? rect.left : rect.top
  node.children.forEach((child, index) => {
    const size = (along * node.sizes[index]) / 100
    const childRect: PaneRect = node.dir === 'row'
      ? { left: offset, top: rect.top, width: size, height: rect.height }
      : { left: rect.left, top: offset, width: rect.width, height: size }
    const placed = placePanes(child, childRect)
    groups.push(...placed.groups)
    handles.push(...placed.handles)
    offset += size
    if (index < node.children.length - 1) {
      handles.push({
        id: `${node.id}-${index}`, splitId: node.id, index, dir: node.dir, pos: offset,
        start: node.dir === 'row' ? rect.top : rect.left,
        extent: node.dir === 'row' ? rect.height : rect.width,
        parent: rect,
      })
    }
  })
  return { groups, handles }
}

/* ------------------------------------------------------------------ writing */

function mapGroups(node: PaneNode, fn: (group: PaneGroup) => PaneGroup): PaneNode {
  if (node.type === 'group') return fn(node)
  return { ...node, children: node.children.map((child) => mapGroups(child, fn)) }
}

/** Drops empty groups and dissolves splits left with a single child, so closing a tab never leaves a gap. */
function prune(node: PaneNode): PaneNode | undefined {
  if (node.type === 'group') return node.tabs.length ? node : undefined
  const kept: PaneNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const pruned = prune(child)
    if (!pruned) return
    kept.push(pruned)
    sizes.push(node.sizes[index])
  })
  if (!kept.length) return undefined
  if (kept.length === 1) return kept[0]
  return { ...node, children: kept, sizes: normalize(sizes, kept.length) }
}

/** An empty workbench is still a workbench: one group with nothing in it, ready to be dropped into. */
const orElseEmpty = (node: PaneNode | undefined) => node ?? paneGroup([])

export function closeKind(root: PaneNode, kind: PaneKind): PaneNode {
  const stripped = mapGroups(clone(root), (group) => {
    if (!group.tabs.includes(kind)) return group
    const tabs = group.tabs.filter((tab) => tab !== kind)
    return { ...group, tabs, active: group.active === kind ? tabs[0] : group.active }
  })
  return orElseEmpty(prune(stripped))
}

export function activateKind(root: PaneNode, kind: PaneKind): PaneNode {
  return mapGroups(clone(root), (group) => (group.tabs.includes(kind) ? { ...group, active: kind } : group))
}

/** Moves a kind into a group as a tab. Used for a drop in the middle of a group, and for opening a closed kind. */
export function moveKindToGroup(root: PaneNode, groupId: string, kind: PaneKind): PaneNode {
  const without = closeKind(root, kind)
  const target = paneGroups(without).some((group) => group.id === groupId) ? groupId : paneGroups(without)[0]?.id
  if (!target) return paneGroup([kind])
  return mapGroups(without, (group) => (group.id === target ? { ...group, tabs: [...group.tabs, kind], active: kind } : group))
}

/** Moves a kind out into a new group on one side of an existing group — a drop on that group's edge. */
export function splitGroupWithKind(root: PaneNode, groupId: string, kind: PaneKind, side: Exclude<PaneSide, 'center'>): PaneNode {
  const without = closeKind(root, kind)
  const target = paneGroups(without).find((group) => group.id === groupId)
  if (!target) return moveKindToGroup(without, paneGroups(without)[0]?.id ?? '', kind)
  const dir = side === 'left' || side === 'right' ? 'row' : 'col'
  const fresh = paneGroup([kind])
  const replacement = paneSplit(dir, side === 'left' || side === 'top' ? [fresh, target] : [target, fresh], [50, 50])
  return replaceNode(without, target.id, replacement)
}

function replaceNode(root: PaneNode, id: string, replacement: PaneNode): PaneNode {
  if (root.type === 'group') return root.id === id ? replacement : root
  return { ...root, children: root.children.map((child) => replaceNode(child, id, replacement)) }
}

/**
 * Drags one seam. `share` is where the seam should sit as a percentage of its own split, and only the two
 * panes touching the seam change: everything else in the split keeps the size the researcher gave it.
 */
export function resizeSplit(root: PaneNode, splitId: string, index: number, share: number): PaneNode {
  const next = clone(root)
  const apply = (node: PaneNode): void => {
    if (node.type === 'group') return
    if (node.id === splitId && index >= 0 && index + 1 < node.sizes.length) {
      const before = node.sizes.slice(0, index).reduce((sum, size) => sum + size, 0)
      const pair = node.sizes[index] + node.sizes[index + 1]
      const first = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, share - before))
      node.sizes[index] = first
      node.sizes[index + 1] = pair - first
      return
    }
    node.children.forEach(apply)
  }
  apply(next)
  return next
}

/* ------------------------------------------------------------------ presets and text */

/** The arrangements the toolbar offers. The first two are the reader's old single modes; `dual` is 병기. */
export const panePresets = {
  original: () => paneGroup(['original']),
  translated: () => paneGroup(['translated']),
  dual: () => paneSplit('row', [paneGroup(['original']), paneGroup(['translated'])], [50, 50]),
  stacked: () => paneSplit('col', [paneGroup(['original']), paneGroup(['translated'])], [50, 50]),
} satisfies Record<string, () => PaneNode>

export const paneTitles: Record<PaneKind, string> = { original: '원문 PDF', translated: '번역 문서' }
export const paneShortTitles: Record<PaneKind, string> = { original: '원문', translated: '번역' }

/** "원문 | 한국어" — the arrangement in one line, for the toolbar and for telling two presets apart. */
export function describeLayout(node: PaneNode): string {
  if (node.type === 'group') return node.tabs.map((tab) => paneShortTitles[tab]).join(' + ')
  return node.children.map(describeLayout).filter(Boolean).join(node.dir === 'row' ? ' | ' : ' / ')
}

/* ------------------------------------------------------------------ persistence */

/**
 * Reads back a stored arrangement. Anything unrecognised is dropped rather than trusted: a layout saved by a
 * newer build, hand-edited storage, or a kind this reader no longer has must not be able to leave the reader
 * with a pane it cannot draw. `allowed` is what the caller can actually render right now.
 */
export function parseLayout(value: unknown, allowed: readonly PaneKind[] = paneKinds): PaneNode | undefined {
  const seen = new Set<PaneKind>()
  let highest = 0
  const read = (input: unknown): PaneNode | undefined => {
    if (!input || typeof input !== 'object') return undefined
    const node = input as Partial<PaneSplit> & Partial<PaneGroup>
    const id = typeof node.id === 'string' && /^pane-\d{1,6}$/.test(node.id) ? node.id : nextId()
    highest = Math.max(highest, Number(id.slice(5)) || 0)
    if (node.type === 'group') {
      // A kind can only be in one place, so the first group claiming it wins and later copies are dropped.
      const tabs: PaneKind[] = []
      for (const tab of Array.isArray(node.tabs) ? node.tabs : []) {
        if (typeof tab !== 'string' || !(allowed as readonly string[]).includes(tab) || seen.has(tab as PaneKind)) continue
        seen.add(tab as PaneKind)
        tabs.push(tab as PaneKind)
      }
      if (!tabs.length) return undefined
      const active = typeof node.active === 'string' && tabs.includes(node.active as PaneKind) ? (node.active as PaneKind) : tabs[0]
      return { type: 'group', id, tabs, active }
    }
    if (node.type !== 'split' || !Array.isArray(node.children)) return undefined
    const dir = node.dir === 'col' ? 'col' : 'row'
    const children = node.children.map(read).filter((child): child is PaneNode => Boolean(child))
    if (!children.length) return undefined
    if (children.length === 1) return children[0]
    const sizes = Array.isArray(node.sizes) ? node.sizes.filter((size): size is number => typeof size === 'number') : []
    return { type: 'split', id, dir, children, sizes: normalize(sizes.length === children.length ? sizes : children.map(() => 1), children.length) }
  }
  const parsed = read(value)
  counter = Math.max(counter, highest)
  return parsed
}
