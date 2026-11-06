// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's landscape print pages: the shapes the kit book's builder
// (utils/mktg-print-brand-kit.utils.ts) is called with and lays pages out in.

import type { BrandKitBookView } from './brand-kit.interface';
import type { MktgPrintPageLook } from './mktg-print-page.interface';
import type { MktgPrintBrand, MktgPrintLogo } from './mktg-print.interface';

/** The logo variants the deck draws, and what the book view holds for each. */
export type MktgPrintBrandKitLogoVariant = 'primary' | 'reversed' | 'one_color' | 'symbol' | 'symbol_reversed';

/** What a page of the kit book needs to be laid out. */
export interface MktgPrintBrandKitContext {
  view: BrandKitBookView;
  brand: MktgPrintBrand;
  look: MktgPrintPageLook;
  projectName: string;
  /** The project logo in every variant the kit's artwork gives (its SVG under the colorway filters); a variant with no drawable artwork is null and its slot is dropped. */
  logos: Record<MktgPrintBrandKitLogoVariant, MktgPrintLogo | null>;
}

/** Options of the kit book's assembly: the number of its first page (the cover), and whether the back cover is included. */
export interface MktgPrintBrandKitOptions {
  firstPage?: number;
  backCover?: boolean;
}
