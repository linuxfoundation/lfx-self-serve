#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Guards the Org Lens company-address panel (LFXV2-3296) against two regressions, scanning the whole
# tree (any occurrence is a reintroduction) and exiting 1 with file:line on violation:
#
# 1. No fabricated or demo-derived company addresses — every address must come from the warehouse.
# 2. No email address is ever a lookup key. Address→addresses is an enumeration primitive over
#    personal data, and address→person is known to link unrelated people. Reads are identity-keyed
#    (personKey or LF username) only; `PersonDrawerContext` carries no email field.

set -euo pipefail

search_roots=(apps/lfx-one/src apps/lfx-one/e2e packages/shared/src)

scan() {
  grep -REn "$1" "${search_roots[@]}" || {
    local scan_status=$?
    # grep uses 1 for an ordinary no-match result; higher statuses are scanner failures.
    [ "${scan_status}" -eq 1 ] || return "${scan_status}"
  }
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

exit "${status}"
