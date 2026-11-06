// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family PDF's own pages (Download PDF on the family card): the appendix
// paginated in TypeScript from the data by the shell's fit model, as the
// Slides exporter paginates the deck (never by CSS flow, so every browser and
// paper gives the same pages), and the strings and page models of the cover,
// the dividers and the running heads. Pure: the templates bind the results.

import { MKTG_FAMILY_EXPORT_KINDS, MKTG_FAMILY_EXPORT_VERSION_LABELS } from '../constants/mktg-family-export.constants';
import { MKTG_FAQ_PRINT_UNANSWERED } from '../constants/mktg-print.constants';
import {
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_CAPS_TRACKING_EM,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LINE,
  MKTG_PRINT_PAGE_LOGO_FRAME,
  MKTG_PRINT_PAGE_MIN_SCALE,
  MKTG_PRINT_PAGE_SCALE_STEP,
  MKTG_PRINT_PAGE_SIZE,
} from '../constants/mktg-print-page.constants';
import {
  MKTG_PRINT_APPENDIX_LAYOUT,
  MKTG_PRINT_DIVIDER_EYEBROW_MIN_CONTRAST,
  MKTG_PRINT_DIVIDER_LAYOUT,
  MKTG_PRINT_DIVIDER_NOUNS,
  MKTG_PRINT_SECTION_TITLES,
  MKTG_PRINT_SOURCE_LEAD,
} from '../constants/mktg-print-pages.constants';
import { MKTG_SLIDES_EXPORT_ASSET_KINDS } from '../constants/mktg-slides-export.constants';
import type { BoilerplatesLengthRow } from '../interfaces/boilerplates.interface';
import type { FaqGroupView } from '../interfaces/faq.interface';
import type { MktgFamilyExportAgentKey, MktgFamilyPrintView } from '../interfaces/mktg-family-export.interface';
import type { MktgPrintLogo } from '../interfaces/mktg-print.interface';
import type {
  MktgPrintPage,
  MktgPrintPageBox,
  MktgPrintPageEl,
  MktgPrintPageLook,
  MktgPrintPara,
  MktgPrintRich,
} from '../interfaces/mktg-print-page.interface';
import type {
  MktgPrintAppendixLayout,
  MktgPrintCard,
  MktgPrintCardPage,
  MktgPrintCardRow,
  MktgPrintDividerView,
  MktgPrintFamilyCoverView,
  MktgPrintFamilyPlan,
  MktgPrintFaqEntry,
  MktgPrintFaqLine,
  MktgPrintFaqPage,
  MktgPrintFaqRow,
  MktgPrintPageChrome,
} from '../interfaces/mktg-print-pages.interface';
import type { MktgSlidesExportAssetKind } from '../interfaces/mktg-slides-export.interface';
import { brandKitContrastRatio, brandKitLuminance } from './brand-kit-book.utils';
import { brandKitMonthYear } from './brand-kit.utils';
import { isMktgFamilyExportAgentKey } from './mktg-family-export.utils';
import { mktgPrintCharEm, mktgPrintFitOrCut, mktgPrintPaginate, mktgPrintRichHeight, mktgPrintScaleRich } from './mktg-print-fit.utils';
import {
  mktgPrintContinued,
  mktgPrintEyebrowPara,
  mktgPrintFooterLine,
  mktgPrintMixHex,
  mktgPrintPageNumber,
  mktgPrintPara,
  mktgPrintRich,
  mktgPrintTextEl,
} from './mktg-print-page.utils';

// ---------------------------------------------------------------------------
// The family's grammar: numbers, running heads, cover and dividers
// ---------------------------------------------------------------------------

/** The parts the family print holds, in the exporter's (the deck's) order. */
export function mktgPrintFamilyParts(view: MktgFamilyPrintView): MktgSlidesExportAssetKind[] {
  return MKTG_SLIDES_EXPORT_ASSET_KINDS.filter((part) => view[part] !== null);
}

/** Each present part's two-digit number in the family order (`01` framework, `02` kit, …); a missing part renumbers the rest. */
export function mktgPrintFamilyPartNumbers(view: MktgFamilyPrintView): Partial<Record<MktgSlidesExportAssetKind, string>> {
  return Object.fromEntries(mktgPrintFamilyParts(view).map((part, index) => [part, mktgPrintPageNumber(index + 1)]));
}

