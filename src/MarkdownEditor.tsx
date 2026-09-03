import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { redo, undo } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import katex from 'katex'

export type MarkdownBlockCommand = 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'callout' | 'table' | 'code' | 'math' | 'image' | 'divider'
export type MarkdownEditorHandle = { applyBlock: (command: MarkdownBlockCommand) => void; insertText: (text: string) => void; insertWikiLink: (option: WikiLinkOption) => void; getValue: () => string; focus: () => void; moveToEnd: () => void }
export type WikiLinkOption = { id: string; label: string; target: string; description: string; searchText?: string; preview?: string; evidenceCount?: number }
export type EvidenceLinkOption = { id: string; label: string; description: string; searchText: string; markdown: string }

type MarkdownEditorProps = {
  value: string
  disabled?: boolean
  liveEdit?: boolean
  label: string
  onChange: (value: string) => void
  onBlur: () => void
  wikiLinks?: WikiLinkOption[]
  evidenceLinks?: EvidenceLinkOption[]
  onCreateWikiLink?: (nodeType: 'concept' | 'claim', title: string) => Promise<WikiLinkOption | undefined>
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

function menuPosition(coords: { top: number; bottom: number; left: number } | null, bounds: DOMRect | undefined, width: number, estimatedHeight = 190) {
  if (!coords || !bounds) return { top: 42, left: 24 }
  const below = coords.bottom - bounds.top + 5
  const top = below + estimatedHeight <= bounds.height ? below : Math.max(6, coords.top - bounds.top - estimatedHeight - 5)
  return { top, left: Math.min(coords.left - bounds.left, Math.max(12, bounds.width - width)) }
}

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

const crossPlatformHistoryKeys = Prec.high(keymap.of([
  { key: 'Ctrl-z', run: undo },
  { key: 'Cmd-z', run: undo },
  { key: 'Ctrl-Shift-z', run: redo },
  { key: 'Cmd-Shift-z', run: redo },
  { key: 'Ctrl-y', run: redo },
]))

type DecorationRange = { from: number; to: number; decoration: Decoration }

type MarkdownBlock = { from: number; to: number; contentTo: number; label: string }

function markdownBlocks(state: EditorState) {
  const text = state.doc.toString()
  const frontmatterEnd = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0
  const blocks: MarkdownBlock[] = []
  let start: number | undefined
  let contentTo = frontmatterEnd
  let fence: string | undefined
  const finish = (nextFrom: number) => {
    if (start === undefined) return
    const firstLine = state.doc.lineAt(start).text.replace(/^\s*(?:#{1,6}|[-*+] |\d+\. |>\s*)\s*/, '').trim()
    blocks.push({ from: start, to: nextFrom, contentTo, label: firstLine.slice(0, 52) || '빈 블록' })
    start = undefined
  }
  for (let number = state.doc.lineAt(Math.min(frontmatterEnd, state.doc.length)).number; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (line.to <= frontmatterEnd) continue
    const trimmed = line.text.trim()
    if (start === undefined) {
      if (!trimmed) continue
      start = line.from
    }
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fenceMatch && (!fence || fenceMatch[1][0] === fence[0])) fence = fence ? undefined : fenceMatch[1]
    if (trimmed || fence) contentTo = line.to
    const next = number < state.doc.lines ? state.doc.line(number + 1) : undefined
    if (!fence && (!next || !next.text.trim())) {
      let nextFrom = next?.from ?? state.doc.length
      let blankNumber = number + 1
      while (blankNumber <= state.doc.lines && !state.doc.line(blankNumber).text.trim()) {
        nextFrom = state.doc.line(blankNumber).to < state.doc.length ? state.doc.line(blankNumber).to + 1 : state.doc.length
        blankNumber += 1
      }
      finish(nextFrom)
    }
  }
  finish(state.doc.length)
  return blocks
}

function moveMarkdownBlock(view: EditorView, sourcePosition: number, targetPosition: number, after: boolean) {
  const blocks = markdownBlocks(view.state)
  const source = blocks.find((block) => sourcePosition >= block.from && sourcePosition < Math.max(block.to, block.contentTo + 1))
  const target = blocks.find((block) => targetPosition >= block.from && targetPosition <= block.contentTo)
  if (!source || !target || source === target) return false
  const destination = after ? target.to : target.from
  if (destination > source.from && destination < source.to) return false
  let insert = view.state.doc.sliceString(source.from, source.to)
  if (destination < view.state.doc.length && !/\r?\n\s*$/.test(insert)) insert += '\n\n'
  view.dispatch({ changes: [{ from: source.from, to: source.to, insert: '' }, { from: destination, insert }] })
  return true
}

function markdownBlockHandleDOM(position: number, label: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-block-drag-handle'
    button.textContent = '⣿'
    button.draggable = true
    button.dataset.blockPosition = String(position)
    button.title = `"${label}" 블록 드래그해 이동`
    button.setAttribute('aria-label', button.title)
    button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    button.addEventListener('dragstart', (event) => {
      event.stopPropagation()
      event.dataTransfer?.setData('application/x-prism-markdown-block', String(position))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      button.classList.add('dragging')
    })
    button.addEventListener('dragend', () => {
      button.classList.remove('dragging')
      document.querySelectorAll('.cm-block-drop-before, .cm-block-drop-after').forEach((element) => element.classList.remove('cm-block-drop-before', 'cm-block-drop-after'))
    })
    return button
}

class MarkdownBlockHandle extends WidgetType {
  constructor(readonly position: number, readonly label: string) { super() }
  eq(other: MarkdownBlockHandle) { return this.position === other.position && this.label === other.label }
  toDOM() {
    return markdownBlockHandleDOM(this.position, this.label)
  }
  ignoreEvent() { return false }
}

function blockHandleDecorationSet(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of markdownBlocks(view.state)) builder.add(block.from, block.from, Decoration.widget({ widget: new MarkdownBlockHandle(block.from, block.label), side: -2 }))
  return builder.finish()
}

const blockHandleDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = blockHandleDecorationSet(view) }
  update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = blockHandleDecorationSet(update.view) }
}, { decorations: (value) => value.decorations })

