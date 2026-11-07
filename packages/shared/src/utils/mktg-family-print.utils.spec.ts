// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_KIT_POSITIONING_FAMILY_ID } from '../constants/mktg-kit.constants';
import type { MktgFamilyPrintDocument, MktgFamilyPrintPlanMember } from '../interfaces/mktg-family-print.interface';
import {
  mktgFamilyPrintConflicts,
  mktgFamilyPrintDate,
  mktgFamilyPrintDocument,
  mktgFamilyPrintFaqPages,
  mktgFamilyPrintFill,
  mktgFamilyPrintOpenItems,
  mktgFamilyPrintPad,
  mktgFamilyPrintPageRange,
  mktgFamilyPrintPlan,
  mktgFamilyPrintVersionLabel,
} from './mktg-family-print.utils';

const approval = { approvedAt: '2026-11-06T18:26:00Z', approvedBy: { name: 'A. Reviewer' } };

function doc(agentKey: MktgFamilyPrintDocument['agentKey'], number: number, version = 1, openItems: string[] = []): MktgFamilyPrintDocument {
  return mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, agentKey, number, version, approval, openItems);
}

/** The dev project's shape: a two-sheet framework, a five-chapter kit, four boilerplates, ten FAQs in four groups. */
function members(): MktgFamilyPrintPlanMember[] {
  return [
    { document: doc('foundation-message', 1, 1, ['Regulated industries: no answer yet']), innerPageTitles: ['Framework', 'Key numbers'] },
    {
      document: doc('brand-kit', 2, 4, ['No stacked lockup among the logo files uploaded.']),
      innerPageTitles: ['Logo system', 'Colour', 'Typography', 'Visual', 'Voice in brief'],
    },
    { document: doc('boilerplates', 3, 2), boilerplateCount: 4 },
    { document: doc('faq', 4, 16), faqGroupSizes: [2, 3, 3, 2] },
  ];
}

describe('mktgFamilyPrintDocument', () => {
  it('names the chapter from the family asset, in one version format, with the approval as printed', () => {
    const document = doc('brand-kit', 2, 4, [' No stacked lockup. ', '']);
    expect(document).toEqual({
      agentKey: 'brand-kit',
      number: '02',
      title: 'Brand kit',
      summary: 'The logo and its rules, colour and contrast, type, iconography and imagery, example usage, and the voice in brief.',
      versionLabel: 'V4.0',
      approvedLabel: '6 Nov 2026',
      approvedBy: 'A. Reviewer',
      openItems: ['No stacked lockup.'],
    });
  });

  it('omits what the store does not give: no version, no approval, no approver', () => {
    const document = mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 4, null, { approvedAt: 'not a date', approvedBy: null }, []);
    expect(document.versionLabel).toBe('');
    expect(document.approvedLabel).toBe('');
    expect(document.approvedBy).toBeNull();
    expect(mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 4, 16, null, []).approvedLabel).toBe('');
  });
});

describe('the small helpers', () => {
  it('pads, labels versions, formats dates in UTC and ranges pages', () => {
    expect(mktgFamilyPrintPad(2)).toBe('02');
    expect(mktgFamilyPrintPad(37)).toBe('37');
    expect(mktgFamilyPrintVersionLabel(16)).toBe('V16.0');
    expect(mktgFamilyPrintVersionLabel(null)).toBe('');
    expect(mktgFamilyPrintVersionLabel(Number.NaN)).toBe('');
    expect(mktgFamilyPrintDate('2026-11-06T23:59:00Z')).toBe('6 Nov 2026');
    expect(mktgFamilyPrintDate('2026-11-07T00:00:00Z')).toBe('7 Nov 2026');
    expect(mktgFamilyPrintDate(null)).toBe('');
    expect(mktgFamilyPrintPageRange(4, 15)).toBe('4–15');
    expect(mktgFamilyPrintPageRange(32, 32)).toBe('32');
    expect(mktgFamilyPrintFill('[Documents] documents, [Pages] pages.', { Documents: 4, Pages: 37 })).toBe('4 documents, 37 pages.');
  });
});

describe('mktgFamilyPrintFaqPages', () => {
  it('prints every group on one page up to eight questions, two groups a page past it, and skips empty groups', () => {
    expect(mktgFamilyPrintFaqPages([2, 3, 3])).toEqual([{ groups: [0, 1, 2] }]);
    expect(mktgFamilyPrintFaqPages([2, 3, 3, 2])).toEqual([{ groups: [0, 1] }, { groups: [2, 3] }]);
    expect(mktgFamilyPrintFaqPages([2, 0, 3, 3, 2])).toEqual([{ groups: [0, 2] }, { groups: [3, 4] }]);
    expect(mktgFamilyPrintFaqPages([5, 4, 1])).toEqual([{ groups: [0, 1] }, { groups: [2] }]);
    expect(mktgFamilyPrintFaqPages([0, 0])).toEqual([]);
    expect(mktgFamilyPrintFaqPages([])).toEqual([]);
  });
});

