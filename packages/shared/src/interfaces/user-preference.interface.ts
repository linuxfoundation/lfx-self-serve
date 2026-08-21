// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Per-user preference contracts (LFXV2-3002 Block 0) — Angular `UserPreferenceStore<T>` config/state plus the BFF wire types for `/api/social-listening/preferences/:name`. */

import type { DestroyRef, Injector } from '@angular/core';

/** Store cancellation/cache key. `userId` is client-side only — the BFF resolves identity from the session token. */
export interface PreferenceContext {
  userId: string;
  projectId: string;
}

export interface UserPreferenceState<T> {
  data: T;
  loading: boolean;
  readOnly: boolean;
  /** Last load failure (commit failures surface via `onError` + rollback instead). */
  error: unknown;
}

export interface ParseResult<T> {
  data: T;
  /** Mark the store read-only when the persisted value cannot round-trip safely (e.g. unknown schema version). */
  readOnly?: boolean;
}

/** Promise-based BFF transport keyed by preference name — the store wraps calls in `from()`. */
export interface UserPreferenceTransport {
  get(name: string): Promise<string | null>;
  put(name: string, value: string): Promise<unknown>;
  delete(name: string): Promise<unknown>;
}

export interface UserPreferenceStoreConfig<T> {
  transport: UserPreferenceTransport;
  destroyRef: DestroyRef;
  injector: Injector;
  /** SSR gate — when false the store never touches the transport (load idles, commits no-op). */
  isBrowser: boolean;
  preferenceName: (projectId: string) => string;
  initial: () => T;
  parse: (raw: string) => ParseResult<T>;
  serialize: (data: T) => string;
  /** Delete the preference row instead of saving an empty payload (e.g. when the last saved view is removed). */
  shouldDeleteOnEmpty?: (data: T) => boolean;
  /** Fired once after each successful load. `null` means the preference did not exist for this context. */
  onLoaded?: (result: ParseResult<T> | null) => void;
  /** Fired when the load HTTP fails; `state.error` has already been set when this runs. */
  onLoadError?: (err: unknown) => void;
  /** Fired when the context actually changes (post-`distinctUntilChanged`). Use to reset host-owned ephemeral flags. */
  onContextChange?: (ctx: PreferenceContext | null) => void;
}

export interface UserPreferenceCommitArgs<T> {
  next: T;
  /** When false, state updates only after the HTTP write succeeds. Defaults to true. */
  optimistic?: boolean;
  /** Recomputes the write payload against current state at dequeue time, so a queued commit never serializes a snapshot that still contains a since-rolled-back mutation. */
  rebase?: (current: T) => T;
  /** Defaults to restoring the pre-commit snapshot only when no later optimistic update changed state. */
  rollback?: () => void;
  onSuccess?: () => void;
  onError?: () => void;
}

/** Internal queue item for the store's `concatMap` commit pipeline (exported — repo rule: no interfaces in `apps/lfx-one`). */
export interface UserPreferenceQueuedCommit<T> {
  ctx: PreferenceContext;
  next: T;
  /** See `UserPreferenceCommitArgs.rebase`. */
  rebase?: (current: T) => T;
  optimistic: boolean;
  rollback: () => void;
  onSuccess?: () => void;
  onError?: () => void;
}

export interface PreferenceReadResponse {
  name: string;
  value: string | null;
}

export interface PreferenceUpsertRequest {
  value: string;
}
