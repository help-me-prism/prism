# Typed knowledge relation contract

## Use case

The Notes owner connects two stable knowledge nodes with a meaningful relation type. The relation remains readable in ordinary Markdown while provenance and review state are stored in a small Git-syncable sidecar.

## Relation types

`discusses`, `presents`, `supports`, `contradicts`, `extends`, and `related` are the primary values offered for new user relations. Existing Vaults may also contain the legacy values `uses`, `explains`, `evidence_for`, `derived_from`, and `raises`; Prism continues to read them but does not show them in the default picker.

The default UI constrains primary values by endpoint semantics:

- Paper → Paper: `related`
- Paper → Concept: `discusses`
- Paper → Claim: `presents`, `supports`, or `contradicts`
- Claim → Claim: `supports`, `contradicts`, or `extends`
- Concept → Concept: `related`
- other pairs: `related`

## Record

`KnowledgeRelationRecord` contains:

- stable relation `id`;
- stable `sourceId` and `targetId` node IDs;
- `type`;
- `creator`: `user` or `ai`;
- `reviewStatus`: `pending`, `approved`, or `rejected`;
- ISO `createdAt` timestamp.

User-created relations start as `approved`. AI-created relations must start as `pending`; AI cannot approve its own suggestion.

## Storage

- Each record is stored independently at `.prism/relations/<relation-id>.json` to reduce Git merge conflicts.
- Both endpoints use stable `prism_id` values. Absolute filesystem paths are forbidden.
- An approved relation is also represented in its source Markdown note as a visible Obsidian wikilink and Korean relation label.
- The Markdown representation includes an encoded `prism-relation` comment and a stable block ID so Prism can update only its own relation block.
- Sidecars are not allowed to replace the human-readable Markdown link.

## IPC

### `knowledge:relations:list`

Request: a stable knowledge node ID.

Response: every incoming and outgoing `KnowledgeRelationView`, enriched with `direction` and the other node's title, type, and vault-relative path.

### `knowledge:relations:create`

Request: `sourceId`, `targetId`, `type`, `creator`, and the source note's `expectedRevision`.

Response: either `{ saved: true, relation, snapshot, relations }` or the ordinary note conflict result. Self-relations and duplicate active relations are rejected.

### `knowledge:relations:delete`

Request: relation `id` and source note `expectedRevision`.

Response: either `{ saved: true, snapshot, relations }` or the ordinary note conflict result. Deletion removes the relation sidecar and only its generated Markdown block.

All mutations validate node and relation IDs and never overwrite a source note whose revision changed externally.
