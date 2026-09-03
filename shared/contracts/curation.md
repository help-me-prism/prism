# Curation queue contract

## Use case

Reading and structuring are different cognitive modes. Reading stays linear (see `capture.md`); the curation queue is the batch view where the researcher turns proven links and memos into structure. Nothing in the queue is applied automatically.

## Queue (`knowledge:curation:list` → `CurationQueue`)

| Section | Source | Decision |
| --- | --- | --- |
| `pendingRelations` | relation sidecars with `reviewStatus: pending` (AI-created) | approve / reject (`knowledge:relations:review`) |
| `stubs` | Concept notes with `status: inbox`, with a backlink count over every node; `ready` when ≥ 2 | 정리 시작 (status → developing), 병합, 삭제 |
| `memos` | plain paragraphs directly under an evidence card in a paper note, not yet linked to `Claims/` or `Questions/`; carries the card's anchor and any `aiHint` from a model run | Claim / Question 승격, 힌트 무시 |
| `conceptSuggestions` | pending `newConcepts` from model runs | 스텁 만들기 / 거절 |
| `unsupportedClaims`, `unansweredQuestions` | data views (a Question with an approved `answers` relation is no longer open) | open the note |
| `modelRuns` | summaries of `.prism/suggestions/*.json` | informational |

`total` is the number of pending decisions and is shown as the badge on the Notes window's 정리 button.

## Promotion (`knowledge:curation:promote-memo`)

`{ paperNodeId, blockId, memo, nodeType: 'claim' | 'question', title }` creates the node from its default template, appends the memo verbatim, the evidence card copied from the paper note, and a `> [!note] 출처 노트` link back; marks the memo in the paper note with ` → [[<new note>|<title>]]` so it leaves the queue; and records an approved Paper → node relation (`supports` for claims, `raises` for questions) with the card's anchor as direct evidence. The title is typed by the researcher; the model never supplies it.

## Merge (`knowledge:curation:merge-concepts`)

`{ sourceId, targetId }` (both Concepts) rewrites every `[[link]]` that resolves to the source (full path or basename) into `[[<target path>|<original alias or source title>]]`, repoints relation sidecars (deleting ones that would become self-relations or duplicates), appends the source body under `## 병합됨: <title>` only when it contains more than template skeleton, and moves the source file to `.prism/trash/knowledge/`.

## Guarantees

- Every mutation goes through the ordinary revision-checked note save; a note changed by Obsidian in between is never overwritten.
- Derived data (backlink counts, hints) is recomputed from Markdown and sidecars on every listing.
