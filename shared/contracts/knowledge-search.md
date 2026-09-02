# Knowledge text search contract

## Use case

The Notes window searches titles, node types, vault-relative paths, and Markdown bodies without requiring an external index or Obsidian installation.

## IPC: `knowledge:search`

Request: a UTF-8 query string of 1 to 200 characters.

Response: up to 100 `KnowledgeSearchResult` items containing the ordinary `KnowledgeNodeRecord`, a short plain-text `excerpt`, and a numeric `score`.

Ranking rules:

1. exact title match;
2. title prefix and title substring;
3. type/path match;
4. body match frequency and recency as tie breakers.

The implementation may scan Markdown initially and later use `.prism/index`, but results must be derivable from source Markdown. YAML and Prism metadata comments must not dominate excerpts.

Errors:

- no library is selected;
- the query is empty or exceeds the length limit.

This endpoint is read-only and belongs to the Notes/search boundary. Chat may consume the contract later but must not import Notes UI components.
