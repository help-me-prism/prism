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
  // A refused run is stored too, for its notes. It must not come back looking like a reading of the paper.
  const fromModel = stored.source === 'model'
  return {
    ...outline, source: fromModel ? 'model' : 'outline', nodes, edges: [...outline.edges, ...extra],
    notes: stored.notes ?? [], model: fromModel ? stored.model : undefined,
  }
}

export async function writePaperStructure(libraryPath: string, arxivId: string, structure: PaperStructure) {
  const file = structurePath(libraryPath, arxivId)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(structure, null, 2))
}

/* ------------------------------------------------------------------ the model pass */

/**
 * What the model is allowed to do, and how it is stopped from doing anything else.
 *
 * It is asked two small questions instead of one large one. First, what kind of thing is each section — a
 * classification over ids that already exist, with the paper's own sentences in front of it. Then, given those
 * sections, which of them stand in a relation the paper itself supports. Both answers are checked against the
 * outline before anything is kept: an id that is not in the paper is dropped, a role that is not a role is
 * dropped, an edge that would make the argument circular is dropped, and if what survives is too thin the run
 * is refused outright and the reader keeps the outline it already trusted.
 */

export type RunPrompt = (prompt: string) => Promise<string>
export type StructureRunSummary = {
  paperId: string
  provider: string
  model: string
  ranAt: string
  sections: number
  rolesChanged: number
  summaries: number
  edgesAdded: number
  dropped: number
  notes: string[]
}

const roleNames: StructureRole[] = ['problem', 'background', 'method', 'component', 'rationale', 'experiment', 'result', 'limit']
const modelEdgeTypes: StructureEdgeType[] = ['needs', 'supports', 'branches', 'contrasts']
/** A paper with more sections than this is asked about in pieces, so no answer has to hold the whole outline in view. */
const CHUNK = 10
const MAX_EDGES = 8

const roleGuide = [
  'problem — what the paper says is wrong or missing',
  'background — prior work and what it could not do',
  'method — what this paper proposes',
  'component — a part of that method',
  'rationale — the argument for why the method should work',
  'experiment — how it was tested',
  'result — what the test produced',
  'limit — what is left open, or what the paper cannot do',
].join('\n')

export function buildRolePrompt(title: string, nodes: StructureNode[], quotes: Map<string, string[]>) {
  return [
    'You are labelling the sections of a research paper so that a reader can see its argument at a glance.',
    'You never write new facts. Every summary must describe what the listed section does, using only the lines quoted from it.',
    '',
    `PAPER: ${title}`,
    '',
    'ROLES:',
    roleGuide,
    '',
    'SECTIONS (only these ids may appear in your answer):',
    ...nodes.map((node) => {
      const lines = (quotes.get(node.id) ?? []).map((line) => `    "${line}"`).join('\n')
      return `- ${node.id} | S${node.section} | ${node.label}${lines ? `\n${lines}` : ''}`
    }),
    '',
    'Return ONLY a JSON object and nothing else:',
    '{"sections":[{"id":"<one listed id>","role":"<one role>","summary":"<Korean, under 20 words>"}]}',
    'Rules: use only the ids listed above, one entry per section. The summary says what that section does in this paper, in Korean, and must not state a number or a finding that is not in the quoted lines. If the quoted lines say nothing useful, give the role and leave the summary empty.',
  ].join('\n')
}

export function buildEdgePrompt(title: string, nodes: StructureNode[]) {
  return [
    'These are the sections of one research paper, in the order the paper puts them. That order is already drawn.',
    'Name only the relations between them that the paper itself supports, beyond the ordering.',
    '',
    `PAPER: ${title}`,
    '',
    'SECTIONS:',
    ...nodes.map((node) => `- ${node.id} | S${node.section} | ${node.role} | ${node.label}${node.summary ? ` | ${node.summary}` : ''}`),
    '',
    'RELATION TYPES:',
    'needs — the second section assumes what the first one establishes',
    'supports — the first section is evidence for what the second one claims',
    'branches — the second section is a further experiment or variant of the first',
    'contrasts — the second section is an alternative the paper compares against the first',
    '',
    'Return ONLY a JSON object and nothing else:',
    '{"relations":[{"from":"<id>","to":"<id>","type":"needs|supports|branches|contrasts","why":"<Korean, under 15 words>"}]}',
    `Rules: use only the ids listed. Never relate a section to itself. At most ${MAX_EDGES} relations, and prefer few well-grounded ones over many. Prefer relations that point forwards through the paper. Do not restate the section order itself.`,
  ].join('\n')
}

/** The same JSON-out-of-a-chat-reply reading the knowledge suggestions use: fenced, bare, or wrapped in prose. */
function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{'); const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('모델 응답에서 JSON을 찾지 못했습니다.')
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
}

export type RolePatch = { id: string; role: StructureRole; summary?: string }

export function parseRoleResponse(text: string, allowed: Set<string>): RolePatch[] {
  const value = extractJson(text)
  const rows = Array.isArray(value.sections) ? value.sections : []
  const seen = new Set<string>()
  const patches: RolePatch[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { id, role, summary } = row as { id?: unknown; role?: unknown; summary?: unknown }
    if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) continue
    if (typeof role !== 'string' || !roleNames.includes(role as StructureRole)) continue
    seen.add(id)
    const line = typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    patches.push({ id, role: role as StructureRole, summary: line || undefined })
  }
  return patches
}