/** The running head and footer of an appendix content page: `03 Boilerplates` left, `<Project> <Family>` right, the footer line under. */
export function mktgPrintPageChrome(projectName: string, familyName: string, partNumber: string, partTitle: string): MktgPrintPageChrome {
  return {
    eyebrowLeft: `${partNumber} ${partTitle}`.trim(),
    eyebrowRight: `${projectName.trim()} ${familyName}`.trim(),
    footerLine: mktgPrintFooterLine(projectName.trim()),
  };
}

/** A section divider's strings: `03 · POSITIONING & BRAND`, the part's title, and `4 boilerplates`. */
export function mktgPrintDivider(part: keyof typeof MKTG_PRINT_DIVIDER_NOUNS, partNumber: string, count: number, familyName: string): MktgPrintDividerView {
  const noun = MKTG_PRINT_DIVIDER_NOUNS[part];
  return {
    eyebrow: `${partNumber} · ${familyName.toUpperCase()}`,
    title: MKTG_PRINT_SECTION_TITLES[part],
    countLine: `${count} ${count === 1 ? noun.one : noun.many}`,
  };
}

/**
 * A section divider as a dark page of the shell (the spec's §3): the eyebrow in the accent when it reads 3:1 on the
 * dark (else the on-dark ink), the title in the on-dark ink, the count line in it softened with the dark as the deck
 * mixes it, the reversed lockup in the logo frame; no title band, no running head, no number.
 */
export function mktgPrintDividerPage(look: MktgPrintPageLook, divider: MktgPrintDividerView, logo: MktgPrintLogo | null): MktgPrintPage {
  const layout = MKTG_PRINT_DIVIDER_LAYOUT;
  const soft = mktgPrintMixHex(look.onDark, look.dark, layout.softShare);
  const accentReads = brandKitContrastRatio(brandKitLuminance(look.accent), brandKitLuminance(look.dark)) >= MKTG_PRINT_DIVIDER_EYEBROW_MIN_CONTRAST;
  const els: MktgPrintPageEl[] = [
    mktgPrintTextEl(layout.eyebrow, mktgPrintRich(look, [mktgPrintEyebrowPara(look, divider.eyebrow, { color: accentReads ? look.accent : look.onDark })])),
    mktgPrintTextEl(layout.title, mktgPrintRich(look, [mktgPrintPara(divider.title, layout.titleSize, { weight: 600 })], { color: look.onDark })),
    mktgPrintTextEl(layout.count, mktgPrintRich(look, [mktgPrintPara(divider.countLine, layout.countSize)], { color: soft })),
  ];
  if (logo) els.push({ t: 'image', box: MKTG_PRINT_PAGE_LOGO_FRAME, src: logo.src, alt: logo.alt, filter: logo.filter });
  return { layout: 'cover', title: '', titleRich: mktgPrintRich(look, [], { color: look.onDark }), els };
}

/** The agent whose document a part prints. */
function partAgentKey(part: MktgSlidesExportAssetKind): MktgFamilyExportAgentKey | undefined {
  return Object.keys(MKTG_FAMILY_EXPORT_KINDS)
    .filter(isMktgFamilyExportAgentKey)
    .find((agentKey) => MKTG_FAMILY_EXPORT_KINDS[agentKey] === part);
}

/**
 * The family cover's strings (the spec's §4): the footer line in capitals as the eyebrow, the newest printed
 * revision's month, the family's name, the brand line (else the tagline, else the parts in words), the footer line,
 * and the versions line of the parts present whose revision the data carries (the kit's in its `V1.0` form).
 */
export function mktgPrintFamilyCover(view: MktgFamilyPrintView, familyName: string): MktgPrintFamilyCoverView {
  const parts = mktgPrintFamilyParts(view);
  const line = view.framework?.mh.line.trim() || view.framework?.mf.tagline.trim() || '';
  const versions = parts.flatMap((part) => {
    const agentKey = partAgentKey(part);
    const number = agentKey === undefined ? undefined : view.revisionNumbers[agentKey];
    if (agentKey === undefined || number === undefined) return [];
    return [`${MKTG_FAMILY_EXPORT_VERSION_LABELS[agentKey]} ${part === 'kit' ? `V${number}.0` : `v${number}`}`];
  });
  const footerLeft = mktgPrintFooterLine(view.projectName.trim());
  return {
    eyebrow: footerLeft.toUpperCase(),
    date: brandKitMonthYear(view.newestRevisionAt ?? view.printedAt),
    title: familyName,
    subtitle: line || parts.map((part) => MKTG_PRINT_SECTION_TITLES[part]).join(' · '),
    footerLeft,
    footerRight: versions.join(' · '),
  };
}

