// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's iconography samples: the design board's eight line icons
// on a 24-unit grid with a 2-unit stroke, round caps and joins and no fill
// (the Lucide / Material Symbols convention the kit's "Recommended set"
// names), as typed primitives converted shape for shape from the board's
// markup. The ONE source for every renderer: the web card and the print
// sheet draw them inline, the Slides export rasterises them as PNGs. No
// renderer holds a copy or an SVG string of its own.

import type { BrandKitIconSample } from '../interfaces/brand-kit-icons.interface';

/** The eight sample icons' ids, in the board's order: the tiles read left to right, top to bottom, and the strip the same. */
export const BRAND_KIT_ICON_IDS = ['documents', 'community', 'global', 'code', 'events', 'metrics', 'verified', 'newsletter'] as const;

/** The grid every shape is drawn on: `viewBox="0 0 24 24"`. */
export const BRAND_KIT_ICON_VIEWBOX_SIZE = 24;
/** The stroke, in grid units; caps and joins are round, there is no fill. */
export const BRAND_KIT_ICON_STROKE_WIDTH = 2;
export const BRAND_KIT_ICON_STROKE_LINECAP = 'round';
export const BRAND_KIT_ICON_STROKE_LINEJOIN = 'round';

/** The icon's side in a labelled tile, in CSS pixels (the board's). */
export const BRAND_KIT_ICON_TILE_SIZE_PX = 32;
/**
 * The icon's side in the web card's dark strip, in CSS pixels: 24, from the board's 30, so the eight fit one row in
 * the half-width Iconography card at 1440 and in the 390 card alike (8 × 24 + 7 × 8 + 2 × 12 = 272 px). The
 * export's PNGs take `MKTG_SLIDES_EXPORT_ICON_SIDE_PX`, not this.
 */
export const BRAND_KIT_ICON_STRIP_SIZE_PX = 24;
/** The strip's width from which its eight icons sit in one row (`8 × 24 + 7 × 8 + 2 × 12`); narrower, they go 4 + 4. */
export const BRAND_KIT_ICON_STRIP_ONE_ROW_MIN_PX = 272;
/** The strip icons' side on the print sheet, in CSS pixels (the board's 30: the sheet's Iconography page keeps the board's proportions). */
export const BRAND_KIT_ICON_PRINT_STRIP_SIZE_PX = 30;
/** The portrait book's Iconography page (the design mock): the tile icons' side, 36 px. */
export const BRAND_KIT_ICON_PORTRAIT_TILE_SIZE_PX = 36;
/** The portrait book's strip icons' side, 32 px. */
export const BRAND_KIT_ICON_PORTRAIT_STRIP_SIZE_PX = 32;
/** The tiles per row of the board's 4 × 2 grid, on the web and in print. */
export const BRAND_KIT_ICON_TILE_COLUMNS = 4;

/** The strip icon drawn in the highlight colour: the third (Global); the rest are white. */
export const BRAND_KIT_ICON_HIGHLIGHT_INDEX = 2;

/** The strip icons' ink, white: the strip's ground is the kit's dark. */
export const BRAND_KIT_ICON_STRIP_INK = '#FFFFFF';

/** The eight sample icons, in the board's order, each with the label the tile shows beside it as text. */
export const BRAND_KIT_ICON_SAMPLES = [
  {
    id: 'documents',
    label: 'Documents',
    shapes: [
      { kind: 'path', d: 'M6 3h8l4 4v14H6z' },
      { kind: 'path', d: 'M14 3v4h4' },
    ],
  },
  {
    id: 'community',
    label: 'Community',
    shapes: [
      { kind: 'circle', cx: 9, cy: 8, r: 3 },
      { kind: 'path', d: 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6' },
      { kind: 'circle', cx: 17, cy: 9, r: 2.5 },
      { kind: 'path', d: 'M15.5 14.2c3 .3 5.5 2.7 5.5 5.8' },
    ],
  },
  {
    id: 'global',
    label: 'Global',
    shapes: [
      { kind: 'circle', cx: 12, cy: 12, r: 9 },
      { kind: 'path', d: 'M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z' },
    ],
  },
  {
    id: 'code',
    label: 'Code',
    shapes: [{ kind: 'path', d: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' }],
  },
  {
    id: 'events',
    label: 'Events',
    shapes: [
      { kind: 'rect', x: 3, y: 5, width: 18, height: 16, rx: 2 },
      { kind: 'path', d: 'M3 10h18M8 3v4M16 3v4' },
    ],
  },
  {
    id: 'metrics',
    label: 'Metrics',
    shapes: [{ kind: 'path', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }],
  },
  {
    id: 'verified',
    label: 'Verified',
    shapes: [
      { kind: 'circle', cx: 12, cy: 12, r: 9 },
      { kind: 'path', d: 'M8 12l3 3 5-6' },
    ],
  },
  {
    id: 'newsletter',
    label: 'Newsletter',
    shapes: [
      { kind: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 2 },
      { kind: 'path', d: 'M3 7l9 6 9-6' },
    ],
  },
] as const satisfies readonly BrandKitIconSample[];
