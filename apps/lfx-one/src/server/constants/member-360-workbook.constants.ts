// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from '@lfx-one/shared/constants/colors.constants';

/** Server-only spreadsheet presentation; no client or contract dependency. */
export const MEMBER_360_WORKBOOK_FORMATS = {
  integer: '0',
  score: '0.0',
  currency: '"$"#,##0',
  date: 'yyyy-mm-dd',
  contacts: '[=1]0" (single-threaded)";0',
  delta: '+0.0;-0.0;0.0',
} as const;
export const MEMBER_360_SUMMARY_WIDTHS = [28, 14, 14, 18, 14, 14];
export const MEMBER_360_WORKBOOK_COLORS = {
  heat: [lfxColors.red[500], lfxColors.amber[400], lfxColors.emerald[600]],
  red: { fill: lfxColors.red[50], text: lfxColors.red[800] },
  amber: { fill: lfxColors.amber[50], text: lfxColors.amber[800] },
  emerald: { fill: lfxColors.emerald[50], text: lfxColors.emerald[800] },
} as const;
export const MEMBER_360_CHART_NAMESPACES = {
  chart: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  spreadsheetDrawing: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  relationships: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  packageRelationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
} as const;
