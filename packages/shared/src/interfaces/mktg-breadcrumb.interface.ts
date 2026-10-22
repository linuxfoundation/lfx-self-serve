// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Fixed-parent navigation, independent of the path used to reach a screen. */
export interface MktgBreadcrumbItem {
  label: string;
  route?: string[];
  queryParams?: Record<string, string | null>;
}
