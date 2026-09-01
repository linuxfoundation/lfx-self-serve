// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CanMatchFn } from '@angular/router';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { createFlagGuard } from './create-flag-guard';

/** CanMatch guard gating the "Propose a project" intake (`/propose`) behind the `formation-enabled` flag; SSR defers to browser, browser waits for provider READY and fails closed. */
export const formationEnabledGuard: CanMatchFn = createFlagGuard(FORMATION_ENABLED_FLAG);
