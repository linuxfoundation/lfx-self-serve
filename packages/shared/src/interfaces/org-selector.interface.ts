// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Signal, WritableSignal } from '@angular/core';
import type { Subject } from 'rxjs';

/** Selector row — carries both the canonical UUID and the legacy Salesforce id per spec 020 Q1. */
export interface OrgItem {
  /** Canonical b2b_org identifier (UUID 8-4-4-4-12), sourced from `resource.id`. */
  uid: string;
  /** Legacy Salesforce account id from `resource.data.sfid`; spec 022 omits rows with null sfid (FR-005), so effectively non-null on the wire — kept nullable for pre-022 callers. */
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

/** Canonical org record returned by `GET /api/orgs/uid|sfid|:id` (member-service snake_case → camelCase). */
export interface OrgCanonicalRecord {
  uid: string;
  /** Legacy Salesforce id; null for orgs without an sfid. */
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
  /** b2b_org.uid of the parent; null for top-level orgs. */
  parentUid?: string | null;
  isMember: boolean;
}

/** Partial-update payload for `PUT /api/orgs/uid/:uid` (spec 021). Only changed fields are included. Excludes `name` (locked at UI) and `logoUrl` (deferred). */
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

/** Response shape for `GET /api/orgs/uid/:uid/addresses` (spec 023). Snowflake `ORG_LENS_ADDRESSES`; BFF returns 200 with nulls on lookup misses. */
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

/** Shape of `b2b_org_settings.data` from the query-service "what can I see" pattern. */
export interface B2bOrgSettingsDoc {
  writers?: {
    username?: string | null;
    /** Spec 022 — only `accepted` invites count as grants (D-002, FR-002). */
    invite_status?: 'pending' | 'accepted' | 'revoked';
  }[];
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

/** Resolver return shape — carries the resolved value AND an honest cacheHit flag so callers can log accurate cache-hit ratios. */
export type OrgIdentityLookupResult<K extends 'uid' | 'sfid'> = {
  [P in K]: string | null;
} & { cacheHit: boolean };

/** Per-row caller role persona (spec 022 D-005 + FR-011a). The four variants are pairwise disjoint per uid; `direct-*` rows get the Edit button, `inherited-*` rows get a tooltip-only disclosure. */
export type OrgRolePersona = 'direct-writer' | 'direct-auditor' | 'inherited-writer' | 'inherited-auditor';

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

/** NATS response body for UUID→SFID resolution requests. */
export interface UuidToSfidNatsResponse {
  sfid?: string;
  error?: string;
}
