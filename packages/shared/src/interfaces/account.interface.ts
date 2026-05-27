// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Organization / account record used by persona detection, the org selector, and any org-scoped header. */
export interface Account {
  /** Salesforce account_id — primary join key */
  accountId: string;
  /** Organization display name */
  accountName: string;
  /** Crowd.dev organization id — Org-Lens enrichment, resolved from accountId in Snowflake */
  cdevOrgId?: string | null;
  /** URL-friendly slug derived from the account name — Org-Lens enrichment */
  accountSlug?: string | null;
  /** Logo URL for the organization — Org-Lens enrichment */
  logoUrl?: string | null;
  /** Highest active corporate membership tier display name (e.g. "Platinum Membership"). NULL/empty → no badge. */
  membershipTier?: string | null;
  /**
   * Canonical `b2b_org.uid` (UUID) from member-service. NULL for accounts that
   * haven't been resolved yet (legacy persona-seeded only) — callers needing
   * the uid MUST handle null by falling back to `OrgIdentityResolver`. Added by
   * spec 020-org-selector-integration to carry both identifiers per Q1.
   */
  uid?: string | null;
  /** Parent `b2b_org.uid`; NULL for top-level orgs. Populated from canonical record fetch. */
  parentUid?: string | null;
}
