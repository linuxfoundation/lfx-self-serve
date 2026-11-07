// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The plan of the Messaging Framework's portrait book, pure over its print
// view: which pages print, in which order, under which section label and
// title. The cover's contents, the footers' numbers and the family's opener
// all read it, so no count or page number is ever written by hand. Beside
// the kit's plan (`brandKitPortraitPlan`, mktg-portrait-plan.utils.ts), on
// the same page type.

import { FRAMEWORK_PORTRAIT_PAGE_IDS, FRAMEWORK_PORTRAIT_SECTIONS, FRAMEWORK_PORTRAIT_SEP, FRAMEWORK_PORTRAIT_TITLES } from '../constants/mktg-print.constants';
import { mktgPrintJoin } from './mktg-print-text.utils';
import type { FoundationMessagePrintView } from '../interfaces/mktg-print.interface';
import type { MktgPortraitPlanPage } from '../interfaces/mktg-portrait-print.interface';
import { frameworkPortraitIcpPages, frameworkPortraitNumbersPages } from './mktg-framework-portrait-layout.utils';

/**
 * The pages of the Messaging Framework's portrait book, in the mock's order:
 * the cover · 01 Framework (the statements and the goal matrix; one page per
 * goal; say and avoid with the anchor questions) · 02 ICPs (two profiles a
 * page) · 03 Message house · 04 Key numbers (more pages when the figures'
 * table needs them) · 05 Sources & gaps. Inside the
 * family (`inFamily`) the cover goes: the family has its own. The ids are
 * stable (`goal-2`, `icps-3`): the template switches on them, QA reads them
 * from the frames.
 */
export function frameworkPortraitPlan(view: FoundationMessagePrintView, options: { inFamily: boolean }): MktgPortraitPlanPage[] {
  const ids = FRAMEWORK_PORTRAIT_PAGE_IDS;
  const sections = FRAMEWORK_PORTRAIT_SECTIONS;
  const titles = FRAMEWORK_PORTRAIT_TITLES;
  const pages: MktgPortraitPlanPage[] = [];
  if (!options.inFamily) pages.push({ id: ids.cover, section: 'Cover', title: 'Cover' });
  pages.push({ id: ids.framework, section: sections.framework, title: titles.framework });
  view.goals.forEach((goal) =>
    pages.push({ id: `goal-${goal.n}`, section: sections.framework, title: mktgPrintJoin([`Goal ${goal.n}`, goal.t], FRAMEWORK_PORTRAIT_SEP) })
  );
  pages.push({ id: ids.sayAvoid, section: sections.framework, title: titles.sayAvoid });
  frameworkPortraitIcpPages(view.icps).forEach((_, index) =>
    pages.push({ id: `icps-${index + 1}`, section: sections.icps, title: index === 0 ? titles.icps : `${titles.icps} (${index + 1})` })
  );
  pages.push({ id: ids.messageHouse, section: sections.messageHouse, title: titles.messageHouse });
  // The key numbers take the pages their count needs (`key-numbers`, `key-numbers-2`, …), as the ICPs do.
  frameworkPortraitNumbersPages(view).forEach((_, index) =>
    pages.push({
      id: index === 0 ? ids.keyNumbers : `${ids.keyNumbers}-${index + 1}`,
      section: sections.keyNumbers,
      title: index === 0 ? titles.keyNumbers : `${titles.keyNumbers} (${index + 1})`,
    })
  );
  pages.push({ id: ids.sources, section: sections.sources, title: titles.sources });
  return pages;
}
