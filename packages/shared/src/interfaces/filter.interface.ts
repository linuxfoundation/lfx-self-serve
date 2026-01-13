// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Generic filter option interface for dropdowns and select components
 */
export interface FilterOption<T = string | null> {
  label: string;
  value: T;
}
