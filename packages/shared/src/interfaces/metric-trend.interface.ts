// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Structured period-over-period delta for drawer header rendering.
 * Produced by `computePeriodDelta`; `deltaLabel` is always an absolute-value
 * string so the template can render the ▲/▼ arrow and sr-only text separately.
 */
export interface PeriodDelta {
  direction: 'up' | 'down' | 'neutral';
  deltaLabel: string;
  periodLabel: string;
}
