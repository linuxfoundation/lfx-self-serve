// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Individual Dashboard → LFX soft-migration banner (LFXV2-3336 / ID-1139).
 *
 * These constants back the "Still need Individual Dashboard?" return link + reason-capture modal
 * on the LFX (self-serve) side, and define the shared analytics contract so the LFX-side and
 * ID-side Datadog RUM actions join into one migration funnel (keyed by the authenticated LFID
 * already set via `datadogRum.setUser`).
 */

/**
 * In-code feature gate for the return link/modal. Flip to `false` (or delete the guarded block)
 * to retire the link once Individual Dashboard is fully sunset — no LaunchDarkly flag is used
 * here by design (per LFXV2-3336 decision).
 */
export const ID_MIGRATION_RETURN_LINK_ENABLED = true;

/**
 * Shared funnel tag stamped on every migration RUM action on both apps, so the LFX-side and
 * ID-side events can be correlated into a single migration funnel report.
 */
export const ID_MIGRATION_FUNNEL = 'id_lfx_migration';

/** `source_app` property value for RUM actions emitted from LFX (self-serve). */
export const ID_MIGRATION_SOURCE_APP = 'lfx';

/**
 * Datadog RUM custom action names emitted on the LFX side.
 * - `LINK_CLICK` — user clicked the return link (modal opened); no reason attached.
 * - `CONTINUE` — user clicked "Continue" (reason + optional comment attached, then navigates).
 *   "Stay here" emits nothing (per ticket: don't conflate "opened the modal" with "actually left").
 */
export const ID_MIGRATION_EVENTS = {
  LINK_CLICK: 'migration_id_link_click',
  CONTINUE: 'migration_id_continue',
} as const;

/** Single-select reason options for the return modal (value persisted on the CONTINUE action). */
export const ID_MIGRATION_REASONS = [
  { label: 'Missing a feature', value: 'missing_feature' },
  { label: 'Prefer the old layout', value: 'prefer_old_layout' },
  { label: "Something's broken here", value: 'something_broken' },
  { label: 'Other', value: 'other' },
] as const;
