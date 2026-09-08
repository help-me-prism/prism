import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'

/**
 * What a paper argues, as a graph.
 *
 * The reader already writes every anchor it found in a paper — headings, sentences, equations, captions, with
 * the page each one sits on — so the paper's own outline is on disk before anyone asks for it. That outline is
 * the skeleton: sections in the order the paper puts them, subsections hanging off the section they belong to,
 * every node carrying the anchor id that takes the reader back to the page it came from.
 *
 * The skeleton is built from the paper, never guessed, so it is always available and always the same for the
 * same paper. A model can only refine what is already here — change a role, add a relation between two nodes
 * that exist, write a one-line summary — and every refinement it proposes is checked against these ids before
 * it is kept.
 */

export type StructureRole = 'problem' | 'background' | 'method' | 'component' | 'rationale' | 'experiment' | 'result' | 'limit'
export type StructureEdgeType = 'then' | 'part' | 'needs' | 'supports' | 'branches' | 'contrasts'
/** `outline` is the paper's own table of contents; `model` is a proposal that passed validation. */
export type StructureOrigin = 'outline' | 'model'

export type StructureNode = {
  id: string
  role: StructureRole
  /** The section title with its number stripped, which is what a reader recognises. */
  label: string
  labelKo?: string
  /** The number as printed: "3.2.1". Empty for a section the paper did not number. */
  section: string
  level: number
  page: number
  /** The heading's reader anchor, so a click on the node lands on the page that says it. */
  anchorId: string
  /** Anchors of the prose under this heading — what a model is allowed to quote, and nothing else. */
  evidence: string[]
  summary?: string
  roleOrigin: StructureOrigin
}

export type StructureEdge = { id: string; from: string; to: string; type: StructureEdgeType; origin: StructureOrigin; why?: string }

export type PaperStructure = {
  version: 1
  paperId: string
  generatedAt: string
  /** Whether anything in here came from a model, or it is the paper's outline alone. */
  source: StructureOrigin
  sourceHash: string
  nodes: StructureNode[]
  edges: StructureEdge[]
  /** Why the reader is looking at an outline when it asked for a model run. */
  notes: string[]
  model?: { provider: string; model: string; ranAt: string }
}

type Anchor = { id: string; type: string; page: number; source: string; sectionTitle?: string }

/* ------------------------------------------------------------------ reading what the reader saved */

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T } catch { return undefined }
}

const paperDirectory = (libraryPath: string, arxivId: string) => path.join(libraryPath, 'papers', arxivId)
export const structurePath = (libraryPath: string, arxivId: string) =>
  path.join(libraryPath, '.prism', 'structure', `${arxivId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)}.json`)

async function readAnchors(libraryPath: string, arxivId: string): Promise<Anchor[]> {
  const safe = arxivId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
  for (const file of [path.join(paperDirectory(libraryPath, arxivId), 'anchors.json'), path.join(libraryPath, '.prism', 'anchors', `${safe}.json`)]) {
    const data = await readJson<{ anchors?: Anchor[] }>(file)
    if (data?.anchors?.length) return data.anchors
  }
  return []
}

/** The Korean the reader already paid for, by anchor id, so the map can label a node in the reader's language. */
async function readKoreanLabels(libraryPath: string, arxivId: string) {
  const cache = await readJson<{ segments?: Array<{ id: string; translation?: string }> }>(path.join(paperDirectory(libraryPath, arxivId), 'translation.ko.json'))
  return new Map((cache?.segments ?? []).filter((segment) => segment.translation).map((segment) => [segment.id, segment.translation as string]))
}

/* ------------------------------------------------------------------ the outline */

const noise = /^(references?|bibliography|acknowledge?ments?|appendix|abstract|keywords?|supplementary)\b/i
/** A numbered heading is the reliable signal; everything else has to look like a section title on its own. */
const numbered = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/

const roleRules: Array<{ role: StructureRole; test: RegExp }> = [
  { role: 'problem', test: /introduction|motivation|problem|서론|동기|문제/i },
  { role: 'background', test: /background|related\s*work|preliminar|prior\s*work|배경|관련\s*연구|사전/i },
  { role: 'rationale', test: /^why\b|analysis|discussion|rationale|complexity|justification|분석|논의|이유/i },
  { role: 'experiment', test: /experiment|training|setup|implementation|dataset|protocol|hardware|optimi[sz]er|regulari[sz]ation|batching|학습|실험|설정|구현/i },
  { role: 'result', test: /result|evaluation|ablation|comparison|performance|benchmark|결과|평가|성능/i },
  { role: 'limit', test: /conclusion|future|limitation|outlook|broader\s*impact|결론|한계|향후|전망/i },
  { role: 'method', test: /method|model|architecture|approach|framework|proposed|design|algorithm|attention|network|모델|방법|구조|설계/i },
]

/**
 * What kind of thing a section is. Titles are the only evidence the outline has, so a subsection with nothing
 * distinctive in its title inherits from its parent — "3.2 Attention" under a method section is a component of
 * that method, not a second method.
 */
function roleFor(title: string, level: number, parent?: StructureNode): StructureRole {
  const matched = roleRules.find((rule) => rule.test.test(title))?.role
  if (matched) return level > 1 && matched === 'method' ? 'component' : matched
  if (parent) return parent.role === 'method' ? 'component' : parent.role
  return 'method'
}

const sectionOf = (id: string) => id.split('.').slice(0, -1).join('.')

