// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

import { AccountUnsavedChangesService } from '../services/account-unsaved-changes.service';

/** Asks before leaving an Account & Settings page with unsaved changes, for any in-app navigation (#6070). */
export const accountUnsavedChangesGuard: CanDeactivateFn<unknown> = () => inject(AccountUnsavedChangesService).confirmLeave();
