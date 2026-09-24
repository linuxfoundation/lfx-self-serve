#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Flags real-looking organization data introduced by a change to test/fixture files.
# Test fixtures must use synthetic data: invented organizations and account ids from
# apps/lfx-one/e2e/fixtures/mock-data/synthetic-org.mock.ts, and reserved domains
# (acme-motors.example, user@example.com). Three checks run on each added line:
#   1. org name   — a known real organization name (denylist below, case-insensitive).
#   2. account id — a known real Salesforce-style account id (hashed denylist below, exact match).
#   3. domain     — an email address, or a quoted value assigned to any field or constant whose name
#                   ends in "domain" (primaryDomain, emailDomain, SYNTHETIC_ORG_DOMAIN, ...), whose
#                   domain is not reserved.
#
# Scanned files: every file under apps/lfx-one/e2e/ (specs, helpers, mock data) plus any
# *.spec.ts, *.fixture.ts or *.ndjson file elsewhere.
#
# Scoped to *added* lines only — the repo already has pre-existing, harmless placeholder domains
# (acme.io, x.org, corp.com, ...) that a whole-file scan would flag as false positives, and scanning
# the whole staged blob (rather than just what changed) would also permanently block any future edit
# to a file that happens to contain an old match elsewhere. Editing a line that holds one of those
# placeholders does flag it; switch it to a reserved domain in the same change.
#
# Two modes:
#   Local pre-commit (no args): diffs the git index (git diff --cached) for staged fixture files.
#   CI (pass a base ref, e.g. "origin/main"): diffs that ref against HEAD — CI has no staged index.
#
# Exits 0 if no added line trips a check.
# Exits 1 and prints the offending file:line matches, grouped by check, otherwise.

base_ref="${1:-}"

# Intentionally real organization names — these ARE the blocklist, sourced from incidents. Do not
# "scrub" them. Add one whenever an incident surfaces a real organization in test data. Matched
# case-insensitively on word boundaries; a space in an entry also matches a hyphen, an underscore
# or nothing, so an entry "Acme Motors" would catch "Acme Motors, Inc.", "acme-motors", "ACME_MOTORS" and "acmemotors.com".
denylisted_org_names=(
  'Red Hat'
  'Toyota'
)

# SHA-256 of known real account ids — these ARE the blocklist, sourced from incidents. Do not
# "scrub" them. Stored as hashes so this public file doesn't pair an id with an organization. Each
# id is listed in both its 18- and 15-character forms, since fixtures may carry either. To add one:
#   printf '%s' '<id>' | shasum -a 256
# Fixtures must take ids from apps/lfx-one/e2e/fixtures/mock-data/synthetic-org.mock.ts (invented
# ids of the same shape). The id SHAPE itself ("001" + 15 alphanumerics) cannot be blocked: the app
# validates that shape, so synthetic ids must satisfy it too.
denylisted_account_id_sha256=(
  c30821a431a63e0b446f294147f7e2421afac1f2a2a904eccf6f4d4478f6422d
  6baf1c8cd5e7798d33bd14e608c4d90d2eec126b2d35d319657bfcaa36c607ae
)

# Lowercase each name, escape every POSIX ERE metacharacter so an entry always matches literally,
# let a space match [ _-] or nothing, then join as alternatives.
org_name_pattern=$(printf '%s\n' "${denylisted_org_names[@]}" | tr '[:upper:]' '[:lower:]' | sed -e 's/[][\.^$*+?(){}|]/\\&/g' -e 's/ /[ _-]?/g' | paste -sd '|' -)

sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  else
    printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  fi
}

# True when a candidate token (an id-shaped string of 15+ characters) starts with a denylisted id in
# its 18- or 15-character form.
denylisted_account_id() {
  local form hash known
  for form in "${1:0:18}" "${1:0:15}"; do
    hash=$(sha256_hex "${form}")
    for known in "${denylisted_account_id_sha256[@]}"; do
      if [ "${hash}" = "${known}" ]; then
        return 0
      fi
    done
  done
  return 1
}

# -M detects renames (--diff-filter=ACMR still needs R explicit alongside it so a rename-with-edits,
# which git may classify as R rather than M, isn't skipped from the file list). Deliberately NOT
# passing -C (copy detection): a new fixture git considers a "copy" of an existing file is shown
# with only its edited lines as a diff hunk — any denylisted value copied unchanged would never
# appear as an added "+" line and would slip past the added-lines-only scan below. Without -C, a
# new file is classified as a plain add and its full content shows up as added lines instead.
if [ -n "${base_ref}" ]; then
  diff_args=(-M --diff-filter=ACMR "${base_ref}...HEAD")
else
  diff_args=(-M --diff-filter=ACMR --cached)
fi

changed_files=$(git diff "${diff_args[@]}" --name-only | grep -E '^apps/lfx-one/e2e/|\.(spec\.ts|fixture\.ts|ndjson)$')

if [ -z "${changed_files}" ]; then
  exit 0
fi

