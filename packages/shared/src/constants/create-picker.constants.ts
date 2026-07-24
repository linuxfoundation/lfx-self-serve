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

/**
 * Minimum trimmed query length before the create picker switches from its default tree to a real
 * search request. Shared by `CreateTargetPickerComponent` (UI gate) and
 * `create-picker.controller.ts` (BFF validation) so the two can't drift — a client/server mismatch
 * here would mean the UI either issues requests the server rejects or suppresses terms the server
 * would have accepted.
 */
export const CREATE_PICKER_MIN_SEARCH_LENGTH = 2;
