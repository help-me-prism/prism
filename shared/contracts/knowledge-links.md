# Knowledge link and backlink contract

## Use case

The Notes window inserts an Obsidian-compatible link to another knowledge node and shows every knowledge note that links back to the active node.

## Portable Markdown source of truth

- A knowledge link is stored as `[[Concepts/Reverse diffusion|Reverse diffusion]]`.
- The target is the vault-relative Markdown path without the `.md` suffix.
- An alias after `|` is optional and does not affect target resolution.
- A heading or block suffix after `#` is ignored when resolving the target note.
- Backlinks are derived by scanning Markdown. They are not user data and may be rebuilt without loss.

## IPC

### `knowledge:backlinks`

Request: a stable knowledge node `prism_id` string.

Response: `KnowledgeBacklink[]`, where each item contains:

- `nodeId`: stable source-note `prism_id`
- `title`: source note title
- `nodeType`: source note type
- `relativePath`: vault-relative source Markdown path
- `excerpt`: short human-readable context around the first matching link

Errors:

- no library is selected;
- the ID is malformed;
- the target node no longer exists.

An empty array means no knowledge note links to the target. The target note itself is never returned.

## Ownership

The API is read-only. Notes owns insertion and presentation. Chat code must not import Notes components or mutate their editor state.
