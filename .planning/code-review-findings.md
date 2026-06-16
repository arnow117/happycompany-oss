# P1-P6 Port Code Review Findings (2026-05-08)

## Positive

- feishu-parse.ts, feishu-cards/*, file-text-extractor.ts, im-downloader.ts: Clean 1:1 ports
- feishu-parse improved type safety (any → Record<string, unknown>)

## DingTalk Adapter Gaps (MEDIUM severity)

1. **MISSING** `buildFileContentBlock()` + file download for quoted file replies — agent only gets `[quoted file]` placeholder, no actual file content
2. **MISSING** Reply-to picture download — `[quoted picture]` placeholder only
3. **MISSING** Legacy `image` msgtype download — no `downloadDingTalkImageAsBase64()`

## DingTalk Adapter Gaps (LOW severity)

4. **MISSING** `MIN_IMAGE_SIZE` validation (happyclaw discards <500 bytes)
5. **MISSING** `fetchGroupNameByOpenConversationId()` with cache
6. **GAP** `sendViaWebhook()` doesn't check DingTalk `errcode` in response body
