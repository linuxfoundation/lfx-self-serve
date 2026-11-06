// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family PDF's own pages (Download PDF on the family card): the page data
// the appendix builders (mktg-print-pages.utils.ts) give the card and grid
// pages to bind, and the strings of the cover, the dividers and the running
// heads. Units are deck points on the 720 × 405 pt slide.

import type { MktgPrintPageBox } from './mktg-print-page.interface';
import type { MktgSlidesExportAssetKind } from './mktg-slides-export.interface';

/** The appendix pages' layout numbers, pt: the spec's §1 cards (gaps, border, radius, padding, label-to-body gap, least height, row scale floor, the lone last card's threshold, the label's tracking in em) and §2 grid (gaps, sizes, weight, the deck's paragraph gaps in pt and as shares of the answer size, the page scales tried before a page is full). */
export interface MktgPrintAppendixLayout {
  cardColumnGap: number;
  cardRowGap: number;
  cardBorder: number;
  cardRadius: number;
  cardPaddingX: number;
  cardPaddingY: number;
  cardBodyGap: number;
  cardMinHeight: number;
  cardRowMinScale: number;
  cardLoneMinHeight: number;
  cardLabelTracking: number;
  faqColumnGap: number;
  faqRowGap: number;
  faqQuestionSize: number;
  faqQuestionWeight: number;
  faqAnswerSize: number;
  faqAnswerGap: number;
  faqListItemGap: number;
  faqPlainAfterBulletEm: number;
  faqBulletAfterPlainEm: number;
  faqSourceGap: number;
  faqPageScales: readonly number[];
}

/** The section divider's layout (§3): its three boxes, the title and count sizes, and the share of the dark mixed into the count line's ink. */
export interface MktgPrintDividerLayout {
  eyebrow: MktgPrintPageBox;
  title: MktgPrintPageBox;
  count: MktgPrintPageBox;
  titleSize: number;
  countSize: number;
  softShare: number;
}

/** One boilerplate card as the page binds it: the length's index (the track key), its `ONE-LINER · 10 WORDS` head, the text (cut at a sentence when it did not fit even set smaller), the body size (pt) and whether it was cut. */
export interface MktgPrintCard {
  index: number;
  head: string;
  text: string;
  size: number;
  cut: boolean;
}

/** One row of two cards in order, its estimated height (pt) and the share of the body size it is set at. */
export interface MktgPrintCardRow {
  cards: MktgPrintCard[];
  height: number;
  scale: number;
}

/** One page of boilerplate cards: `Boilerplates`, `Boilerplates (2)`, …, and as many rows as fit the body area. */
export interface MktgPrintCardPage {
  title: string;
  rows: MktgPrintCardRow[];
}

/** A card as the page template binds it: its body's fitted size as a page length. */
export interface MktgBoilerplatesPrintCard extends MktgPrintCard {
  bodySize: string;
}

/** One page of cards as the template binds it: its deck-wide number and its rows' heights as a grid template. */
export interface MktgBoilerplatesPrintPage extends Omit<MktgPrintCardPage, 'rows'> {
  number: string;
  rowsTemplate: string;
  rows: { cards: MktgBoilerplatesPrintCard[] }[];
}

/** A line of an answer's restricted Markdown: its text and its marker ('' for a paragraph, `-` for a list item of any kind). */
export interface MktgPrintFaqLine {
  text: string;
  marker: string;
}

/** One question and its answer as the FAQ grid binds them: the field path (the track key), the answer as restricted Markdown rebuilt from its lines (every list line a bullet `- `, as the deck draws it; '' when unanswered), the source label ('' when none), the sizes (question, answer, source line) and the fixed gaps (under the question, between items, over the source), pt at the entry's scale, and whether the answer was cut. */
export interface MktgPrintFaqEntry {
  path: string;
  question: string;
  answer: string;
  answered: boolean;
  source: string;
  questionSize: number;
  answerSize: number;
  sourceSize: number;
  answerGap: number;
  listItemGap: number;
  sourceGap: number;
  cut: boolean;
}

/** One row of the grid, a left and a right entry, and its estimated height (pt) at the page's scale. */
export interface MktgPrintFaqRow {
  entries: MktgPrintFaqEntry[];
  height: number;
}

/** One page of the grid: `Questions and answers`, `Questions and answers (2)`, …, the share of the sizes the whole page is set at (1, 0.95 or 0.9) and its rows. */
export interface MktgPrintFaqPage {
  title: string;
  scale: number;
  rows: MktgPrintFaqRow[];
}

/** A question and its answer as the grid template binds them: the fitted sizes and gaps as page lengths. */
export interface MktgFaqPrintEntry extends MktgPrintFaqEntry {
  questionSizePt: string;
  answerSizePt: string;
  sourceSizePt: string;
  answerGapPt: string;
  listItemGapPt: string;
  sourceGapPt: string;
}

/** One page of the grid as the template binds it: its deck-wide number and its rows' heights as a grid template. */
export interface MktgFaqPrintPage extends Omit<MktgPrintFaqPage, 'rows'> {
  number: string;
  rowsTemplate: string;
  rows: { entries: MktgFaqPrintEntry[] }[];
}

/** A section divider's strings: `03 · POSITIONING & BRAND`, `Boilerplates`, `4 boilerplates`. */
export interface MktgPrintDividerView {
  eyebrow: string;
  title: string;
  countLine: string;
}

/** The family cover's strings: `ACME MESH · A LINUX FOUNDATION PROJECT`, the newest revision's month ('' when none carries a date), `Positioning & brand`, the brand line (else the tagline, else the parts in words), `Acme Mesh · a Linux Foundation project`, and the versions line of the parts present. */
export interface MktgPrintFamilyCoverView {
  eyebrow: string;
  date: string;
  title: string;
  subtitle: string;
  footerLeft: string;
  footerRight: string;
}

/** The running head and footer of one appendix content page: `03 Boilerplates`, `Acme Mesh Positioning & brand`, `Acme Mesh · a Linux Foundation project`. */
export interface MktgPrintPageChrome {
  eyebrowLeft: string;
  eyebrowRight: string;
  footerLine: string;
}

/** The family print's page plan: each present part's two-digit number, the deck-wide number of the framework's cover, of the kit's cover, of the first card page and of the first grid page (the family cover is 1; every page counts, numbered or not), the dividers' counts, and the file's page count (the back cover included when the kit is present). */
export interface MktgPrintFamilyPlan {
  numbers: Partial<Record<MktgSlidesExportAssetKind, string>>;
  frameworkFirstPage: number;
  kitFirstPage: number;
  boilerplatesFirstPage: number;
  faqFirstPage: number;
  boilerplateCount: number;
  faqQuestionCount: number;
  pageCount: number;
}
