// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family's Download PDF as a portrait book: the plan of its pages, pure
// over the view, so the contents page, the footers and the openers' page
// ranges are one set of numbers, and the counts move with the data while the
// layout never does (one fixed frame per page).

import { MKTG_FAMILY_EXPORT_KINDS } from '../constants/mktg-family-export.constants';
import {
  MKTG_FAMILY_PRINT_CONTENTS_LAYOUT,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_FAQ_LAYOUT,
  MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_LABEL_STOP_WORDS,
  MKTG_FAMILY_PRINT_ROUNDING_WORDS,
  MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT,
  MKTG_FAMILY_PRINT_SOURCES_LAYOUT,
} from '../constants/mktg-family-print.constants';
import { MKTG_KIT_FAMILIES } from '../constants/mktg-kit.constants';
import { MKTG_PORTRAIT_FIT, MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import type { BrandKitReportColorConflict } from '../interfaces/brand-kit.interface';
import type { FaqGroupView } from '../interfaces/faq.interface';
import type { FoundationMessageNumberRow } from '../interfaces/foundation-message.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import type { MktgFamilyExportAgentKey } from '../interfaces/mktg-family-export.interface';
import type {
  MktgFamilyPrintChapter,
  MktgFamilyPrintConflict,
  MktgFamilyPrintContentsBlock,
  MktgFamilyPrintContentsEntry,
  MktgFamilyPrintContentsLayout,
  MktgFamilyPrintDocument,
  MktgFamilyPrintFaqItem,
  MktgFamilyPrintFaqPage,
  MktgFamilyPrintFaqPlanGroup,
  MktgFamilyPrintFitRows,
  MktgFamilyPrintTextSource,
  MktgFamilyPrintOpenItem,
  MktgFamilyPrintPage,
  MktgFamilyPrintPlan,
  MktgFamilyPrintPlanMember,
  MktgFamilyPrintSourcesLayout,
} from '../interfaces/mktg-family-print.interface';
import type { MktgPortraitFitPara } from '../interfaces/mktg-portrait-print.interface';
import { mktgPortraitPageNumber, mktgPortraitParaHeight } from './mktg-portrait-print.utils';

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
 * order, the family asset's label and its `bookSummary` (the opener's line;
 * the asset's description when it has none: the product's own words for the
 * document, never a literal per agent), the revision's version and approval
 * as printed, the date its figures were read, and the run report's open items.
 */
export function mktgFamilyPrintDocument(
  familyId: string,
  agentKey: MktgFamilyExportAgentKey,
  number: number,
  version: number | null | undefined,
  approval: MktgRevisionApproval | null,
  openItems: string[],
  dataReadAt: string | null = null
): MktgFamilyPrintDocument {
  const asset = MKTG_KIT_FAMILIES.find((family) => family.id === familyId)?.assets.find((entry) => entry.agentKey === agentKey);
  const dataDate = mktgFamilyPrintDate(dataReadAt);
  return {
    agentKey,
    number: mktgPortraitPageNumber(number),
    title: asset?.label ?? agentKey,
    summary: asset?.bookSummary ?? asset?.description ?? '',
    versionLabel: mktgFamilyPrintVersionLabel(version),
    approvedLabel: mktgFamilyPrintDate(approval?.approvedAt),
    dataLabel: dataDate ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.figuresAsOf, { Date: dataDate }) : '',
    openItems: openItems.map(mktgFamilyPrintOpenItemText).filter(Boolean),
  };
}

/** The FAQ as the family book prints it: each group's answered questions in order, with their paths; the plan measures these and the page prints these, so an index means the same in both. */
export function mktgFamilyPrintFaqGroups(groups: readonly FaqGroupView[]): MktgFamilyPrintFaqPlanGroup[] {
  return groups.map((group) => ({
    name: group.name,
    questions: group.questions
      .filter((entry) => entry.answered)
      .map((entry) => ({ path: entry.path, question: entry.question, answer: entry.answer, source: entry.source })),
  }));
}

