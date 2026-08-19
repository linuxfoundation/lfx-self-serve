#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Flags emails from known real customer/vendor domains in staged test/fixture files.
# Test fixtures should use synthetic data (e.g. acme-motors.example, vendor-corp.example),
# never real customer or personal emails. Scoped to staged files only — the repo already
# has many pre-existing, harmless placeholder domains (acme.io, x.org, corp.com, ...) that
# an allowlist-based whole-repo scan would flag as false positives.
#
# Add a domain here whenever a real-PII incident surfaces one (see GH-1674).
# Exits 0 if no denylisted domain appears in staged changes.
# Exits 1 and prints the offending file:line matches otherwise.

denylisted_domains=(
  toyota.com
  intel.com
  openai.com
)

staged_files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(spec\.ts|fixture\.ts|ndjson)$')

if [ -z "${staged_files}" ]; then
  exit 0
fi

denylist_pattern=$(printf '%s\n' "${denylisted_domains[@]}" | sed 's/\./\\./g' | paste -sd '|' -)
violations=""

for file in ${staged_files}; do
  matches=$(git show ":${file}" | grep -Ein "@(${denylist_pattern})" | sed "s|^|${file}:|")
  if [ -n "${matches}" ]; then
    violations="${violations}${matches}
"
  fi
done

if [ -n "${violations}" ]; then
  echo "❌ Found email address(es) using a known real customer/vendor domain in staged test/fixture files:"
  echo "${violations}"
  echo ""
  echo "Test fixtures must use synthetic data, not real customer or personal emails."
  echo "Use a reserved example domain instead (e.g. acme-motors.example, vendor-corp.example)."
  exit 1
fi

exit 0
