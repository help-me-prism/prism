import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, Prec, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { basicSetup } from 'codemirror'

export type MarkdownBlockCommand = 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'callout' | 'table' | 'code' | 'math' | 'image' | 'divider'
export type MarkdownEditorHandle = { applyBlock: (command: MarkdownBlockCommand) => void; insertText: (text: string) => void; focus: () => void; moveToEnd: () => void }
export type WikiLinkOption = { id: string; label: string; target: string; description: string }

type MarkdownEditorProps = {
  value: string
  disabled?: boolean
  liveEdit?: boolean
  label: string
  onChange: (value: string) => void
  onBlur: () => void
  wikiLinks?: WikiLinkOption[]
}

type SlashState = { from: number; to: number; query: string; top: number; left: number }
type CommandOption = { command: MarkdownBlockCommand; label: string; description: string; keywords: string }

export const markdownBlockCommands: CommandOption[] = [
  { command: 'heading', label: '제목', description: '섹션 제목을 추가합니다', keywords: 'heading header 제목 헤딩' },
  { command: 'bullet', label: '글머리표 목록', description: '순서 없는 목록을 추가합니다', keywords: 'bullet list 글머리 목록' },
  { command: 'ordered', label: '번호 목록', description: '순서 있는 목록을 추가합니다', keywords: 'number ordered list 번호 목록' },
  { command: 'task', label: '체크박스', description: '할 일 항목을 추가합니다', keywords: 'task checkbox todo 체크 할일' },
  { command: 'quote', label: '인용', description: '인용문 블록을 추가합니다', keywords: 'quote blockquote 인용' },
  { command: 'callout', label: 'Callout', description: 'Obsidian 호환 메모 블록을 추가합니다', keywords: 'callout note 메모 콜아웃' },
  { command: 'table', label: '표', description: '2열 표를 추가합니다', keywords: 'table grid 표 테이블' },
  { command: 'code', label: '코드 블록', description: '코드 영역을 추가합니다', keywords: 'code fence 코드' },
  { command: 'math', label: '수식 블록', description: 'LaTeX 수식 영역을 추가합니다', keywords: 'math latex equation 수식' },
  { command: 'image', label: '이미지', description: '이미지 링크를 추가합니다', keywords: 'image picture figure 이미지 피겨' },
  { command: 'divider', label: '구분선', description: '문서 구분선을 추가합니다', keywords: 'divider rule separator 구분선' },
]

const prismEditorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-content': { minHeight: '100%', caretColor: '#6354b5' },
  '.cm-cursor': { borderLeftColor: '#6354b5' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#dcd7f4' },
  '.cm-activeLine': { backgroundColor: '#f4f1e9' },
  '.cm-gutters': { display: 'none' },
})

type DecorationRange = { from: number; to: number; decoration: Decoration }

function liveEditDecorationSet(view: EditorView) {
  const ranges: DecorationRange[] = []
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head)
  const isActive = (from: number, to: number) => from <= activeLine.to && to >= activeLine.from
  const frontmatter = view.state.doc.toString().match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  const frontmatterEnd = frontmatter?.[0].length ?? 0
  const editingFrontmatter = frontmatterEnd > 0 && activeLine.from < frontmatterEnd
  const addInline = (lineFrom: number, text: string, expression: RegExp, className: string, markerSize: number) => {
    for (const match of text.matchAll(expression)) {
      if (match.index === undefined) continue
      const from = lineFrom + match.index
      const to = from + match[0].length
      ranges.push({ from: from + markerSize, to: to - markerSize, decoration: Decoration.mark({ class: className }) })
      if (!isActive(from, to)) {
        ranges.push({ from, to: from + markerSize, decoration: Decoration.replace({}) })
        ranges.push({ from: to - markerSize, to, decoration: Decoration.replace({}) })
      }
    }
  }

  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from)
    while (line.from <= visible.to) {
      const text = line.text
      if (frontmatterEnd > 0 && line.from < frontmatterEnd && !editingFrontmatter) {
        ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-frontmatter' }) })
        if (line.number === view.state.doc.lines) break
        line = view.state.doc.line(line.number + 1)
        continue
      }
      const heading = text.match(/^(#{1,6})\s+/)
      if (heading) {
        ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: `cm-md-heading cm-md-h${heading[1].length}` }) })
        if (!isActive(line.from, line.to)) ranges.push({ from: line.from, to: line.from + heading[0].length, decoration: Decoration.replace({}) })
      } else if (/^\s*>\s?/.test(text)) {
        const callout = text.match(/^\s*>\s*\[![\w-]+\]\s*/i)
        const quote = text.match(/^\s*>\s?/)
        const evidenceLink = /^\s*>\s*\[PDF 원문 열기\]\(prism:\/\/paper\//.test(text)
        ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: evidenceLink ? 'cm-md-evidence-link' : callout ? 'cm-md-callout' : 'cm-md-quote' }) })
        if (!isActive(line.from, line.to) && (callout || quote)) ranges.push({ from: line.from, to: line.from + (callout ?? quote)![0].length, decoration: Decoration.replace({}) })
      }
      else if (/^\s*- \[[ xX]\]\s/.test(text)) ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-task' }) })
      else if (/^\s*(?:[-*+] |\d+\. )/.test(text)) ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-list' }) })
      else if (/^\s*```/.test(text)) ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-code-fence' }) })
      else if (/^\s*\$\$/.test(text)) ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-math-fence' }) })
      else if (/^\s*---\s*$/.test(text)) ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-divider' }) })
      else if (/^\^[a-zA-Z0-9_-]+\s*$/.test(text)) ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-block-id' }) })

      addInline(line.from, text, /\*\*[^*\n]+\*\*/g, 'cm-md-strong', 2)
      addInline(line.from, text, /(?<!\*)\*[^*\n]+\*(?!\*)/g, 'cm-md-emphasis', 1)
      addInline(line.from, text, /`[^`\n]+`/g, 'cm-md-inline-code', 1)
      addInline(line.from, text, /\$[^$\n]+\$/g, 'cm-md-inline-math', 1)
      addInline(line.from, text, /\[\[[^\]\n]+\]\]/g, 'cm-md-wikilink', 2)
      if (!isActive(line.from, line.to)) {
        for (const comment of text.matchAll(/<!--[\s\S]*?-->/g)) {
          if (comment.index !== undefined) ranges.push({ from: line.from + comment.index, to: line.from + comment.index + comment[0].length, decoration: Decoration.replace({}) })
        }
      }
      if (line.number === view.state.doc.lines) break
      line = view.state.doc.line(line.number + 1)
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) builder.add(range.from, range.to, range.decoration)
  return builder.finish()
}

const liveEditDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = liveEditDecorationSet(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = liveEditDecorationSet(update.view)
  }
}, { decorations: (value) => value.decorations })

function blockTemplate(command: MarkdownBlockCommand, selected: string) {
  const lines = selected ? selected.split('\n') : []
  switch (command) {
    case 'heading': return { text: `## ${selected || '제목'}`, selectFrom: 3, selectLength: selected ? 0 : 2 }
    case 'bullet': return { text: (lines.length ? lines : ['목록 항목']).map((line) => `- ${line}`).join('\n'), selectFrom: 2, selectLength: selected ? 0 : 5 }
    case 'ordered': return { text: (lines.length ? lines : ['목록 항목']).map((line, index) => `${index + 1}. ${line}`).join('\n'), selectFrom: 3, selectLength: selected ? 0 : 5 }
    case 'task': return { text: (lines.length ? lines : ['할 일']).map((line) => `- [ ] ${line}`).join('\n'), selectFrom: 6, selectLength: selected ? 0 : 3 }
    case 'quote': return { text: (lines.length ? lines : ['인용문']).map((line) => `> ${line}`).join('\n'), selectFrom: 2, selectLength: selected ? 0 : 3 }
    case 'callout': return { text: `> [!note] 메모\n> ${selected || '내용을 입력하세요'}`, selectFrom: 15, selectLength: selected ? 0 : 9 }
    case 'table': return { text: '| 항목 | 내용 |\n| --- | --- |\n|  |  |', selectFrom: 32, selectLength: 0 }
    case 'code': return { text: `\`\`\`\n${selected || '코드를 입력하세요'}\n\`\`\``, selectFrom: 4, selectLength: selected ? 0 : 9 }
    case 'math': return { text: `$$\n${selected || '수식을 입력하세요'}\n$$`, selectFrom: 3, selectLength: selected ? 0 : 9 }
    case 'image': return { text: '![이미지 설명](Assets/image.png)', selectFrom: 2, selectLength: 6 }
    case 'divider': return { text: '---', selectFrom: 3, selectLength: 0 }
  }
}

function insertBlock(view: EditorView, command: MarkdownBlockCommand, replace?: { from: number; to: number }) {
  const selection = replace ?? view.state.selection.main
  const selected = replace ? '' : view.state.doc.sliceString(selection.from, selection.to)
  const template = blockTemplate(command, selected)
  const before = view.state.doc.sliceString(Math.max(0, selection.from - 2), selection.from)
  const after = view.state.doc.sliceString(selection.to, Math.min(view.state.doc.length, selection.to + 2))
  const prefix = selection.from === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const suffix = selection.to === view.state.doc.length || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const anchor = selection.from + prefix.length + template.selectFrom
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert: `${prefix}${template.text}${suffix}` }, selection: { anchor, head: anchor + template.selectLength }, scrollIntoView: true })
  view.focus()
}

