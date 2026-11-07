// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family's Download PDF as a portrait book (mktg-family-print): the copy
// the family's own pages print, their pagination rules and sizes. The frame,
// its tokens and inks are the portrait grammar's (mktg-portrait-print.constants.ts).

import { lfxColors } from './colors.constants';

/** The one ink the portrait grammar's tokens have not got: a boilerplate over its limit. */
export const MKTG_FAMILY_PRINT_WARN_INK = lfxColors.amber[700];

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

/** The body text sizes of the four boilerplate cards, longest last, and the cards' minimum heights (px). */
export const MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES = [
  { fontSize: 16.5, minHeight: 96 },
  { fontSize: 16.5, minHeight: 108 },
  { fontSize: 14, minHeight: 130 },
  { fontSize: 12.5, minHeight: 150 },
] as const;
