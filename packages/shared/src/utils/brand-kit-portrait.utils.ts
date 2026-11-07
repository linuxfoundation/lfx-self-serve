// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's portrait pages, pure over the kit's book view: the
// artwork a page draws, the logo files table, the palette's sources, the
// approval line and the few derived strings. A fact the view does not hold
// is left out (null, '' or no row), never written here.

import {
  BRAND_KIT_PORTRAIT_ATTRIBUTES,
  BRAND_KIT_PORTRAIT_BACK_COVER_LINE,
  BRAND_KIT_PORTRAIT_WATCHOUT_RETYPED,
  BRAND_KIT_PORTRAIT_WIDE_SYMBOL_ASPECT,
  BRAND_KIT_PORTRAIT_CONTENTS,
  BRAND_KIT_PORTRAIT_CONTRAST,
  BRAND_KIT_PORTRAIT_GRADE_INKS,
  BRAND_KIT_PORTRAIT_INTRO,
  BRAND_KIT_PORTRAIT_MESSAGE_CARD,
  BRAND_KIT_PORTRAIT_MONO_FILTER,
  BRAND_KIT_PORTRAIT_MONTHS,
  BRAND_KIT_PORTRAIT_RECOLOR_FILTER,
  BRAND_KIT_PORTRAIT_RULE_LISTS,
  BRAND_KIT_PORTRAIT_SCALE_META_PX,
  BRAND_KIT_PORTRAIT_SOURCES,
  BRAND_KIT_PORTRAIT_TYPE_PAGE,
  BRAND_KIT_PORTRAIT_USAGE_ACCENT_MOMENTS,
  BRAND_KIT_PORTRAIT_USAGE_LINES,
  BRAND_KIT_PORTRAIT_VOICE_MESSAGES,
  BRAND_KIT_PORTRAIT_WEIGHT_NAMES,
} from '../constants/brand-kit-portrait.constants';
import { lfxColors } from '../constants/colors.constants';
import { BRAND_KIT_FOUND_IN_LABELS, BRAND_KIT_REPORT_ASSET_LABELS } from '../constants/brand-kit.constants';
import { MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import { MKTG_PORTRAIT_FIT, MKTG_PORTRAIT_MORE_LINE } from '../constants/mktg-portrait-print.constants';
import type {
  BrandKitBookView,
  BrandKitContrastGrade,
  BrandKitLogoImage,
  BrandKitPaletteEntry,
  BrandKitTypeStep,
  BrandKitUsageView,
  BrandKitWatchoutKind,
  BrandKitWatchoutView,
} from '../interfaces/brand-kit.interface';
import type {
  BrandKitPortraitAccentMoment,
  BrandKitPortraitArtworkMode,
  BrandKitPortraitAttributesFit,
  BrandKitPortraitContentsLayout,
  BrandKitPortraitContrastLayout,
  BrandKitPortraitRuleListRoom,
  BrandKitPortraitRulesFit,
  BrandKitPortraitVoiceMessagesFit,
  BrandKitPortraitContrastCell,
  BrandKitPortraitContrastGrade,
  BrandKitPortraitContrastRow,
  BrandKitPortraitFileRow,
  BrandKitPortraitSources,
  BrandKitPortraitSourcesFit,
  BrandKitPortraitTypeLayout,
  BrandKitPortraitTypeSourceLine,
  BrandKitPortraitTypeStep,
  BrandKitPortraitUsageCard,
} from '../interfaces/brand-kit-portrait.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import type { MktgPrintLogo } from '../interfaces/mktg-print.interface';
import type { MktgPortraitFitBlock, MktgPortraitFitPara } from '../interfaces/mktg-portrait-print.interface';
import {
  brandKitBestInkOn,
  brandKitContrastGradeOf,
  brandKitContrastRatio,
  brandKitInWords,
  brandKitLuminance,
  brandKitRatioLabel,
  BRAND_KIT_NOT_SUPPLIED,
} from './brand-kit-book.utils';
import {
  mktgKeepName,
  mktgNoWidow,
  mktgPortraitBlockHeight,
  mktgPortraitCharsPerLine,
  mktgPortraitCutText,
  mktgPortraitFitBlock,
  mktgPortraitFits,
  mktgPortraitLargestFitting,
  mktgPortraitLineFits,
  mktgPortraitMoreLine,
  mktgPortraitParaHeight,
  mktgPortraitScaleBlock,
  mktgPortraitSentences,
  mktgPortraitTrimStopWords,
  mktgPortraitTrimTail,
  mktgPortraitWrapLines,
} from './mktg-portrait-print.utils';
import { mktgReadableSourceName, mktgReadableSourceText } from './mktg-readable-source.utils';
import { brandKitLogoFileName, brandKitWebsiteHost } from './brand-kit.utils';

/** The CSS filter of each artwork mode. */
const ARTWORK_FILTERS: Readonly<Record<BrandKitPortraitArtworkMode, string>> = {
  full: '',
  reversed: MKTG_PRINT_REVERSED_FILTER,
  mono: BRAND_KIT_PORTRAIT_MONO_FILTER,
};

/**
 * The artwork a portrait page draws in a slot, or null when the kit has no
 * file for it (the slot is then left out). The lockup is the primary file;
 * reversed, it is the supplied reversed file as it is, else the primary
 * filtered to white; one-colour, the primary filtered to black. The symbol
 * is the symbol file or the primary cropped to it, filtered the same way;
 * the stacked lockup is only ever its own file. A filter is applied only to
 * a slot whose own artwork is one ink (`view.derivable`, per slot): other
 * artwork would flatten to one shape under it, so, reversed, the slot draws
 * it in full colour on a white plate (`plate`, `brandKitPortraitPlate`; the
 * tiles that name their colorway say "Not supplied" instead).
 */
export function brandKitPortraitArtwork(
  view: BrandKitBookView,
  kind: 'lockup' | 'symbol' | 'stacked',
  mode: BrandKitPortraitArtworkMode = 'full'
): MktgPrintLogo | null {
  const alt = { lockup: 'Horizontal lockup', symbol: 'Symbol', stacked: 'Stacked lockup' }[kind];
  const derivable = kind === 'symbol' ? view.derivable.symbol : view.derivable.lockup;
  const filter = derivable ? ARTWORK_FILTERS[mode] : '';
  if (kind === 'lockup' && mode === 'reversed' && view.logos.reversed?.src) {
    return { src: view.logos.reversed.src, alt: 'Reversed lockup', filter: '', aspect: view.logos.reversed.aspect ?? null };
  }
  const images: Record<typeof kind, BrandKitLogoImage | null> = { lockup: view.logos.primary, symbol: view.symbol, stacked: view.logos.stacked };
  const image = images[kind];
  if (!image?.src) return null;
  const aspect = image.aspect ?? null;
  return mode === 'reversed' && !derivable ? { src: image.src, alt, filter, plate: true, aspect } : { src: image.src, alt, filter, aspect };
}

/** A file's format from its reference: `SVG`, `PNG`, …, or `File`. */
function brandKitPortraitFormat(image: BrandKitLogoImage): string {
  if (image.src) return 'SVG';
  const extension = brandKitLogoFileName(image.ref)?.match(/\.([a-z0-9]+)$/i)?.[1];
  return extension ? extension.toUpperCase() : 'File';
}

/**
 * The logo files table of the Logo system page: the four slots, each with
 * its format, colour variant and whether it was supplied. A missing file is
 * one plain line (the reversed and the symbol say what the book does in
 * its place); file names are never printed.
 */
export function brandKitPortraitFiles(view: BrandKitBookView): BrandKitPortraitFileRow[] {
  const { primary, reversed, symbol, stacked } = view.logos;
  const cropped = !symbol && !!view.symbol?.src;
  return [
    { slot: 'primary', name: 'Horizontal lockup', format: formatOf(primary), variant: 'Full color', source: suppliedOr(primary, BRAND_KIT_NOT_SUPPLIED) },
    { slot: 'reversed', name: 'Reversed (white)', format: formatOf(reversed), variant: 'White', source: suppliedOr(reversed, reversedFallback(view)) },
    { slot: 'symbol', name: 'Symbol', format: symbolFormat(symbol, cropped), variant: 'Full color', source: symbolSource(symbol, cropped) },
    { slot: 'stacked', name: 'Stacked lockup', format: formatOf(stacked), variant: 'Full color', source: suppliedOr(stacked, BRAND_KIT_NOT_SUPPLIED) },
  ];
}

/**
 * The Logo system page's line in place of its tiles when the kit has uploads
 * but no artwork the print can draw (every supplied file is a PNG or a ZIP
 * member without bytes): the supplied slots by the files table's own words
 * (slot and format, never a file name: the page prints none), and the fact
 * that this book draws inline SVG artwork only. Empty when a tile can draw
 * something, or when nothing was uploaded.
 */
export function brandKitPortraitUndrawableFilesLine(view: BrandKitBookView): string {
  const uploads = Object.values(view.logos).filter((image): image is BrandKitLogoImage => !!image);
  if (uploads.length === 0 || uploads.some((image) => !!image.src) || !!view.symbol?.src) return '';
  const supplied = brandKitPortraitFiles(view)
    .filter((row) => row.source === 'Supplied')
    .map((row) => `${row.name.toLowerCase()} (${row.format})`);
  const one = supplied.length === 1;
  // "Inline artwork": an SVG the record names without its bytes (a package member, a rejected upload) is as undrawable as a PNG.
  return `This book draws inline SVG artwork only. The supplied ${brandKitInWords(supplied)} ${one ? 'is' : 'are'} listed below and not drawn here.`;
}

/** A slot's format column: the file's format, or a dash without a file. */
function formatOf(image: BrandKitLogoImage | null): string {
  return image ? brandKitPortraitFormat(image) : '—';
}

/**
 * Whether the lockup on a dark ground needs the white plate: the kit
 * supplied no reversed file and the primary cannot be derived from by
 * filter, so it is drawn in full colour, which the kit's own watch-out
 * forbids bare on a dark ground. The covers read this for the logo the
 * family print hands them (`MktgPrintBrand.logoOnDark`).
 */
export function brandKitPortraitPlate(view: BrandKitBookView): boolean {
  return !!view.logos.primary?.src && !view.logos.reversed?.src && !view.derivable.lockup;
}

/**
 * Whether the kit's symbol is a wide one (its viewBox's aspect over
 * `BRAND_KIT_PORTRAIT_WIDE_SYMBOL_ASPECT`): the Symbol page then shows it in
 * rounded squares only and says so. An unknown aspect reads as square-ish.
 */
export function brandKitPortraitSymbolIsWide(view: BrandKitBookView): boolean {
  const aspect = view.symbol?.aspect ?? null;
  return aspect !== null && aspect > BRAND_KIT_PORTRAIT_WIDE_SYMBOL_ASPECT;
}

/** A slot's source column: `Supplied` with a file, else the line the book says in its place. */
function suppliedOr(image: BrandKitLogoImage | null, otherwise: string): string {
  return image ? 'Supplied' : otherwise;
}

/** What the book does for a missing reversed file: derives it from the horizontal file when there is one. */
function reversedFallback(view: BrandKitBookView): string {
  return view.logos.primary && view.derivable.lockup ? 'Not supplied: this book derives it from the horizontal file' : BRAND_KIT_NOT_SUPPLIED;
}

/** The symbol's format: its file's, `SVG (crop)` when the book crops it out of the lockup, else a dash. */
function symbolFormat(symbol: BrandKitLogoImage | null, cropped: boolean): string {
  if (symbol) return brandKitPortraitFormat(symbol);
  return cropped ? 'SVG (crop)' : '—';
}

/** The symbol's source: supplied, cropped out of the lockup, or not supplied. */
function symbolSource(symbol: BrandKitLogoImage | null, cropped: boolean): string {
  if (symbol) return 'Supplied';
  return cropped ? 'Cropped out of the horizontal lockup' : BRAND_KIT_NOT_SUPPLIED;
}

/**
 * Where a palette value was found, as the palette page prints it under the
 * swatch: the kind in words, and the site's host for a stylesheet or a
 * page; never a file name or a URL.
 */
export function brandKitPortraitPaletteSource(entry: BrandKitPaletteEntry): string {
  const label = BRAND_KIT_FOUND_IN_LABELS[entry.found_in.kind];
  if (entry.found_in.kind === 'logo' || entry.found_in.kind === 'page' || entry.found_in.kind === 'unsourced') return label;
  const host = brandKitWebsiteHost(/^https?:\/\//i.test(entry.found_in.source.trim()) ? entry.found_in.source.trim() : null);
  return host ? `${label} — ${host}` : label;
}

/** The share of a palette colour in the proportion rows, or null when the rows do not name it. */
export function brandKitPortraitShare(view: BrandKitBookView, hex: string): number | null {
  return view.proportion.find((row) => row.hex.toLowerCase() === hex.toLowerCase())?.share ?? null;
}

/** `6 Nov 2026` (UTC, the month from a fixed table so every engine and ICU prints the same), or '' for a date the store cannot parse. */
export function brandKitPortraitDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCDate()} ${BRAND_KIT_PORTRAIT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * The approval line of the contents page: `Approved 6 Nov 2026 by <name>`,
 * `Approved 6 Nov 2026` without a recorded approver, '' without an
 * approval (the line is then left out).
 */
export function brandKitPortraitApprovalLine(approval: MktgRevisionApproval | null): string {
  if (!approval) return '';
  const date = brandKitPortraitDate(approval.approvedAt);
  if (!date) return '';
  const name = approval.approvedBy?.name?.trim();
  return name ? `Approved ${date} by ${name}` : `Approved ${date}`;
}

/**
 * What the kit was built from, as the contents page says it: the uploaded
 * logo files (never their names), the messaging framework and the colours
 * found in the artwork; without logo files, the framework and the colours
 * the run found.
 */
export function brandKitPortraitBuiltFrom(view: BrandKitBookView): string {
  const files = Object.values(view.logos).some((image) => image !== null);
  return files
    ? 'Built from the uploaded logo files, the messaging framework and the brand colors found in the logo artwork.'
    : 'Built from the messaging framework and the brand colors the run found.';
}

/**
 * The WCAG contrast of white on a colour, unrounded, for the symbol page's AA clause and the imagery call-out's caption:
 * a page compares it with 4.5 as it is and prints it through `brandKitPortraitRatioLabel`, so a 4.48 never reads as a pass.
 */
export function brandKitPortraitWhiteContrast(hex: string): number {
  return brandKitContrastRatio(brandKitLuminance(lfxColors.white), brandKitLuminance(hex));
}

// ---------- Color contrast (page 10) ----------

/** The grade of an unrounded contrast ratio, in the kit's own words (`brandKitContrastGradeOf`: the one grader for the matrix and the kit's pairs). */
export function brandKitPortraitContrastGrade(ratio: number): BrandKitContrastGrade {
  return brandKitContrastGradeOf(ratio);
}

/** A grade's pill: its words and the app's semantic inks. */
export function brandKitPortraitGradePill(grade: BrandKitContrastGrade): BrandKitPortraitContrastGrade {
  return { label: grade, ...BRAND_KIT_PORTRAIT_GRADE_INKS[grade] };
}

/** The WCAG contrast of two hex colours, unrounded: graded as it is, rounded only where it is printed. */
export function brandKitPortraitContrast(first: string, second: string): number {
  return brandKitContrastRatio(brandKitLuminance(first), brandKitLuminance(second));
}

/**
 * Every pairing of the palette, computed here from the hex values: the
 * matrix the contrast page draws, each cell graded on the unrounded ratio
 * and labelled to one decimal (as the kit's own table prints its ratios).
 */
export function brandKitPortraitContrastMatrix(view: BrandKitBookView): BrandKitPortraitContrastRow[] {
  const colors = view.color.palette;
  return colors.map((text) => ({
    name: text.name,
    hex: text.hex,
    cells: colors.map((ground) => brandKitPortraitContrastCell(text.hex, ground.hex)),
  }));
}

/** A ratio's label to one decimal, cut not rounded (`4.46` → `4.4`): the kit's one rounding, `brandKitRatioLabel`. */
export function brandKitPortraitRatioLabel(ratio: number): string {
  return brandKitRatioLabel(ratio);
}

/** One matrix cell; blank where a colour meets itself. */
function brandKitPortraitContrastCell(foreground: string, background: string): BrandKitPortraitContrastCell {
  const same = background.toLowerCase() === foreground.toLowerCase();
  const ratio = same ? null : brandKitPortraitContrast(foreground, background);
  return {
    foreground,
    background,
    ratio,
    label: ratio === null ? '' : brandKitPortraitRatioLabel(ratio),
    grade: ratio === null ? null : brandKitPortraitGradePill(brandKitPortraitContrastGrade(ratio)),
    tinted: background.toLowerCase() !== lfxColors.white.toLowerCase(),
  };
}

// ---------- Typography (page 11) ----------

/** A weight's name, `Medium 500`, or the number alone for one without a common name. */
export function brandKitPortraitWeightName(weight: number): string {
  const name = BRAND_KIT_PORTRAIT_WEIGHT_NAMES[weight];
  return name ? `${name} ${weight}` : String(weight);
}

/**
 * The line a type step is shown in, from the kit's own data (the mock takes
 * the framework's pillars and boilerplate, which the kit does not hold): the
 * project's name for the display step (the brand line would wrap at 64 px),
 * the umbrella message for the body, the footer line for the caption, the
 * brand line for every other step. Printed at the step's own size always;
 * when its measured line does not fit the column it is shortened word by
 * word (a body step to its lines, with an ellipsis), never shrunk
 * (`brandKitPortraitShortenLine`, `brandKitPortraitShortenParagraph`).
 */
export function brandKitPortraitTypeSample(view: BrandKitBookView, step: BrandKitTypeStep): string {
  switch (step.step) {
    case 'display':
      return view.projectName || view.voice.line;
    case 'body':
      return view.voice.umbrella || view.voice.line;
    case 'caption':
      return view.footer;
    default:
      return view.voice.line;
  }
}

/**
 * The contents page's layout for `rows` listed pages: one column with the
 * lower blocks at y 690, or moved down together (24 px under the list) while
 * they still end by y 990; past that the list goes to two columns, the type
 * never smaller (the design reader's rule).
 */
export function brandKitPortraitContentsLayout(rows: number): BrandKitPortraitContentsLayout {
  const c = BRAND_KIT_PORTRAIT_CONTENTS;
  const blocksTopFor = (perColumn: number) => Math.max(c.blocksTop, c.listTop + perColumn * c.rowHeight + c.gap);
  const oneColumn = blocksTopFor(rows);
  if (oneColumn + c.blocksHeight <= c.blocksBottom) return { columns: 1, blocksTop: oneColumn };
  return { columns: 2, blocksTop: blocksTopFor(Math.ceil(rows / 2)) };
}

/**
 * The Imagery page's umbrella-message card text: the umbrella message set
 * smaller until it fits the card's box, in the grammar's steps; when it cannot
 * (the fit model would have to cut it) the brand line is printed instead,
 * fitted the same way; a brand line the box cannot hold whole either is cut
 * at a word by the fit model (a kit's brand line is one short sentence, so
 * this is a guard, not an expected path).
 */
export function brandKitPortraitMessageCard(view: BrandKitBookView): { text: string; size: number } {
  const card = BRAND_KIT_PORTRAIT_MESSAGE_CARD;
  const fit = (text: string) => mktgPortraitFitBlock({ paras: [{ text, size: card.size, line: card.line, weight: card.weight }] }, card.width, card.height);
  const umbrella = fit(view.voice.umbrella);
  if (view.voice.umbrella && !umbrella.cut) return { text: view.voice.umbrella, size: umbrella.block.paras[0].size };
  const line = fit(view.voice.line);
  return { text: line.block.paras[0].text, size: line.block.paras[0].size };
}

/**
 * A one-line sample shortened to its measure: `text` when it fits `width` in
 * one line at `size` (measured in the kit's face, `para.family`), else its
 * first words, as many as fit with the ellipsis after them, cut at a word
 * (never on a function word) and marked with "…" so a shortened line never
 * reads as a bare cut (the editor's reading of the H2 samples); at least the
 * first word, which the measure may then clip. The size is never changed: the
 * editor's rule for the Typography page is "shorten the sample instead of
 * shrinking".
 */
export function brandKitPortraitShortenLine(
  text: string,
  width: number,
  size: number,
  para: Pick<MktgPortraitFitPara, 'weight' | 'caps' | 'family' | 'tracking'> = {}
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (mktgPortraitLineFits(words.join(' '), width, size, para)) return words.join(' ');
  // The longest prefix that fits with its ellipsis, found by bisection (a 30k-character line measures a dozen prefixes,
  // not thousands), then without the function word it would end on.
  const shortened = (count: number): string => `${mktgPortraitTrimTail(mktgPortraitTrimStopWords(words.slice(0, count)).join(' '))}…`;
  const count = mktgPortraitLargestFitting(words.length - 1, (prefix) => mktgPortraitLineFits(shortened(prefix), width, size, para));
  return shortened(count);
}

/**
 * A paragraph sample shortened to at most `maxLines` lines of `width` at
 * `size` (the paragraph model's wrap): the text when it fits, else its first
 * words, cut at a word (never on a function word), with an ellipsis after
 * the last (a sentence shown short reads as cut); at least the first word.
 */
export function brandKitPortraitShortenParagraph(
  text: string,
  width: number,
  size: number,
  para: Pick<MktgPortraitFitPara, 'weight' | 'caps'>,
  maxLines: number
): string {
  const perLine = mktgPortraitCharsPerLine(width, size, para);
  const whole = text.trim();
  if (mktgPortraitWrapLines(whole, perLine) <= maxLines) return whole;
  const words = whole.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const shortened = (count: number): string => `${mktgPortraitTrimTail(mktgPortraitTrimStopWords(words.slice(0, count)).join(' '))}…`;
  const count = mktgPortraitLargestFitting(words.length - 1, (prefix) => mktgPortraitWrapLines(shortened(prefix), perLine) <= maxLines);
  return shortened(count);
}

/** The lines `words` set in, wrapped greedily at `width` by the glyph measure (a word wider than the line stands alone). */
function measuredLines(
  words: readonly string[],
  width: number,
  size: number,
  para: Pick<MktgPortraitFitPara, 'weight' | 'caps' | 'family' | 'tracking'>
): number {
  let lines = 0;
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || mktgPortraitLineFits(candidate, width, size, para)) {
      line = candidate;
      continue;
    }
    lines += 1;
    line = word;
  }
  return line ? lines + 1 : lines;
}

