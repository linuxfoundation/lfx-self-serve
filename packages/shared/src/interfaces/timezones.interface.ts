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
  /** UTC offset string representation */
  offset: string;
}
