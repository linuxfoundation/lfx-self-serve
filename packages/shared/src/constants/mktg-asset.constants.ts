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
 * Empty state of the report's "Could not be read" list. It describes that list
 * alone: the notes beside it may still hold a source the agent could not reach.
 */
export const MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE = 'No source failed.';

/**
 * The approve dialog's header: `gaps` when the viewed report has a source that
 * could not be read or an open gap (what "Approve anyway" accepts); `review`
 * when it has only what the reviewer should see before approving (a Brand
 * Kit's colour conflicts or LF-reference rules).
 */
export const MKTG_ASSET_APPROVE_DIALOG_HEADERS = {
  gaps: 'Approve with open gaps?',
  review: 'Approve this version?',
} as const;
