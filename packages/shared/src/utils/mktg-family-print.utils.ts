// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family's Download PDF as a portrait book: the plan of its pages, pure
// over the view, so the contents page, the footers and the openers' page
// ranges are one set of numbers, and the counts move with the data while the
// layout never does (one fixed frame per page).

import { MKTG_FAMILY_EXPORT_KINDS } from '../constants/mktg-family-export.constants';
import {
  MKTG_FAMILY_PRINT_FAQ_GROUPS_PER_PAGE,
  MKTG_FAMILY_PRINT_FAQ_SINGLE_PAGE_MAX,
  MKTG_FAMILY_PRINT_LABELS,
} from '../constants/mktg-family-print.constants';
import { mktgPortraitPageNumber } from './mktg-portrait-print.utils';
import { MKTG_KIT_FAMILIES } from '../constants/mktg-kit.constants';
import type { BrandKitReportColorConflict } from '../interfaces/brand-kit.interface';
import type { FoundationMessageNumberRow } from '../interfaces/foundation-message.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import type { MktgFamilyExportAgentKey } from '../interfaces/mktg-family-export.interface';
import type {
  MktgFamilyPrintChapter,
  MktgFamilyPrintConflict,
  MktgFamilyPrintContentsEntry,
  MktgFamilyPrintDocument,
  MktgFamilyPrintFaqPage,
  MktgFamilyPrintOpenItem,
  MktgFamilyPrintPage,
  MktgFamilyPrintPlan,
  MktgFamilyPrintPlanMember,
} from '../interfaces/mktg-family-print.interface';

/** One version format across the book, the kit cover's: `V4.0`; '' when the revision carries no number. */
export function mktgFamilyPrintVersionLabel(version: number | null | undefined): string {
  return typeof version === 'number' && Number.isFinite(version) ? `V${version}.0` : '';
}

/** `6 Nov 2026`, in UTC so the same revision always prints the same date; '' when the value is not a date. */
export function mktgFamilyPrintDate(iso: string | null | undefined): string {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(time));
}

/** `4–15`, or `4` when the chapter is one page. */
export function mktgFamilyPrintPageRange(first: number, last: number): string {
  return first === last ? String(first) : `${first}–${last}`;
}

/** Fills `[Name]` slots of a copy constant: `fill(copy, { Project: 'X' })`. */
export function mktgFamilyPrintFill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.split(`[${name}]`).join(String(value)), template);
}

/**
 * One member document as the book names it: the chapter number in exporter
 * order, the family asset's label and description (the product's own words
 * for the document, never a literal per agent), the revision's version and
 * approval as printed, and the run report's open items.
 */
export function mktgFamilyPrintDocument(
  familyId: string,
  agentKey: MktgFamilyExportAgentKey,
  number: number,
  version: number | null | undefined,
  approval: MktgRevisionApproval | null,
  openItems: string[]
): MktgFamilyPrintDocument {
  const asset = MKTG_KIT_FAMILIES.find((family) => family.id === familyId)?.assets.find((entry) => entry.agentKey === agentKey);
  return {
    agentKey,
    number: mktgPortraitPageNumber(number),
    title: asset?.label ?? agentKey,
    summary: asset?.bookSummary ?? asset?.description ?? '',
    versionLabel: mktgFamilyPrintVersionLabel(version),
    approvedLabel: mktgFamilyPrintDate(approval?.approvedAt),
    approvedBy: approval?.approvedBy?.name?.trim() || null,
    openItems: openItems.map((item) => item.trim()).filter(Boolean),
  };
}

/**
 * The FAQ's pages: every group on one two-column page while the FAQ holds at
 * most MKTG_FAMILY_PRINT_FAQ_SINGLE_PAGE_MAX questions, else two groups a page.
 * Empty groups are not printed. No page with no questions.
 */
export function mktgFamilyPrintFaqPages(groupSizes: number[]): MktgFamilyPrintFaqPage[] {
  const groups = groupSizes.map((size, index) => ({ size, index })).filter((group) => group.size > 0);
  const total = groups.reduce((sum, group) => sum + group.size, 0);
  if (total === 0) return [];
  if (total <= MKTG_FAMILY_PRINT_FAQ_SINGLE_PAGE_MAX) return [{ groups: groups.map((group) => group.index) }];
  const pages: MktgFamilyPrintFaqPage[] = [];
  for (let start = 0; start < groups.length; start += MKTG_FAMILY_PRINT_FAQ_GROUPS_PER_PAGE) {
    pages.push({ groups: groups.slice(start, start + MKTG_FAMILY_PRINT_FAQ_GROUPS_PER_PAGE).map((group) => group.index) });
  }
  return pages;
}