/** The height one FAQ entry takes in a column `width` px wide: its padding, the question, the answer and the source chip's line when it prints one. */
export function mktgFamilyPrintFaqEntryHeight(entry: MktgFamilyPrintFaqPlanGroup['questions'][number], width: number): number {
  const layout = MKTG_FAMILY_PRINT_FAQ_LAYOUT;
  const paras: MktgPortraitFitPara[] = [
    { text: entry.question, ...layout.question },
    { text: entry.answer, ...layout.answer },
  ];
  const text = paras.reduce((height, para) => height + mktgPortraitParaHeight(para, width), 0);
  return layout.entryPadding + text + (mktgFamilyPrintFaqSourceLabel(entry.source) ? layout.source : 0);
}

/**
 * The FAQ's pages, filled by height: the answered questions in order, each
 * under its group's heading, into the page's two columns one after the
 * other; when both are full the next page opens, a group split where its
 * column ended (its heading repeats). An entry taller than a column stands
 * alone in one. Empty groups are not printed. No page with no questions.
 * A second page opens only when the first is full; when it does, the pages
 * are balanced (mktgFamilyPrintFaqBalancedPages).
 */
export function mktgFamilyPrintFaqPages(groups: MktgFamilyPrintFaqPlanGroup[]): MktgFamilyPrintFaqPage[] {
  const layout = MKTG_FAMILY_PRINT_FAQ_LAYOUT;
  const budget = layout.bottom - layout.top;
  const width = (MKTG_PORTRAIT_PAGE.contentWidth - layout.columnGap) / 2;
  const pages: MktgFamilyPrintFaqPage[] = [];
  let columns: MktgFamilyPrintFaqItem[][] = [[], []];
  let column = 0;
  let used = 0;
  let lastGroup = -1;
  const open = (): void => {
    if (columns[0].length) pages.push({ columns });
    columns = [[], []];
    column = 0;
    used = 0;
    lastGroup = -1;
  };
  groups.forEach((group, groupIndex) => {
    group.questions.forEach((entry, questionIndex) => {
      const entryHeight = mktgFamilyPrintFaqEntryHeight(entry, width);
      let heading = lastGroup !== groupIndex;
      let height = entryHeight + (heading ? layout.heading : 0);
      if (used > 0 && used + height > budget) {
        if (column === 0) {
          column = 1;
        } else {
          open();
        }
        used = 0;
        heading = true;
        height = entryHeight + layout.heading;
      }
      columns[column].push({ group: groupIndex, question: questionIndex, heading });
      used += height;
      lastGroup = groupIndex;
    });
  });
  open();
  // More than one page: the entries are re-dealt so the pages, and each page's columns, hold about the same height (8 + 1 → 5 + 4).
  return pages.length > 1 ? mktgFamilyPrintFaqBalancedPages(groups, pages.length) : pages;
}

/**
 * The rows of a fixed block that fit above its bottom, whole rows only,
 * nothing added, nothing dropped in silence: `budget` px for rows of
 * `size`/`line` text plus `padding` each, in a column `width` wide. When
 * rows do not fit, one line of the block's type is kept for the cut note
 * (`+N more`) and `cut` counts the rows it stands for.
 */
export function mktgFamilyPrintFitRows<T>(
  rows: readonly T[],
  text: (row: T) => string,
  width: number,
  size: number,
  line: number,
  padding: number,
  budget: number
): MktgFamilyPrintFitRows<T> {
  const fit = (room: number): T[] => {
    const kept: T[] = [];
    let used = 0;
    for (const row of rows) {
      used += padding + mktgPortraitParaHeight({ text: text(row), size, line }, width);
      if (used > room) break;
      kept.push(row);
    }
    return kept;
  };
  const whole = fit(budget);
  if (whole.length === rows.length) return { rows: whole, cut: 0 };
  const kept = fit(budget - padding - size * line);
  return { rows: kept, cut: rows.length - kept.length };
}