// ---------------------------------------------------------------------------
// The appendix pages
// ---------------------------------------------------------------------------

/** A block measured as the deck measures its text boxes (the inks do not bear on the measure). */
function measured(paras: MktgPrintPara[]): MktgPrintRich {
  return { paras, color: '', font: null };
}

/** The height a block of text takes in a column `w` wide, no insets (the shell's measure takes a text box's insets off the width and adds them to the height). */
function textHeight(paras: MktgPrintPara[], w: number): number {
  return mktgPrintRichHeight(measured(paras), w + 2 * MKTG_PRINT_PAGE_INSET) - 2 * MKTG_PRINT_PAGE_INSET;
}

/** A type size at a share of itself, rounded as the shell rounds (down to the half point). */
function scaledSize(size: number, scale: number): number {
  return mktgPrintScaleRich(measured([mktgPrintPara('', size)]), scale).paras[0].size;
}

/** One line of text at `size`: the room a page keeps free under its rows, so a line the estimate missed never leaves the area. */
function lineOf(size: number): number {
  return size * MKTG_PRINT_PAGE_LINE;
}

/** The items in pairs, in order: `[1, 2], [3, 4], [5]`. */
function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

/** A boilerplate card's head: `ONE-LINER · 10 WORDS`, the label in capitals and the agent's own word count (never recounted). */
export function mktgPrintCardHead(row: BoilerplatesLengthRow): string {
  return `${row.label.toUpperCase()} · ${row.words} WORDS`;
}

/**
 * The boilerplates as pages of cards (the spec's §1): two to a row in contract order, as many rows to a page as the
 * area holds by the estimated heights, one body line kept free. A row taller than the budget is set smaller, both
 * cards together, down to the row floor, then the card still over is cut at a sentence. A lone last card closes the
 * part alone only when it is taller than the threshold; otherwise the row before comes down to join it. No lengths
 * give one page with no rows.
 */
export function paginateBoilerplateCards(
  lengths: BoilerplatesLengthRow[],
  layout: MktgPrintAppendixLayout = MKTG_PRINT_APPENDIX_LAYOUT,
  area: MktgPrintPageBox = MKTG_PRINT_PAGE_AREA
): MktgPrintCardPage[] {
  const budget = area.h - lineOf(MKTG_PRINT_PAGE_SIZE.card);
  const textWidth = (area.w - layout.cardColumnGap) / 2 - 2 * layout.cardPaddingX - 2 * layout.cardBorder;
  // The shell counts its capitals' tracking in their em; the label is tracked by its own share instead, so the head
  // wraps as if the column were narrower by the ratio of the two.
  const capsEm = mktgPrintCharEm({ caps: true });
  const headWidth = (textWidth * capsEm) / (capsEm - MKTG_PRINT_PAGE_CAPS_TRACKING_EM + layout.cardLabelTracking);
  const frame = 2 * layout.cardPaddingY + 2 * layout.cardBorder;
  const head = (row: BoilerplatesLengthRow) => mktgPrintPara(mktgPrintCardHead(row), MKTG_PRINT_PAGE_SIZE.eyebrow, { weight: 600, caps: true });
  const body = (text: string, size: number) => mktgPrintPara(text, size, { above: layout.cardBodyGap });
  const headHeight = (row: BoilerplatesLengthRow) => textHeight([head(row)], headWidth);
  const cardHeight = (row: BoilerplatesLengthRow, text: string, size: number) =>
    Math.max(layout.cardMinHeight, frame + headHeight(row) + textHeight([body(text, size)], textWidth));
  const rows = pairs(lengths).map((pair): MktgPrintCardRow => {
    let scale = 1;
    for (let s = 1; s >= layout.cardRowMinScale - 1e-9; s -= MKTG_PRINT_PAGE_SCALE_STEP) {
      scale = Math.round(s * 100) / 100;
      if (Math.max(...pair.map((row) => cardHeight(row, row.text, scaledSize(MKTG_PRINT_PAGE_SIZE.card, scale)))) <= budget + 0.01) break;
    }
    const cards = pair.map((row): MktgPrintCard => {
      const room = budget - frame - headHeight(row);
      const fitted = mktgPrintFitOrCut(
        measured([body(row.text, scaledSize(MKTG_PRINT_PAGE_SIZE.card, scale))]),
        textWidth + 2 * MKTG_PRINT_PAGE_INSET,
        room + 2 * MKTG_PRINT_PAGE_INSET,
        1
      );
      const text = fitted.rich.paras[0];
      return { index: row.index, head: head(row).text, text: text.text, size: text.size, cut: fitted.cut };
    });
    return { cards, height: Math.max(...pair.map((row, i) => cardHeight(row, cards[i].text, cards[i].size))), scale };
  });
  const fitsPage = (page: MktgPrintCardRow[]) => page.reduce((h, row) => h + row.height, 0) + (page.length - 1) * layout.cardRowGap <= budget + 0.01;
  const pages = mktgPrintPaginate(rows, fitsPage);
  const last = pages[pages.length - 1];
  const before = pages[pages.length - 2];
  if (last && before && last.length === 1 && last[0].cards.length === 1 && last[0].height <= layout.cardLoneMinHeight) {
    const moved = before[before.length - 1];
    if (fitsPage([moved, ...last])) {
      before.pop();
      last.unshift(moved);
      if (before.length === 0) pages.splice(pages.length - 2, 1);
    }
  }
  if (pages.length === 0) return [{ title: MKTG_PRINT_SECTION_TITLES.boilerplates, rows: [] }];
  return pages.map((page, index) => ({ title: mktgPrintContinued(MKTG_PRINT_SECTION_TITLES.boilerplates, index), rows: page }));
}

