// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's portrait pages, pure over the kit's book view: the
// artwork a page draws, the logo files table, the palette's sources, the
// approval line and the few derived strings. A fact the view does not hold
// is left out (null, '' or no row), never written here.

import {
  BRAND_KIT_PORTRAIT_ATTRIBUTES,
  BRAND_KIT_PORTRAIT_CONTENTS,
  BRAND_KIT_PORTRAIT_FIT_MIN_PX,
  BRAND_KIT_PORTRAIT_GRADE_INKS,
  BRAND_KIT_PORTRAIT_MESSAGE_CARD,
  BRAND_KIT_PORTRAIT_MONO_FILTER,
  BRAND_KIT_PORTRAIT_MONTHS,
  BRAND_KIT_PORTRAIT_SCALE_META_PX,
  BRAND_KIT_PORTRAIT_SOURCES,
  BRAND_KIT_PORTRAIT_TYPE_PAGE,
  BRAND_KIT_PORTRAIT_USAGE_ACCENT_MOMENTS,
  BRAND_KIT_PORTRAIT_WEIGHT_NAMES,
} from '../constants/brand-kit-portrait.constants';
import { lfxColors } from '../constants/colors.constants';
import { BRAND_KIT_FOUND_IN_LABELS, BRAND_KIT_REPORT_ASSET_LABELS } from '../constants/brand-kit.constants';
import { MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import type {
  BrandKitBookView,
  BrandKitContrastGrade,
  BrandKitLogoImage,
  BrandKitPaletteEntry,
  BrandKitTypeStep,
  BrandKitUsageView,
} from '../interfaces/brand-kit.interface';
import type {
  BrandKitPortraitArtworkMode,
  BrandKitPortraitAttributesFit,
  BrandKitPortraitContentsLayout,
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
import type { MktgPortraitFitPara } from '../interfaces/mktg-portrait-print.interface';
import { MKTG_PORTRAIT_FIT } from '../constants/mktg-portrait-print.constants';
import { brandKitContrastRatio, brandKitLuminance } from './brand-kit-book.utils';
import {
  mktgPortraitBlockHeight,
  mktgPortraitCharsPerLine,
  mktgPortraitCutText,
  mktgPortraitFitBlock,
  mktgPortraitLineFits,
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
 * the stacked lockup is only ever its own file.
 */
export function brandKitPortraitArtwork(
  view: BrandKitBookView,
  kind: 'lockup' | 'symbol' | 'stacked',
  mode: BrandKitPortraitArtworkMode = 'full'
): MktgPrintLogo | null {
  const alt = { lockup: 'Horizontal lockup', symbol: 'Symbol', stacked: 'Stacked lockup' }[kind];
  const filter = ARTWORK_FILTERS[mode];
  if (kind === 'lockup' && mode === 'reversed' && view.logos.reversed?.src) return { src: view.logos.reversed.src, alt: 'Reversed lockup', filter: '' };
  const images: Record<typeof kind, BrandKitLogoImage | null> = { lockup: view.logos.primary, symbol: view.symbol, stacked: view.logos.stacked };
  const image = images[kind];
  return image?.src ? { src: image.src, alt, filter } : null;
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
    { slot: 'primary', name: 'Horizontal lockup', format: formatOf(primary), variant: 'Full color', source: suppliedOr(primary, 'Not supplied') },
    { slot: 'reversed', name: 'Reversed (white)', format: formatOf(reversed), variant: 'White', source: suppliedOr(reversed, reversedFallback(primary)) },
    { slot: 'symbol', name: 'Symbol', format: symbolFormat(symbol, cropped), variant: 'Full color', source: symbolSource(symbol, cropped) },
    { slot: 'stacked', name: 'Stacked lockup', format: formatOf(stacked), variant: 'Full color', source: suppliedOr(stacked, 'Not supplied') },
  ];
}

/** A slot's format column: the file's format, or a dash without a file. */
function formatOf(image: BrandKitLogoImage | null): string {
  return image ? brandKitPortraitFormat(image) : '—';
}

/** A slot's source column: `Supplied` with a file, else the line the book says in its place. */
function suppliedOr(image: BrandKitLogoImage | null, otherwise: string): string {
  return image ? 'Supplied' : otherwise;
}

/** What the book does for a missing reversed file: derives it from the horizontal file when there is one. */
function reversedFallback(primary: BrandKitLogoImage | null): string {
  return primary ? 'Not supplied: this book derives it from the horizontal file' : 'Not supplied';
}

/** The symbol's format: its file's, `SVG (crop)` when the book crops it out of the lockup, else a dash. */
function symbolFormat(symbol: BrandKitLogoImage | null, cropped: boolean): string {
  if (symbol) return brandKitPortraitFormat(symbol);
  return cropped ? 'SVG (crop)' : '—';
}

/** The symbol's source: supplied, cropped out of the lockup, or not supplied. */
function symbolSource(symbol: BrandKitLogoImage | null, cropped: boolean): string {
  if (symbol) return 'Supplied';
  return cropped ? 'Cropped out of the horizontal lockup' : 'Not supplied';
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

/** The WCAG contrast of white on a colour, one decimal (`2.8`), for the symbol page's rule. */
export function brandKitPortraitWhiteContrast(hex: string): number {
  return Math.round(brandKitContrastRatio(brandKitLuminance(lfxColors.white), brandKitLuminance(hex)) * 10) / 10;
}

// ---------- Color contrast (page 10) ----------

/** The grade of an unrounded contrast ratio, in the kit's own words: AAA from 7, AA from 4.5, large text only from 3, else a fail. */
export function brandKitPortraitContrastGrade(ratio: number): BrandKitContrastGrade {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'Large text only';
  return 'Fails';
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

/** A ratio's label to one decimal, cut not rounded (`4.46` → `4.4`): WCAG 1.4.3 never rounds a ratio up to a threshold. */
function brandKitPortraitRatioLabel(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
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
 * The line a type step is shown in, whole and from the kit's own data (the
 * mock takes the framework's pillars and boilerplate, which the kit does not
 * hold): the project's name for the display step (the brand line would wrap
 * at 64 px), the umbrella message for the body, the footer line for the
 * caption, the brand line for every other step. Never cut, never an ellipsis.
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
 * The size a one-line sample is set at so it fits `width`, by the measured
 * width of its glyphs in the kit's face (`para.family`): `size` when it
 * fits, else the largest size (in the grammar's steps) at which it does,
 * down to `BRAND_KIT_PORTRAIT_FIT_MIN_PX`. The size never cuts the text: a
 * line no readable size holds is set at that minimum, and what the box then
 * does with it is the caller's: the type page's H1 keeps it on one line,
 * which clips past about 142 characters (open, with item 2's sweep).
 */
export function brandKitPortraitFitSize(
  text: string,
  width: number,
  size: number,
  para: Pick<MktgPortraitFitPara, 'weight' | 'caps' | 'family' | 'tracking'> = {}
): number {
  for (let scale = 1; scale > 0; scale -= MKTG_PORTRAIT_FIT.scaleStep) {
    const fitted = Math.floor(size * scale * 2) / 2;
    if (fitted < BRAND_KIT_PORTRAIT_FIT_MIN_PX) break;
    if (mktgPortraitLineFits(text, width, fitted, para)) return fitted;
  }
  return BRAND_KIT_PORTRAIT_FIT_MIN_PX;
}

/** The type source as the page names it: the host of a URL (`one.example.org`), or the text as written. */
export function brandKitPortraitTypeSource(source: string): string {
  const text = source.trim();
  const url = text.match(/https?:\/\/[^\s<>"')]+/i)?.[0];
  if (!url) return text;
  return brandKitWebsiteHost(url) || text.replace(/^https?:\/\//i, '');
}

/** A size scaled by `scale`, to the half px. */
function halfPx(size: number, scale: number): number {
  return Math.floor(size * scale * 2) / 2;
}

/**
 * The scale's steps as printed, the body step at `bodyScale` of its size
 * with `bodySample` as its words: a one-line step whose sample would not fit
 * its line is set smaller (that step only), never cut; the body step is a
 * paragraph and wraps.
 */
function typeSteps(view: BrandKitBookView, width: number, bodyScale: number, bodySample: string): BrandKitPortraitTypeStep[] {
  return view.type.scale.map((step) => {
    const display = step.step === 'display';
    const body = step.step === 'body';
    const sample = body ? bodySample : brandKitPortraitTypeSample(view, step);
    const room = display ? width : width - BRAND_KIT_PORTRAIT_SCALE_META_PX;
    const para = { weight: step.weight, caps: step.caps, family: view.type.family };
    const size = body ? halfPx(step.size, bodyScale) : brandKitPortraitFitSize(sample, room, step.size, para);
    const line_height = body ? Math.round(step.line_height * bodyScale) : step.line_height;
    // The spec column names what is printed: the step's own size while the sample is at it, the smaller size when it is not.
    return { ...step, sample, spec: `${step.weight} · ${size}/${line_height}`, display, size, line_height };
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

/** The taller of the two lower blocks, each its label over its lines, as the fit model measures them. */
function typeLowerHeight(view: BrandKitBookView, sourceLines: readonly BrandKitPortraitTypeSourceLine[]): number {
  const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
  const label = { text: 'Where to get the font', ...BRAND_KIT_PORTRAIT_SOURCES.label };
  const source = mktgPortraitBlockHeight(
    { paras: [label, ...sourceLines.map((line, index) => ({ text: line.text, size: c.text.size, line: c.text.line, above: index === 0 ? c.text.above : 0 }))] },
    c.lowerWidth
  );
  const rules = mktgPortraitBlockHeight(
    { paras: [label, ...view.type.rules.map((rule, index) => ({ text: rule, size: c.list.size, line: c.list.line, above: index === 0 ? c.list.above : 0 }))] },
    c.lowerWidth - c.list.indent
  );
  return Math.max(source, rules);
}

/**
 * The Typography page sized from its data. The scale's rows take the
 * height their samples need (the body step, the umbrella message, wraps to
 * two or three lines), so the two blocks under it follow where it really
 * ends: the page lays them in flow, 16 px under the scale and never above
 * the mock's y 830, and this model predicts that y (`lowerTop`) to decide
 * the body step's size: when the stack would run past y 990 the body step
 * is set smaller in the grammar's steps, down to 14 px, and only when no
 * size holds it is its sample cut at a sentence. A line the model misjudges
 * by a few px moves the blocks down in flow; it is never drawn on.
 */
export function brandKitPortraitTypeLayout(view: BrandKitBookView, width: number): BrandKitPortraitTypeLayout {
  const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
  const sourceLines = typeSourceLines(view);
  const lowerHeight = typeLowerHeight(view, sourceLines);
  const bodyStep = view.type.scale.find((step) => step.step === 'body');
  const bodyWords = bodyStep ? brandKitPortraitTypeSample(view, bodyStep) : '';
  const layout = (bodyScale: number, bodySample: string, cut: boolean): BrandKitPortraitTypeLayout => {
    const steps = typeSteps(view, width, bodyScale, bodySample);
    const scaleEnd = typeScaleEnd(steps, width, view.type.family);
    const lowerTop = Math.max(c.lowerTop, Math.ceil(scaleEnd) + c.lowerGap);
    return { steps, scaleEnd, lowerTop, sourceLines, bodyScale, cut };
  };
  const fits = (candidate: BrandKitPortraitTypeLayout): boolean => candidate.lowerTop + lowerHeight <= c.bottom + 0.01;
  let bodyScale = 1;
  let candidate = layout(bodyScale, bodyWords, false);
  while (!fits(candidate) && bodyStep && halfPx(bodyStep.size, bodyScale - MKTG_PORTRAIT_FIT.scaleStep) >= c.bodyMinPx) {
    bodyScale -= MKTG_PORTRAIT_FIT.scaleStep;
    candidate = layout(bodyScale, bodyWords, false);
  }
  let sample = bodyWords;
  for (let cuts = 0; !fits(candidate) && cuts < MKTG_PORTRAIT_FIT.maxCuts; cuts++) {
    const shorter = mktgPortraitCutText(sample, Math.floor(sample.length * MKTG_PORTRAIT_FIT.cutShare));
    if (shorter === sample) break;
    sample = shorter;
    candidate = layout(bodyScale, sample, true);
  }
  return candidate;
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
 * holding no headline of its own.
 */
export function brandKitPortraitUsageCards(view: BrandKitBookView, approval: MktgRevisionApproval | null = null): BrandKitPortraitUsageCard[] {
  const lines: Record<BrandKitUsageView['layout'], string> = {
    keynote: view.voice.line,
    social: view.voice.line,
    report: [view.projectName, 'annual report', brandKitPortraitApprovalYear(approval)].filter((part) => part !== '').join(' '),
    announcement: `New members join ${view.projectName}`,
  };
  return view.usageTiles.map((tile, index) => {
    const example = view.usage.examples[index];
    return {
      layout: tile.layout,
      text: lines[tile.layout],
      name: example?.name ?? '',
      format: example?.format ?? '',
      ground: example?.ground ?? '',
      accentMoment: BRAND_KIT_PORTRAIT_USAGE_ACCENT_MOMENTS[tile.layout],
    };
  });
}

// ---------- Voice (page 15) ----------

/**
 * The attributes fitted to the grid's room under the messages: measured row
 * by row (each row as tall as its taller cell: the rule, the padding, the
 * name, the line) with the fit model, set smaller in the grammar's steps
 * when more attributes, or longer lines, than the room holds would run
 * under the footer; a grid no step holds has its longest name and longest
 * line cut at a sentence, which the result says — that one cell each, so a
 * grid of many long attributes can still cross the footer (open, with
 * item 2's sweep; more than about eight long attributes).
 */
export function brandKitPortraitAttributesFit(attributes: readonly { name: string; line: string }[]): BrandKitPortraitAttributesFit {
  const c = BRAND_KIT_PORTRAIT_ATTRIBUTES;
  const rows: { name: string; line: string }[][] = [];
  attributes.forEach((attribute, index) => {
    if (index % c.columns === 0) rows.push([]);
    rows[rows.length - 1].push({ ...attribute });
  });
  const paras: MktgPortraitFitPara[] = [];
  const writes: ((text: string) => void)[] = [];
  rows.forEach((row, rowIndex) => {
    const longestName = row.reduce((best, cell) => (cell.name.length > best.name.length ? cell : best), row[0]);
    const longestLine = row.reduce((best, cell) => (cell.line.length > best.line.length ? cell : best), row[0]);
    paras.push({ text: longestName.name, ...c.name, above: c.rule + c.padding + (rowIndex === 0 ? 0 : c.rowGap) });
    writes.push(() => undefined);
    paras.push({ text: longestLine.line, ...c.line, above: c.lineAbove });
    writes.push((text) => {
      longestLine.line = text;
    });
  });
  const fit = mktgPortraitFitBlock({ paras }, c.columnWidth, c.bottom - c.top);
  if (fit.cut) fit.block.paras.forEach((para, index) => para.text !== paras[index].text && writes[index](para.text));
  return { scale: fit.scale, cut: fit.cut, attributes: rows.flat() };
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

/** One measured line of a Sources column: its paragraph for the fit model and where its text, once cut, goes back. */
interface SourcesLine {
  para: MktgPortraitFitPara;
  write: (text: string) => void;
}

/**
 * A column's lines as the fit model measures them: each block a label (10 px
 * caps, 26 px under the block before) over its items (12.5/1.6, the first
 * 8 px under the label). `write` puts a cut text back where it came from.
 */
function sourcesColumn(blocks: { label: string; items: { text: string; write: (text: string) => void }[] }[]): SourcesLine[] {
  const c = BRAND_KIT_PORTRAIT_SOURCES;
  const lines: SourcesLine[] = [];
  blocks
    .filter((block) => block.items.length > 0)
    .forEach((block, blockIndex) => {
      lines.push({ para: { text: block.label, ...c.label, above: blockIndex === 0 ? 0 : c.blockGap }, write: () => undefined });
      block.items.forEach((item, index) => lines.push({ para: { text: item.text, ...c.item, above: index === 0 ? c.listAbove : 0 }, write: item.write }));
    });
  return lines;
}

/**
 * The Sources page's lists fitted to their two columns: measured with the
 * fit model against the room above the accepted box (or the footer, without
 * one), set smaller in the grammar's steps when they would overrun, both
 * columns at the one smaller size; a column no step holds has its longest
 * lines cut at a sentence, which the result says. A column whose every item
 * is already shorter than the fit model's smallest cut can still run past
 * its room when it says so (open, with item 2's sweep).
 */
export function brandKitPortraitSourcesFit(sources: BrandKitPortraitSources, approved: boolean): BrandKitPortraitSourcesFit {
  const c = BRAND_KIT_PORTRAIT_SOURCES;
  const height = (approved ? c.acceptedTop - c.gap : c.bottom) - c.top;
  const width = c.width - c.indent;
  const fitted: BrandKitPortraitSources = {
    ...sources,
    read: [...sources.read],
    failed: sources.failed.map((entry) => ({ ...entry })),
    warnings: sources.warnings.map((entry) => ({ ...entry })),
    missing: sources.missing.map((entry) => ({ ...entry })),
    gaps: [...sources.gaps],
    conflicts: sources.conflicts.map((conflict) => ({ ...conflict, values: conflict.values.map((value) => ({ ...value })) })),
  };
  const left = sourcesColumn([
    { label: 'Read', items: fitted.read.map((text, index) => ({ text, write: (next) => (fitted.read[index] = next) })) },
    {
      label: 'Could not be read',
      items: fitted.failed.map((entry) => ({
        text: entry.reason ? `${entry.source} — ${entry.reason}` : entry.source,
        write: (next) => (entry.reason = next.startsWith(`${entry.source} — `) ? next.slice(entry.source.length + 3) : next),
      })),
    },
    {
      label: 'Warnings',
      items: [
        ...fitted.warnings.map((entry) => ({
          text: entry.source ? `${entry.text} (${entry.source})` : entry.text,
          write: (next: string) => (entry.text = next),
        })),
        ...fitted.gaps.map((text, index) => ({ text, write: (next: string) => (fitted.gaps[index] = next) })),
        ...(fitted.notes ? [{ text: fitted.notes, write: (next: string) => (fitted.notes = next) }] : []),
      ],
    },
  ]);
  const right = sourcesColumn([
    {
      label: 'Missing',
      items: [
        ...fitted.missing.map((entry) => ({
          text: [`${entry.asset} — ${entry.reason}`, entry.fix ? `Fix: ${entry.fix}` : ''].filter((part) => part !== '').join(' '),
          write: (next: string) => {
            const prefix = `${entry.asset} — `;
            const body = next.startsWith(prefix) ? next.slice(prefix.length) : next;
            const fix = body.indexOf(' Fix: ');
            entry.reason = fix >= 0 ? body.slice(0, fix) : body;
            entry.fix = fix >= 0 ? body.slice(fix + ' Fix: '.length) : '';
          },
        })),
        ...(fitted.sharedFix
          ? [{ text: `Fix, for all ${fitted.missing.length}: ${fitted.sharedFix}`, write: (next: string) => (fitted.sharedFix = next) }]
          : []),
      ],
    },
    {
      label: 'Color conflicts',
      items: fitted.conflicts.flatMap((conflict) => [
        { text: conflict.name, write: () => undefined },
        ...conflict.values.map((value) => ({
          text: `${value.label} ${value.source}`,
          write: (next: string) => (value.source = next.startsWith(`${value.label} `) ? next.slice(value.label.length + 1) : next),
        })),
      ]),
    },
  ]);
  const fits = [left, right].map((lines) => mktgPortraitFitBlock({ paras: lines.map((line) => line.para) }, width, height));
  const scale = Math.min(...fits.map((fit) => fit.scale));
  const cut = fits.some((fit) => fit.cut);
  if (cut) {
    [left, right].forEach((lines, column) => {
      if (!fits[column].cut) return;
      fits[column].block.paras.forEach((para, index) => {
        if (para.text !== lines[index].para.text) lines[index].write(para.text);
      });
    });
  }
  return { scale, cut, sources: fitted };
}