/** The cut note under a fitted block: `+3 more in LFX One`; '' when nothing was cut. */
export function mktgFamilyPrintCutNote(cut: number): string {
  return cut > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.cutNote, { Count: cut }) : '';
}

/** The boilerplates page's Built from block as it fits under the cards: the distinct labels, whole rows above the footer in a list column `width` wide, the rest counted. */
export function mktgFamilyPrintFitRunBlock(rows: readonly string[], width: number): MktgFamilyPrintFitRows<string> {
  const layout = MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT;
  const distinct = Array.from(new Set(rows.map((row) => row.trim()).filter(Boolean)));
  return mktgFamilyPrintFitRows(
    distinct,
    (row) => row,
    width - layout.indent,
    layout.item.size,
    layout.item.line,
    0,
    layout.bottom - layout.top - layout.heading
  );
}

/**
 * A source the run read, as the board prints it: a URL followed by its label
 * in parentheses becomes the label, a bare URL its host, and an internal
 * record id (` (uid …)`) is dropped: nothing internal reaches a printed page.
 */
export function mktgFamilyPrintSourceLabel(source: string): string {
  const trimmed = source.trim().replace(/ \(uid [^)]+\)/g, '');
  const labelled = /^https?:\/\/\S+ \((.+)\)$/.exec(trimmed);
  if (labelled) return labelled[1];
  const url = /^https?:\/\/([^/\s]+)\S*$/.exec(trimmed);
  return url ? url[1] : trimmed;
}

/**
 * Where a record read something, in words: a `brand_page: https://…` source
 * is `brand page`, a bare URL its host, a label its own words; a field name
 * with nothing readable in it ('' or `site_css` alone) gives ''. Nothing a
 * reader would take for an identifier reaches the page.
 */