# Reads one file's -U0 diff and prints "<check> <file>:<line>: <text>" for each added line that trips
# a check, where <line> is the line number in the new file. Portable across BSD awk, gawk and mawk
# (POSIX ERE only, no \b or interval expressions). Reserved domains are the TLDs .example, .test,
# .invalid and .localhost, and example.com/.org/.net, subdomains included. Website fields are not
# checked: they usually hold public project or service sites, not organization data.
read -r -d '' scan_program <<'AWK'
function reserved(host) {
  return host ~ /(^|\.)(example|test|invalid|localhost)$/ || host ~ /(^|\.)example\.(com|org|net)$/
}
function real_domain(host) {
  return host ~ /\.[a-z][a-z0-9-]+$/ && !reserved(host)
}
function has_real_email(s,    domain, before) {
  while (match(s, /@[a-z0-9-]+(\.[a-z0-9-]+)+/)) {
    before = RSTART > 1 ? substr(s, RSTART - 1, 1) : ""
    domain = substr(s, RSTART + 1, RLENGTH - 1)
    if (before ~ /[a-z0-9._%+}-]/ && real_domain(domain)) return 1
    s = substr(s, RSTART + RLENGTH)
  }
  return 0
}
function has_real_domain_field(s,    value) {
  while (match(s, /(^|[^a-z0-9_])[a-z0-9_]*domain["'`]?([ \t]*:[ \t]*string)?[ \t]*[:=][ \t]*["'`][^"'`]*["'`]/)) {
    value = substr(s, RSTART, RLENGTH)
    s = substr(s, RSTART + RLENGTH)
    # Strip through the assignment's last ":" or "=" before the opening quote, so a type
    # annotation (X_DOMAIN: string = '...') or a quoted JSON key is not taken for the value.
    sub(/^.*[:=][ \t]*["'`]/, "", value)
    sub(/["'`]$/, "", value)
    sub(/^[a-z][a-z0-9+.-]*:\/\//, "", value)
    sub(/^[^@\/]*@/, "", value)
    sub(/[\/:?#].*$/, "", value)
    if (real_domain(value)) return 1
  }
  return 0
}
function print_id_candidates(s, where,    before, token) {
  while (match(s, /001[A-Za-z0-9]+/)) {
    before = RSTART > 1 ? substr(s, RSTART - 1, 1) : ""
    token = substr(s, RSTART, RLENGTH)
    s = substr(s, RSTART + RLENGTH)
    if (before !~ /[A-Za-z0-9]/ && length(token) >= 15) print "id-candidate " token " " where
  }
}
BEGIN {
  file = ENVIRON["SCAN_FILE"]
  if (ENVIRON["ORG_NAME_PATTERN"] != "") name_re = "(^|[^a-z0-9])(" ENVIRON["ORG_NAME_PATTERN"] ")($|[^a-z0-9])"
}
/^@@ / {
  start = $0
  sub(/^@@ -[0-9,]+ \+/, "", start)
  sub(/[ ,].*$/, "", start)
  line = start + 0
  in_hunk = 1
  next
}
in_hunk && /^\+/ {
  text = substr($0, 2)
  lower = tolower(text)
  shown = text
  sub(/^[ \t]+/, "", shown)
  where = file ":" line ": " shown
  if (name_re != "" && lower ~ name_re) print "org-name " where
  print_id_candidates(text, where)
  if (has_real_email(lower) || has_real_domain_field(lower)) print "domain " where
  line++
}
AWK

violations=""

while IFS= read -r file; do
  [ -n "${file}" ] || continue
  # A scan that fails (a malformed pattern, say) must fail the check, never pass it silently.
  if ! matches=$(
    git diff "${diff_args[@]}" -U0 -- "${file}" |
      SCAN_FILE="${file}" ORG_NAME_PATTERN="${org_name_pattern}" awk "${scan_program}"
  ); then
    echo "❌ Fixture data check could not scan ${file}." >&2
    exit 2
  fi
  if [ -n "${matches}" ]; then
    violations="${violations}${matches}
"
  fi
done <<< "${changed_files}"

# The awk pass prints id-shaped tokens as candidates; keep only those whose hash is denylisted.
resolved=""
while IFS= read -r entry; do
  case "${entry}" in
    '') ;;
    'id-candidate '*)
      rest=${entry#id-candidate }
      if denylisted_account_id "${rest%% *}"; then
        resolved="${resolved}account-id ${rest#* }
"
      fi
      ;;
    *)
      resolved="${resolved}${entry}
"
      ;;
  esac
done <<< "${violations}"
violations="${resolved}"

if [ -z "${violations}" ]; then
  exit 0
fi

print_group() {
  local hits
  hits=$(printf '%s' "${violations}" | sed -n "s/^$1 /  /p" | awk '!seen[$0]++')
  if [ -n "${hits}" ]; then
    echo ""
    echo "$2"
    echo "${hits}"
  fi
}

echo "❌ Found real-looking organization data in added lines of test/fixture files:"
print_group org-name "Known real organization name:"
print_group account-id "Known real account id:"
print_group domain "Non-reserved domain in an email address or organization-domain field:"
echo ""
echo "Test fixtures must use synthetic data, not real customer, organization or personal data."
echo "Take organization names and account ids from apps/lfx-one/e2e/fixtures/mock-data/synthetic-org.mock.ts."
echo "Use a reserved domain for emails and organization domains (e.g. acme-motors.example, user@example.com)."
exit 1
