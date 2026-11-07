// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_KIT_POSITIONING_FAMILY_ID } from '../constants/mktg-kit.constants';
import { MKTG_FAMILY_PRINT_FAQ_LAYOUT, MKTG_FAMILY_PRINT_SOURCES_LAYOUT } from '../constants/mktg-family-print.constants';
import { MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import type {
  MktgFamilyPrintConflict,
  MktgFamilyPrintDocument,
  MktgFamilyPrintFaqPage,
  MktgFamilyPrintFaqPlanGroup,
  MktgFamilyPrintPlanMember,
} from '../interfaces/mktg-family-print.interface';
import {
  mktgFamilyPrintConflicts,
  mktgFamilyPrintDate,
  mktgFamilyPrintDocument,
  mktgFamilyPrintFaqEntryHeight,
  mktgFamilyPrintFaqPages,
  mktgFamilyPrintFill,
  mktgFamilyPrintFitRows,
  mktgFamilyPrintFitRunBlock,
  mktgFamilyPrintNumberConflicts,
  mktgFamilyPrintOpenItemText,
  mktgFamilyPrintOpenItems,
  mktgFamilyPrintPageRange,
  mktgFamilyPrintPlan,
  mktgFamilyPrintReadableSource,
  mktgFamilyPrintSourceLabel,
  mktgFamilyPrintSourcesLayout,
  mktgFamilyPrintVersionLabel,
} from './mktg-family-print.utils';

const approval = { approvedAt: '2026-11-06T18:26:00Z', approvedBy: { name: 'A. Reviewer' } };

function doc(agentKey: MktgFamilyPrintDocument['agentKey'], number: number, version = 1, openItems: string[] = []): MktgFamilyPrintDocument {
  return mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, agentKey, number, version, approval, openItems, '2026-10-28');
}

/** FAQ groups of one-line questions and answers, `sizes[g]` questions each. */
function faqGroups(sizes: number[], answer = 'One line answer that names the source it came from.'): MktgFamilyPrintFaqPlanGroup[] {
  return sizes.map((size, group) => ({
    name: `Group ${group + 1}`,
    questions: Array.from({ length: size }, (_, index) => ({ question: `Question ${group}.${index} of the group?`, answer, source: 'website' })),
  }));
}

/** `0.1H`: group.question, H when the entry opens its group in its column. */
function shape(pages: MktgFamilyPrintFaqPage[]): string[][][] {
  return pages.map((page) => page.columns.map((column) => column.map((item) => `${item.group}.${item.question}${item.heading ? 'H' : ''}`)));
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
    { document: doc('faq', 4, 16), faqGroups: faqGroups([5, 5, 5, 5]) },
  ];
}

describe('mktgFamilyPrintDocument', () => {
  it('names the chapter from the family asset, in one version format, with the approval as printed', () => {
    const document = doc('brand-kit', 2, 4, [' No stacked lockup. ', '']);
    expect(document).toEqual({
      agentKey: 'brand-kit',
      number: '02',
      title: 'Brand kit',
      summary: 'The logo and its rules, color and contrast, type, iconography and imagery, example usage, and the voice in brief.',
      versionLabel: 'V4.0',
      approvedLabel: '6 Nov 2026',
      dataLabel: 'figures as of 28 Oct 2026',
      openItems: ['No stacked lockup.'],
    });
  });

  it('omits what the store does not give: no version, no approval date, no data date', () => {
    const document = mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 4, null, { approvedAt: 'not a date', approvedBy: null }, []);
    expect(document.versionLabel).toBe('');
    expect(document.approvedLabel).toBe('');
    expect(document.dataLabel).toBe('');
    expect(mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 4, 16, null, []).approvedLabel).toBe('');
  });
});

