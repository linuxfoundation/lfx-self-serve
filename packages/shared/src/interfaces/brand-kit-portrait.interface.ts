// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The shapes the brand kit's portrait PDF pages read: the logo files table,
 * the contrast matrix and its grades, the usage cards and the Sources page's
 * lists. Computed by `brand-kit-portrait.utils.ts` from a `BrandKitBookView`.
 */

import type { BrandKitContrastGrade, BrandKitLogoSlot, BrandKitTypeStep, BrandKitUsageView } from './brand-kit.interface';
import type { MktgPortraitNoun } from './mktg-portrait-print.interface';

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
  /** The kit's own line for the step, shortened at a word to fit its measure at the step's size (never set smaller). */
  sample: string;
  /** `500 · 32/40`: the kit's size and line height, which is what the sample is set at. */
  spec: string;
  /** The display step: the sample on its own full-width line. */
  display: boolean;
  /** The sample is fewer words than the kit's line. */
  shortened: boolean;
}

/** One line of the "Where to get the font" block. */
export interface BrandKitPortraitTypeSourceLine {
  text: string;
  muted: boolean;
}

/**
 * The Typography page sized from its data: the scale's steps as printed (every step at the kit's size, its sample
 * shortened to its measure), where the model says the scale ends and the two blocks under it start (the mock's 830, or
 * 16 px under the scale when it runs past that — the page lays them in flow, so the engine's own end is what places
 * them; the model's y decides how many lines the body sample may take), the lines of the font-source block and the lines
 * the body sample was allowed (3, fewer when the stack would otherwise cross the footer).
 */
export interface BrandKitPortraitTypeLayout {
  steps: BrandKitPortraitTypeStep[];
  scaleEnd: number;
  lowerTop: number;
  sourceLines: BrandKitPortraitTypeSourceLine[];
  bodyLines: number;
  /** The kit's type rules fitted to the lower block's room from the mock's y 830 (`brandKitPortraitRulesFit`). */
  rules: BrandKitPortraitRulesFit;
}

/** The Voice page's two messages fitted to their block: the share of their sizes they are set at, whether one was cut, and the texts as printed. */
export interface BrandKitPortraitVoiceMessagesFit {
  scale: number;
  cut: boolean;
  umbrella: string;
  line: string;
}

/** The room one of the chapters' rule lists has: its box, its columns and its type (`BRAND_KIT_PORTRAIT_RULE_LISTS`). */
export interface BrandKitPortraitRuleListRoom {
  top: number;
  bottom: number;
  columns: number;
  /** One column's text width, px. */
  width: number;
  size: number;
  line: number;
  /** Space over every item after the first, px (a hairline rule's padding, a grid gap). */
  above: number;
  /** Space between the label and the first item, px. */
  listAbove: number;
  /** What the list counts in its `+N more` line: `rule` / `rules`, `item to avoid` / `items to avoid`. */
  noun: MktgPortraitNoun;
}

/** A rule list fitted to its room: set smaller when it had to be, cut at a sentence when that was not enough, its last rules counted when even the cut ran past the room. */
export interface BrandKitPortraitRulesFit {
  /** The share of the type size the list is set at (1 as written). */
  scale: number;
  cut: boolean;
  /** The rules as printed, in the record's order. */
  rules: string[];
  /** The rules the room does not hold: the `+N more rules, in LFX One` line's N (0: none). */
  more: number;
  /** That line as the page prints it (`mktgPortraitMoreLine`), '' at none. */
  moreLine: string;
}

/** The Color contrast page's layout from the palette's size and the kit's pairs: where the pairs start and how many print. */
export interface BrandKitPortraitContrastLayout {
  /** The matrix's measured height, px. */
  matrixHeight: number;
  /** The matrix block's `min-height`, px: the mock's room above the pairs (390), so a four-colour matrix leaves the pairs at y 610. */
  matrixMinHeight: number;
  /** The pairs block's top, px from the frame's top. */
  pairsTop: number;
  /** The pairs printed, from the first. */
  pairsKept: number;
  /** The pairs the room does not hold: the `+N more pairs, in LFX One` line's N (0: none). */
  more: number;
  /** That line as the page prints it, '' at none. */
  moreLine: string;
}

/** The Voice page's attributes fitted to their grid's room: the share of the type size they are set at, whether a line had to be cut, and the attributes as printed. */
export interface BrandKitPortraitAttributesFit {
  /** The share of the preferred size the grid is set at (1 when it fits as written). */
  scale: number;
  /** Whether a line was cut at the smallest step. */
  cut: boolean;
  /** The attributes as printed, in the record's order. */
  attributes: { name: string; line: string }[];
  /** Attributes left to the Voice tab because the room does not hold them even cut: the `+N more` line's N (0: none). */
  more: number;
  /** The stack's measured height, px: the grid and, with `more`, its line; never past the room. */
  height: number;
}

/** The Sources page's lists fitted to their columns: the share of the type size they are set at (1 when they fit as written), whether a line had to be cut, and the lists as printed. */
export interface BrandKitPortraitSourcesFit {
  scale: number;
  cut: boolean;
  sources: BrandKitPortraitSources;
  /** Sources read that the left column does not hold even cut: the `+N more sources read, in LFX One` line's N (0: none). */
  moreRead: number;
  /** Gaps the left column does not hold even cut, once the sources read are down to one: the `+N more gaps, in LFX One` line's N. */
  moreGaps: number;
  /** Colour conflicts the right column does not hold even cut: the `+N more color conflicts, in LFX One` line's N (0: none). */
  moreConflicts: number;
  /** The three `+N more` lines as the page prints them (`mktgPortraitMoreLine`), '' at none. */
  moreReadLine: string;
  moreGapsLine: string;
  moreConflictsLine: string;
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
