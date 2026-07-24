// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Signal, WritableSignal } from '@angular/core';
import type { Subject } from 'rxjs';

/** Selector row. Spec 002: the org account id (18-char SFID) is the canonical identifier; `uid` and `accountId` both carry it. */
export interface OrgItem {
  /** Org account id (18-char SFID), sourced from the indexed `b2b_org` doc id. */
  uid: string;
  /** Org account id (18-char SFID); equals `uid`. Kept nullable for pre-spec-002 callers. */
  accountId: string | null;
  /** Display name; query-service strips nameless orgs so always non-empty in practice. */
  name: string;
  /** Logo URL; null when no logo configured. */
  logoUrl: string | null;
  /** Optional primary web domain (e.g. "redhat.com"). */
  primaryDomain?: string | null;
  /** LF member-org flag when the indexed doc exposes it. */
  isMember?: boolean;
  /** Spec 022 — populated only for inherited (cascading) rows; the parent org's display name, used to render the dropdown tooltip. */
  parentName?: string | null;
  /**
   * LFXV2-2750 — role source carried on the row itself. Populated only for `foundation-auditor` rows, which are
   * resolved per-search (they are not part of the cached grants resolution, so the client cannot look them up in
   * a uid set). Absent for grants-derived rows, whose persona is resolved from the role-grants sets.
   */
  roleSource?: OrgRolePersona;
}

/** Row projection with role-decoration + selection metadata resolved once per render. */
export interface DisplayOrgItem {
  item: OrgItem;
  isSelected: boolean;
  roleLabel: string;
  roleIcon: string;
  /** Spec 022 — non-empty only for inherited rows; rendered as a PrimeNG `pTooltip` on the role badge (Clarifications Q2). */
  roleTooltip: string;
}

/** Wire shape returned by `GET /api/nav/org-items` per `contracts/bff-org-items.md`. */
export interface OrgItemsResponse {
  items: OrgItem[];
  /** Null when no more pages remain. */
  next_page_token: string | null;
  /** True only on the deterministic-empty failure response (FR-005); false even when items is `[]` on a real-empty page. */
  upstream_failed: boolean;
  /** Optional total when upstream returns it cheaply; clients tolerate null. */
  total?: number | null;
}

/** BFF → query-service shape built by `OrgNavigationService.buildQuery`. */
export interface OrgItemsQuery {
  type: 'b2b_org';
  /** Set only when caller passed a non-whitespace `name`. */
  name?: string;
  /** Set only on continuation requests. */
  page_token?: string;
  /** `best_match` when name is set; `name_asc` otherwise. */
  sort: 'name_asc' | 'best_match';
  /** Always present (possibly empty); FGA is enforced upstream without explicit filters. */
  filters: string[];
  /** Used by the `selected_uid` injection second-call path. */
  filters_or?: string[];
}

/** Internal getter param shape used by `OrgNavigationService.getOrgItems`. */
export interface GetOrgItemsParams {
  pageToken?: string;
  name?: string;
  /** Pin a uid at the top of the first page when it falls outside the natural results. Mutually exclusive with `pageToken`. */
  selectedUid?: string;
}

/** Spec 022 — cascading-grant entry; each item carries the direct-granted parent it inherits from. */
export interface CascadingRoleGrant {
  /** Child org's uid (the inherited grant target). */
  uid: string;
  /** Direct-granted parent org's uid that propagates the role. */
  parentUid: string;
  /** Parent org's display name, used for the dropdown tooltip ("View-only access inherited from {parentName}"). */
  parentName: string;
}

/** Wire shape returned by `GET /api/orgs/me/role-grants` — writers/auditors are disjoint (writer-wins). */
export interface RoleGrantsResponse {
  /** Direct writer-role `b2b_org.uid` values (`writers[].username === caller && invite_status === 'accepted'`); disjoint from auditors/cascading sets and drives the Profile `canEdit` direct-only gate (FR-011a). */
  writers: string[];
  /** `b2b_org.uid` values where caller has direct `auditor` AND is NOT a direct writer on the same org. */
  auditors: string[];
  /** Spec 022 — uids inherited via a direct-granted parent (`data.is_parent === true`); each carries `parentUid` + `parentName` for the tooltip and is disjoint from `writers` (D-005, direct wins on tie). */
  cascadingWriters: CascadingRoleGrant[];
  /** Spec 022 — analogous to `cascadingWriters` for the auditor role. Disjoint from `auditors`. */
  cascadingAuditors: CascadingRoleGrant[];
  /** Caller's resolved username (from JWT). */
  username: string;
  /** Server-side load timestamp (ISO 8601 UTC). */
  loaded_at: string;
}

