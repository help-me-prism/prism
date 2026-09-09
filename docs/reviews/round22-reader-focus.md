# Round 22: reading focus native review

2026-09-10. Isolated Windows persona PID 14432, port 9351. Actual native mouse/keyboard review using cached engineering paper pages 4 and 11. No translation, download, or AI request was sent. No source changes by this reviewer.

## Before

On the previous renderer, side-by-side paper-fit pages were about 481 screen pixels wide in a 1280-pixel window. Switching through the comparison dropdown to stacked comparison expanded them to about 1013 pixels, but each pane was only about 350 pixels tall. Opening chat reduced page width to about 633 pixels. The reader therefore already had a useful alternative layout, but discovering it required opening the small comparison arrow and it traded width for repeated vertical scrolling.

The two proposed improvements were to expose the current comparison arrangement and provide temporary single-document reading with a clear return to the saved arrangement. Adding another toolbar row was not recommended.

## After: observed results

The implementation reuses the existing view buttons as `원문 크게` and `번역 크게`; temporary focus exposes `비교로 복귀`. The comparison button names the current left/right or stacked arrangement, and the menu highlights the selected arrangement. Chat close is accurately named `AI 대화 닫기`.

- From page 4 left/right comparison, `번역 크게` produced a full-width translated page. Its table, equations and body were substantially easier to inspect than in the 481-pixel comparison view.
- While focused on translation, entered page 11 and returned to comparison. Both panes returned to left/right arrangement and width-fit; page 11 remained current rather than reverting to the earlier page 4.
- Opened original focus on page 11, then opened chat. Original remained the only reading pane and settled to the narrower available width. The chat-close label was correct.
- Reloaded after the parent's final source-link protection build. The saved left/right layout reappeared on page 11, providing an actual check that temporary focus had not overwritten that saved arrangement.
- Entered original focus again and clicked the existing chat's `근거 p.4` link. It opened page 4 and highlighted the figure while retaining original-only focus. Returning to comparison restored left/right on page 4. Closing chat retained page 4 and the visible figure region.
- Explicitly switched to stacked comparison, entered translation focus, and returned. Stacked arrangement and width-fit returned. Its selected menu item was visibly highlighted. Restored the original left/right arrangement afterward.

No new blocking failure was observed in those actions. The final persona remains open, page 4, left/right comparison, chat closed.

## Judgement and limits

This is a useful reduction in reading effort: a researcher can temporarily use the available width without learning another pane control or sacrificing the prior comparison arrangement. It does not make small simultaneous comparison text readable by itself, and it does not resolve all toolbar density or paper typography concerns.

Some transitions briefly displayed loading placeholders or the prior large scale before settling. This review accepts the resulting state, not a claim of perfectly smooth transitions. Width-fit restoration was tested; custom numeric zoom, custom tab arrangements, arbitrary split ratios, keyboard-only accessibility and precise pixel-level scroll restoration were not exhaustively tested. The figure remained visibly reachable after source navigation and return, but that is not a general position-preservation proof. Biology documents, macOS, and new-question answer quality were outside this native check. The source-link tooltip also exposed technical file/bounds details; this was observed as existing polish debt, not attributed to this focus change.

Full screenshots are local-only and contain account/sidebar context; do not commit them:

- `tmp/ui/round22-stacked-question-flow.png` (before)
- `tmp/ui/round22-translation-focus-p4.png`
- `tmp/ui/round22-restored-p11.png`
- `tmp/ui/round22-evidence-restored-p4.png`
- `tmp/ui/round22-stacked-restored.png`

## Implementation and automated checks

Temporary large reading uses the existing original/translation buttons. It retains
the saved comparison tree and both zoom settings. Returning restores that tree and
zoom while keeping the current reading location. Same-paper source navigation can
open the original without erasing the return path. Explicit new arrangements still
replace the saved layout. The comparison button identifies its current orientation;
its menu marks the selected arrangement. The chat toggle now describes its actual
action, and the library toggle has an accessible name.

The final build, core suite and product UI suite pass locally. Product UI checks
actual increased pane dimensions, unchanged persisted layouts during large reading,
restored dimensions and zoom after a temporary zoom change, page continuity, and
source navigation followed by comparison return. Its first-page figure centering
assertion now checks the nearest reachable scroll position plus full visibility:
in a tall single pane, exact centering would require a negative scroll offset. The
failure screenshot showed the figure fully visible at scrollTop 0. The test also
explicitly enters translated-only mode before checking source navigation.

## Evidence transfer repair

The separate note audit reproduced two connected failures in copying evidence to
an existing note. The copy IPC reads the source on disk, but the UI had not flushed
its draft; a new or relinked card could be missing or outdated. The UI now saves
first and stops if that fails or if the source changes while saving. The backend
also failed to recognize a final evidence block followed by one ordinary newline;
its boundary now accepts LF and CRLF without accepting block-ID prefixes.

An actual temporary-vault integration test reproduces the unsaved-card failure,
saves and copies the exact Markdown card and PDF provenance to an existing claim,
and checks newline variants and aborts. This repair has automated integration
evidence; the native reader review above did not exercise the note-copy UI.