/**
 * The back cover's brand line inside the frame's margins
 * (`BRAND_KIT_PORTRAIT_BACK_COVER_LINE`): as written when it sets in at most
 * two lines of the content width, measured glyph by glyph in the kit's face
 * with its tracking; else its first words, cut at a word (never on a function
 * word) with an ellipsis, at least the first. Never set smaller.
 */
export function brandKitPortraitBackCoverLine(text: string, family?: string): string {
  const c = BRAND_KIT_PORTRAIT_BACK_COVER_LINE;
  const para = { weight: c.weight, caps: true, tracking: c.tracking, family };
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const linesOf = (line: string): number => measuredLines(line.split(' '), c.width, c.size, para);
  if (linesOf(words.join(' ')) <= c.maxLines) return words.join(' ');
  const shortened = (count: number): string => `${mktgPortraitTrimTail(mktgPortraitTrimStopWords(words.slice(0, count)).join(' '))}…`;
  const count = mktgPortraitLargestFitting(words.length - 1, (prefix) => linesOf(shortened(prefix)) <= c.maxLines);
  return shortened(count);
}

/** The Watch-outs page's retyped sample: its text and the size it is set at. */
export interface BrandKitPortraitRetyped {
  text: string;
  /** Pixels: the design's 30, stepped down to the minimum before a word of the name is given up. */
  size: number;
}