const toggleSectionFold = StateEffect.define<number>({ map: (position, changes) => changes.mapPos(position) })

class SectionFoldToggle extends WidgetType {
  constructor(readonly position: number, readonly label: string, readonly folded: boolean) { super() }
  eq(other: SectionFoldToggle) { return this.position === other.position && this.label === other.label && this.folded === other.folded }
  toDOM(view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-section-fold-toggle'
    button.textContent = this.folded ? '▸' : '▾'
    button.title = this.folded ? `"${this.label}" 섹션 펼치기` : `"${this.label}" 섹션 접기`
    button.setAttribute('aria-label', button.title)
    button.setAttribute('aria-expanded', String(!this.folded))
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => { event.preventDefault(); view.dispatch({ effects: toggleSectionFold.of(this.position) }) })
    return button
  }
  ignoreEvent() { return false }
}

class SectionFoldSummary extends WidgetType {
  constructor(readonly lineCount: number) { super() }
  eq(other: SectionFoldSummary) { return this.lineCount === other.lineCount }
  toDOM() {
    const summary = document.createElement('span')
    summary.className = 'cm-section-fold-summary'
    summary.textContent = `… ${this.lineCount}줄 접힘`
    summary.setAttribute('aria-hidden', 'true')
    return summary
  }
}

type SectionHeading = { from: number; contentFrom: number; end: number; level: number; label: string; lineCount: number }

function sectionHeadings(state: EditorState) {
  const headings: Omit<SectionHeading, 'end' | 'lineCount'>[] = []
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    const match = line.text.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (match) headings.push({ from: line.from, contentFrom: Math.min(state.doc.length, line.to + 1), level: match[1].length, label: match[2] })
  }
  return headings.map((heading, index): SectionHeading => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
    const end = next?.from ?? state.doc.length
    const startLine = state.doc.lineAt(heading.contentFrom).number
    const endLine = state.doc.lineAt(Math.max(heading.contentFrom, end - 1)).number
    return { ...heading, end, lineCount: Math.max(0, endLine - startLine + 1) }
  })
}

