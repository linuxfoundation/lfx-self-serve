// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The portrait print grammar's pure helpers: the look a document is set in,
// the page number and the chapter test the frames share, and the fit model
// of a text that must stay in its frame — set smaller, then cut at a
// sentence (the Google Slides exporter's model, in px). A document's page
// plan is `mktg-portrait-plan.utils.ts`.

import {
  MKTG_PORTRAIT_CAPS_TRACKING_EM,
  MKTG_PORTRAIT_FAMILY_WIDTH,
  MKTG_PORTRAIT_FAMILY_WIDTH_DEFAULT,
  MKTG_PORTRAIT_FIT,
  MKTG_PORTRAIT_GLYPH_WIDTH_DEFAULT,
  MKTG_PORTRAIT_GLYPH_WIDTHS,
  MKTG_PORTRAIT_PAGE_NUMBER_DIGITS,
  MKTG_PORTRAIT_WEIGHT_WIDTH,
} from '../constants/mktg-portrait-print.constants';
import type { MktgPrintBrand } from '../interfaces/mktg-print.interface';
import type { MktgPortraitFitBlock, MktgPortraitFitPara, MktgPortraitFitResult, MktgPortraitLook } from '../interfaces/mktg-portrait-print.interface';
import { brandKitInkOnAccent } from './brand-kit-book.utils';

/**
 * The look of a portrait document from the print's brand: the kit's dark
 * and accent, its spark (the secondary accent the caller names, else the
 * accent again), the ink on the accent by the shared rule (white only where
 * it reaches AA, else the dark: never white on a coral), and the font stack.
 */
export function mktgPortraitLook(brand: MktgPrintBrand, spark: string | null = null): MktgPortraitLook {
  const accent = brand.accent;
  return {
    dark: brand.dark,
    accent,
    spark: spark?.trim() || accent,
    onDark: brand.onDark,
    onAccent: brandKitInkOnAccent(accent, brand.dark),
    fontStack: brand.fontStack,
  };
}

/** The footer's page number: `03`. */
export function mktgPortraitPageNumber(page: number): string {
  return String(page).padStart(MKTG_PORTRAIT_PAGE_NUMBER_DIGITS, '0');
}

/** Whether a running-head section label names a numbered chapter (`01 Logo`), whose first page carries the band. */
export function mktgPortraitIsChapter(section: string): boolean {
  return /^\d\d /.test(section);
}

/** Average character width in ems: wider for bold and for capitals. */
export function mktgPortraitCharEm(para: Pick<MktgPortraitFitPara, 'weight' | 'caps'>): number {
  if (para.caps) return MKTG_PORTRAIT_FIT.charEmCaps;
  return (para.weight ?? 400) >= 600 ? MKTG_PORTRAIT_FIT.charEmBold : MKTG_PORTRAIT_FIT.charEm;
}

/** The first family of a CSS font stack, lowercased and unquoted: `'Instrument Sans', sans-serif` → `instrument sans`. */
function firstFamily(stack: string | undefined): string {
  return (stack ?? '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
}

/** How much wider than the table a weight sets a line: the nearest named weight at or below it. */
function weightWidth(weight: number): number {
  const named = Object.keys(MKTG_PORTRAIT_WEIGHT_WIDTH)
    .map(Number)
    .filter((named) => named <= weight)
    .sort((a, b) => b - a)[0];
  return MKTG_PORTRAIT_WEIGHT_WIDTH[named ?? 400] ?? 1;
}

/**
 * The width one line of `text` takes at `size` px, measured glyph by glyph
 * (the sans table, widened for the family and the weight; capitals with their
 * tracking): the measure for a line that must stay whole at its real size.
 * It is not the paragraph model's flat average, which wraps safely but
 * would shrink a line that fits.
 */
export function mktgPortraitTextWidth(text: string, size: number, para: Pick<MktgPortraitFitPara, 'weight' | 'caps' | 'family' | 'tracking'> = {}): number {
  const shown = para.caps ? text.toUpperCase() : text;
  const glyphs = Array.from(shown).reduce((sum, char) => sum + (MKTG_PORTRAIT_GLYPH_WIDTHS[char] ?? MKTG_PORTRAIT_GLYPH_WIDTH_DEFAULT), 0) / 1000;
  const trackingEm = para.tracking ?? (para.caps ? MKTG_PORTRAIT_CAPS_TRACKING_EM : 0);
  const tracking = Math.max(0, Array.from(shown).length - 1) * trackingEm;
  const family = MKTG_PORTRAIT_FAMILY_WIDTH[firstFamily(para.family)] ?? MKTG_PORTRAIT_FAMILY_WIDTH_DEFAULT;
  return (glyphs * family * weightWidth(para.weight ?? 400) + tracking) * size;
}

/** Whether one line of `text` fits `width` px at `size` px, by the measured width. */
export function mktgPortraitLineFits(
  text: string,
  width: number,
  size: number,
  para: Pick<MktgPortraitFitPara, 'weight' | 'caps' | 'family' | 'tracking'> = {}
): boolean {
  return mktgPortraitTextWidth(text, size, para) <= width + 0.01;
}

/** Characters per line in a column `width` px wide at `size` px. */
export function mktgPortraitCharsPerLine(width: number, size: number, para: Pick<MktgPortraitFitPara, 'weight' | 'caps'> = {}): number {
  return Math.max(1, Math.floor(width / (size * mktgPortraitCharEm(para))));
}

/** Lines one hard line wraps to at `max` characters per line (greedy by words; a word longer than a line breaks). */
function wrapLine(text: string, max: number): number {
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (word.length > max) {
      if (used > 0) lines++;
      const pieces = Math.ceil(word.length / max);
      lines += pieces - 1;
      used = word.length - (pieces - 1) * max;
      continue;
    }
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= max) {
      used = need;
    } else {
      lines++;
      used = word.length;
    }
  }
  return lines;
}

