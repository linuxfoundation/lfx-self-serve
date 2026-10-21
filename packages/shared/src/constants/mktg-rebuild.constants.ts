// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentAgentKey } from '../interfaces/mktg-document-store.interface';

/** Deliberately bounded dependency graph; one-off outputs are never rebuild candidates. */
export const MKTG_REBUILD_DOWNSTREAM_KEYS: readonly MktgDocumentAgentKey[] = ['boilerplates', 'faq', 'brand-kit'];
export const MKTG_REBUILD_API_PATH = '/api/mktg-agents/rebuild';
export const MKTG_REBUILD_NAVIGATION_STATE_KEY = 'mktgRebuild';
export const MKTG_REBUILD_KEY_PREFIX = 'rebuilds';
export const MKTG_GENERATION_PROVENANCE_KEY_PREFIX = 'generation-provenance';
export const MKTG_REBUILD_CHAIN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MKTG_REBUILD_TTL_MS = 24 * 60 * 60 * 1000;
export const MKTG_REBUILD_UPSTREAM_METADATA_KEY = 'upstream-framework';
export const MKTG_REBUILD_UPSTREAM_SIDECAR_KEY = 'upstreamFramework';
export const MKTG_REBUILD_STEP_LABELS = {
  queued: 'Waiting',
  running: 'Drafting',
  questions: 'Needs your answers',
  draft: 'New Draft — ready to review',
  failed: 'Stopped',
} as const;
