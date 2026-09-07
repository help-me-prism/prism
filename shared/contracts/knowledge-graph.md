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

**A pair is unordered.** The generated `관계` sections write every relation back into *both* notes as a `[[link]]`, so a graph that treated `A→B` and `B→A` as different pairs would draw every relation twice — once typed, once as a faint line pointing the other way. On a 53-note vault that turned 74 relations into 169 edges.

## Layers

The transport carries every edge; the view decides what is on. Three rules, shared by the panel graph and the full view (`src/graph/model.ts`):

- `rejected` never appears anywhere.
- `origin: 'link'` edges follow the **본문 링크** toggle (on by default).
- `mentions` and anything still `pending` follow the **AI 제안** toggle (off by default). Approval state must be visible before an edge carries weight, so an unapproved edge is drawn thin, dashed and without an arrowhead.

Isolated nodes are hidden by default and counted in the status line, so an empty-looking graph still says how much of the vault is unconnected.

Every toggle names what it draws and how many of it there are (`본문 링크 24`, `AI 제안 4`), counted over the whole vault rather than over what is currently on screen — a number that moved when you pressed the button would be describing the answer instead of the question. A layer with nothing in it is disabled rather than silently doing nothing.

## Drawing

The graph is read at a glance or not at all, so ink is spent where it changes a decision.

- **Three edge tiers, not seven colours.** Green where a paper backs a claim, red dashed where one disputes it, one quiet grey for the structure that holds the rest together, and fainter still for `[[links]]` and unapproved proposals. Telling `정의함` from `사용함` is what a hover is for; telling *settled* from *contested* is what the picture is for.
- **Arrowheads only on what the reader is pointing at.** Fifty arrowheads at once are fifty things to look at and nothing to read. Direction is a question about one note.
- **Names where they fit.** Labels are placed last, best-connected first, under the node or above it, skipping any that would land on another label, on a node, off the canvas, or under the status line. What is hovered, selected, open, or matched by the search always wins the space; everything else gives its name on hover.
- **Search dims, never removes.** The point of a graph is where the match sits among everything else.

## Layout

`src/graph/layout.ts` is a dependency-free force simulation. Two properties are contractual:

- **Deterministic start.** Initial positions come from a hash of the node id, so the same vault opens in the same shape. A graph that reshuffles on every open cannot be recognised.
- **Positions survive filtering.** Turning a node type off moves the graph; it does not redraw it from scratch. A node the researcher drags stays pinned where it was put.

Three properties hold it together at vault scale, and each was a visible failure first: nothing moves more than half a link per tick (a spring stretched across the canvas asks for a step that overshoots, and the overshoot comes back harder — 1200 notes tore out to 26,000px); the centring pull is normalised by the graph's own radius (a pull proportional to distance is either too weak to gather a thousand notes or strong enough to crush ten into a dot); and the starting spread grows with the square root of the node count. A vault too big to settle before the first paint settles on screen and is framed again when it comes to rest.

## What the graph says about itself

Two derived views, both computed on the same walk of the vault and neither stored: `knowledge:graph:insights`.

### 놓친 연결 — similarity

Deliberately *not* the search index. Search hashes words **and character 2/3-grams** into 384 buckets, which is right for finding a note from a half-remembered phrase and wrong here: n-grams make any two Korean notes look alike for sharing syllables, and 384 buckets collide constantly. Where similarity is the only signal, that produces confident nonsense. So:

- **Words only**, endings stripped, mixed-script tokens split (`matching와` → `matching`).
- **Exact sparse cosine**, no hashing, so no collisions.
- **Only what the researcher wrote** — `prism:auto` regions and headings are removed first, or two notes score high for being made from the same template.
- **A threshold read off the vault** (median + 4×MAD, floor 0.18). Cosine is not comparable between libraries; a fixed cut floods a focused vault and finds nothing in a broad one.
- **Notes with fewer than 10 distinct words are excluded** and reported as `thin`, so a stub never gets suggested.
- **Every suggestion names the words it is based on.** A number alone cannot be judged; `noise · schedule · solver · ode` can.

### 덩어리 — clustering

Modularity optimisation (Louvain local moving over two levels), not label propagation: propagation depends on visit order, breaks ties arbitrarily, collapses a well-connected vault into one label, and reports nothing about whether the split means anything.

- **Q is returned and shown.** Below 0.3 the view says the groups are not clear rather than drawing them as if they were.
- **Deterministic.** A fixed sweep order and index tie-breaks; the same vault in a different order gives the same groups.
- **Named for what is characteristic, not what is busy** — inside-degree × the share of that node's edges staying inside, with concepts preferred. A hub every group touches names none of them.
- `[[link]]` edges count 0.6 against a typed relation's 1: a link restating a relation should not vote twice.

`scripts/test-knowledge-insights.mjs` plants three subjects with disjoint vocabulary, wires them into three groups, gives every note the same generated boilerplate, and checks that both measures recover what was planted — including that order does not change the answer and that adding a note does not reshuffle the vault.

## Verification

`scripts/test-knowledge-graph.mjs` builds a throwaway vault and checks the node and edge sets, the Obsidian-written link that has no sidecar record, and that a rejected relation stays out.
