# Vault graph contract

## Use case

Two questions the note-by-note views cannot answer: what has actually been connected, and what is floating alone. The graph is a reading surface, not the way to find a note — the tree and search remain that. Nothing here writes to the vault.

## Shape

`knowledge:graph` returns the whole vault in one pass:

```ts
type KnowledgeGraphNode = { id, title, nodeType, status, relativePath, modifiedAt }
type KnowledgeGraphEdge = { id, sourceId, targetId, type, origin, creator, reviewStatus }
type KnowledgeGraph = { nodes, edges, generatedAt }
```

Nodes come from the shared vault snapshot, edges from `.prism/relations` plus the snapshot's link map. An edge whose endpoint is missing from the vault is dropped.

## Where an edge comes from

| Origin | Source | Drawn |
| --- | --- | --- |
| `manual` | a relation the researcher approved, or an AI proposal | by relation type |
| `link` | a `[[wikilink]]` in the note body | faint dashed, no arrow |

`syncLinkRelations` records link relations when Prism saves a note, but the same vault is edited in Obsidian, where nothing runs. So link edges are **also derived live** from note content, and the sidecar record wins when both exist for a pair. A typed relation for a pair always supersedes the plain link.

## Layers

The transport carries every edge; the view decides what is on. Three rules, shared by the panel graph and the full view (`src/graph/model.ts`):

- `rejected` never appears anywhere.
- `origin: 'link'` edges follow the **링크** toggle (on by default).
- `mentions` and anything still `pending` follow the **AI 제안** toggle (off by default). Approval state must be visible before an edge carries weight, so an unapproved edge is drawn thin, dashed and without an arrowhead.

Isolated nodes are hidden by default and counted in the status line, so an empty-looking graph still says how much of the vault is unconnected.

## Layout

`src/graph/layout.ts` is a dependency-free force simulation. Two properties are contractual:

- **Deterministic start.** Initial positions come from a hash of the node id, so the same vault opens in the same shape. A graph that reshuffles on every open cannot be recognised.
- **Positions survive filtering.** Turning a node type off moves the graph; it does not redraw it from scratch. A node the researcher drags stays pinned where it was put.

## Verification

`scripts/test-knowledge-graph.mjs` builds a throwaway vault and checks the node and edge sets, the Obsidian-written link that has no sidecar record, and that a rejected relation stays out.
