# Local research knowledge MCP contract

## Purpose and ownership

Prism exposes the Markdown-first research Vault to external AI hosts through a local MCP server. The server is owned by the Notes domain and imports Notes services only. It does not import Chat renderer state, provider sessions, or `src/App.tsx`.

The first transport is stdio. An MCP host starts one process with an explicit Vault path:

```text
node dist-electron/mcpServer.js --vault <absolute-vault-path>
```

`PRISM_VAULT_PATH` is an equivalent fallback for hosts that cannot append arguments. The CLI argument wins. The server performs no network requests, writes protocol messages only to stdout, and sends diagnostics only to stderr.

## Trust and data boundaries

- The configured Vault must already exist and contain `.prism/library.json` or at least one Prism knowledge directory.
- All returned file locations use Vault-relative `/` paths. Absolute local paths and PDF bytes are not returned.
- Search indexes and queued UI requests are derived data under `.prism/index` or `.prism/cache`.
- The server never approves relationships, edits existing notes, or deletes user data.
- `create_note_draft` may create one new Markdown note from an existing template. It never overwrites an existing file and marks the node as AI-created draft metadata.
- Relationship suggestions remain read-only. An external model cannot turn them into pending or approved relation sidecars through this server.
- Pending and rejected relationships are excluded from retrieval, comparison, and related-node results.

## Tools

### `search_knowledge(query, limit?)`

Hybrid text and local semantic search. Returns ranked node metadata, excerpts, component scores, and Vault-relative paths. `limit` is 1–20 and defaults to 8.

### `get_claim_evidence(claim_id)`

Requires a Claim ID. Returns the Claim, approved incoming `supports`, `contradicts`, and `evidence_for` relationships, source nodes, and exact embedded PDF evidence anchors. User-authored note text and PDF source excerpts remain separate fields.

### `find_related_concepts(concept_id)`

Requires a Concept ID. Returns Concepts connected through approved relationships in either direction, including relation type and direction. It may also return clearly labelled local semantic candidates; candidates are not relationships.

### `compare_papers(paper_ids)`

Accepts 2–8 Paper IDs. Returns each Paper's metadata, a bounded plain-text note excerpt, embedded PDF evidence, and approved Claim/Concept relationships. It does not generate an AI-written conclusion.

### `open_paper_anchor(anchor_id, paper_id?)`

Resolves a stable anchor from the Vault. It writes a replaceable request under `.prism/cache/mcp-open-anchor.json` for a running Prism instance and returns the exact anchor record plus `queued: true`. Queueing does not alter source Markdown or the anchor catalog.

### `suggest_relationships(node_id)`

Returns the same local, deterministic suggestion records as the Notes review UI. Calling it has no side effects.

### `create_note_draft(template_id, title, variables?)`

Creates a new Markdown node using the selected user-owned template. Allowed variables are the template's supported scalar variables. The result contains the new node ID and Vault-relative path. Existing files are never modified and no relationship is created.

## Result and error shape

Successful calls return JSON in both MCP `structuredContent` and a text content block. Errors use MCP tool errors with a concise message; filesystem paths outside the Vault and raw stack traces are not returned.

Every tool declares `readOnlyHint: true` except `create_note_draft`, which declares `readOnlyHint: false`, `destructiveHint: false`, and `idempotentHint: false`.

## Verification gates

1. A protocol client initializes over stdio, lists exactly the seven named tools, and validates their input schemas.
2. Search, Claim evidence, related Concepts, Paper comparison, anchor resolution, and suggestions operate on a temporary Vault without network access.
3. Pending/rejected relations never appear in read results.
4. Anchor queueing changes only `.prism/cache/mcp-open-anchor.json`.
5. Draft creation preserves template Markdown, records AI draft provenance, and refuses filename collisions.
6. Malformed IDs, wrong node types, traversal attempts, missing Vaults, and invalid limits return tool errors without terminating the server.
7. `npm run build`, Notes smoke, and Chat smoke remain green.
