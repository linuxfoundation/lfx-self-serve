// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family's Download PDF as a portrait book (mktg-family-print): the
// frame's geometry, the neutral inks, the copy the family's own pages print
// and the pagination rules. The brand (dark, accent, typeface, logo) is the
// print brand of mktg-print.constants.ts; every measurement here is the
// design board's, in CSS px at 96 dpi on a US Letter frame.

import { lfxColors } from './colors.constants';

/**
 * One fixed frame per page: US Letter at 96 dpi (8.5 × 11 in), 56 px margins,
 * so the content column is 704 px wide (x 56–760). Covers and openers inset
 * 72 px. Nothing flows across a frame: where the data's size varies, the
 * number of frames varies (MKTG_FAMILY_PRINT_FAQ_SINGLE_PAGE_MAX).
 */
export const MKTG_FAMILY_PRINT_FRAME = {
  width: 816,
  height: 1056,
  margin: 56,
  /** The inset of the cover, the openers and the back cover. */
  coverInset: 72,
  /** Content column width: the frame less both margins. */
  contentWidth: 704,
  /** The running head's top, the title's top, the body's top and the footer's bottom offset. */
  headTop: 36,
  titleTop: 84,
  bodyTop: 136,
  footBottom: 28,
} as const;

/**
 * The named page of the family book, written both named (styles/mktg-family-print.scss, on the print
 * body) and unnamed (the print frame's own rule, MKTG_PRINT_PAGE_SETUPS): Chromium honours a body's
 * inherited page name over an unnamed rule, and WebKit ignores names.
 */
export const MKTG_FAMILY_PRINT_PAGE_NAME = 'mktg-family-portrait';

/** The neutral inks of the white pages: body ink, muted labels and captions, hairlines, the light tint ground. */
export const MKTG_FAMILY_PRINT_NEUTRALS = {
  ink: lfxColors.gray[800],
  muted: lfxColors.gray[500],
  hairline: lfxColors.gray[200],
  mist: lfxColors.gray[100],
  /** The one warning ink: a boilerplate over its limit. */
  warn: lfxColors.amber[700],
} as const;

/** What a frame of the book holds; `framework` and `kit` are the mounted inner prints (stage 1) or their portrait pages. */
export const MKTG_FAMILY_PRINT_PAGE_KINDS = ['cover', 'contents', 'opener', 'framework', 'kit', 'boilerplates', 'faq', 'sources', 'back'] as const;

/** The FAQ prints on one two-column page up to this many questions; past it, two groups a page. */
export const MKTG_FAMILY_PRINT_FAQ_SINGLE_PAGE_MAX = 8;

/** The FAQ's groups per page once it paginates. */
export const MKTG_FAMILY_PRINT_FAQ_GROUPS_PER_PAGE = 2;

/** The running head's left label and the title of the family's own pages. */
export const MKTG_FAMILY_PRINT_LABELS = {
  cover: 'Cover',
  contents: 'Contents',
  boilerplates: 'Boilerplates',
  faq: 'Frequently asked questions',
  sources: 'Sources',
  sourcesTitle: 'Sources across the documents',
  backCover: 'Back cover',
  version: 'Version',
  approved: 'Approved',
  pages: 'Pages',
  inThisBook: 'In this book',
  disagree: 'Where the documents disagree',
  stillOpen: 'Still open',
  notesFromTheRun: 'Notes from the run',
  builtFrom: 'Built from',
  document: 'Document',
  linuxFoundationProject: 'a Linux Foundation project',
} as const;

/** The copy of the family's own pages; `[Project]` is the project's name, counts are filled by the plan. */
export const MKTG_FAMILY_PRINT_COPY = {
  coverPurpose:
    'The living documents of [Project] in one reference: what we say, how it looks, the approved descriptions, and the answers to common questions.',
  /** `[Documents]` and `[Pages]` are the counts. */
  contentsIntro:
    '[Documents] documents, [Pages] pages. Each opens on a chapter page that names its version and approval date; each keeps its own Sources page, and the last page checks them against one another.',
  /** `[Date]` is the printed date. */
  contentsNote:
    'Versions are the approved revisions in LFX One on [Date]. A page’s running head names its document; the footer carries the book’s page number.',
  boilerplatesIntro: 'Approved lengths of the same description. Use them as written; cut from the end, never rephrase.',
  /** `[Questions]` and `[Groups]` are the counts. */
  faqIntro: '[Questions] questions in [Groups] groups, each answered from the framework or a source it names.',
  sourcesIntro:
    'What version of each document this book holds, where the documents disagree, and what is still open. Each document keeps its own Sources page; this one is the cross-check.',
  /** The word count under a boilerplate's label: `[Words]` and `[Max]`. */
  words: '[Words] words · max [Max]',
  /** The fill bar's caption: `[Percent]`. */
  ofTheLimit: '[Percent] % of the limit',
  /** Over the limit by `[Over]` words. */
  overBy: 'over by [Over]',
  /** The back cover's provenance line, after the trademark notice. */
  backCoverProvenance: 'Generated from the approved documents listed on the Sources page; versions and dates are on each opener.',
} as const;

/**
 * Stage 1: the brand kit print on main mounts inside the family as its five
 * chapter tables, one page each as a count; these are their titles, in the
 * print's order, for the contents page. The portrait kit pages replace both
 * the print and this list with their own exported plan.
 */
export const MKTG_FAMILY_PRINT_STAGE1_KIT_PAGE_TITLES = ['Logo system', 'Colour', 'Typography', 'Visual', 'Voice in brief'] as const;

/** The body text sizes of the four boilerplate cards, longest last, and the cards' minimum heights (px). */
export const MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES = [
  { fontSize: 16.5, minHeight: 96 },
  { fontSize: 16.5, minHeight: 108 },
  { fontSize: 14, minHeight: 130 },
  { fontSize: 12.5, minHeight: 150 },
] as const;
