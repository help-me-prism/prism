# Knowledge data views contract

## Purpose

The Notes domain exposes small, reproducible data views for the Phase 4 knowledge dashboard. The renderer consumes JSON records and never reads Vault files directly. Chat code does not import Notes components or editor state.

## Project node

- `project` is a first-class `KnowledgeNodeType` alongside Paper, Concept, Claim, Insight, and Question.
- Project source files live in `Projects/<title>.md` and use the same Markdown/YAML round-trip rules as other knowledge nodes.
- Project templates are user-owned Markdown files and participate in default-template selection.

## Read model

`listKnowledgeDataViews()` returns:

```ts
type KnowledgeDataViews = {
  projects: KnowledgeNodeRecord[]
  unansweredQuestions: KnowledgeNodeRecord[]
  unsupportedClaims: KnowledgeNodeRecord[]
}
```

The result is derived from Markdown and approved relation sidecars and can be rebuilt at any time.

### Membership rules

- `projects`: every non-archived Project node.
- `unansweredQuestions`: every Question whose status is neither `established` nor `archived`.
- `unsupportedClaims`: every non-archived Claim that has neither an embedded `prism-evidence` reference nor an approved incoming `supports` or `evidence_for` relation.
- Pending or rejected AI relations never remove a Claim from the unsupported view.

## Safety and ownership

- Listing a view is read-only and cannot mutate Markdown, relation sidecars, or editor state.
- Every returned node retains its stable `prism_id`; selecting an item opens it through the existing Notes API.
- Paths remain Vault-relative and use `/` separators on every operating system.
- These types are a shared IPC contract. Notes owns derivation and presentation; AI Chat may consume the JSON result later but must not depend on Notes React components.
