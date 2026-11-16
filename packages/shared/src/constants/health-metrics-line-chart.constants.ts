// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import { HEALTH_METRICS_OVERVIEW_NEWSLETTER_LABEL_MIN_PX, HEALTH_METRICS_OVERVIEW_PURPLE } from './health-metrics-overview.constants';

/** The SVG's viewBox width; the chart stretches it to the card, and the height is the plot's px. */
export const HEALTH_METRICS_LINE_CHART_VIEW_WIDTH = 600;

/** The design's plot height, in px. */
export const HEALTH_METRICS_LINE_CHART_HEIGHT_PX = 200;

/** The design's series strokes: accent, the purple feature colour, and success for a derived series. */
export const HEALTH_METRICS_LINE_CHART_COLORS = {
  accent: lfxColors.blue[500],
  feature: HEALTH_METRICS_OVERVIEW_PURPLE,
  success: lfxColors.emerald[500],
} as const;

/** The least room, in px, between two x labels; closer ones fall back to the first of each month, as the Overview's chart does. */
export const HEALTH_METRICS_LINE_CHART_LABEL_MIN_PX = HEALTH_METRICS_OVERVIEW_NEWSLETTER_LABEL_MIN_PX;

/** Steps a y axis's quarter can take, times a power of ten, so the ticks read as round numbers. */
export const HEALTH_METRICS_LINE_CHART_QUARTER_STEPS: readonly number[] = [1, 2, 2.5, 4, 5, 10];