/**
 * The Watch-outs page's retyped sample: the project's name as written, set at
 * the design's size or stepped down one pixel at a time to the minimum until
 * its longest word fits the tile's clear width and the whole name holds in
 * the four lines clear of the × badge (the mock prints the whole name); only
 * a name that still does not fit at the minimum is shortened at a word with
 * an ellipsis, at that size (the serif's own widths are near the default's).
 */
export function brandKitPortraitRetypedName(name: string): BrandKitPortraitRetyped {
  const c = BRAND_KIT_PORTRAIT_WATCHOUT_RETYPED;
  const para = { weight: c.weight, family: 'Georgia' };
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { text: '', size: c.size };
  const fitsLine = (word: string, size: number): boolean => mktgPortraitLineFits(word, c.width, size, para);
  const linesOf = (line: string, size: number): number => measuredLines(line.split(' '), c.width, size, para);
  const whole = words.join(' ');
  for (let size = c.size; size >= c.minSize; size -= 1) {
    if (words.every((word) => fitsLine(word, size)) && linesOf(whole, size) <= c.maxLines) return { text: whole, size };
  }
  // At the minimum the tile's three columns stay fixed: a word wider than the clear width would widen its column, so
  // the sample stops before the first such word (a first word too wide for the line is cut to the characters that fit).
  const size = c.minSize;
  const wholeWords = words.findIndex((word) => !fitsLine(word, size));
  const kept = wholeWords === -1 ? words : words.slice(0, wholeWords);
  if (kept.length === 0) {
    const first = Array.from(words[0]);
    const chars = mktgPortraitLargestFitting(first.length - 1, (count) => fitsLine(`${first.slice(0, count).join('')}…`, size));
    return { text: `${first.slice(0, Math.max(1, chars)).join('')}…`, size };
  }
  const shortened = (count: number): string => `${mktgPortraitTrimTail(mktgPortraitTrimStopWords(kept.slice(0, count)).join(' '))}…`;
  const count = mktgPortraitLargestFitting(kept.length, (prefix) => linesOf(shortened(prefix), size) <= c.maxLines);
  return { text: shortened(Math.max(1, count)), size };
}

