// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family PDF's own pages (Download PDF on the family card): the appendix
// spec's numbers (v1.3), pt on the deck's 720 × 405 pt slide, in one place.
// The page frame, its scale and the fit thresholds are the shell's.

import type { MktgPrintPageBox } from '../interfaces/mktg-print-page.interface';
import type { MktgPrintAppendixLayout, MktgPrintDividerLayout } from '../interfaces/mktg-print-pages.interface';

/** The family's sections, as the deck's cover, section dividers and page titles name them (the exporter's SECTION_TITLES). */
export const MKTG_PRINT_SECTION_TITLES = {
  framework: 'Messaging framework',
  kit: 'Brand kit',
  boilerplates: 'Boilerplates',
  faq: 'Questions and answers',
} as const;

/** The dividers' count lines: the noun for one and for several. */
export const MKTG_PRINT_DIVIDER_NOUNS = {
  boilerplates: { one: 'boilerplate', many: 'boilerplates' },
  faq: { one: 'question and answer', many: 'questions and answers' },
} as const;

/** The source line's lead on a pair that carries a source: `Source · Website`. */
export const MKTG_PRINT_SOURCE_LEAD = 'Source';

/**
 * The appendix spec §1 (two bordered card columns, a "LABEL · N WORDS" line tracked +0.08em, the body at the card
 * size) and §2 (two open Q/A columns, the page set at 100, 95 or 90 % before it is full, the deck's gaps between an
 * answer's paragraphs: the answer's under the question, 2 pt between items, shares of the answer size after a list
 * and before one, none between two plain paragraphs).
 */
export const MKTG_PRINT_APPENDIX_LAYOUT: MktgPrintAppendixLayout = {
  cardColumnGap: 9,
  cardRowGap: 9,
  cardBorder: 0.75,
  cardRadius: 4,
  cardPaddingX: 9,
  cardPaddingY: 7.5,
  cardBodyGap: 4,
  cardMinHeight: 60,
  cardRowMinScale: 0.8,
  cardLoneMinHeight: 132,
  cardLabelTracking: 0.08,
  faqColumnGap: 16.5,
  faqRowGap: 7.5,
  faqQuestionSize: 10,
  faqQuestionWeight: 700,
  faqAnswerSize: 9,
  faqAnswerGap: 3,
  faqListItemGap: 2,
  faqPlainAfterBulletEm: 0.5,
  faqBulletAfterPlainEm: 0.4,
  faqSourceGap: 3,
  faqPageScales: [1, 0.95, 0.9],
};

/** The appendix spec §3 (v1.3): the divider's boxes and sizes on the dark section page, and the count line's `softOnDark` mix. */
export const MKTG_PRINT_DIVIDER_LAYOUT: MktgPrintDividerLayout = {
  eyebrow: { x: 25, y: 140, w: 671, h: 24 },
  title: { x: 25, y: 169, w: 671, h: 66 },
  count: { x: 25, y: 238, w: 671, h: 28 },
  titleSize: 30,
  countSize: 11,
  softShare: 0.3,
};

/** The least contrast of the divider's eyebrow in the accent against the dark before it is set in the on-dark ink: 3:1 per the appendix spec v1.3 (the WCAG 2.1 SC 1.4.11 threshold). */
export const MKTG_PRINT_DIVIDER_EYEBROW_MIN_CONTRAST = 3;

/** The family cover's title size, pt (the appendix spec §4). */
export const MKTG_PRINT_FAMILY_COVER_TITLE_SIZE = 40;

/** The family cover's title and subtitle boxes (the appendix spec §4), passed to the shell's cover in place of the kit's. */
export const MKTG_PRINT_FAMILY_COVER_BOXES: { title: MktgPrintPageBox; subtitle: MktgPrintPageBox } = {
  title: { x: 38, y: 126, w: 624, h: 139 },
  subtitle: { x: 38, y: 265, w: 624, h: 66 },
};
