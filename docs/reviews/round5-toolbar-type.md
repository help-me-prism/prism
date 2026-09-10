# Round 5 — independent typography and compact-toolbar review

2026-09-09. Dedicated UX agent, actual native Windows app, 1280×900, dark theme, isolated fixture PID14716 / port9351. This pass used cached engineering page4 translation and made no AI calls. Pretendard typography was supplied by a separate design agent; this review is independent of that typography implementation.

## Observed improvements

- Korean sidebar labels and chat prose are clearly more legible with the bundled UI typeface. Weights and spacing look more consistent across Korean and Latin text; the chat no longer looks like a mix of unrelated typefaces. PDF content remains a separate visual surface.
- The compact toolbar fits in one row within the approximately685px reader area while chat remains open. It removes one persistent toolbar row and duplicate tab-level mode toggles. Page, original/Korean/compare, memo, scoped AI action and More remain visible.
- Native arrow navigation through pages1,2,3,4 correctly updates source page and the visible translation action scope.
- Engineering page4 original-letter strip is absent. Table and both equations are visibly sharp and complete. The caption is one readable line, and the translated paragraphs follow the correct table/equation sequence. [Screen](../../tmp/ui/round5/engineering-p4-crisp-dark.png)
- Clicking Compare for the first time from single Korean view with chat open chooses stacked comparison. After settling, both original and translated panes remain on page4. This is the intended narrow-reader default and improves over the earlier miniature side-by-side columns.

## Defect found and fixed in code

The comparison dropdown arrow opened its details state, but the menu was clipped completely by the inherited `document-mode { overflow:hidden }`. This was confirmed by native clicking, not inferred only from CSS. Added a scoped `overflow:visible` override in readerToolbar.css. The parent independently added an actual hit-test regression. The corrected rebuilt menu must still be checked on screen.

## Timing observations

The first immediate screenshot of page4 showed temporary large gaps while measured layout settled; a later screenshot showed correct compact spacing. This was not reported as a persistent blank-layout defect. The brief visible layout jump remains a polish consideration.

## Remaining verification

Light theme, rebuilt comparison popup, keyboard/Escape/outside-click dismissal, translation-scope popup and More menu are deferred to the next short rebuilt-screen pass. The paper-format view's exact two-column scientific grouping is being checked separately. This report does not declare the entire product ready.

## Final rebuilt native check — PID 29024

Actual native review on the integrated build, same 1280×900 fixture, no AI calls:

- The comparison popup is now visible and clickable. Escape closes it and returns focus to the disclosure; Return reopens it. Clicking outside dismisses it.
- Explicit 좌우 and 상하 choices both work and retain engineering page 4 in both panes after rendering settles. Closing chat provides a useful full-page side-by-side overview; stacked comparison makes table text much easier to read.
- Page 4 table, both equations and figure remain complete and sharp. No stray original-letter strip is visible. [Matched page 4, dark](../../tmp/ui/round5/final-p4-dark.png)
- Light theme has readable toolbar/sidebar labels and restrained surface contrast. The PDF stays white with intact table detail. [Light stacked comparison](../../tmp/ui/round5/final-p4-light-stacked.png). Dark was restored before handoff.

Verdict: the scoped toolbar, typography and page-4 geometry changes pass this actual screen check. Side-by-side at laptop width is an overview rather than comfortable long-form reading; stacked or single-pane remains the appropriate reading choice. The brief render/resize settle is still visible. This short pass did not independently exercise the translation-settings/More menus or prove arbitrary scientific page coverage; science page 11 is handed to the separate scientific reviewer. UI ownership released to the parent and science reviewer.
