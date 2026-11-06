// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The page grammar the landscape prints share, on the deck's 720 × 405 pt
// canvas: a port of marketing-os-agents agents/slides-export src/pages.ts
// (7839d985). The running head as two eyebrow lines above the title (the
// book's "01 Logo · <Project> Brand Kit"), the title in the band, and the
// body under it — the book's grid of a 30% text column and the visual beside
// it. Every text block is fitted before it is placed (mktg-print-fit.utils).
// Free of any one document's knowledge: the kit book, the framework and the
// family pages build their pages with it. Pure.

import {
  MKTG_PRINT_PAGE_BACK_TITLE_BOX,
  MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX,
  MKTG_PRINT_PAGE_CUT_MIN_CHARS,
  MKTG_PRINT_PAGE_CUT_SHARE,
  MKTG_PRINT_PAGE_COVER_TITLE_BOX,
  MKTG_PRINT_PAGE_FOOTER_LEFT_BOX,
  MKTG_PRINT_PAGE_FOOTER_RIGHT_BOX,
  MKTG_PRINT_PAGE_HEAD_LEFT_BOX,
  MKTG_PRINT_PAGE_HEAD_RIGHT_BOX,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LEFT,
  MKTG_PRINT_PAGE_MIN_SCALE,
  MKTG_PRINT_PAGE_MUTED_INK,
  MKTG_PRINT_PAGE_ROW_GAP,
  MKTG_PRINT_PAGE_RULE_INK,
  MKTG_PRINT_PAGE_SCALE_PROPERTY,
  MKTG_PRINT_PAGE_SCALE_STEP,
  MKTG_PRINT_PAGE_SIZE,
  MKTG_PRINT_PAGE_STACK_GAP,
  MKTG_PRINT_PAGE_TITLE_BOX,
} from '../constants/mktg-print-page.constants';
import type {
  MktgPrintPage,
  MktgPrintPageBox,
  MktgPrintPageEl,
  MktgPrintPageElView,
  MktgPrintPageHead,
  MktgPrintPageLine,
  MktgPrintPageLook,
  MktgPrintPageShape,
  MktgPrintPageShapeEl,
  MktgPrintPara,
  MktgPrintRich,
  MktgPrintRichView,
  MktgPrintStackBlock,
} from '../interfaces/mktg-print-page.interface';
import type { MktgPrintBrand } from '../interfaces/mktg-print.interface';
import { MKTG_PRINT_BODY_INK_MIN_CONTRAST, MKTG_PRINT_INK_ON_DARK, MKTG_PRINT_INK_ON_LIGHT } from '../constants/mktg-print.constants';
import { brandKitContrastRatio, brandKitLuminance } from './brand-kit-book.utils';
import { mktgPrintCutText, mktgPrintFitOrCut, mktgPrintRichHeight, mktgPrintScaleRich } from './mktg-print-fit.utils';

/**
 * A length in deck points as CSS on a page: `calc(var(--mktg-page-scale) * <n>pt)`, scaled once by the
 * property the page shell sets (MKTG_PRINT_PAGE_SCALE_PROPERTY). Consumers size in deck points, never by a factor.
 */
export function mktgPagePt(n: number): string {
  return `calc(var(${MKTG_PRINT_PAGE_SCALE_PROPERTY}) * ${Math.round(n * 100) / 100}pt)`;
}

/** The CSS inset styles of a box on the 720 × 405 pt canvas, in deck points through mktgPagePt. */
export function mktgPageBoxStyle(box: MktgPrintPageBox): Record<string, string> {
  return { left: mktgPagePt(box.x), top: mktgPagePt(box.y), width: mktgPagePt(box.w), height: mktgPagePt(box.h) };
}

/** A paragraph's inline CSS: its size and space above in page units, its weight, colour and typeface when set. */
export function mktgPrintParaStyle(p: MktgPrintPara): Record<string, string> {
  const style: Record<string, string> = { 'font-size': mktgPagePt(p.size) };
  if (p.above) style['margin-top'] = mktgPagePt(p.above);
  if (p.weight) style['font-weight'] = String(p.weight);
  if (p.color) style['color'] = p.color;
  if (p.font) style['font-family'] = p.font;
  return style;
}

