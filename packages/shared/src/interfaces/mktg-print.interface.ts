// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The print documents of the Marketing OS asset views (Download PDF): the
// brand a print is set in, and the Messaging Framework's print as its
// template binds it.

import type { BoilerplatesLengthRow } from './boilerplates.interface';
import type { FaqGroupView } from './faq.interface';
import type {
  FoundationMessageAudienceRow,
  FoundationMessageAvoidRow,
  FoundationMessageGoalView,
  FoundationMessageIcpView,
  FoundationMessageMf,
  FoundationMessageMh,
  FoundationMessageNumberRow,
  FoundationMessagePillarView,
  FoundationMessageReport,
  FoundationMessageViewTab,
} from './foundation-message.interface';
import type { MktgPortraitPlanPage } from './mktg-portrait-print.interface';

/** Boilerplates in contract order, set in the same brand as the framework. */
export interface BoilerplatesPrintView {
  brand: MktgPrintBrand;
  lengths: BoilerplatesLengthRow[];
}

/** FAQ groups, including questions that still need an answer. */
export interface FaqPrintView {
  brand: MktgPrintBrand;
  groups: FaqGroupView[];
}

/** Where a print's brand comes from: the project's stored Brand Kit, or the LF look when the project has none. */
export type MktgPrintBrandSource = 'kit' | 'lf';

/** A logo as a print draws it. */
export interface MktgPrintLogo {
  /** A data URL of the kit's SVG, or the app's own LF logo. */
  src: string;
  alt: string;
  /** CSS filter on the image: the reversed (white) rendering of a full-color lockup, or '' to draw it as it is. */
  filter: string;
}

/** The brand a print is set in: colors, typeface and logo. */
export interface MktgPrintBrand {
  source: MktgPrintBrandSource;
  /** CSS colors: the primary dark, the one accent, a light tint of the dark, and the ink on the dark. */
  dark: string;
  accent: string;
  tint: string;
  onDark: string;
  /** The body text on the white pages: the dark when it reads on white, else the app's darkest gray. The dark stays the ground of the cover and the panels. */
  ink: string;
  /** The CSS font stack the print sets. */
  fontStack: string;
  /** The Google Fonts stylesheet of the typeface, null when the family is not there (or is the app's own). */
  fontUrl: string | null;
  /** The family Download PDF waits for before the dialog opens, null when there is nothing to load. */
  fontFamily: string | null;
  /** The logo on the dark cover, and on the white pages' running heads; null when there is no artwork to draw. */
  logoOnDark: MktgPrintLogo | null;
  logoOnLight: MktgPrintLogo | null;
}

/** One section of the framework print, as the cover lists it. */
export interface FoundationMessagePrintSection {
  id: FoundationMessageViewTab;
  /** `01`. */
  number: string;
  title: string;
}

/** One goal column as the print binds it: the view's column, with its segments as one line. */
export interface FoundationMessagePrintGoal extends FoundationMessageGoalView {
  /** `End users, Maintainers`: the segment names joined, '' when the column names none. */
  segmentLabel: string;
}

/** One segment as the print binds it: the view's segment, with its goals and channels as one line each. */
export interface FoundationMessagePrintIcp extends FoundationMessageIcpView {
  /** `Adoption, Contribution`: the goal titles joined, '' when the segment serves none. */
  goalLabel: string;
  /** `Docs · Slack`: the channels joined. */
  channelsLabel: string;
  /** `Goal 1`, `Goal 4`: one chip per goal the segment serves, by the goal's rank, in the framework's order. */
  goalChips: string[];
}

/** One row of the goals × profiles matrix: the profile, and whether each goal (in the framework's order) is written for it. */
export interface FoundationMessagePrintMatrixRow {
  name: string;
  cells: boolean[];
}

/** One proof point as the key numbers page lists it: the fact, its source and the goal that uses it. */
export interface FoundationMessagePrintFactRow {
  fact: string;
  source: string;
  /** `Goal 2 · Adoption`. */
  usedBy: string;
}

/** The type a framework block is set in before it is fitted: the size px, the line height as a multiple, the weight (a `MktgPortraitFitPara` less its text). */
export interface FoundationMessagePrintType {
  size: number;
  line: number;
  weight: number;
}

