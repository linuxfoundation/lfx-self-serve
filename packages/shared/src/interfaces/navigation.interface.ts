// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Signal, WritableSignal } from '@angular/core';
import type { Subject } from 'rxjs';

import type { Lens } from './lens.interface';

export type NavLens = Extract<Lens, 'foundation' | 'project'>;

export interface LensItem {
  uid: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isFoundation: boolean;
}

export interface LensItemsResponse {
  items: LensItem[];
  next_page_token: string | null;
  bypass_active: boolean;
  persona_fetch_failed: boolean;
  upstream_failed: boolean;
  lens: NavLens;
}

/** `reset=true` marks a fresh first page vs. an append emission. */
export interface LensPage {
  items: LensItem[];
  nextPageToken: string | null;
  bypassActive: boolean;
  personaFetchFailed: boolean;
  upstreamFailed: boolean;
  reset: boolean;
}

/** Carries the dispatch generation so stale responses can be filtered out of the merged stream. */
export interface TaggedLensPage {
  page: LensPage;
  generation: number;
}

export interface GetLensItemsParams {
  lens: NavLens;
  pageToken?: string;
  name?: string;
  /** Ensure this project UID is included in the first-page response even if it would otherwise fall outside it. */
  selectedUid?: string;
}

/** Upstream query-service params for lens-item lookups. */
export interface LensItemsQuery {
  type: 'project';
  /** AND — all terms must match (e.g. `['funding:Funded', 'funding_model:Membership']`). */
  filters: string[];
  /** OR — at least one term must match (e.g. `['stage:Active', 'stage:Formation - Engaged']`). Combined with `filters` via AND. */
  filters_or?: string[];
  sort: 'name_asc';
  page_token?: string;
  name?: string;
}

/** Internal per-lens reactive state container used by NavigationService. */
export interface LensState {
  searchTerm: WritableSignal<string>;
  items: Signal<LensItem[]>;
  loading: WritableSignal<boolean>;
  loaded: WritableSignal<boolean>;
  nextPageToken: WritableSignal<string | null>;
  hasMore: Signal<boolean>;
  bypassActive: WritableSignal<boolean>;
  personaFetchFailed: WritableSignal<boolean>;
  loadMore$: Subject<string>;
  reload$: Subject<void>;
  pendingDefaultSelection: WritableSignal<boolean>;
  /** Incremented on every reset; nextPage emissions tagged with the current value at dispatch. Stale pages are dropped. */
  generation: WritableSignal<number>;
}
