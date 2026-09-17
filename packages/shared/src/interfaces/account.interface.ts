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
  /** URL-friendly slug derived from the account name — Org-Lens **display** enrichment (Snowflake). Never URL identity: it is generated, has no search tag, and is `''` during switch/enrichment windows. Use `slug` for `/org/{segment}/…` (spec 050, DR-001). */
  accountSlug?: string | null;
  /** Lowercase URL-identity slug from member-service (`Account.Slug__c` → indexed `b2b_org.data.slug`). Null when the org has none — the address then uses `uid`. Sourced only from `OrgItem.slug` / the canonical record; never from Snowflake (spec 050, DR-001). */
  slug?: string | null;
  /** Logo URL for the organization — Org-Lens enrichment */
  logoUrl?: string | null;
  /** Highest active corporate membership tier display name (e.g. "Platinum Membership"). NULL/empty → no badge. */
  membershipTier?: string | null;
  /** Org account id (18-char SFID) from member-service — the primary org identifier (spec 002). Persisted in the `lfx-selected-account` cookie and sent to every `/api/orgs/:orgUid/lens/*` route. NULL only for not-yet-resolved persona seeds on a fresh load; the canonical fetch hydrates display fields once it is present. */
  uid?: string | null;
  /** Parent org account id (SFID); NULL for top-level orgs. Populated from canonical record fetch. */
  parentUid?: string | null;
}
