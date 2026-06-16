#!/usr/bin/env bash
# consistency-check.sh — Verify codebase health against CLAUDE.md constraints
# Usage: bash scripts/consistency-check.sh
cd "$(cd "$(dirname "$0")" && pwd)/.."
set -uo pipefail

PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" -eq 0 ]; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "# Consistency Check — $(date +%Y-%m-%d)"
echo ""

# X1: No `any` types in source
echo "## Prohibitions"
any_count=$(grep -rn ':\s*any\b' src/ --include='*.ts' 2>/dev/null | grep -v '\.test\.' | wc -l | tr -d ' ')
check "X1: Zero \`any\` in source (found: $any_count)" "$([ "$any_count" -eq 0 ] && echo 0 || echo 1)"

# X3: No direct Anthropic SDK calls in routes (header strings are OK)
anthropic_in_routes=$(grep -rn '@anthropic-ai\|from.*anthropic' src/routes/ --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
check "X3: No Anthropic SDK in routes (found: $anthropic_in_routes)" "$([ "$anthropic_in_routes" -eq 0 ] && echo 0 || echo 1)"

# X4: No direct orchestrator imports from outside
orch_imports=$(grep -rn "from.*['\"].*orchestrator/" src/ --include='*.ts' 2>/dev/null | grep -v 'orchestrator/' | grep -v '\.test\.' | grep -v 'index\.ts' | grep -v 'business-api\.ts' | wc -l | tr -d ' ')
check "X4: No external orchestrator imports (found: $orch_imports)" "$([ "$orch_imports" -eq 0 ] && echo 0 || echo 1)"

echo ""
echo "## Code Quality"

# No console.log
console_count=$(grep -rn 'console\.log' src/ --include='*.ts' 2>/dev/null | grep -v '\.test\.' | wc -l | tr -d ' ')
check "No console.log in source (found: $console_count)" "$([ "$console_count" -eq 0 ] && echo 0 || echo 1)"

# Files > 800 lines
oversize=$(find src/ \( -name "*.ts" \) -exec wc -l {} \; 2>/dev/null | sort -rn | awk '$1 > 800 {print $2" ("$1" lines)"}')
if [ -z "$oversize" ]; then
  check "All files under 800 lines" 0
else
  echo "  ⚠️  Files >800 lines (advisory):"
  echo "$oversize" | sed 's/^/    /'
  PASS=$((PASS + 1))
fi

# TypeScript strict mode
check "TypeScript strict mode enabled" "$([ "$(grep -c '"strict": true' tsconfig.json 2>/dev/null || echo 0)" -gt 0 ] && echo 0 || echo 1)"

echo ""
echo "## AI Context Health"

# CLAUDE.md exists
check "Root CLAUDE.md exists" "$([ -f CLAUDE.md ] && echo 0 || echo 1)"

# AGENTS.md is symlink
if [ -L AGENTS.md ]; then
  check "AGENTS.md is symlink to CLAUDE.md" 0
else
  check "AGENTS.md is symlink to CLAUDE.md" 1
fi

# Domain CLAUDE.md files
check "src/CLAUDE.md exists" "$([ -f src/CLAUDE.md ] && echo 0 || echo 1)"
check "web/CLAUDE.md exists" "$([ -f web/CLAUDE.md ] && echo 0 || echo 1)"

# .claudeignore
check ".claudeignore exists" "$([ -f .claudeignore ] && echo 0 || echo 1)"

# Key docs exist
check "Architecture overview exists" "$([ -f docs/specs/2026-05-21-architecture-overview.md ] && echo 0 || echo 1)"

echo ""
echo "## Summary"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ FAIL"
  exit 1
else
  echo "  Status: ✅ PASS"
fi
