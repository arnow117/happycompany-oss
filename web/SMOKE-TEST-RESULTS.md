# API Smoke Test Results

**Date**: 2026-05-10
**Backend**: http://localhost:3100
**Status**: ✅ **PASS** (after rebuild)

## Summary

All 12 tested endpoints are working correctly. Initial 404 errors on business routes were caused by stale compiled code (`dist/` was out of sync with source). After rebuilding, all routes respond as expected.

## Test Results

| Endpoint | Status | JSON Valid | Notes |
|----------|--------|------------|-------|
| `GET /api/health` | 200 ✅ | ✅ | Returns bot info (acme running) |
| `GET /api/setup/status` | 200 ✅ | ✅ | Returns configured=false, hasBots=true |
| `GET /api/admin/config` | 200 ✅ | ✅ | Returns full config with `claude` nested section |
| `GET /api/admin/apps` | 200 ✅ | ✅ | Returns empty array `[]` |
| `GET /api/admin/skills` | 200 ✅ | ✅ | Returns skill list (amap-lbs-skill, etc.) |
| `GET /api/business/agents` | 200 ✅ | ✅ | Returns agent list with session counts |
| `GET /api/business/channels` | 200 ✅ | ✅ | Returns channel summary (web: 1 bot) |
| `GET /api/business/contract-chain` | 200 ✅ | ✅ | Returns combined agents + channels |
| `GET /api/admin/analytics/usage?days=7` | 200 ✅ | ✅ | Returns usage stats (2 days of data) |
| `GET /api/admin/analytics/skills` | 200 ✅ | ✅ | Returns empty array `[]` |
| `GET /api/admin/scheduler/tasks` | 200 ✅ | ✅ | Returns daily-summary task |
| `GET /api/admin/insights` | 200 ✅ | ✅ | Returns empty array `[]` |

## Issues Found and Fixed

### Issue: Business Routes Returning 404

**Symptom**: `/api/business/agents`, `/api/business/channels`, and `/api/business/contract-chain` returned 404.

**Root Cause**: The running backend server was using stale compiled code from `dist/` (compiled on May 9 21:06) while the source `business-api.ts` was modified on May 10 11:12.

**Fix**: Rebuilt the backend with `npm run build` and restarted the server.

**Verification**: All business routes now return 200 with valid JSON.

## Configuration Structure Verification

- **`/api/admin/config`** correctly returns data nested under the `claude` key:
  ```json
  {
    "claude": {
      "apiKey": "$ANTHROPIC_API_KEY",
      "baseUrl": "https://open.bigmodel.cn/api/anthropic",
      "authToken": "...",
      "model": "glm-5-turbo"
    },
    "bots": {...},
    "web": {...}
  }
  ```

- **Health endpoint** returns proper bot information:
  ```json
  {
    "status": "ok",
    "bots": [{
      "name": "acme",
      "displayName": "示例医疗助手",
      "status": "running",
      "channel": "web",
      "workdir": "../corp/acme",
      "model": "glm-5-turbo"
    }]
  }
  ```

## Business Route Details

### `/api/business/agents`
Returns sorted agent list (running agents first):
```json
{
  "agents": [{
    "name": "acme",
    "displayName": "示例医疗助手",
    "status": "running",
    "channel": "web",
    "workdir": "../corp/acme",
    "model": "default",
    "sessionCount": 2
  }]
}
```

### `/api/business/channels`
Returns channel summary:
```json
{
  "channels": [{
    "name": "web",
    "botCount": 1,
    "bots": [{"name": "acme", "displayName": "示例医疗助手", "status": "running"}]
  }]
}
```

### `/api/business/contract-chain`
Returns combined view:
```json
{
  "agents": [...],
  "channels": [...]
}
```

## Additional Business Routes Available (Not Tested)

Based on `business-api.ts`, these routes are also available:
- `GET /api/business/agents/:name` - Single agent detail
- `GET /api/business/agents/:name/sessions` - Agent sessions
- `POST /api/business/agents/:name/clear-sessions` - Clear sessions
- `GET /api/business/stats` - Phase 6 stats
- `GET /api/business/stats/:agentId` - Agent-specific stats
- `GET /api/business/contract-events` - Contract events
- `GET /api/business/locks` - Write locks
- `GET /api/business/colony` - Colony info
- `GET /api/business/colony/:appId` - App-specific colony info

## Recommendations

1. **Build Process**: The stale `dist/` issue indicates a need for better build synchronization. Consider:
   - Adding a pre-run check to ensure `dist/` is current
   - Using `tsc --watch` in development to auto-recompile
   - Adding a build step to the start script

2. **Health Check**: The health endpoint is working correctly and returns bot status.

3. **No Auth Required**: Business routes work without authentication (as intended for business operators), while admin routes would need the auth token if configured.

4. **All Tests Pass**: All 12 tested endpoints return 200 with valid JSON.
