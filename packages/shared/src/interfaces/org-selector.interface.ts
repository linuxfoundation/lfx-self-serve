// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Signal, WritableSignal } from '@angular/core';
import type { Subject } from 'rxjs';

/** Selector row — carries both the canonical UUID and the legacy Salesforce id per spec 020 Q1. */
export interface OrgItem {
  /** Canonical b2b_org identifier (UUID 8-4-4-4-12), sourced from `resource.id`. */
  uid: string;
  /** Legacy Salesforce account id from `resource.data.sfid`; null for orgs never registered with Salesforce. */
  accountId: string | null;
  /** Display name; query-service strips nameless orgs so always non-empty in practice. */
  name: string;
  /** Logo URL; null when no logo configured. */
  logoUrl: string | null;
  /** Optional primary web domain (e.g. "redhat.com"). */
  primaryDomain?: string | null;
  /** LF member-org flag when the indexed doc exposes it. */
  isMember?: boolean;
}

/** Row projection with role-decoration + selection metadata resolved once per render. */
export interface DisplayOrgItem {
  item: OrgItem;
  isSelected: boolean;
  roleLabel: string;
  roleIcon: string;
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

/** Wire shape returned by `GET /api/orgs/me/role-grants` — writers/auditors are disjoint (writer-wins). */
export interface RoleGrantsResponse {
  /** `b2b_org.uid` values where caller has the `writer` role. */
  writers: string[];
  /** `b2b_org.uid` values where caller has `auditor` AND is NOT a writer on the same org. */
  auditors: string[];
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

/** Optional per-uid enrichment in org-selector.mock.json `canonicalExtras` (spec 020/021). */
export type OrgCanonicalMockExtras = Partial<
  Pick<OrgCanonicalRecord, 'description' | 'website' | 'industry' | 'sector' | 'numberOfEmployees' | 'crunchBaseUrl' | 'updatedAt' | 'parentUid'>
>;

/** Single physical address (spec 021). */
export interface OrgAddress {
  line1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
}

/** Response shape for `GET /api/orgs/uid/:uid/addresses` (spec 021). Mock-backed in v1; future-ready for member-service integration. */
export interface OrgAddressesResponse {
  primaryAddress: OrgAddress | null;
  billingAddress: OrgAddress | null;
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
}

/** Shape of `b2b_org_settings.data` from the query-service "what can I see" pattern. */
export interface B2bOrgSettingsDoc {
  writers?: { username?: string | null }[];
  auditors?: { username?: string | null }[];
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

/** Per-row caller role persona. Writer wins when caller holds both — server-side flattening keeps writers/auditors disjoint. */
export type OrgRolePersona = 'writer' | 'auditor';