export function mktgFamilyPrintReadableSource(source: string): string {
  const named = /^([A-Za-z][\w ]*?)\s*:\s*https?:\/\//.exec(source.trim());
  const label = named ? named[1] : mktgFamilyPrintSourceLabel(source);
  return label.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A run's open item as the page prints it: the record's sentence without a
 * hashed file name (`(16dd7d82…-838x203.svg)`), which names nothing to a
 * reader; the sentence around it stands, and an item left with no words is
 * dropped by the caller.
 */
export function mktgFamilyPrintOpenItemText(text: string): string {
  return text
    .replace(/\s*\([^()]*\b[0-9a-f]{12,}[^()]*\)/g, '')
    .replace(/\b[0-9a-f]{12,}[-\w]*\.\w{2,5}\b/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The book's plan: cover, contents, then per member document an opener and
 * its pages (a mounted inner print counts its page titles, the boilerplates
 * one page of cards, the FAQ its paginated grid), the Sources page and the
 * back cover (the Sources page only when a conflict or an open item exists).
 * A document with nothing to print is dropped with its opener.
 * Page numbers are 1-based and the only numbering the pages print.
 */
export function mktgFamilyPrintPlan(members: MktgFamilyPrintPlanMember[], conflictCount = 0): MktgFamilyPrintPlan {
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
      faqPages = mktgFamilyPrintFaqPages(member.faqGroups ?? []);
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
  // The cross-check prints when there is something to check: a real conflict, or an item a run left open.
  let sourcesPage = 0;
  if (chapters.length && (conflictCount > 0 || chapters.some((chapter) => chapter.document.openItems.length > 0))) {
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

/** The Sources page's Still open list: each chapter's open items, in chapter order, with the document's title; an item a record states twice prints once. */
export function mktgFamilyPrintOpenItems(chapters: MktgFamilyPrintChapter[]): MktgFamilyPrintOpenItem[] {
  const seen = new Set<string>();
  return chapters.flatMap((chapter) =>
    chapter.document.openItems.flatMap((text) => {
      const key = `${chapter.document.title}\u0000${text}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ document: chapter.document.title, text }];
    })
  );
}

/**
 * The Sources page's two lists as they fit their fixed blocks: the conflicts
 * from y 410 to the Still open block, the open items from there to the
 * page's bottom (from y 410 when there are no conflicts); whole rows only,
 * nothing added, the rows past a block counted for its cut note. The open
 * rows' text column starts after the widest document chip, so the chips
 * align whatever the longest document name.
 */
export function mktgFamilyPrintSourcesLayout(conflicts: MktgFamilyPrintConflict[], openItems: MktgFamilyPrintOpenItem[]): MktgFamilyPrintSourcesLayout {
  const layout = MKTG_FAMILY_PRINT_SOURCES_LAYOUT;
  const width = MKTG_PORTRAIT_PAGE.contentWidth;
  const keptConflicts = mktgFamilyPrintFitRows(
    conflicts,
    (row) => [row.text, row.rerun].filter(Boolean).join(' → '),
    width - layout.topicWidth - layout.gap,
    layout.conflict.size,
    layout.conflict.line,
    layout.conflict.padding,
    layout.openTop - layout.conflictsTop - layout.heading
  );
  const openTop = conflicts.length ? layout.openTop : layout.conflictsTop;
  const chipWidth = Math.max(0, ...openItems.map((item) => item.document.length)) * layout.chip.size * MKTG_PORTRAIT_FIT.charEmCaps + layout.chip.padding;
  const keptOpen = mktgFamilyPrintFitRows(
    openItems,
    (row) => row.text,
    width - chipWidth - layout.gap,
    layout.open.size,
    layout.open.line,
    layout.open.padding,
    layout.bottom - openTop - layout.heading
  );
  return {
    conflicts: keptConflicts.rows,
    conflictsCut: keptConflicts.cut,
    openItems: keptOpen.rows,
    openCut: keptOpen.cut,
    openTop,
  };
}

/** The key-number label's measure phrase (`Member organizations` → `member organizations`, `MCP servers at launch` → `mcp servers at launch`): its words to the first comma or bracket, less the stop words; '' when none is left. */
function mktgFamilyPrintMeasurePhrase(label: string): string {
  return label
    .toLocaleLowerCase()
    .split(/[,(]/)[0]
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !MKTG_FAMILY_PRINT_LABEL_STOP_WORDS.includes(word))
    .join(' ');
}

/** `Member organizations` read on from a figure or mid-sentence: `member organizations`; an acronym (`FAQ`, `MCP servers`) keeps its case. */
export function mktgFamilyPrintInSentence(name: string): string {
  const trimmed = name.trim();
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed.charAt(0).toLocaleLowerCase() + trimmed.slice(1) : trimmed;
}

/** The digits of a figure as text: `$10,000` → `10000`, `1.2M` → `1.2`; '' when it holds none. */
function mktgFamilyPrintFigure(text: string): string {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(text);
  return match ? match[0].replace(/,/g, '') : '';
}

/**
 * The framework's key numbers read against the other documents' own text: a
 * sentence that gives the same measure (the label's whole phrase, a word
 * boundary on each side, plural or singular) a different count, the figure
 * standing right before the phrase (`308 member organizations`), is a row
 * quoting both. A figure of another kind (a price, a percentage, a year), a
 * rounded one (`over 300`, `7,000+`), a figure with words between it and the
 * measure (`18 new member organizations`: a part, not the count) or a
 * sentence that also states the framework's own figure (`299 …, up from 150
 * member organizations`) is no other count of it; a word that only starts
 * with the phrase (`membership`) is not the measure. One row per key number
 * and document. The document to re-run is the other one: the framework is
 * the source.
 */
export function mktgFamilyPrintNumberConflicts(numbers: FoundationMessageNumberRow[], sources: MktgFamilyPrintTextSource[]): MktgFamilyPrintConflict[] {
  const conflicts: MktgFamilyPrintConflict[] = [];
  for (const row of numbers) {
    const figure = mktgFamilyPrintFigure(row.number);
    const phrase = mktgFamilyPrintMeasurePhrase(row.label);
    if (!figure || !phrase || /[$€£%]/.test(row.number)) continue;
    // `[qualifier] <figure>[+] <phrase>[s]`: the figure right before the measure counts it; one under a qualifier or with
    // a trailing `+` is rounded, and a year is a date. Nothing between the figure and the phrase: `18 new member
    // organizations` counts a part of the measure, not the measure.
    const pattern = new RegExp(
      `(?:(${MKTG_FAMILY_PRINT_ROUNDING_WORDS.join('|')})\\s+)?(?<![$€£\\d,.])(\\d[\\d,]*(?:\\.\\d+)?)(\\+?)\\s+${phrase.replace(/ /g, '\\s+')}s?\\b`,
      'gi'
    );
    for (const source of sources) {
      const sentence = source.texts
        .flatMap((text) => text.split(/(?<=[.!?])\s+/))
        .map((part) => part.trim())
        .find((part) => {
          const counts = Array.from(part.matchAll(pattern))
            .filter((match) => !match[1] && !match[3] && !/^(?:19|20)\d\d$/.test(match[2].replace(/,/g, '')))
            .map((match) => match[2].replace(/,/g, ''));
          // A sentence that states the framework's own figure agrees with it, whatever else it counts.
          return counts.length > 0 && !counts.includes(figure);
        });
      if (!sentence) continue;
      const label = row.label.trim();
      const topic = label.charAt(0).toLocaleUpperCase() + label.slice(1);
      conflicts.push({
        id: `${topic} · ${source.title}`,
        topic,
        text: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.numberConflict, {
          Number: row.number.trim(),
          Label: mktgFamilyPrintInSentence(label),
          Document: mktgFamilyPrintInSentence(source.title),
          Sentence: sentence,
        }),
        rerun: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.rerunAgainstFramework, { Document: mktgFamilyPrintInSentence(source.title) }),
      });
    }
  }
  return conflicts;
}

/**
 * The Sources page's "Where the documents disagree", as the store names it:
 * the kit's brand line against the framework's tagline when both exist and
 * differ, and the kit report's colour conflicts (one colour read with two
 * values). The key numbers' rows are mktgFamilyPrintNumberConflicts. Nothing
 * else is a conflict the book may claim.
 */
export function mktgFamilyPrintConflicts(
  tagline: string,
  kitLine: string,
  colorConflicts: BrandKitReportColorConflict[],
  kitTitle: string
): MktgFamilyPrintConflict[] {
  const conflicts: MktgFamilyPrintConflict[] = [];
  const line = kitLine.trim();
  const tag = tagline.trim();
  if (line && tag && line.toLocaleLowerCase() !== tag.toLocaleLowerCase()) {
    const topic = MKTG_FAMILY_PRINT_COPY.brandLineTopic;
    conflicts.push({
      id: `${topic} · ${kitTitle}`,
      topic,
      text: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.brandLineConflict, { Line: line, Tagline: tag }),
      rerun: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.rerunAgainstFramework, { Document: mktgFamilyPrintInSentence(kitTitle) }),
    });
  }
  for (const conflict of colorConflicts) {
    const values = conflict.values.filter((value) => value.hex.trim());
    if (values.length < 2) continue;
    // A reading names where the kit read it in words (`brand page`), never a field name, a URL or a file.
    const readings = values.map((value) => {
      const source = mktgFamilyPrintReadableSource(value.source);
      return source ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.colorReading, { Hex: value.hex.toUpperCase(), Source: source }) : value.hex.toUpperCase();
    });
    conflicts.push({
      id: `${conflict.name} · ${kitTitle}`,
      topic: conflict.name,
      text: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.colorConflict, {
        Kit: mktgFamilyPrintInSentence(kitTitle),
        Name: conflict.name,
        Values: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.lastOfList, { Items: readings.slice(0, -1).join(', '), Last: readings[readings.length - 1] }),
        Chosen: conflict.chosen.toUpperCase(),
      }),
      rerun: '',
    });
  }
  return conflicts;
}

