# Knowledge suggestions and relation review contract

## Purpose

The Notes-owned research assistant may identify duplicate Concepts, likely supporting/contradicting links, unsupported Claims, and unanswered Questions. A suggestion is derived read-only data, not a relationship or a Markdown edit.

## Suggestion record

```ts
type KnowledgeSuggestion = {
  id: string
  kind: 'duplicate_concept' | 'supports' | 'contradicts' | 'evidence_gap' | 'research_gap'
  source: KnowledgeNodeRecord
  target?: KnowledgeNodeRecord
  proposedRelation?: KnowledgeRelationType
  confidence: number
  reason: string
}
```

- IDs are deterministic for the same suggestion endpoints and kind.
- `confidence` is a finite value from `0` to `1`; it is advisory, not a truth score.
- Reasons cite the local signal used: semantic overlap, an explicit Markdown link and cue, missing approved evidence, or unresolved status.
- Suggestions never write Markdown or sidecars merely by being listed.

## Read operation

`suggestKnowledge(nodeId)` returns suggestions relevant to the active node plus Vault-wide unresolved research gaps. It reads source Markdown, the rebuildable research index, and approved/reviewed relation records. It does not call Chat providers and does not send Vault text over the network.

## Relationship review lifecycle

1. Choosing `검토에 추가` on a relation suggestion calls the existing relation creation contract with `creator: 'ai'`.
2. The resulting sidecar starts with `reviewStatus: 'pending'` and does not change source Markdown.
3. Only a user action may call `reviewKnowledgeRelation({ id, decision, expectedRevision })`.
4. `approved` atomically checks the source revision, appends the human-readable relation block to source Markdown, then records `approved` in the sidecar.
5. `rejected` checks the source revision, records `rejected`, and never changes Markdown.
6. Pending/rejected relations are excluded from graph-grounded retrieval. Rejected endpoint pairs are retained so the same proposal is not repeatedly shown.

Review is available from the relation's source note. An incoming pending relation links back to its source for review rather than mutating that source from another note's editor state.
