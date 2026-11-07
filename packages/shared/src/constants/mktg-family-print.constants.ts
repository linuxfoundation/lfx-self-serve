// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family's Download PDF as a portrait book (mktg-family-print): the copy
// the family's own pages print, their pagination rules and sizes. The frame,
// its tokens and inks are the portrait grammar's (mktg-portrait-print.constants.ts).

import { lfxColors } from './colors.constants';
import type { MktgPortraitDocumentKind } from '../interfaces/mktg-portrait-print.interface';

/** The one ink the portrait grammar's tokens have not got: a boilerplate over its limit. */
export const MKTG_FAMILY_PRINT_WARN_INK = lfxColors.amber[700];

/** The family book's running head names the project and the family as the grammar names a document (`<project> positioning & brand`): the grammar's own kind for it, so the compiler checks the name. */
export const MKTG_FAMILY_PRINT_HEAD_KIND: MktgPortraitDocumentKind = 'positioning & brand';

/**
 * The family book's root class beside the grammar's: the one rule the family lays over every running head in its
 * book (its own pages', the framework's and the kit's) hangs on it — `styles/mktg-family-print.scss`, which cannot
 * read this — so a document's standalone print keeps the grammar's heads as they are.
 */
export const MKTG_FAMILY_PRINT_BOOK_CLASS = 'lfx-mktg-family-book';

/**
 * The book's modifier when its running head's document name (`<project> positioning & brand`) runs long: the head
 * prints that name one step smaller (9 px, the grammar's label is 10 px) before it ever cuts it with an ellipsis, so
 * a long project name is not cut mid-word on every page. From `MKTG_FAMILY_PRINT_HEAD_TIGHT_FROM` characters: at
 * 10 px and 0.12 em tracking the head's right side holds about 44 beside the longest mounted section label
 * (`Brand kit · Logo colorways`) within the 640 px content width and the 24 px gap.
 */
export const MKTG_FAMILY_PRINT_HEAD_TIGHT_CLASS = 'lfx-mktg-family-book--tight-head';
export const MKTG_FAMILY_PRINT_HEAD_TIGHT_FROM = 44;

/** What a frame of the book holds; `framework` and `kit` are the inner prints' own portrait pages in the family's book. */
export const MKTG_FAMILY_PRINT_PAGE_KINDS = ['cover', 'contents', 'opener', 'framework', 'kit', 'boilerplates', 'faq', 'sources', 'back'] as const;

/**
 * The FAQ grid's budget per page (px of the frame): two columns from `top` to
 * `bottom`, each entry's padding and its group heading's height, and the
 * type the fit model measures (MKTG_PORTRAIT_FIT): the plan fills the columns
 * in order and opens a new page when both are full, so nothing is cut.
 */
export const MKTG_FAMILY_PRINT_FAQ_LAYOUT = {
  top: 200,
  bottom: 1000,
  columnGap: 32,
  /** The group's label and the gap under it. */
  heading: 26,
  /** The entry's padding above and below its text. */
  entryPadding: 26,
  question: { size: 13.5, line: 1.35, weight: 600 },
  answer: { size: 12, line: 1.55, above: 6 },
  /** The source chip's line. */
  source: 24,
} as const;

/** The Sources page's fixed blocks: the conflicts' y and the Still open block's two y's, the page's bottom, and the rows' type for the fit model. */
export const MKTG_FAMILY_PRINT_SOURCES_LAYOUT = {
  conflictsTop: 410,
  openTop: 690,
  bottom: 1000,
  heading: 26,
  topicWidth: 130,
  gap: 18,
  conflict: { size: 12, line: 1.45, padding: 16 },
  open: { size: 11.5, line: 1.45, padding: 14 },
  /** The document chip's type (the grammar's `pp-chip`) and its horizontal padding. */
  chip: { size: 8.5, padding: 14 },
} as const;

/**
 * The boilerplate cards' room as the board draws them: the cards' y and the bottom they may reach (above the Built from
 * block), the gap between cards, a card's vertical padding and horizontal inset, the meta column and its gap (what the
 * text column loses of the page's measure), and the text's line height. The cards' sum of heights is held to the room
 * by cutting the longest text from the end, never in silence.
 */
export const MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT = {
  top: 210,
  bottom: 900,
  gap: 12,
  padding: 48,
  inset: 52,
  metaWidth: 120,
  metaGap: 28,
  line: 1.5,
} as const;

/** The boilerplates page's run block at the foot (Built from): its y and bottom, the heading and the list's type. */
export const MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT = {
  top: 912,
  bottom: 1000,
  heading: 26,
  /** The list's indent. */
  indent: 16,
  item: { size: 11, line: 1.55 },
} as const;

/** Words before a figure that round it (`over 7,000 code contributors`): such a figure is no other count of the measure. */
export const MKTG_FAMILY_PRINT_ROUNDING_WORDS: readonly string[] = [
  'over',
  'more than',
  'nearly',
  'almost',
  'about',
  'around',
  'some',
  'roughly',
  'at least',
  'up to',
  'close to',
];

/**
 * A FAQ answer's source as the family book's chip prints it, by the stored word in lower case; '' prints no chip. The
 * run's `Notes` is an internal source label, so it prints none (the editor's final round of 7 Nov 2026). A source not
 * named here prints as stored.
 */
export const MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS: Readonly<Record<string, string>> = { notes: '' };

/**
 * Words a run's source list uses for its own machinery, which a Built from row drops when they stand alone in
 * parentheses (`Approved messaging framework (intake)` → `Approved messaging framework`): a reader of the book has no
 * intake form.
 */
