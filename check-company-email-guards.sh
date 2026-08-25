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

set -uo pipefail

search_roots=(apps/lfx-one/src apps/lfx-one/e2e packages/shared/src)

# Filter out this script's own doc comments if it ever lands under a search root.
scan() {
  grep -REn "$1" "${search_roots[@]}" 2>/dev/null || true
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

context_hits=$(scan 'company-emails.*context\.email|context\.email.*company-emails')
if [ -n "${context_hits}" ]; then
  echo "❌ PersonDrawerContext.email is being used as a company-address lookup key:"
  echo "${context_hits}"
  echo ""
  echo "That field is display-only. Use context.personKey or context.username for the lookup."
  status=1
fi

exit "${status}"
