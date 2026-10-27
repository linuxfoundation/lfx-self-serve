// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_NEW_MODE } from './mktg-last-intake.constants';

export const MKTG_FAMILY_ACTION_LABELS = {
  rebuild: (names: string[]) => (names.length === 1 ? `Update ${names[0]}` : `Update ${names.length} assets`),
  blocked: (document: string) => `Review and approve the ${document.toLowerCase().replace('messaging framework', 'framework')}`,
  caption: (names: string[]) => (names.length ? `Then: ${new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(names)}` : undefined),
  create: (asset: string) => `Create ${asset}`,
  review: (count: number) => (count === 1 ? 'Review the draft' : `Review ${count} drafts`),
  export: () => 'Export the kit',
};

export const MKTG_FAMILY_FRAMEWORK_REQUIRED = 'after the framework is approved';

export const MKTG_FAMILY_WRITE_REQUIRED = 'You need write access to this project to run its agents';
/**
 * One-off pages opt into last-input restoration only once they support it.
 * Member 360 stays null: its window/compare/tracker inputs are not registered as a last-intake allowlist.
 * Its page and BFF belong to the Member 360 items; restoring those inputs is a follow-up.
 * LinkedIn restores registered source scalars; uploads still require reattachment.
 */
export const MKTG_FAMILY_ONE_OFF_RUN_MODES: Readonly<Record<string, 'new' | null>> = { 'linkedin-post': MKTG_RUN_NEW_MODE };
