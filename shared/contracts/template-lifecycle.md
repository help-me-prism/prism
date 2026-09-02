# Template lifecycle contract

Use case: Notes can surface user-owned favorite and recently used Markdown templates, record the exact template revision used for a note, and explicitly add only missing sections to an existing note.

## Portable source and derived preferences

- Every template remains a Markdown file in `Templates/` with stable `template_id` metadata.
- `TemplateRecord.revision` is the SHA-256 revision of that exact Markdown file and is the value written as `template_version` when a note is created.
- Favorite IDs and recent-use timestamps live in `.prism/template-preferences.json`. They are presentation preferences, not template content, and losing the file never loses a template or note.
- Recent use is recorded only after a note is successfully created from that template.

## Renderer API

### `templates:set-favorite`

Request: a valid template ID and a boolean favorite state.

Result: the refreshed `TemplateRecord[]`. Each record includes `isFavorite` and optional `lastUsedAt`.

### `knowledge:apply-template-sections`

Request:

```ts
type ApplyTemplateSectionsRequest = {
  nodeId: string
  templateId: string
  expectedRevision: string
}
```

Result:

```ts
type ApplyTemplateSectionsResult =
  | { saved: true; snapshot: NoteSnapshot; addedHeadings: string[] }
  | { saved: false; conflict: NoteSnapshot }
```

Only level-two-or-deeper ATX sections missing by normalized heading text are appended, in template order. Existing frontmatter, headings, body, links, evidence metadata, whitespace, and section order are byte-for-byte unchanged. Template variables are expanded with the target note title where known; unresolved variables remain visible. If nothing is missing, no file write occurs and `addedHeadings` is empty.

The main process validates IDs and revisions. A revision mismatch returns a recoverable conflict rather than overwriting the disk version.

## Safety and ownership

- Editing a template never mutates existing notes.
- Applying missing sections is an explicit user action and never replaces a same-named section.
- Deleting a template clears only its derived preference entries; existing notes retain `template_id` and `template_version` provenance.
- Notes and Chat exchange only JSON-serializable records through the preload boundary.