/** Canonical org record returned by `GET /api/orgs/:accountId` (member-service snake_case → camelCase). Spec 002: keyed by the org account id (18-char SFID). */
export interface OrgCanonicalRecord {
  /** Org account id (18-char SFID); equals `accountId`. */
  uid: string;
  /** Org account id (18-char SFID); equals `uid`. Nullable only for defensive callers. */
  accountId: string | null;
  name: string;
  description?: string | null;
  website?: string | null;
  primaryDomain?: string | null;
  logoUrl?: string | null;
  industry?: string | null;
  sector?: string | null;
  numberOfEmployees?: number | null;
  /** Crunchbase profile URL (spec 021). */
  crunchBaseUrl?: string | null;
  /** Last-modified timestamp from upstream (ISO 8601 UTC); displayed as "Last Updated" on the profile page (spec 021). */
  updatedAt?: string | null;
  /** Parent org account id (18-char SFID); null for top-level orgs. */
  parentUid?: string | null;
  isMember: boolean;
}

/** Partial-update payload for `PUT /api/orgs/:accountId` (spec 021/002, account-id keyed). Only changed fields are included. Excludes `name` (locked at UI) and `logoUrl` (deferred). */
export interface OrgUpdateRequest {
  description?: string;
  website?: string;
  industry?: string;
  sector?: string;
  crunchBaseUrl?: string;
  numberOfEmployees?: number | null;
}

/** Snake_case body for member-service `PUT /b2b_orgs/{uid}` — mirrors upstream Goa `B2BOrgUpdateBody` (spec 021). */
export interface MemberServiceB2bOrgUpdateBody {
  description?: string;
  website?: string;
  industry?: string;
  sector?: string;
  crunch_base_url?: string;
  number_of_employees?: number | null;
}

/** Editable form fields for the Org Profile edit view — drives dirty-check + validation (spec 021). */
export interface OrgProfileEditableFields {
  description: string;
  website: string;
  numberOfEmployees: number | null;
  crunchBaseUrl: string;
  industry: string;
  sector: string;
}

/** Single physical address (spec 021). */
export interface OrgAddress {
  line1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
}

/** Response shape for `GET /api/orgs/:accountId/addresses` (spec 023/002, account-id keyed). Snowflake `ORG_LENS_ADDRESSES`; BFF returns 200 with nulls on lookup misses. */
export interface OrgAddressesResponse {
  primaryAddress: OrgAddress | null;
  billingAddress: OrgAddress | null;
}

/** Snowflake row shape returned by `ORG_LENS_ADDRESSES` lookups. */
export interface OrgLensAddressesWarehouseRow {
  BILLING_STREET: string | null;
  BILLING_CITY: string | null;
  BILLING_STATE: string | null;
  BILLING_POSTAL_CODE: string | null;
  BILLING_COUNTRY: string | null;
  SHIPPING_STREET: string | null;
  SHIPPING_CITY: string | null;
  SHIPPING_STATE: string | null;
  SHIPPING_POSTAL_CODE: string | null;
  SHIPPING_COUNTRY: string | null;
}

/** Internal page result used by the client `OrgNavigationService` reactive pipeline. `reset=true` marks a fresh first page. */
export interface OrgListPage {
  items: OrgItem[];
  nextPageToken: string | null;
  upstreamFailed: boolean;
  reset: boolean;
}

/** Carries dispatch generation so stale responses can be filtered out of the merged stream (FR-011 race-guard). */
export interface TaggedOrgListPage {
  page: OrgListPage;
  generation: number;
}

/** Client-side reactive state container — single-state since orgs are a flat universe (no foundation/project bifurcation). */
export interface OrgListState {
  searchTerm: WritableSignal<string>;
  items: Signal<OrgItem[]>;
  loading: WritableSignal<boolean>;
  loaded: WritableSignal<boolean>;
  nextPageToken: WritableSignal<string | null>;
  hasMore: Signal<boolean>;
  pendingDefaultSelection: WritableSignal<boolean>;
  /** Incremented on every reset; nextPage emissions tagged with the value at dispatch. */
  generation: WritableSignal<number>;
  loadMore$: Subject<string>;
  reload$: Subject<void>;
}

/** Shape of `b2b_org.data` from the query-service indexed document — only fields the selector reads. */
export interface B2bOrgIndexedDoc {
  sfid?: string | null;
  name?: string;
  logo_url?: string | null;
  primary_domain?: string | null;
  is_member?: boolean;
  /** Spec 022 — true when this org has child orgs in the b2b_org index. Drives cascading-children lookup per D-004. */
  is_parent?: boolean;
}

/** One accepted-or-pending member entry in the flattened `members[]` indexer view (member-service `b2bOrgMemberView`). */
export interface B2bOrgSettingsMember {
  username?: string | null;
  /** `writer` wins when a user holds both roles (member-service dedupes writer-first). */
  role?: 'writer' | 'auditor';
  /** Only `accepted` invites count as grants (D-002, FR-002). Revoked/expired are excluded from the index entirely. */
  invite_status?: 'pending' | 'accepted' | 'revoked' | 'expired';
}

/**
 * Shape of `b2b_org_settings.data` from the query-service "what can I see" pattern.
 *
 * The member-service indexer flattens writers+auditors into a single `members[]` array
 * with a `role` discriminator (see `b2bOrgSettingsIndexerView` in messaging.go). The legacy
 * `writers[]`/`auditors[]` fields are kept for backward compatibility with any docs that
 * have not yet been re-indexed.
 */
