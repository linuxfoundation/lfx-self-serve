// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family PDF's own pages (Download PDF on the family card): the appendix
// paginated in TypeScript from the data by the shell's fit model, as the
// Slides exporter paginates the deck (never by CSS flow, so every browser and
// paper gives the same pages), and the strings and page models of the cover,
// the dividers and the running heads. Pure: the templates bind the results.

import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_FAMILY_EXPORT_KINDS } from '../constants/mktg-family-export.constants';
import { MKTG_FAQ_PRINT_UNANSWERED } from '../constants/mktg-print.constants';
import {
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LOGO_FRAME,
  MKTG_PRINT_PAGE_SCALE_STEP,
  MKTG_PRINT_PAGE_SIZE,
} from '../constants/mktg-print-page.constants';
import {
  MKTG_PRINT_APPENDIX_LAYOUT,
  MKTG_PRINT_DIVIDER_EYEBROW_MIN_CONTRAST,
  MKTG_PRINT_DIVIDER_LAYOUT,
  MKTG_PRINT_DIVIDER_NOUNS,
  MKTG_PRINT_FAMILY_PARTS,
  MKTG_PRINT_SECTION_TITLES,
  MKTG_PRINT_SOURCE_LEAD,
} from '../constants/mktg-print-pages.constants';
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
  MktgPrintFamilyPart,
  MktgPrintFamilyPlan,
  MktgPrintFaqEntry,
  MktgPrintFaqPage,
  MktgPrintFaqRow,
  MktgPrintPageChrome,
} from '../interfaces/mktg-print-pages.interface';
import { brandKitContrastRatio, brandKitLuminance } from './brand-kit-book.utils';
import { brandKitMonthYear } from './brand-kit.utils';
import { mktgPrintFitOrCut, mktgPrintPaginate, mktgPrintRichHeight, mktgPrintScaleRich } from './mktg-print-fit.utils';
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

/** The parts the family print holds, in the deck's order. */
export function mktgPrintFamilyParts(view: MktgFamilyPrintView): MktgPrintFamilyPart[] {
  return MKTG_PRINT_FAMILY_PARTS.filter((part) => view[part] !== null);
}

