// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ChartOptions } from 'chart.js';
import { lfxColors } from './colors.constants';

/**
 * Base tooltip configuration for index-based hovering
 * Shows tooltip when hovering anywhere on the chart (not just data points)
 */
const BASE_TOOLTIP_CONFIG = {
  enabled: true,
  mode: 'index' as const,
  intersect: false,
  yAlign: 'bottom' as const,
  position: 'nearest' as const,
  caretSize: 0,
};

/**
 * Base interaction configuration for index-based hovering
 */
const BASE_INTERACTION_CONFIG = {
  mode: 'index' as const,
  intersect: false,
};

/**
 * Styled tooltip configuration for enhanced tooltips
 * Used for multi-dataset charts with formatted tooltips
 */
const STYLED_TOOLTIP_CONFIG = {
  ...BASE_TOOLTIP_CONFIG,
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  titleColor: lfxColors.gray[900],
  bodyColor: lfxColors.gray[600],
  footerColor: lfxColors.gray[500],
  borderColor: `${lfxColors.gray[300]}CC`,
  borderWidth: 1,
  padding: 12,
  displayColors: true,
  bodySpacing: 6,
  footerSpacing: 4,
  footerMarginTop: 8,
  cornerRadius: 8,
  caretSize: 6,
  caretPadding: 8,
  usePointStyle: true,
  boxWidth: 8,
  boxHeight: 8,
  titleFont: {
    size: 13,
    weight: 'bold' as const,
  },
  bodyFont: {
    size: 12,
  },
  footerFont: {
    size: 11,
    weight: 'normal' as const,
  },
  boxPadding: 6,
};

/**
 * Base chart options for line charts
 * Used for sparkline visualizations with simple tooltips
 */
export const BASE_LINE_CHART_OPTIONS: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: BASE_INTERACTION_CONFIG,
  hover: BASE_INTERACTION_CONFIG,
  plugins: {
    legend: { display: false },
    tooltip: BASE_TOOLTIP_CONFIG,
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, grace: '5%' },
  },
};

/**
 * Base chart options for bar charts
 * Used for bar chart visualizations with simple tooltips
 */
export const BASE_BAR_CHART_OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: BASE_INTERACTION_CONFIG,
  hover: BASE_INTERACTION_CONFIG,
  plugins: {
    legend: { display: false },
    tooltip: BASE_TOOLTIP_CONFIG,
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, grace: '5%' },
  },
  datasets: {
    bar: {
      barPercentage: 0.9,
      categoryPercentage: 0.95,
      borderRadius: 4,
      borderSkipped: false,
    },
  },
};

/**
 * Chart options for dual-line charts with styled tooltips
 * Used for multi-dataset charts like Issues Trend (opened vs closed)
 */
export const DUAL_LINE_CHART_OPTIONS: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: BASE_INTERACTION_CONFIG,
  hover: BASE_INTERACTION_CONFIG,
  plugins: {
    legend: { display: false },
    tooltip: {
      ...STYLED_TOOLTIP_CONFIG,
      callbacks: {
        labelPointStyle: () => ({
          pointStyle: 'circle',
          rotation: 0,
        }),
      },
    },
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, grace: '5%' },
  },
};

/**
 * Chart options for bar charts with footer tooltips
 * Used for charts that need additional footer information (e.g., PR Velocity)
 */
export const BAR_CHART_WITH_FOOTER_OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  layout: {
    padding: {
      top: 5,
      bottom: 5,
    },
  },
  interaction: BASE_INTERACTION_CONFIG,
  hover: BASE_INTERACTION_CONFIG,
  plugins: {
    legend: { display: false },
    tooltip: {
      ...STYLED_TOOLTIP_CONFIG,
      displayColors: false,
    },
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, grace: '5%' },
  },
};
