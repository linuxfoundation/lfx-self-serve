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
   * Canonical `b2b_org.uid` (UUID) from member-service. Spec 024 (uuid-only): this is the primary
   * org identifier — it is persisted in the `lfx-selected-account` cookie and sent to every
   * `/api/orgs/:orgUid/lens/*` route. NULL only for not-yet-resolved persona-seeded accounts on a
   * fresh load; the canonical-by-uid fetch hydrates display fields once a uid is present.
   */
  uid?: string | null;
  /** Parent `b2b_org.uid`; NULL for top-level orgs. Populated from canonical record fetch. */
  parentUid?: string | null;
}
