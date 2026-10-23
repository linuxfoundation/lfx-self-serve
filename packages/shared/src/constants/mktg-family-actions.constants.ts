// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_NEW_MODE } from './mktg-last-intake.constants';

export const MKTG_FAMILY_WRITE_REQUIRED = 'You need write access to this project to run its agents';
/**
 * One-off pages opt into last-input restoration only once they support it.
 * Member 360 has no intake fields: its sole input is the project carried by the plain route.
 * LinkedIn restores registered source scalars; uploads still require reattachment.
 */
export const MKTG_FAMILY_ONE_OFF_RUN_MODES: Readonly<Record<string, 'new' | null>> = { 'linkedin-post': MKTG_RUN_NEW_MODE };