describe('mktgFamilyPrintPlan', () => {
  it('numbers the dev family cover to back cover, with the openers and the contents reading the same numbers', () => {
    const plan = mktgFamilyPrintPlan(members());
    // 1 cover · 2 contents · 3 opener · 4–5 framework · 6 opener · 7–11 kit · 12 opener · 13 boilerplates · 14 opener · 15–16 FAQ · 17 Sources · 18 back
    expect(plan.total).toBe(18);
    expect(plan.pages.map((page) => `${page.n}:${page.kind}`)).toEqual([
      '1:cover',
      '2:contents',
      '3:opener',
      '4:framework',
      '6:opener',
      '7:kit',
      '12:opener',
      '13:boilerplates',
      '14:opener',
      '15:faq',
      '16:faq',
      '17:sources',
      '18:back',
    ]);
    expect(plan.pages.find((page) => page.kind === 'kit')?.span).toBe(5);
    expect(plan.pages.filter((page) => page.kind === 'faq').map((page) => [page.index, page.title])).toEqual([
      [0, 'Frequently asked questions'],
      [1, 'Frequently asked questions (2)'],
    ]);
    expect(plan.chapters.map((chapter) => [chapter.document.number, chapter.openerPage, chapter.first, chapter.last])).toEqual([
      ['01', 3, 4, 5],
      ['02', 6, 7, 11],
      ['03', 12, 13, 13],
      ['04', 14, 15, 16],
    ]);
    expect(plan.chapters[1].entries).toEqual([
      { title: 'Logo system', n: 7 },
      { title: 'Colour', n: 8 },
      { title: 'Typography', n: 9 },
      { title: 'Visual', n: 10 },
      { title: 'Voice in brief', n: 11 },
    ]);
    expect(plan.chapters[3].entries).toEqual([
      { title: 'Frequently asked questions', n: 15 },
      { title: 'Frequently asked questions (2)', n: 16 },
    ]);
    expect(plan.sourcesPage).toBe(17);
    expect(plan.faqPages).toEqual([{ groups: [0, 1] }, { groups: [2, 3] }]);
    expect(plan.pages.find((page) => page.kind === 'opener')?.section).toBe('01 Messaging framework');
    expect(plan.pages.find((page) => page.kind === 'back')?.n).toBe(plan.total);
  });

  it('drops a document with nothing to print, opener included, and the counts follow', () => {
    const plan = mktgFamilyPrintPlan([
      members()[0],
      { document: doc('boilerplates', 3), boilerplateCount: 0 },
      { document: doc('faq', 4), faqGroupSizes: [0] },
    ]);
    expect(plan.pages.map((page) => page.kind)).toEqual(['cover', 'contents', 'opener', 'framework', 'sources', 'back']);
    expect(plan.chapters).toHaveLength(1);
    expect(plan.total).toBe(7);
    expect(plan.sourcesPage).toBe(6);
  });

  it('counts a mounted inner print as one page when it names none, and a short FAQ as one page', () => {
    const plan = mktgFamilyPrintPlan([{ document: doc('brand-kit', 1, 4) }, { document: doc('faq', 2, 3), faqGroupSizes: [2, 2] }]);
    expect(plan.pages.map((page) => `${page.n}:${page.kind}`)).toEqual([
      '1:cover',
      '2:contents',
      '3:opener',
      '4:kit',
      '5:opener',
      '6:faq',
      '7:sources',
      '8:back',
    ]);
    expect(plan.chapters[0].entries).toEqual([{ title: 'Brand kit', n: 4 }]);
    expect(plan.chapters[0].last).toBe(4);
  });

  it('plans no Sources page and no chapters for a family with no printable member', () => {
    const plan = mktgFamilyPrintPlan([]);
    expect(plan.pages.map((page) => page.kind)).toEqual(['cover', 'contents', 'back']);
    expect(plan.sourcesPage).toBe(0);
    expect(plan.total).toBe(3);
  });
});

describe('mktgFamilyPrintOpenItems', () => {
  it('lists each chapter’s open items with its document, in chapter order', () => {
    const plan = mktgFamilyPrintPlan(members());
    expect(mktgFamilyPrintOpenItems(plan.chapters)).toEqual([
      { document: 'Messaging framework', text: 'Regulated industries: no answer yet' },
      { document: 'Brand kit', text: 'No stacked lockup among the logo files uploaded.' },
    ]);
  });
});

describe('mktgFamilyPrintConflicts', () => {
  it('names the brand line against the tagline only when both exist and differ, and a colour read with two values', () => {
    expect(mktgFamilyPrintConflicts('Open source for AI', 'Open source for AI', [])).toEqual([]);
    expect(mktgFamilyPrintConflicts('', 'Agents in the open', [])).toEqual([]);
    expect(mktgFamilyPrintConflicts('Open source for AI', 'Agents in the open', [])).toEqual([
      {
        topic: 'Brand line',
        text: 'The brand kit carries “Agents in the open”; the framework’s tagline is “Open source for AI”.',
        rerun: 'Re-run the brand kit so it reads the approved framework.',
      },
    ]);
    expect(
      mktgFamilyPrintConflicts('', '', [
        {
          name: 'Coral',
          values: [
            { hex: '#ff702d', source: 'brand page' },
            { hex: '#FF7D2D', source: 'site buttons' },
          ],
          chosen: '#ff702d',
        },
        { name: 'Ink', values: [{ hex: '#111111', source: 'brand page' }], chosen: '#111111' },
      ])
    ).toEqual([{ topic: 'Coral', text: 'brand page #FF702D; site buttons #FF7D2D. The kit keeps #FF702D.', rerun: '' }]);
  });
});
