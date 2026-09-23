#!/usr/bin/env bash
# Overhaul v2 CI gate (V2-SPEC Part 1.2): the DELETE list is enforced by
# grep, not by review. Fails when any banned identifier or string survives
# in app/ or extensions/ source. Docs, migrations, node_modules and .git
# are out of scope on purpose (the spec itself names the banned strings).
set -euo pipefail

cd "$(dirname "$0")/.."

BANNED=(
  "OnboardingWizard"
  "LogicStep"
  "Not filled in"
  "Finish setup"
  "about your store"
  "store description"
  "brand keywords"
  "Generate my recommendation logic"
  "What do you want to achieve"
  "How did you hear about us"
  "templateVariant"
)

FAILED=0
for pattern in "${BANNED[@]}"; do
  # Pure comment lines are exempt: code is allowed to DOCUMENT a ban
  # ("no free-text \"about your store\" surface feeds generation") without
  # tripping it. Anything in live strings/JSX/identifiers still fails.
  hits=$(grep -rn --fixed-strings "$pattern" app extensions \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    --include='*.liquid' --include='*.json' --include='*.css' \
    2>/dev/null | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*|\{\/\*)' || true)
  if [ -n "$hits" ]; then
    echo "BANNED (v2 spec 1.2): \"$pattern\""
    echo "$hits"
    echo
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "check:v2 FAILED - remove the strings above (see docs/overhaul/V2-SPEC.md Part 1.2)."
  exit 1
fi
echo "check:v2 passed - no banned v2 identifiers or strings in app/ or extensions/."
