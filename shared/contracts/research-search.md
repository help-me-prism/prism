# Research search and graph retrieval contract

## Use case

Notes provides a read-only research retrieval service that combines exact/full-text relevance with a local vector representation, then follows approved knowledge relations to recover supporting and contradicting context. AI Chat may consume this JSON contract later but must not import Notes components, CodeMirror state, or Vault filesystem code.

## Public read operations

```ts
searchResearchKnowledge(query: string): Promise<ResearchSearchResult[]>
retrieveResearchContext(query: string): Promise<ResearchContext>
rebuildResearchIndex(): Promise<ResearchIndexStatus>
```

The first implementation maps these operations to explicit IPC methods owned by the Notes domain. They are also the semantic basis for the later `search_knowledge` local/MCP tool.

## Search result

```ts
type ResearchSearchResult = {
  node: KnowledgeNodeRecord
  excerpt: string
  score: number
  textScore: number
  semanticScore: number
}
```

- `textScore` covers title, path, exact phrase, and token frequency.
- `semanticScore` is cosine similarity over a deterministic, local TF-IDF feature-hash embedding of English/Korean word and character features.
- `score` combines normalized text and semantic scores. Exact title and body matches remain dominant.
- Empty queries, overlong queries, malformed index records, templates, trash, and hidden `.prism` content are rejected or ignored.

The local embedding is deliberately model-free: it downloads nothing, sends no note text to a provider, works offline on Windows/macOS, and remains reproducible. A future neural embedding provider can replace the vector builder without changing the result contract.

## Derived index

- `.prism/index/research-search-v1.json` contains only rebuildable normalized text features and vectors.
- The index records a signature derived from stable node IDs and source revisions.
- Any Markdown revision change invalidates the signature and causes an atomic rebuild.
- Deleting the index never deletes or changes source Markdown, evidence anchors, or relation sidecars.
- Stored node paths remain Vault-relative and use `/` separators.

## Graph-grounded context

```ts
type ResearchContext = {
  query: string
  seeds: ResearchSearchResult[]
  nodes: KnowledgeNodeRecord[]
  relations: KnowledgeRelationRecord[]
  evidence: Array<{
    nodeId: string
    paperId: string
    anchorId: string
    type: EvidenceAnchorRef['type']
    page: number
    label: string
    paperTitle: string
    source: string
  }>
}
```

- Retrieval begins with the strongest search seeds and follows approved relations up to two hops.
- Pending or rejected AI relations are excluded.
- Evidence is parsed from source Markdown `prism-evidence` blocks; generated excerpts never replace those source records.
- The result separates knowledge nodes, relation assertions, and verbatim evidence records so a consumer can distinguish user-authored interpretation from PDF source material and its own later inference.
- Retrieval is read-only and cannot confirm a relation, edit a note, or delete user content.
