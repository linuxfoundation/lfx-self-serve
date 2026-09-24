#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Flags real-looking organization data introduced by a change to test/fixture files.
# Test fixtures must use synthetic data: invented organizations and account ids from
# apps/lfx-one/e2e/fixtures/mock-data/synthetic-org.mock.ts, and reserved domains
# (acme-motors.example, user@example.com). Three checks run on each added line:
#   1. org name   — a known real organization name (hashed denylist below).
#   2. account id — a known real Salesforce-style account id (hashed denylist below).
#   3. domain     — an email address, or a quoted value assigned to `website` or to any field or
#                   constant whose name ends in "domain" (primaryDomain, SYNTHETIC_ORG_DOMAIN, ...),
#                   whose domain is not reserved.
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
# Exits 2 if the check cannot run (a failed git diff, scan or hash pass), so it never passes by default.

# A failed git diff anywhere in a pipeline must fail the check, not read as "nothing changed".
set -o pipefail

base_ref="${1:-}"

# The denylists below ARE the blocklist, sourced from incidents. Do not "scrub" them. Both hold only
# SHA-256 hashes, so this public file names no organization and pairs no id with one.
#
# Organization names: lowercase the name, keep only letters and digits, and drop a legal suffix
# (inc, llc, ...), then hash it — "Acme Motors, Inc." becomes "acmemotors":
#   printf '%s' 'acmemotors' | shasum -a 256
# Every run of one to three consecutive words in an added line is joined the same way and compared,
# so an entry for "acmemotors" catches "Acme Motors, Inc.", "acme-motors", "ACME_MOTORS" and
# "acmemotors.com" alike. Keep the legal suffix when the bare name is also a product or platform the
# app legitimately names in tests (an ad platform, a meeting tool), so the entry matches the
# organization without blocking every mention of the product.
denylisted_org_name_sha256=(
  7d3b5c83009fadf734c06eeecd7fbe256c69f71c8ba0429e4d7ad5f54b2e4097
  337b8d2c1e132acd75171f1acf0e73b20bc9541720d5003813f59ef0ad51f86f
  e4b42aa06408849925ab1aed0fbb50a93b3d844444eeca9792bc00067e4699fa
)

# Account ids, each in both its 18- and 15-character forms, since fixtures may carry either:
#   printf '%s' '<id>' | shasum -a 256
# Fixtures must take ids from apps/lfx-one/e2e/fixtures/mock-data/synthetic-org.mock.ts (invented
# ids of the same shape). The id SHAPE itself ("001" + 15 alphanumerics) cannot be blocked: the app
# validates that shape, so synthetic ids must satisfy it too.
denylisted_account_id_sha256=(
  c30821a431a63e0b446f294147f7e2421afac1f2a2a904eccf6f4d4478f6422d
  6baf1c8cd5e7798d33bd14e608c4d90d2eec126b2d35d319657bfcaa36c607ae
  319779b3921415fc933bc2026749925f2b5854d6e7a35fc2f72ab500baf225ac
  c4f52af51e918387ebad72930c16b622d5377a62294d2fa8fd4f561af9bd454b
  940b380e9e2857030d82c260701739b09eaf946b4f473e1db8ac4fc2393d5123
  8f16d01aa8c8d57485a1efb7018cb6e0d843a86ab9cb8ee282207a245af7b3c7
  2ab6bdcb735b28404e5ee128bfb0f3c6eae7b9c81713f79c5d0ccd04197bd371
  206cbec1997e35bc9a0a3ebc8260172fe54698221a8c1a0e45e8e44bd8ca7554
)

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

if ! all_changed_files=$(git diff "${diff_args[@]}" --name-only); then
  echo "❌ Fixture data check could not list changed files (git diff ${diff_args[*]} failed)." >&2
  exit 2
fi
changed_files=$(printf '%s\n' "${all_changed_files}" | grep -E '^apps/lfx-one/e2e/|\.(spec\.ts|fixture\.ts|ndjson)$')

if [ -z "${changed_files}" ]; then
  exit 0
fi

