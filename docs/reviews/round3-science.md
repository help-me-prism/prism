# Round 3: science-reader native screen review

2026-09-09. Agent-led persona walkthrough on the actual Windows Electron app at 1280×900, using the Computer Use `sky` API for native clicks, scrolling, and screenshots. These are simulated graduate-student perspectives, not recruited human participants. The isolated fixture profile is recorded in ignored `tmp/persona-session.json`; no original user vault was changed.

## Biology graduate student: reads English slowly, checks methods and caveats

Imported the official PLOS Biology genomics PDF using the visible **논문 열기 → 내 컴퓨터에서 PDF 가져오기** controls. The test-only native picker supplies the preselected local corpus PDF; the actual app import handler, library registration, and reader opening ran normally. Imported ID: `local-d7fd44f67735b98bf97f67f3`.

Observed behavior:

- Import succeeded and the PDF opened. The library uses the filename (`biology-drosophilidae-genomes`) despite the PDF containing a full title and author metadata. This makes imported academic libraries harder to scan than arXiv imports.
- **P1:** Immediately after import, the visible title page was page 1 at scroll top, but the toolbar and translation scope reported page 3. The mismatch persisted after hiding chat and refreshing the native screenshot. A novice could translate a different page from the one being read.
- **P1:** Clicking translation on verified page 3 opened side-by-side reading with the original near pages 3–4 and the new Korean pane at page 1. The completed Korean-only view also began at page 1 although the toolbar reported page 3. Arrow navigation and visible page were inconsistent because of the active-page observer.
- **P2:** The requested one-page translation displayed a progress denominator of 816 sentences (the whole paper), although the button had offered 23 sentences. This gives a misleading impression of scope and cost.
- **P2:** The original PDF stayed 612 pixels wide when chat was hidden and the available reader grew much wider, despite **너비 맞춤** being selected. Opening side-by-side showed a horizontal scrollbar. The source text became too small for comfortable sustained reading.
- Page 2's reading flow includes a long publication-funding sidebar after the main text, and an orphaned `While` appears as a heading before the continuation on page 3. This is an extraction-order limitation, not an AI output problem.

Actual AI check: navigated with the visible arrows until the original page 3 body was confirmed, then clicked **AI 번역 · 23문장** once with Luna. The job finished successfully. Read-only cache inspection confirmed exactly 23 translated prose segments, all on page 3; no other page was translated. Quantities, identifiers, and citations passed the scientific gate. No whole-paper translation was invoked.

The first source sentence is a cross-page continuation beginning `impressive, ...`. Its Korean output treats that fragment adverbially, losing the concessive `While` on the previous page. This concrete nuance error shows why translation needs bounded context across page boundaries; token preservation alone cannot establish semantic fidelity. The model preserved uncertainty in the adaptive-radiation example and retained the numerical sample counts in the inspected cached output.

The active-page, page-opening, progress-scope, and width findings were sent immediately to the parent developer. Engineering verification is recorded below after the updated build is available.

## Engineering graduate student: checks formulas, units, tables, and figures

On the updated build, imported the official PLOS ONE foamed-concrete PDF using the same actual visible import controls. Imported ID: `local-6f1c8cd4d2e4ef2b696770a8`. The first page and toolbar both correctly showed page 1. The original now filled the available reader width and was substantially easier to read. Used three successive visible next-page button clicks, confirming pages 2, 3, and 4 after each move.

Clicked **AI 번역 · 18문장** on verified page 4, with Luna and current-page scope. Progress correctly showed **0/18** during execution. Both panes settled at page 4 after the layout transition. The run completed all 18 target sentences; read-only cache inspection confirmed every translated prose segment was on page 4. The three specimen dimensions stayed in one translated sentence, and the temperature uncertainty and duration were retained. No whole-paper translation or second model run was requested.

Native preservation observations:

- **P1:** The two display equations were visibly broken into separate crops: fraction fragments repeated on separate lines and lost their original alignment. Valid original pixels alone do not make a correct equation if the crop geometry separates its pieces.
- **P2:** The table appeared as three detached row crops with exaggerated row spacing, making column comparison harder.
- Figure 2's composite preparation process was present as a complete image, with its translated caption directly below. The native scroll walkthrough verified the four-material input column, slurry stages, mold, and hardened specimens were all visible.
- A horizontal scrollbar remained visible under the original pane in side-by-side mode even though the displayed page itself fit. Its cause was sent to the parent developer.

The preservation failure led to a new geometry pass that joins adjacent original-pixel fragments within the same column, while prose, large gaps, and separate columns stop a join. A regression derived from the actual engineering page 4 coordinates checks that seven source fragments become exactly two complete equation regions and one table region. Screen verification of that final geometry change is pending the next build below.

## Final native source-layout check

The final native paper-format comparison showed engineering page 4's two complete equations with intact fraction bars and alignment, the table as one coherent region, and the complete composite Figure 2. The earlier tiny partial blue DOI fragment under the translated figure caption was absent. Screenshots were saved as `tmp/ui/final-science-p4-equations.png` and `tmp/ui/final-science-p4-figure.png`. No AI call was made.

Engineering page 11 was reached using the actual next-page control. The masked mixed-prose paragraph did not duplicate neighboring full sentences, but partial glyphs at its boundaries remained visibly split: the leading letters in `Compared` and `When` fell across the separate source crops. The declared geometry regression passes, but PDF text-item proportional character slices are not exact glyph boundaries. This is a concrete visual limitation of the mask approach. For the entirely untranslated paragraph tested here, preserving one complete original paragraph crop avoids that problem without hiding translated content. That finding was sent to the parent for the final bounded correction; the native session was released. Evidence: `tmp/ui/final-science-p11-boundary.png`.

## Updated-build biology recheck

After the page-tracking fix, the native Korean reader opened on page 1 with matching toolbar and scope. Successive next-page clicks showed matching pages 2 and 3. Page 3 displayed the saved Korean body with a disabled **번역 완료** button; no additional model call was made. Text was legible and no horizontal clipping was observed in the single Korean pane. The previously generated cross-page nuance error remains in that cache; it was not silently rewritten or represented as corrected by a later prompt change.

### Final p11 safety fallback
The renderer now collapses wholly untranslated mixed prose into one original paragraph crop. Mixed text/artifact paragraphs with fractional PDF item slices also retain a complete original paragraph even when a cached translation exists: proportional character positions cannot safely cut scientific glyphs. The tooltip explains original preservation; these blocks must be excluded from paid translation scope through the shared unsafeParagraphIds helper. Whole-item boundaries remain maskable. Real engineering p11 regression, existing reading-block and excerpt geometry regressions, and TypeScript pass. This fallback was code-tested after the native finding; its rebuilt native appearance has not yet been verified by this agent.


## Rebuilt fallback verification

The parent checked the rebuilt renderer through CDP-driven existing controls (a rendering regression check, not a new native persona session). Engineering p11 now shows the complete untouched original page when no displayed translation exists. The initial C/W glyphs are complete and the 3.2.4 heading appears only once. The product UI test additionally compares the untouched page canvas against its source canvas byte-for-byte via PNG encoding.

Fractional PDF slices in mixed prose/protected paragraphs now trigger a full original paragraph fallback. Both the backend translation candidates and renderer sentence counts exclude these unsafe paragraphs; the pane status explains the exclusion. Existing cached translations remain stored, but are not pretended to be displayed. This preserves scientific content at the cost of leaving those paragraphs untranslated. General extraction of exact character positions remains a future parser improvement.

[Final original paragraph](images/original-paragraph-preserved.png) · [Final paper comparison](images/reader-comparison-dark.png). Source paper: Li et al., PLOS ONE, DOI 10.1371/journal.pone.0287690, open access under the article's Creative Commons attribution license.