describe('the small helpers', () => {
  it('labels versions, formats dates in UTC and ranges pages', () => {
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
  const width = (MKTG_PORTRAIT_PAGE.contentWidth - MKTG_FAMILY_PRINT_FAQ_LAYOUT.columnGap) / 2;
  const budget = MKTG_FAMILY_PRINT_FAQ_LAYOUT.bottom - MKTG_FAMILY_PRINT_FAQ_LAYOUT.top;

  function columnHeight(groups: MktgFamilyPrintFaqPlanGroup[], column: MktgFamilyPrintFaqPage['columns'][number]): number {
    return column.reduce(
      (height, item) =>
        height + (item.heading ? MKTG_FAMILY_PRINT_FAQ_LAYOUT.heading : 0) + mktgFamilyPrintFaqEntryHeight(groups[item.group].questions[item.question], width),
      0
    );
  }

  it('fills the two columns by height, in order, a group split where its column ends with its heading repeated', () => {
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([2, 3, 3, 2])))).toEqual([
      [
        ['0.0H', '0.1', '1.0H', '1.1', '1.2', '2.0H'],
        ['2.1H', '2.2', '3.0H', '3.1'],
      ],
    ]);
    const groups = faqGroups([5, 5, 5, 5]);
    const pages = mktgFamilyPrintFaqPages(groups);
    expect(shape(pages)).toEqual([
      [
        ['0.0H', '0.1', '0.2', '0.3', '0.4', '1.0H'],
        ['1.1H', '1.2', '1.3', '1.4', '2.0H', '2.1'],
      ],
      [
        ['2.2H', '2.3', '2.4', '3.0H', '3.1', '3.2'],
        ['3.3H', '3.4'],
      ],
    ]);
    for (const page of pages) for (const column of page.columns) expect(columnHeight(groups, column)).toBeLessThanOrEqual(budget);
    expect(pages.flatMap((page) => page.columns.flat())).toHaveLength(20);
  });

  it('skips empty groups, prints no page with no questions, and sets an entry taller than a column alone', () => {
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([2, 0, 3])))).toEqual([[['0.0H', '0.1', '2.0H', '2.1', '2.2'], []]]);
    expect(mktgFamilyPrintFaqPages(faqGroups([0, 0]))).toEqual([]);
    expect(mktgFamilyPrintFaqPages([])).toEqual([]);
    const tall = faqGroups([3], 'A long answer. '.repeat(400));
    expect(mktgFamilyPrintFaqEntryHeight(tall[0].questions[0], width)).toBeGreaterThan(budget);
    expect(shape(mktgFamilyPrintFaqPages(tall))).toEqual([
      [['0.0H'], ['0.1H']],
      [['0.2H'], []],
    ]);
  });
});