# Reads one file's -U0 diff and, for each added line, prints "<kind> ... <file>:<line>: <text>",
# where <line> is the line number in the new file: a "domain" hit, plus the "name-candidate" and
# "id-candidate" tokens the hash pass below checks. Portable across BSD awk, gawk and mawk (POSIX
# ERE only, no \b or interval expressions). Reserved domains are the TLDs .example, .test, .invalid
# and .localhost, and example.com/.org/.net, subdomains included.
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
  # Either a typed assignment (X_DOMAIN: string | null = '...') or a direct ":" / "=" before the quote.
  while (match(s, /(^|[^a-z0-9_])([a-z0-9_]*domain|website)["'`]?([ \t]*:[ \t]*[a-z0-9_ \t|<>.]+=|[ \t]*[:=])[ \t]*["'`][^"'`]*["'`]/)) {
    value = substr(s, RSTART, RLENGTH)
    s = substr(s, RSTART + RLENGTH)
    # Strip through the assignment's last ":" or "=" before the opening quote, so a type
    # annotation (X_DOMAIN: string | null = '...') or a quoted JSON key is not taken for the value.
    sub(/^.*[:=][ \t]*["'`]/, "", value)
    sub(/["'`]$/, "", value)
    sub(/^[a-z][a-z0-9+.-]*:\/\//, "", value)
    sub(/^\/\//, "", value)
    sub(/^[^@\/]*@/, "", value)
    sub(/[\/:?#].*$/, "", value)
    if (real_domain(value)) return 1
  }
  return 0
}
function print_name_candidates(s, where,    words, count, i, k, joined) {
  gsub(/[^a-z0-9]+/, " ", s)
  count = split(s, words, " ")
  for (i = 1; i <= count; i++) {
    joined = ""
    for (k = 0; k < 3 && i + k <= count; k++) {
      joined = joined words[i + k]
      print "name-candidate " joined " " where
    }
  }
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
  print_name_candidates(lower, where)
  print_id_candidates(text, where)
  if (has_real_email(lower) || has_real_domain_field(lower)) print "domain " where
  line++
}
AWK

# Hashes every candidate in one pass and keeps only denylisted ones; other lines pass through.
# Digest::SHA ships with Perl itself (it backs `shasum`), so no extra dependency is needed.
read -r -d '' hash_program <<'PERL'
use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
my %names = map { $_ => 1 } split ' ', ($ENV{ORG_NAME_HASHES} // '');
my %ids = map { $_ => 1 } split ' ', ($ENV{ACCOUNT_ID_HASHES} // '');
while (my $entry = <STDIN>) {
  chomp $entry;
  next if $entry eq '';
  if ($entry =~ /^name-candidate (\S+) (.*)$/) {
    print "org-name $2\n" if $names{ sha256_hex($1) };
  } elsif ($entry =~ /^id-candidate (\S+) (.*)$/) {
    my ($token, $where) = ($1, $2);
    for my $form (substr($token, 0, 18), substr($token, 0, 15)) {
      if ($ids{ sha256_hex($form) }) {
        print "account-id $where\n";
        last;
      }
    }
  } else {
    print "$entry\n";
  }
}
PERL

candidates=""

while IFS= read -r file; do
  [ -n "${file}" ] || continue
  # A scan that fails must fail the check, never pass it silently.
  if ! matches=$(git diff "${diff_args[@]}" -U0 -- "${file}" | SCAN_FILE="${file}" awk "${scan_program}"); then
    echo "❌ Fixture data check could not scan ${file}." >&2
    exit 2
  fi
  if [ -n "${matches}" ]; then
    candidates="${candidates}${matches}
"
  fi
done <<< "${changed_files}"

if ! violations=$(
  printf '%s' "${candidates}" |
    ORG_NAME_HASHES="${denylisted_org_name_sha256[*]}" ACCOUNT_ID_HASHES="${denylisted_account_id_sha256[*]}" perl -e "${hash_program}"
); then
  echo "❌ Fixture data check could not hash its candidates (perl with Digest::SHA is required)." >&2
  exit 2
fi

if [ -z "${violations}" ]; then
  exit 0
fi

print_group() {
  local hits
  hits=$(printf '%s\n' "${violations}" | sed -n "s/^$1 /  /p" | awk '!seen[$0]++')
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