/** The height of a contents chapter row in a column `width` px wide: its padding and its title's lines beside the number, version and page cells. */
export function mktgFamilyPrintContentsChapterHeight(chapter: MktgFamilyPrintChapter, width: number): number {
  const layout = MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.chapter;
  return (
    layout.padding + mktgPortraitParaHeight({ text: chapter.document.title, size: layout.size, line: layout.line, weight: layout.weight }, width - layout.aside)
  );
}

/** The height of a contents entry row in a column `width` px wide: its padding and its title's lines past the indent and the page number's cell. */
export function mktgFamilyPrintContentsEntryHeight(entry: MktgFamilyPrintContentsEntry, width: number): number {
  const layout = MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.entry;
  return layout.padding + mktgPortraitParaHeight({ text: entry.title, size: layout.size, line: layout.line }, width - layout.indent - layout.numberWidth);
}

/**
 * The contents page laid out by height: the chapters in order into the
 * page's two columns, the board's split (the first half of the chapters in
 * the first column) kept while it fits, each row measured by its lines; a
 * chapter the first column cannot finish continues at the top of the second
 * under a repeated row. The last column keeps the Sources row's and the
 * note's room. What the one page cannot hold is never clipped: the last
 * block gives up rows for one line of cut note, and `cut` counts every entry
 * the note stands for, the later chapters' included. A book of four
 * documents fits one page.
 */