/**
 * The book's plan: cover, contents, then per member document an opener and
 * its pages (a mounted inner print counts its page titles, the boilerplates
 * one page of cards, the FAQ its paginated grid), the Sources page and the
 * back cover. A document with nothing to print is dropped with its opener.
 * Page numbers are 1-based and the only numbering the pages print.
 */
export function mktgFamilyPrintPlan(members: MktgFamilyPrintPlanMember[]): MktgFamilyPrintPlan {
  const pages: MktgFamilyPrintPage[] = [];
  const chapters: MktgFamilyPrintChapter[] = [];
  let faqPages: MktgFamilyPrintFaqPage[] = [];
  let n = 0;
  const push = (page: Omit<MktgFamilyPrintPage, 'n'>): MktgFamilyPrintPage => {
    const entry = { ...page, n: n + 1 };
    pages.push(entry);
    n += page.span;
    return entry;
  };
  push({ id: 'cover', kind: 'cover', section: MKTG_FAMILY_PRINT_LABELS.cover, title: '', agentKey: null, index: 0, span: 1 });
  push({
    id: 'contents',
    kind: 'contents',
    section: MKTG_FAMILY_PRINT_LABELS.contents,
    title: MKTG_FAMILY_PRINT_LABELS.contents,
    agentKey: null,
    index: 0,
    span: 1,
  });
  for (const member of members) {
    const { document } = member;
    const kind = MKTG_FAMILY_EXPORT_KINDS[document.agentKey];
    const section = `${document.number} ${document.title}`;
    const entries: MktgFamilyPrintContentsEntry[] = [];
    const openerPage = n + 1;
    const first = openerPage + 1;
    const content: Omit<MktgFamilyPrintPage, 'n'>[] = [];
    if (kind === 'framework' || kind === 'kit') {
      const titles = member.innerPageTitles?.filter((title) => title.trim()) ?? [];
      const span = Math.max(titles.length, 1);
      content.push({ id: kind, kind, section, title: document.title, agentKey: document.agentKey, index: 0, span });
      (titles.length ? titles : [document.title]).forEach((title, index) => entries.push({ title, n: first + index }));
    } else if (kind === 'boilerplates') {
      if ((member.boilerplateCount ?? 0) > 0) {
        content.push({ id: kind, kind, section, title: MKTG_FAMILY_PRINT_LABELS.boilerplates, agentKey: document.agentKey, index: 0, span: 1 });
        entries.push({ title: MKTG_FAMILY_PRINT_LABELS.boilerplates, n: first });
      }
    } else {
      faqPages = mktgFamilyPrintFaqPages(member.faqGroupSizes ?? []);
      faqPages.forEach((_, index) => {
        const title = index === 0 ? MKTG_FAMILY_PRINT_LABELS.faq : `${MKTG_FAMILY_PRINT_LABELS.faq} (${index + 1})`;
        content.push({ id: `${kind}-${index + 1}`, kind, section, title, agentKey: document.agentKey, index, span: 1 });
        entries.push({ title, n: first + index });
      });
    }
    if (!content.length) continue;
    push({ id: `opener-${document.agentKey}`, kind: 'opener', section, title: '', agentKey: document.agentKey, index: 0, span: 1 });
    content.forEach(push);
    chapters.push({ document, openerPage, first, last: n, entries });
  }
  let sourcesPage = 0;
  if (chapters.length) {
    sourcesPage = push({
      id: 'sources',
      kind: 'sources',
      section: MKTG_FAMILY_PRINT_LABELS.sources,
      title: MKTG_FAMILY_PRINT_LABELS.sourcesTitle,
      agentKey: null,
      index: 0,
      span: 1,
    }).n;
  }
  push({ id: 'back-cover', kind: 'back', section: MKTG_FAMILY_PRINT_LABELS.backCover, title: '', agentKey: null, index: 0, span: 1 });
  return { pages, chapters, faqPages, sourcesPage, total: n };
}

