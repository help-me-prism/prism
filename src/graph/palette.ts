/**
 * One vocabulary of colour for both graphs. The values live as CSS variables in `notes.css` so the SVG panel
 * can use plain classes; the canvas view, which cannot, reads the same variables at runtime. The constants
 * here are only the fallback for a canvas that paints before the stylesheet lands.
 */

const fallbackNodeColors: Record<KnowledgeNodeType, string> = {
  paper: '#5580b4', concept: '#3f8a72', claim: '#b8873c', question: '#7f68b8', insight: '#868b5c', project: '#95765e',
}

export type EdgeStyle = { color: string; width: number; dash: number[]; arrow: boolean }

/**
 * Three tiers, not one colour per relation type. A vault of any size drawn with seven edge colours is a
 * stained-glass window nobody can read — the eye spends itself telling `정의함` from `사용함`, which is a
 * distinction the reader can get from one hover, while the distinction that actually changes a decision is
 * lost in the pattern.
 *
 * So: green where a paper backs a claim, red where one disputes it, and one quiet grey for the structure that
 * holds the rest together. A plain `[[link]]` and an unapproved proposal are fainter still. Colour is spent
 * only where it answers "is this settled or contested".
 */
const judgment = { supports: '#3f8a6f', contradicts: '#bd5a52' }
const structure = '#b3aca1'

const edgeStyles: Partial<Record<KnowledgeRelationType, EdgeStyle>> = {
  contradicts: { color: judgment.contradicts, width: 1.5, dash: [3, 3], arrow: true },
  supports: { color: judgment.supports, width: 1.4, dash: [], arrow: true },
  evidence_for: { color: judgment.supports, width: 1.2, dash: [], arrow: true },
  defines: { color: structure, width: 1.15, dash: [], arrow: true },
  uses: { color: structure, width: 1, dash: [], arrow: true },
  extends: { color: structure, width: 1.05, dash: [], arrow: true },
  raises: { color: structure, width: 1, dash: [], arrow: true },
  answers: { color: structure, width: 1.15, dash: [], arrow: true },
  link: { color: '#d3ccc1', width: 1, dash: [4, 3], arrow: false },
  mentions: { color: '#ded8ce', width: 1, dash: [2, 3], arrow: false },
}
const defaultEdgeStyle: EdgeStyle = { color: structure, width: 1, dash: [], arrow: false }

/** What the legend names, in the order it names it. */
export const edgeLegend: Array<{ label: string; color: string; dash: boolean }> = [
  { label: '지지함', color: judgment.supports, dash: false },
  { label: '반박함', color: judgment.contradicts, dash: true },
  { label: '그 밖의 관계', color: structure, dash: false },
  { label: '본문 링크', color: '#d3ccc1', dash: true },
]

let cache: { nodes: Record<KnowledgeNodeType, string> } | undefined

function readVariables(): Record<KnowledgeNodeType, string> {
  if (cache) return cache.nodes
  const nodes = { ...fallbackNodeColors }
  if (typeof window !== 'undefined') {
    const style = window.getComputedStyle(document.documentElement)
    for (const type of Object.keys(nodes) as KnowledgeNodeType[]) {
      const value = style.getPropertyValue(`--kind-${type}`).trim()
      if (value) nodes[type] = value
    }
  }
  cache = { nodes }
  return nodes
}

export function nodeColor(type: KnowledgeNodeType) { return readVariables()[type] ?? fallbackNodeColors.concept }
export function edgeStyle(type: KnowledgeRelationType, origin: RelationOrigin, approved: boolean): EdgeStyle {
  if (origin === 'link') return edgeStyles.link!
  const style = edgeStyles[type] ?? defaultEdgeStyle
  // A proposal is drawn as one: same colour, no weight behind it.
  return approved ? style : { ...style, width: 1, dash: [2, 3], arrow: false }
}

/** Circle area, not radius, tracks connection count — a hub reads as a hub without swallowing the canvas. */
export function nodeRadius(degree: number, base = 5) { return base + Math.min(Math.sqrt(degree) * 2.1, 9) }
