// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's iconography samples: the eight line icons the Visual
// chapter shows, as typed drawing primitives (never SVG text), and the three
// colour roles the kit tints them with. The one source for the web card, the
// print sheet and the Slides export's PNGs.

import { BRAND_KIT_ICON_IDS } from '../constants/brand-kit-icons.constants';

/** One of the eight sample icons, by its id. */
export type BrandKitIconId = (typeof BRAND_KIT_ICON_IDS)[number];

/** A stroked path on the 24-unit grid. */
export interface BrandKitIconPath {
  kind: 'path';
  d: string;
}

/** A stroked circle on the 24-unit grid. */
export interface BrandKitIconCircle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

/** A stroked rounded rectangle on the 24-unit grid. */
export interface BrandKitIconRect {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

/** One drawing primitive of a sample icon; every renderer draws the same list with one stroke and no fill. */
export type BrandKitIconShape = BrandKitIconPath | BrandKitIconCircle | BrandKitIconRect;

/** One sample icon: its id, the label drawn as text beside it (never in a PNG), and its shapes. */
export interface BrandKitIconSample {
  id: BrandKitIconId;
  label: string;
  shapes: readonly BrandKitIconShape[];
}

/**
 * The three colour roles the samples take from a kit (`brandKitIconColours`):
 * the tiles' ink and the strip's ground are the kit's dark; the highlight is
 * the one strip icon drawn in the palette colour the kit's Iconography rule
 * names (the last one named), else the kit's spark, else the accent. Each a
 * `#RRGGBB` the kit carries.
 */
export interface BrandKitIconColours {
  tileInk: string;
  stripGround: string;
  highlight: string;
}

/** One icon of the dark strip as the samples component draws it: the icon, its ink (white, or the highlight), and whether it is the highlighted one. */
export interface BrandKitIconStripItem {
  icon: BrandKitIconSample;
  ink: string;
  highlight: boolean;
}