function sectionFoldDecorations(state: EditorState, folded: ReadonlySet<number>) {
  const headings = sectionHeadings(state)
  const validFolded = new Set(headings.filter((heading) => folded.has(heading.from)).map((heading) => heading.from))
  const hidden: { from: number; to: number }[] = []
  const ranges: DecorationRange[] = []
  for (const heading of headings) {
    if (hidden.some((range) => heading.from >= range.from && heading.from < range.to)) continue
    const isFolded = validFolded.has(heading.from) && heading.contentFrom < heading.end
    ranges.push({ from: heading.from, to: heading.from, decoration: Decoration.widget({ widget: new SectionFoldToggle(heading.from, heading.label, isFolded), side: -1 }) })
    if (isFolded) {
      hidden.push({ from: heading.contentFrom, to: heading.end })
      ranges.push({ from: heading.contentFrom, to: heading.end, decoration: Decoration.replace({ widget: new SectionFoldSummary(heading.lineCount), block: true }) })
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) builder.add(range.from, range.to, range.decoration)
  return { folded: validFolded, decorations: builder.finish() }
}

const sectionFoldState = StateField.define<{ folded: ReadonlySet<number>; decorations: DecorationSet }>({
  create: (state) => sectionFoldDecorations(state, new Set()),
  update(value, transaction) {
    const folded = new Set([...value.folded].map((position) => transaction.changes.mapPos(position)))
    for (const effect of transaction.effects) {
      if (!effect.is(toggleSectionFold)) continue
      if (folded.has(effect.value)) folded.delete(effect.value)
      else folded.add(effect.value)
    }
    return sectionFoldDecorations(transaction.state, folded)
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

type RenderedBlock =
  | { type: 'table'; from: number; to: number; rows: string[][] }
  | { type: 'math'; from: number; to: number; source: string }
  | { type: 'image'; from: number; to: number; alt: string; source: string }
  | { type: 'code'; from: number; to: number; language: string; source: string }
  | { type: 'divider'; from: number; to: number }

function tableCells(line: string) {
  const cells = line.trim().split('|').map((cell) => cell.trim())
  if (!cells[0]) cells.shift()
  if (!cells.at(-1)) cells.pop()
  return cells
}

function renderedBlocks(state: EditorState) {
  const blocks: RenderedBlock[] = []
  const frontmatter = state.doc.toString().match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  const frontmatterEnd = frontmatter?.[0].length ?? 0
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    const trimmed = line.text.trim()
    if (line.from < frontmatterEnd) continue
    if (/^```/.test(trimmed)) {
      let closing = number + 1
      while (closing <= state.doc.lines && !/^```\s*$/.test(state.doc.line(closing).text.trim())) closing += 1
      if (closing <= state.doc.lines) {
        const closingLine = state.doc.line(closing)
        blocks.push({ type: 'code', from: line.from, to: closingLine.to, language: trimmed.slice(3).trim(), source: state.doc.sliceString(line.to + 1, closingLine.from).replace(/\r?\n$/, '') })
        number = closing
        continue
      }
    }
    if (trimmed === '$$') {
      let closing = number + 1
      while (closing <= state.doc.lines && state.doc.line(closing).text.trim() !== '$$') closing += 1
      if (closing <= state.doc.lines) {
        const closingLine = state.doc.line(closing)
        blocks.push({ type: 'math', from: line.from, to: closingLine.to, source: state.doc.sliceString(line.to + 1, closingLine.from).trim() })
        number = closing
        continue
      }
    }
    const image = line.text.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)\s*$/)
    if (image) {
      blocks.push({ type: 'image', from: line.from, to: line.to, alt: image[1], source: image[2] })
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'divider', from: line.from, to: line.to })
      continue
    }
    if (number >= state.doc.lines || !line.text.includes('|')) continue
    const delimiter = tableCells(state.doc.line(number + 1).text)
    if (!delimiter.length || !delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    const rows = [tableCells(line.text)]
    let ending = number + 1
    while (ending + 1 <= state.doc.lines && state.doc.line(ending + 1).text.includes('|') && state.doc.line(ending + 1).text.trim()) {
      ending += 1
      rows.push(tableCells(state.doc.line(ending).text))
    }
    blocks.push({ type: 'table', from: line.from, to: state.doc.line(ending).to, rows })
    number = ending
  }
  return blocks
}

abstract class InteractiveRenderedBlock extends WidgetType {
  constructor(readonly position: number) { super() }
  openSource(view: EditorView, element: HTMLElement, label: string) {
    element.tabIndex = 0
    element.setAttribute('role', 'button')
    element.setAttribute('aria-label', `${label} Markdown 편집`)
    const open = (event: Event) => { event.preventDefault(); view.dispatch({ selection: { anchor: this.position }, scrollIntoView: true }); view.focus() }
    element.addEventListener('mousedown', open)
    element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') open(event) })
  }
  ignoreEvent() { return false }
}

