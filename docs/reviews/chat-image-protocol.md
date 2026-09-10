# Chat image wire protocol review

2026-09-09. No model inference was run. Installed `claude --version`: **2.1.258**. Local help confirms print mode supports `--input-format stream-json`; the existing output flags remain usable.

## Claude

Use `-p --input-format stream-json --output-format stream-json --verbose` and send one complete JSON object plus LF to stdin. Do not pass this JSON as a positional text prompt. Existing `--include-partial-messages`, explicit low-cost `--model` and `--resume` choices are independent.

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Question"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"BASE64_BYTES_WITHOUT_DATA_URL_PREFIX"}}]},"parent_tool_use_id":null}
```

The [official streaming-input example](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) defines this user-message image shape and explicitly distinguishes image-capable streaming input from single text input. The [official Python SDK subprocess transport](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py) uses stream-json input/output for the CLI. [CLI reference](https://code.claude.com/docs/en/cli-reference) documents the flags. Together these establish the wire pathway; this review did not submit a live multimodal request to prove account/model execution.

The [headless guide](https://code.claude.com/docs/en/headless) documents a 10 MB piped-stdin ceiling since 2.1.128. The [vision guide](https://platform.claude.com/docs/en/build-with-claude/vision) currently lists PNG/JPEG/GIF/WebP, first-frame-only animation behavior, 10 MB base64-encoded images on direct API and 5 MB on Bedrock/Google Cloud. Large images can be downscaled, reducing fine figure-text readability. API image-count allowances are not a sensible app default and do not guarantee CLI acceptance under the stdin limit.

Prism helpers deliberately use stricter **application limits**, not claims of provider maximums: four images, 5,000,000 base64 bytes per image, and 8,000,000 UTF-8 bytes for the complete NDJSON line. This leaves room below CLI input limits and avoids excessive image requests. The caller should still render/decode and resize evidence, validate dimensions, authorize the exact local paths, and reject unsupported/model-specific errors without silently upgrading models.

## Codex

[Official app-server documentation](https://learn.chatgpt.com/docs/app-server#turns) accepts `localImage` with a local path in turn input. Installed `codex app-server generate-ts --out tmp/chat-image-protocol` generated `v2/UserInput.ts` with the same variant and a text item containing `text_elements`. The pure builder emits text plus image items; local paths with Korean characters/spaces are preserved. It does not read files or authorize paths.

## Implementation and offline checks

- `electron/chatImageInputs.ts`: `buildCodexImageInputs(prompt, imagePaths)` and `buildClaudeImageMessage(prompt, images)` where each Claude image is `{ mediaType, data }`.
- Checks reject malformed/noncanonical base64, data URLs, unsupported MIME, mismatched format signatures, excess images and excessive encoded/aggregate byte sizes. Signature validation is not full image decoding; callers remain responsible for actual valid pixels.
- `scripts/test-chat-image-inputs.mjs` verifies Unicode/newline prompts remain one NDJSON record, exact image bytes survive, native paths survive, malformed/mismatched inputs fail, large payloads avoid regex stack overflow, and total limits count UTF-8 bytes.
- `npx tsc -p electron/tsconfig.json` and `node scripts/test-chat-image-inputs.mjs` passed. Parent owns integration into the actual chat send paths and standard test runner.

Do not log image base64 or model prompts during diagnostics. An image rejected upstream must surface as failure, not be quietly dropped while describing the request as visual analysis.
