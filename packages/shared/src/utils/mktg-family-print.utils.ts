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
  MKTG_FAMILY_PRINT_COVER_STRIP_MEASURE,
  MKTG_FAMILY_PRINT_FAQ_LAYOUT,
  MKTG_FAMILY_PRINT_FAQ_SOURCE_LABELS,
  MKTG_FAMILY_PRINT_HEAD_CAPS,
  MKTG_FAMILY_PRINT_HEAD_MEASURE,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_LABEL_STOP_WORDS,
  MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT,
  MKTG_FAMILY_PRINT_INTERNAL_SOURCE_TERMS,
  MKTG_FAMILY_PRINT_RERUN_ON_COLOR,
  MKTG_FAMILY_PRINT_ROUNDING_WORDS,
  MKTG_FAMILY_PRINT_SOURCE_FIELD_WORDS,
  MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT,
  MKTG_FAMILY_PRINT_SOURCES_LAYOUT,
} from '../constants/mktg-family-print.constants';
import { MKTG_KIT_FAMILIES } from '../constants/mktg-kit.constants';
import {
  MKTG_PORTRAIT_CAPS_TRACKING_EM,
  MKTG_PORTRAIT_COVER_STRIP,
  MKTG_PORTRAIT_FIT,
  MKTG_PORTRAIT_GLYPH_WIDTHS,
  MKTG_PORTRAIT_GLYPH_WIDTH_DEFAULT,
  MKTG_PORTRAIT_PAGE,
} from '../constants/mktg-portrait-print.constants';
import type { BrandKitBookView, BrandKitReportColorConflict } from '../interfaces/brand-kit.interface';
import type { FaqGroupView } from '../interfaces/faq.interface';
import type { FoundationMessageNumberRow } from '../interfaces/foundation-message.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import type { MktgFamilyExportAgentKey } from '../interfaces/mktg-family-export.interface';
import type {
  MktgFamilyPrintCapsMeasure,
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
  MktgFamilyPrintFittedText,
} from '../interfaces/mktg-family-print.interface';
import type { MktgPortraitCoverStrip, MktgPortraitFitPara } from '../interfaces/mktg-portrait-print.interface';
import type { MktgPrintBrand } from '../interfaces/mktg-print.interface';
import { brandKitPortraitArtwork } from './brand-kit-portrait.utils';
import {
  mktgPortraitCoverStrip,
  mktgPortraitLineFits,
  mktgPortraitPageNumber,
  mktgPortraitParaHeight,
  mktgPortraitTextWidth,
} from './mktg-portrait-print.utils';

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
 * column ended (its heading repeats). A group's heading never sits at a
 * column's foot with one question alone when the group goes on: it opens a
 * column only where its first two questions fit, else the group moves on
 * whole (the editor's F5). An entry taller than a column stands alone in
 * one. Empty groups are not printed. No page with no questions. A second
 * page opens only when the first is full; the columns of every page, and
 * the pages, are then balanced (mktgFamilyPrintFaqBalancedPages).
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
      // A heading opens here only with its second question beside it (when the group has one): a heading over one
      // question at a column's foot, the group going on in the next, is what the rule keeps off the page.
      const second = group.questions[questionIndex + 1];
      const keepWith = heading && second ? mktgFamilyPrintFaqEntryHeight(second, width) : 0;
      if (used > 0 && used + height + keepWith > budget) {
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
  // The fill sets the page count (a second page only when the first is full); the entries are then re-dealt so the pages,
  // and each page's two columns, hold about the same height (8 + 1 → 5 + 4; four questions → 2 + 2, never the left alone).
  const dealt = mktgFamilyPrintFaqBalancedPages(groups, pages.length);
  return dealt.length === pages.length ? dealt : pages;
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

/** The words of a text, as the boilerplates agent counts them. */
function mktgFamilyPrintWordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * A text less its last sentence (`.`, `!`, `?` or `…`, a closing quote or
 * bracket allowed, then a space); a single sentence loses its last word
 * instead, so the loop always shortens. '' when nothing is left to cut.
 */
export function mktgFamilyPrintCutFromEnd(text: string): string {
  const trimmed = text.trim();
  const ends = Array.from(trimmed.matchAll(/[.!?…]["”’')\]]*\s+/g)).map((match) => match.index + match[0].length);
  const sentence = ends.filter((end) => end < trimmed.length).pop();
  if (sentence !== undefined) return trimmed.slice(0, sentence).trim();
  const word = trimmed.lastIndexOf(' ');
  return word > 0 ? trimmed.slice(0, word).trim() : '';
}

/**
 * The family's brand with the lockup its dark covers draw, as the kit's own
 * cover draws it: the brand builder's logo on the dark (none for a kit
 * without artwork or with the placeholder), redrawn by the kit book's one
 * precedence (brandKitPortraitArtwork: the supplied reversed file, else a
 * one-ink primary filtered to white, else the full-colour primary on the
 * white plate, `plate`) and named by the brand's alt.
 */
export function mktgFamilyPrintBrand(brand: MktgPrintBrand, book: BrandKitBookView | null): MktgPrintBrand {
  if (!book || !brand.logoOnDark) return brand;
  const lockup = brandKitPortraitArtwork(book, 'lockup', 'reversed');
  return { ...brand, logoOnDark: lockup ? { ...lockup, alt: brand.logoOnDark.alt } : brand.logoOnDark };
}

/**
 * The width one line of the family's capitals takes in the book's face, at
 * the measure it is set in (the running head's by default: its size, its
 * semibold and the grammar's capitals tracking): glyph by glyph from the
 * grammar's sans table, widened by the face's CAPITALS factor and, above the
 * regular weight, the semibold's (MKTG_FAMILY_PRINT_HEAD_CAPS) when the face
 * is measured there; else by the grammar's own measure (mktgPortraitTextWidth),
 * whose family factor is a lowercase one and sets capitals wide. The family's
 * own measure, so the kit's and the framework's pages, fitted through the
 * grammar's, do not move.
 */
export function mktgFamilyPrintCapsWidth(
  text: string,
  fontStack: string,
  measure: MktgFamilyPrintCapsMeasure = {
    size: MKTG_FAMILY_PRINT_HEAD_MEASURE.size,
    weight: MKTG_FAMILY_PRINT_HEAD_MEASURE.weight,
    tracking: MKTG_PORTRAIT_CAPS_TRACKING_EM,
  }
): number {
  const { size, weight, tracking } = measure;
  const first = fontStack.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  const caps = MKTG_FAMILY_PRINT_HEAD_CAPS.families[first];
  if (caps === undefined) {
    return mktgPortraitTextWidth(text, size, { caps: true, weight, family: fontStack, tracking });
  }
  const shown = Array.from(text.toUpperCase());
  const glyphs = shown.reduce((sum, char) => sum + (MKTG_PORTRAIT_GLYPH_WIDTHS[char] ?? MKTG_PORTRAIT_GLYPH_WIDTH_DEFAULT), 0) / 1000;
  const bold = weight > 400 ? MKTG_FAMILY_PRINT_HEAD_CAPS.weight : 1;
  return (glyphs * caps * bold + Math.max(0, shown.length - 1) * tracking) * size;
}

/**
 * Whether the book's running heads step down one size: the longest section
 * label the book mounts on the left (its own pages' and the inner prints'),
 * the head's gap and the family's document name on the right, measured at
 * the label's size with its capitals and tracking in the brand's face
 * (mktgFamilyPrintCapsWidth), do not fit the page's content width on
 * one line. Then the whole book sets both labels one step smaller (the
 * editor's rule: a size the measure asks for, never a count of characters),
 * and the ellipsis stays the last resort. A book with no section label
 * measures the name alone.
 */
export function mktgFamilyPrintHeadTight(sections: readonly string[], headRight: string, fontStack: string): boolean {
  const { gap } = MKTG_FAMILY_PRINT_HEAD_MEASURE;
  const left = sections.reduce((widest, section) => Math.max(widest, mktgFamilyPrintCapsWidth(section, fontStack)), 0);
  const room = MKTG_PORTRAIT_PAGE.contentWidth - (left > 0 ? left + gap : 0);
  return mktgFamilyPrintCapsWidth(headRight, fontStack) > room + 0.01;
}

/**
 * The family cover's strip: its halves as written when the family's measure
 * of the face's capitals (mktgFamilyPrintCapsWidth at the strip's size and
 * tracking, regular weight) fits them on one line with the strip's gap; else
 * the grammar's own fit (mktgPortraitCoverStrip: the left half's segments
 * after the name dropped, then words cut, then the wrap), unchanged. The
 * grammar reads a face by its lowercase factor and so called the e2e
 * fixture's strip full in Montserrat (675 px by it, 630 by the capitals, in
 * 672) and dropped "a Linux Foundation project" where it fits (M10b). A face
 * the family has not measured reads the grammar's measure and gets the
 * grammar's answer. The kit's cover keeps the util as it is.
 */
export function mktgFamilyPrintCoverStrip(left: string, right: string, width: number, fontStack: string): MktgPortraitCoverStrip {
  const measure = MKTG_FAMILY_PRINT_COVER_STRIP_MEASURE;
  const fits =
    mktgFamilyPrintCapsWidth(left, fontStack, measure) + MKTG_PORTRAIT_COVER_STRIP.gap + mktgFamilyPrintCapsWidth(right, fontStack, measure) <= width + 0.01;
  return fits ? { left, right, wraps: false } : mktgPortraitCoverStrip(left, right, width, fontStack);
}

/**
 * The lines a text wraps to in a column `width` px wide at `size` px, greedy
 * by words, each line measured glyph by glyph in the face it is set in
 * (mktgPortraitLineFits; a word wider than the line stands on one). The
 * paragraph model's flat average wraps safely but counts a long text a line
 * or two over, which cut a boilerplate its card had room for.
 */
export function mktgFamilyPrintMeasuredLines(text: string, width: number, size: number, para: Pick<MktgPortraitFitPara, 'weight' | 'family'> = {}): number {
  return text.split(/\r?\n|\v/).reduce((count, hardLine) => {
    const words = hardLine.split(/\s+/).filter((word) => word !== '');
    if (words.length === 0) return count + 1;
    let lines = 1;
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && !mktgPortraitLineFits(next, width, size, para)) {
        lines++;
        line = word;
      } else {
        line = next;
      }
    }
    return count + lines;
  }, 0);
}

/**
 * The boilerplate cards held to the page: each card's height is its padding
 * plus its text at the card's type and measure, at least the board's
 * minimum, the lines measured in the book's face (`family`, the look's font
 * stack); while the cards and their gaps outgrow the room, the tallest
 * text loses its last sentence and keeps one line for the cut note, so the
 * page prints every card and says how many words did not fit. The room
 * keeps one line of the largest text free, so a line the engine wraps
 * otherwise than the measure never reaches the Built from block. A text that
 * fits prints whole. Nothing is rephrased and nothing is cut in silence. Pure.
 */
export function mktgFamilyPrintFitBoilerplateCards(
  cards: readonly { text: string; fontSize: number; minHeight: number }[],
  width: number,
  layout: typeof MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT = MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT,
  family = ''
): MktgFamilyPrintFittedText[] {
  const guard = Math.max(0, ...cards.map((card) => card.fontSize * layout.line));
  const room = layout.bottom - layout.top - layout.gap * Math.max(0, cards.length - 1) - guard;
  const measure = width - layout.inset - layout.metaWidth - layout.metaGap;
  const fitted = cards.map((card) => ({ text: card.text.trim(), cutWords: 0 }));
  const height = (index: number): number => {
    const card = cards[index];
    const note = fitted[index].cutWords > 0 ? card.fontSize * layout.line : 0;
    const lines = mktgFamilyPrintMeasuredLines(fitted[index].text, measure, card.fontSize, { family });
    return Math.max(card.minHeight, layout.padding + note + lines * card.fontSize * layout.line);
  };
  const total = (): number => fitted.reduce((sum, _, index) => sum + height(index), 0);
  const words = cards.map((card) => mktgFamilyPrintWordCount(card.text));
  for (let guard = 0; guard < MKTG_PORTRAIT_FIT.maxCuts && total() > room; guard++) {
    const tallest = fitted.map((_, index) => index).reduce((best, index) => (height(index) > height(best) ? index : best), 0);
    const shorter = mktgFamilyPrintCutFromEnd(fitted[tallest].text);
    if (!shorter) break;
    fitted[tallest] = { text: shorter, cutWords: words[tallest] - mktgFamilyPrintWordCount(shorter) };
  }
  return fitted;
}

/** The cut note under a fitted block: `+3 more in LFX One`; '' when nothing was cut. */
export function mktgFamilyPrintCutNote(cut: number): string {
  return cut > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.cutNote, { Count: cut }) : '';
}

/**
 * A sentence that quotes another, with one stop: when the quoted words end on
 * their own stop before the closing quote (`… on them.”.`), the sentence's
 * stop after the quote is dropped (`… on them.”`), as English sets it; a
 * quote with no stop of its own keeps the sentence's.
 */
export function mktgFamilyPrintOneStop(text: string): string {
  return text.replace(/([.!?…])([”"’')\]]+)\.(?=\s|$)/g, '$1$2');
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

/** `http://` or `https://` at the head of a source. */
const SOURCE_SCHEME_REGEX = /^https?:\/\//;
/** One whitespace character, as `\s` reads it: where a source's first token ends. */
const WHITESPACE_REGEX = /\s/;
/** A line terminator, which the dot of a regular expression does not match: what a label in parentheses may not hold. */
const LINE_TERMINATOR_REGEX = /[\n\r\u2028\u2029]/;
/** The host of a scheme address: what follows the scheme to the first `/` or whitespace (one run, nothing after it to satisfy). */
const SOURCE_HOST_REGEX = /^https?:\/\/([^/\s]+)/;

/**
 * A scheme source's first token (`https://host/path`, to the first whitespace) and its label when the source is
 * `https://… (label)`: one space after the token, the label in parentheses to the end of the source, at least one
 * character long, with nothing breaking the line. Read by splitting at the first whitespace rather than by
 * `^https?:\/\/\S+ \((.+)\)$`, whose `\S+` and `.+` overlap on a repeated ` (uid ` and made a long hostile
 * source quadratic (CodeQL, js/polynomial-redos); the outputs are the same. `null` when the source has no scheme.
 */
function mktgFamilyPrintSourceParts(trimmed: string): { token: string; label: string | null } | null {
  const scheme = SOURCE_SCHEME_REGEX.exec(trimmed)?.[0];
  if (!scheme) return null;
  const rest = trimmed.slice(scheme.length);
  const space = rest.search(WHITESPACE_REGEX);
  const token = space === -1 ? rest : rest.slice(0, space);
  const inner = space > 0 && rest[space] === ' ' && rest[space + 1] === '(' && rest.endsWith(')') ? rest.slice(space + 2, -1) : '';
  return { token: scheme + token, label: inner && !LINE_TERMINATOR_REGEX.test(inner) ? inner : null };
}

/**
 * A source without its internal record ids: every ` (uid …)` (one or more characters before the closing parenthesis)
 * dropped, as `/ \(uid [^)]+\)/g` dropped them, read by index so a source that repeats ` (uid ` without closing it
 * is read once, not once per repeat.
 */
function mktgFamilyPrintWithoutUids(text: string): string {
  const open = ' (uid ';
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start === -1) break;
    const close = text.indexOf(')', start + open.length);
    if (close === -1) break;
    if (close === start + open.length) {
      // ` (uid )` holds no id: it stands, and the search goes on after its space.
      out += text.slice(from, start + 1);
      from = start + 1;
      continue;
    }
    out += text.slice(from, start);
    from = close + 1;
  }
  return out + text.slice(from);
}

/**
 * A source the run read, as the board prints it: a URL followed by its label
 * in parentheses becomes the label, a bare URL its host, and an internal
 * record id (` (uid …)`) is dropped: nothing internal reaches a printed page.
 */
export function mktgFamilyPrintSourceLabel(source: string): string {
  const trimmed = mktgFamilyPrintWithoutUids(source.trim());
  const parts = mktgFamilyPrintSourceParts(trimmed);
  if (parts?.label) return parts.label;
  // A bare URL (no whitespace in it, a host before any `/`) is its host, as `^https?:\/\/([^/\s]+)\S*$` read it.
  const host = parts && parts.token === trimmed ? SOURCE_HOST_REGEX.exec(trimmed)?.[1] : undefined;
  return host ?? trimmed;
}

/**
 * A source as the Built from list prints it, in plain words a reader of the
 * book can place: a URL with a label is the label and its host (`Home page
 * (aaif.io)`), a bare URL its host, an LFX project record the words alone
 * (no slug, no id), and a parenthesis holding only the run's own terms
 * (`(intake)`) is dropped. Words start with a capital, as a list row's; a host
 * alone keeps its own case.
 */
export function mktgFamilyPrintBuiltFromLabel(source: string): string {
  const trimmed = mktgFamilyPrintWithoutUids(source.trim());
  const host = (url: string): string => (SOURCE_HOST_REGEX.exec(url)?.[1] ?? '').replace(/^www\./, '');
  // The token and the label as `^(https?:\/\/\S+) \((.+)\)$` read them (mktgFamilyPrintSourceParts).
  const parts = mktgFamilyPrintSourceParts(trimmed);
  let label: string;
  if (parts?.label) label = `${parts.label} (${host(parts.token)})`;
  else if (parts) return host(trimmed);
  else if (/^LFX project record\b/i.test(trimmed)) label = trimmed.replace(/^(LFX project record)\b.*$/i, '$1');
  else {
    // A parenthesis holding only the run's own terms at the end, as `\s*\((?:intake|…)\)$` dropped it: the anchored
    // `(term)$` is found first (it fails fast everywhere but at a `(`), and trimEnd() strips the same `\s` set the
    // pattern's leading `\s*` did, without its retry at every whitespace character (quadratic on a long run).
    const tail = new RegExp(`\\((?:${MKTG_FAMILY_PRINT_INTERNAL_SOURCE_TERMS.join('|')})\\)$`, 'i').exec(trimmed);
    label = tail ? trimmed.slice(0, tail.index).trimEnd() : trimmed;
  }
  return label ? label[0].toLocaleUpperCase() + label.slice(1) : '';
}

/** A field name: a letter, then word characters and spaces (what `[A-Za-z][\w ]*` names; one run, anchored at both ends). */
const SOURCE_FIELD_NAME_REGEX = /^[A-Za-z][\w ]*$/;
/** What follows a field name's colon: optional whitespace, then a scheme (one run, then a literal). */
const SOURCE_FIELD_ADDRESS_REGEX = /^\s*https?:\/\//;

/**
 * The field name of a `brand_page: https://…` source, without the whitespace before its colon, or `null` when the
 * source is not one. The name holds no colon, so the colon read is the source's first; read by splitting there
 * rather than by `^([A-Za-z][\w ]*?)\s*:\s*https?:\/\/`, whose `[\w ]*?` and `\s*` overlap on spaces and made a
 * long hostile source quadratic (CodeQL, js/polynomial-redos); the outputs are the same.
 */
function mktgFamilyPrintSourceFieldName(trimmed: string): string | null {
  const colon = trimmed.indexOf(':');
  if (colon < 1) return null;
  // The lazy name ends at its last word character: the whitespace before the colon was `\s*`'s, not the name's.
  const name = trimmed.slice(0, colon).trimEnd();
  return SOURCE_FIELD_NAME_REGEX.test(name) && SOURCE_FIELD_ADDRESS_REGEX.test(trimmed.slice(colon + 1)) ? name : null;
}

/**
 * Where a record read something, in words: a `brand_page: https://…` source
 * is `brand page` and `site_css: …` the `site stylesheet`, a bare URL its host, a label its own words; a field name
 * with nothing readable in it ('' or `site_css` alone) gives ''. Nothing a
 * reader would take for an identifier reaches the page.
 */
export function mktgFamilyPrintReadableSource(source: string): string {
  const named = mktgFamilyPrintSourceFieldName(source.trim());
  if (named !== null) return MKTG_FAMILY_PRINT_SOURCE_FIELD_WORDS[named.toLocaleLowerCase()] ?? named.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return mktgFamilyPrintSourceLabel(source).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A word that starts with twelve hexadecimal digits (a hash), at the start of a parenthesis's content or after a non-word character. */
const HASHED_WORD_REGEX = /(?:^|\W)[0-9a-f]{12}/;

/**
 * A text without its hashed parentheses: every `(…)` that holds no parenthesis and a word starting with twelve
 * hexadecimal digits, with the whitespace before it, dropped, as `/\s*\([^()]*\b[0-9a-f]{12,}[^()]*\)/g` dropped
 * them. Read by index (each `(`, its first `)`, the content between them once) rather than by that pattern, whose
 * `[^()]*` on each side of the hash made a long run of tabs quadratic (CodeQL, js/polynomial-redos); the outputs
 * are the same.
 */
function mktgFamilyPrintWithoutHashedParentheses(text: string): string {
  let out = '';
  let from = 0;
  let close = -1;
  let open = text.indexOf('(');
  while (open !== -1) {
    if (close <= open) close = text.indexOf(')', open + 1);
    if (close === -1) break;
    const next = text.indexOf('(', open + 1);
    if (next !== -1 && next < close) {
      // A parenthesis inside: this one holds a parenthesis, so the inner one is the candidate.
      open = next;
      continue;
    }
    if (HASHED_WORD_REGEX.test(text.slice(open + 1, close))) {
      let start = open;
      while (start > from && WHITESPACE_REGEX.test(text[start - 1])) start -= 1;
      out += text.slice(from, start);
      from = close + 1;
    }
    open = next;
  }
  return out + text.slice(from);
}

/**
 * A text without its hashed file names: every word that starts with twelve hexadecimal digits and ends in a `.`
 * and two to five word characters (`16dd7d82…-838x203.svg`) dropped, as `/\b[0-9a-f]{12,}[-\w]*\.\w{2,5}\b/g`
 * dropped them. One linear scan rather than that pattern, whose `[-\w]*` was retried from every word start of a
 * chain of hyphenated words to the chain's end (CodeQL, js/polynomial-redos): three suffix tables, read right to
 * left once, give each index the end of its `[-\w]` run, the length of the hexadecimal run and the length of the
 * word from it; a name starts where a word does with at least twelve hexadecimal digits, and its run must be
 * followed by a `.` and a word of two to five characters. The same names are dropped (ASCII `\w`, as the pattern's).
 */
function mktgFamilyPrintWithoutHashedNames(text: string): string {
  const n = text.length;
  const isWord = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102);
  const runEnd = new Int32Array(n + 1),
    hexLen = new Int32Array(n + 1),
    wordLen = new Int32Array(n + 1);
  runEnd[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    const c = text.charCodeAt(i);
    runEnd[i] = isWord(c) || c === 45 ? runEnd[i + 1] : i;
    hexLen[i] = isHex(c) ? hexLen[i + 1] + 1 : 0;
    wordLen[i] = isWord(c) ? wordLen[i + 1] + 1 : 0;
  }
  let out = '',
    from = 0,
    i = 0;
  while (i < n) {
    if (hexLen[i] >= 12 && (i === 0 || !isWord(text.charCodeAt(i - 1)))) {
      const e = runEnd[i];
      const ext = e < n && text.charCodeAt(e) === 46 ? wordLen[e + 1] : 0;
      if (ext >= 2 && ext <= 5) {
        out += text.slice(from, i);
        i = from = e + 1 + ext;
        continue;
      }
    }
    i++;
  }
  return out + text.slice(from);
}

/**
 * A run's open item as the page prints it: the record's sentence without a
 * hashed file name (`(16dd7d82…-838x203.svg)`), which names nothing to a
 * reader; the sentence around it stands, and an item left with no words is
 * dropped by the caller.
 */
export function mktgFamilyPrintOpenItemText(text: string): string {
  return (
    mktgFamilyPrintWithoutHashedNames(mktgFamilyPrintWithoutHashedParentheses(text))
      // Only the first character of a whitespace run starts a match (the lookbehind), so a long run is read once, not once per character.
      .replace(/(?<!\s)\s+([,.;:])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/**
 * The book's plan: cover, contents, then per member document an opener and
 * its pages (a mounted inner print counts its page titles, the boilerplates
 * one page of cards, the FAQ its paginated grid), the Sources page and the
 * back cover (the Sources page whenever the book has a chapter; its lists
 * only when they have rows, which the page's template decides).
 * A document with nothing to print is dropped with its opener. The
 * running heads are the board's (mock/family/family.html): a mounted
 * print's pages print `Document · Section` themselves (`Brand kit · Logo`);
 * the family's own content pages carry their document's numbered chapter
 * from the contents order (`03 Boilerplates`, `04 FAQ`), the Contents and
 * Sources pages their name.
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
    // The opener and the family's own content pages carry the numbered chapter from the contents order in the running
    // head (`03 Boilerplates`, the board's); a mounted print's pages print their own heads.
    const section = `${document.number} ${document.title}`;
    const headSection = section;
    const entries: MktgFamilyPrintContentsEntry[] = [];
    const openerPage = n + 1;
    const first = openerPage + 1;
    const content: Omit<MktgFamilyPrintPage, 'n'>[] = [];
    if (kind === 'framework' || kind === 'kit') {
      const titles = member.innerPageTitles?.filter((title) => title.trim()) ?? [];
      const span = Math.max(titles.length, 1);
      content.push({ id: kind, kind, section: headSection, title: document.title, agentKey: document.agentKey, index: 0, span });
      (titles.length ? titles : [document.title]).forEach((title, index) => entries.push({ title, n: first + index }));
    } else if (kind === 'boilerplates') {
      if ((member.boilerplateCount ?? 0) > 0) {
        content.push({
          id: kind,
          kind,
          section: headSection,
          title: MKTG_FAMILY_PRINT_LABELS.boilerplates,
          agentKey: document.agentKey,
          index: 0,
          span: 1,
        });
        entries.push({ title: MKTG_FAMILY_PRINT_LABELS.boilerplates, n: first });
      }
    } else {
      faqPages = mktgFamilyPrintFaqPages(member.faqGroups ?? []);
      faqPages.forEach((_, index) => {
        const title = index === 0 ? MKTG_FAMILY_PRINT_LABELS.faq : `${MKTG_FAMILY_PRINT_LABELS.faq} (${index + 1})`;
        content.push({
          id: `${kind}-${index + 1}`,
          kind,
          section: headSection,
          title,
          agentKey: document.agentKey,
          index,
          span: 1,
        });
        entries.push({ title, n: first + index });
      });
    }
    if (!content.length) continue;
    push({ id: `opener-${document.agentKey}`, kind: 'opener', section, title: '', agentKey: document.agentKey, index: 0, span: 1 });
    content.forEach(push);
    chapters.push({ document, openerPage, first, last: n, entries });
  }
  // The cross-check prints whenever the book has documents (the product owner's decision, D-17): what it checked and
  // what it found, a clean family included; a list with no rows is the one thing its page leaves out.
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
 * nothing added, the rows past a block counted for its cut note. The Still
 * open block follows the conflicts printed, a block gap under them, never
 * lower than the board's y for it, so the page keeps no dead space between
 * the two; its budget runs from there. The open rows' text column starts
 * after the widest document chip, so the chips align whatever the longest
 * document name.
 */
export function mktgFamilyPrintSourcesLayout(conflicts: MktgFamilyPrintConflict[], openItems: MktgFamilyPrintOpenItem[]): MktgFamilyPrintSourcesLayout {
  const layout = MKTG_FAMILY_PRINT_SOURCES_LAYOUT;
  const width = MKTG_PORTRAIT_PAGE.contentWidth;
  const conflictText = (row: MktgFamilyPrintConflict): string => [row.text, row.rerun].filter(Boolean).join(' → ');
  const conflictWidth = width - layout.topicWidth - layout.gap;
  const keptConflicts = mktgFamilyPrintFitRows(
    conflicts,
    conflictText,
    conflictWidth,
    layout.conflict.size,
    layout.conflict.line,
    layout.conflict.padding,
    layout.openTop - layout.conflictsTop - layout.heading
  );
  // The conflicts' height as the fit model measured it, the cut note's line included: the Still open block starts under it.
  const noteLine = keptConflicts.cut > 0 ? layout.conflict.padding + layout.conflict.size * layout.conflict.line : 0;
  const conflictsHeight = keptConflicts.rows.reduce(
    (height, row) =>
      height +
      layout.conflict.padding +
      mktgPortraitParaHeight({ text: conflictText(row), size: layout.conflict.size, line: layout.conflict.line }, conflictWidth),
    noteLine
  );
  const openTop = conflicts.length ? Math.min(layout.openTop, layout.conflictsTop + layout.heading + conflictsHeight + layout.blockGap) : layout.conflictsTop;
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

/** A magnitude written after a figure (`1.2M`, `3 thousand`, `2bn`), case-insensitively, and its factor. */
const MKTG_FAMILY_PRINT_MAGNITUDES: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};
const MKTG_FAMILY_PRINT_MAGNITUDE = '(?:\\s*(k|m|mn|b|bn)\\b|\\s+(thousand|million|billion)\\b)?';

/** A figure and its magnitude as one number: `1,200,000` → 1200000, `1.2M` → 1200000, `3 thousand` → 3000. */
function mktgFamilyPrintFigureValue(digits: string, magnitude: string | undefined): number {
  return Number(digits.replace(/,/g, '')) * (magnitude ? (MKTG_FAMILY_PRINT_MAGNITUDES[magnitude.toLocaleLowerCase()] ?? 1) : 1);
}

/**
 * A key number's figure as a value: the whole number read as `[qualifier] <figure>[ magnitude][+]`, so `1.2M` is
 * 1200000 and `7,000+` is 7000; null when the number holds no figure, holds a currency or a percentage, or carries
 * words the reader cannot interpret whole (`1.2M a day`): then nothing is compared and no re-run is asked for.
 */
export function mktgFamilyPrintFigure(text: string): number | null {
  if (/[$€£%]/.test(text)) return null;
  const match = new RegExp(
    `^\\s*(?:(?:${MKTG_FAMILY_PRINT_ROUNDING_WORDS.join('|')})\\s+)?(\\d[\\d,]*(?:\\.\\d+)?)${MKTG_FAMILY_PRINT_MAGNITUDE}\\+?\\s*$`,
    'i'
  ).exec(text);
  if (!match) return null;
  const value = mktgFamilyPrintFigureValue(match[1], match[2] ?? match[3]);
  return Number.isFinite(value) ? value : null;
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
    if (figure === null || !phrase) continue;
    // `[qualifier] <figure>[ magnitude][+] <phrase>[s]`: the figure right before the measure counts it, its magnitude
    // read (`1.2M downloads` is 1,200,000 downloads); one under a qualifier or with a trailing `+` is rounded, and a
    // year is a date. Nothing else between the figure and the phrase: `18 new member organizations` counts a part of
    // the measure, not the measure.
    const pattern = new RegExp(
      `(?:(${MKTG_FAMILY_PRINT_ROUNDING_WORDS.join('|')})\\s+)?(?<![$€£\\d,.])(\\d[\\d,]*(?:\\.\\d+)?)${MKTG_FAMILY_PRINT_MAGNITUDE}(\\+?)\\s+${phrase.replace(/ /g, '\\s+')}s?\\b`,
      'gi'
    );
    for (const source of sources) {
      const sentence = source.texts
        .flatMap((text) => text.split(/(?<=[.!?])\s+/))
        .map((part) => part.trim())
        .find((part) => {
          const counts = Array.from(part.matchAll(pattern))
            .filter((match) => !match[1] && !match[5] && !/^(?:19|20)\d\d$/.test(match[2].replace(/,/g, '')))
            .map((match) => mktgFamilyPrintFigureValue(match[2], match[3] ?? match[4]));
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
 * values). Each row names the document to re-run. The key numbers' rows are
 * mktgFamilyPrintNumberConflicts. Nothing else is a conflict the book may
 * claim.
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
      // One stop: a tagline that ends on its own full stop does not take the sentence's after the closing quote.
      text: mktgFamilyPrintOneStop(mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.brandLineConflict, { Line: line, Tagline: tag })),
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
      // Every row names its action: the kit is re-run once the sources it read agree (the brand-line row's is the framework).
      rerun: mktgFamilyPrintFill(MKTG_FAMILY_PRINT_RERUN_ON_COLOR, { Document: mktgFamilyPrintInSentence(kitTitle), Name: conflict.name }),
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
 * The FAQ's pages re-dealt by height: the entries, in order, shared across
 * `pageCount` pages so each holds about the same height, and across each
 * page's two columns the same way (eight and one become five and four, laid
 * three/two and two/two; four on one page lie two and two). A column never
 * exceeds its budget, except for one entry taller than a column, which
 * stands alone; what a page cannot hold goes on to the next, so nothing is
 * cut. A group split by a page or a column repeats its heading, and never
 * at a column's foot over one question alone while the group goes on: that
 * question follows its group into the next column or page (the editor's F5).
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
  // Items from `from` while the run stays under `target` and within `room`; the first item always goes in. A run never
  // ends on a heading over one question alone while its group goes on (the one before it is of another group or the
  // run opens with it): that question is left for the next run, unless it is all the run holds.
  const take = (run: MktgFamilyPrintFaqDealItem[], from: number, target: number, room: number): MktgFamilyPrintFaqDealItem[] => {
    const taken: MktgFamilyPrintFaqDealItem[] = [];
    let used = 0;
    for (let index = from; index < run.length; index++) {
      const next = cost(run[index], taken[taken.length - 1]);
      if (used > 0 && (used >= target - 0.01 || used + next > room)) break;
      taken.push(run[index]);
      used += next;
    }
    const last = taken[taken.length - 1];
    const before = taken[taken.length - 2];
    const after = run[from + taken.length];
    if (taken.length > 1 && last && after && after.group === last.group && (!before || before.group !== last.group)) taken.pop();
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
