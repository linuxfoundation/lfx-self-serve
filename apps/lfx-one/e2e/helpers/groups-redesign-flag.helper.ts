// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GROUPS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { Page } from '@playwright/test';

import { pinFlag } from './meetings-redesign-flag.helper';

/**
 * Pins the Me lens groups redesign flag. Defaults to `false`: specs that drive the existing groups dashboard at
 * `/groups` must not inherit whatever the test account is targeted for.
 */
export async function stubGroupsRedesignFlag(page: Page, enabled = false): Promise<void> {
  await pinFlag(page, GROUPS_REDESIGN_FLAG, enabled);
}
