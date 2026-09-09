# Round 23: cross-turn chat provenance

2026-09-10. Native Windows review of isolated regression app PID 16732 / port 9353, copied vault `tmp/prism-product-ui-chat-provenance-LKQEl5/vault`. The original persona was not edited. This fixture explicitly says its four messages are regression material, not real AI output. No new AI question was sent.

The last assistant message contains references to engineering `근거1` (page 4) and biology `근거2` (page 1), but its own anchors array contains only `근거2`. Its primary paper is biology. Thus the first reference tests inherited evidence rather than a normal same-message link.

## Observed native results

- Both references in the last answer rendered as clickable evidence chips.
- Clicking that answer's inherited `근거1` opened engineering page 4, with the Table 1 caption highlighted in the original pane.
- Clicking `근거2` opened the correct biology paper, page 1. However, the newly opened tab settled in the Korean pane without the source highlight. Its untranslated fallback displayed original pixels. This is a remaining source-navigation affordance issue; opening the correct paper is not equivalent to focusing the exact source sentence. Reported immediately to the parent.
- Switched the active reader back to engineering page 4 and clicked the last answer's `노트에 저장`. The success message named `biology-drosophilidae-genomes`, matching that answer's primary paper rather than the currently active reader.
- The parent is separately checking the saved Markdown for both source URLs. The success toast alone does not prove that content.

Local-only screenshots: `tmp/ui/round23-inherited-engineering.png`, `tmp/ui/round23-biology-first-link.png`, `tmp/ui/round23-saved-biological-primary.png`. No claim about generated-answer quality, all citation histories, label collisions, unavailable PDFs, macOS, or production-vault migration follows from this synthetic UI test.

## Source-navigation fix recheck and new save/open action

After reloading the final source-navigation build in the same isolated app, the first biology evidence click from engineering now opens biology page 1 with an original pane and the exact `METHODS AND RESOURCES` text highlighted. The earlier source-focus defect is resolved in this reproduced case. Evidence: `tmp/ui/round23-biology-source-final.png`.

The parent independently confirmed that the earlier saved Markdown contains both PDF source URLs. This is separate from the native success-toast observation above.

With engineering active again, saved the last fixture answer once in the new renderer session. The button correctly changed to `저장한 노트 열기`. Clicking it opened a new Prism Notes window, but that window remained at the empty research-notes home, with no biology document selected after two settled observations. Reported this first-window navigation defect immediately; do not count the save/open flow as passing yet. Screenshot: `tmp/ui/round23-note-open-first-window.png`. The transient saving lock was too fast to inspect and was not stress-tested with repeated clicks. No AI call was made.

## Subsequent first-window regression fix

The preload now buffers the newest open request until React subscribes, and Notes waits until the requested record is loaded before consuming it. The actual preload regression and the full Notes UI smoke passed, including opening a particular note before the Notes window exists and then opening a different note. This automated result resolves the reproduced startup race; it is separate from the earlier failed native observation. Save-button state remains session-local, so reload-and-save is not persistent deduplication.
