import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'
import { readNoteSnapshot, saveNoteSnapshot } from './notes.js'

export type KnowledgeNodeType = 'paper' | 'concept' | 'claim' | 'insight' | 'question' | 'project'
export type TemplateRecord = { id: string; name: string; nodeType: KnowledgeNodeType; content: string; revision: string; modifiedAt: number; isDefault: boolean; isFavorite: boolean; lastUsedAt?: number }
export type TemplateSaveRequest = { id?: string; name: string; nodeType: KnowledgeNodeType; content: string; expectedRevision?: string }

const nodeTypes = new Set<KnowledgeNodeType>(['paper', 'concept', 'claim', 'insight', 'question', 'project'])
const nodeTypeOrder: Record<KnowledgeNodeType, number> = { paper: 0, concept: 1, claim: 2, insight: 3, question: 4, project: 5 }
const initialTemplates: Array<{ id: string; name: string; nodeType: KnowledgeNodeType; content: string }> = [
  // The reading note is mostly written for you: only "내 생각" is yours to fill in.
  { id: 'paper-reading-note', name: 'Paper - 읽기 노트', nodeType: 'paper', content: '# {{title}}\n\n## 한눈에\n\n## 내가 헷갈린 것\n\n## 내가 주목한 것\n\n## 내 생각\n\n## 메모\n' },
  { id: 'paper-deep-review', name: 'Paper - 정독 양식', nodeType: 'paper', content: '# {{title}}\n\n## 한 문장 요약\n\n## 이 논문을 읽는 이유\n\n## 핵심 주장\n\n## 방법\n\n## 주요 근거\n\n## 한계와 의문\n\n## 내 아이디어\n\n## 관련 개념과 논문\n' },
  // A default holds only what a person actually writes. Everything mechanical is added by the digest once
  // it has something to say, so a new note is never a page of empty headings to fill in.
  { id: 'concept-note', name: 'Concept - 개념 노트', nodeType: 'concept', content: '# {{title}}\n\n## 내 생각\n' },
  { id: 'concept-overview', name: 'Concept - 정독 양식', nodeType: 'concept', content: '# {{title}}\n\n## 정의 비교\n\n| 논문 | 이 논문의 정의 | 차이점 |\n| --- | --- | --- |\n|  |  |  |\n\n## 직관\n\n## 수식과 표현\n\n## 관련 주장\n' },
  { id: 'claim-note', name: 'Claim - 주장 노트', nodeType: 'claim', content: '# {{title}}\n\n## 내 생각\n' },
  { id: 'claim-evidence-review', name: 'Claim - 정독 양식', nodeType: 'claim', content: '# {{title}}\n\n## 주장\n\n## 스코프와 가정\n\n## 지지 근거\n\n## 반박 근거\n\n## 판단과 확신도\n\n## 열린 질문\n' },
  { id: 'insight-research-note', name: 'Insight - Research note', nodeType: 'insight', content: '# {{title}}\n\n## 아이디어\n\n## 출발한 근거\n\n## 연결되는 개념\n\n## 검증 방법\n' },
  { id: 'question-note', name: 'Question - 질문 노트', nodeType: 'question', content: '# {{title}}\n\n## 내 생각\n' },
  { id: 'question-investigation', name: 'Question - 정독 양식', nodeType: 'question', content: '# {{title}}\n\n## 질문\n\n## 질문이 생긴 배경\n\n## 현재 근거\n\n## 다음 조사\n\n## 답변 초안\n' },
  { id: 'project-research-context', name: 'Project - Research context', nodeType: 'project', content: '# {{title}}\n\n## 연구 목표\n\n## 현재 가설\n\n## 사용하는 개념\n\n## 핵심 주장과 근거\n\n## 열린 질문\n\n## 다음 행동\n' },
]

