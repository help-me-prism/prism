# Finding connected knowledge and using the actual paper text

The previous screen review found a 240px scrolling connection list above a much larger graph and empty citation explanation. Connected notes now use the panel's main scroll area. The local graph starts collapsed and remembers an explicit choice across note changes and reloads. Its indirect-neighbor lookup waits until the graph is open. Empty, unqueried and failed citation states remain distinct in one compact row with a refresh action; a failed lookup is not presented as zero citations.

New saved answers resolve other papers' titles from the capture's original vault index. Their source IDs, URLs and metadata remain unchanged. Missing, malformed or ambiguous titles keep the existing ID fallback. This changes new captures, not historical authored Markdown.

## Paper content behind the notes

The knowledge body reader previously assumed a fixed translation path beneath the vault. It now uses the current canonical source anchors, including before translation, and the registered translation location for separate paper storage. Internal paths follow moved-vault rebasing and realpath containment; explicitly registered external assets retain their location. A corrupt or mismatched canonical source does not silently revive an obsolete translation cache.

Translations join only when both source ID and original text match. The old shared-prefix lookup is removed; case and word boundaries remain meaningful for scientific text such as `Co` versus `CO`. File parsing is cached with bounded retention, while file identity and containment are checked on each load. Source and translation changes independently invalidate the combined body.

Local PDFs without imported abstract metadata can populate their overview from an explicitly identified Abstract section. Arbitrary methods text is not treated as an abstract. When body text exists but no abstract is identified, the note says that clearly instead of claiming the paper has not been read. The real engineering and biology fixture had the same 286 and 618 prose lines before this change, but previously each was a single unnamed body section; the separate-storage and untranslated-only gaps are demonstrated with isolated fixtures.

The first screen pass found a publisher query (`AU: Please confirm…`) in the biology overview. A narrow filter now removes the specifically observed heading-confirmation prefix from derived text and declines its potentially contaminated translation. Original source files, IDs and hashes are unchanged. The repeated publisher watermark heading ends the preceding section without becoming a visible heading or extending Abstract into subsequent body text. General `AU` language and unrelated text are preserved. This is a correction for observed production noise, not a claim to remove every publisher artifact.

## Navigation and validation

The preceding CI failed Windows figure centering and an Intel Mac answer-save action during initial workspace hydration. The save button now waits for a library path. Source navigation also observes render-ready and marker geometry changes: a page can finish painting without changing its placeholder size, which a resize observer alone misses. User interruption still ends navigation ownership.

An isolated Chromium regression removed the render-ready state, waited beyond the existing three-second initial timer and restored readiness without resizing. The pre-fix build failed to recenter; the new build passed. This proves that readiness gap, not the precise scheduling trace of the earlier CI failure. The test retains its visibility and nearest-reachable-center assertions.

The final build, core suite, Product UI and Notes UI passed. Tests cover ten real note relations without the old nested list scroll, graph preference after reload, compact empty citations, title provenance, external storage, moved vaults, source/translation identity, case-sensitive reuse, cached reads, local abstract extraction, publisher noise and authored-note preservation. The first Notes UI attempt exposed a test helper dispatching input and blur within one task; it now uses real keyboard input followed by a separate blur, and the complete suite passed.

Independent screen review confirmed related-note round trips, all four existing biology links visible, graph state persistence, and readable cross-paper titles in a newly saved synthetic answer. The citation fixture reported a failed lookup, so successful citation retrieval was not verified in that pass. A second reviewer checks the corrected overview below. No model inference was used.

## Remaining scope

Narrow side-by-side PDF reading remains small when explicitly retained. Heading extraction is incomplete for some real papers, and unknown publication artifacts remain possible. Multidisciplinary translation meaning, richer knowledge workflows, additional first-use personas and physical Mac verification remain outside this round's completion evidence.

Screen evidence: [first-pass connection list](images/round41-notes-list.png), [graph expanded](images/round41-graph-open.png), and [new answer titles](images/round41-answer-titles.png). These captures predate the publisher-query correction and document the finding rather than a final content approval.

A second reviewer used the native Notes window to verify the [final biology overview](images/round41-overview-final.png): it begins with the actual long-read sequencing abstract text, without the publisher query. Four connected notes remain visible in roughly 350px, and the graph opens and closes normally. No inference or new save was used. Repeated long titles inside automatic relationship excerpts still add visual density; the duplicate document title and empty generated sections also deserve a later layout review.
