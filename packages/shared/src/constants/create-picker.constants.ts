// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatePickerResultSet } from '../interfaces/create-picker.interface';

/**
 * Shared empty-result fallback for the create picker's BFF wrapper (`CreateTargetPickerService`)
 * and its consumers (`CreateTargetPickerComponent`, `CreatePermissionService`) — a single source
 * of truth instead of three identical local literals, so a future shape change to
 * `CreatePickerResultSet` can't leave one copy stale.
 */
export const EMPTY_CREATE_PICKER_RESULT: CreatePickerResultSet = { projects: [], committees: [] };
