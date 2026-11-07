// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family's Download PDF as a portrait book: one fixed Letter frame per
// page (CSS Paged Media Level 3), the pages planned from the view by one pure
// function, so the contents page, the footers and the openers' page ranges
// all read the same numbers.

import { MKTG_FAMILY_PRINT_PAGE_KINDS } from '../constants/mktg-family-print.constants';
import type { MktgFamilyExportAgentKey } from './mktg-family-export.interface';
import type { MktgPortraitPlanPage } from './mktg-portrait-print.interface';

/** What a frame of the family book holds. */
export type MktgFamilyPrintPageKind = (typeof MKTG_FAMILY_PRINT_PAGE_KINDS)[number];

/**
 * One member document as the family book names it: the chapter's number and
 * title, its version and approval, and what its opener says it holds. A
 * fact the store does not give is null and its line is omitted on the page.
 */
export interface MktgFamilyPrintDocument {
  agentKey: MktgFamilyExportAgentKey;
  /** `01`: the chapter number, in exporter order. */
  number: string;
  /** The family asset's label, e.g. `Messaging framework`. */
  title: string;
  /** The family asset's description: the opener's one line on what the document holds. */
  summary: string;
  /** `V4.0` (one format across the book), '' when the revision carries no number. */
  versionLabel: string;
  /** The approval's date as printed (`6 Nov 2026`), '' when the store gives none. */
  approvedLabel: string;
  /** The approver's display name, null when the store gives none: the line is omitted then. */
  approvedBy: string | null;
  /** The run report's open items (its gaps, a missing asset), for the Sources page's Still open list. */
  openItems: string[];
}

/**
 * One frame of the book: the portrait grammar's plan page (`id`, the
 * running head's `section`, the `title`), with the book's page number and
 * what the frame holds. The framework's and the kit's portrait plans
 * concatenate into the book as pages of the same shape.
 */
export interface MktgFamilyPrintPage extends MktgPortraitPlanPage {
  /** The book's page number, 1-based: the footer's number and the contents page's. */
  n: number;
  kind: MktgFamilyPrintPageKind;
  /** The chapter the page belongs to, null for the cover, contents, Sources page and back cover. */
  agentKey: MktgFamilyExportAgentKey | null;
  /** The FAQ page's index among the FAQ pages (0-based); 0 elsewhere. */
  index: number;
  /** How many printed pages this entry stands for: 1 for a frame, the document's page count for a mounted inner print. */
  span: number;
}

/** One chapter: its opener and the pages after it. */
export interface MktgFamilyPrintChapter {
  document: MktgFamilyPrintDocument;
  /** The opener's page number. */
  openerPage: number;
  /** The first and last content page, as the opener prints them (`4–15`). */
  first: number;
  last: number;
  /** The contents page's rows under the chapter: page title and number. */
  entries: MktgFamilyPrintContentsEntry[];
}

export interface MktgFamilyPrintContentsEntry {
  title: string;
  n: number;
}

/** The FAQ as the book paginates it: the groups of each FAQ page. */
export interface MktgFamilyPrintFaqPage {
  /** Indices into the view's groups. */
  groups: number[];
}

/** The whole book as planned: every frame in order, the chapters, the total. */
export interface MktgFamilyPrintPlan {
  pages: MktgFamilyPrintPage[];
  chapters: MktgFamilyPrintChapter[];
  faqPages: MktgFamilyPrintFaqPage[];
  /** The Sources page's number, 0 when the book has none. */
  sourcesPage: number;
  total: number;
}

/**
 * What the plan reads of a member's content: a document the view holds, the
 * titles of the inner pages it will print (one per page) for a mounted
 * document, the FAQ's group sizes for its pagination, the boilerplates' count.
 */
export interface MktgFamilyPrintPlanMember {
  document: MktgFamilyPrintDocument;
  /** For a mounted inner print (stage 1: the framework and the kit): one title per printed page. */
  innerPageTitles?: string[];
  /** For the FAQ: how many questions each group holds, in order. */
  faqGroupSizes?: number[];
  /** For the boilerplates: how many lengths carry text. */
  boilerplateCount?: number;
}

/** One row of the Sources page's "Where the documents disagree": a real conflict the store names, with the document to re-run. */
export interface MktgFamilyPrintConflict {
  topic: string;
  text: string;
  /** `Re-run the messaging framework.` */
  rerun: string;
}

/** One line of the Sources page's "Still open": the document and the open item. */
export interface MktgFamilyPrintOpenItem {
  document: string;
  text: string;
}

/** One boilerplate card as the book prints it: the length's label and text, the count against the limit, the fill bar's values and the card's size. */
export interface MktgFamilyPrintBoilerplateCard {
  label: string;
  text: string;
  /** `48 words · max 50`. */
  count: string;
  /** The words as a percentage of the limit, uncapped. */
  percent: number;
  /** The fill bar's width, capped at 100. */
  fill: number;
  /** `96 % of the limit`, '' without a limit. */
  percentLabel: string;
  /** `over by 3`, '' within the limit. */
  overLabel: string;
  fontSize: number;
  minHeight: number;
}
