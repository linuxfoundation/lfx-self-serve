// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** A bar's value label: neutral-900 on the latest bar, neutral-500 on the rest, red-600 on a latest bar below its level. */
export const HEALTH_METRICS_BAR_CHART_LABEL_CLASSES = {
  strong: 'text-gray-900',
  muted: 'text-gray-500',
  alert: 'text-red-600',
} as const;
