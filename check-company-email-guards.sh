#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Guards two properties of the Org Lens company-address panel (LFXV2-3296). Both are the kind of
# regression that reads as harmless in a diff, which is why they are enforced rather than reviewed.
#
# 1. The fabricated-address demo stays deleted. It invented sibling addresses by appending `.co.uk`
#    and `.jp` to a person's domain and rendered them identically to fact, so an administrator
#    troubleshooting a real identity problem was shown addresses that had never existed.
#
# 2. No email address is ever a lookup key. An interface that takes an address and returns the other
#    addresses the same human holds is an enumeration primitive over personal data, sitting on a read
#    path that does not yet enforce the organization relation. Resolving a person *from* an address is
#    separately prohibited: that direction is known to link unrelated people.
#
# `PersonDrawerContext.email` is deliberately retained for display, which is exactly why check 2
# exists — the field is a standing invitation to wire it back into a fetch.
#
# Whole-tree scan (not added-lines-only, unlike check-fixture-emails.sh): these symbols are absent
# today, so any occurrence anywhere is a reintroduction. Exits 1 and prints file:line on violation.
#
# Checks 1 and 2 match single symbols, so a line-at-a-time grep is sufficient. Check 3 matches a
# RELATIONSHIP between two tokens that will normally be written on different lines, so it slurps
# each file instead — see scan_multiline.

set -uo pipefail

search_roots=(apps/lfx-one/src apps/lfx-one/e2e packages/shared/src)

# Filter out this script's own doc comments if it ever lands under a search root.
scan() {
  grep -REn "$1" "${search_roots[@]}" 2>/dev/null || true
}

# Check 3 cannot be a line-at-a-time grep. The prohibited shape is a company-emails URL and
# `context.email` reaching the same fetch, and nothing makes an author write that on one line:
#
#     const url = `/api/org/company-emails`;
#     const res = await fetch(url, { params: { email: context.email } });
#
# A `grep -E` alternation sees two innocent lines. So each file is read whole and the two tokens
# are looked for within a bounded character window of each other — close enough to be the same
# expression or statement group, far enough to survive ordinary formatting and a Prettier break.
#
# Implemented in awk rather than grep: BSD grep caps bounded repetition at 255, so a `{0,400}`
# window silently fails to compile on macOS and the check passes vacuously while appearing to run.
# awk behaves identically on BSD and GNU.
#
# This is a heuristic, not a type-checker: it is the tripwire for an accidental reintroduction,
# while the model contract and the DR are what make the rule binding. The window is deliberately
# generous, since a false positive here is a two-minute conversation and a false negative is a
# personal-data enumeration primitive shipped to production.
scan_multiline() {
  find "${search_roots[@]}" -type f \( -name '*.ts' -o -name '*.html' -o -name '*.js' \) 2>/dev/null |
    while IFS= read -r file; do
      awk -v FILE="${file}" -v WINDOW=400 '
        # Strip line comments so a doc comment mentioning both tokens is not a violation.
        { line = $0; sub(/\/\/.*$/, "", line); body = body " " line }
        END {
          # Collapse runs of whitespace so the window measures code, not indentation.
          gsub(/[ \t\r\n]+/, " ", body)
          lower = tolower(body)
          # Walk every company-emails occurrence and look for context.email nearby on either side.
          start = 1
          while ((i = index(substr(lower, start), "company-emails")) > 0 ||
                 (i = index(substr(lower, start), "companyemails")) > 0) {
            pos = start + i - 1
            from = pos - WINDOW; if (from < 1) from = 1
            near = substr(lower, from, WINDOW * 2)
            if (index(near, "context.email") > 0) {
              printf "%s: company-emails lookup and context.email appear within %d characters\n", FILE, WINDOW
              exit
            }
            start = pos + 1
          }
        }
      ' "${file}"
    done
}

status=0

demo_hits=$(scan 'deriveDemoCompanyEmails|PERSONAL_EMAIL_DOMAINS|ACADEMIC_EMAIL_DOMAIN_PATTERN|TEMP-DEMO')
if [ -n "${demo_hits}" ]; then
  echo "❌ The fabricated company-address demo has been reintroduced:"
  echo "${demo_hits}"
  echo ""
  echo "Company addresses must come from ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS."
  echo "No address may be synthesized, inferred, or derived from another address."
  status=1
fi

lookup_hits=$(scan 'getCompanyEmailsByEmail|assertEmailBody|OrgLensCompanyEmailsResponse')
if [ -n "${lookup_hits}" ]; then
  echo "❌ An address-keyed company-emails lookup has been reintroduced:"
  echo "${lookup_hits}"
  echo ""
  echo "Retrieve company addresses by person identity (personKey or LF username), never by address."
  status=1
fi

context_hits=$(scan_multiline)
if [ -n "${context_hits}" ]; then
  echo "❌ PersonDrawerContext.email is being used as a company-address lookup key:"
  echo "${context_hits}"
  echo ""
  echo "That field is display-only. Use context.personKey or context.username for the lookup."
  status=1
fi

exit "${status}"