/** How many pages the boilerplates take: the assembly numbers the parts after them from it. */
export function mktgBoilerplatesPageCount(lengths: BoilerplatesLengthRow[]): number {
  return paginateBoilerplateCards(lengths).length;
}

/** A line that opens as a list item, as the deck reads one (its LIST_LINE): `- `, `* `, `• `, `1. ` or `1) `. */
const LIST_LINE = /^\s*(?:([-*•])|(\d+)[.)])\s+/;

/** The punctuation a dropped tail sheds before its `…` (the deck's cut), scanned once from the end. */
const TAIL_CHARS = ',;:.—-';

/** An answer's lines, blank ones dropped, each with its marker by kind. */
function faqLines(answer: string): MktgPrintFaqLine[] {
  return answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line): MktgPrintFaqLine => {
      const match = LIST_LINE.exec(line);
      if (!match) return { text: line, marker: '' };
      return { text: line.slice(match[0].length), marker: match[2] === undefined ? '-' : `${match[2]}.` };
    });
}

/** The lines back as restricted Markdown for the renderer: a list item by its kind, a run of items on consecutive lines, everything else a blank line apart. */
function faqMarkdown(lines: MktgPrintFaqLine[]): string {
  return lines
    .map((line, i) => {
      const text = line.marker === '' ? line.text : `${line.marker} ${line.text}`;
      if (i === 0) return text;
      const inRun = line.marker !== '' && lines[i - 1].marker !== '';
      return `${inRun ? '\n' : '\n\n'}${text}`;
    })
    .join('');
}

/**
 * The lines as paragraphs at `size` with the deck's gaps (its answerParas): the answer's gap under the question, a
 * paragraph after a paragraph none, a paragraph after an item a share of the size, an item after an item the item
 * gap, an item after a paragraph a share of the size. An item is a bullet paragraph (the deck's 18 pt indent).
 */
function faqAnswerParas(lines: MktgPrintFaqLine[], size: number, gaps: { answer: number; item: number }, layout: MktgPrintAppendixLayout): MktgPrintPara[] {
  return lines.map((line, i) => {
    const bullet = line.marker !== '';
    const afterItem = i > 0 && lines[i - 1].marker !== '';
    let above = 0;
    if (i === 0) above = gaps.answer;
    else if (bullet) above = afterItem ? gaps.item : size * layout.faqBulletAfterPlainEm;
    else if (afterItem) above = size * layout.faqPlainAfterBulletEm;
    return mktgPrintPara(line.text, size, { above, bullet });
  });
}

/** The lines with the last one marked `…` (the deck's mark of a dropped tail), its trailing punctuation shed first. */
function withEllipsis(lines: MktgPrintFaqLine[]): MktgPrintFaqLine[] {
  const last = lines[lines.length - 1];
  if (!last || last.text.endsWith('…')) return lines;
  let end = last.text.length;
  while (end > 0 && (/\s/.test(last.text[end - 1]) || TAIL_CHARS.includes(last.text[end - 1]))) end--;
  return [...lines.slice(0, -1), { ...last, text: `${last.text.slice(0, end)}…` }];
}

/** A gap at a share of itself, rounded as the shell rounds a paragraph's space above (to the tenth of a point). */
function scaledGap(gap: number, scale: number): number {
  return Math.round(gap * scale * 10) / 10;
}

