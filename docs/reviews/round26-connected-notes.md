# Round 26: connected-note retrieval

2026-09-10. Independent native review of isolated Notes window 49417498, PID 16732 / port 9353. No source edits, new notes, paid model calls or AI organization actions. Reviewed existing biology paper and Round 25 regression concepts after reloading the current build.

## Before

The same three concepts appeared in a top connected-note list, a graph and a second backlink list. Only the lower list added an excerpt. The labels `← 관련` and `→ 관련` changed when opening the opposite endpoint but did not state the subject; a beginner could mistake direction for provenance or inference.

## After: observed passes

- Biology showed three connected notes exactly once each in its textual list, with the former backlink excerpts under the corresponding titles. The separate lower backlink section was removed. The graph remained visible.
- Related connections displayed `관련 노트` without arrows from both endpoints.
- A plain body link displayed `이 노트를 언급` on the biology paper and `이 노트에서 언급` on the linking concept, matching their actual body content.
- Clicked the first-link concept title in the list, returned to biology through its title, then opened the related concept through the same list. All destinations and settled note bodies were correct.

The integrated list makes the route to another note easier to find without asking the reader to reconcile two near-identical lists. This is a scoped usability improvement, not overall product or visual approval.

## Remaining limitation

The excerpt preserves an existing awkward generated phrase such as `…개념가 related`. Showing the excerpt exposes that underlying copy problem; it is not a new navigation failure. Three existing rows nearly fit the 240px region. A wheel action within the list did not visibly change the position, so hidden-row reachability in a genuinely long list is **not verified** in this native sample. Complex graph topology, keyboard navigation, light theme and narrow-window layouts were not retested here.

## Evidence

Privacy-safe right-rail crop: `images/round26-connected-notes.png`.

Full local screenshots, not for commit: `tmp/ui/round26-connections-before-paper.png`, `tmp/ui/round26-connections-before-concept.png`, `tmp/ui/round26-connections-after-paper-full.png`, `tmp/ui/round26-connections-after-link-full.png`, `tmp/ui/round26-connections-after-related-full.png`.

UI released on the related concept note. No claim that the synthetic regression notes are a real researcher study.

## Graph integrity regression

An independent code audit reproduced a missing indirect contradiction: B supported D and C contradicted D, but deduplication by D's node ID retained only the first edge. The loader now deduplicates relation IDs independently from graph nodes. Pure regression tests retain both paths and distinguish an exact edge limit from truncated results. The full Notes UI smoke creates four actual vault notes and these opposing paths, then confirms both relationship types and one shared destination in the rendered graph. The core suite and Notes UI smoke passed locally. This automated graph check is distinct from the native three-note retrieval review.

## Final backend restart verification

Parent restarted only the isolated provenance application with the latest backend, PID 31700 / port 9353, keeping the same vault/profile. Actual new Notes window was 8982012. Opened biology, then the existing related concept, then returned to biology using the connected-note title. The concept auto-generated body now reads `관련: biology-drosophilidae-genomes` and its provenance line uses `관련 · 회귀검토25 논문에서 만든 개념`; the integrated excerpts on both endpoints updated accordingly. Navigation, one row per connected note and the graph remained intact in this sample.

The earlier `…개념가 related` finding above came from the old backend and stale generated fixture content. It is **resolved in this checked latest-backend path**, not an outstanding finding against the current build. Existing notes refreshed when opened; this check does not assert that unopened vault notes are eagerly rewritten.

Final privacy-safe evidence: `images/round26-connected-notes-final.png`. Full temporary evidence: `tmp/ui/round26-final-paper-full.png`, `tmp/ui/round26-final-related-full.png`. The earlier crop remains historical before-backend-refresh evidence. UI released on biology in window 8982012. No model call or manual note-content edit was made.