/** A text fitted to its box by the portrait fit model: the text (cut at a sentence when it had to be) and the size the model measured it at, px. */
export interface FoundationMessagePrintFittedText {
  text: string;
  size: number;
}

/** One proof point as a goal page lists it: the fact and its source, at the size the list is set at. */
export interface FoundationMessagePrintGoalProof {
  fact: string;
  source: string;
}

/** One "Who it's for" card of a goal page: the profile's name, its need and its call to action, fitted to the card. */
export interface FoundationMessagePrintServedCard {
  id: string;
  name: string;
  need: FoundationMessagePrintFittedText;
  cta: FoundationMessagePrintFittedText;
}

/** A list cut to the rows that fit its room: the rows kept, how many were left off (the muted line under the list says so), and whether the list was tightened first. */
export interface FoundationMessagePrintCutList<T> {
  rows: T[];
  /** The rows left off, 0 when every row printed. */
  cut: number;
  /** True when the list is set in its tight type and padding (tried before any cut). */
  tight: boolean;
  /** The muted line under a cut list, `+N more on the framework's <Framework | Sources> tab in LFX One`; '' when nothing was cut. */
  note: string;
}

/** A goal page as the print lays it out: the value, key message and sound bite fitted, the proof rows cut to what fits, the served cards' lines fitted. */
export interface FoundationMessagePrintGoalPage {
  goal: FoundationMessagePrintGoal;
  /** `01`: the goal's number as the page prints it. */
  numberLabel: string;
  value: FoundationMessagePrintFittedText;
  key: FoundationMessagePrintFittedText;
  /** The proof points above the sound bite: tightened first, then cut to whole rows, in the goal's order. */
  proofs: FoundationMessagePrintCutList<FoundationMessagePrintGoalProof>;
  /** The sound bite in quotes, fitted; null when the goal has none. */
  bite: FoundationMessagePrintFittedText | null;
  /** The profiles the goal's messaging is written for, in the goal's order. */
  served: FoundationMessagePrintServedCard[];
}

/** An ICP page as the print lays it out: the profiles it holds, its intro, the rows' top, and the goals × profiles matrix when it has room. */
export interface FoundationMessagePrintIcpPage {
  /** 1-based, in the book's order. */
  index: number;
  intro: string;
  /** The top of the profile rows, px: under the long intro on the first page, the short one after. */
  rowsTop: number;
  icps: FoundationMessagePrintIcp[];
  /** Goals × profiles, on a page that holds one profile; empty elsewhere. */
  matrix: FoundationMessagePrintMatrixRow[];
}

/**
 * One key number's tile: its share of a row (1 = the row, 2 = a half, 3 = a third; FRAMEWORK_PORTRAIT_TILE_SHARES), wide when it spans
 * the row; the figure's size stepped down until it sits on one line of the tile, and the label fitted (smaller, then cut at a sentence) to
 * the room under it.
 */
export interface FoundationMessagePrintNumberTile extends FoundationMessageNumberRow {
  share: number;
  wide: boolean;
  figureSize: number;
  labelText: string;
  labelSize: number;
}

/**
 * A key numbers page as the print lays it out. Up to FRAMEWORK_PORTRAIT_MAX_TILES figures print as tiles by the count's layout on one page;
 * more print as the key numbers table, every figure, continued on `key-numbers-2`… when a page is full (never cut). The facts table
 * ("Figures and their sources") follows on the last page in the room left, tightened first, then cut to whole rows with the muted
 * line under it.
 */
export interface FoundationMessagePrintNumbersPage {
  /** 1-based, in the book's order. */
  index: number;
  /** The intro sentence, on the first page only ('' after). */
  intro: string;
  /** The tiles, on the first page only when the count allows them. */
  tiles: FoundationMessagePrintNumberTile[];
  /** The key numbers table's rows on this page (more figures than the tiles hold); empty when the tiles print. */
  numbersTable: FoundationMessageNumberRow[];
  /** The top of the key numbers table, px (the tiles' top on the first page, the continuation top after). */
  numbersTop: number;
  /** The top of the facts table, px; null when this page holds no facts (they follow on a later page, or there are none). */
  factsTop: number | null;
  facts: FoundationMessagePrintCutList<FoundationMessagePrintFactRow>;
}

/**
 * The Sources & gaps page as the print lays it out: the run's report cut to the rows that fit, and the approval card. With no report
 * (the record has none) `report` is null: no intro, no lists, the approval card alone.
 */