export interface B2bOrgSettingsDoc {
  /** Current indexer shape — flattened members with a `role` discriminator. */
  members?: B2bOrgSettingsMember[];
  /** @deprecated Legacy pre-flatten shape; read as a fallback only. */
  writers?: {
    username?: string | null;
    /** Spec 022 — only `accepted` invites count as grants (D-002, FR-002). */
    invite_status?: 'pending' | 'accepted' | 'revoked';
  }[];
  /** @deprecated Legacy pre-flatten shape; read as a fallback only. */
  auditors?: {
    username?: string | null;
    /** Spec 022 — only `accepted` invites count as grants (D-002, FR-002). */
    invite_status?: 'pending' | 'accepted' | 'revoked';
  }[];
}

/** Raw response from member-service `GET /b2b_orgs/{uid}` (snake_case; BFF transforms to camelCase). */
export interface MemberServiceB2bOrgResponse {
  uid: string;
  sfid?: string | null;
  name: string;
  description?: string | null;
  website?: string | null;
  primary_domain?: string | null;
  logo_url?: string | null;
  industry?: string | null;
  sector?: string | null;
  number_of_employees?: number | null;
  /** Crunchbase URL on the upstream record (spec 021). */
  crunch_base_url?: string | null;
  /** Upstream last-modified timestamp (spec 021). */
  updated_at?: string | null;
  parent_uid?: string | null;
  is_member?: boolean;
}

/**
 * Per-row caller role persona (spec 022 D-005 + FR-011a). The variants are pairwise disjoint per uid;
 * `direct-*` rows get the Edit (pen) affordance, `inherited-*` rows get a tooltip-only disclosure, and
 * `foundation-auditor` rows (LFXV2-2750) are view-only member orgs surfaced because the caller holds the
 * FGA `auditor` relation on the org's foundation — always rendered with the eye (never the pen).
 */
export type OrgRolePersona = 'direct-writer' | 'direct-auditor' | 'inherited-writer' | 'inherited-auditor' | 'foundation-auditor';

/** Resolved per-uid role with source qualifier and the parent uid it inherits from (cascading rows only) — spec 022 D-005. Crossed-service payload between `OrgRoleGrantsService` and `OrgNavigationService`. */
export interface ResolvedOrgRole {
  roleSource: OrgRolePersona;
  /** Direct-granted parent's uid; present only on inherited rows. */
  parentUid?: string;
  /** Direct-granted parent's display name; present only on inherited rows. */
  parentName?: string;
}

/** Cross-service payload — the resolved access-aware map plus the org-details lookup needed to materialise wire rows. */
export interface AccessAwareOrgsResult {
  /** Per-uid resolved role; iteration order matches insertion (direct first, then cascading per parent). */
  resolved: Map<string, ResolvedOrgRole>;
  /** uid → b2b_org indexed doc; covers both direct grants and cascading children. */
  orgDocByUid: Map<string, B2bOrgIndexedDoc>;
  /** True when any upstream dependency failed while building the access-aware set. */
  upstreamFailed: boolean;
  /** ISO 8601 UTC timestamp set when this resolution started; surfaces in `RoleGrantsResponse.loaded_at`. */
  loadedAt: string;
  /** Caller's resolved username (echoed back through `RoleGrantsResponse.username`). */
  username: string;
}

/** Serializable form of `AccessAwareOrgsResult` for the shared cache — Maps stored as ordered entry arrays. */
export interface AccessAwareOrgsCacheEntry {
  resolved: [string, ResolvedOrgRole][];
  orgDocByUid: [string, B2bOrgIndexedDoc][];
  upstreamFailed: boolean;
  loadedAt: string;
  username: string;
}

/** LFXV2-2750 — a foundation (project) the caller holds the FGA `auditor` relation on. */
export interface AuditedFoundation {
  /** Project uid — interpolated into the `project:<uid>#auditor` access-check tuple. */
  uid: string;
  /** Project slug — interpolated into the `project_slug:` project_membership data filter. */
  slug: string;
}

/** LFXV2-2750 — a member org of an audited foundation, resolved by the search-driven lookup. */
export interface FoundationAuditorOrgEntry {
  /** b2b_org uid (18-char SFID). */
  uid: string;
  /** b2b_org indexed display doc (name/logo/domain). */
  doc: B2bOrgIndexedDoc;
}

/** LFXV2-2750 — result of appending foundation-auditor member orgs to the grants-derived selector rows. */
export interface AppendFoundationAuditorItemsResult {
  /** Grants-derived rows followed by the appended view-only `foundation-auditor` rows. */
  items: OrgItem[];
  /** True when the cap was reached and one or more foundation-auditor rows were dropped. */
  truncated: boolean;
  /** Number of `foundation-auditor` rows actually appended. */
  addedCount: number;
}