/** A text block as the page shell renders it: each paragraph with its CSS, built once per page, never per change detection. */
export function mktgPrintRichView(rich: MktgPrintRich): MktgPrintRichView {
  return { rich, paras: rich.paras.map((para) => ({ para, style: mktgPrintParaStyle(para) })) };
}

/** A page element as the page shell renders it: its box's CSS, a shape's fill and outline (an inset shadow, so the box keeps its size), and its text's view. */
export function mktgPrintElView(el: MktgPrintPageEl): MktgPrintPageElView {
  const style = mktgPageBoxStyle(el.box);
  if (el.t !== 'shape') return { el, style, text: null };
  if (el.fill) style['background-color'] = el.fill;
  // A solid outline as an inset shadow (no box growth, no corner gap); a dashed one as a border, which a shadow cannot draw.
  if (el.line?.dash) style['border'] = `${mktgPagePt(el.line.weight)} dashed ${el.line.color}`;
  else if (el.line) style['box-shadow'] = `inset 0 0 0 ${mktgPagePt(el.line.weight)} ${el.line.color}`;
  return { el, style, text: el.text ? mktgPrintRichView(el.text) : null };
}

/** A `#RRGGBB` colour. */
const HEX_RGB = /^#[0-9a-f]{6}$/i;

/**
 * Two colours mixed per channel, `share` of `b` in `a`, rounded (the deck's
 * color.ts `mix`); a colour that is not `#RRGGBB` cannot be mixed and `a` is
 * returned as it is.
 */
