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
  /**
   * Lowercase URL-identity slug derived by member-service from the org name (spec 050, DR-007:
   * `slugify(Account.Name)`, no stored slug). Tri-state: a string when published; `null` when the
   * name yields none (the address then uses `uid`); `undefined` when not known yet — persona seeds
   * and the cookie-restored stub carry no slug until an indexed row — the org item or the resolver
   * answer — supplies it, and those are the only writers (spec 050: URL identity is the index's;
   * the canonical record never sets, unsets or overwrites it, since addresses resolve against the
   * index). Readers must not collapse `undefined` into `null`. Never sourced from Snowflake.
   */
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
