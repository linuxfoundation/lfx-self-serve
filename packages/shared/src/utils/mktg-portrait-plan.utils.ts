// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The plan of a portrait document's pages, pure over its view, and the two
// strings every portrait document derives the same way: its name (the
// running head's right slot) and its footer text. The contents page, the
// footers' numbers and the family's openers all read the plan, so a count
// or a page number is never written by hand.

import type { BrandKitBookView } from '../interfaces/brand-kit.interface';
import type { MktgPortraitDocumentKind, MktgPortraitPlanPage } from '../interfaces/mktg-portrait-print.interface';
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
 * The seventeen pages of the Brand Kit's portrait book, in the mock's
 * order: cover · contents · 01 Logo (six pages) · 02 Color (two) · 03 Type
 * · 04 Visual (two) · 05 Usage · 06 Voice · 07 Sources · back cover. Inside
 * the family (`inFamily`) the cover, contents and back cover go: the family
 * has its own. The plan is the same for every kit (every page prints from
 * the live data it has, a slot it lacks left out), so the view is read for
 * nothing yet; it is the plan's input so a page can one day depend on it
 * without a change at the callers.
 */
export function brandKitPortraitPlan(view: BrandKitBookView, options: { inFamily: boolean }): MktgPortraitPlanPage[] {
  void view;
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
  return options.inFamily ? pages.filter((page) => !['cover', 'contents', 'back-cover'].includes(page.id)) : pages;
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