export function mktgFamilyPrintContentsLayout(chapters: MktgFamilyPrintChapter[]): MktgFamilyPrintContentsLayout {
  const layout = MKTG_FAMILY_PRINT_CONTENTS_LAYOUT;
  const width = (MKTG_PORTRAIT_PAGE.contentWidth - layout.columnGap) / 2;
  const columns: MktgFamilyPrintContentsBlock[][] = [[], []];
  const last = columns.length - 1;
  const roomOf = (column: number): number => layout.bottom - layout.top - (column === last ? layout.tail : 0);
  const entryHeights = chapters.map((chapter) => chapter.entries.map((entry) => mktgFamilyPrintContentsEntryHeight(entry, width)));
  const remaining = (index: number, next: number): number => chapters.slice(index).reduce((count, chapter) => count + chapter.entries.length, 0) - next;
  const preferred = Math.ceil(chapters.length / columns.length);
  let column = 0;
  let used = 0;
  // Past the last column: the last block gives rows back until one line is free for the cut note, which counts them too.
  const close = (shown: number): MktgFamilyPrintContentsLayout => {
    const noteLine = layout.entry.padding + layout.entry.size * layout.entry.line;
    const block = columns[last][columns[last].length - 1];
    let cut = shown;
    while (block && block.entries.length && used + noteLine > roomOf(last)) {
      const heights = entryHeights[chapters.indexOf(block.chapter)];
      used -= heights[block.entries.length - 1];
      block.entries.pop();
      cut++;
    }
    if (block) block.cut = cut;
    return { columns, cut };
  };
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    const rowHeight = mktgFamilyPrintContentsChapterHeight(chapter, width);
    const heights = entryHeights[index];
    let next = 0;
    // The board's split: the first column holds the first half of the chapters whole, as long as they fit it.
    if (column === 0 && used > 0 && index >= preferred) {
      column++;
      used = 0;
    }
    for (;;) {
      // A row that would stand alone at a column's foot opens the next column; past the last, the rest is counted.
      if (used > 0 && used + rowHeight + (heights[next] ?? 0) > roomOf(column)) {
        if (column === last) return close(remaining(index, next));
        column++;
        used = 0;
      }
      const block: MktgFamilyPrintContentsBlock = { chapter, continued: next > 0, entries: [], cut: 0 };
      used += rowHeight;
      while (next < heights.length && used + heights[next] <= roomOf(column)) {
        block.entries.push(chapter.entries[next]);
        used += heights[next];
        next++;
      }
      columns[column].push(block);
      if (next >= heights.length) break;
      if (column === last) return close(remaining(index, next));
      column++;
      used = 0;
    }
  }
  return { columns, cut: 0 };
}