/**
 * The paper's own order, as a graph: top-level sections run left to right, and a subsection hangs off the
 * section that contains it. Nothing here is inferred — every edge is something the paper's numbering states.
 */
export function buildOutline(paperId: string, anchors: Anchor[], korean = new Map<string, string>()): PaperStructure {
  const headings = anchors.filter((anchor) => anchor.type === 'heading' && anchor.source.trim().length > 2)
  const nodes: StructureNode[] = []
  const byNumber = new Map<string, StructureNode>()
  let ordinal = 0

  for (const heading of headings) {
    const title = heading.source.replace(/\s+/g, ' ').trim()
    if (noise.test(title)) continue
    const match = title.match(numbered)
    // Without a number we cannot tell a section title from a running head, so only numbered headings become nodes.
    if (!match) continue
    const [, number, rest] = match
    const label = rest.replace(/\s*[.·]\s*$/, '').trim()
    if (!label) continue
    const level = number.split('.').length
    const parent = byNumber.get(sectionOf(number))
    ordinal += 1
    const node: StructureNode = {
      id: `s${number}`, section: number, level, label, labelKo: korean.get(heading.id),
      role: roleFor(label, level, parent), roleOrigin: 'outline',
      page: heading.page, anchorId: heading.id, evidence: [],
    }
    // A paper that numbers two sections the same way gets one node each; the ordinal keeps the ids apart.
    if (byNumber.has(number)) node.id = `s${number}-${ordinal}`
    byNumber.set(number, node)
    nodes.push(node)
  }

  // Prose under a heading, in reading order, is that section's evidence — the only text a model may quote.
  const headingIds = new Set(nodes.map((node) => node.anchorId))
  let current: StructureNode | undefined
  for (const anchor of anchors) {
    if (headingIds.has(anchor.id)) { current = nodes.find((node) => node.anchorId === anchor.id); continue }
    if (!current || anchor.type !== 'text' || anchor.source.trim().length < 40) continue
    if (current.evidence.length < 40) current.evidence.push(anchor.id)
  }

  const edges: StructureEdge[] = []
  const tops = nodes.filter((node) => node.level === 1)
  tops.forEach((node, index) => {
    const next = tops[index + 1]
    if (next) edges.push({ id: `e-${node.id}-${next.id}`, from: node.id, to: next.id, type: 'then', origin: 'outline' })
  })
  for (const node of nodes) {
    if (node.level === 1) continue
    const parent = byNumber.get(sectionOf(node.section))
    if (parent) edges.push({ id: `e-${parent.id}-${node.id}`, from: parent.id, to: node.id, type: 'part', origin: 'outline' })
  }

  return {
    version: 1, paperId, generatedAt: new Date().toISOString(), source: 'outline',
    sourceHash: outlineHash(nodes), nodes, edges, notes: [],
  }
}

/** Identifies the outline a stored refinement was made against: if the paper is re-analysed, the cache is stale. */
export function outlineHash(nodes: StructureNode[]) {
  return createHash('sha256').update(nodes.map((node) => `${node.id}|${node.anchorId}|${node.label}`).join('\n')).digest('hex').slice(0, 32)
}

/* ------------------------------------------------------------------ what the reader asks for */

export async function readPaperStructure(libraryPath: string, arxivId: string): Promise<PaperStructure> {
  const [anchors, korean] = await Promise.all([readAnchors(libraryPath, arxivId), readKoreanLabels(libraryPath, arxivId)])
  const outline = buildOutline(arxivId, anchors, korean)
  if (!outline.nodes.length) {
    outline.notes.push(anchors.length
      ? '이 논문에서 번호가 붙은 섹션 제목을 찾지 못했습니다. 원문을 한 번 열어 구조 분석을 마치면 표시됩니다.'
      : '아직 이 논문의 구조를 분석하지 않았습니다. 원문을 한 번 열면 만들어집니다.')
    return outline
  }
  const stored = await readJson<PaperStructure>(structurePath(libraryPath, arxivId))
  return stored && stored.sourceHash === outline.sourceHash ? mergeRefinement(outline, stored) : outline
}

/**
 * Puts a stored model run back on top of the outline. The outline always wins on structure — which nodes exist,
 * where they came from, what page they are on — and the model may only colour it in: a role, a summary, and
 * relations between nodes the outline already has.
 */
export function mergeRefinement(outline: PaperStructure, stored: PaperStructure): PaperStructure {
  const known = new Map(outline.nodes.map((node) => [node.id, node]))
  const refined = new Map(stored.nodes.map((node) => [node.id, node]))
  const nodes = outline.nodes.map((node) => {
    const patch = refined.get(node.id)
    if (!patch) return node
    return {
      ...node,
      role: patch.roleOrigin === 'model' ? patch.role : node.role,
      roleOrigin: patch.roleOrigin === 'model' ? ('model' as const) : node.roleOrigin,
      summary: patch.summary,
    }
  })
  const seen = new Set(outline.edges.map((edge) => `${edge.from}->${edge.to}`))
  const extra = stored.edges.filter((edge) => edge.origin === 'model' && known.has(edge.from) && known.has(edge.to)
    && edge.from !== edge.to && !seen.has(`${edge.from}->${edge.to}`))
  return { ...outline, source: 'model', nodes, edges: [...outline.edges, ...extra], notes: stored.notes ?? [], model: stored.model }
}

export async function writePaperStructure(libraryPath: string, arxivId: string, structure: PaperStructure) {
  const file = structurePath(libraryPath, arxivId)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(structure, null, 2))
}
