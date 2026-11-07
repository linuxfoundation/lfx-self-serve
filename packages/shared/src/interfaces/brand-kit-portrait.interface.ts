// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The shapes the brand kit's portrait PDF pages read: the logo files table,
 * the contrast matrix and its grades, the usage cards and the Sources page's
 * lists. Computed by `brand-kit-portrait.utils.ts` from a `BrandKitBookView`.
 */

import type { BrandKitContrastGrade, BrandKitLogoSlot, BrandKitTypeStep, BrandKitUsageView } from './brand-kit.interface';

/** How a page draws the artwork: as supplied, reversed to white, or one-colour black. */
export type BrandKitPortraitArtworkMode = 'full' | 'reversed' | 'mono';

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

/** A WCAG grade as the contrast page's pill prints it: the kit's grade words and the app's semantic inks. */
export interface BrandKitPortraitContrastGrade {
  /** The kit's own grade words, as the web view prints them. */
  label: BrandKitContrastGrade;
  background: string;
  color: string;
}

/** One cell of the contrast matrix: the ground, the text colour, their ratio and its grade, or no ratio on the diagonal. */
export interface BrandKitPortraitContrastCell {
  foreground: string;
  background: string;
  /** The unrounded WCAG ratio; `null` where a colour meets itself: the cell is a mist square. */
  ratio: number | null;
  /** The ratio to one decimal, as printed (`8.3`); '' on the diagonal. */
  label: string;
  /** The grade of the unrounded ratio; `null` on the diagonal. */
  grade: BrandKitPortraitContrastGrade | null;
  /** True on a coloured ground, where the ratio's small type reads in the ground's ink. */
  tinted: boolean;
}

/** One row of the contrast matrix: a palette colour as text, over every palette colour as ground. */
export interface BrandKitPortraitContrastRow {
  name: string;
  hex: string;
  cells: BrandKitPortraitContrastCell[];
}

/** How the contents page lays its list and lower blocks out for the pages it lists. */
export interface BrandKitPortraitContentsLayout {
  /** The list in one column, or in two when one cannot hold the rows above the lower blocks. */
  columns: 1 | 2;
  /** The lower blocks' top: the mock's y 690, or lower when the list needs the room, never past where they would cross the footer's room. */
  blocksTop: number;
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

/** One value of a colour conflict as the Sources page prints it: the swatch, its label (`#4A4A4A · kept` for the kept one) and its source in words. */
export interface BrandKitPortraitConflictValue {
  hex: string;
  label: string;
  source: string;
  kept: boolean;
}

/** A colour conflict as the Sources page prints it. */
export interface BrandKitPortraitConflict {
  name: string;
  chosen: string;
  values: BrandKitPortraitConflictValue[];
}

/** One step of the Typography page's scale as printed: the record's step with its sample, the spec column's text, and the size and line height it is set at. */
export interface BrandKitPortraitTypeStep extends BrandKitTypeStep {
  sample: string;
  /** `500 · 32/40`: the step's recorded size, whatever the sample is set at. */
  spec: string;
  /** The display step: the sample on its own full-width line. */
  display: boolean;
}

/** One line of the "Where to get the font" block. */
export interface BrandKitPortraitTypeSourceLine {
  text: string;
  muted: boolean;
}

/**
 * The Typography page laid out from its data: the scale's steps as printed, where the scale ends, the y of the two blocks
 * under it (the mock's 830, or lower when the scale runs past it), the lines of the font-source block, the share of its
 * size the body step is set at (1 when the stack fit as written) and whether its sample had to be cut.
 */
export interface BrandKitPortraitTypeLayout {
  steps: BrandKitPortraitTypeStep[];
  scaleEnd: number;
  lowerTop: number;
  sourceLines: BrandKitPortraitTypeSourceLine[];
  bodyScale: number;
  cut: boolean;
}

/** The Voice page's attributes fitted to their grid's room: the share of the type size they are set at, whether a line had to be cut, and the attributes as printed. */
export interface BrandKitPortraitAttributesFit {
  scale: number;
  cut: boolean;
  attributes: { name: string; line: string }[];
}

/** The Sources page's lists fitted to their columns: the share of the type size they are set at (1 when they fit as written), whether a line had to be cut, and the lists as printed. */
export interface BrandKitPortraitSourcesFit {
  scale: number;
  cut: boolean;
  sources: BrandKitPortraitSources;
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
  conflicts: BrandKitPortraitConflict[];
}
