/**
 * One vocabulary of colour for both graphs. The values live as CSS variables in `notes.css` so the SVG panel
 * can use plain classes; the canvas view, which cannot, reads the same variables at runtime. The constants
 * here are only the fallback for a canvas that paints before the stylesheet lands.
 */

const fallbackNodeColors: Record<KnowledgeNodeType, string> = {
  paper: '#4f7ab8', concept: '#3f9078', claim: '#b07d35', question: '#7d63bd', insight: '#8a8f5c', project: '#97785f',
}

export type EdgeStyle = { color: string; width: number; dash: number[]; arrow: boolean }

/**
 * An edge should say what kind of claim it is making before anything is clicked. Disagreement is the one a
 * researcher must never miss, so it is the only red; a plain `[[link]]` says the least and is drawn faintest.
 */
const edgeStyles: Partial<Record<KnowledgeRelationType, EdgeStyle>> = {
  contradicts: { color: '#c05a52', width: 1.5, dash: [3, 3], arrow: true },
  supports: { color: '#3f9078', width: 1.4, dash: [], arrow: true },
  evidence_for: { color: '#3f9078', width: 1.2, dash: [], arrow: true },
  defines: { color: '#4f7ab8', width: 1.3, dash: [], arrow: true },
  uses: { color: '#8f9aa8', width: 1.1, dash: [], arrow: true },
  extends: { color: '#97785f', width: 1.2, dash: [], arrow: true },
  raises: { color: '#7d63bd', width: 1.2, dash: [], arrow: true },
  answers: { color: '#7d63bd', width: 1.3, dash: [], arrow: true },
  link: { color: '#cdc6bb', width: 1, dash: [4, 3], arrow: false },
  mentions: { color: '#dcd6cc', width: 1, dash: [2, 3], arrow: false },
}
const defaultEdgeStyle: EdgeStyle = { color: '#cfc8bd', width: 1, dash: [], arrow: false }

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
