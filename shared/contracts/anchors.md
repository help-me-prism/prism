# Evidence anchor contract

Use case: Notes can list stable PDF anchors and ask the reader window to navigate to one without importing Reader or Chat state.

## `EvidenceAnchorRef`

```ts
type EvidenceAnchorRef = {
  paperId: string
  anchorId: string
  type: 'sentence' | 'equation' | 'table' | 'figure' | 'page'
  page: number
  label: string
}
```

`EvidenceAnchor` adds `paperTitle`, `source`, `sourceHash`, and `availability: 'linked' | 'needs-relink'` for display and relinking. Every value is JSON serializable. No renderer state, DOM node, React ref, or CodeMirror object crosses this boundary.

## IPC

- `evidence:list` returns all anchors available in the local library.
- `evidence:open` accepts one `EvidenceAnchorRef`, focuses the reader, and emits `evidence:open-requested` to that window.
- Invalid identifiers, types, pages, or oversized labels are rejected in the main process.