/** The type source as the page names it: the host of a URL (`one.example.org`), or the text as written. */
export function brandKitPortraitTypeSource(source: string): string {
  const text = source.trim();
  const url = text.match(/https?:\/\/[^\s<>"')]+/i)?.[0];
  if (!url) return text;
  return brandKitWebsiteHost(url) || text.replace(/^https?:\/\//i, '');
}

/**
 * The scale's steps as printed: every step at the kit's own size and line
 * height, its sample the kit's line shortened to its measure (a one-line
 * step to one line, the body step to `bodyLines` lines of its column), never
 * set smaller.
 */
function typeSteps(view: BrandKitBookView, width: number, bodyLines: number): BrandKitPortraitTypeStep[] {
  return view.type.scale.map((step) => {
    const display = step.step === 'display';
    const body = step.step === 'body';
    const words = brandKitPortraitTypeSample(view, step);
    const room = display ? width : width - BRAND_KIT_PORTRAIT_SCALE_META_PX;
    const para = { weight: step.weight, caps: step.caps, family: view.type.family };
    const sample = body ? brandKitPortraitShortenParagraph(words, room, step.size, para, bodyLines) : brandKitPortraitShortenLine(words, room, step.size, para);
    return { ...step, sample, spec: `${step.weight} · ${step.size}/${step.line_height}`, display, shortened: sample !== words };
  });
}

/**
 * The y the scale ends at: its label, then each row at the height its sample's lines take — one line when the measured
 * line fits (the one-line steps, set to fit), else the paragraph model's wrap (the body step).
 */
function typeScaleEnd(steps: readonly BrandKitPortraitTypeStep[], width: number, family: string): number {
  const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
  return steps.reduce(
    (y, step) => {
      const room = step.display ? width : width - BRAND_KIT_PORTRAIT_SCALE_META_PX;
      const para = { weight: step.weight, caps: step.caps, family };
      const lines = mktgPortraitLineFits(step.sample, room, step.size, para)
        ? 1
        : mktgPortraitWrapLines(step.sample, mktgPortraitCharsPerLine(room, step.size, para));
      const sample = lines * step.line_height;
      if (step.display) return y + c.rule + c.rowPadding + c.metaLine + c.displaySampleAbove + sample + c.displayBottom;
      return y + c.rule + 2 * c.rowPadding + Math.max(c.metaLine, sample);
    },
    c.scaleTop + c.labelHeight + c.scaleAbove
  );
}

/** The "Where to get the font" block's lines: the family, where it comes from and its weights; the fallback; the source, muted. */
function typeSourceLines(view: BrandKitBookView): BrandKitPortraitTypeSourceLine[] {
  const type = view.type;
  const lines: BrandKitPortraitTypeSourceLine[] = [
    { text: `${type.family} · ${type.google_fonts ? 'Google Fonts' : 'supplied files'} · weights ${type.weights.join(', ')}`, muted: false },
    { text: `Fallback: ${type.fallback || 'none'}`, muted: false },
  ];
  const source = brandKitPortraitTypeSource(type.source);
  if (source) lines.push({ text: `Named on ${source}`, muted: true });
  return lines;
}

/** The taller of the two lower blocks, each its label over its lines (the rules as fitted, at their scale), as the fit model measures them. */
function typeLowerHeight(rules: BrandKitPortraitRulesFit, sourceLines: readonly BrandKitPortraitTypeSourceLine[]): number {
  const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
  const label = { text: 'Where to get the font', ...BRAND_KIT_PORTRAIT_SOURCES.label };
  const source = mktgPortraitBlockHeight(
    { paras: [label, ...sourceLines.map((line, index) => ({ text: line.text, size: c.text.size, line: c.text.line, above: index === 0 ? c.text.above : 0 }))] },
    c.lowerWidth
  );
  const list = mktgPortraitBlockHeight(
    mktgPortraitScaleBlock(
      {
        paras: [
          label,
          ...rules.rules.map((rule, index) => ({ text: rule, size: c.list.size, line: c.list.line, above: index === 0 ? c.list.above : 0 })),
          ...(rules.more > 0 ? [{ text: rules.moreLine, ...BRAND_KIT_PORTRAIT_RULE_LISTS.more }] : []),
        ],
      },
      rules.scale
    ),
    c.lowerWidth - c.list.indent
  );
  return Math.max(source, list);
}

/**
 * The Typography page sized from its data. Every step prints at the kit's
 * size; the scale's rows take the height their samples need (the body step,
 * the umbrella message shortened to three lines of its column, wraps), so
 * the two blocks under it follow where it really ends: the page lays them in
 * flow, 16 px under the scale and never above the mock's y 830, and this
 * model predicts that y (`lowerTop`) to decide how many lines the body
 * sample may take: three, and fewer only when the stack would run past
 * y 990 — shortened, never set smaller. A line the model misjudges by a few
 * px moves the blocks down in flow; it is never drawn on.
 */
export function brandKitPortraitTypeLayout(view: BrandKitBookView, width: number): BrandKitPortraitTypeLayout {
  const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
  const sourceLines = typeSourceLines(view);
  const rules = brandKitPortraitRulesFit(view.type.rules, BRAND_KIT_PORTRAIT_RULE_LISTS.typeRules);
  const lowerHeight = typeLowerHeight(rules, sourceLines);
  const layout = (bodyLines: number): BrandKitPortraitTypeLayout => {
    const steps = typeSteps(view, width, bodyLines);
    const scaleEnd = typeScaleEnd(steps, width, view.type.family);
    const lowerTop = Math.max(c.lowerTop, Math.ceil(scaleEnd) + c.lowerGap);
    return { steps, scaleEnd, lowerTop, sourceLines, bodyLines, rules };
  };
  const fits = (candidate: BrandKitPortraitTypeLayout): boolean => candidate.lowerTop + lowerHeight <= c.bottom + 0.01;
  let candidate = layout(c.bodyMaxLines);
  for (let lines = c.bodyMaxLines - 1; !fits(candidate) && lines >= 1; lines--) candidate = layout(lines);
  return candidate;
}

// ---------- The accent moment (pages 12 and 14) ----------

/**
 * The book's one accent moment, resolved once for the imagery call-out and
 * the social card: white or the palette colour with the highest contrast on
 * the accent where one reaches AA (white preferred among equals), set on the
 * accent fill; when none does, no text goes on the accent at all: the card
 * keeps a white ground under an accent top rule, in the kit's dark. The
 * reason quotes the same unrounded ratios the contrast matrix grades, through
 * the one label helper, so the caption and the matrix never disagree (a
 * caption once claimed Charcoal on Orange where the matrix read 2.9:1 Fails).
 */
export function brandKitPortraitAccentMoment(
  view: Pick<BrandKitBookView, 'accent' | 'accentName' | 'dark' | 'darkName' | 'palette'>
): BrandKitPortraitAccentMoment {
  const white = lfxColors.white;
  const isWhite = (hex: string): boolean => hex.toLowerCase() === white.toLowerCase();
  const candidates = [
    { name: 'White', hex: white },
    ...view.palette
      .filter((entry) => !isWhite(entry.hex) && entry.hex.toLowerCase() !== view.accent.toLowerCase())
      .map((entry) => ({ name: entry.name, hex: entry.hex })),
  ];
  const best = brandKitBestInkOn(view.accent, candidates);
  if (best.readable) {
    const ratioLabel = brandKitRatioLabel(best.ratio);
    return {
      ground: 'accent',
      background: view.accent,
      ink: isWhite(best.hex) ? 'white' : best.hex,
      inkName: best.name,
      ratioLabel,
      reason: `text in ${best.name} (${ratioLabel}:1 on ${view.accentName})`,
    };
  }
  const darkOnWhite = brandKitBestInkOn(white, [{ name: view.darkName, hex: view.dark }]);
  return {
    ground: 'white',
    background: white,
    ink: view.dark,
    inkName: view.darkName,
    ratioLabel: brandKitRatioLabel(darkOnWhite.ratio),
    reason: `no palette color reaches AA on ${view.accentName} (${best.name} ${brandKitRatioLabel(best.ratio)}:1 at best), so the card keeps a white ground under an accent rule`,
  };
}

// ---------- Example usage (page 14) ----------

/** The year of the recorded approval, `2026`, or '' without one the store can parse. */
function brandKitPortraitApprovalYear(approval: MktgRevisionApproval | null): string {
  if (!approval?.approvedAt) return '';
  const year = new Date(approval.approvedAt).getUTCFullYear();
  return Number.isNaN(year) ? '' : String(year);
}

/**
 * The usage page's four cards from the kit's examples, each with the line it
 * shows, the kit's own copy: the brand line on the keynote slide and the
 * social card, `<Project> annual report <year>` on the report cover (the
 * year of the recorded approval, left out without one), and the membership
 * headline `New members join <Project>` on the announcement header, the kit
 * holding no headline of its own. The project's name stays on one line
 * (`mktgKeepName`) and a headline keeps its last two words together
 * (`mktgNoWidow`): the brand line on the social card ended on "AI." alone,
 * and a header broke "Agentic / AI Foundation". The social card's ground is the accent moment's decision
 * (`brandKitPortraitAccentMoment`), not the record's word for it, so the
 * table reads what the card draws.
 */
export function brandKitPortraitUsageCards(view: BrandKitBookView, approval: MktgRevisionApproval | null = null): BrandKitPortraitUsageCard[] {
  const u = BRAND_KIT_PORTRAIT_USAGE_LINES;
  const shorten = (card: { size: number; weight: number; maxLines: number }) =>
    brandKitPortraitShortenParagraph(view.voice.line, u.width, card.size, { weight: card.weight }, card.maxLines);
  // The project's name stays on one line in every card ("Agentic AI Foundation" once broke after "Agentic") when it
  // fits one line of that card at its size (a longer name wraps as plain words), and a headline keeps its last two
  // words together.
  const keepName = (text: string, card: { size: number; weight: number }): string =>
    mktgKeepName(text, view.projectName, { width: u.width, size: card.size, weight: card.weight, family: view.type.family });
  const lines: Record<BrandKitUsageView['layout'], string> = {
    keynote: mktgNoWidow(keepName(shorten(u.keynote), u.keynote)),
    social: mktgNoWidow(keepName(shorten(u.social), u.social)),
    report: keepName([view.projectName, 'annual report', brandKitPortraitApprovalYear(approval)].filter((part) => part !== '').join(' '), u.report),
    announcement: mktgNoWidow(keepName(`New members join ${view.projectName}`, u.announcement)),
  };
  const moment = brandKitPortraitAccentMoment(view);
  return view.usageTiles.map((tile, index) => {
    const example = view.usage.examples[index];
    return {
      layout: tile.layout,
      text: lines[tile.layout],
      name: example?.name ?? '',
      format: example?.format ?? '',
      ground: tile.layout === 'social' ? moment.ground : (example?.ground ?? ''),
      // A social card that keeps a white ground carries the accent as its top rule, as the announcement does.
      accentMoment:
        tile.layout === 'social' && moment.ground === 'white'
          ? BRAND_KIT_PORTRAIT_USAGE_ACCENT_MOMENTS.announcement
          : BRAND_KIT_PORTRAIT_USAGE_ACCENT_MOMENTS[tile.layout],
    };
  });
}

// ---------- The chapters' intros ----------

/**
 * A chapter page's intro paragraph at most `BRAND_KIT_PORTRAIT_INTRO.maxLines`
 * lines of its 600 px: the text when it fits; else its first whole sentences
 * that do; else its first sentence shortened at a word with an ellipsis.
 */
export function brandKitPortraitIntro(text: string): string {
  const c = BRAND_KIT_PORTRAIT_INTRO;
  const perLine = mktgPortraitCharsPerLine(c.width, c.size);
  const whole = text.trim();
  if (mktgPortraitWrapLines(whole, perLine) <= c.maxLines) return whole;
  const sentences = mktgPortraitSentences(whole);
  for (let count = sentences.length - 1; count >= 1; count--) {
    const shorter = sentences.slice(0, count).join(' ');
    if (mktgPortraitWrapLines(shorter, perLine) <= c.maxLines) return shorter;
  }
  return brandKitPortraitShortenParagraph(whole, c.width, c.size, {}, c.maxLines);
}

// ---------- Voice (page 15): the messages ----------

/**
 * The Voice page's umbrella message and brand line fitted to the block above
 * the attributes: as written when they fit, set smaller together when they
 * do not, cut at a sentence when no step holds them; nothing runs under the
 * attributes' rule.
 */
export function brandKitPortraitVoiceMessagesFit(view: Pick<BrandKitBookView, 'voice'>): BrandKitPortraitVoiceMessagesFit {
  const c = BRAND_KIT_PORTRAIT_VOICE_MESSAGES;
  const umbrella = view.voice.umbrella.trim();
  const line = view.voice.line.trim();
  const paras: MktgPortraitFitPara[] = [
    ...(umbrella
      ? [
          { text: 'Umbrella message', ...c.label },
          { text: umbrella, ...c.umbrella },
        ]
      : []),
    ...(line
      ? [
          { text: 'Brand line', ...c.label, above: umbrella ? c.lineLabelAbove : 0 },
          { text: line, ...c.line },
        ]
      : []),
  ];
  if (paras.length === 0) return { scale: 1, cut: false, umbrella, line };
  const fit = mktgPortraitFitBlock({ paras }, c.width, c.bottom - c.top);
  // The fitted texts in the paragraphs' order: the umbrella first when the kit has one, then the brand line.
  const texts = fit.block.paras.filter((_, index) => index % 2 === 1).map((para) => para.text);
  const lineIndex = umbrella ? 1 : 0;
  return { scale: fit.scale, cut: fit.cut, umbrella: umbrella ? texts[0] : '', line: line ? (texts[lineIndex] ?? '') : '' };
}

// ---------- The chapters' rule lists ----------

/**
 * One of the chapters' rule lists fitted to its room, the way the Sources
 * columns are: as written when its columns hold it, set smaller together in
 * the grammar's steps when they do not, its longest lines cut at a sentence
 * when no step holds it, and when even that runs past the room, its last
 * rules given up to a `+N more rules, in LFX One` line (the room's noun,
 * singular at one), one at a time, the first rule always kept. Items fill the columns in turn (a two-column grid's
 * order); the room is the taller column's.
 */
export function brandKitPortraitRulesFit(rules: readonly string[], room: BrandKitPortraitRuleListRoom): BrandKitPortraitRulesFit {
  const c = BRAND_KIT_PORTRAIT_RULE_LISTS;
  const height = room.bottom - room.top - mktgPortraitParaHeight({ text: 'Rules', ...c.label }, room.width);
  const kept = [...rules];
  let more = 0;
  // The columns as the grid fills them (items in turn), the `+N more` line under the last item's column.
  const columns = (): MktgPortraitFitBlock[] =>
    Array.from({ length: room.columns }, (_, column) => ({
      paras: [
        ...kept
          .filter((_, index) => index % room.columns === column)
          .map((text, index) => ({ text, size: room.size, line: room.line, above: index === 0 ? room.listAbove : room.above })),
        ...(more > 0 && column === (kept.length - 1) % room.columns ? [{ text: mktgPortraitMoreLine(more, room.noun), ...c.more }] : []),
      ],
    }));
  const fitsAt = (scale: number): boolean => columns().every((block) => mktgPortraitFits(mktgPortraitScaleBlock(block, scale), room.width, height));
  // 1. Set smaller, in the grammar's steps, down to its smallest size.
  for (let step = 0; ; step += 1) {
    const scale = Math.round((1 - step * MKTG_PORTRAIT_FIT.scaleStep) * 100) / 100;
    if (scale < MKTG_PORTRAIT_FIT.minScale - 1e-9) break;
    if (fitsAt(scale)) return { scale, cut: false, rules: kept, more: 0, moreLine: '' };
  }
  const scale = MKTG_PORTRAIT_FIT.minScale;
  // 2. Cut the longest rule at a sentence (a rule of one sentence is left whole), until the columns hold the list.
  let cut = false;
  for (let guard = 0; guard < MKTG_PORTRAIT_FIT.maxCuts && !fitsAt(scale); guard++) {
    let longest = -1;
    kept.forEach((text, index) => {
      if (mktgPortraitSentences(text).length < 2) return;
      if (longest === -1 || text.length > kept[longest].length) longest = index;
    });
    if (longest === -1) break;
    const sentences = mktgPortraitSentences(kept[longest]);
    kept[longest] = sentences.slice(0, -1).join(' ');
    cut = true;
  }
  // 3. Give up the last rules to the `+N more` line, the first always kept.
  while (kept.length > 1 && !fitsAt(scale)) {
    kept.pop();
    more += 1;
  }
  // 4. One rule alone that still runs past the room is cut at a word, with an ellipsis.
  for (let guard = 0; guard < MKTG_PORTRAIT_FIT.maxCuts && !fitsAt(scale); guard++) {
    const text = mktgPortraitCutText(kept[0], Math.floor(kept[0].length * MKTG_PORTRAIT_FIT.cutShare));
    if (text === kept[0] || text.length >= kept[0].length) break;
    kept[0] = text;
    cut = true;
  }
  return { scale, cut, rules: kept, more, moreLine: mktgPortraitMoreLine(more, room.noun) };
}

// ---------- Color contrast (page 10): the layout ----------

/**
 * The contrast page's layout: the matrix as tall as its header and a row per
 * colour, the pairs at the mock's y 610 while the matrix ends above it and
 * in flow under it otherwise (a five-colour palette), and as many pairs as
 * the room to y 990 holds, the rest counted in a `+N more pairs` line.
 */
export function brandKitPortraitContrastLayout(colors: number, pairs: number): BrandKitPortraitContrastLayout {
  const c = BRAND_KIT_PORTRAIT_CONTRAST;
  const matrixHeight = c.header + colors * c.row;
  const matrixMinHeight = c.pairsTop - c.matrixTop - c.pairsGap;
  const pairsTop = c.matrixTop + Math.max(matrixMinHeight, matrixHeight) + c.pairsGap;
  const room = c.bottom - pairsTop - c.pairsLabel;
  if (pairs * c.pair <= room) return { matrixHeight, matrixMinHeight, pairsTop, pairsKept: pairs, more: 0, moreLine: '' };
  const pairsKept = Math.min(pairs, Math.max(1, Math.floor((room - c.more) / c.pair)));
  const more = pairs - pairsKept;
  return { matrixHeight, matrixMinHeight, pairsTop, pairsKept, more, moreLine: mktgPortraitMoreLine(more, MKTG_PORTRAIT_MORE_LINE.nouns.pair) };
}

// ---------- Watchouts (page 08) ----------

/**
 * A watchout tile as the print draws it, keyed by the tile's kind (never by
 * the screen's CSS, which may change under it): the shadow in px, the
 * recolor as the portrait filter (which turns a black mark too), the busy
 * ground as the mock's gradient (the accent, through the palette's fourth
 * colour, the spark without one, at 60 %, into the dark, at 120°), the rest
 * as the screen draws it; a tile with no ground of its own sits on `white`.
 */
export function brandKitPortraitWatchoutDraw(tile: BrandKitWatchoutView, view: BrandKitBookView, white: string): BrandKitWatchoutView {
  const through = view.palette[3]?.hex ?? view.spark;
  const draws: Partial<Record<BrandKitWatchoutKind, Partial<BrandKitWatchoutView>>> = {
    shadowed: { filter: 'drop-shadow(4px 5px 3px rgba(0, 0, 0, 0.45))' },
    recolored: { filter: BRAND_KIT_PORTRAIT_RECOLOR_FILTER },
    busy: { ground: `linear-gradient(120deg, ${view.accent}, ${through} 60%, ${view.dark})` },
  };
  const drawn = { ...tile, ...draws[tile.kind] };
  return { ...drawn, ground: drawn.ground || white };
}

// ---------- Voice (page 15) ----------

/**
 * The attributes fitted to the grid's room under the messages, measured cell
 * by cell: each row is as tall as its taller cell (the rule, the padding,
 * the name's lines, the line's lines), and the grid is set smaller in the
 * grammar's steps when more attributes, or longer lines, than the room holds
 * would run under the footer. At the smallest step every line is cut at a
 * sentence to `lineMaxLines` (names print whole), and the rows that still
 * do not fit are left to the Voice tab in LFX One, which the `more` line
 * says: nothing is dropped in silence, and the stack never ends past the
 * room (`height` ≤ bottom − top).
 */
export function brandKitPortraitAttributesFit(attributes: readonly { name: string; line: string }[]): BrandKitPortraitAttributesFit {
  const c = BRAND_KIT_PORTRAIT_ATTRIBUTES;
  const room = c.bottom - c.top;
  const cells = attributes.map((attribute) => ({ ...attribute }));
  for (let step = 0; ; step += 1) {
    const scale = Math.round((1 - step * MKTG_PORTRAIT_FIT.scaleStep) * 100) / 100;
    if (scale < MKTG_PORTRAIT_FIT.minScale - 1e-9) break;
    const height = attributesHeight(cells, scale);
    if (height <= room) return { scale, cut: false, attributes: cells, more: 0, height };
  }
  const scale = MKTG_PORTRAIT_FIT.minScale;
  const perLine = mktgPortraitCharsPerLine(c.columnWidth, c.line.size * scale);
  const cut = cells.map((cell) => ({ ...cell, line: mktgPortraitCutText(cell.line, perLine * c.lineMaxLines) }));
  const changed = cut.some((cell, index) => cell.line !== cells[index].line);
  let kept = cut.length;
  let height = attributesHeight(cut, scale);
  // The cut grid that fits keeps every attribute: the `+N more` line is charged only once a row has to go.
  if (height <= room) return { scale, cut: changed, attributes: cut, more: 0, height };
  while (kept > c.columns && height + moreHeight(scale) > room) {
    kept -= c.columns;
    height = attributesHeight(cut.slice(0, kept), scale);
  }
  const more = cut.length - kept;
  return { scale, cut: changed, attributes: cut.slice(0, kept), more, height: more > 0 ? height + moreHeight(scale) : height };
}

/** The height of the attributes grid at a scale: rows of `columns` cells, each row as tall as its taller cell. */
function attributesHeight(cells: readonly { name: string; line: string }[], scale: number): number {
  const c = BRAND_KIT_PORTRAIT_ATTRIBUTES;
  const cellHeight = (cell: { name: string; line: string }) =>
    c.rule +
    c.padding * scale +
    mktgPortraitParaHeight({ text: cell.name, size: c.name.size * scale, line: c.name.line, weight: c.name.weight }, c.columnWidth) +
    mktgPortraitParaHeight({ text: cell.line, size: c.line.size * scale, line: c.line.line, above: c.lineAbove * scale }, c.columnWidth);
  let height = 0;
  for (let index = 0; index < cells.length; index += c.columns) {
    const row = cells.slice(index, index + c.columns);
    height += (index === 0 ? 0 : c.rowGap * scale) + Math.max(...row.map(cellHeight));
  }
  return height;
}

/** The `+N more` line's height under the grid at a scale. */
function moreHeight(scale: number): number {
  const c = BRAND_KIT_PORTRAIT_ATTRIBUTES;
  return c.more.above * scale + c.more.size * scale * c.more.line;
}

// ---------- Sources & decisions (page 16) ----------

/** A whole source of the record in words (`mktgReadableSourceName`): the shared rule, one or many uploaded files named alike. */
export function brandKitPortraitReadableSource(source: string, count: 'one' | 'many' = 'many'): string {
  return mktgReadableSourceName(source, count);
}

/** The Sources page's lists from the revision's report: only what the record holds, each source made readable, duplicates folded. */
export function brandKitPortraitSources(view: BrandKitBookView): BrandKitPortraitSources {
  const report = view.report;
  const findings = report.findings;
  // Every sentence of the record prints with its URLs and file names in a reader's words (the editor's rule).
  const words = (text: string) => mktgReadableSourceText(text.trim());
  const failed = (findings?.sources_failed ?? report.sources_failed.map((entry) => ({ source: entry.name, reason: entry.reason }))).map((entry) => ({
    source: brandKitPortraitReadableSource(entry.source, 'one'),
    reason: words(entry.reason),
  }));
  const missing = (findings?.missing_assets ?? []).map((entry) => ({
    asset: BRAND_KIT_REPORT_ASSET_LABELS[entry.asset],
    reason: words(entry.reason),
    fix: words(entry.fix ?? ''),
  }));
  const fixes = new Set(missing.map((entry) => entry.fix.replace(/^Upload the \w+ file/, '')));
  const sharedFix = missing.length > 1 && fixes.size === 1 && missing[0].fix ? missing[0].fix.replace(/^Upload the \w+ file/, 'Upload each file') : '';
  return {
    read: [...new Set(report.sources_read.map((source) => brandKitPortraitReadableSource(source)))],
    failed,
    warnings: (findings?.warnings ?? [])
      .filter((warning) => warning.code !== 'color_conflict' && warning.text.trim() !== '')
      .map((warning) => ({ text: words(warning.text), source: warning.source ? brandKitPortraitReadableSource(warning.source, 'one') : '' })),
    missing: sharedFix ? missing.map((entry) => ({ ...entry, fix: '' })) : missing,
    sharedFix,
    gaps: report.gaps.map(words).filter((gap) => gap !== ''),
    notes: words(report.notes),
    conflicts: (report.color_conflicts ?? [])
      .filter((conflict) => conflict.values.length > 1)
      .map((conflict) => ({
        ...conflict,
        values: conflict.values.map((value) => {
          const kept = value.hex.toUpperCase() === conflict.chosen.toUpperCase();
          return {
            hex: value.hex,
            kept,
            label: kept ? `${value.hex.toUpperCase()} · kept` : value.hex.toUpperCase(),
            source: brandKitPortraitReadableSource(value.source),
          };
        }),
      })),
  };
}

/**
 * One measured line of a Sources column: its paragraph for the fit model
 * and, when part of it is prose the fit may cut at a sentence (a reason, a
 * warning, a gap, a note), that prose and where a shorter one goes back. A
 * source name or a colour value has no prose and is never cut.
 */
interface SourcesLine {
  para: MktgPortraitFitPara;
  prose?: { text: string; write: (text: string) => void };
}

/** One item of a Sources block: what it prints and, when it has any, the prose the fit may cut. */
interface SourcesItem {
  text: string;
  prose?: SourcesLine['prose'];
  /** How the page sets this item when not as a plain list line: a conflict's name head, or a value row in its cell. */
  para?: Partial<Omit<MktgPortraitFitPara, 'text'>>;
}

/**
 * A column's lines as the fit model measures them: each block a label (10 px
 * caps, 26 px under the block before) over its items (12.5/1.6, the first
 * 8 px under the label), then the block's `+N more` line when it has one.
 */
function sourcesColumn(blocks: { label: string; items: SourcesItem[]; more?: string }[]): SourcesLine[] {
  const c = BRAND_KIT_PORTRAIT_SOURCES;
  const lines: SourcesLine[] = [];
  blocks
    .filter((block) => block.items.length > 0 || block.more)
    .forEach((block, blockIndex) => {
      lines.push({ para: { text: block.label, ...c.label, above: blockIndex === 0 ? 0 : c.blockGap } });
      block.items.forEach((item, index) =>
        lines.push({ para: { text: item.text, ...c.item, above: index === 0 ? c.listAbove : 0, ...item.para }, prose: item.prose })
      );
      if (block.more) lines.push({ para: { text: block.more, ...c.item, above: block.items.length === 0 ? c.listAbove : 0 } });
    });
  return lines;
}

/**
 * The Sources page's lists fitted to their two columns: measured with the
 * fit model against the room above the accepted box (or the footer, without
 * one), set smaller in the grammar's steps when they would overrun, both
 * columns at the one smaller size. A column no step holds gives up its last
 * items, one at a time and list by list (the left its sources read down to
 * one, then its gaps; the right its conflicts down to one), to a `+N more`
 * line the page prints in their place. Only when nothing is left to give up
 * is prose cut, at a sentence, the longest first (a reason, a warning, a
 * gap, a note: never a source name or a colour value), which the result
 * says. Nothing past the footer, nothing dropped in silence.
 */
export function brandKitPortraitSourcesFit(sources: BrandKitPortraitSources, approved: boolean): BrandKitPortraitSourcesFit {
  const c = BRAND_KIT_PORTRAIT_SOURCES;
  const nouns = MKTG_PORTRAIT_MORE_LINE.nouns;
  const k = c.conflict;
  const height = (approved ? c.acceptedTop - c.gap : c.bottom) - c.top;
  const width = c.width - c.indent;
  /** The px a conflict value's label cell takes (`#654321 · kept`), by the fit model's own character width. */
  const labelWidth = (label: string): number => (label.length * width) / mktgPortraitCharsPerLine(width, c.item.size, { weight: 600 });
  const fitted: BrandKitPortraitSources = {
    ...sources,
    read: [...sources.read],
    failed: sources.failed.map((entry) => ({ ...entry })),
    warnings: sources.warnings.map((entry) => ({ ...entry })),
    missing: sources.missing.map((entry) => ({ ...entry })),
    gaps: [...sources.gaps],
    conflicts: sources.conflicts.map((conflict) => ({ ...conflict, values: conflict.values.map((value) => ({ ...value })) })),
  };
  const more = { read: 0, gaps: 0, conflicts: 0 };
  const leftLines = (): SourcesLine[] =>
    sourcesColumn([
      { label: 'Read', items: fitted.read.map((text) => ({ text })), more: mktgPortraitMoreLine(more.read, nouns.sourceRead) },
      {
        label: 'Could not be read',
        items: fitted.failed.map((entry) => ({
          text: entry.reason ? `${entry.source} — ${entry.reason}` : entry.source,
          prose: entry.reason ? { text: entry.reason, write: (next) => (entry.reason = next) } : undefined,
        })),
      },
      {
        label: 'Warnings',
        items: [
          ...fitted.warnings.map((entry) => ({
            text: entry.source ? `${entry.text} (${entry.source})` : entry.text,
            prose: { text: entry.text, write: (next: string) => (entry.text = next) },
          })),
          ...fitted.gaps.map((text, index) => ({ text, prose: { text, write: (next: string) => (fitted.gaps[index] = next) } })),
          ...(fitted.notes ? [{ text: fitted.notes, prose: { text: fitted.notes, write: (next: string) => (fitted.notes = next) } }] : []),
        ],
        more: mktgPortraitMoreLine(more.gaps, nouns.gap),
      },
    ]);
  const rightLines = (): SourcesLine[] =>
    sourcesColumn([
      {
        label: 'Missing',
        items: [
          ...fitted.missing.map((entry) => ({
            text: [`${entry.asset} — ${entry.reason}`, entry.fix ? `Fix: ${entry.fix}` : ''].filter((part) => part !== '').join(' '),
            prose: { text: entry.reason, write: (next: string) => (entry.reason = next) },
          })),
          ...(fitted.sharedFix
            ? [
                {
                  text: `Fix, for all ${fitted.missing.length}: ${fitted.sharedFix}`,
                  prose: { text: fitted.sharedFix, write: (next: string) => (fitted.sharedFix = next) },
                },
              ]
            : []),
        ],
      },
      {
        label: 'Color conflicts',
        items: fitted.conflicts.flatMap((conflict) => [
          { text: conflict.name, para: { ...k.name, above: k.above } },
          // A value row: the source wraps in its own cell, beside the swatch and the label, over the row's padding and rule.
          ...conflict.values.map((value, index) => ({
            text: value.source,
            para: { above: k.rowPad + (index === 0 ? k.headBelow : 0), indent: k.swatch + k.cellGap + labelWidth(value.label) + k.cellGap },
          })),
        ]),
        more: mktgPortraitMoreLine(more.conflicts, nouns.colorConflict),
      },
    ]);
  const columns = [leftLines, rightLines];
  const fitsAt = (scale: number): boolean =>
    columns.every((lines) => mktgPortraitFits(mktgPortraitScaleBlock({ paras: lines().map((line) => line.para) }, scale), width, height));
  const result = (scale: number, cut: boolean): BrandKitPortraitSourcesFit => ({
    scale,
    cut,
    sources: fitted,
    moreRead: more.read,
    moreGaps: more.gaps,
    moreConflicts: more.conflicts,
    moreReadLine: mktgPortraitMoreLine(more.read, nouns.sourceRead),
    moreGapsLine: mktgPortraitMoreLine(more.gaps, nouns.gap),
    moreConflictsLine: mktgPortraitMoreLine(more.conflicts, nouns.colorConflict),
  });
  // 1. Set smaller, in the grammar's steps, both columns at the one size, down to its smallest.
  for (let step = 0; ; step += 1) {
    const scale = Math.round((1 - step * MKTG_PORTRAIT_FIT.scaleStep) * 100) / 100;
    if (scale < MKTG_PORTRAIT_FIT.minScale - 1e-9) break;
    if (fitsAt(scale)) return result(scale, false);
  }
  const scale = MKTG_PORTRAIT_FIT.minScale;
  // 2. Give up a column's last items, list by list, to its `+N more` line, until the column fits or nothing is left to give.
  const overflow = (lines: () => SourcesLine[], lists: { canDrop: () => boolean; drop: () => void }[]): void => {
    const fits = (): boolean => mktgPortraitFits(mktgPortraitScaleBlock({ paras: lines().map((line) => line.para) }, scale), width, height);
    for (const list of lists) {
      while (!fits() && list.canDrop()) list.drop();
    }
  };
  overflow(leftLines, [
    {
      canDrop: () => fitted.read.length > 1,
      drop: () => {
        fitted.read.pop();
        more.read += 1;
      },
    },
    {
      canDrop: () => fitted.gaps.length > 0,
      drop: () => {
        fitted.gaps.pop();
        more.gaps += 1;
      },
    },
  ]);
  overflow(rightLines, [
    {
      canDrop: () => fitted.conflicts.length > 1,
      drop: () => {
        fitted.conflicts.pop();
        more.conflicts += 1;
      },
    },
  ]);
  // 3. Cut the longest prose of more than one sentence at a sentence, in the column that still overruns, until it fits.
  let cut = false;
  for (let guard = 0; guard < MKTG_PORTRAIT_FIT.maxCuts && !fitsAt(scale); guard++) {
    const overrun = columns.filter((lines) => !mktgPortraitFits(mktgPortraitScaleBlock({ paras: lines().map((line) => line.para) }, scale), width, height));
    const prose = overrun
      .flatMap((lines) => lines())
      .map((line) => line.prose)
      .filter((entry): entry is NonNullable<SourcesLine['prose']> => !!entry && mktgPortraitSentences(entry.text).length > 1)
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (!prose) break;
    prose.write(mktgPortraitSentences(prose.text).slice(0, -1).join(' '));
    cut = true;
  }
  return result(scale, cut);
}
