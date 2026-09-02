import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { basicSetup } from 'codemirror'

type MarkdownEditorProps = {
  value: string
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  onBlur: () => void
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

export default function MarkdownEditor({ value, disabled = false, label, onChange, onBlur }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const syncingRef = useRef(false)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onBlurRef.current = onBlur }, [onBlur])

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          prismEditorTheme,
          editable.current.of(EditorView.editable.of(!disabled)),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorView.domEventHandlers({ blur: () => { onBlurRef.current(); return false } }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { viewRef.current = null; view.destroy() }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    syncingRef.current = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    syncingRef.current = false
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!disabled)) })
  }, [disabled])

  return <div className="markdown-editor" ref={hostRef} />
}
