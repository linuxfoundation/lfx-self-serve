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
  MKTG_PORTRAIT_HEX_REGEX,
  MKTG_PORTRAIT_INKS,
  MKTG_PORTRAIT_PAGE_NUMBER_DIGITS,
  MKTG_PORTRAIT_WEIGHT_WIDTH,
} from '../constants/mktg-portrait-print.constants';
import type { MktgPrintBrand } from '../interfaces/mktg-print.interface';
import type { MktgPortraitFitBlock, MktgPortraitFitPara, MktgPortraitFitResult, MktgPortraitLook } from '../interfaces/mktg-portrait-print.interface';
import { brandKitContrastRatio, brandKitInkOnAccent, brandKitLuminance } from './brand-kit-book.utils';

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

/**
 * A headline with no widow: its last two words joined by a no-break space, so
 * a line never ends on one short word alone ("… for agentic" / "AI."). One
 * word, or none, is returned as it is; the words' other spaces are kept.
 */
export function mktgNoWidow(text: string): string {
  const trimmed = text.trim();
  const at = trimmed.search(/\s+\S+$/);
  if (at <= 0) return trimmed;
  return `${trimmed.slice(0, at)}\u00a0${trimmed.slice(at).trimStart()}`;
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
  return `${mktgPortraitTrimTail(out || text.slice(0, Math.max(1, max - 1)))}…`;
}

/** The characters an ellipsis replaces at the end of a cut: spaces and the punctuation a cut sentence or word leaves behind. */
const CUT_TAIL = new Set([' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', ',', ';', ':', '.', '—', '-']);

/** A cut's text without its trailing spaces and punctuation, read from the end one character at a time (linear, whatever the text). */
export function mktgPortraitTrimTail(text: string): string {
  let end = text.length;
  while (end > 0 && CUT_TAIL.has(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

/**
 * The block fitted to its box, always: set smaller, in steps, down to
 * `minScale` of its preferred size; when it still does not fit, the longest
 * paragraph is cut at a sentence (then at a word) until it does. The result
 * says what happened, so a page can show the cut.
 */
export function mktgPortraitFitBlock(block: MktgPortraitFitBlock, width: number, height: number, minScale = MKTG_PORTRAIT_FIT.minScale): MktgPortraitFitResult {
  // Each step is measured at the scale the page will print (two decimals, the grammar's --kp-fit), not the loop's
  // floating value: 0.8399… floors a 12.5 px line to 10 px where 0.84 prints 10.5.
  for (let step = 0; ; step += 1) {
    const scale = Math.round((1 - step * MKTG_PORTRAIT_FIT.scaleStep) * 100) / 100;
    if (scale < minScale - 1e-9) break;
    const scaled = scale === 1 ? block : mktgPortraitScaleBlock(block, scale);
    if (mktgPortraitFits(scaled, width, height)) return { block: scaled, scale, cut: false };
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

// ---------- the text accent ----------

/** WCAG 1.4.3's threshold for ordinary text, the ratio `mktgPortraitAccentText` reaches. */
export const MKTG_PORTRAIT_TEXT_CONTRAST = 4.5;

/**
 * The accent as TEXT on a light page: the kit's accent darkened, in OKLab (lightness alone, the hue and chroma kept as
 * far as the gamut allows), until it reads on the paper at WCAG AA for ordinary text (≥ 4.5:1); an accent that already
 * does is returned as it is, as is anything that is not a six-digit hex. Bound on every frame as `--pp-accent-text`
 * and used for every text set in the accent (the section label under the band, rule numbers, numerals); fills, bands
 * and rules keep the accent itself, which the editor measured at 2.76:1 as text.
 */
export function mktgPortraitAccentText(accent: string, paper: string = MKTG_PORTRAIT_INKS.white): string {
  if (!MKTG_PORTRAIT_HEX_REGEX.test(accent) || !MKTG_PORTRAIT_HEX_REGEX.test(paper)) return accent;
  const paperLuminance = brandKitLuminance(paper);
  const reads = (hex: string): boolean => brandKitContrastRatio(paperLuminance, brandKitLuminance(hex)) >= MKTG_PORTRAIT_TEXT_CONTRAST;
  if (reads(accent)) return accent;
  const [lightness, a, b] = mktgPortraitOklab(accent);
  for (let l = lightness - 0.005; l > 0; l -= 0.005) {
    const hex = mktgPortraitOklabHex(l, a, b);
    if (reads(hex)) return hex;
  }
  return '#000000';
}

/** A six-digit hex in OKLab (Björn Ottosson's matrices), for perceptual darkening. */
function mktgPortraitOklab(hex: string): [number, number, number] {
  const linear = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [linear(1), linear(3), linear(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** An OKLab colour back as a six-digit hex, each channel clipped to the sRGB gamut. */
function mktgPortraitOklabHex(lightness: number, a: number, b: number): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channel = (linear: number): string => {
    const clipped = Math.min(1, Math.max(0, linear));
    const srgb = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`;
}
