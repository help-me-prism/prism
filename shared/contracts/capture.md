# Reading-time capture contract

## Use case

While reading, the researcher never has to open the Notes window. The Reader and the chat append into the paper note's `## Notes` section; structure comes later in the curation queue.

## What is written

Everything lands as ordinary Markdown in `papers/<arxivId>/<arxivId>.md`, inside the `## Notes` section (created at the end of the note when missing, inserted before the next `#`/`##` heading otherwise).

- **Evidence capture** (`kind: 'evidence'`): the same `> [!evidence]` card the Notes editor inserts (identical block id `evidence-<paperId>-<anchorId>`, `prism-evidence` metadata, `^block-id`), followed by the optional one-line memo as a plain paragraph. Capturing the same anchor again adds only the memo under the existing card.
- **Chat capture** (`kind: 'chat'`): a collapsed `> [!ai]- AI 답변 · <date> · <provider>/<model>` callout quoting the question and the whole answer, plus the referenced anchors, followed by a `prism-ai-answer` comment with provenance. AI text is therefore distinguishable from the researcher's memos; the model-suggestion prompt and the curation queue skip it.
- **Concept definition** (`concept` on an evidence capture): the sentence is appended as a row of the Concept's `## 정의 비교` table (`| [[paper]] | quoted sentence | memo + PDF link |`, replacing an empty placeholder row) and an approved `defines` relation Paper → Concept is created with the anchor as direct evidence. A missing Concept is created (status `developing`).

## Link stubs

On explicit saves (blur, note switch, window close, the Notes save button — never the autosave timer), Prism creates an empty Concept note with `status: inbox` for every `[[link]]` that resolves to nothing. Targets with a folder other than `Concepts/`, arXiv-looking ids, and names shorter than two characters are skipped. This mirrors Obsidian: links are free; the note is written once the curation queue shows it has earned it.

## IPC

- `paper:note:capture` — `PaperCaptureRequest` (`kind`, `paperId`, and per kind `anchorId`/`memo`/`concept` or `question`/`answer`/`provider`/`model`/`anchors`). Returns `{ saved, snapshot, blockId?, concept? }`. Rejects unknown anchors without touching the note and refuses to overwrite a note that changed between read and write.
- `paper:note:save` / `knowledge:save` accept `createStubs: true`; the saved result then carries `stubs: string[]` with the titles created.

## Ownership

The Reader and chat only send anchors and text; they never edit note Markdown themselves. Notes owns presentation and reloads externally changed notes when the editor is not dirty.