/** Lines a text wraps to at `max` characters per line; each hard line wraps on its own, a blank one counting as a line. */
export function mktgPortraitWrapLines(text: string, max: number): number {
  return text.split(/\r?\n|\v/).reduce((count, line) => count + wrapLine(line, max), 0);
}

/** The height of one paragraph in a column `width` px wide, its space above included. */
export function mktgPortraitParaHeight(para: MktgPortraitFitPara, width: number): number {
  const lines = mktgPortraitWrapLines(para.text, mktgPortraitCharsPerLine(width, para.size, para));
  return (para.above ?? 0) + lines * para.size * para.line;
}

/** The height a block needs in a box `width` px wide. */
export function mktgPortraitBlockHeight(block: MktgPortraitFitBlock, width: number): number {
  return block.paras.reduce((height, para) => height + mktgPortraitParaHeight(para, width), 0);
}

/** Whether a block fits a box. */
export function mktgPortraitFits(block: MktgPortraitFitBlock, width: number, height: number): boolean {
  return mktgPortraitBlockHeight(block, width) <= height + 0.01;
}

/** The block with every size (and space above) scaled by `scale`, sizes rounded down to the half px. */
export function mktgPortraitScaleBlock(block: MktgPortraitFitBlock, scale: number): MktgPortraitFitBlock {
  const size = (value: number) => Math.max(1, Math.floor(value * scale * 2) / 2);
  return {
    paras: block.paras.map((para) => ({ ...para, size: size(para.size), above: para.above ? Math.round(para.above * scale * 10) / 10 : para.above })),
  };
}

/** The sentences of a text. */
export function mktgPortraitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

/** A text cut to at most `max` characters: whole sentences when one fits, else whole words and an ellipsis. */
export function mktgPortraitCutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const sentence of mktgPortraitSentences(text)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out !== '') return out;
  out = '';
  for (const word of text.split(/\s+/)) {
    const next = out ? `${out} ${word}` : word;
    if (next.length + 1 > max) break;
    out = next;
  }
  return `${(out || text.slice(0, Math.max(1, max - 1))).replace(/[\s,;:.—-]+$/, '')}…`;
}

/**
 * The block fitted to its box, always: set smaller, in steps, down to
 * `minScale` of its preferred size; when it still does not fit, the longest
 * paragraph is cut at a sentence (then at a word) until it does. The result
 * says what happened, so a page can show the cut.
 */
export function mktgPortraitFitBlock(block: MktgPortraitFitBlock, width: number, height: number, minScale = MKTG_PORTRAIT_FIT.minScale): MktgPortraitFitResult {
  for (let scale = 1; scale >= minScale - 1e-9; scale -= MKTG_PORTRAIT_FIT.scaleStep) {
    const scaled = scale === 1 ? block : mktgPortraitScaleBlock(block, scale);
    if (mktgPortraitFits(scaled, width, height)) return { block: scaled, scale: Math.round(scale * 100) / 100, cut: false };
  }
  let current = mktgPortraitScaleBlock(block, minScale);
  for (let guard = 0; guard < MKTG_PORTRAIT_FIT.maxCuts && !mktgPortraitFits(current, width, height); guard++) {
    let longest = -1;
    current.paras.forEach((para, index) => {
      if (para.text.length < MKTG_PORTRAIT_FIT.minCutLength) return;
      if (longest === -1 || para.text.length > current.paras[longest].text.length) longest = index;
    });
    if (longest === -1) break;
    const para = current.paras[longest];
    const text = mktgPortraitCutText(para.text, Math.floor(para.text.length * MKTG_PORTRAIT_FIT.cutShare));
    if (text === para.text || text.length >= para.text.length) break;
    current = { paras: current.paras.map((entry, index) => (index === longest ? { ...entry, text } : entry)) };
  }
  return { block: current, scale: minScale, cut: true };
}

/** A text cut to fit one line `width` px wide at `size` px (unchanged when it already fits). */
export function mktgPortraitOneLine(text: string, width: number, size: number, para: Pick<MktgPortraitFitPara, 'weight' | 'caps'> = {}): string {
  const max = mktgPortraitCharsPerLine(width, size, para);
  return text.length <= max ? text : mktgPortraitCutText(text, max);
}

/** Items split into pages: as many as fit per page, in order, at least one per page. `fitsPage(items)` says whether a page holding those items fits. */
export function mktgPortraitPaginate<T>(items: readonly T[], fitsPage: (page: T[]) => boolean): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const next = [...current, item];
    if (current.length > 0 && !fitsPage(next)) {
      pages.push(current);
      current = [item];
    } else {
      current = next;
    }
  }
  if (current.length) pages.push(current);
  return pages;
}