class RenderedTable extends InteractiveRenderedBlock {
  constructor(position: number, readonly rows: string[][]) { super(position) }
  eq(other: RenderedTable) { return this.position === other.position && JSON.stringify(this.rows) === JSON.stringify(other.rows) }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'cm-rendered-block cm-rendered-table'
    wrapper.append(markdownBlockHandleDOM(this.position, this.rows[0]?.join(' | ') || '표'))
    const table = document.createElement('table')
    this.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      row.forEach((cell) => { const item = document.createElement(rowIndex === 0 ? 'th' : 'td'); item.textContent = cell; tr.append(item) })
      table.append(tr)
    })
    wrapper.append(table); this.openSource(view, wrapper, '표'); return wrapper
  }
}

class RenderedMath extends InteractiveRenderedBlock {
  constructor(position: number, readonly source: string) { super(position) }
  eq(other: RenderedMath) { return this.position === other.position && this.source === other.source }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'cm-rendered-block cm-rendered-math'
    wrapper.innerHTML = katex.renderToString(this.source, { displayMode: true, throwOnError: false, strict: false })
    wrapper.prepend(markdownBlockHandleDOM(this.position, '$$'))
    this.openSource(view, wrapper, '수식'); return wrapper
  }
}

class RenderedImage extends InteractiveRenderedBlock {
  constructor(position: number, readonly alt: string, readonly source: string) { super(position) }
  eq(other: RenderedImage) { return this.position === other.position && this.alt === other.alt && this.source === other.source }
  toDOM(view: EditorView) {
    const figure = document.createElement('figure'); figure.className = 'cm-rendered-block cm-rendered-image'
    figure.append(markdownBlockHandleDOM(this.position, `![${this.alt}](${this.source})`))
    if (/^(?:data:|blob:|https?:\/\/)/i.test(this.source)) {
      const image = document.createElement('img'); image.src = this.source; image.alt = this.alt; figure.append(image)
    } else {
      const placeholder = document.createElement('div'); placeholder.textContent = '▧'; placeholder.setAttribute('aria-hidden', 'true'); figure.append(placeholder)
    }
    const caption = document.createElement('figcaption'); caption.textContent = this.alt || this.source; const pathLabel = document.createElement('small'); pathLabel.textContent = this.source
    caption.append(pathLabel); figure.append(caption); this.openSource(view, figure, '이미지'); return figure
  }
}

class RenderedCode extends InteractiveRenderedBlock {
  constructor(position: number, readonly language: string, readonly source: string) { super(position) }
  eq(other: RenderedCode) { return this.position === other.position && this.language === other.language && this.source === other.source }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'cm-rendered-block cm-rendered-code'
    wrapper.append(markdownBlockHandleDOM(this.position, this.language ? `\`\`\`${this.language}` : '```'))
    if (this.language) { const label = document.createElement('small'); label.textContent = this.language; wrapper.append(label) }
    const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = this.source; pre.append(code); wrapper.append(pre)
    this.openSource(view, wrapper, '코드 블록'); return wrapper
  }
}

class RenderedDivider extends InteractiveRenderedBlock {
  eq(other: RenderedDivider) { return this.position === other.position }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'cm-rendered-block cm-rendered-divider'
    wrapper.append(markdownBlockHandleDOM(this.position, '---')); wrapper.append(document.createElement('hr'))
    this.openSource(view, wrapper, '구분선'); return wrapper
  }
}

class RenderedTaskCheckbox extends WidgetType {
  constructor(readonly position: number, readonly checked: boolean) { super() }
  eq(other: RenderedTaskCheckbox) { return this.position === other.position && this.checked === other.checked }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'cm-rendered-task-checkbox'; input.checked = this.checked
    input.setAttribute('aria-label', this.checked ? '완료된 할 일' : '미완료 할 일')
    input.addEventListener('change', () => { view.dispatch({ changes: { from: this.position, to: this.position + 3, insert: input.checked ? '[x]' : '[ ]' } }); view.focus() })
    return input
  }
  ignoreEvent() { return false }
}

