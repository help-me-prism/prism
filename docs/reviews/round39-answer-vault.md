# Keeping an answer in its intended vault

An AI answer's saved-state key included its vault, but the actual IPC capture request did not. The main process checked source ownership for evidence memos only. An answer from a stale workspace could therefore be appended to the current vault's note when both vaults contained the same paper ID.

The pre-fix compiled app reproduced this failure in the isolated Product UI fixture: a chat capture carrying a different vault path was accepted rather than rejected. `tmp/round39-before-fix.log` records the expected boundary assertion failing. The failed test's fixture was cleaned up; no user vault was used.

Chat capture IPC now requires the library path displayed at the save click. Missing paths fail, and a mismatch with the settings snapshot fails before writing. Once validated, the same captured path is used to read the library and save the note. Internal capture functions retain their explicit path argument. The UI freezes the answer, question, model and provenance before awaiting the request.

UI ownership tokens distinguish vault/session changes, including returning to a previous combination while a request is pending. Late errors are not displayed in a different scope. A real save success remains recorded under its original vault/session/message key so returning there does not invite a duplicate write. Note opening ignores stale lookup results and checks settings before opening; its final cross-process navigation is not claimed to be an atomic vault transaction.

## Verification

The integrated build, core suite, Product UI and Notes UI passed. Product UI covers wrong-owner rejection with byte-for-byte note preservation, then holds a real chat-capture IPC at a test-only gate, changes to a second vault with the same paper ID, releases the request and checks that neither note was modified by the rejected answer. Returning to the owner vault allows retry; missing-owner capture fails. The gate exists only in the test host, not production.

Notes UI uses the explicit chat owner and runs the existing Markdown, external edit/conflict, source card, claim creation and relationship workflows. No model inference is required by these tests.

Independent CDP review used a labeled synthetic historical answer: [save completion](images/round39-saved.png), opening the correct biology note, [finding the appended answer](images/round39-note.png), and [returning to its engineering p4 source](images/round39-source-return.png) all worked. The saved block retained both paper URLs. The editor virtualizes offscreen content, so the initially unseen third answer was found through the memo section; there was no missing write. The reviewer did not independently perform the vault-switch race, which is covered by the controlled IPC test. Opening a saved answer still starts at the note rather than jumping directly to that new block, a remaining usability issue.

This resolves a concrete answer-write ownership gap. It does not prove all asynchronous app operations are vault-safe or complete the broader multidisciplinary reader goal.

## Navigation completion race

The preceding commit's CI run 34417774052 passed Windows and macOS Apple Silicon but failed macOS Intel while waiting for a source memo panel after changing papers. Investigation reproduced a separate request-loss defect in a real React/Chromium harness: an old navigation completion cleared a newer memo request queued before React committed. The callback now checks its target identity and clears pending state only if it still owns that request. `test-anchor-navigation.mjs` exercises the actual callback with the queued-updater contract, including cancellation, a newer request, and normal memo opening.

This proves the request-loss defect and its correction, not that the unavailable CI scheduling trace followed exactly the same interleaving. The subsequent CI run remains necessary to assess the original Mac Intel failure. The final local suites include this change.

An additional independent CDP check opened an engineering p4 sentence memo from the biology reader and verified the exact original excerpt in the [memo panel](images/round39-memo-return.png). The yellow page highlight remained on another sentence; hover versus navigation ownership was not isolated, so this remains a separate visual follow-up. No answer was submitted or saved in this check.
