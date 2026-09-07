#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Guards the Org Lens company-address panel (LFXV2-3296) against two regressions, scanning the whole
# tree (any occurrence is a reintroduction) and exiting 1 with file:line on violation:
#
# 1. No fabricated or demo-derived company addresses — every address must come from the warehouse.
# 2. No email address is ever a lookup key. Address→addresses is an enumeration primitive over
#    personal data, and address→person is known to link unrelated people. Reads are identity-keyed
#    (personKey or LF username) only; `PersonDrawerContext.email` is display-only.

set -euo pipefail

search_roots=(apps/lfx-one/src apps/lfx-one/e2e packages/shared/src)

scan() {
  grep -REn "$1" "${search_roots[@]}" || {
    local scan_status=$?
    # grep uses 1 for an ordinary no-match result; higher statuses are scanner failures.
    [ "${scan_status}" -eq 1 ] || return "${scan_status}"
  }
}

# Check 3 is a relationship between two tokens (a company-emails URL and `context.email`) that are
# normally on different lines, so each file is read whole and the tokens are matched within a
# character window. awk rather than grep: BSD grep caps bounded repetition at 255, so a `{0,400}`
# window silently fails to compile on macOS and the check would pass vacuously. Heuristic tripwire,
# deliberately generous — a false negative ships a personal-data enumeration primitive.
scan_multiline() {
  find "${search_roots[@]}" -type f \( -name '*.ts' -o -name '*.html' -o -name '*.js' \) |
    while IFS= read -r file; do
      awk -v FILE="${file}" -v WINDOW=400 '
        # Strip line comments so a doc comment mentioning both tokens is not a violation.
        { line = $0; sub(/\/\/.*$/, "", line); body = body " " line }
        END {
          gsub(/[ \t\r\n]+/, " ", body)
          lower = tolower(body)
          # Advance to the earlier of the two token matches so a camelCase hit is not skipped.
          start = 1
          while (start <= length(lower)) {
            rest = substr(lower, start)
            i_dash = index(rest, "company-emails")
            i_camel = index(rest, "companyemails")
            if (i_dash == 0 && i_camel == 0) break
            if (i_dash == 0) i = i_camel
            else if (i_camel == 0) i = i_dash
            else i = (i_dash < i_camel) ? i_dash : i_camel
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
      ' "${file}" || return "$?"
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
