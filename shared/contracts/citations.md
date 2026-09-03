# Citation layer contract

## Use case

The citation graph is useful but noisy. It is the automatic layer: fetched, cached, and shown in its own panel, never merged into the researcher's relations or the default local graph.

## Data

`paper:citations` (arxivId, `{ refresh?: boolean }`) → `CitationLinks`:

- `references` (papers this paper cites) and `citations` (papers citing it) from Semantic Scholar (`/paper/arXiv:<id>/references|citations`, up to 500 each), with title, year, citation count, authors, and arXiv id when known.
- Each entry is matched against library papers (`inLibrary`, `nodeId`) and in-library entries sort first.
- Cached at `.prism/citations/<arxivId>.json`; `stale` after 7 days. `refresh: false` is cache-only (no network), `refresh: true` forces a fetch, omitted fetches only when missing or stale. A failed fetch keeps the old cache and reports `error`.
- Under `PRISM_TEST_LIBRARY_PATH` the handler never hits the network unless `refresh: true` is passed explicitly.

## Bridge to the manual layer

From a citation row whose paper is in the library the researcher can create an `extends` relation with one click (this paper → referenced paper, or citing paper → this paper). That relation is ordinary: `creator: user`, approved, written to Markdown. The citation row itself stays informational.