export function parseEdgeResponse(text: string, allowed: Set<string>, existing: StructureEdge[] = []): StructureEdge[] {
  const value = extractJson(text)
  const rows = Array.isArray(value.relations) ? value.relations : []
  const already = new Set(existing.map((edge) => `${edge.from}->${edge.to}`))
  const edges: StructureEdge[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { from, to, type, why } = row as { from?: unknown; to?: unknown; type?: unknown; why?: unknown }
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) continue
    if (!allowed.has(from) || !allowed.has(to)) continue
    if (typeof type !== 'string' || !modelEdgeTypes.includes(type as StructureEdgeType)) continue
    const key = `${from}->${to}`
    if (already.has(key)) continue
    already.add(key)
    edges.push({
      id: `m-${from}-${to}`, from, to, type: type as StructureEdgeType, origin: 'model',
      why: typeof why === 'string' ? why.replace(/\s+/g, ' ').trim().slice(0, 90) || undefined : undefined,
    })
    if (edges.length >= MAX_EDGES) break
  }
  return edges
}

/**
 * Keeps the picture a flow. An edge that closes a loop cannot be laid out left to right and, more to the point,
 * claims the paper both leads to and follows from the same section — so it is refused rather than drawn
 * somewhere misleading.
 */
export function withoutCycles(base: StructureEdge[], proposed: StructureEdge[]) {
  const out = new Map<string, string[]>()
  const add = (edge: StructureEdge) => out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to])
  const reaches = (from: string, to: string) => {
    const seen = new Set<string>(); const stack = [from]
    while (stack.length) {
      const at = stack.pop()!
      if (at === to) return true
      if (seen.has(at)) continue
      seen.add(at)
      stack.push(...(out.get(at) ?? []))
    }
    return false
  }
  for (const edge of base) add(edge)
  const kept: StructureEdge[] = []
  const dropped: StructureEdge[] = []
  for (const edge of proposed) {
    if (reaches(edge.to, edge.from)) { dropped.push(edge); continue }
    add(edge); kept.push(edge)
  }
  return { kept, dropped }
}

/** Two or three of a section's own sentences: enough to say what it is about, short enough to stay in view. */
function quotesFor(nodes: StructureNode[], anchors: Anchor[]) {
  const text = new Map(anchors.map((anchor) => [anchor.id, anchor.source.replace(/\s+/g, ' ').trim()]))
  return new Map(nodes.map((node) => [node.id, node.evidence.slice(0, 3)
    .map((id) => (text.get(id) ?? '').slice(0, 220)).filter((line) => line.length > 40)]))
}

export async function refinePaperStructure(
  libraryPath: string, arxivId: string, title: string,
  provider: string, model: string, runPrompt: RunPrompt,
): Promise<StructureRunSummary> {
  const [anchors, korean] = await Promise.all([readAnchors(libraryPath, arxivId), readKoreanLabels(libraryPath, arxivId)])
  const outline = buildOutline(arxivId, anchors, korean)
  if (outline.nodes.length < 2) throw new Error('먼저 원문을 열어 논문 구조를 분석해 주세요.')

  const allowed = new Set(outline.nodes.map((node) => node.id))
  const quotes = quotesFor(outline.nodes, anchors)
  const notes: string[] = []

  const patches = new Map<string, RolePatch>()
  for (let at = 0; at < outline.nodes.length; at += CHUNK) {
    const chunk = outline.nodes.slice(at, at + CHUNK)
    try {
      for (const patch of parseRoleResponse(await runPrompt(buildRolePrompt(title, chunk, quotes)), allowed)) patches.set(patch.id, patch)
    } catch (reason) {
      notes.push(`구간 ${at + 1}–${at + chunk.length}의 역할 분석을 쓰지 못했습니다: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }
  // Too few sections came back to call this a reading of the paper, so the outline stands and says why.
  if (patches.size < Math.ceil(outline.nodes.length / 2)) {
    notes.push('모델이 논문의 절반도 설명하지 못해 결과를 쓰지 않았습니다. 논문 목차만 표시합니다.')
    await writePaperStructure(libraryPath, arxivId, { ...outline, notes })
    return { paperId: arxivId, provider, model, ranAt: new Date().toISOString(), sections: outline.nodes.length, rolesChanged: 0, summaries: 0, edgesAdded: 0, dropped: 0, notes }
  }

  const nodes = outline.nodes.map((node) => {
    const patch = patches.get(node.id)
    return patch ? { ...node, role: patch.role, roleOrigin: 'model' as const, summary: patch.summary } : node
  })

  let proposed: StructureEdge[] = []
  try { proposed = parseEdgeResponse(await runPrompt(buildEdgePrompt(title, nodes)), allowed, outline.edges) }
  catch (reason) { notes.push(`연결 분석을 쓰지 못했습니다: ${reason instanceof Error ? reason.message : String(reason)}`) }
  const { kept, dropped } = withoutCycles(outline.edges, proposed)
  if (dropped.length) notes.push(`앞뒤가 순환하는 연결 ${dropped.length}개를 버렸습니다.`)

  const ranAt = new Date().toISOString()
  await writePaperStructure(libraryPath, arxivId, {
    ...outline, source: 'model', nodes, edges: [...outline.edges, ...kept], notes,
    model: { provider, model, ranAt },
  })
  return {
    paperId: arxivId, provider, model, ranAt, sections: outline.nodes.length,
    rolesChanged: nodes.filter((node, index) => node.role !== outline.nodes[index].role).length,
    summaries: nodes.filter((node) => node.summary).length,
    edgesAdded: kept.length, dropped: dropped.length, notes,
  }
}
