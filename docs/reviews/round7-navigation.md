# Round 7 — native navigation and figure evidence

2026-09-09, Windows native Prism PID 23372, 1280×900, isolated test vault. No AI calls in this UX pass. Science reviewer handed over engineering page 11 after their separate translation run.

- Engineering page 11 mid-paragraph → biology sidebar → engineering tab restored the actual same paragraph in both source and Korean panes, not merely the page counter.
- Clicking the page number, typing 4 and pressing Enter navigated both panes to page 4. After reload, entering 11 likewise navigated to the matching chart page.
- Clicking the translated page-11 chart opened chat and inserted a figure reference chip into the unsent composer. Nothing was sent. [Figure attachment](../../tmp/ui/round7/figure-chat-anchor.png)

## Defect found and fix retest

Initial paper→flow switch on page 11 left source/counter at 11 while Korean displayed page 4. Reverse flow→paper after direct page-4 navigation jumped to page 17. [Mismatch](../../tmp/ui/round7/format-position-mismatch.png). Parent added explicit reading-position queuing and format-dependent restoration; reviewer reloaded with Ctrl+R.

After that fix, page-11 paper→flow retained page 11 and the same pore-shape paragraph. [Correct flow](../../tmp/ui/round7/format-position-fixed-flow.png). Reverse flow→paper retained page 11 but produced a persistent over-wide page at the chat-open reader width: Korean text began near x657 and extended beyond the pane, with a horizontal scrollbar at 100%. [Reverse width defect](../../tmp/ui/round7/format-return-width-overflow.png). Parent notified immediately. This is a remaining P1 until the follow-up geometry fix is visually checked.

## Final follow-up: both defects closed

Parent identified the recreated canvas on format changes and added the missing format dependency to canvas rendering. After another native Ctrl+R, repeated both directions with chat open and engineering page 11 mid-paragraph. Paper→flow retained the same page and pore-shape paragraph; flow→paper restored the normal fitted width without a horizontal scrollbar or clipped text. Source and Korean stayed on page 11. [Final fitted paper return](images/reading-format-restored.png).

Scoped verdict: page entry, paper-switch position, translated figure attachment, and both reading-format transitions passed the final native review. This does not establish every PDF's parsing quality or full app release readiness. UI released for packaging; no AI invocation or message send during this review.
