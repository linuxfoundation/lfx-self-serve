// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Quarter steps a column chart's axis rounds up to, per power of ten; finer than the line chart's, as the design's 24K axis needs. */
export const HEALTH_METRICS_COLUMN_CHART_QUARTER_STEPS: readonly number[] = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The design's opacity for every column but the current one. */
export const HEALTH_METRICS_COLUMN_CHART_MUTED_OPACITY = 0.35;
