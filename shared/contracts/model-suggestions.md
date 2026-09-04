# Model suggestion contract

## Use case

Prism knows which paper the researcher just finished and what they wrote about it. After a paper is marked 읽음 (or on demand), a model reads the paper note and proposes graph edges and promotion candidates. The researcher only accepts or rejects.

## Boundary

- The model **points**; it never writes. Claim and Question statements are always typed by the researcher (`curation.md`).
- Everything the model returns starts as `pending`/hint. Nothing reaches Markdown, search grounding, or the default graph before approval.
- The prompt contains: the paper note rendered as `SECTION:` / `EVIDENCE[block-id]` / `MEMO:` lines (AI answer callouts are removed), the existing nodes it may reference (ids, types, titles, claim scope), relations already recorded from the paper, and the memo lines a candidate may quote. When the vault is large the candidate list is the semantic top 60 plus concepts, capped at 80.
- Output is one JSON object: `relations[] {type, targetId, reason, evidenceBlockId}`, `candidates[] {kind, memo, why}`, `newConcepts[] {title, reason}`. Fenced JSON and surrounding prose are tolerated; malformed entries are dropped.

## Validation

- Relations: target id must exist and the type must be allowed for the pair (concept: `defines`/`uses`; claim: `supports`/`contradicts`; question: `raises`/`answers`; paper: `extends`). Self-relations and duplicates are skipped. Accepted ones become `creator: ai, reviewStatus: pending` relations with the evidence anchor resolved from `evidenceBlockId`.
- Candidates must quote a memo line verbatim (or contain a ≥12-character verbatim fragment); they become `aiHint` decorations on that memo in the queue and can only be dismissed, never auto-promoted.
- New concepts are deduplicated against existing titles and capped at 5; accepting one creates an inbox stub.
- Rejections are stored per paper in `.prism/suggestions/<paperNodeId>.json` and survive re-runs.

## Settings and IPC

- `AppSettings.knowledgeProvider` / `knowledgeModel` — independent of the translation and chat models; chosen in the Reader toolbar ("지식 제안 CLI"). Unset means the feature is off.
- `research:suggest:model` (paperNodeId) → `ModelSuggestionSummary`; runs the configured CLI with the same read-only/plan permissions as translation.
- `research:suggest:model:review` (`{ paperNodeId, id, decision }`).
