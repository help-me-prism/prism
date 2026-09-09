# Reader composition: implementation and independent native review

The engineering paper's run-in heading was rendered in a narrow standalone box.
Its bold glyphs started slightly lower than the adjacent paragraph, so geometric
sorting could put the heading after its own text. Precisely located headings that
share a line and paragraph with subsequent prose now render together, retaining
their individual anchors and emphasis. Separate-line headings and untranslated
partitions remain separate.

Paper-mode zoom now scales the complete page, including translated prose, figures
and protected PDF content. Both panes offer width fitting. Zoom buttons step from
the current fitted scale. Flow mode retains its text-size control. Full untranslated
pages copy the actual canvas dimensions, avoiding a one-pixel discrepancy caused
by fractional fitted viewport dimensions.

Precisely located protected prose in flow mode uses the source font em to match
surrounding text. An initial line-based implementation was rejected because it
introduced horizontal scrolling. The revised renderer masks exact source pixels,
splits only at entirely blank word-sized vertical gutters, and wraps those pieces.
All pixel columns survive; scientific glyphs are not retyped. Exceptionally long
unbreakable pieces scale intact to the available width. Tables, figures and display
equations keep their original renderer.

Independent native reviews used the actual Windows reader and existing engineering
page 11 translation, with no new AI calls. The run-in heading now precedes its
paragraph and no longer splits “공극률” across lines. At the same comparison window,
the observed page-end difference decreased to roughly 43 pixels (after the prior
whitespace fix had reduced it from 142 to 67 pixels). Width fitting and explicit
100% zoom visibly scaled the paper and its figures together.

The final flow review read the protected English sentence through its end at normal
width and with chat open, leaving approximately 230 pixels for prose. No horizontal
scroll, omitted ending, new overlap or missing comparison glyph was observed. The
surrounding Korean paragraphs stayed in order. Remaining imperfections include a
comparison glyph and its number breaking across a line, and occasional smaller
unbreakable fragments at narrow widths. This is not approval of all papers, all
typography or complete source typesetting fidelity.

Validation: production build, the full core suite and product UI suite pass locally.
New checks cover run-in versus separate-line headings, preserved partitions, blank
pixel cuts, complete source-pixel coverage, and proportional paper/text/figure zoom.
Product UI reloads now wait for a new document context; readonly polling tolerates
temporary CDP navigation detachment. Mutating actions are never retried automatically.
Remote validation is now complete for commit `61d02c4`: [CI run 34388352551](https://github.com/help-me-prism/prism/actions/runs/34388352551)
succeeded for Windows portable, macOS Apple Silicon DMG and macOS Intel DMG.
Each job passed core, product UI and Electron smoke checks, then packaged and
uploaded its artifact. The preceding `00b0970` Apple Silicon job failed the zoom
font-ratio assertion; the subsequent test-only change waits for stable layout
measurements. This remote result does not establish physical Mac-device usability,
code signing or notarization.

The local Windows executable in `release/reader-composition` remains the `00b0970`
runtime identified by its `BUILD-INFO.json`; `61d02c4` changes tests only. That
executable passed clean product UI and launch smoke checks and is `NotSigned`.
Its SHA256 is `3CE816B9DF42576CAE3DA94321CBCE0F8BC0E4FF48621F24C55A63F640439F98`.

Native evidence remains local under `tmp/ui/round17-*` and
`tmp/ui/round18-flow-wrap*.png` because full-window captures contain profile UI.
The separate multilingual search prototype was rejected in mixed-vault review
and is excluded from this PR and the reader-composition release. Its ranking and
irrelevant-query rejection remain inadequate.
