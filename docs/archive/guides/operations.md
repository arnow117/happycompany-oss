# Operations Guide

> Operational procedures — how to run, deploy, and manage the project.
> For architecture constraints, see `/CLAUDE.md`.

## PM2 Process Management

`ecosystem.config.cjs` defines two modes, each binds port 3100:

| Mode | Start command | Runtime | File watch |
|------|--------------|---------|------------|
| production | `pm2 start ecosystem.config.cjs --only happycompany` | `node dist/index.js` (requires build) | none |
| dev | `pm2 start ecosystem.config.cjs --only happycompany-dev` | `tsx src/index.ts` (runs TS directly) | `src/` auto-restart |

```bash
# Switch modes
pm2 stop happycompany && pm2 start ecosystem.config.cjs --only happycompany-dev

# Common commands
pm2 logs happycompany --lines 20   # View logs
pm2 monit                           # Monitor CPU/memory
pm2 restart happycompany            # Restart
pm2 stop happycompany               # Stop
pm2 delete happycompany             # Remove from PM2 list
```

## Deploy

```bash
# 1. Backend TypeScript check
cd happycompany && npx tsc --noEmit

# 2. Frontend build (must run from web/ directory)
cd happycompany/web && npm run build

# 3. PM2 restart (pick one mode)
pm2 restart happycompany       # production mode
# or
pm2 restart happycompany-dev   # dev mode
```

**Notes:**
- Frontend changes only take effect on 3100 after rebuild + backend restart. Backend serves `web/dist/` static files from memory.
- Confirm port 3100 is free before restarting: `kill $(lsof -i :3100 -t)`

## Startup

Recommended for daily development: PM2 for backend + Vite for frontend, two terminals.

```bash
# Terminal 1: Backend (pick one)
pm2 start ecosystem.config.cjs --only happycompany-dev   # dev mode, auto-restart on TS changes
# pm2 start ecosystem.config.cjs --only happycompany     # production mode, requires build

# Terminal 2: Frontend HMR
cd happycompany/web && npm run dev
# Browse http://localhost:8888 (debug UI, readable errors)
# Verify http://localhost:3100 (production effect, minified)

# Tests
cd happycompany && npx vitest run
```
