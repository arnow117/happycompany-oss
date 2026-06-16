# Test Coverage Gap Analysis (2026-05-08)

## Tier 1 — Pure functions, high bug-finding potential

| Source File | Untested Exports | Priority |
|---|---|---|
| `src/feishu-cards/sections.ts` | 21 pure functions (formatDuration, buildBodyChunks, buildThinkingPanel, etc.) | HIGH |
| `src/feishu-parse.ts` | extractMessageContent() — 15+ message types | HIGH |
| `src/feishu-markdown-style.ts` | optimizeMarkdownStyle() — regex-heavy | HIGH |
| `src/feishu-cards/length.ts` | splitIntoBodySections() | HIGH |
| `src/feishu-cards/status-theme.ts` | resolveStatusTheme() | HIGH |
| `src/feishu-cards/builder.ts` | buildAgentReplyCard(), buildStreamingAgentCard() | HIGH |
| `src/command-utils.ts` | formatBotList(), formatBotStatus(), formatHelpText() | MEDIUM |

## Tier 2 — Minimal mocking needed

| Source File | Notes |
|---|---|
| `src/file-text-extractor.ts` | Testable with temp files |
| `src/skill-analytics.ts` | Testable with temp dirs |
| `src/dingtalk-utils.ts` | downloadByCode() untested |
| `src/app-scaffold.ts` | scaffoldApp() with temp dirs |

## Tier 3 — Integration/heavy-mock (defer)

- dingtalk-card.ts, streaming-card.ts (HTTP mocking)
- web.ts, ws.ts (server integration)
- admin-build.ts (child process mocking)