function renderedBlockDecorationSet(state: EditorState) {
  const ranges: DecorationRange[] = []
  const activeLine = state.doc.lineAt(state.selection.main.head)
  const isActive = (from: number, to: number) => from <= activeLine.to && to >= activeLine.from
  for (const block of renderedBlocks(state)) {
    if (isActive(block.from, block.to)) continue
    const widget = block.type === 'table'
      ? new RenderedTable(block.from, block.rows)
      : block.type === 'math'
        ? new RenderedMath(block.from, block.source)
        : block.type === 'image'
          ? new RenderedImage(block.from, block.alt, block.source)
          : block.type === 'code'
            ? new RenderedCode(block.from, block.language, block.source)
            : new RenderedDivider(block.from)
    ranges.push({ from: block.from, to: block.to, decoration: Decoration.replace({ widget, block: true }) })
  }
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of ranges) builder.add(range.from, range.to, range.decoration)
  return builder.finish()
}

const renderedBlockState = StateField.define<DecorationSet>({
  create: renderedBlockDecorationSet,
  update(value, transaction) { return transaction.docChanged || transaction.selection ? renderedBlockDecorationSet(transaction.state) : value },
  provide: (field) => EditorView.decorations.from(field),
})

function liveEditDecorationSet(view: EditorView) {
  const ranges: DecorationRange[] = []
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head)
  const isActive = (from: number, to: number) => from <= activeLine.to && to >= activeLine.from
  const rendered = renderedBlocks(view.state).filter((block) => !isActive(block.from, block.to))
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
      const renderedBlock = rendered.find((block) => line.from >= block.from && line.from <= block.to)
      if (renderedBlock) {
        if (line.number === view.state.doc.lines) break
        line = view.state.doc.line(line.number + 1)
        continue
      }
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
      else if (/^\s*- \[[ xX]\]\s/.test(text)) {
        ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-md-task' }) })
        const marker = text.match(/^\s*- (\[[ xX]\])\s/)
        if (marker && !isActive(line.from, line.to)) {
          const from = line.from + marker[0].indexOf(marker[1])
          ranges.push({ from, to: from + 3, decoration: Decoration.replace({ widget: new RenderedTaskCheckbox(from, /[xX]/.test(marker[1])) }) })
        }
      }
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

function insertWikiLink(view: EditorView, option: WikiLinkOption, replace: { from: number; to: number } = view.state.selection.main) {
  const frontmatterEnd = view.state.doc.toString().match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0
  const from = replace.from < frontmatterEnd ? frontmatterEnd : replace.from
  const to = replace.to < frontmatterEnd ? frontmatterEnd : replace.to
  const insert = `[[${option.target}|${option.label}]]`
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true })
  view.focus()
}

