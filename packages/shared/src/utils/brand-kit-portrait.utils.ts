// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's portrait pages, pure over the kit's book view: the
// artwork a page draws, the logo files table, the palette's sources, the
// approval line and the few derived strings. A fact the view does not hold
// is left out (null, '' or no row), never written here.

import { BRAND_KIT_FOUND_IN_LABELS, BRAND_KIT_REPORT_ASSET_LABELS } from '../constants/brand-kit.constants';
import { MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import type { BrandKitBookView, BrandKitLogoImage, BrandKitPaletteEntry, BrandKitTypeStep, BrandKitUsageView } from '../interfaces/brand-kit.interface';
import type {
  BrandKitPortraitContrastGrade,
  BrandKitPortraitContrastRow,
  BrandKitPortraitFileRow,
  BrandKitPortraitSources,
  BrandKitPortraitUsageCard,
} from '../interfaces/brand-kit-portrait.interface';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import type { MktgPrintLogo } from '../interfaces/mktg-print.interface';
import { brandKitContrastRatio, brandKitLuminance } from './brand-kit-book.utils';
import { brandKitLogoFileName, brandKitWebsiteHost } from './brand-kit.utils';

/** How a page draws the artwork: as supplied, reversed to white, or one-colour black. */
export type BrandKitPortraitArtworkMode = 'full' | 'reversed' | 'mono';

/** The one-colour black rendering of a full-colour file. */
export const BRAND_KIT_PORTRAIT_MONO_FILTER = 'brightness(0)';

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
  const filter = mode === 'reversed' ? MKTG_PRINT_REVERSED_FILTER : mode === 'mono' ? BRAND_KIT_PORTRAIT_MONO_FILTER : '';
  if (kind === 'lockup' && mode === 'reversed' && view.logos.reversed?.src) return { src: view.logos.reversed.src, alt: 'Reversed lockup', filter: '' };
  const image: BrandKitLogoImage | null = kind === 'lockup' ? view.logos.primary : kind === 'symbol' ? view.symbol : view.logos.stacked;
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
    {
      slot: 'primary',
      name: 'Horizontal lockup',
      format: primary ? brandKitPortraitFormat(primary) : '—',
      variant: 'Full colour',
      source: primary ? 'Supplied' : 'Not supplied',
    },
    {
      slot: 'reversed',
      name: 'Reversed (white)',
      format: reversed ? brandKitPortraitFormat(reversed) : '—',
      variant: 'White',
      source: reversed ? 'Supplied' : primary ? 'Not supplied: this book derives it from the horizontal file' : 'Not supplied',
    },
    {
      slot: 'symbol',
      name: 'Symbol',
      format: symbol ? brandKitPortraitFormat(symbol) : cropped ? 'SVG (crop)' : '—',
      variant: 'Full colour',
      source: symbol ? 'Supplied' : cropped ? 'Cropped out of the horizontal lockup' : 'Not supplied',
    },
    {
      slot: 'stacked',
      name: 'Stacked lockup',
      format: stacked ? brandKitPortraitFormat(stacked) : '—',
      variant: 'Full colour',
      source: stacked ? 'Supplied' : 'Not supplied',
    },
  ];
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

/** `6 Nov 2026`, or '' for a date the store cannot parse. */
export function brandKitPortraitDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
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
  return Math.round(brandKitContrastRatio(brandKitLuminance('#FFFFFF'), brandKitLuminance(hex)) * 10) / 10;
}

// ---------- Color contrast (page 10) ----------

/** The grade of a contrast ratio: AAA from 7, AA from 4.5, large text only from 3, else a fail. */
export function brandKitPortraitContrastGrade(ratio: number): BrandKitPortraitContrastGrade {
  if (ratio >= 7) return { label: 'AAA', background: '#ECFDF5', color: '#047857' };
  if (ratio >= 4.5) return { label: 'AA', background: '#ECFDF5', color: '#047857' };
  if (ratio >= 3) return { label: 'Large only', background: '#FFFBEB', color: '#B45309' };
  return { label: 'Fails', background: '#FEF2F2', color: '#DC2626' };
}

/** The WCAG contrast of two hex colours, two decimals. */
export function brandKitPortraitContrast(first: string, second: string): number {
  return Math.round(brandKitContrastRatio(brandKitLuminance(first), brandKitLuminance(second)) * 100) / 100;
}

/** Every pairing of the palette, computed here from the hex values: the matrix the contrast page draws. */
export function brandKitPortraitContrastMatrix(view: BrandKitBookView): BrandKitPortraitContrastRow[] {
  const colors = view.color.palette;
  return colors.map((text) => ({
    name: text.name,
    hex: text.hex,
    cells: colors.map((ground) => ({
      foreground: text.hex,
      background: ground.hex,
      ratio: ground.hex.toLowerCase() === text.hex.toLowerCase() ? null : brandKitPortraitContrast(text.hex, ground.hex),
    })),
  }));
}

// ---------- Typography (page 11) ----------

