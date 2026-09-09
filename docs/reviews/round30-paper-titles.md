# Paper titles and stable knowledge links

Local PDF filenames were the only editable-looking identity in the reader, but there was no way to change the title. A biology paper consequently appeared under its download filename in the library, tabs, chat scope and paper note.

The reader's More menu now opens a title editor. It can preview the title embedded in the loaded PDF; nothing is saved until Save. The library index is authoritative. Metadata and the existing paper note are updated conservatively, with visible warnings if a secondary update cannot be completed. The operation checks the active vault and expected old title. It preserves paper IDs, paths, PDF bytes and user-authored note content; it does not rename files or rewrite historical chat citations.

The former title becomes a note alias. One resolver applies explicit ID, path, current title, basename and alias precedence to backlinks, derived relations, note navigation, previews and capture. Duplicate aliases remain unresolved and do not create empty replacement notes. Display labels are kept separate from actual wiki-link destinations.

## Validation

- Integrated build, complete core suite, Product UI and Notes UI passed before the subsequent PDF font-metric correction.
- Product UI uses an actual PDF with embedded title metadata. It checks preview cancellation, saving, reload persistence, preserved note text and paths, stale-title rejection, wrong-vault rejection and a missing secondary metadata file.
- Real temporary-vault tests cover comma-containing aliases, old-title backlinks and relations, precedence, ambiguous aliases, and avoiding ghost notes on save.
- Notes UI opens and previews an old alias whose display label differs from its target.
- Native review used an isolated copy of an actual biology PDF: the full title appeared in the library, tab, chat paper scope and Notes. Existing connected-note navigation continued to work.
- After the final integrated build, a new explicitly named regression note saved `[[biology-drosophilidae-genomes|이전 제목 링크]]`. Clicking it opened the existing renamed biology note. The visible note count grew by only the deliberately created note and remained unchanged on navigation. [Saved alias](images/round31-alias-saved.png). Native hover was not checked; automated Notes UI covers it.

Complex YAML is preserved with a warning instead of being destructively rewritten. Secondary files are not a cross-file atomic transaction. Native review used Windows; no macOS physical-device claim is made.
