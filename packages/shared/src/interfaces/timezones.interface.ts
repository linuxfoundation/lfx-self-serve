// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Timezone option interface for dropdown components
 * @description Structured timezone data with human-readable labels and IANA identifiers
 */
export interface TimezoneOption {
  /** Human-readable timezone label */
  label: string;
  /** IANA timezone identifier value */
  value: string;
  /** Standard-time UTC offset string (e.g. "-08:00"). Not DST-aware — use getTimezoneUtcOffsetString() for display labels. */
  offset: string;
}
