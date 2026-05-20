// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Account entity representing an organization in the LFX One Org Lens.
 * Used by the org-selector and any header/badge that needs the org's
 * display attributes.
 */
export interface Account {
  /** Salesforce account_id — primary join key */
  accountId: string;
  /** Organization display name */
  accountName: string;
  /** Crowd.dev organization id — secondary identifier, mapped from accountId in Snowflake */
  cdevOrgId?: string;
  /** URL-friendly slug derived from the account name */
  accountSlug?: string;
  /** Logo URL for the organization */
  logoUrl?: string;
  /** Highest active corporate membership tier display name (e.g. "Platinum Membership"). NULL/empty → no badge. */
  membershipTier?: string;
}
