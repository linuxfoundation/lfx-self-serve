// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * sessionStorage key for the merged `WriterSummary` produced by `WriterGrantsService`'s
 * deferred full sweep (LFXV2-2857). Written once the idle-triggered sweep resolves; read back
 * on the next bootstrap in the same tab session so a repeat page load gets the widened
 * foundation/project booleans immediately, without re-paying the slow unscoped sweep — and so
 * the sweep runs at most once per session (its presence is the "already ran" guard).
 */
export const WRITER_GRANTS_SESSION_CACHE_KEY = 'lfx-writer-grants-summary';
