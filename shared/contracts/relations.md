# Typed knowledge relation contract

## Use case

The Notes owner connects two stable knowledge nodes with a meaningful relation type. The relation remains readable in ordinary Markdown while provenance and review state are stored in a small Git-syncable sidecar.

## Design rule

A relation type exists only when the researcher will actually run a query over it ("which papers define this concept?", "what contradicts this claim?", "which questions are still open?"). Pairs without such a query get a plain `[[wikilink]]` and no relation.

## Relation types

Primary values offered for new user relations:

| Type | Direction | Query it answers |
| --- | --- | --- |
| `defines` | Paper → Concept | Which paper introduced or formally defined this concept? |
| `uses` | Paper → Concept, Claim → Concept | Which papers or claims rely on this concept? |
| `supports` | Paper → Claim, Claim → Claim | What backs this claim? |
| `contradicts` | Paper → Claim, Claim → Claim | What disputes this claim? |
| `extends` | Claim → Claim, Paper → Paper, Concept → Concept | What builds on this? (manual only; distinct from citation) |
| `raises` | Paper → Question, Claim → Question | Where did this open question come from? |
| `answers` | Paper → Question, Claim → Question | What settles this question? A question with an approved `answers` relation leaves the open-question view. |

`mentions` is reserved for automatically extracted links (creator `ai`). It is never offered in the default picker, and relation lists and the local graph hide it unless the user toggles "자동 관계 보기".

Legacy values `discusses`, `presents`, `related`, `explains`, `evidence_for`, and `derived_from` are still read and displayed for existing Vaults but are not offered for new relations. `discusses` reads as a weaker `uses`; `presents` is superseded by the Claim's own `source`/evidence cards; `related` carried no query and is retired.

The default UI constrains primary values by endpoint semantics as in the table above. Any other pair returns no relation types and the UI directs the user to a plain link.

## Claim scope

`contradicts` between two Claims is only meaningful when both talk about the same conditions. Claims carry flat frontmatter fields that the property UI edits with selects and short inputs:

```yaml
claim_origin: paper        # paper | mine  (mine = the researcher's own interpretation, formerly the Insight node)
evidence_kind: experiment  # theory | experiment | anecdote | idea (absent = undecided)
scope_domain: "image generation"
scope_regime: "large-scale, pixel space"
scope_assumptions: ["gaussian noise", "fixed schedule"]
projects: ["Diffusion objective study"]
```

When the user creates a `contradicts` relation between two Claims whose `scope_domain` or `scope_regime` are both set and differ, Prism shows a warning ("조건 차이일 수 있습니다") and requires an explicit confirmation before the relation is stored. The check is advisory; the sidecar format does not change.

`projects` is available on every node type and replaces the Project node for new work. The research overview groups nodes by matching `projects` entries as well as by legacy Project relations.

## Record

`KnowledgeRelationRecord` contains:

- stable relation `id`;
- stable `sourceId` and `targetId` node IDs;
- `type`;
- `creator`: `user` or `ai`;
- `reviewStatus`: `pending`, `approved`, or `rejected`;
- optional `evidenceAnchor`;
- ISO `createdAt` timestamp.

User-created relations start as `approved`. AI-created relations must start as `pending`; AI cannot approve its own suggestion. This is the provenance boundary: everything the user has not approved stays out of Markdown, search grounding, and the default graph.

## Storage

- Each record is stored independently at `.prism/relations/<relation-id>.json` to reduce Git merge conflicts.
- Both endpoints use stable `prism_id` values. Library paper notes use `paper-<arxivId>`. Absolute filesystem paths are forbidden.
- An approved relation is also represented in its source Markdown note as a visible Obsidian wikilink and Korean relation label.
- The Markdown representation includes an encoded `prism-relation` comment and a stable block ID so Prism can update only its own relation block.
- Sidecars are not allowed to replace the human-readable Markdown link.

## IPC

### `knowledge:relations:list`

Request: a stable knowledge node ID.

Response: every incoming and outgoing `KnowledgeRelationView`, enriched with `direction` and the other node's title, type, and vault-relative path. `mentions` relations are included; the renderer decides whether to show them.

### `knowledge:relations:create`

Request: `sourceId`, `targetId`, `type`, `creator`, optional `evidenceAnchor`, and the source note's `expectedRevision`.

Response: either `{ saved: true, relation, snapshot, relations }` or the ordinary note conflict result. Self-relations and duplicate active relations are rejected.

### `knowledge:relations:delete`

Request: relation `id` and source note `expectedRevision`.

Response: either `{ saved: true, snapshot, relations }` or the ordinary note conflict result. Deletion removes the relation sidecar and only its generated Markdown block.

All mutations validate node and relation IDs and never overwrite a source note whose revision changed externally.
