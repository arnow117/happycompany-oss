#!/usr/bin/env bash
# consistency-check.sh — Verify codebase health against CLAUDE.md constraints
set -uo pipefail

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@"; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "# Consistency Check — $(date +%Y-%m-%d)"
echo ""

echo "## Prohibitions"
any_count=$(grep -rn ':\s*any\b' src/ --include='*.ts' 2>/dev/null | grep -v '\.test\.' | wc -l | tr -d ' ')
check "X1: Zero any in source (found: $any_count)" test "$any_count" -eq 0

anthropic_in_routes=$(grep -rn 'anthropic\|@anthropic-ai' src/routes/ --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
check "X3: No Anthropic SDK in routes (found: $anthropic_in_routes)" test "$anthropic_in_routes" -eq 0

orch_imports=$(grep -rn "from.*['\"].*orchestrator/" src/ --include='*.ts' 2>/dev/null | grep -v 'orchestrator/' | grep -v '\.test\.' | grep -v 'index\.ts' | grep -v 'business-api\.ts' | wc -l | tr -d ' ')
check "X4: No external orchestrator imports (found: $orch_imports)" test "$orch_imports" -eq 0

echo ""
echo "## Code Quality"

console_count=$(grep -rn 'console\.log' src/ --include='*.ts' 2>/dev/null | grep -v '\.test\.' | wc -l | tr -d ' ')
check "No console.log in source (found: $console_count)" test "$console_count" -eq 0

oversize=$(find src/ \( -name "*.ts" \) -exec wc -l {} \; 2>/dev/null | sort -rn | awk '$1 > 800 {print $2" ("$1" lines)"}')
if [ -z "$oversize" ]; then
  check "All files under 800 lines" true
else
  echo "  ⚠️  Files >800 lines:"
  echo "$oversize" | sed 's/^/    /'
  FAIL=$((FAIL + 1))
  PASS=$((PASS + 1))
fi

strict=$(grep -c '"strict": true' tsconfig.json 2>/dev/null || echo 0)
check "TypeScript strict mode enabled" test "$strict" -gt 0

echo ""
echo "## AI Context Health"

check "Root CLAUDE.md exists" test -f CLAUDE.md

if [ -L AGENTS.md ]; then
  check "AGENTS.md is symlink to CLAUDE.md" true
else
  check "AGENTS.md is symlink to CLAUDE.md" false
fi

check "src/CLAUDE.md exists" test -f src/CLAUDE.md
check "web/CLAUDE.md exists" test -f web/CLAUDE.md
check ".claudeignore exists" test -f .claudeignore
check "Architecture overview exists" test -f docs/specs/2026-05-21-architecture-overview.md

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
