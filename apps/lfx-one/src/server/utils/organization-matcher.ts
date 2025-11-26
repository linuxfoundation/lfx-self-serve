// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACCOUNTS } from '@lfx-one/shared/constants';

import type { Account } from '@lfx-one/shared/interfaces';

/**
 * Normalizes an organization name for comparison
 * Removes common suffixes, converts to lowercase, and trims whitespace
 */
function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/,?\s*(inc\.?|ltd\.?|llc\.?|corp\.?|corporation|limited|incorporated)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches organization names from committee memberships to the predefined ACCOUNTS list
 * Uses fuzzy matching to handle variations in organization names
 *
 * @param organizationNames - Array of organization names from committee memberships
 * @returns Array of matched Account objects from the ACCOUNTS constant
 */
export function matchOrganizationNamesToAccounts(organizationNames: string[]): Account[] {
  if (!organizationNames || organizationNames.length === 0) {
    return [];
  }

  const matchedAccounts: Account[] = [];
  const normalizedInputNames = organizationNames.map(normalizeOrgName);

  for (const account of ACCOUNTS) {
    const normalizedAccountName = normalizeOrgName(account.accountName);

    // Check for exact match or if one contains the other
    const isMatch = normalizedInputNames.some(
      (inputName) => normalizedAccountName === inputName || normalizedAccountName.includes(inputName) || inputName.includes(normalizedAccountName)
    );

    if (isMatch) {
      matchedAccounts.push(account);
    }
  }

  return matchedAccounts;
}