function templatesPath(libraryPath: string) { return path.join(libraryPath, 'Templates') }
function defaultsPath(libraryPath: string) { return path.join(libraryPath, '.prism', 'template-defaults.json') }
function preferencesPath(libraryPath: string) { return path.join(libraryPath, '.prism', 'template-preferences.json') }
function safeName(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled template' }
function serializeTemplate(template: { id: string; name: string; nodeType: KnowledgeNodeType; content: string }) {
  return `---\ntype: template\ntemplate_id: ${JSON.stringify(template.id)}\nnode_type: ${template.nodeType}\nname: ${JSON.stringify(template.name)}\n---\n\n${template.content.replace(/^\s+/, '')}`
}
function field(source: string, key: string) {
  const raw = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  if (!raw) return undefined
  try { return JSON.parse(raw) as string } catch { return raw.replace(/^['"]|['"]$/g, '') }
}
function parseTemplate(source: string) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return undefined
  const id = field(match[1], 'template_id'); const name = field(match[1], 'name'); const nodeType = field(match[1], 'node_type') as KnowledgeNodeType
  if (!id || !name || !nodeTypes.has(nodeType)) return undefined
  return { id, name, nodeType, content: source.slice(match[0].length) }
}
async function defaults(libraryPath: string): Promise<Partial<Record<KnowledgeNodeType, string>>> {
  try { return JSON.parse(await fs.readFile(defaultsPath(libraryPath), 'utf8')) as Partial<Record<KnowledgeNodeType, string>> } catch { return {} }
}
type TemplatePreferences = { version: 1; favorites: string[]; recent: Record<string, number> }
async function preferences(libraryPath: string): Promise<TemplatePreferences> {
  try {
    const value = JSON.parse(await fs.readFile(preferencesPath(libraryPath), 'utf8')) as Partial<TemplatePreferences>
    const favorites = Array.isArray(value.favorites) ? value.favorites.filter((id): id is string => typeof id === 'string') : []
    const recent = value.recent && typeof value.recent === 'object' && !Array.isArray(value.recent)
      ? Object.fromEntries(Object.entries(value.recent).filter(([id, usedAt]) => typeof id === 'string' && typeof usedAt === 'number' && Number.isFinite(usedAt))) : {}
    return { version: 1, favorites: [...new Set(favorites)], recent }
  } catch { return { version: 1, favorites: [], recent: {} } }
}
async function atomicJson(filePath: string, value: unknown) {
  await atomicWriteFile(filePath, JSON.stringify(value, null, 2))
}
async function ensureVault(libraryPath: string) {
  const directories = ['00 Inbox', 'Papers', 'Concepts', 'Claims', 'Insights', 'Questions', 'Projects', 'Templates', path.join('Assets', 'PDFs'), path.join('Assets', 'Figures'), path.join('.prism', 'anchors'), path.join('.prism', 'relations'), path.join('.prism', 'index'), path.join('.prism', 'cache'), path.join('.prism', 'trash', 'templates')]
  await Promise.all(directories.map((directory) => fs.mkdir(path.join(libraryPath, directory), { recursive: true })))
  let firstInitialization = false
  try { await fs.access(defaultsPath(libraryPath)) } catch { firstInitialization = true }
  if (firstInitialization) {
    await Promise.all(initialTemplates.map(async (template) => {
      const target = path.join(templatesPath(libraryPath), `${template.name}.md`)
      try { await fs.access(target) } catch { await fs.writeFile(target, serializeTemplate(template), { encoding: 'utf8', flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error }) }
    }))
    // The first template listed for a kind is its default: the light one, not the long form beneath it.
    const seeded: Partial<Record<KnowledgeNodeType, string>> = {}
    for (const template of initialTemplates) if (!seeded[template.nodeType]) seeded[template.nodeType] = template.id
    await atomicJson(defaultsPath(libraryPath), seeded)
  } else {
    const projectMigration = path.join(libraryPath, '.prism', 'migrations', 'project-template-v1')
    try { await fs.access(projectMigration) } catch {
      const projectTemplates: Array<{ id: string }> = []
      for (const entry of await fs.readdir(templatesPath(libraryPath), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
        try { const parsed = parseTemplate(await fs.readFile(path.join(templatesPath(libraryPath), entry.name), 'utf8')); if (parsed?.nodeType === 'project') projectTemplates.push(parsed) } catch { /* Ignore unreadable templates. */ }
      }
      if (!projectTemplates.length) {
        const projectTemplate = initialTemplates.find((template) => template.nodeType === 'project')!
        const target = path.join(templatesPath(libraryPath), `${projectTemplate.name}.md`)
        await fs.writeFile(target, serializeTemplate(projectTemplate), { encoding: 'utf8', flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
        projectTemplates.push(projectTemplate)
      }
      const selectedDefaults = await defaults(libraryPath)
      if (!selectedDefaults.project) { selectedDefaults.project = projectTemplates[0].id; await atomicJson(defaultsPath(libraryPath), selectedDefaults) }
      await fs.mkdir(path.dirname(projectMigration), { recursive: true }); await fs.writeFile(projectMigration, '1\n', { encoding: 'utf8', flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
    }
  }
}
async function templateFiles(libraryPath: string) {
  await ensureVault(libraryPath)
  return (await fs.readdir(templatesPath(libraryPath), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md')).map((entry) => path.join(templatesPath(libraryPath), entry.name))
}
async function findTemplate(libraryPath: string, id: string) {
  for (const filePath of await templateFiles(libraryPath)) {
    const snapshot = await readNoteSnapshot(filePath); const parsed = parseTemplate(snapshot.content)
    if (parsed?.id === id) return { filePath, snapshot, parsed }
  }
  return undefined
}

export async function listTemplates(libraryPath: string): Promise<TemplateRecord[]> {
  const [selectedDefaults, selectedPreferences] = await Promise.all([defaults(libraryPath), preferences(libraryPath)])
  const records: Array<TemplateRecord | undefined> = await Promise.all((await templateFiles(libraryPath)).map(async (filePath): Promise<TemplateRecord | undefined> => {
    const snapshot = await readNoteSnapshot(filePath); const parsed = parseTemplate(snapshot.content)
    return parsed ? { ...parsed, revision: snapshot.revision, modifiedAt: snapshot.modifiedAt, isDefault: selectedDefaults[parsed.nodeType] === parsed.id, isFavorite: selectedPreferences.favorites.includes(parsed.id), lastUsedAt: selectedPreferences.recent[parsed.id] } : undefined
  }))
  return records.filter((record): record is TemplateRecord => Boolean(record)).sort((left, right) => nodeTypeOrder[left.nodeType] - nodeTypeOrder[right.nodeType] || left.name.localeCompare(right.name))
}

export async function saveTemplate(libraryPath: string, request: TemplateSaveRequest) {
  const name = safeName(request.name); const content = String(request.content ?? '').slice(0, 2_000_000)
  if (!nodeTypes.has(request.nodeType)) throw new Error('템플릿 노트 유형이 올바르지 않습니다.')
  if (request.id) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(request.id)) throw new Error('템플릿 ID가 올바르지 않습니다.')
    const current = await findTemplate(libraryPath, request.id)
    if (!current) throw new Error('템플릿을 찾을 수 없습니다.')
    if (!request.expectedRevision) throw new Error('템플릿 버전이 필요합니다.')
    const result = await saveNoteSnapshot(current.filePath, { content: serializeTemplate({ id: request.id, name, nodeType: request.nodeType, content }), expectedRevision: request.expectedRevision })
    if (!result.saved) return { saved: false as const }
    return { saved: true as const, templates: await listTemplates(libraryPath), id: request.id }
  }
  await ensureVault(libraryPath)
  const id = `${request.nodeType}-${randomUUID().slice(0, 8)}`
  let filePath = path.join(templatesPath(libraryPath), `${name}.md`); let suffix = 2
  while (true) { try { await fs.access(filePath); filePath = path.join(templatesPath(libraryPath), `${name} ${suffix}.md`); suffix += 1 } catch { break } }
  await fs.writeFile(filePath, serializeTemplate({ id, name, nodeType: request.nodeType, content }), { encoding: 'utf8', flag: 'wx' })
  return { saved: true as const, templates: await listTemplates(libraryPath), id }
}

export async function deleteTemplate(libraryPath: string, id: string) {
  const current = await findTemplate(libraryPath, id)
  if (!current) throw new Error('템플릿을 찾을 수 없습니다.')
  const trashPath = path.join(libraryPath, '.prism', 'trash', 'templates', `${Date.now()}-${path.basename(current.filePath)}`)
  await fs.mkdir(path.dirname(trashPath), { recursive: true }); await fs.rename(current.filePath, trashPath)
  const selectedDefaults = await defaults(libraryPath)
  if (selectedDefaults[current.parsed.nodeType] === id) { delete selectedDefaults[current.parsed.nodeType]; await atomicJson(defaultsPath(libraryPath), selectedDefaults) }
  const selectedPreferences = await preferences(libraryPath)
  selectedPreferences.favorites = selectedPreferences.favorites.filter((templateId) => templateId !== id); delete selectedPreferences.recent[id]
  await atomicJson(preferencesPath(libraryPath), selectedPreferences)
  return listTemplates(libraryPath)
}

export async function setDefaultTemplate(libraryPath: string, nodeType: KnowledgeNodeType, id: string) {
  if (!nodeTypes.has(nodeType)) throw new Error('템플릿 노트 유형이 올바르지 않습니다.')
  const template = await findTemplate(libraryPath, id)
  if (!template || template.parsed.nodeType !== nodeType) throw new Error('해당 유형의 템플릿을 찾을 수 없습니다.')
  const selectedDefaults = await defaults(libraryPath); selectedDefaults[nodeType] = id
  await atomicJson(defaultsPath(libraryPath), selectedDefaults)
  return listTemplates(libraryPath)
}

export async function setFavoriteTemplate(libraryPath: string, id: string, favorite: boolean) {
  if (!await findTemplate(libraryPath, id)) throw new Error('템플릿을 찾을 수 없습니다.')
  const selected = await preferences(libraryPath); const favorites = new Set(selected.favorites)
  if (favorite) favorites.add(id); else favorites.delete(id)
  selected.favorites = [...favorites]; await atomicJson(preferencesPath(libraryPath), selected)
  return listTemplates(libraryPath)
}

export async function markTemplateUsed(libraryPath: string, id: string) {
  if (!await findTemplate(libraryPath, id)) return
  const selected = await preferences(libraryPath); selected.recent[id] = Date.now()
  const bounded = Object.entries(selected.recent).sort((left, right) => right[1] - left[1]).slice(0, 20)
  selected.recent = Object.fromEntries(bounded); await atomicJson(preferencesPath(libraryPath), selected)
}
