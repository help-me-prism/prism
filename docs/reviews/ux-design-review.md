# Prism UX/UI acceptance review

Owner: dedicated UX/UI review agent. Date: 2026-09-09.

This is a critical design review informed by the user's supplied comparison screenshot and agent-operated native Windows walkthroughs. It is not a recruited human usability study. Implementations mentioned as pending must be inspected after rebuilding before they can be called verified.

## Product judgement

Prism should make a student feel that they are still reading the same paper, with a reliable language layer and a useful research notebook beside it. The most valuable outcome is: find an unfamiliar statement → understand it with its limitations → preserve the source → connect it to an existing research question. A graph of anonymous links or a translated wall of prose is not sufficient.

The user's screenshot establishes a clear requirement: original and translated page retain the same page silhouette, headings, paragraph neighborhoods and display-math positions. The equations remain recognizable landmarks. Current free reflow breaks that spatial memory. Adaptive vertical expansion can preserve the useful structure, even though the translated page becomes taller. It is useful as an accessibility/readability alternative, but should not replace the format-preserving reading view requested by the user.

The reference screenshot also contains too many persistent controls: separate model rows, multiple layout/sync controls, an empty chat column, and a very narrow library. Preserve its document correspondence, not its chrome density.

## Visual direction

Use the restraint of Linear's typography and grouped controls, and the capture-first progression of Readwise Reader. Prism should have a quieter academic character: neutral warm surfaces, a restrained green accent for selection/action, readable sans-serif chrome, a clear document type hierarchy. Avoid purple AI gradients, decorative chatbot mascots, constant badges, and multiple nested outlines.