export const MKTG_FAMILY_PRINT_INTERNAL_SOURCE_TERMS: readonly string[] = ['intake'];

/**
 * A record's source field, in the words a reader uses for it, by the field's name in lower case (`site_css` is the
 * site's stylesheet, not "site css"); a field not named here prints its words with the underscores as spaces.
 */
export const MKTG_FAMILY_PRINT_SOURCE_FIELD_WORDS: Readonly<Record<string, string>> = { site_css: 'site stylesheet', brand_page: 'brand page' };

/** Words of a key number's label that name no thing to count. */
export const MKTG_FAMILY_PRINT_LABEL_STOP_WORDS: readonly string[] = [
  'more',
  'than',
  'over',
  'with',
  'from',
  'since',
  'total',
  'active',
  'across',
  'about',
  'nearly',
  'almost',
  'around',
  'last',
  'past',
  'months',
  'years',
];

/** The running head's left label and the title of the family's own pages (the board's: `Contents`, `Sources`; a document's pages carry its numbered chapter). */
export const MKTG_FAMILY_PRINT_LABELS = {
  cover: 'Cover',
  contents: 'Contents',
  boilerplates: 'Boilerplates',
  faq: 'Frequently asked questions',
  /** After a group's heading where the group goes on from an earlier column or page (the editor's S1). */
  faqContinued: '(continued)',
  sources: 'Sources',
  sourcesTitle: 'Sources across the documents',
  backCover: 'Back cover',
  version: 'Version',
  approved: 'Approved',
  pages: 'Pages',
  inThisBook: 'In this book',
  disagree: 'Where the documents disagree',
  stillOpen: 'Still open',
  builtFrom: 'Built from',
  document: 'Document',
  data: 'Data',
} as const;

/** The copy of the family's own pages; `[Project]` is the project's name, counts are filled by the plan. */
export const MKTG_FAMILY_PRINT_COPY = {
  coverPurpose:
    'The living documents of [Project] in one reference: what we say, how it looks, the approved descriptions, and the answers to common questions.',
  /** `[Documents]` and `[Pages]` are the counts (the editor's round of 7 Nov 2026 cut the sentence on the openers and the running head). */
  contentsIntro: '[Documents] documents, [Pages] pages.',
  /** `[Date]` is the printed date. */
  contentsNote: 'Versions are the approved revisions in LFX One on [Date].',
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
  /** The Sources table's Data cell: `[Date]` is the date the run read its figures (the record's `date_read`, else its generation date). */
  figuresAsOf: 'figures as of [Date]',
  /** Under a fitted block whose rows did not all fit: `[Count]` rows more, never dropped in silence. */
  cutNote: '+[Count] more in LFX One',
  /** Under a boilerplate cut from the end to fit its card: the words that did not print. */
  cutWords: '+[Count] words in LFX One',
  /** A list in prose: `[Items]` the first ones joined with commas, `[Last]` the last. */
  lastOfList: '[Items] and [Last]',
  /** A key-number conflict: `[Number]` and `[Label]` are the framework's, `[Document]` the other document's title, `[Sentence]` what it says. */
  numberConflict: 'The framework’s key numbers say [Number] [Label]; the [Document] says “[Sentence]”',
  /** The brand-line conflict: `[Line]` is the kit's, `[Tagline]` the framework's. */
  brandLineConflict: 'The brand kit carries “[Line]”; the framework’s tagline is “[Tagline]”.',
  /** A color the kit read with two values: `[Values]` is `#FF702D from the brand page and #FF7D2D from the site stylesheet`. */
  colorConflict: 'The [Kit] reads [Name] as [Values]; it keeps [Chosen].',
  /** One of a color's readings: `[Hex]` and where the kit read it (omitted when the record names no readable source). */
  colorReading: '[Hex] from the [Source]',
  /** The document to re-run after a conflict with the framework: `[Document]`. */
  rerunAgainstFramework: 'Re-run the [Document] so it reads the approved framework.',
  /** The topic of the brand-line conflict. */
  brandLineTopic: 'Brand line',
} as const;

/** The body text sizes of the four boilerplate cards, longest last, and the cards' minimum heights (px). */
export const MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES = [
  { fontSize: 16.5, minHeight: 96 },
  { fontSize: 16.5, minHeight: 108 },
  { fontSize: 14, minHeight: 130 },
  { fontSize: 12.5, minHeight: 150 },
] as const;

/**
 * The contents page's two columns (px of the frame): from `top` to `bottom`,
 * the chapter row's and an entry's type for the fit model, and the room the
 * last column keeps for the Sources row and the note under it. The plan
 * fills the columns by measured height, a chapter continuing under a repeated
 * row; what one page cannot hold is counted in a cut note, never clipped.
 */
export const MKTG_FAMILY_PRINT_CONTENTS_LAYOUT = {
  top: 210,
  bottom: 1000,
  columnGap: 32,
  /** The chapter row: 14 px above and 6 below its 20 px title; the number, version and page cells take `aside` of its width. */
  chapter: { size: 20, line: 1.2, padding: 20, weight: 500, aside: 110 },
  /** An entry row: 4 px above and below its 12 px title, indented 36, the page number's cell at the right. */
  entry: { size: 12, line: 1.3, padding: 8, indent: 36, numberWidth: 28 },
  /** The Sources row (a chapter row without entries) and the note under it, kept free on the last column. */
  tail: 124,
} as const;

/** The Sources page's action after a colour the kit read with two values: `[Document]` is the kit, `[Name]` the colour. */
export const MKTG_FAMILY_PRINT_RERUN_ON_COLOR = 'Re-run the [Document] once its sources agree on [Name].';
