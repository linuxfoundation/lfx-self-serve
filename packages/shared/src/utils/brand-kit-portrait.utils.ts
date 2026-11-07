// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's portrait pages, pure over the kit's book view: the
// artwork a page draws, the logo files table, the palette's sources, the
// approval line and the few derived strings. A fact the view does not hold
// is left out (null, '' or no row), never written here.

import { BRAND_KIT_FOUND_IN_LABELS } from '../constants/brand-kit.constants';
import { MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import type { BrandKitBookView, BrandKitLogoImage, BrandKitLogoSlot, BrandKitPaletteEntry } from '../interfaces/brand-kit.interface';
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

/** One row of the logo files table. */
export interface BrandKitPortraitFileRow {
  slot: BrandKitLogoSlot;
  name: string;
  /** `SVG`, `PNG`, `SVG (crop)` or `—`. */
  format: string;
  variant: string;
  /** `Supplied`, or the mock's plain line for a missing file; never a file name. */
  source: string;
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
