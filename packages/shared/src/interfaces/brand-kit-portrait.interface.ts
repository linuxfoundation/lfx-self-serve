// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The shapes the brand kit's portrait PDF pages read: the logo files table,
 * the contrast matrix and its grades, the usage cards and the Sources page's
 * lists. Computed by `brand-kit-portrait.utils.ts` from a `BrandKitBookView`.
 */

import type { BrandKitLogoSlot, BrandKitReportColorConflict, BrandKitUsageView } from './brand-kit.interface';

/** One row of the logo files table. */
export interface BrandKitPortraitFileRow {
  slot: BrandKitLogoSlot;
  name: string;
  /** `SVG`, `PNG`, `SVG (crop)` or `—`. */
  format: string;
  variant: string;
  /** `Supplied`, or the mock's plain line for a missing file; never a file name. */
  source: string;
}

/** A WCAG grade as the contrast page's pill prints it: the label and its inks, by the mock's thresholds. */
export interface BrandKitPortraitContrastGrade {
  label: 'AAA' | 'AA' | 'Large only' | 'Fails';
  background: string;
  color: string;
}

/** One cell of the contrast matrix: the ground, the text colour and their ratio, or no ratio on the diagonal. */
export interface BrandKitPortraitContrastCell {
  foreground: string;
  background: string;
  /** `null` where a colour meets itself: the cell is a mist square. */
  ratio: number | null;
}

/** One row of the contrast matrix: a palette colour as text, over every palette colour as ground. */
export interface BrandKitPortraitContrastRow {
  name: string;
  hex: string;
  cells: BrandKitPortraitContrastCell[];
}

/** One of the four usage cards: its layout, the line it carries, its caption and the accent moment the table names. */
export interface BrandKitPortraitUsageCard {
  layout: BrandKitUsageView['layout'];
  text: string;
  name: string;
  format: string;
  ground: string;
  accentMoment: string;
}

/** A source that could not be read, as the page lists it: the name made readable and the reason. */
export interface BrandKitPortraitFailedSource {
  source: string;
  reason: string;
}

/** An asset the run reported missing, in words. */
export interface BrandKitPortraitMissingAsset {
  asset: string;
  reason: string;
  fix: string;
}

/** Everything the Sources page prints, read from the revision's own run record; a list the record lacks is empty. */
export interface BrandKitPortraitSources {
  read: string[];
  failed: BrandKitPortraitFailedSource[];
  warnings: { text: string; source: string }[];
  missing: BrandKitPortraitMissingAsset[];
  /** The one fix shared by every missing asset, when they all name the same one; '' otherwise. */
  sharedFix: string;
  gaps: string[];
  notes: string;
  conflicts: BrandKitReportColorConflict[];
}
