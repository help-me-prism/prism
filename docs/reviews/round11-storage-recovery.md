# Native moved-folder recovery

Windows native review,2026-09-10. Isolated fixture `tmp/prism-product-ui-recovery-cgchpv`; visible test process28940/port9352. Existing persona remained untouched. The test picker selected only this fixture's `moved-papers` directory. No AI calls.

## Result: passed

Opened Settings → 파일 보관 위치 → 이동한 폴더 다시 연결. The button showed 논문 확인 중… and then **1개 논문을 다시 연결했습니다.** The paper-storage path changed from `external-papers` to `moved-papers`; the PDF reopened automatically behind Settings. Closing Settings showed the engineering paper and **1/17** page count.

Read-only checks after the native action:

- Library pdfPath and translationPath now point into moved-papers.
- notePath remains in the original vault.
- The note's pdf property changed to the new original.pdf URI.
- Note title, frontmatter identity, and complete body `My laboratory notes must remain unchanged.` remained intact.
- Translation cache remains byte-identical: SHA256 `F3723A807F14C402BF16DC32BE5035E02D85A2CA121B332CAB1F11E9070DCCFD` before and after;60 cached translated/protected segments remain.
- Settings paperStoragePath now matches moved-papers.

Evidence: [success and updated path](images/round11-storage-reconnected.png), [automatically restored17-page PDF](images/round11-restored-pdf.png).

## Observations and limits

The initially launched recovery test window was hidden; the parent restarted the same fixture visibly before native actions. That was test-host setup, not a recovery-data failure. Before opening Settings, the reader showed “PDF를 불러오는 중…” instead of a specific missing-file recovery message during the observed interval. A direct missing-folder recovery hint would improve discoverability; the Settings workflow itself completed correctly.

No user files or original persona assets changed. Native UI released after evidence capture. This verifies one relocated paper folder on Windows, not every filesystem or macOS scenario.

## Follow-up: direct recovery from the failure screen passed

The loading-state issue above was fixed and checked on a fresh isolated fixture `tmp/prism-product-ui-recovery-RY9nkH`, process 18572 / port 9352. Native review observed **논문을 열지 못했습니다**, with both **이동한 폴더 다시 연결** and **다시 시도** visible. Clicking the direct reconnect button once, without opening Settings, automatically restored the engineering PDF at **1 / 17**. No AI calls were made.

Read-only checks confirmed that library PDF and translation paths now point to `moved-papers`, while the note remains in the original vault. Its PDF property was updated and the title, identity, and body `My laboratory notes must remain unchanged.` were preserved. Translation-cache SHA256 still matches `F3723A807F14C402BF16DC32BE5035E02D85A2CA121B332CAB1F11E9070DCCFD`.

Evidence: [explicit failure and direct recovery controls](images/round11-direct-missing-pdf.png), [automatically restored PDF after direct recovery](images/round11-direct-restored-pdf.png).

Small remaining wording issue: the error body exposes the Electron `Error invoking remote method` prefix before the helpful Korean message. It does not block recovery. Native UI released after this check; the earlier Settings-workflow pass remains valid.