const WEIGHT_NAMES: Record<number, string> = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' };

/** A weight's name, `Medium 500`, or the number alone for one without a common name. */
export function brandKitPortraitWeightName(weight: number): string {
  const name = WEIGHT_NAMES[weight];
  return name ? `${name} ${weight}` : String(weight);
}

/**
 * The line a type step is shown in, whole and from the kit's own data (the
 * mock takes the framework's pillars and boilerplate, which the kit does not
 * hold): the brand line for the display step, the umbrella message for the
 * body, the footer line for the caption, the first voice attribute's name for
 * the eyebrow, the brand line otherwise. Never cut, never an ellipsis.
 */
export function brandKitPortraitTypeSample(view: BrandKitBookView, step: BrandKitTypeStep): string {
  switch (step.step) {
    case 'body':
      return view.voice.umbrella || view.voice.line;
    case 'caption':
      return view.footer;
    case 'eyebrow':
      return view.voice.attributes[0]?.name || view.voice.line;
    default:
      return view.voice.line;
  }
}

/** The type source as the page names it: the host of a URL (`one.example.org`), or the text as written. */
export function brandKitPortraitTypeSource(source: string): string {
  const text = source.trim();
  const url = text.match(/https?:\/\/[^\s<>"')]+/i)?.[0];
  if (!url) return text;
  return brandKitWebsiteHost(url) || text.replace(/^https?:\/\//i, '');
}

// ---------- Example usage (page 14) ----------

const USAGE_ACCENT_MOMENTS: Record<BrandKitUsageView['layout'], string> = {
  keynote: 'none (grid ground)',
  social: 'the card itself',
  report: 'none',
  announcement: 'the top rule',
};

/**
 * The usage page's four cards from the kit's examples, each with the line it
 * shows: the umbrella message on the keynote slide, the brand line on the
 * social card and the report cover, and on the announcement header the
 * membership headline (`New members join <Project>`), the kit holding no
 * headline of its own.
 */
export function brandKitPortraitUsageCards(view: BrandKitBookView): BrandKitPortraitUsageCard[] {
  const lines: Record<BrandKitUsageView['layout'], string> = {
    keynote: view.voice.umbrella || view.voice.line,
    social: view.voice.line,
    report: view.voice.line,
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
      accentMoment: USAGE_ACCENT_MOMENTS[tile.layout],
    };
  });
}

// ---------- Sources & decisions (page 16) ----------

/** A source string in words: the LFX record by name, a stylesheet chunk as the site's stylesheets, a URL without its scheme or query. */
export function brandKitPortraitReadableSource(source: string): string {
  const text = source.trim();
  if (/^LFX record/i.test(text)) return 'The LFX project record';
  const host = brandKitWebsiteHost(/^https?:\/\//i.test(text) ? text : null);
  if (host && /\/_next\/static\/|\.css(\?|$)/i.test(text)) return `${host} stylesheets`;
  return text.replace(/^https?:\/\//i, '').replace(/\?.*$/, '');
}

/** The Sources page's lists from the revision's report: only what the record holds, each source made readable, duplicates folded. */
export function brandKitPortraitSources(view: BrandKitBookView): BrandKitPortraitSources {
  const report = view.report;
  const findings = report.findings;
  const failed = (findings?.sources_failed ?? report.sources_failed.map((entry) => ({ source: entry.name, reason: entry.reason }))).map((entry) => ({
    source: brandKitPortraitReadableSource(entry.source),
    reason: entry.reason.trim(),
  }));
  const missing = (findings?.missing_assets ?? []).map((entry) => ({
    asset: BRAND_KIT_REPORT_ASSET_LABELS[entry.asset],
    reason: entry.reason.trim(),
    fix: entry.fix?.trim() ?? '',
  }));
  const fixes = new Set(missing.map((entry) => entry.fix.replace(/^Upload the \w+ file/, '')));
  const sharedFix = missing.length > 1 && fixes.size === 1 && missing[0].fix ? missing[0].fix.replace(/^Upload the \w+ file/, 'Upload each file') : '';
  return {
    read: [...new Set(report.sources_read.map(brandKitPortraitReadableSource))],
    failed,
    warnings: (findings?.warnings ?? [])
      .filter((warning) => warning.code !== 'color_conflict' && warning.text.trim() !== '')
      .map((warning) => ({ text: warning.text.trim(), source: warning.source ? brandKitPortraitReadableSource(warning.source) : '' })),
    missing: sharedFix ? missing.map((entry) => ({ ...entry, fix: '' })) : missing,
    sharedFix,
    gaps: report.gaps.map((gap) => gap.trim()).filter((gap) => gap !== ''),
    notes: report.notes.trim(),
    conflicts: (report.color_conflicts ?? [])
      .filter((conflict) => conflict.values.length > 1)
      .map((conflict) => ({ ...conflict, values: conflict.values.map((value) => ({ ...value, source: brandKitPortraitReadableSource(value.source) })) })),
  };
}