/** Each present part's two-digit number in the family order (`01` framework, `02` kit, …); a missing part renumbers the rest. */
export function mktgPrintFamilyPartNumbers(view: MktgFamilyPrintView): Partial<Record<MktgPrintFamilyPart, string>> {
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

const PART_AGENT_KEYS = Object.fromEntries(Object.entries(MKTG_FAMILY_EXPORT_KINDS).map(([agentKey, part]) => [part, agentKey])) as Record<
  MktgPrintFamilyPart,
  MktgFamilyExportAgentKey
>;

/**
 * The family cover's strings (the spec's §4): the footer line in capitals as the eyebrow, the newest printed
 * revision's month, the family's name, the brand line (else the tagline, else the parts in words), the footer line,
 * and the versions of the parts present whose revision the data carries (the kit's in its `V1.0` form).
 */
export function mktgPrintFamilyCover(view: MktgFamilyPrintView, familyName: string): MktgPrintFamilyCoverView {
  const parts = mktgPrintFamilyParts(view);
  const line = view.framework?.mh.line.trim() || view.framework?.mf.tagline.trim() || '';
  const versions = parts.flatMap((part) => {
    const agentKey = PART_AGENT_KEYS[part];
    const number = view.revisionNumbers[agentKey];
    if (number === undefined) return [];
    const label = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === agentKey)?.label ?? MKTG_PRINT_SECTION_TITLES[part];
    return [`${label} ${part === 'kit' ? `V${number}.0` : `v${number}`}`];
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

/** The shell's measure takes a text box's insets off the width and adds them to the height: the box a column `w` × `h` of text needs. */
function textBox(w: number, h: number): MktgPrintPageBox {
  return { x: 0, y: 0, w: w + 2 * MKTG_PRINT_PAGE_INSET, h: h + 2 * MKTG_PRINT_PAGE_INSET };
}

/** The height a block of text takes in a column `w` wide, no insets. */
function textHeight(paras: MktgPrintPara[], w: number): number {
  return mktgPrintRichHeight(measured(paras), w + 2 * MKTG_PRINT_PAGE_INSET) - 2 * MKTG_PRINT_PAGE_INSET;
}

/** A type size at a share of itself, rounded as the shell rounds (down to the half point). */
function scaledSize(size: number, scale: number): number {
  return mktgPrintScaleRich(measured([mktgPrintPara('', size)]), scale).paras[0].size;
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
 * area holds by the estimated heights. A row taller than the area is set smaller, both cards together, down to the
 * row floor, then the card still over is cut at a sentence. A lone last card closes the part alone only when it is
 * taller than the threshold; otherwise the row before comes down to join it. No lengths give one page with no rows.
 */
export function paginateBoilerplateCards(
  lengths: BoilerplatesLengthRow[],
  layout: MktgPrintAppendixLayout = MKTG_PRINT_APPENDIX_LAYOUT,
  area: MktgPrintPageBox = MKTG_PRINT_PAGE_AREA
): MktgPrintCardPage[] {
  const textWidth = (area.w - layout.cardColumnGap) / 2 - 2 * layout.cardPaddingX;
  const frame = 2 * layout.cardPaddingY + 2 * layout.cardBorder;
  const head = (row: BoilerplatesLengthRow) => mktgPrintPara(mktgPrintCardHead(row), MKTG_PRINT_PAGE_SIZE.eyebrow, { weight: 600, caps: true });
  const body = (text: string, size: number) => mktgPrintPara(text, size, { above: layout.cardBodyGap });
  const cardHeight = (card: { head: string; text: string; size: number }) =>
    Math.max(
      layout.cardMinHeight,
      frame + textHeight([mktgPrintPara(card.head, MKTG_PRINT_PAGE_SIZE.eyebrow, { weight: 600, caps: true }), body(card.text, card.size)], textWidth)
    );
  const rows = pairs(lengths).map((pair): MktgPrintCardRow => {
    let scale = 1;
    for (let s = 1; s >= layout.cardRowMinScale - 1e-9; s -= MKTG_PRINT_PAGE_SCALE_STEP) {
      scale = Math.round(s * 100) / 100;
      if (
        Math.max(...pair.map((row) => cardHeight({ head: head(row).text, text: row.text, size: scaledSize(MKTG_PRINT_PAGE_SIZE.card, scale) }))) <=
        area.h + 0.01
      )
        break;
    }
    const cards = pair.map((row): MktgPrintCard => {
      const room = area.h - frame - textHeight([head(row)], textWidth);
      const box = textBox(textWidth, room);
      const fitted = mktgPrintFitOrCut(measured([body(row.text, scaledSize(MKTG_PRINT_PAGE_SIZE.card, scale))]), box.w, box.h, 1);
      const text = fitted.rich.paras[0];
      return { index: row.index, head: head(row).text, text: text.text, size: text.size, cut: fitted.cut };
    });
    return { cards, height: Math.max(...cards.map(cardHeight)), scale };
  });
  const fitsPage = (page: MktgPrintCardRow[]) => page.reduce((h, row) => h + row.height, 0) + (page.length - 1) * layout.cardRowGap <= area.h + 0.01;
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

const LIST_LINE = /^\s*(?:[-*]|\d+\.)\s+/;

/** An answer's restricted Markdown as paragraphs: a line that opens as a list item (`- `, `* `, `1. `) is a bullet paragraph with the list's gap over it. */
function faqAnswerParas(answer: string, size: number, layout: MktgPrintAppendixLayout): MktgPrintPara[] {
  const lines = answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.map((line, i) => {
    const bullet = LIST_LINE.test(line);
    let above = layout.faqAnswerGap;
    if (i > 0 && bullet) above = layout.faqListItemGap;
    return mktgPrintPara(line.replace(LIST_LINE, ''), size, { bullet, above });
  });
}

/** The restricted Markdown an answer's paragraphs read as (after a cut): list items as `- ` lines, paragraphs a blank line apart. */
function faqAnswerMarkdown(paras: MktgPrintPara[]): string {
  return paras.map((p, i) => (p.bullet ? `- ${p.text}` : `${i > 0 ? '\n' : ''}${p.text}`)).join('\n');
}

/**
 * The FAQ as pages of a two-column grid (the spec's §2): the pairs in group order flowing row by row, a row as tall
 * as the taller pair; as many rows to a page as fit at 100 %, then 95 %, then 90 % of the sizes, the whole page
 * together; the rest continues on a numbered page. A pair taller than the area alone is set smaller, then its
 * longest text cut at a sentence. An unanswered question prints its label; a source prints its line. No questions
 * give one page with no rows.
 */
export function paginateFaqPairs(
  groups: FaqGroupView[],
  layout: MktgPrintAppendixLayout = MKTG_PRINT_APPENDIX_LAYOUT,
  area: MktgPrintPageBox = MKTG_PRINT_PAGE_AREA
): MktgPrintFaqPage[] {
  const columnWidth = (area.w - layout.faqColumnGap) / 2;
  const sourceSize: number = MKTG_PRINT_PAGE_SIZE.eyebrow;
  const paras = (entry: MktgPrintFaqEntry, source = sourceSize): MktgPrintPara[] => [
    mktgPrintPara(entry.question, entry.questionSize, { weight: layout.faqQuestionWeight }),
    ...(entry.answered
      ? faqAnswerParas(entry.answer, entry.answerSize, layout)
      : [mktgPrintPara(MKTG_FAQ_PRINT_UNANSWERED, entry.answerSize, { above: layout.faqAnswerGap })]),
    ...(entry.source ? [mktgPrintPara(`${MKTG_PRINT_SOURCE_LEAD} · ${entry.source}`, source, { above: layout.faqSourceGap })] : []),
  ];
  const entries = groups.flatMap((group) =>
    group.questions.map((row): MktgPrintFaqEntry => {
      const base: MktgPrintFaqEntry = {
        path: row.path,
        question: row.question,
        answer: row.answered ? row.answer : '',
        answered: row.answered,
        source: row.source,
        questionSize: layout.faqQuestionSize,
        answerSize: layout.faqAnswerSize,
        cut: false,
      };
      if (textHeight(paras(base), columnWidth) <= area.h + 0.01) return base;
      const box = textBox(columnWidth, area.h);
      const fitted = mktgPrintFitOrCut(measured(paras(base)), box.w, box.h);
      const [question, answer, ...rest] = fitted.rich.paras;
      const answerParas = [answer, ...rest].slice(0, row.source ? -1 : undefined);
      return {
        ...base,
        question: question.text,
        answer: row.answered ? faqAnswerMarkdown(answerParas) : '',
        questionSize: question.size,
        answerSize: answer.size,
        cut: fitted.cut,
      };
    })
  );
  const sized = (entry: MktgPrintFaqEntry, s: number): MktgPrintFaqEntry => ({
    ...entry,
    questionSize: scaledSize(entry.questionSize, s),
    answerSize: scaledSize(entry.answerSize, s),
  });
  const rowHeight = (row: MktgPrintFaqEntry[], s: number) =>
    Math.max(...row.map((entry) => textHeight(paras(sized(entry, s), scaledSize(sourceSize, s)), columnWidth)));
  const fitsAt = (page: MktgPrintFaqEntry[][], s: number) =>
    page.reduce((h, row) => h + rowHeight(row, s), 0) + (page.length - 1) * layout.faqRowGap <= area.h + 0.01;
  const smallest = layout.faqPageScales[layout.faqPageScales.length - 1] ?? 1;
  const pages = mktgPrintPaginate(pairs(entries), (page) => fitsAt(page, smallest));
  if (pages.length === 0) return [{ title: MKTG_PRINT_SECTION_TITLES.faq, scale: 1, sourceSize, rows: [] }];
  return pages.map((page, index): MktgPrintFaqPage => {
    const scale = layout.faqPageScales.find((s) => fitsAt(page, s)) ?? smallest;
    const rows = page.map((row): MktgPrintFaqRow => ({ entries: row.map((entry) => sized(entry, scale)), height: rowHeight(row, scale) }));
    return { title: mktgPrintContinued(MKTG_PRINT_SECTION_TITLES.faq, index), scale, sourceSize: scaledSize(sourceSize, scale), rows };
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
