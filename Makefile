# unified-platform
# Build targets for backend (Node/TypeScript) + frontend (web/)

.PHONY: dev dev-backend dev-web build start reload test typecheck format format-check clean seed e2e help

PORT ?= 3100

dev: ## Start frontend + backend
	cd web && npm run dev & npx tsx src/index.ts

reload: ## Kill old server → build → restart (use after frontend changes)
	@lsof -ti :$(PORT) | xargs -r kill -9 2>/dev/null; true
	@sleep 1
	npx tsc && cd web && npm run build
	@echo "→ Starting server on :$(PORT)..."
	npx tsx src/index.ts &

dev-backend: ## Backend only
	npx tsx src/index.ts

dev-web: ## Frontend only
	cd web && npm run dev

build: ## Full build
	npx tsc && cd web && npm run build

start: ## Production start
	node dist/index.js

test: ## All tests
	npx vitest run && cd web && npx vitest run

typecheck: ## Type checking
	tsc --noEmit && cd web && npx tsc --noEmit

format: ## Format code
	prettier --write "src/**/*.ts" "web/src/**/*.{ts,tsx}"

format-check: ## Check formatting
	prettier --check "src/**/*.ts" "web/src/**/*.{ts,tsx}"

clean: ## Clean build artifacts
	rm -rf dist/ web/dist/

seed: ## Seed E2E test data
	node scripts/seed-e2e.mjs

e2e: ## Playwright E2E
	cd web && npx playwright test

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:' Makefile | cut -d: -f1
