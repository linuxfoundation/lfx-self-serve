// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const MKTG_FAMILY_WRITE_REQUIRED = 'You need write access to this project to run its agents';
/**
 * One-off pages opt into last-input restoration only once they support it.
 * Member 360 has no intake fields: its sole input is the project carried by the plain route.
 * LinkedIn prefill is phase 2, pending the one-off landing integration; keep its existing plain route meanwhile.
 */
export const MKTG_FAMILY_ONE_OFF_RUN_MODES: Readonly<Record<string, 'new' | null>> = {};
