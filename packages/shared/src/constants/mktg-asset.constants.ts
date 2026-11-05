// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Plugin DEVELOPER.md host lifecycle → LFX One vocabulary. `none` has no
 * asset; queued/drafting are generating, review/pending are draft. Approved
 * is used only for an approval recorded by the store, never an agent mode.
 */
export const MKTG_HOST_ASSET_STATES = {
  none: null,
  queued: 'generating',
  drafting: 'generating',
  review: 'draft',
  pending: 'draft',
  approved: 'approved',
} as const;

/** Shared note when no approved current is available to PDF/Slides. */
export const MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE = 'Approve a revision first — PDF and Slides use the approved current.';

/**
 * Empty state of the report's failed-sources list (the "Could not be read" card; on
 * the brand kit's Sources tab, "Failed sources"). It describes that list alone: the
 * notes beside it may still hold a source the agent could not reach.
 */
export const MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE = 'No source failed.';

/** The five lists of an approval's snapshot: what a report showed when a revision was approved, by stable key. */
export const MKTG_ACCEPTED_KEYS = ['sources_failed', 'missing_assets', 'warnings', 'gaps', 'color_conflicts'] as const;
