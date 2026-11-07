// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The portrait print grammar: the look a document is set in, the book its
// page frames share, the plan of its pages, and the fit model of a text
// that must stay in its frame. The measurements are `MKTG_PORTRAIT_PAGE` (shared constants).

import type { MktgPrintBrand, MktgPrintLogo } from './mktg-print.interface';

/**
 * The look of a portrait document: the kit's dark (titles, labels, covers,
 * openers, dark tiles), its accent (opener numbers, chapter bands, emphasis
 * rules, the one call-out card; never body text), its spark (the kit's
 * secondary accent: the first pillar's rule; the accent again when the kit
 * names none), the ink on the accent (white only where it reaches AA, else
 * the dark), the ink on the dark, and the font stack. `MktgPrintBrand`
 * carries the dark, the accent, the ink on the dark and the font stack;
 * the look adds what the portrait pages need beyond it.
 */
export interface MktgPortraitLook extends Pick<MktgPrintBrand, 'dark' | 'accent' | 'onDark' | 'fontStack'> {
  spark: string;
  onAccent: string;
}

/**
 * The book a portrait document's pages are set in: standalone (its own
 * cover, contents and back cover, the chapter band on, numbered from 1) or
 * inside the family's book (`inFamily`: the family's document name in the
 * running head's right slot, its footer text, no band, no cover, contents
 * or back cover, the pages numbered from `firstPage`). A print component
 * takes `MktgPortraitBook | null`, `null` being standalone, and resolves
 * the book it passes down to its frames (`mktgPortraitDocumentName`,
 * `mktgPortraitFootLeft`).
 */
export interface MktgPortraitBook {
  inFamily: boolean;
  /** The running head's right text: the document's name (`Agentic AI Foundation brand kit`). */
  headRight: string;
  /** The footer's left text (`<project> · a Linux Foundation project`). */
  footLeft: string;
  /** The book page number of the document's first page (1 standalone). */
  firstPage: number;
}

/** The kinds of portrait document, as their names end: `<project> brand kit`. */
export type MktgPortraitDocumentKind = 'brand kit' | 'messaging framework' | 'positioning & brand';

/**
 * One page of a portrait document's plan: its stable id (`logo-system`),
 * its running-head section label (`01 Logo`, `Contents`) and its title.
 * The plan is pure over the document's view, so the contents page, the
 * footers and the family's openers compute every number from it.
 */
export interface MktgPortraitPlanPage {
  id: string;
  section: string;
  title: string;
}

/**
 * A plan page placed in its book: its book page number, the section label
 * as the running head prints it, and whether it carries the chapter band.
 */
export interface MktgPortraitPlacedPage extends MktgPortraitPlanPage {
  number: number;
  label: string;
  band: boolean;
}

/** A logo as a portrait cover draws it. */
export type MktgPortraitLogo = MktgPrintLogo;

/** A counted noun as a `+N more …` line prints it: `rule` / `rules`, `item to avoid` / `items to avoid`. */
export interface MktgPortraitNoun {
  one: string;
  many: string;
}

/** One paragraph of a block the fit model measures: its text and how it is set, in px. */
export interface MktgPortraitFitPara {
  text: string;
  /** Font size, px. */
  size: number;
  /** Line height as a multiple of the size. */
  line: number;
  weight?: number;
  /** Set in capitals. */
  caps?: boolean;
  /** The CSS font stack the text is set in (its first family widens the measure); the sans table's width without one. */
  family?: string;
  /** The line's letter-spacing in em per character (negative for a tight headline); capitals take the caps tracking without one. */
  tracking?: number;
  /** Space above the paragraph, px. */
  above?: number;
}

/** A block of paragraphs the fit model fits to a box. */
export interface MktgPortraitFitBlock {
  paras: MktgPortraitFitPara[];
}

/** A block fitted to its box: set smaller when it had to be, cut at a sentence when shrinking was not enough. */
export interface MktgPortraitFitResult {
  block: MktgPortraitFitBlock;
  /** The share of the preferred size the block is set at (1 when it fit as written). */
  scale: number;
  cut: boolean;
}
