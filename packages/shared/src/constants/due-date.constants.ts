// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Shared so DueDateLabelPipe wording and DueDateLabelColorPipe lookups can't desync.
export const DUE_DATE_LABELS = {
  CLOSES_TODAY: 'Closes today',
  CLOSES_TOMORROW: 'Closes tomorrow',
} as const;