describe('the fixed blocks', () => {
  it('keeps the whole rows that fit a block, nothing added', () => {
    const rows = Array.from({ length: 8 }, (_, index) => `Note ${index + 1}: a short line`);
    expect(mktgFamilyPrintFitRows(rows, (row) => row, 324, 11, 1.55, 0, 62)).toEqual(rows.slice(0, 3));
    expect(mktgFamilyPrintFitRunBlock(rows, 340)).toEqual(rows.slice(0, 3));
    expect(mktgFamilyPrintFitRunBlock(['x'.repeat(400), 'short'], 340)).toEqual([]);
    expect(mktgFamilyPrintFitRunBlock([], 340)).toEqual([]);
  });

  it('prints a source as the board does: a URL by its label or host, no internal record id', () => {
    expect(mktgFamilyPrintSourceLabel('https://www.example.org/press/2025/launch (press release)')).toBe('press release');
    expect(mktgFamilyPrintSourceLabel('https://example.org/brand-guidelines')).toBe('example.org');
    expect(mktgFamilyPrintSourceLabel('LFX project record synthetic-project (uid d79df990-0000-4000-8000-000000000000)')).toBe(
      'LFX project record synthetic-project'
    );
    expect(mktgFamilyPrintSourceLabel('  The approved messaging framework (intake)  ')).toBe('The approved messaging framework (intake)');
  });

  it('fits the Sources page’s lists to their blocks: whole rows, the open list under the conflicts or in their place', () => {
    const conflict: MktgFamilyPrintConflict = {
      id: 'Members · FAQ',
      topic: 'Members',
      text: 'The framework’s key numbers say 299 members; the FAQ says “The foundation has 308 member organizations.”',
      rerun: 'Re-run the FAQ so it reads the approved framework.',
    };
    const conflicts = Array.from({ length: 6 }, (_, index) => ({ ...conflict, id: `Members · ${index}` }));
    const openItems = Array.from({ length: 12 }, (_, index) => ({
      document: index % 2 ? 'Messaging framework' : 'FAQ',
      text: `Open item ${index + 1} that the run left open for the team to check.`,
    }));
    const layout = mktgFamilyPrintSourcesLayout(conflicts, openItems);
    expect(layout.conflicts).toEqual(conflicts.slice(0, 5));
    expect(layout.openItems).toEqual(openItems.slice(0, 9));
    expect(layout.openTop).toBe(MKTG_FAMILY_PRINT_SOURCES_LAYOUT.openTop);
    const alone = mktgFamilyPrintSourcesLayout([], openItems);
    expect(alone.conflicts).toEqual([]);
    expect(alone.openItems).toEqual(openItems);
    expect(alone.openTop).toBe(MKTG_FAMILY_PRINT_SOURCES_LAYOUT.conflictsTop);
    expect(mktgFamilyPrintSourcesLayout([], [])).toEqual({ conflicts: [], openItems: [], openTop: MKTG_FAMILY_PRINT_SOURCES_LAYOUT.conflictsTop });
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
    expect(plan.faqPages).toHaveLength(2);
    expect(plan.faqPages[0].columns[0][0]).toEqual({ group: 0, question: 0, heading: true });
    expect(plan.pages.find((page) => page.kind === 'opener')?.section).toBe('01 Messaging framework');
    // The pages are the portrait grammar's plan pages, by id, so the inner documents' plans concatenate in.
    expect(plan.pages.map((page) => page.id)).toEqual([
      'cover',
      'contents',
      'opener-foundation-message',
      'framework',
      'opener-brand-kit',
      'kit',
      'opener-boilerplates',
      'boilerplates',
      'opener-faq',
      'faq-1',
      'faq-2',
      'sources',
      'back-cover',
    ]);
    expect(plan.pages.find((page) => page.kind === 'back')?.n).toBe(plan.total);
  });

  it('drops a document with nothing to print, opener included, and the counts follow', () => {
    const plan = mktgFamilyPrintPlan([
      members()[0],
      { document: doc('boilerplates', 3), boilerplateCount: 0 },
      { document: doc('faq', 4), faqGroups: faqGroups([0]) },
    ]);
    expect(plan.pages.map((page) => page.kind)).toEqual(['cover', 'contents', 'opener', 'framework', 'sources', 'back']);
    expect(plan.chapters).toHaveLength(1);
    expect(plan.total).toBe(7);
    expect(plan.sourcesPage).toBe(6);
  });

  it('counts a mounted inner print as one page when it names none, and a short FAQ as one page', () => {
    const plan = mktgFamilyPrintPlan([
      { document: doc('brand-kit', 1, 4, ['No stacked lockup.']) },
      { document: doc('faq', 2, 3), faqGroups: faqGroups([2, 2]) },
    ]);
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

  it('prints the Sources page only when a conflict or an open item gives it something to check', () => {
    const quiet = [{ document: doc('boilerplates', 1, 2), boilerplateCount: 4 }];
    expect(mktgFamilyPrintPlan(quiet).pages.map((page) => page.kind)).toEqual(['cover', 'contents', 'opener', 'boilerplates', 'back']);
    expect(mktgFamilyPrintPlan(quiet).sourcesPage).toBe(0);
    expect(mktgFamilyPrintPlan(quiet, 1).sourcesPage).toBe(5);
    expect(mktgFamilyPrintPlan([{ document: doc('boilerplates', 1, 2, ['A gap.']), boilerplateCount: 4 }]).sourcesPage).toBe(5);
  });
});

describe('mktgFamilyPrintOpenItemText', () => {
  it('drops a hashed file name from an open item and keeps the sentence around it', () => {
    expect(
      mktgFamilyPrintOpenItemText(
        "The site's header links a logo image (16dd7d8270b673d376cadca831ab3d5ea003bb89-838x203.svg) that was not read in this run, so the kit shows placeholder marks."
      )
    ).toBe("The site's header links a logo image that was not read in this run, so the kit shows placeholder marks.");
    expect(mktgFamilyPrintOpenItemText('Missing 16dd7d8270b673d376cadca831ab3d5ea003bb89.png .')).toBe('Missing.');
    expect(mktgFamilyPrintOpenItemText('  No stacked logo was uploaded.  ')).toBe('No stacked logo was uploaded.');
    expect(mktgFamilyPrintOpenItemText('(16dd7d8270b673d376cadca831ab3d5ea003bb89.svg)')).toBe('');
    // A chapter's open items go through it: an item left with no words is dropped.
    expect(doc('brand-kit', 1, 4, ['(16dd7d8270b673d376cadca831ab3d5ea003bb89.svg)', 'No symbol was uploaded.']).openItems).toEqual([
      'No symbol was uploaded.',
    ]);
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
    expect(mktgFamilyPrintConflicts('Open source for AI', 'Open source for AI', [], 'Brand kit')).toEqual([]);
    expect(mktgFamilyPrintConflicts('', 'Agents in the open', [], 'Brand kit')).toEqual([]);
    expect(mktgFamilyPrintConflicts('Open source for AI', 'Agents in the open', [], 'Brand kit')).toEqual([
      {
        id: 'Brand line · Brand kit',
        topic: 'Brand line',
        text: 'The brand kit carries “Agents in the open”; the framework’s tagline is “Open source for AI”.',
        rerun: 'Re-run the Brand kit so it reads the approved framework.',
      },
    ]);
    expect(
      mktgFamilyPrintConflicts(
        '',
        '',
        [
          {
            name: 'Coral',
            values: [
              { hex: '#ff702d', source: 'brand page' },
              { hex: '#FF7D2D', source: 'site buttons' },
            ],
            chosen: '#ff702d',
          },
          { name: 'Ink', values: [{ hex: '#111111', source: 'brand page' }], chosen: '#111111' },
        ],
        'Brand kit'
      )
    ).toEqual([
      {
        id: 'Coral · Brand kit',
        topic: 'Coral',
        text: 'The Brand kit reads Coral as #FF702D from the brand page and #FF7D2D from the site buttons; it keeps #FF702D.',
        rerun: '',
      },
    ]);
  });

  it('names where the kit read a colour in words, never a field name or a URL (the dev kit’s own record)', () => {
    const [coral] = mktgFamilyPrintConflicts(
      '',
      '',
      [
        {
          name: 'Coral',
          values: [
            { hex: '#FF702D', source: 'brand_page: https://aaif.io/brand' },
            { hex: '#FF7D2D', source: 'site_css: https://aaif.io/_next/static/chunks/3tg274q-9atqx.css' },
            { hex: '#FF8A2D', source: '' },
          ],
          chosen: '#FF702D',
        },
      ],
      'Brand kit'
    );
    expect(coral.text).toBe('The Brand kit reads Coral as #FF702D from the brand page, #FF7D2D from the site css and #FF8A2D; it keeps #FF702D.');
    expect(coral.text).not.toMatch(/https?:|_/);
    expect(mktgFamilyPrintReadableSource('brand_page: https://aaif.io/brand')).toBe('brand page');
    expect(mktgFamilyPrintReadableSource('https://aaif.io/brand')).toBe('aaif.io');
    expect(mktgFamilyPrintReadableSource('the press release')).toBe('the press release');
    expect(mktgFamilyPrintReadableSource('')).toBe('');
  });
});

describe('mktgFamilyPrintNumberConflicts', () => {
  const numbers = [
    { number: '299', label: 'Member organizations' },
    { number: '7,181', label: 'Code contributors, last 12 months' },
    { number: '10,000+', label: 'Published MCP servers at launch' },
    { number: '$10,000', label: 'Silver membership' },
    { number: '2023', label: 'Founded' },
  ];

  it('names another count of the same measure, one row per key number and document, with the document to re-run', () => {
    expect(
      mktgFamilyPrintNumberConflicts(numbers, [
        { title: 'FAQ', texts: ['AAIF has 308 member organizations today. It was founded in 2023.'] },
        { title: 'Boilerplates', texts: ['A community of 299 member organizations, 7,100 code contributors and more than 10,000 published MCP servers.'] },
      ])
    ).toEqual([
      {
        id: 'Member organizations · FAQ',
        topic: 'Member organizations',
        text: 'The framework’s key numbers say 299 member organizations; the FAQ says “AAIF has 308 member organizations today.”',
        rerun: 'Re-run the FAQ so it reads the approved framework.',
      },
      {
        id: 'Code contributors, last 12 months · Boilerplates',
        topic: 'Code contributors, last 12 months',
        text: 'The framework’s key numbers say 7,181 code contributors, last 12 months; the Boilerplates says “A community of 299 member organizations, 7,100 code contributors and more than 10,000 published MCP servers.”',
        rerun: 'Re-run the Boilerplates so it reads the approved framework.',
      },
    ]);
  });

  it('reports no conflict for a price, a year, a rounded figure, a word that only starts with the measure, or a figure elsewhere in the sentence', () => {
    const sentences = [
      // The dev project's FAQ sentences the first reading mistook for conflicts.
      'Platinum membership is $350000 per year and Gold membership is $200000 per year. Silver membership runs from $5000 to $75000 per year depending on company size.',
      'More than 10,000 published MCP servers at launch, with clients such as VS Code and ChatGPT.',
      'AAIF has 299 member organizations, holding 8 Platinum, 50 Gold, 188 Silver and 53 Associate memberships.',
      'Membership costs $5,000.',
      'Founded in 2023 with 20 members.',
      'Over 7,000 code contributors in the last 12 months.',
      'The 2026 report counts member organizations by tier.',
    ];
    expect(mktgFamilyPrintNumberConflicts(numbers, [{ title: 'FAQ', texts: sentences }])).toEqual([]);
    // No figure or no measure in the key number: no row.
    expect(
      mktgFamilyPrintNumberConflicts(
        [
          { number: 'many', label: 'members' },
          { number: '12', label: 'of' },
        ],
        [{ title: 'FAQ', texts: ['308 members.'] }]
      )
    ).toEqual([]);
  });
});