/** The Sources page's Still open list: each chapter's open items, in chapter order, with the document's title. */
export function mktgFamilyPrintOpenItems(chapters: MktgFamilyPrintChapter[]): MktgFamilyPrintOpenItem[] {
  return chapters.flatMap((chapter) => chapter.document.openItems.map((text) => ({ document: chapter.document.title, text })));
}

/** A document's text the framework's key numbers are read against: its title in the book and what it says. */
export interface MktgFamilyPrintNumberSource {
  title: string;
  texts: string[];
}

/** Words of a key number's label that name no thing to count. */
const MKTG_FAMILY_PRINT_LABEL_STOP_WORDS = new Set([
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
]);

/** The digits of a figure as text: `$10,000` → `10000`, `1.2M` → `1.2`; '' when it holds none. */
function mktgFamilyPrintFigure(text: string): string {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(text);
  return match ? match[0].replace(/,/g, '') : '';
}

/** The stem of the label's first counting word (`members` → `member`), '' when the label has none. */
function mktgFamilyPrintLabelStem(label: string): string {
  const word = label
    .toLocaleLowerCase()
    .split(/[^a-z]+/)
    .find((candidate) => candidate.length >= 4 && !MKTG_FAMILY_PRINT_LABEL_STOP_WORDS.has(candidate));
  return word ? word.replace(/s$/, '') : '';
}

/**
 * The framework's key numbers read against the other documents' own text:
 * a sentence that names the same thing (the label's counting word) with a
 * different figure, and not the framework's, is a row, quoting both. One
 * row per key number and document; a figure the texts repeat is not one.
 * The document to re-run is the other one: the framework is the source.
 */
export function mktgFamilyPrintNumberConflicts(numbers: FoundationMessageNumberRow[], sources: MktgFamilyPrintNumberSource[]): MktgFamilyPrintConflict[] {
  const conflicts: MktgFamilyPrintConflict[] = [];
  for (const row of numbers) {
    const figure = mktgFamilyPrintFigure(row.number);
    const stem = mktgFamilyPrintLabelStem(row.label);
    if (!figure || !stem) continue;
    const stemPattern = new RegExp(`\\b${stem}`, 'i');
    for (const source of sources) {
      const sentence = source.texts
        .flatMap((text) => text.split(/(?<=[.!?])\s+/))
        .map((part) => part.trim())
        .find((part) => {
          if (!stemPattern.test(part)) return false;
          const figures = (part.match(/\$?\d[\d,]*(?:\.\d+)?/g) ?? []).map(mktgFamilyPrintFigure);
          return figures.length > 0 && !figures.includes(figure);
        });
      if (!sentence) continue;
      const label = row.label.trim();
      conflicts.push({
        topic: label.charAt(0).toLocaleUpperCase() + label.slice(1),
        text: `The framework's key numbers say ${row.number.trim()} ${label}; the ${source.title} says “${sentence}”`,
        rerun: `Re-run the ${source.title} so it reads the approved framework.`,
      });
    }
  }
  return conflicts;
}

/**
 * The Sources page's "Where the documents disagree": only what the store
 * names. The kit's brand line against the framework's tagline when both
 * exist and differ, and the kit report's colour conflicts (one colour read
 * with two values); the key numbers' rows are mktgFamilyPrintNumberConflicts.
 * Nothing else is a conflict the book may claim.
 */
export function mktgFamilyPrintConflicts(tagline: string, kitLine: string, colorConflicts: BrandKitReportColorConflict[]): MktgFamilyPrintConflict[] {
  const conflicts: MktgFamilyPrintConflict[] = [];
  const line = kitLine.trim();
  const tag = tagline.trim();
  if (line && tag && line.toLocaleLowerCase() !== tag.toLocaleLowerCase()) {
    conflicts.push({
      topic: 'Brand line',
      text: `The brand kit carries “${line}”; the framework’s tagline is “${tag}”.`,
      rerun: 'Re-run the brand kit so it reads the approved framework.',
    });
  }
  for (const conflict of colorConflicts) {
    const values = conflict.values.filter((value) => value.hex.trim());
    if (values.length < 2) continue;
    conflicts.push({
      topic: conflict.name,
      text: values.map((value) => `${value.source} ${value.hex.toUpperCase()}`).join('; ') + `. The kit keeps ${conflict.chosen.toUpperCase()}.`,
      rerun: '',
    });
  }
  return conflicts;
}
