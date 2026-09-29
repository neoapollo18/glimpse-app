#!/usr/bin/env bash
# Overhaul CI gate (V2-SPEC Part 1.2 + V3-CONTRACTS §12): the DELETE list
# is enforced by grep, not by review. Fails when any banned identifier or
# string survives in app/ or extensions/ source. Docs, migrations, scripts,
# node_modules and .git are out of scope on purpose (the spec itself names
# the banned strings).
set -euo pipefail

cd "$(dirname "$0")/.."

# Literal strings (matched with --fixed-strings).
BANNED_FIXED=(
  # v2 (Part 1.2)
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
  # v3 (V3-CONTRACTS §12 / V3-SPEC Part 1). "OnboardingStep" is in the
  # regex list (word-start anchored) so the DB helper updateOnboardingStep
  # in supabase.server.ts - kept on purpose - doesn't trip it.
  "What you can do with Gleame"
  "Sync catalog"
  "Skip for now"
  "Open Quiz Studio"
  "Tell Gleame about your store"
  "No quiz here yet"
  "Start with a blank question"
  "Change template"
  "Blank = default"
  "TplSalon"
  "TplStudio"
  "TplGuide"
  "TplPop"
  "Offer ends"
  "countdown"
)

# Regular expressions (POSIX ERE, matched with -E).
BANNED_REGEX=(
  "(^|[^A-Za-z])OnboardingStep"
  "Step [0-9] of 5"
  "Only [0-9]+ left"
)

INCLUDES=(--include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx'
          --include='*.liquid' --include='*.json' --include='*.css')

# Pure comment lines are exempt: code is allowed to DOCUMENT a ban
# ("no free-text \"about your store\" surface feeds generation") without
# tripping it. Anything in live strings/JSX/identifiers still fails.
# NOTE: no "#" exemption on purpose - CSS "#id {}" rules and JS private
# fields start with "#" and must not hide a banned literal.
COMMENT_LINE='^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*|<!--)'

FAILED=0
report() {
  local kind="$1" pattern="$2" hits="$3"
  if [ -n "$hits" ]; then
    echo "BANNED ($kind): \"$pattern\""
    echo "$hits"
    echo
    FAILED=1
  fi
}

for pattern in "${BANNED_FIXED[@]}"; do
  hits=$(grep -rn --fixed-strings "$pattern" app extensions "${INCLUDES[@]}" 2>/dev/null \
    | grep -Ev "$COMMENT_LINE" || true)
  report "fixed" "$pattern" "$hits"
done

for pattern in "${BANNED_REGEX[@]}"; do
  hits=$(grep -rnE "$pattern" app extensions "${INCLUDES[@]}" 2>/dev/null \
    | grep -Ev "$COMMENT_LINE" || true)
  report "regex" "$pattern" "$hits"
done

if [ "$FAILED" -ne 0 ]; then
  echo "check:v2 FAILED - remove the strings above (docs/overhaul/V2-SPEC.md Part 1.2, V3-CONTRACTS.md §12)."
  exit 1
fi
echo "check:v2 passed - no banned v2/v3 identifiers or strings in app/ or extensions/."