export function mktgPrintMixHex(a: string, b: string, share: number): string {
  if (!HEX_RGB.test(a) || !HEX_RGB.test(b)) return a;
  const channel = (offset: number) => {
    const from = Number.parseInt(a.slice(offset, offset + 2), 16);
    const to = Number.parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(from * (1 - share) + to * share)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}

/** The ink on the brand's dark: white when it reads there (AA), else the app's darkest gray; a dark that is no `#RRGGBB` keeps the brand's own. */
function mktgPrintOnDarkInk(brand: MktgPrintBrand, hex: boolean): string {
  if (!hex) return brand.onDark;
  const contrast = brandKitContrastRatio(brandKitLuminance(brand.dark), brandKitLuminance(MKTG_PRINT_INK_ON_DARK));
  if (contrast >= MKTG_PRINT_BODY_INK_MIN_CONTRAST) return MKTG_PRINT_INK_ON_DARK;
  return MKTG_PRINT_INK_ON_LIGHT;
}

/**
 * The look a print's brand gives its pages, as the deck's look.ts computes it
 * from the kit (7839d985): the dark and the accent; the tint 6% of the dark in
 * white; the ink on the dark white when it reaches AA there, else the app's
 * darkest gray; the muted ink 30% white in the dark (the book's 70% opacity);
 * the rule 16% of the dark in white (the book's black/10); the typeface. The
 * body ink is the brand's (`ink`: the dark where it reads on white, else the
 * app's darkest gray), so a kit whose dark is white keeps its text legible
 * while its covers and panels keep the dark. A dark that is not `#RRGGBB`
 * keeps the brand's own tint and on-dark ink and takes the app's grays for
 * the muted ink and the rule.
 */
export function mktgPrintPageLook(brand: MktgPrintBrand): MktgPrintPageLook {
  const hex = HEX_RGB.test(brand.dark);
  const onDark = mktgPrintOnDarkInk(brand, hex);
  return {
    dark: brand.dark,
    ink: brand.ink,
    accent: brand.accent,
    tint: hex ? mktgPrintMixHex(MKTG_PRINT_INK_ON_DARK, brand.dark, 0.06) : brand.tint,
    muted: hex ? mktgPrintMixHex(brand.dark, MKTG_PRINT_INK_ON_DARK, 0.3) : MKTG_PRINT_PAGE_MUTED_INK,
    rule: hex ? mktgPrintMixHex(MKTG_PRINT_INK_ON_DARK, brand.dark, 0.16) : MKTG_PRINT_PAGE_RULE_INK,
    onDark,
    font: brand.fontStack,
  };
}

export function mktgPrintPara(text: string, size: number, opts: Omit<MktgPrintPara, 'text' | 'size'> = {}): MktgPrintPara {
  return { text, size, ...opts };
}

/** An eyebrow label: small capitals in the muted ink. */
export function mktgPrintEyebrowPara(look: MktgPrintPageLook, text: string, opts: Omit<MktgPrintPara, 'text' | 'size'> = {}): MktgPrintPara {
  return { text, size: MKTG_PRINT_PAGE_SIZE.eyebrow, caps: true, color: look.muted, weight: 600, ...opts };
}

/** A block of text in the look's body ink and typeface (its colour, alignment and anchor overridable). */
export function mktgPrintRich(look: MktgPrintPageLook, paras: MktgPrintPara[], opts: Partial<Omit<MktgPrintRich, 'paras'>> = {}): MktgPrintRich {
  return { paras: paras.filter((p) => p.text.trim() !== ''), color: look.ink, font: look.font, ...opts };
}

/** A text box (or a shape holding text) with its text fitted to the box: set smaller, then cut. */
export function mktgPrintTextEl(
  box: MktgPrintPageBox,
  r: MktgPrintRich,
  opts: { shape?: MktgPrintPageShape; fill?: string | null; line?: MktgPrintPageLine | null; min?: number } = {}
): MktgPrintPageShapeEl {
  const fitted = mktgPrintFitOrCut(r, box.w, box.h, opts.min ?? MKTG_PRINT_PAGE_MIN_SCALE).rich;
  const el: MktgPrintPageShapeEl = { t: 'shape', shape: opts.shape ?? 'TEXT_BOX', box, text: fitted };
  if (opts.fill !== undefined) el.fill = opts.fill;
  if (opts.line !== undefined) el.line = opts.line;
  return el;
}

/** A filled shape with no text. */
export function mktgPrintShapeEl(
  shape: MktgPrintPageShape,
  box: MktgPrintPageBox,
  fill: string | null,
  line: MktgPrintPageLine | null = null
): MktgPrintPageShapeEl {
  return { t: 'shape', shape, box, fill, line };
}

/** A hairline rule across a width at y. */
export function mktgPrintHairline(look: MktgPrintPageLook, x: number, y: number, w: number, color = look.rule): MktgPrintPageShapeEl {
  return mktgPrintShapeEl('RECTANGLE', { x, y, w, h: 0.75 }, color);
}

/** The text column of a page: its prose and lists at the book's size. */
export function mktgPrintProseColumn(look: MktgPrintPageLook, paras: MktgPrintPara[], box: MktgPrintPageBox = MKTG_PRINT_PAGE_LEFT): MktgPrintPageShapeEl {
  return mktgPrintTextEl(box, mktgPrintRich(look, paras));
}

/** Prose paragraphs for a column, the space between them the book's. */
export function mktgPrintProseParas(texts: string[], size: number = MKTG_PRINT_PAGE_SIZE.prose): MktgPrintPara[] {
  return texts.filter((t) => t.trim() !== '').map((t, i) => mktgPrintPara(t, size, { above: i === 0 ? 0 : size * 0.7 }));
}

/** Bulleted list paragraphs. */
export function mktgPrintBulletParas(items: string[], size: number = MKTG_PRINT_PAGE_SIZE.prose, firstAbove = 0): MktgPrintPara[] {
  return items.filter((t) => t.trim() !== '').map((t, i) => mktgPrintPara(t, size, { bullet: true, above: i === 0 ? firstAbove : size * 0.45 }));
}

/**
 * Text blocks stacked down a column, each in a box as tall as it needs, the
 * gaps kept: all set smaller together until the stack fits the height, then
 * the longest prose cut, so the column never overflows. Returns the boxes'
 * elements and the y below the last.
 */
export function mktgPrintStack(blocks: MktgPrintStackBlock[], x: number, y: number, w: number, maxH: number): { els: MktgPrintPageShapeEl[]; bottom: number } {
  const gaps = blocks.reduce((g, b, i) => g + (i === 0 ? 0 : (b.gap ?? MKTG_PRINT_PAGE_STACK_GAP)), 0);
  let scaled = blocks.map((b) => b.rich);
  let found = false;
  for (let s = 1; s >= MKTG_PRINT_PAGE_MIN_SCALE - 1e-9; s -= MKTG_PRINT_PAGE_SCALE_STEP) {
    const cand = blocks.map((b) => (s === 1 ? b.rich : mktgPrintScaleRich(b.rich, s)));
    if (cand.reduce((h, r) => h + mktgPrintRichHeight(r, w), 0) + gaps <= maxH + 0.01) {
      scaled = cand;
      found = true;
      break;
    }
  }
  if (!found) {
    scaled = blocks.map((b) => mktgPrintScaleRich(b.rich, MKTG_PRINT_PAGE_MIN_SCALE));
    for (let guard = 0; guard < 80; guard++) {
      const heights = scaled.map((r) => mktgPrintRichHeight(r, w));
      if (heights.reduce((a, b) => a + b, 0) + gaps <= maxH + 0.01) break;
      let bi = -1;
      let pi = -1;
      scaled.forEach((r, i) =>
        r.paras.forEach((p, j) => {
          if (p.runs || p.text.length < MKTG_PRINT_PAGE_CUT_MIN_CHARS) return;
          if (bi === -1 || p.text.length > scaled[bi].paras[pi].text.length) {
            bi = i;
            pi = j;
          }
        })
      );
      if (bi === -1) break;
      const p = scaled[bi].paras[pi];
      const cut = mktgPrintCutText(p.text, Math.floor(p.text.length * MKTG_PRINT_PAGE_CUT_SHARE));
      if (cut === p.text) break;
      scaled = scaled.map((r, i) => (i === bi ? { ...r, paras: r.paras.map((q, j) => (j === pi ? { ...q, text: cut } : q)) } : r));
    }
  }
  const els: MktgPrintPageShapeEl[] = [];
  let cy = y;
  scaled.forEach((r, i) => {
    if (i > 0) cy += blocks[i].gap ?? MKTG_PRINT_PAGE_STACK_GAP;
    const h = Math.min(mktgPrintRichHeight(r, w), y + maxH - cy);
    const el: MktgPrintPageShapeEl = { t: 'shape', shape: blocks[i].shape ?? 'TEXT_BOX', box: { x, y: cy, w, h }, text: r };
    if (blocks[i].fill !== undefined) el.fill = blocks[i].fill;
    if (blocks[i].line !== undefined) el.line = blocks[i].line;
    els.push(el);
    cy += h;
  });
  return { els, bottom: cy };
}

/** The height a row of text takes on the page: its lines, no insets (the box around it lets its insets overlap the rows around). */
export function mktgPrintRowHeight(r: MktgPrintRich, w: number): number {
  return mktgPrintRichHeight(r, w) - 2 * MKTG_PRINT_PAGE_INSET + MKTG_PRINT_PAGE_ROW_GAP;
}

/**
 * A row's text bounded to a page: a row taller than `budget` (the height the
 * rows of one page share) is set smaller, then cut, until its row height
 * fits. `mktgPrintPaginate` puts a row on a page of its own however tall it
 * is, so without this one oversized row would run off the page.
 */
export function mktgPrintClampRow(r: MktgPrintRich, w: number, budget: number): MktgPrintRich {
  if (mktgPrintRowHeight(r, w) <= budget + 0.01) return r;
  return mktgPrintFitOrCut(r, w, budget + 2 * MKTG_PRINT_PAGE_INSET - MKTG_PRINT_PAGE_ROW_GAP).rich;
}

/** A row's text box: the row's lines at `top`, the box's insets reaching into the gaps around the row (boxes have no fill, so they overlap unseen). */
export function mktgPrintRowEl(x: number, top: number, w: number, r: MktgPrintRich): MktgPrintPageShapeEl {
  return mktgPrintTextEl({ x, y: top - MKTG_PRINT_PAGE_INSET + MKTG_PRINT_PAGE_ROW_GAP / 2, w, h: mktgPrintRichHeight(r, w) }, r);
}

/** Row texts set at the largest of 100%, 95% and 90% at which they all fit `h` stacked; at 100% when none does (they continue). */
export function mktgPrintScaleRows(rows: MktgPrintRich[], w: number, h: number): MktgPrintRich[] {
  for (const s of [1, 0.95, 0.9]) {
    const scaled = rows.map((r) => (s === 1 ? r : mktgPrintScaleRich(r, s)));
    if (scaled.reduce((t, r) => t + mktgPrintRowHeight(r, w), 0) <= h) return scaled;
  }
  return rows;
}

/** The running head's two eyebrow lines as elements: left the chapter or section, right the document. */
export function mktgPrintHeadEls(look: MktgPrintPageLook, head: MktgPrintPageHead): MktgPrintPageShapeEl[] {
  return [
    mktgPrintTextEl(MKTG_PRINT_PAGE_HEAD_LEFT_BOX, mktgPrintRich(look, [mktgPrintEyebrowPara(look, head.left)])),
    mktgPrintTextEl(MKTG_PRINT_PAGE_HEAD_RIGHT_BOX, mktgPrintRich(look, [mktgPrintEyebrowPara(look, head.right)], { align: 'END' })),
  ];
}

/** The title as set in the content layout's title band, fitted to it, in the body ink. */
export function mktgPrintTitleRich(
  look: MktgPrintPageLook,
  title: string,
  size: number = MKTG_PRINT_PAGE_SIZE.title,
  box: MktgPrintPageBox = MKTG_PRINT_PAGE_TITLE_BOX
): MktgPrintRich {
  return mktgPrintFitOrCut({ paras: [mktgPrintPara(title, size, { weight: 600 })], color: look.ink, font: look.font, anchor: 'BOTTOM' }, box.w, box.h).rich;
}

/** The title as set in the cover layout's placeholder: large, on the dark ground in the on-dark ink, fitted to the box. */
export function mktgPrintCoverTitleRich(look: MktgPrintPageLook, title: string, size: number = MKTG_PRINT_PAGE_SIZE.coverTitle): MktgPrintRich {
  return mktgPrintFitOrCut(
    { paras: [mktgPrintPara(title, size, { weight: 600 })], color: look.onDark, font: look.font, anchor: 'BOTTOM' },
    MKTG_PRINT_PAGE_COVER_TITLE_BOX.w,
    MKTG_PRINT_PAGE_COVER_TITLE_BOX.h
  ).rich;
}

/** The back cover's title: a brand line in capitals, centred on the dark ground in the on-dark ink, fitted to its box. */
export function mktgPrintBackTitleRich(look: MktgPrintPageLook, title: string): MktgPrintRich {
  return mktgPrintFitOrCut(
    {
      paras: [mktgPrintPara(title, MKTG_PRINT_PAGE_SIZE.title, { caps: true, weight: 600 })],
      color: look.onDark,
      font: look.font,
      align: 'CENTER',
      anchor: 'MIDDLE',
    },
    MKTG_PRINT_PAGE_BACK_TITLE_BOX.w,
    MKTG_PRINT_PAGE_BACK_TITLE_BOX.h
  ).rich;
}

/** A content page: the running head as two eyebrow lines, the title in the band, the body elements. The footer comes from mktgPrintWithFooter. */
export function mktgPrintContentPage(look: MktgPrintPageLook, title: string, head: MktgPrintPageHead, els: MktgPrintPageEl[]): MktgPrintPage {
  return { layout: 'content', title, titleRich: mktgPrintTitleRich(look, title), head, els };
}

/** The footer's line: `<project> · a Linux Foundation project` (every page carries it and its number). */
export function mktgPrintFooterLine(projectName: string): string {
  return `${projectName} · a Linux Foundation project`;
}

/**
 * The page footer's elements in the cover's form: the footer line left,
 * clear of the layout's bottom-left logo, the page number right, in the
 * head's size and the muted ink, under the body.
 */
export function mktgPrintFooterEls(look: MktgPrintPageLook, left: string, number: string, color = look.muted): MktgPrintPageShapeEl[] {
  return [
    mktgPrintTextEl(MKTG_PRINT_PAGE_FOOTER_LEFT_BOX, mktgPrintRich(look, [mktgPrintPara(left, MKTG_PRINT_PAGE_SIZE.head, { color })])),
    mktgPrintTextEl(MKTG_PRINT_PAGE_FOOTER_RIGHT_BOX, mktgPrintRich(look, [mktgPrintPara(number, MKTG_PRINT_PAGE_SIZE.head, { color })], { align: 'END' })),
  ];
}

/** A page's number as the footer and the contents print it: two digits. */
export function mktgPrintPageNumber(number: number): string {
  return String(number).padStart(2, '0');
}

/** A content page with the footer: the line left, the page's number right (two digits, as the contents list it). */
export function mktgPrintWithFooter(page: MktgPrintPage, left: string, number: number): MktgPrintPage {
  return { ...page, footer: { left, number: mktgPrintPageNumber(number) } };
}

/**
 * A cover: the title and the subtitle in the cover layout's placeholders,
 * both fitted, on the dark ground; `els` the cover's own lines (its eyebrow
 * and footer, in the ink that reads on the ground).
 */
export function mktgPrintCoverPage(
  look: MktgPrintPageLook,
  title: string,
  subtitle: string,
  els: MktgPrintPageEl[],
  titleSize: number = MKTG_PRINT_PAGE_SIZE.coverTitle
): MktgPrintPage {
  const titleRich = mktgPrintCoverTitleRich(look, title, titleSize);
  const subtitleRich = mktgPrintFitOrCut(
    { paras: [mktgPrintPara(subtitle, MKTG_PRINT_PAGE_SIZE.coverSubtitle)], color: look.onDark, font: look.font },
    MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX.w,
    MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX.h
  ).rich;
  return { layout: 'cover', title, titleRich, subtitle: subtitleRich, els };
}

/** A back cover: the title (a brand line) in capitals, centred, on the dark ground; `els` its own lines. */
export function mktgPrintBackPage(look: MktgPrintPageLook, title: string, els: MktgPrintPageEl[]): MktgPrintPage {
  return { layout: 'back', title, titleRich: mktgPrintBackTitleRich(look, title), els };
}

/** "Title", "Title (2)", … : the title of the i-th page a list continues on. */
export function mktgPrintContinued(title: string, i: number): string {
  return i === 0 ? title : `${title} (${i + 1})`;
}

/** A text with a sentence appended when it does not already say it. */
export function mktgPrintWithSentence(text: string, sentence: string): string {
  const t = text.trim();
  if (t === '') return sentence;
  return t.includes(sentence) ? t : `${t} ${sentence}`;
}

/** A text without the given note. */
export function mktgPrintWithoutNote(text: string, note: string): string {
  const n = note.trim();
  if (n === '' || !text.includes(n)) return text.trim();
  return text
    .replace(n, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A text without its sentences about where values were found (research provenance never reaches a page). */
export function mktgPrintWithoutSourceSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/^(values|colou?rs?|the values)\b[^.]*\b(come|came|found|taken|read)\b/i.test(s.trim()))
    .join(' ')
    .trim();
}

/** Items in words: `a`, `a and b`, `a, b and c`. */
export function mktgPrintInWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
