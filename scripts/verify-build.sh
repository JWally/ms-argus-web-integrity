#!/usr/bin/env bash
# Verify that minification hasn't silently removed critical detection logic.
#
# Some test patterns in query-lies.ts rely on side effects (like throwing)
# from expressions that static analyzers might incorrectly classify as dead code.
# This script checks the minified bundle for the presence of those patterns.

set -euo pipefail

BUNDLE="dist/argus.esm.min.js"

if [ ! -f "$BUNDLE" ]; then
  echo "ERROR: $BUNDLE not found — run build first" >&2
  exit 1
fi

fail=0

check() {
  local desc="$1"
  local pattern="$2"
  if grep -qE "$pattern" "$BUNDLE"; then
    echo "  ✓ $desc"
  else
    echo "  ✗ MISSING: $desc  (pattern: $pattern)" >&2
    fail=1
  fi
}

echo "Verifying minified bundle: $BUNDLE"
echo ""

# Test 6: class extends — must use new(class extends fn)() not a bare class declaration
# A bare `class Fake extends fn {}` gets removed by Terser as an unused binding.
check "class extends (Terser-safe form)" "new \(?class extends [a-zA-Z]+"

# Tests 20-24: proxy detection section exists
# NOTE: Terser renames proxy1/proxy2/proxy3 to single-char vars — check lie type strings instead
check "proxy detection: chain cycle test" "failed at chain cycle error"
check "proxy detection: proto recursion test" "failed at too much recursion __proto__ error"
check "proxy detection: reflect set proto test" "failed at reflect set proto"

# Sanity: lie type strings present
check "lie type strings" "failed class extends error"
check "instanceof check string" "failed at instanceof check error"

# Sanity: phantom iframe creation preserved
check "shadow DOM phantom iframe" "attachShadow"

echo ""
if [ $fail -ne 0 ]; then
  echo "Build verification FAILED — minification removed critical detection code." >&2
  exit 1
else
  echo "Build verification passed."
fi
