#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Flags emails from known real customer/vendor domains introduced by a change to test/fixture files.
# Test fixtures should use synthetic data (e.g. acme-motors.example, vendor-corp.example),
# never real customer or personal emails. Scoped to *added* lines only — the repo already has
# pre-existing, harmless placeholder domains (acme.io, x.org, corp.com, ...) that a whole-file
# scan would flag as false positives, and scanning the whole staged blob (rather than just what
# changed) would also permanently block any future edit to a file that happens to contain an
# old, already-fixed match elsewhere.
#
# Two modes:
#   Local pre-commit (no args): diffs the git index (git diff --cached) for staged fixture files.
#   CI (pass a base ref, e.g. "origin/main"): diffs that ref against HEAD — CI has no staged index.
#
# Add a domain here whenever a real-PII incident surfaces one (see GH-1674).
# Exits 0 if no denylisted domain appears in added lines.
# Exits 1 and prints the offending file:line matches otherwise.

base_ref="${1:-}"

# Intentionally real domains — these ARE the blocklist, sourced from incidents (GH-1674). Do not "scrub" them.
denylisted_domains=(
  toyota.com
  intel.com
  openai.com
  linuxfoundation.org
  contractor.linuxfoundation.org
)

denylist_pattern=$(printf '%s\n' "${denylisted_domains[@]}" | sed 's/\./\\./g' | paste -sd '|' -)

# -M detects renames (--diff-filter=ACMR still needs R explicit alongside it so a rename-with-edits,
# which git may classify as R rather than M, isn't skipped from the file list). Deliberately NOT
# passing -C (copy detection): a new fixture git considers a "copy" of an existing file is shown
# with only its edited lines as a diff hunk — any denylisted email copied unchanged would never
# appear as an added "+" line and would slip past the added-lines-only scan below. Without -C, a
# new file is classified as a plain add and its full content shows up as added lines instead.
if [ -n "${base_ref}" ]; then
  diff_args=(-M --diff-filter=ACMR "${base_ref}...HEAD")
else
  diff_args=(-M --diff-filter=ACMR --cached)
fi

changed_files=$(git diff "${diff_args[@]}" --name-only | grep -E '\.(spec\.ts|fixture\.ts|ndjson)$')

if [ -z "${changed_files}" ]; then
  exit 0
fi

violations=""

# Exact-domain match by design (covers @toyota.com, not @sub.toyota.com) — the denylist
# is seeded from specific incidents, not meant as a comprehensive domain blocklist.
# Only scans lines *added* by this change (unified diff "+" lines, header lines excluded) so
# pre-existing matches elsewhere in an untouched file never block an unrelated edit.
while IFS= read -r file; do
  [ -n "${file}" ] || continue
  matches=$(
    git diff "${diff_args[@]}" -U0 -- "${file}" |
      grep -E '^[+]' | grep -v '^[+][+][+]' |
      grep -Ein "@(${denylist_pattern})" |
      sed "s|^|${file}: |"
  )
  if [ -n "${matches}" ]; then
    violations="${violations}${matches}
"
  fi
done <<< "${changed_files}"

if [ -n "${violations}" ]; then
  echo "❌ Found email address(es) using a known real customer/vendor domain in added lines of test/fixture files:"
  echo "${violations}"
  echo ""
  echo "Test fixtures must use synthetic data, not real customer or personal emails."
  echo "Use a reserved example domain instead (e.g. acme-motors.example, vendor-corp.example)."
  exit 1
fi

exit 0