function replaceWithBlock(view: EditorView, replace: { from: number; to: number }, text: string) {
  const before = view.state.doc.sliceString(Math.max(0, replace.from - 2), replace.from)
  const after = view.state.doc.sliceString(replace.to, Math.min(view.state.doc.length, replace.to + 2))
  const prefix = replace.from === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const suffix = replace.to === view.state.doc.length || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const insert = `${prefix}${text}${suffix}`
  view.dispatch({ changes: { from: replace.from, to: replace.to, insert }, selection: { anchor: replace.from + insert.length }, scrollIntoView: true }); view.focus()
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ value, disabled = false, liveEdit = false, label, onChange, onBlur, wikiLinks = [], evidenceLinks = [], onCreateWikiLink }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())
  const visualMode = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const wikiLinksRef = useRef(wikiLinks)
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
  const evidenceRef = useRef<SlashState | null>(null)
  const filteredEvidenceRef = useRef<EvidenceLinkOption[]>([])
  const activeEvidenceIndexRef = useRef(0)
  const [evidence, setEvidence] = useState<SlashState | null>(null)
  const [activeEvidenceIndex, setActiveEvidenceIndex] = useState(0)
  const [hoverWiki, setHoverWiki] = useState<{ option: WikiLinkOption; top: number; left: number }>()
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
    const score = (option: WikiLinkOption) => {
      if (!query) return 0
      const label = option.label.toLocaleLowerCase()
      if (label.startsWith(query)) return 0
      if (label.includes(query)) return 1
      if (`${option.target} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(query)) return 2
      if (option.description.toLocaleLowerCase().includes(query)) return 3
      return 4
    }
    return wikiLinks
      .filter((option) => !query || `${option.label} ${option.target} ${option.description} ${option.searchText ?? ''} ${option.preview ?? ''}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label))
      .slice(0, 40)
  }, [wiki, wikiLinks])
  const filteredEvidenceLinks = useMemo(() => {
    if (!evidence) return []
    const query = evidence.query.toLocaleLowerCase()
    return evidenceLinks.filter((option) => !query || `${option.label} ${option.description} ${option.searchText}`.toLocaleLowerCase().includes(query)).slice(0, 40)
  }, [evidence, evidenceLinks])

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onBlurRef.current = onBlur }, [onBlur])
  useEffect(() => { wikiLinksRef.current = wikiLinks }, [wikiLinks])
  useEffect(() => { slashRef.current = slash }, [slash])
  useLayoutEffect(() => { filteredRef.current = filteredCommands }, [filteredCommands])
  useEffect(() => { activeSlashIndexRef.current = activeSlashIndex }, [activeSlashIndex])
  useEffect(() => { wikiRef.current = wiki }, [wiki])
  useLayoutEffect(() => { filteredWikiRef.current = filteredWikiLinks }, [filteredWikiLinks])
  useEffect(() => { activeWikiIndexRef.current = activeWikiIndex }, [activeWikiIndex])
  useEffect(() => { evidenceRef.current = evidence }, [evidence])
  useLayoutEffect(() => { filteredEvidenceRef.current = filteredEvidenceLinks }, [filteredEvidenceLinks])
  useEffect(() => { activeEvidenceIndexRef.current = activeEvidenceIndex }, [activeEvidenceIndex])

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
    insertWikiLink(view, option, current)
  }
  async function createWikiLink(nodeType: 'concept' | 'claim') {
    const view = viewRef.current; const current = wikiRef.current; const title = current?.query.trim()
    if (!view || !current || !title || !onCreateWikiLink) return
    const option = await onCreateWikiLink(nodeType, title)
    if (option) chooseWikiLink(option)
  }
  function closeEvidenceMenu() { evidenceRef.current = null; setEvidence(null); setActiveEvidenceIndex(0) }
  function chooseEvidenceLink(option: EvidenceLinkOption) {
    const view = viewRef.current; const current = evidenceRef.current
    if (!view || !current) return
    closeEvidenceMenu(); replaceWithBlock(view, current, option.markdown)
  }

  useImperativeHandle(ref, () => ({ applyBlock: (command) => { if (viewRef.current) insertBlock(viewRef.current, command) }, insertText: (text) => { if (viewRef.current) insertText(viewRef.current, text) }, insertWikiLink: (option) => { if (viewRef.current) insertWikiLink(viewRef.current, option) }, getValue: () => viewRef.current?.state.doc.toString() ?? '', focus: () => viewRef.current?.focus(), moveToEnd: () => { const view = viewRef.current; if (view) view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true }) } }), [])

  useEffect(() => {
    if (!hostRef.current) return
    const liveExtensions = liveEdit ? [liveEditDecorations, renderedBlockState, blockHandleDecorations, sectionFoldState, EditorView.editorAttributes.of({ class: 'cm-live-edit' })] : []
    const moveSlashSelection = (delta: number) => {
      if (evidenceRef.current && filteredEvidenceRef.current.length) {
        const next = (activeEvidenceIndexRef.current + delta + filteredEvidenceRef.current.length) % filteredEvidenceRef.current.length
        activeEvidenceIndexRef.current = next; setActiveEvidenceIndex(next); return true
      }
      if (wikiRef.current && filteredWikiRef.current.length) {
        const next = (activeWikiIndexRef.current + delta + filteredWikiRef.current.length) % filteredWikiRef.current.length
        activeWikiIndexRef.current = next; setActiveWikiIndex(next); return true
      }
      if (!slashRef.current || !filteredRef.current.length) return false
      const next = (activeSlashIndexRef.current + delta + filteredRef.current.length) % filteredRef.current.length
      activeSlashIndexRef.current = next; setActiveSlashIndex(next); return true
    }
    const applySlashSelection = () => {
      if (evidenceRef.current && filteredEvidenceRef.current.length) { chooseEvidenceLink(filteredEvidenceRef.current[activeEvidenceIndexRef.current] ?? filteredEvidenceRef.current[0]); return true }
      if (wikiRef.current && filteredWikiRef.current.length) { chooseWikiLink(filteredWikiRef.current[activeWikiIndexRef.current] ?? filteredWikiRef.current[0]); return true }
      if (!slashRef.current || !filteredRef.current.length) return false
      chooseSlashCommand(filteredRef.current[activeSlashIndexRef.current] ?? filteredRef.current[0]); return true
    }
    const slashKeymap = Prec.high(keymap.of([
      { key: 'ArrowDown', run: () => moveSlashSelection(1) },
      { key: 'ArrowUp', run: () => moveSlashSelection(-1) },
      { key: 'Enter', run: applySlashSelection },
      { key: 'Tab', run: applySlashSelection },
      { key: 'Escape', run: () => { if (evidenceRef.current) { closeEvidenceMenu(); return true } if (wikiRef.current) { closeWikiMenu(); return true } if (!slashRef.current) return false; closeSlashMenu(); return true } },
    ]))
    const frontmatter = value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: value, selection: { anchor: frontmatter?.[0].length ?? 0 }, extensions: [
        slashKeymap, crossPlatformHistoryKeys, basicSetup, markdown(), EditorView.lineWrapping, prismEditorTheme,
        editable.current.of(EditorView.editable.of(!disabled)), visualMode.current.of(liveExtensions),
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
        EditorView.domEventHandlers({
          blur: () => { onBlurRef.current(); return false },
          dragover: (event, view) => {
            if (!event.dataTransfer?.types.includes('application/x-prism-markdown-block')) return false
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (position === null) return true
            const block = markdownBlocks(view.state).find((item) => position >= item.from && position <= item.contentTo)
            const line = (event.target as HTMLElement).closest?.('.cm-line') as HTMLElement | null
            document.querySelectorAll('.cm-block-drop-before, .cm-block-drop-after').forEach((element) => element.classList.remove('cm-block-drop-before', 'cm-block-drop-after'))
            if (block && line) line.classList.add(event.clientY > line.getBoundingClientRect().top + line.getBoundingClientRect().height / 2 ? 'cm-block-drop-after' : 'cm-block-drop-before')
            return true
          },
          drop: (event, view) => {
            const source = Number(event.dataTransfer?.getData('application/x-prism-markdown-block'))
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (!Number.isInteger(source) || position === null) return false
            event.preventDefault()
            const line = (event.target as HTMLElement).closest?.('.cm-line') as HTMLElement | null
            const after = Boolean(line && event.clientY > line.getBoundingClientRect().top + line.getBoundingClientRect().height / 2)
            const moved = moveMarkdownBlock(view, source, position, after)
            document.querySelectorAll('.cm-block-drop-before, .cm-block-drop-after').forEach((element) => element.classList.remove('cm-block-drop-before', 'cm-block-drop-after'))
            if (moved) view.focus()
            return moved
          },
          mouseover: (event) => {
            const marker = (event.target as HTMLElement).closest?.('.cm-md-wikilink') as HTMLElement | null
            if (!marker || !hostRef.current) return false
            const key = marker.textContent?.split('|')[0].replaceAll('\\', '/').toLocaleLowerCase()
            const option = wikiLinksRef.current.find((item) => item.target.toLocaleLowerCase() === key || item.label.toLocaleLowerCase() === key)
            if (!option) return false
            const markerBounds = marker.getBoundingClientRect(); const hostBounds = hostRef.current.getBoundingClientRect()
            setHoverWiki({ option, top: markerBounds.bottom - hostBounds.top + 6, left: Math.min(markerBounds.left - hostBounds.left, Math.max(12, hostBounds.width - 280)) }); return false
          },
          mouseout: (event) => { if ((event.target as HTMLElement).closest?.('.cm-md-wikilink')) setHoverWiki(undefined); return false },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString())
          if (!update.docChanged && !update.selectionSet) return
          const selection = update.state.selection.main
          if (!selection.empty) { closeSlashMenu(); closeWikiMenu(); closeEvidenceMenu(); return }
          const line = update.state.doc.lineAt(selection.head)
          const prefix = update.state.doc.sliceString(line.from, selection.head)
          const wikiMatch = prefix.match(/\[\[([^\]\n]*)$/u)
          if (wikiMatch) {
            closeSlashMenu(); closeEvidenceMenu()
            const from = selection.head - wikiMatch[1].length - 2
            const coords = update.view.coordsAtPos(selection.head); const bounds = hostRef.current?.getBoundingClientRect()
            const next = { from, to: selection.head, query: wikiMatch[1], ...menuPosition(coords, bounds, 300) }
            wikiRef.current = next; setWiki(next); activeWikiIndexRef.current = 0; setActiveWikiIndex(0); return
          }
          closeWikiMenu()
          const evidenceMatch = prefix.match(/(?:^|\s)@([^\s@]*)$/u)
          if (evidenceMatch) {
            closeSlashMenu()
            const from = selection.head - evidenceMatch[1].length - 1
            const coords = update.view.coordsAtPos(selection.head); const bounds = hostRef.current?.getBoundingClientRect()
            const next = { from, to: selection.head, query: evidenceMatch[1], ...menuPosition(coords, bounds, 320) }
            evidenceRef.current = next; setEvidence(next); activeEvidenceIndexRef.current = 0; setActiveEvidenceIndex(0); return
          }
          closeEvidenceMenu()
          const match = prefix.match(/(?:^|\s)\/([^\s/]*)$/u)
          if (!match) { closeSlashMenu(); return }
          const from = selection.head - match[1].length - 1
          const coords = update.view.coordsAtPos(selection.head); const bounds = hostRef.current?.getBoundingClientRect()
          const next = { from, to: selection.head, query: match[1], ...menuPosition(coords, bounds, 280) }
          slashRef.current = next; setSlash(next); activeSlashIndexRef.current = 0; setActiveSlashIndex(0)
        }),
      ] }),
    })
    viewRef.current = view
    return () => { viewRef.current = null; view.destroy() }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    const frontmatter = value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
    const anchor = current.length === 0 ? (frontmatter?.[0].length ?? 0) : Math.min(view.state.selection.main.head, value.length)
    syncingRef.current = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor } }); syncingRef.current = false
  }, [value])
  useEffect(() => { viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!disabled)) }) }, [disabled])
  useEffect(() => {
    const extensions = liveEdit ? [liveEditDecorations, renderedBlockState, blockHandleDecorations, sectionFoldState, EditorView.editorAttributes.of({ class: 'cm-live-edit' })] : []
    viewRef.current?.dispatch({ effects: visualMode.current.reconfigure(extensions) })
  }, [liveEdit])

  return <div className="markdown-editor" ref={hostRef}>
    {slash && <div className="slash-command-menu" role="listbox" aria-label="블록 삽입 명령" style={{ top: slash.top, left: slash.left }}>
      {filteredCommands.length ? filteredCommands.map((option, index) => <button key={option.command} className={index === activeSlashIndex ? 'active' : ''} role="option" aria-selected={index === activeSlashIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlashCommand(option)}><strong>{option.label}</strong><small>{option.description}</small></button>) : <p>일치하는 블록이 없습니다</p>}
    </div>}
    {wiki && <div className="wiki-link-menu" role="listbox" aria-label="지식 링크 자동완성" style={{ top: wiki.top, left: wiki.left }}>
      {filteredWikiLinks.length ? filteredWikiLinks.map((option, index) => <button key={option.id} className={index === activeWikiIndex ? 'active' : ''} role="option" aria-selected={index === activeWikiIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseWikiLink(option)}><strong>{option.label}</strong><small>{option.description} · {option.target}</small></button>) : <p>일치하는 지식 노트가 없습니다</p>}
      {wiki.query.trim() && !wikiLinks.some((option) => option.label.toLocaleLowerCase() === wiki.query.trim().toLocaleLowerCase()) && onCreateWikiLink && <footer><button onMouseDown={(event) => event.preventDefault()} onClick={() => void createWikiLink('concept')}>Concept로 만들기</button><button onMouseDown={(event) => event.preventDefault()} onClick={() => void createWikiLink('claim')}>Claim으로 만들기</button></footer>}
    </div>}
    {evidence && <div className="evidence-link-menu" role="listbox" aria-label="PDF 근거 자동완성" style={{ top: evidence.top, left: evidence.left }}>{filteredEvidenceLinks.length ? filteredEvidenceLinks.map((option, index) => <button key={option.id} className={index === activeEvidenceIndex ? 'active' : ''} role="option" aria-selected={index === activeEvidenceIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseEvidenceLink(option)}><strong>{option.label}</strong><small>{option.description}</small></button>) : <p>일치하는 PDF 근거가 없습니다</p>}</div>}
    {hoverWiki && <aside className="wiki-link-preview" role="tooltip" style={{ top: hoverWiki.top, left: hoverWiki.left }}><small>{hoverWiki.option.description}</small><strong>{hoverWiki.option.label}</strong><p>{hoverWiki.option.preview || '작성된 요약이 없습니다.'}</p><span>PDF 근거 {hoverWiki.option.evidenceCount ?? 0}개</span></aside>}
  </div>
})

export default MarkdownEditor