export interface FoundationMessagePrintSourcesPage {
  /** The lists of an existing report; null when the record has none. */
  report: {
    /** The intro sentence above the lists. */
    intro: string;
    /** The sources read, as stored, without their type prefix, tightened then cut to the rows that fit; the block prints only when there is one. */
    read: FoundationMessagePrintCutList<string>;
    /** `<name> — <reason>` per source that could not be read, tightened then cut to the rows that fit. */
    failed: FoundationMessagePrintCutList<string>;
    /** How many sources could not be read in the report (the empty-state line reads this, not the cut list). */
    failedCount: number;
    /** The gaps as the run wrote them, tightened then cut to the rows that fit. */
    gaps: FoundationMessagePrintCutList<string>;
    /** How many gaps the report holds (the empty-state line reads this, not the cut list). */
    gapsCount: number;
  } | null;
  /** `V1.0 · Approved 6 Nov 2026.`, or `V1.0.`; '' without a version. */
  approvalLead: string;
  approvalNote: string;
}

/** One entry of the cover's contents: a page after the cover with its book page number. */
export interface FoundationMessagePrintContentsEntry {
  id: string;
  title: string;
  /** The book page number. */
  number: number;
  /** `02`: the number as the contents print it. */
  numberLabel: string;
}

/** One anchor question as the say-and-avoid page numbers it. */
export interface FoundationMessagePrintAnchorRow {
  numberLabel: string;
  question: string;
}

/** One frame of the framework's portrait book: its plan page with its book number, printed section label, band, and the page's laid-out data. */
export interface FoundationMessagePrintFrame extends MktgPortraitPlanPage {
  number: number;
  /** The running head's section label as printed (`01 Framework`; `Messaging framework · Framework` inside the family). */
  label: string;
  band: boolean;
  /** The cover's contents, on the cover; empty elsewhere. */
  contents: FoundationMessagePrintContentsEntry[];
  /** The four statements, fitted to their cards, on the framework page. */
  statements: {
    vision: FoundationMessagePrintFittedText;
    mission: FoundationMessagePrintFittedText;
    positioning: FoundationMessagePrintFittedText;
    tagline: FoundationMessagePrintFittedText;
  } | null;
  /** The anchor questions, numbered, on the say-and-avoid page. */
  anchors: FoundationMessagePrintAnchorRow[];
  goalPage: FoundationMessagePrintGoalPage | null;
  icpPage: FoundationMessagePrintIcpPage | null;
  numbersPage: FoundationMessagePrintNumbersPage | null;
  sourcesPage: FoundationMessagePrintSourcesPage | null;
}

/** The Messaging Framework as its print lays it out: every string and color the document binds. */
export interface FoundationMessagePrintView {
  brand: MktgPrintBrand;
  projectName: string;
  /** `Jupyter Foundation · a Linux Foundation project`, over the title and in the footers. */
  eyebrow: string;
  title: string;
  /** `V3.0`, '' when the page shows no version (the one format every document of the family prints). */
  versionLabel: string;
  /** `Approved 6 Nov 2026`, '' when the approval's date is not known. */
  approvedLabel: string;
  /** `6 Nov 2026`: the approval's date, '' when not known. */
  dateLabel: string;
  /** The project's web host (`aaif.io`) from its Brand Kit; '' without one. */
  website: string;
  /** `4 Nov 2026`: the day the run read its sources (the stored record's `inputs_record.date_read`), '' when the revision does not carry one. */
  dateReadLabel: string;
  /** The run's report, as the Sources & gaps page prints it (what was read, what could not be, the gaps); null when the revision's record carries none. */
  report: FoundationMessageReport | null;
  /** `Jupyter Foundation Messaging Framework`. */
  runningHead: string;
  sections: FoundationMessagePrintSection[];
  /** Every goal's proof points with their sources, for the key numbers page. */
  facts: FoundationMessagePrintFactRow[];
  mf: FoundationMessageMf;
  mh: FoundationMessageMh;
  goals: FoundationMessagePrintGoal[];
  icps: FoundationMessagePrintIcp[];
  pillars: FoundationMessagePillarView[];
  avoidRows: FoundationMessageAvoidRow[];
  numbers: FoundationMessageNumberRow[];
  audiences: FoundationMessageAudienceRow[];
}