/** An answered question as the FAQ deal measures it: its place in the groups and its height in a column. */
interface MktgFamilyPrintFaqDealItem {
  group: number;
  question: number;
  height: number;
}

/**
 * The FAQ's pages re-dealt by height once the fill needs more than one: the
 * entries, in order, shared across `pageCount` pages so each holds about the
 * same height, and across each page's two columns the same way (eight and
 * one become five and four, laid three/two and two/two). A column never
 * exceeds its budget, except for one entry taller than a column, which
 * stands alone; what a page cannot hold goes on to the next, so nothing is
 * cut. A group split by a page or a column repeats its heading.
 */
export function mktgFamilyPrintFaqBalancedPages(groups: MktgFamilyPrintFaqPlanGroup[], pageCount: number): MktgFamilyPrintFaqPage[] {
  const layout = MKTG_FAMILY_PRINT_FAQ_LAYOUT;
  const budget = layout.bottom - layout.top;
  const width = (MKTG_PORTRAIT_PAGE.contentWidth - layout.columnGap) / 2;
  const items: MktgFamilyPrintFaqDealItem[] = groups.flatMap((group, groupIndex) =>
    group.questions.map((entry, question) => ({ group: groupIndex, question, height: mktgFamilyPrintFaqEntryHeight(entry, width) }))
  );
  // An item's cost in a run: its height, and the heading when it opens the run or its group.
  const cost = (item: MktgFamilyPrintFaqDealItem, previous: MktgFamilyPrintFaqDealItem | undefined): number =>
    item.height + (!previous || previous.group !== item.group ? layout.heading : 0);
  const runHeight = (run: MktgFamilyPrintFaqDealItem[]): number => run.reduce((sum, item, index) => sum + cost(item, run[index - 1]), 0);
  // Items from `from` while the run stays under `target` and within `room`; the first item always goes in.
  const take = (run: MktgFamilyPrintFaqDealItem[], from: number, target: number, room: number): MktgFamilyPrintFaqDealItem[] => {
    const taken: MktgFamilyPrintFaqDealItem[] = [];
    let used = 0;
    for (let index = from; index < run.length; index++) {
      const next = cost(run[index], taken[taken.length - 1]);
      if (used > 0 && (used >= target - 0.01 || used + next > room)) break;
      taken.push(run[index]);
      used += next;
    }
    return taken;
  };
  const toItems = (column: MktgFamilyPrintFaqDealItem[]): MktgFamilyPrintFaqItem[] =>
    column.map((item, index) => ({ group: item.group, question: item.question, heading: index === 0 || column[index - 1].group !== item.group }));
  const pages: MktgFamilyPrintFaqPage[] = [];
  let rest = items;
  for (let page = 0; rest.length > 0; page++) {
    // The page's share of what is left; the last planned page, and any page after it, takes all it can hold.
    const share = runHeight(rest) / Math.max(1, pageCount - page);
    const run = take(rest, 0, share, Number.POSITIVE_INFINITY);
    // The columns: the first to half the page's height, the second the rest; what the second cannot hold waits for the next page.
    const first = take(run, 0, runHeight(run) / 2, budget);
    const second = take(run, first.length, Number.POSITIVE_INFINITY, budget);
    pages.push({ columns: [toItems(first), toItems(second)] });
    rest = rest.slice(first.length + second.length);
  }
  return pages;
}

/** A FAQ answer's source as its chip prints it: the book's word for a stored source (MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS), else the source as stored; '' prints no chip. */
export function mktgFamilyPrintFaqSourceLabel(source: string): string {
  const trimmed = source.trim();
  return MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS[trimmed.toLocaleLowerCase()] ?? trimmed;
}
