// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The plan of a portrait document's pages, pure over its view, and the two
// strings every portrait document derives the same way: its name (the
// running head's right slot) and its footer text. The contents page, the
// footers' numbers and the family's openers all read the plan, so a count
// or a page number is never written by hand.

import type { BrandKitBookView } from '../interfaces/brand-kit.interface';
import type { MktgPortraitBook, MktgPortraitDocumentKind, MktgPortraitPlacedPage, MktgPortraitPlanPage } from '../interfaces/mktg-portrait-print.interface';
import { mktgPortraitIsChapter } from './mktg-portrait-print.utils';

/** The document's name, as the running head and the contents print it: `Agentic AI Foundation brand kit`. */
export function mktgPortraitDocumentName(projectName: string, kind: MktgPortraitDocumentKind): string {
  return `${projectName} ${kind}`;
}

/** The footer's left text: `Agentic AI Foundation · a Linux Foundation project`. */
export function mktgPortraitFootLeft(projectName: string): string {
  return `${projectName} · a Linux Foundation project`;
}

/**
 * Whether the kit has any logo artwork the pages can draw: a file with an
 * inline `src` (the book inlines SVG only) or the symbol cropped out of one.
 * A kit whose files are all bitmaps has nothing to draw, so its logo pages
 * are planned away rather than printed with empty tiles.
 */
export function brandKitPortraitHasLogoFiles(view: BrandKitBookView): boolean {
  return Object.values(view.logos).some((file) => !!file?.src) || !!view.symbol?.src;
}

/** Whether the kit has a symbol the pages can draw (its own inline file or the crop out of the horizontal lockup). */
export function brandKitPortraitHasSymbol(view: BrandKitBookView): boolean {
  return !!view.logos.symbol?.src || !!view.symbol?.src;
}

/**
 * The seventeen pages of the Brand Kit's portrait book, in the mock's
 * order: cover · contents · 01 Logo (six pages) · 02 Color (two) · 03 Type
 * · 04 Visual (two) · 05 Usage · 06 Voice · 07 Sources · back cover. Inside
 * the family (`inFamily`) the cover, contents and back cover go: the family
 * has its own. A page is never printed empty (the editor's rule): a kit
 * without a logo file keeps the Logo chapter's first page alone, which says
 * no files were uploaded yet, and a kit without a symbol has no symbol page.
 * The count, the contents and the footers all follow.
 */
export function brandKitPortraitPlan(view: BrandKitBookView, options: { inFamily: boolean }): MktgPortraitPlanPage[] {
  const pages: MktgPortraitPlanPage[] = [
    { id: 'cover', section: 'Cover', title: 'Cover' },
    { id: 'contents', section: 'Contents', title: "What's inside" },
    { id: 'logo-system', section: '01 Logo', title: 'Logo system' },
    { id: 'logo-colorways', section: '01 Logo', title: 'Colorways' },
    { id: 'logo-clear-space', section: '01 Logo', title: 'Clear space & minimum size' },
    { id: 'logo-symbol', section: '01 Logo', title: 'Symbol & symbol in shape' },
    { id: 'logo-partnership', section: '01 Logo', title: 'Partnership lockup' },
    { id: 'logo-watchouts', section: '01 Logo', title: 'Watchouts' },
    { id: 'color-palette', section: '02 Color', title: 'Color palette' },
    { id: 'color-contrast', section: '02 Color', title: 'Color contrast' },
    { id: 'type', section: '03 Type', title: 'Typography' },
    { id: 'visual-iconography', section: '04 Visual', title: 'Iconography' },
    { id: 'visual-imagery', section: '04 Visual', title: 'Imagery & graphic elements' },
    { id: 'usage', section: '05 Usage', title: 'Example usage' },
    { id: 'voice', section: '06 Voice', title: 'Voice in brief' },
    { id: 'sources', section: '07 Sources', title: 'Sources & decisions' },
    { id: 'back-cover', section: 'Back cover', title: 'Back cover' },
  ];
  const dropped = new Set<string>();
  if (options.inFamily) ['cover', 'contents', 'back-cover'].forEach((id) => dropped.add(id));
  if (!brandKitPortraitHasLogoFiles(view))
    ['logo-colorways', 'logo-clear-space', 'logo-symbol', 'logo-partnership', 'logo-watchouts'].forEach((id) => dropped.add(id));
  if (!brandKitPortraitHasSymbol(view)) dropped.add('logo-symbol');
  return pages.filter((page) => !dropped.has(page.id));
}

/**
 * Whether a plan page opens a numbered chapter (it carries the band, and
 * the contents page groups under it): its section is `NN …` and the page
 * before it has another section.
 */
export function mktgPortraitOpensChapter(plan: readonly MktgPortraitPlanPage[], index: number): boolean {
  const page = plan[index];
  return page !== undefined && mktgPortraitIsChapter(page.section) && plan[index - 1]?.section !== page.section;
}

/** The section label the running head prints: `01 Logo` standalone, `Brand kit · Logo` inside the family (the number is the family's opener's). */
export function mktgPortraitSectionLabel(section: string, inFamily: boolean, document = 'Brand kit'): string {
  return inFamily ? `${document} · ${section.replace(/^\d\d /, '')}` : section;
}

/**
 * The plan placed in its book: each page numbered from the book's first
 * page, labelled as the running head prints it, and marked with the band
 * where it opens a chapter standalone (inside the family the openers are
 * the chapter pages, so no band).
 */
export function mktgPortraitPlacePlan(plan: readonly MktgPortraitPlanPage[], book: MktgPortraitBook, document = 'Brand kit'): MktgPortraitPlacedPage[] {
  return plan.map((page, index) => ({
    ...page,
    number: book.firstPage + index,
    label: mktgPortraitSectionLabel(page.section, book.inFamily, document),
    band: !book.inFamily && mktgPortraitOpensChapter(plan, index),
  }));
}
