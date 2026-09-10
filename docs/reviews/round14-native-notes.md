# Round 14 — Windows native note recovery and history review

2026-09-10. Independent UX review using @oai/sky against the actual Prism Notes window, PID 29628 test fixture. No AI requests. Native build preceded the subsequently queued hard-link capability preflight; that backend change is outside this visual verification.

## Verified sequence

- Opened Notes from Reader. A restrained top notice exposed one recovery record despite the missing note not appearing in the tree.
- Opened recovery dialog. Prism editing version showed the full frontmatter and the sentence about causality and checking control conditions.
- Selected the file immediately before replacement. Both the explanatory line and preview changed; the alternate sentence included checking sample size.
- Returned to Prism editing version and restored it. Dialog and notice disappeared, and the recovered note appeared in Concepts. Opening it showed the requested control-condition sentence.
- Added the small actual edit “복구 뒤 확인한 편집 문장입니다.” and observed saved state.
- Opened history, previewed the saved editing version, selected the immediately preceding file version, then restored it. Success notice appeared and the added sentence disappeared from the editor.
- Changed to light theme through Reader settings. Reopened history and selected the newly retained pre-restoration version. Its preview still contained the added sentence, confirming that restoring did not discard the content it replaced.

## Scoped verdict

Pass for this missing-note recovery and short-note history flow. No clipped text, hidden primary actions, or failed preview/restore interactions were observed at the actual 1306 × 853 Notes window. Dark and light history dialogs were both readable; the recovery dialog was visually inspected in dark theme only. The consistent sans-serif controls, restrained green selection, and clear spacing suit a utility dialog. This does not approve all editor typography, narrow screens, long documents, screen-reader behavior, or fault-injection outcomes.

Remaining polish: full frontmatter occupies the first several preview lines before the research prose. Full-file inspection is correct, but a future optional metadata fold could help researchers compare content. The restore dialog closes successfully, yet the recovered note is not automatically opened or highlighted; the user must find its new tree row. Neither prevented this task. Version labels remain somewhat procedural, but the selected-kind explanations made their differences understandable. The Notes window does not expose a direct theme setting; switching through Reader adds steps.

## Fixture limitation

The testhost directory picker bypass was still enabled. Pressing Notes' vault button selected the predetermined external-papers directory without displaying a native chooser. Root reset the isolated picker fixture to the original vault; choosing it again restored the original workspace. This is test-fixture behavior, not a demonstrated product chooser regression. No files were deleted or moved. The light-theme history dialog was left open for a separately cropped, account-free documentation image.

## Local evidence (do not commit full screenshots)

- tmp/ui/round14-recovery-dark.png
- tmp/ui/round14-recovery-alternate.png
- tmp/ui/round14-recovered-note.png
- tmp/ui/round14-history-dark.png
- tmp/ui/round14-history-restored.png
- tmp/ui/round14-history-light.png

Full screenshots may include account or workspace details. Only this report is intended for version control.

## Final native follow-up — direct Notes settings

After reloading the latest renderer in the same Notes window, the bottom rail action is now labelled “설정” and opens the small “노트 설정” dialog. Changed light → dark → light directly in this dialog; the vault remained “vault” with the same note tree. The distinct “노트 폴더 선택” button was not invoked. This resolves the earlier theme-discoverability concern and avoids assigning folder-switch behavior to the settings icon.

Escape closed the dialog and visibly returned the focus ring to the settings rail button. Pressing Enter reopened that same dialog, confirming usable keyboard focus restoration despite the native accessibility tree reporting only the outer window. At the tested window size, light and dark versions were readable, with clear margins and no clipped controls. Evidence: tmp/ui/round14-notes-settings.png (full screenshot, keep uncommitted). No AI calls, no history/recovery replay, and no new backend claim: the native process still predates the final backend preflight changes.