/**
 * The FAQ as pages of a two-column grid (the spec's §2): the pairs in group order flowing row by row, each column
 * a text box of the deck's (the text wrapping inside its insets, an entry's height the text's without them), a row
 * as tall as the taller entry; as many rows to a page as fit at 100 %, then 95 %, then 90 % of the sizes and gaps,
 * the whole page together, one answer line kept free; the rest continues on a numbered page. An entry taller than
 * the budget alone is fitted as the deck fits an item: the whole entry set smaller down to the floor; still over,
 * the question kept whole and the answer fitted to the room left (its longest paragraph cut at a sentence), then
 * its trailing paragraphs dropped and the last kept marked `…`; a question that alone fills the area is cut as
 * any block. An unanswered question prints its label; a source prints its line. No questions give one page with
 * no rows.
 */
export function paginateFaqPairs(
  groups: FaqGroupView[],
  layout: MktgPrintAppendixLayout = MKTG_PRINT_APPENDIX_LAYOUT,
  area: MktgPrintPageBox = MKTG_PRINT_PAGE_AREA
): MktgPrintFaqPage[] {
  // The deck's boxes are whole points: 327 on the page area.
  const columnWidth = Math.floor((area.w - layout.faqColumnGap) / 2);
  const inset = 2 * MKTG_PRINT_PAGE_INSET;
  const budgetAt = (s: number) => area.h - lineOf(scaledSize(layout.faqAnswerSize, s));
  const height = (paras: MktgPrintPara[]) => mktgPrintRichHeight(measured(paras), columnWidth) - inset;
  const question = (entry: MktgPrintFaqEntry) => mktgPrintPara(entry.question, entry.questionSize, { weight: layout.faqQuestionWeight });
  const source = (entry: MktgPrintFaqEntry): MktgPrintPara[] =>
    entry.source ? [mktgPrintPara(`${MKTG_PRINT_SOURCE_LEAD} · ${entry.source}`, entry.sourceSize, { above: entry.sourceGap })] : [];
  const answer = (entry: MktgPrintFaqEntry, lines: MktgPrintFaqLine[]): MktgPrintPara[] => {
    const gaps = { answer: entry.answerGap, item: entry.listItemGap };
    return entry.answered
      ? faqAnswerParas(lines, entry.answerSize, gaps, layout)
      : [mktgPrintPara(MKTG_FAQ_PRINT_UNANSWERED, entry.answerSize, { above: entry.answerGap })];
  };
  const paras = (entry: MktgPrintFaqEntry): MktgPrintPara[] => [question(entry), ...answer(entry, faqLines(entry.answer)), ...source(entry)];
  const sized = (entry: MktgPrintFaqEntry, s: number): MktgPrintFaqEntry => ({
    ...entry,
    questionSize: scaledSize(entry.questionSize, s),
    answerSize: scaledSize(entry.answerSize, s),
    sourceSize: scaledSize(entry.sourceSize, s),
    answerGap: scaledGap(entry.answerGap, s),
    listItemGap: scaledGap(entry.listItemGap, s),
    sourceGap: scaledGap(entry.sourceGap, s),
  });
  const fitEntry = (base: MktgPrintFaqEntry, lines: MktgPrintFaqLine[]): MktgPrintFaqEntry => {
    const budget = budgetAt(1);
    for (let s = 1; s >= MKTG_PRINT_PAGE_MIN_SCALE - 1e-9; s -= MKTG_PRINT_PAGE_SCALE_STEP) {
      const entry = sized(base, s);
      if (height(paras(entry)) <= budget + 0.01) return entry;
    }
    const floor = sized(base, MKTG_PRINT_PAGE_MIN_SCALE);
    if (lines.length === 0) {
      // Nothing under the question to fit: it is over the budget by itself, so it is cut as any block is.
      const fitted = mktgPrintFitOrCut(measured(paras(floor)), columnWidth, budget + inset, 1);
      return { ...floor, question: fitted.rich.paras[0].text, cut: fitted.cut };
    }
    const room = budget - height([question(floor), ...source(floor)]) + inset;
    const fits = (kept: MktgPrintFaqLine[]) => height([question(floor), ...answer(floor, kept), ...source(floor)]) <= budget + 0.01;
    const fitted = mktgPrintFitOrCut(measured(answer(floor, lines)), columnWidth, room, 1);
    const cutLines = lines.map((line, i) => ({ ...line, text: fitted.rich.paras[i].text }));
    if (fits(cutLines)) return { ...floor, answer: faqMarkdown(cutLines), cut: fitted.cut };
    for (let kept = cutLines.length - 1; kept >= 1; kept--) {
      const tail = withEllipsis(cutLines.slice(0, kept));
      if (fits(tail)) return { ...floor, answer: faqMarkdown(tail), cut: true };
    }
    return { ...floor, answer: faqMarkdown(withEllipsis(cutLines.slice(0, 1))), cut: true };
  };
  const entries = groups.flatMap((group) =>
    group.questions.map((row): MktgPrintFaqEntry => {
      const lines = row.answered ? faqLines(row.answer) : [];
      const base: MktgPrintFaqEntry = {
        path: row.path,
        question: row.question,
        answer: faqMarkdown(lines),
        answered: row.answered,
        source: row.source,
        questionSize: layout.faqQuestionSize,
        answerSize: layout.faqAnswerSize,
        sourceSize: MKTG_PRINT_PAGE_SIZE.eyebrow,
        answerGap: layout.faqAnswerGap,
        listItemGap: layout.faqListItemGap,
        sourceGap: layout.faqSourceGap,
        cut: false,
      };
      return height(paras(base)) <= budgetAt(1) + 0.01 ? base : fitEntry(base, lines);
    })
  );
  const rowHeight = (row: MktgPrintFaqEntry[], s: number) => Math.max(...row.map((entry) => height(paras(sized(entry, s)))));
  const fitsAt = (page: MktgPrintFaqEntry[][], s: number) =>
    page.reduce((h, row) => h + rowHeight(row, s), 0) + (page.length - 1) * layout.faqRowGap <= budgetAt(s) + 0.01;
  const smallest = layout.faqPageScales[layout.faqPageScales.length - 1] ?? 1;
  const pages = mktgPrintPaginate(pairs(entries), (page) => fitsAt(page, smallest));
  if (pages.length === 0) return [{ title: MKTG_PRINT_SECTION_TITLES.faq, scale: 1, rows: [] }];
  return pages.map((page, index): MktgPrintFaqPage => {
    const scale = layout.faqPageScales.find((s) => fitsAt(page, s)) ?? smallest;
    const rows = page.map((row): MktgPrintFaqRow => ({ entries: row.map((entry) => sized(entry, scale)), height: rowHeight(row, scale) }));
    return { title: mktgPrintContinued(MKTG_PRINT_SECTION_TITLES.faq, index), scale, rows };
  });
}