function insertText(view: EditorView, text: string) {
  const selection = view.state.selection.main
  const frontmatter = view.state.doc.toString().match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  const position = Math.max(selection.to, frontmatter?.[0].length ?? 0)
  const before = view.state.doc.sliceString(Math.max(0, position - 2), position)
  const after = view.state.doc.sliceString(position, Math.min(view.state.doc.length, position + 2))
  const prefix = position === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const suffix = position === view.state.doc.length || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const insert = `${prefix}${text}${suffix}`
  view.dispatch({ changes: { from: position, insert }, selection: { anchor: position + insert.length }, scrollIntoView: true })
  view.focus()
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ value, disabled = false, liveEdit = false, label, onChange, onBlur, wikiLinks = [] }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())
  const visualMode = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const syncingRef = useRef(false)
  const slashRef = useRef<SlashState | null>(null)
  const filteredRef = useRef<CommandOption[]>(markdownBlockCommands)
  const activeSlashIndexRef = useRef(0)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const wikiRef = useRef<SlashState | null>(null)
  const filteredWikiRef = useRef<WikiLinkOption[]>([])
  const activeWikiIndexRef = useRef(0)
  const [wiki, setWiki] = useState<SlashState | null>(null)
  const [activeWikiIndex, setActiveWikiIndex] = useState(0)
  const filteredCommands = useMemo(() => {
    const query = slash?.query.toLocaleLowerCase() ?? ''
    if (!slash) return []
    const score = (option: CommandOption) => {
      const label = option.label.toLocaleLowerCase()
      if (!query || label === query) return 0
      if (label.startsWith(query)) return 1
      if (option.keywords.toLocaleLowerCase().split(' ').some((keyword) => keyword === query || keyword.startsWith(query))) return 2
      return 3
    }
    return markdownBlockCommands.filter((option) => !query || `${option.label} ${option.keywords}`.toLocaleLowerCase().includes(query)).sort((a, b) => score(a) - score(b))
  }, [slash])
  const filteredWikiLinks = useMemo(() => {
    if (!wiki) return []
    const query = wiki.query.toLocaleLowerCase()
    return wikiLinks.filter((option) => !query || `${option.label} ${option.target} ${option.description}`.toLocaleLowerCase().includes(query)).slice(0, 40)
  }, [wiki, wikiLinks])

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onBlurRef.current = onBlur }, [onBlur])
  useEffect(() => { slashRef.current = slash }, [slash])
  useEffect(() => { filteredRef.current = filteredCommands }, [filteredCommands])
  useEffect(() => { activeSlashIndexRef.current = activeSlashIndex }, [activeSlashIndex])
  useEffect(() => { wikiRef.current = wiki }, [wiki])
  useEffect(() => { filteredWikiRef.current = filteredWikiLinks }, [filteredWikiLinks])
  useEffect(() => { activeWikiIndexRef.current = activeWikiIndex }, [activeWikiIndex])

  function closeSlashMenu() { slashRef.current = null; setSlash(null); setActiveSlashIndex(0) }
  function chooseSlashCommand(option: CommandOption) {
    const view = viewRef.current; const current = slashRef.current
    if (!view || !current) return
    closeSlashMenu(); insertBlock(view, option.command, { from: current.from, to: current.to })
  }
  function closeWikiMenu() { wikiRef.current = null; setWiki(null); setActiveWikiIndex(0) }
  function chooseWikiLink(option: WikiLinkOption) {
    const view = viewRef.current; const current = wikiRef.current
    if (!view || !current) return
    closeWikiMenu()
    const insert = `[[${option.target}|${option.label}]]`
    view.dispatch({ changes: { from: current.from, to: current.to, insert }, selection: { anchor: current.from + insert.length }, scrollIntoView: true })
    view.focus()
  }

  useImperativeHandle(ref, () => ({ applyBlock: (command) => { if (viewRef.current) insertBlock(viewRef.current, command) }, insertText: (text) => { if (viewRef.current) insertText(viewRef.current, text) }, focus: () => viewRef.current?.focus(), moveToEnd: () => { const view = viewRef.current; if (view) view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true }) } }), [])

  useEffect(() => {
    if (!hostRef.current) return
    const liveExtensions = liveEdit ? [liveEditDecorations, EditorView.editorAttributes.of({ class: 'cm-live-edit' })] : []
    const moveSlashSelection = (delta: number) => {
      if (wikiRef.current && filteredWikiRef.current.length) {
        const next = (activeWikiIndexRef.current + delta + filteredWikiRef.current.length) % filteredWikiRef.current.length
        activeWikiIndexRef.current = next; setActiveWikiIndex(next); return true
      }
      if (!slashRef.current || !filteredRef.current.length) return false
      const next = (activeSlashIndexRef.current + delta + filteredRef.current.length) % filteredRef.current.length
      activeSlashIndexRef.current = next; setActiveSlashIndex(next); return true
    }
    const applySlashSelection = () => {
      if (wikiRef.current && filteredWikiRef.current.length) { chooseWikiLink(filteredWikiRef.current[activeWikiIndexRef.current] ?? filteredWikiRef.current[0]); return true }
      if (!slashRef.current || !filteredRef.current.length) return false
      chooseSlashCommand(filteredRef.current[activeSlashIndexRef.current] ?? filteredRef.current[0]); return true
    }
    const slashKeymap = Prec.high(keymap.of([
      { key: 'ArrowDown', run: () => moveSlashSelection(1) },
      { key: 'ArrowUp', run: () => moveSlashSelection(-1) },
      { key: 'Enter', run: applySlashSelection },
      { key: 'Tab', run: applySlashSelection },
      { key: 'Escape', run: () => { if (wikiRef.current) { closeWikiMenu(); return true } if (!slashRef.current) return false; closeSlashMenu(); return true } },
    ]))
    const frontmatter = value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: value, selection: { anchor: frontmatter?.[0].length ?? 0 }, extensions: [
        slashKeymap, basicSetup, markdown(), EditorView.lineWrapping, prismEditorTheme,
        editable.current.of(EditorView.editable.of(!disabled)), visualMode.current.of(liveExtensions),
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
        EditorView.domEventHandlers({
          blur: () => { onBlurRef.current(); return false },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString())
          if (!update.docChanged && !update.selectionSet) return
          const selection = update.state.selection.main
          if (!selection.empty) { closeSlashMenu(); closeWikiMenu(); return }
          const line = update.state.doc.lineAt(selection.head)
          const prefix = update.state.doc.sliceString(line.from, selection.head)
          const wikiMatch = prefix.match(/\[\[([^\]\n]*)$/u)
          if (wikiMatch) {
            closeSlashMenu()
            const from = selection.head - wikiMatch[1].length - 2
            const coords = update.view.coordsAtPos(selection.head); const bounds = hostRef.current?.getBoundingClientRect()
            const next = { from, to: selection.head, query: wikiMatch[1], top: coords && bounds ? coords.bottom - bounds.top + 5 : 42, left: coords && bounds ? Math.min(coords.left - bounds.left, Math.max(12, bounds.width - 300)) : 24 }
            wikiRef.current = next; setWiki(next); activeWikiIndexRef.current = 0; setActiveWikiIndex(0); return
          }
          closeWikiMenu()
          const match = prefix.match(/(?:^|\s)\/([^\s/]*)$/u)
          if (!match) { closeSlashMenu(); return }
          const from = selection.head - match[1].length - 1
          const coords = update.view.coordsAtPos(selection.head); const bounds = hostRef.current?.getBoundingClientRect()
          const next = { from, to: selection.head, query: match[1], top: coords && bounds ? coords.bottom - bounds.top + 5 : 42, left: coords && bounds ? Math.min(coords.left - bounds.left, Math.max(12, bounds.width - 280)) : 24 }
          slashRef.current = next; setSlash(next); activeSlashIndexRef.current = 0; setActiveSlashIndex(0)
        }),
      ] }),
    })
    viewRef.current = view
    return () => { viewRef.current = null; view.destroy() }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    syncingRef.current = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }); syncingRef.current = false
  }, [value])
  useEffect(() => { viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!disabled)) }) }, [disabled])
  useEffect(() => {
    const extensions = liveEdit ? [liveEditDecorations, EditorView.editorAttributes.of({ class: 'cm-live-edit' })] : []
    viewRef.current?.dispatch({ effects: visualMode.current.reconfigure(extensions) })
  }, [liveEdit])

  return <div className="markdown-editor" ref={hostRef}>
    {slash && <div className="slash-command-menu" role="listbox" aria-label="블록 삽입 명령" style={{ top: slash.top, left: slash.left }}>
      {filteredCommands.length ? filteredCommands.map((option, index) => <button key={option.command} className={index === activeSlashIndex ? 'active' : ''} role="option" aria-selected={index === activeSlashIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashCommand(option)}><strong>{option.label}</strong><small>{option.description}</small></button>) : <p>일치하는 블록이 없습니다</p>}
    </div>}
    {wiki && <div className="wiki-link-menu" role="listbox" aria-label="지식 링크 자동완성" style={{ top: wiki.top, left: wiki.left }}>
      {filteredWikiLinks.length ? filteredWikiLinks.map((option, index) => <button key={option.id} className={index === activeWikiIndex ? 'active' : ''} role="option" aria-selected={index === activeWikiIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseWikiLink(option)}><strong>{option.label}</strong><small>{option.description} · {option.target}</small></button>) : <p>일치하는 지식 노트가 없습니다</p>}
    </div>}
  </div>
})

export default MarkdownEditor
