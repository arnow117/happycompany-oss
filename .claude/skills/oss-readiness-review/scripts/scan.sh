#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

echo "# OSS / Enterprise Readiness Scan"
echo
echo "Project: $(basename "$(pwd)")"
echo "Date: $(date +%Y-%m-%d)"
echo

echo "## Git State"
git status --short || true
echo

echo "## Public Metadata"
for file in README.md LICENSE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md package.json; do
  if [ -e "$file" ]; then
    echo "- $file: present"
  else
    echo "- $file: missing"
  fi
done
echo

echo "## Tenant Boundary"
if [ -f .gitignore ]; then
  echo "- .gitignore tenant entries:"
  rg -n "corp|tenant|data/|config\\.json|\\.db" .gitignore || true
else
  echo "- .gitignore: missing"
fi
echo

echo "## Suspicious Public Strings"
SUSPICIOUS_OUTPUT="$(
rg -n "(/Users/|acme|acme-happycompany|corp/acme|\\.\\./corp|client_secret|appsecret|apiKey[\"']?\\s*:|secret[\"']?\\s*:|password[\"']?\\s*:)" \
  --glob '!node_modules/**' \
  --glob '!web/dist/**' \
  --glob '!dist/**' \
  --glob '!data/**' \
  --glob '!docs/archive/**' \
  --glob '!docs/superpowers/**' \
  --glob '!outputs/**' \
  --glob '!docs/reports/**' \
  --glob '!*.db' \
  . || true
)"
if [ -n "$SUSPICIOUS_OUTPUT" ]; then
  printf '%s\n' "$SUSPICIOUS_OUTPUT" | sed -n '1,160p'
  TOTAL_LINES="$(printf '%s\n' "$SUSPICIOUS_OUTPUT" | wc -l | tr -d ' ')"
  if [ "$TOTAL_LINES" -gt 160 ]; then
    echo "... truncated: $((TOTAL_LINES - 160)) more suspicious-string matches"
  fi
else
  echo "- none"
fi
echo "- note: generic identifiers such as tenant, corpDir, and token are intentionally not reported here."
echo

echo "## Source Quality Signals"
if [ -d src ]; then
  echo "- largest source files:"
  find src web/src -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null \
    -exec wc -l {} \; | sort -rn | head -20
  echo
  echo "- production any usage:"
  rg -n ":\s*any\b|\bas\s+any\b" src web/src \
    --glob '*.ts' \
    --glob '*.tsx' \
    --glob '!*.test.*' || true
  echo
  echo "- production console usage:"
  rg -n "console\\.(log|debug|info|warn|error)" src web/src \
    --glob '*.ts' \
    --glob '*.tsx' \
    --glob '!*.test.*' || true
fi
echo

echo "## Test and CI Signals"
find . -maxdepth 3 \( -name "*.test.*" -o -name "*.spec.*" \) \
  -not -path "./node_modules/*" \
  -not -path "./web/node_modules/*" | wc -l | awk '{print "- test files: "$1}'
if [ -d .github/workflows ]; then
  find .github/workflows -maxdepth 1 -type f | sort | sed 's/^/- workflow: /'
else
  echo "- workflows: missing"
fi
echo

echo "## Suggested Next Step"
echo "Classify suspicious strings as demo-ok, config-needed, or leak; fix P0/P1 before broader cleanup."