/** How many pages the FAQ takes: the assembly numbers the parts after it from it. */
export function mktgFaqPageCount(groups: FaqGroupView[]): number {
  return paginateFaqPairs(groups).length;
}

/** How many questions a FAQ print holds, for its divider's count line. */
export function mktgPrintFaqQuestionCount(groups: FaqGroupView[]): number {
  return groups.reduce((n, group) => n + group.questions.length, 0);
}

// ---------------------------------------------------------------------------
// The family's page plan
// ---------------------------------------------------------------------------

/**
 * The family print's page plan from the parts present and the framework's and the kit's page counts (0 while a part
 * prints in its own flow): the cover is 1, then the framework, the kit, each appendix part's divider and pages, and
 * the back cover. The assembly passes each appendix part its `firstPage` from it.
 */
export function mktgPrintFamilyPlan(view: MktgFamilyPrintView, frameworkPages = 0, kitPages = 0): MktgPrintFamilyPlan {
  const lengths = view.boilerplates?.lengths ?? [];
  const groups = view.faq?.groups ?? [];
  const boilerplatePages = view.boilerplates ? mktgBoilerplatesPageCount(lengths) : 0;
  const faqPages = view.faq ? mktgFaqPageCount(groups) : 0;
  let next = 2 + (view.framework ? frameworkPages : 0) + (view.kit ? kitPages : 0);
  const boilerplatesFirstPage = view.boilerplates ? next + 1 : next;
  if (view.boilerplates) next = boilerplatesFirstPage + boilerplatePages;
  const faqFirstPage = view.faq ? next + 1 : next;
  if (view.faq) next = faqFirstPage + faqPages;
  return {
    numbers: mktgPrintFamilyPartNumbers(view),
    boilerplatesFirstPage,
    faqFirstPage,
    boilerplateCount: lengths.length,
    faqQuestionCount: mktgPrintFaqQuestionCount(groups),
    pageCount: next - 1 + (view.kit ? 1 : 0),
  };
}