Design references previously researched by the parent:
- [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- [Readwise highlights, tags and notes](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)

Dark mode is a chrome preference. Original paper pixels should remain faithfully white unless a separately designed document contrast option is added. Do not invert or tint equations and figures as part of dark chrome.

## Release-blocking reading criteria

| Priority | Acceptance criterion | Concrete verification |
|---|---|---|
| P0 | No translated prose overlaps, masks or fragments an equation, table, figure, caption, or neighboring paragraph. | Compare full engineering p4 and biology method pages to original pixels at 100%, fit width, and 150%. Inspect all complete equation/table regions, not just whether an image element exists. |
| P0 | No silent truncation or invented completeness. | Use a deliberately long Korean paragraph, long gene names, numbered citations, and mixed inline math. Every translated character must be accessible; overflow is explicit. An untranslated paragraph is visibly original. |
| P0 | Visible page, toolbar page and AI scope agree. | Import → advance several pages → switch original/Korean/compare → resize → ask or translate current page. Check actual source-page IDs as well as screen labels. |
| P0 | Model scope/cost is explicit and actual. | A current-page action names that scope and shows its own denominator; only those segments run. Choosing a model, opening Notes, or marking read must not trigger AI. |
| P1 | Format-preserving translation preserves landmarks. | Same source-page identity, horizontal margins and column structure. Complete display equations/tables/figures retain their original proportions. Vertical expansion may shift later blocks safely downward; grouping/order remain recognizable. |
| P1 | Default reading has no horizontal scrolling. | Verify 1280×900, 1440×900 and a wide desktop window, both themes, and chat on/off. A fit-width original page and translated page fit their actual pane. Intentional zoom above fit can scroll. |
| P1 | First translated result appears where the user requested it. | Translate page 4 while reading page 4; do not open translated page 1 or jump to the top. Preserve the same passage when switching mode. |
| P1 | Figure capture is complete and correctly attributed. | Biology multi-panel figure and engineering preparation diagram retain all panels, axes, labels and legend. Captions match the captured figure. Uncertain grouping offers manual adjustment rather than implying certainty. |

## Format-preserving translation design

1. Name the options by reader intent: `원문 형식` and `읽기 편한 보기`. The first is the requested structurally faithful default; the second is the existing prose flow. Do not expose parsing, bounding-box, block-ID or rendering terminology.
2. Keep source-page identity, original horizontal margins and columns. Original math, tables, figures, lines and non-prose retain complete pixels and proportions. Translate prose into correctly classified paragraph/heading/caption regions.
3. Let Korean paragraphs grow vertically when required for readable text. Shift later blocks safely downward within the affected column rather than shrinking, clipping or requiring expansion of every long paragraph. The translated page may become taller; disclose this as preserving source structure, not pixel-identical positions.
4. **Spanning objects are synchronization barriers.** A full-width figure, table or heading below two columns must start below the final bottom of both columns, including their translated growth. Independent column offsets must never paint text through a spanning object or reorder the following section. If region classification is uncertain, use a safe full-width group or readable-flow fallback for the affected area.
5. Maintain passage correspondence in comparison mode. Once page heights diverge, equal scroll offsets and page-height ratios are insufficient. Sync by source page/block or a selected paragraph; use original source-page numbers for navigation and evidence.
6. Pathological long tokens or uncertain regions still need an explicit overflow solution. No silent clipping, negative line spacing or unreadably small type. A local full-text reading card or safe flow fallback is acceptable for exceptional blocks, not a mandatory interaction for every normal paragraph.
7. Partial translation is normal. Keep original prose in unprocessed blocks and mark the local state without repeated full-width banners. A page-level progress indicator is enough; do not render dozens of loading cards.
8. Match a paragraph across original/translated views when it is selected or hovered. Source checking should take one click, without searching through independent scroll positions.
9. Keep original inline mathematics or properly rendered equivalent tokens within prose. Plain exposed LaTeX strings are not a polished substitute. If inline formula recognition is uncertain, preserve the original line or make the original excerpt available locally.

**Decision:** Adaptive vertical expansion is accepted in principle. It is a deliberate compromise favoring complete, uninterrupted reading while retaining spatial structure. It is not verified until the latest actual two-column/spanning-figure screens pass. Exact fixed page height could be a future optional print-like mode, not a reason to clip content now.

Minimum readable size should be assessed on the actual laptop viewport, not a 2558px screenshot scaled down. At fit-width, users must be able to switch to a single-column reader or increase zoom easily instead of being forced into two tiny pages. The design must not choose spatial fidelity by making all Korean type microscopically small.

## Workspace and responsive behavior

The primary persistent reader bar should answer: which paper/page, which reading mode, and what can I do with this passage? Consolidate duplicate original/Korean/layout controls. Keep provider/model choice inside a single settings disclosure; task controls can show a concise model label when helpful.

- **Read:** Library + one page. Chat closed unless the user opens it. `질문하기` is visible and labelled.
- **Ask:** Current passage remains visible; chat opens as a purposeful secondary pane. At laptop width, collapse the library when necessary instead of shrinking paper and chat simultaneously.
- **Compare:** Original and translated pages are synchronized by source page and passage. Offer collapsing secondary chrome without abruptly closing a user-requested chat. When each readable page pane would be below roughly 480px (about 1000px total reader area), default to a single translated page or offer stacked comparison. Treat this threshold as a design guardrail to test, not a universal magic number.
- **Notes:** Open the current paper or freshly saved result. Keep source navigation visible. The graph is optional context; the whole-vault graph should not be squeezed between two separate inspector panels.

Avoid changing an explicit user layout selection on every resize. Automatic fit should react to available pane width, while intentional zoom remains intentional. The UI must distinguish fit width from a fixed percent, and should never display a false fit state.

## Knowledge workflow acceptance

| Goal | Required behavior |
|---|---|
| Save a useful answer | Name its destination and offer direct open/jump. Show source paper/page and model provenance. Saved answer is accessible by one clear expand action. |
| Write my own understanding | Visible one-action writing target; preserve it across reopening, AI updates and external Obsidian changes. No raw YAML appears after property edits. |
| Make a reusable concept | Title and short definition are sufficient; taxonomy/template selection is optional. Preserve scientific punctuation in display titles while keeping filenames portable. |
| Add meaning to a link | Distinguish ordinary link from definition/support/contradiction/question/answer. Show direction before committing. Never convert a citation into support or extension automatically. |
| Track uncertainty | Questions remain open without demanding an answer; disagreement prompts comparison of conditions and evidence, not a forced winner. |
| Return to evidence | From concept/question → relation/source → exact paper passage or evidence crop in a small number of visible actions. A page-number string alone is not a navigable citation. |

## Current weaknesses and next priorities

1. **P0 reading fidelity:** Earlier engineering screen showed split fractions and detached table rows. The new region-merge pass and format-preserving view require actual pixel comparison; a successful parser test does not settle this.
2. **P1 translated-page spatial fidelity:** Existing reflow loses page landmarks and inline math presentation. User reference makes this a core requirement. Adaptive geometry mode needs safe column growth and spanning-object barriers before it becomes default.
3. **P1 context navigation:** Page synchronization and current-page scope were previously wrong. Recent engineering pass improved them; retest after geometry mode lands because it changes scroll surfaces again.
4. **P1 saved knowledge discoverability:** Current-paper Notes and active fold controls now worked in native round 2. Recent `메모 보기` and direct relation controls are implemented; the last integrated screen needs checking.
5. **P2 chrome density:** Multiple tab-level and bar-level original/Korean controls, page layout toggles, and disclosure rows compete with the paper. Consolidate only after validating the essential reading modes, so controls do not disappear unpredictably.
6. **P2 first-use library quality:** Local import still shows a filename despite embedded document metadata. Good titles and authors materially improve scanning a multi-disciplinary library.
7. **P2 graph readability:** Strong outlined labels, clipped long titles, and duplicated side panels reduce graph utility. Selected-node text is a useful fallback, but should not be required to decipher every node.
8. **P2 editorial noise:** Empty note template sections, boilerplate hints and repeated title headings make a saved answer feel buried. Prefer optional sections or direct jumps; never delete existing user content merely to simplify the screen.
9. **P2 trust in imported prose:** Orphaned headings, author raster fragments and split cross-page sentences should not be presented as polished translation. Show the original fallback where extraction confidence is insufficient.

## Next screen review protocol

Use the actual latest build and existing cached translation first; no new model call is needed to assess geometry or interaction. Inspect engineering p4, a biology two-column/figure page, and a dense mathematical Flow Matching page. Capture original and format-preserving translated screenshots at matched page and scale. Then test overflow with a clearly identified isolated fixture, not by changing real cached translations.

At 1280×900, perform: open/import → fit width → current page → Korean format → compare → hide/show chat → switch readable flow → return to format → memo → Notes → source. At a wider viewport, confirm comparison adds utility rather than only smaller text. Test a keyboard-only expansion and Escape return path.

For each criterion record **pass**, **fail**, or **not tested**, the exact build context, page, visible evidence and whether a real or cached model output was used. A design review should reject a visually corrupted result even if unit tests pass. Do not call the app product-ready while any P0 criterion is unverified.

## Bounded toolbar cleanup proposal — after Pretendard

Read-only code review, before native inspection of the new typeface. Existing reader chrome has four rows below the app titlebar: paper tabs (also original/Korean/map toggles), paper toolbar (again original/Korean/side-by-side/stacked, sync controls, capture/page/memo), always-visible translation scope/settings/action row, and pane tabs/zoom/format. The same document state is controlled in several places. Enlarging tiny labels with Pretendard improves legibility but increases the risk of control overflow; font size must not be reduced again to hide that design problem.

### Minimal change, preserving existing handlers

1. **Paper-tab row:** retain paper switch/close/add and library toggle. Remove the active tab's duplicate original/Korean toggles. Move `구조 맵` to the reader More menu using the existing open-pane handler. Do not remove the pane docking system or change saved layouts in this cleanup.
2. **One task toolbar:** page navigation; `원문 / 한국어 / 비교`; `메모`; a compact split action such as `4쪽 AI 번역 · 18문장`; More. This replaces the always-visible translation row. Do not repeat the already visible paper title in this toolbar.
3. **Compare control:** main action opens the last intentional comparison layout; dropdown offers labelled `좌우 비교` and `상하 비교`. On the first comparison with actual reader width below about 960px, choose stacked comparison. Use the reader container width, not the full window breakpoint—an open chat changes the available width. Do not change an explicit user selection repeatedly while resizing.
4. **Translation split menu:** scope choice, currently selected model/provider and advanced translation settings remain discoverable here. The main action always names actual scope and missing segment count. `본문 전체` must stay visibly distinct from a current-page action. During execution replace the same action with progress and Stop; do not open another persistent row. Cached completion can read `4쪽 번역됨` with view/settings available through the menu.
5. **More menu:** capture region, page evidence, structure map and comparison sync options. Capture mode gets its own temporary instruction and a clear Done/Escape exit. Sync options appear only when both documents are open and have explicit checked states, rather than two extra permanent buttons.
6. **Pane header:** retain each pane's title, zoom and translated format choice. This row has a distinct purpose—local view controls—and remains. A later docking redesign would need its own acceptance pass; do not conflate it with simple toolbar cleanup.

Target three rows below the app titlebar, saving approximately one 36–40px row. The primary toolbar should fit in roughly 630–660px with 12px UI labels and comfortable controls. This is a sizing estimate to verify, not a reason to force exact widths. If it cannot fit, More absorbs secondary actions; button labels never split mid-word or overflow outside the reader.

### Acceptance before merging the cleanup

- At 1280×900 with chat open, all primary actions fit without horizontal toolbar scrolling or tiny type.
- A new user can find original, Korean, comparison, current-page translation and memo without tooltips.
- Every retired visible duplicate still has one clear surviving access path; structure map, full-paper translation and capture remain reachable.
- Switching any reading layout or format preserves source page/passage and correct AI scope.
- Menus support keyboard activation, Escape, focus return, checked options and visible current model/scope.
- Running translation still has an obvious stop action, and changing display mode never starts an AI call.
- The user's reference structure is preserved in the document; the reference's toolbar clutter is not copied.

### Typeface-specific review to follow

Pretendard is bundled locally and scoped mainly to UI/chat; original PDF pixels and translated-paper metrics must remain unchanged. Inspect Korean and Latin labels at 100% OS scale, disabled states, long paper titles, menu widths, titlebar safe area and chat body/math boundaries. The code-level change is promising but is not a visual approval. Native review will be recorded after exclusive screen ownership is granted.
