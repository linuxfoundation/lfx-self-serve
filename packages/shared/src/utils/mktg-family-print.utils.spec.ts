// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_KIT_POSITIONING_FAMILY_ID } from '../constants/mktg-kit.constants';
import {
  MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES,
  MKTG_FAMILY_PRINT_CONTENTS_LAYOUT,
  MKTG_FAMILY_PRINT_COVER_STRIP_MEASURE,
  MKTG_FAMILY_PRINT_FAQ_LAYOUT,
  MKTG_FAMILY_PRINT_HEAD_CAPS,
  MKTG_FAMILY_PRINT_SOURCES_LAYOUT,
} from '../constants/mktg-family-print.constants';
import { MKTG_PORTRAIT_CAPS_TRACKING_EM, MKTG_PORTRAIT_COVER_STRIP, MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import type {
  MktgFamilyPrintConflict,
  MktgFamilyPrintDocument,
  MktgFamilyPrintFaqPage,
  MktgFamilyPrintFaqPlanGroup,
  MktgFamilyPrintPlanMember,
} from '../interfaces/mktg-family-print.interface';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import {
  mktgFamilyPrintBrand,
  mktgFamilyPrintBuiltFromLabel,
  mktgFamilyPrintConflicts,
  mktgFamilyPrintContentsChapterHeight,
  mktgFamilyPrintContentsEntryHeight,
  mktgFamilyPrintContentsLayout,
  mktgFamilyPrintCutFromEnd,
  mktgFamilyPrintCapsWidth,
  mktgFamilyPrintCoverStrip,
  mktgFamilyPrintCutNote,
  mktgFamilyPrintDate,
  mktgFamilyPrintDocument,
  mktgFamilyPrintFaqBalancedPages,
  mktgFamilyPrintFaqEntryHeight,
  mktgFamilyPrintFaqGroups,
  mktgFamilyPrintFaqPages,
  mktgFamilyPrintFaqSourceLabel,
  mktgFamilyPrintFill,
  mktgFamilyPrintFitBoilerplateCards,
  mktgFamilyPrintFitRows,
  mktgFamilyPrintFitRunBlock,
  mktgFamilyPrintFigure,
  mktgFamilyPrintHeadTight,
  mktgFamilyPrintMeasuredLines,
  mktgFamilyPrintNumberConflicts,
  mktgFamilyPrintOpenItemText,
  mktgFamilyPrintOneStop,
  mktgFamilyPrintOpenItems,
  mktgFamilyPrintPageRange,
  mktgFamilyPrintPlan,
  mktgFamilyPrintReadableSource,
  mktgFamilyPrintSourceLabel,
  mktgFamilyPrintSourcesLayout,
  mktgFamilyPrintVersionLabel,
} from './mktg-family-print.utils';
import { mktgPortraitFootLeft } from './mktg-portrait-plan.utils';
import { mktgPortraitCoverStrip, mktgPortraitParaHeight, mktgPortraitTextWidth } from './mktg-portrait-print.utils';
import { mktgPrintBrand } from './mktg-print.utils';

const approval = { approvedAt: '2026-11-06T18:26:00Z', approvedBy: { name: 'A. Reviewer' } };

/** The overfull fixture's 100-word boilerplate as far as the page printed it before the cut: four lines of Montserrat 12.5 px in the card. */
const overfullOpening =
  'The Example Toolkit is a neutral, production-grade toolkit for building internal platforms, hosted as a Linux Foundation project. It is audited in public twice a year, released every eight weeks and governed by its contributors rather than by any single vendor, so adopting it is a decision that outlasts any one supplier.';

function doc(agentKey: MktgFamilyPrintDocument['agentKey'], number: number, version = 1, openItems: string[] = []): MktgFamilyPrintDocument {
  return mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, agentKey, number, version, approval, openItems, '2026-10-28');
}

/** FAQ groups of one-line questions and answers, `sizes[g]` questions each. */
function faqGroups(sizes: number[], answer = 'One line answer that names the source it came from.'): MktgFamilyPrintFaqPlanGroup[] {
  return sizes.map((size, group) => ({
    name: `Group ${group + 1}`,
    questions: Array.from({ length: size }, (_, index) => ({
      path: `faq[${group}][1][${index}]`,
      question: `Question ${group}.${index} of the group?`,
      answer,
      source: 'website',
    })),
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

describe('mktgFamilyPrintFaqGroups', () => {
  it('reads the FAQ as the book prints it: the answered questions only, in order, with their paths, one index space for the plan and the page', () => {
    const printed = mktgFamilyPrintFaqGroups([
      {
        path: 'faq[0]',
        name: 'About',
        unanswered: 1,
        questions: [
          { path: 'faq[0][1][0]', question: 'Who runs it?', answer: '', source: '', answered: false },
          { path: 'faq[0][1][1]', question: 'What is it?', answer: 'A synthetic project.', source: 'Framework', answered: true },
        ],
      },
      { path: 'faq[1]', name: 'Open', unanswered: 1, questions: [{ path: 'faq[1][1][0]', question: 'When?', answer: '', source: '', answered: false }] },
    ]);
    expect(printed).toEqual([
      { name: 'About', questions: [{ path: 'faq[0][1][1]', question: 'What is it?', answer: 'A synthetic project.', source: 'Framework' }] },
      { name: 'Open', questions: [] },
    ]);
    // The plan's first item is the first ANSWERED question of About: the index the page resolves in the same list.
    const [page] = mktgFamilyPrintFaqPages(printed);
    expect(page.columns[0][0]).toEqual({ group: 0, question: 0, heading: true });
    expect(printed[page.columns[0][0].group].questions[page.columns[0][0].question].question).toBe('What is it?');
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

  it('deals the two columns by height, in order, a group split where its column ends with its heading repeated', () => {
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([2, 3, 3, 2])))).toEqual([
      [
        ['0.0H', '0.1', '1.0H', '1.1', '1.2'],
        ['2.0H', '2.1', '2.2', '3.0H', '3.1'],
      ],
    ]);
    // Twenty questions need two pages (the first is full at fourteen); once split, the pages and their columns are balanced.
    const groups = faqGroups([5, 5, 5, 5]);
    const pages = mktgFamilyPrintFaqPages(groups);
    expect(shape(pages)).toEqual([
      [
        ['0.0H', '0.1', '0.2', '0.3', '0.4'],
        ['1.0H', '1.1', '1.2', '1.3', '1.4'],
      ],
      [
        ['2.0H', '2.1', '2.2', '2.3', '2.4'],
        ['3.0H', '3.1', '3.2', '3.3', '3.4'],
      ],
    ]);
    for (const page of pages) for (const column of page.columns) expect(columnHeight(groups, column)).toBeLessThanOrEqual(budget);
    expect(pages.flatMap((page) => page.columns.flat())).toHaveLength(20);
  });

  it('opens a second page only when the first is full, then balances the pages and their columns by height: eight and one become five and four', () => {
    // Nine six-line answers in two groups, four to a column: the greedy fill leaves one on the second page; the deal gives 3/2 and 2/2.
    const groups = faqGroups([5, 4], 'A longer answer that runs on. '.repeat(10));
    const pages = mktgFamilyPrintFaqPages(groups);
    expect(shape(pages)).toEqual([
      [
        ['0.0H', '0.1', '0.2'],
        ['0.3H', '0.4'],
      ],
      [
        ['1.0H', '1.1'],
        ['1.2H', '1.3'],
      ],
    ]);
    const heights = pages.map((page) => page.columns.reduce((sum, column) => sum + columnHeight(groups, column), 0));
    expect(Math.abs(heights[0] - heights[1])).toBeLessThan(mktgFamilyPrintFaqEntryHeight(groups[0].questions[0], width) + MKTG_FAMILY_PRINT_FAQ_LAYOUT.heading);
    // Eight fill one page: no second page, no deal.
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([5, 3], 'A longer answer that runs on. '.repeat(10))))).toEqual([
      [
        ['0.0H', '0.1', '0.2', '0.3'],
        ['0.4H', '1.0H', '1.1', '1.2'],
      ],
    ]);
    // Every question once, in order, whatever the deal.
    const dealt = pages.flatMap((page) => page.columns.flat()).map((item) => `${item.group}.${item.question}`);
    expect(dealt).toEqual(groups.flatMap((group, g) => group.questions.map((_, q) => `${g}.${q}`)));
    expect(mktgFamilyPrintFaqBalancedPages(groups, 2)).toEqual(pages);
    expect(mktgFamilyPrintFaqBalancedPages([], 2)).toEqual([]);
  });

  it('keeps every balanced column within its budget and carries what a page cannot hold to the next, so nothing is cut', () => {
    // Mixed heights: long answers among short ones, forty questions.
    const groups = faqGroups([10, 10, 10, 10]).map((group, g) => ({
      ...group,
      questions: group.questions.map((entry, q) => ({ ...entry, answer: (g + q) % 3 === 0 ? 'A much longer answer. '.repeat(14) : entry.answer })),
    }));
    const pages = mktgFamilyPrintFaqPages(groups);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) for (const column of page.columns) expect(columnHeight(groups, column)).toBeLessThanOrEqual(budget);
    expect(pages.flatMap((page) => page.columns.flat()).map((item) => `${item.group}.${item.question}`)).toEqual(
      groups.flatMap((group, g) => group.questions.map((_, q) => `${g}.${q}`))
    );
    // Every column but the last holds something; a group split by a column repeats its heading.
    expect(
      pages
        .flatMap((page) => page.columns)
        .slice(0, -1)
        .every((column) => column.length > 0)
    ).toBe(true);
    for (const page of pages) for (const column of page.columns) if (column.length) expect(column[0].heading).toBe(true);
  });

  it('balances few questions across both columns of a single page, a group heading staying with its first question', () => {
    // The minimal fixture's four and the logo-less fixture's seven: never the left column alone.
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([4])))).toEqual([
      [
        ['0.0H', '0.1'],
        ['0.2H', '0.3'],
      ],
    ]);
    // Three and four: the second group's heading would sit at the left column's foot over its first question alone, the
    // group going on in the right; it moves on whole instead (the editor's F5: a heading keeps at least two questions).
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([3, 4])))).toEqual([
      [
        ['0.0H', '0.1', '0.2'],
        ['1.0H', '1.1', '1.2', '1.3'],
      ],
    ]);
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([2, 2])))).toEqual([
      [
        ['0.0H', '0.1'],
        ['1.0H', '1.1'],
      ],
    ]);
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([1])))).toEqual([[['0.0H'], []]]);
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([2])))).toEqual([[['0.0H'], ['0.1H']]]);
  });

  it('never leaves a group heading over one question at a column or page foot while the group goes on; a one-question group may close a column', () => {
    // Six long answers fill the left column at three; a group of two opening at its foot would stand there with one
    // question (its heading repeated over the other on the right): both go right.
    const long = 'A longer answer that runs on. '.repeat(10);
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([3, 2, 1], long)))).toEqual([
      [
        ['0.0H', '0.1', '0.2'],
        ['1.0H', '1.1', '2.0H'],
      ],
    ]);
    // Every column of every page: an entry that opens its group's heading is never the column's last while the group's
    // next question starts the next column or page.
    const groups = faqGroups([5, 4, 7, 2, 6, 3], long);
    const pages = mktgFamilyPrintFaqPages(groups);
    const columns = pages.flatMap((page) => page.columns).filter((column) => column.length);
    columns.forEach((column, index) => {
      const last = column[column.length - 1];
      const next = columns[index + 1]?.[0];
      const opens = column.length === 1 || column[column.length - 2].group !== last.group;
      if (next && next.group === last.group) expect({ column: index, opens }).toEqual({ column: index, opens: false });
    });
    expect(pages.flatMap((page) => page.columns.flat())).toHaveLength(27);
  });

  it('skips empty groups, prints no page with no questions, and sets an entry taller than a column alone', () => {
    // The third group's heading never closes the left column over one question: the group opens the right column whole.
    expect(shape(mktgFamilyPrintFaqPages(faqGroups([2, 0, 3])))).toEqual([
      [
        ['0.0H', '0.1'],
        ['2.0H', '2.1', '2.2'],
      ],
    ]);
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
  it('keeps the whole rows that fit a block, nothing added, and counts the rest behind one reserved line for the cut note', () => {
    const rows = Array.from({ length: 8 }, (_, index) => `Note ${index + 1}: a short line`);
    // 62 px holds three 17.05 px lines; with rows left over one line is kept for the note, so two rows print and six are counted.
    expect(mktgFamilyPrintFitRows(rows, (row) => row, 324, 11, 1.55, 0, 62)).toEqual({ rows: rows.slice(0, 2), cut: 6 });
    expect(mktgFamilyPrintFitRows(rows.slice(0, 3), (row) => row, 324, 11, 1.55, 0, 62)).toEqual({ rows: rows.slice(0, 3), cut: 0 });
    expect(mktgFamilyPrintFitRunBlock(rows, 340)).toEqual({ rows: rows.slice(0, 2), cut: 6 });
    expect(mktgFamilyPrintFitRunBlock(['x'.repeat(400), 'short'], 340)).toEqual({ rows: [], cut: 2 });
    expect(mktgFamilyPrintFitRunBlock([], 340)).toEqual({ rows: [], cut: 0 });
    // A label the run read twice (two URLs on one host) is one row; blanks are no rows.
    expect(mktgFamilyPrintFitRunBlock(['example.org', ' example.org ', '', 'press release'], 340)).toEqual({ rows: ['example.org', 'press release'], cut: 0 });
    expect(mktgFamilyPrintCutNote(0)).toBe('');
    expect(mktgFamilyPrintCutNote(6)).toBe('+6 more in LFX One');
  });

  it('prints a source as the board does: a URL by its label or host, no internal record id', () => {
    expect(mktgFamilyPrintSourceLabel('https://www.example.org/press/2025/launch (press release)')).toBe('press release');
    expect(mktgFamilyPrintSourceLabel('https://example.org/brand-guidelines')).toBe('example.org');
    expect(mktgFamilyPrintSourceLabel('LFX project record synthetic-project (uid d79df990-0000-4000-8000-000000000000)')).toBe(
      'LFX project record synthetic-project'
    );
    expect(mktgFamilyPrintSourceLabel('  The approved messaging framework (intake)  ')).toBe('The approved messaging framework (intake)');
  });

  it('prints a Built from row in plain words: label and host, host alone, the record without its slug, no run terms', () => {
    expect(mktgFamilyPrintBuiltFromLabel('https://www.example.org/press/2025/launch (launch press release, Dec. 9, 2025)')).toBe(
      'Launch press release, Dec. 9, 2025 (example.org)'
    );
    expect(mktgFamilyPrintBuiltFromLabel('https://example.org (home page)')).toBe('Home page (example.org)');
    expect(mktgFamilyPrintBuiltFromLabel('https://example.org/brand-guidelines')).toBe('example.org');
    expect(mktgFamilyPrintBuiltFromLabel('LFX project record synthetic-project (uid d79df990-0000-4000-8000-000000000000)')).toBe('LFX project record');
    expect(mktgFamilyPrintBuiltFromLabel('Approved messaging framework (intake)')).toBe('Approved messaging framework');
    expect(mktgFamilyPrintBuiltFromLabel('  the approved messaging framework  ')).toBe('The approved messaging framework');
    expect(mktgFamilyPrintBuiltFromLabel('')).toBe('');
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
    // Each block keeps one line of its type for the cut note when rows are left over, and counts them.
    expect(layout.conflicts).toEqual(conflicts.slice(0, 4));
    expect(layout.conflictsCut).toBe(2);
    expect(layout.openItems).toEqual(openItems.slice(0, 8));
    expect(layout.openCut).toBe(4);
    // A full conflicts block (less than one row free): the Still open block sits within a row of where the board draws it, never lower.
    const { openTop, conflict: conflictType } = MKTG_FAMILY_PRINT_SOURCES_LAYOUT;
    expect(layout.openTop).toBeLessThanOrEqual(openTop);
    expect(layout.openTop).toBeGreaterThan(openTop - conflictType.padding - conflictType.size * conflictType.line);
    // One short conflict: the Still open block follows it, the block gap under its row, and holds the rows the dead space held before.
    const tight = mktgFamilyPrintSourcesLayout([conflict], openItems);
    expect(tight.conflicts).toEqual([conflict]);
    expect(tight.openTop).toBeLessThan(MKTG_FAMILY_PRINT_SOURCES_LAYOUT.openTop - 100);
    expect(tight.openTop).toBeGreaterThan(
      MKTG_FAMILY_PRINT_SOURCES_LAYOUT.conflictsTop + MKTG_FAMILY_PRINT_SOURCES_LAYOUT.heading + MKTG_FAMILY_PRINT_SOURCES_LAYOUT.blockGap
    );
    expect(tight.openItems).toEqual(openItems);
    expect(tight.openCut).toBe(0);
    const alone = mktgFamilyPrintSourcesLayout([], openItems);
    expect(alone.conflicts).toEqual([]);
    expect(alone.openItems).toEqual(openItems);
    expect(alone.openCut).toBe(0);
    expect(alone.openTop).toBe(MKTG_FAMILY_PRINT_SOURCES_LAYOUT.conflictsTop);
    expect(mktgFamilyPrintSourcesLayout([], [])).toEqual({
      conflicts: [],
      conflictsCut: 0,
      openItems: [],
      openCut: 0,
      openTop: MKTG_FAMILY_PRINT_SOURCES_LAYOUT.conflictsTop,
    });
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
    // The board's running heads: every document's pages carry its numbered chapter from the contents order (the family's
    // own content pages print it; a mounted print's pages print their own heads, `Brand kit · Logo`), Contents and Sources
    // their name.
    expect(plan.pages.filter((page) => page.kind !== 'opener').map((page) => page.section)).toEqual([
      'Cover',
      'Contents',
      '01 Messaging framework',
      '02 Brand kit',
      '03 Boilerplates',
      '04 FAQ',
      '04 FAQ',
      'Sources',
      'Back cover',
    ]);
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
  it('lists each chapter’s open items with its document, in chapter order, an item a record states twice once', () => {
    const plan = mktgFamilyPrintPlan(members());
    expect(mktgFamilyPrintOpenItems(plan.chapters)).toEqual([
      { document: 'Messaging framework', text: 'Regulated industries: no answer yet' },
      { document: 'Brand kit', text: 'No stacked lockup among the logo files uploaded.' },
    ]);
    const twice = mktgFamilyPrintPlan([
      { document: doc('brand-kit', 1, 4, ['No stacked lockup.', 'No favicon.', 'No stacked lockup.']), innerPageTitles: ['Logo'] },
    ]);
    expect(mktgFamilyPrintOpenItems(twice.chapters).map((item) => item.text)).toEqual(['No stacked lockup.', 'No favicon.']);
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
        rerun: 'Re-run the brand kit so it reads the approved framework.',
      },
    ]);
    // A tagline that ends on its own full stop keeps one stop at the closing quote, never two (`them.”.`).
    expect(mktgFamilyPrintConflicts('Open foundations, governed by the people who build on them.', 'Agents in the open', [], 'Brand kit')[0].text).toBe(
      'The brand kit carries “Agents in the open”; the framework’s tagline is “Open foundations, governed by the people who build on them.”'
    );
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
        text: 'The brand kit reads Coral as #FF702D from the brand page and #FF7D2D from the site buttons; it keeps #FF702D.',
        // The colour row carries its action like the brand-line row does: the kit, once its sources agree.
        rerun: 'Re-run the brand kit once its sources agree on Coral.',
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
    expect(coral.text).toBe('The brand kit reads Coral as #FF702D from the brand page, #FF7D2D from the site stylesheet and #FF8A2D; it keeps #FF702D.');
    expect(coral.text).not.toMatch(/https?:|_/);
    expect(mktgFamilyPrintReadableSource('brand_page: https://aaif.io/brand')).toBe('brand page');
    expect(mktgFamilyPrintReadableSource('site_css: https://aaif.io/_next/static/chunks/x.css')).toBe('site stylesheet');
    expect(mktgFamilyPrintReadableSource('press_kit: https://aaif.io/press')).toBe('press kit');
    expect(mktgFamilyPrintReadableSource('https://aaif.io/brand')).toBe('aaif.io');
    expect(mktgFamilyPrintReadableSource('the press release')).toBe('the press release');
    expect(mktgFamilyPrintReadableSource('')).toBe('');
  });
});

describe('mktgFamilyPrintCutFromEnd', () => {
  it('drops the last sentence, a closing quote allowed, and a lone sentence its last word', () => {
    expect(mktgFamilyPrintCutFromEnd('One. Two! Three?')).toBe('One. Two!');
    expect(mktgFamilyPrintCutFromEnd('Said “one.” Then two. ')).toBe('Said “one.”');
    expect(mktgFamilyPrintCutFromEnd('Only one sentence here.')).toBe('Only one sentence');
    expect(mktgFamilyPrintCutFromEnd('Word')).toBe('');
    expect(mktgFamilyPrintCutFromEnd('Version 2.0 shipped. Done.')).toBe('Version 2.0 shipped.');
  });
});

describe('mktgFamilyPrintFitBoilerplateCards', () => {
  const sizes = MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES;
  const card = (text: string, index: number): { text: string; fontSize: number; minHeight: number } => ({ text, ...sizes[Math.min(index, sizes.length - 1)] });
  const sentence = 'The project builds open standards for confidential computing with its members.';

  it('prints the four texts whole when they fit the room, at the limits and over them', () => {
    const texts = [1, 2, 4, 8].map((count) => Array.from({ length: count }, () => sentence).join(' '));
    const fitted = mktgFamilyPrintFitBoilerplateCards(texts.map(card), MKTG_PORTRAIT_PAGE.contentWidth);
    expect(fitted).toEqual(texts.map((text) => ({ text, cutWords: 0 })));
  });

  it('cuts the tallest text from the end at a sentence, counts the words, and keeps every card', () => {
    const long = Array.from({ length: 40 }, () => sentence).join(' ');
    const texts = [sentence, sentence, sentence, long];
    const fitted = mktgFamilyPrintFitBoilerplateCards(texts.map(card), MKTG_PORTRAIT_PAGE.contentWidth);
    expect(fitted).toHaveLength(4);
    expect(fitted.slice(0, 3)).toEqual(texts.slice(0, 3).map((text) => ({ text, cutWords: 0 })));
    expect(fitted[3].text.endsWith('members.')).toBe(true);
    expect(fitted[3].text.length).toBeLessThan(long.length);
    expect(fitted[3].cutWords).toBeGreaterThan(0);
    expect(fitted[3].cutWords % 11).toBe(0);
    expect(long.startsWith(fitted[3].text)).toBe(true);
    // Only whole sentences went: the kept text is some of the same sentence.
    expect((fitted[3].text.match(/\./g) ?? []).length).toBe(40 - fitted[3].cutWords / 11);
  });

  it('shares the cuts among texts when two are long, and never drops a card', () => {
    const long = Array.from({ length: 25 }, () => sentence).join(' ');
    const fitted = mktgFamilyPrintFitBoilerplateCards([sentence, long, sentence, long].map(card), MKTG_PORTRAIT_PAGE.contentWidth);
    expect(fitted.map((entry) => entry.text.length > 0)).toEqual([true, true, true, true]);
    expect(fitted.filter((entry) => entry.cutWords > 0).length).toBeGreaterThanOrEqual(1);
  });

  it('prints a text whole when it fits its card in the book’s face, where the flat average would have cut it (the editor’s overfull p30)', () => {
    // The overfull fixture's four cards (11, 24, 56 and 124 words), set in Montserrat: the page rendered them in 2, 3, 5 and 10 lines,
    // 46 px short of the room, and the flat model (73 characters a line at 12.5 px) counted the long card two lines over and cut it.
    const texts = [
      'The Example Toolkit: the neutral, audited foundation platform teams build on.',
      'The Example Toolkit is a neutral, production-grade toolkit for building internal platforms, audited in public and governed by the contributors who build on it.',
      'The Example Toolkit is a neutral, production-grade toolkit for building internal platforms. It is audited in public twice a year, released every eight weeks and governed by its contributors rather than by any single vendor, so adopting it is a decision that outlasts any one supplier. Platform teams get a compliant toolchain they can stand behind.',
      `${overfullOpening} Its members fund the security audits, the release engineering and the events where the roadmap is decided in the open, so no single company sets its direction. Platform teams adopt it from an empty repository to a compliant platform in weeks, with the audits, the release cadence and the governance already in place, and they keep a say in where it goes next.`,
    ];
    const fitted = mktgFamilyPrintFitBoilerplateCards(texts.map(card), MKTG_PORTRAIT_PAGE.contentWidth, undefined, "'Montserrat', sans-serif");
    expect(fitted).toEqual(texts.map((text) => ({ text, cutWords: 0 })));
  });
});

describe('mktgFamilyPrintMeasuredLines', () => {
  it('counts the lines the page set, in the book’s face, where the flat average counts more', () => {
    // The 100-word card's first four lines as the overfull page broke them (Montserrat 12.5 px in the 504 px text column).
    const measure = MKTG_PORTRAIT_PAGE.contentWidth - 52 - 120 - 28;
    expect(mktgFamilyPrintMeasuredLines(overfullOpening, measure, 12.5, { family: 'Montserrat' })).toBe(4);
    expect(mktgPortraitParaHeight({ text: overfullOpening, size: 12.5, line: 1.5 }, measure) / (12.5 * 1.5)).toBeGreaterThan(4);
    // A wider face takes more lines of the same text; an empty text is one line; a hard break starts a line.
    expect(mktgFamilyPrintMeasuredLines(overfullOpening, measure, 12.5, { family: 'Source Sans 3' })).toBeLessThanOrEqual(4);
    expect(mktgFamilyPrintMeasuredLines(overfullOpening, measure, 16.5, { family: 'Montserrat' })).toBeGreaterThan(4);
    expect(mktgFamilyPrintMeasuredLines('', measure, 12.5)).toBe(1);
    expect(mktgFamilyPrintMeasuredLines('One.\nTwo.', measure, 12.5)).toBe(2);
  });
});

describe('mktgFamilyPrintCapsWidth', () => {
  it('measures a label’s capitals by the face’s capitals, at or a little above the real face and never under it', () => {
    // The e2e fixture's running head in Chromium (Google Fonts Montserrat 600 at 10 px, +0.12em, uppercase): the section
    // label 278.42 px, the document name 359.91 px (M9). The grammar's lowercase factor (1.14 × 1.07) called them 316 and
    // 408 and stepped a head that fits to 9 px; the head's capitals factors keep the measure within 2 % above the face.
    const montserrat = "'Montserrat', sans-serif";
    const section = mktgFamilyPrintCapsWidth('Messaging framework · Message house', montserrat);
    const name = mktgFamilyPrintCapsWidth('Synthetic Documents Project positioning & brand', montserrat);
    expect(section).toBeGreaterThanOrEqual(278.42);
    expect(section).toBeLessThan(278.42 * 1.02);
    expect(name).toBeGreaterThanOrEqual(359.91);
    expect(name).toBeLessThan(359.91 * 1.02);
    // Inter, the default face, the same labels: 265.58 and 346.86 px in Chromium.
    expect(mktgFamilyPrintCapsWidth('Messaging framework · Message house', 'Inter, sans-serif')).toBeGreaterThanOrEqual(265.58);
    expect(mktgFamilyPrintCapsWidth('Messaging framework · Message house', 'Inter, sans-serif')).toBeLessThan(265.58 * 1.03);
    expect(mktgFamilyPrintCapsWidth('Synthetic Documents Project positioning & brand', 'Inter, sans-serif')).toBeGreaterThanOrEqual(346.86);
    // A face the head has not measured keeps the grammar's measure, the wide side.
    const poppins = "'Poppins', sans-serif";
    expect(mktgFamilyPrintCapsWidth('Contents', poppins)).toBe(
      mktgPortraitTextWidth('Contents', 10, { caps: true, weight: 600, family: poppins, tracking: MKTG_PORTRAIT_CAPS_TRACKING_EM })
    );
    expect(mktgFamilyPrintCapsWidth('Contents', poppins)).toBeGreaterThan(mktgFamilyPrintCapsWidth('Contents', montserrat));
    expect(mktgFamilyPrintCapsWidth('', montserrat)).toBe(0);
  });

  it('reads another measure when given one: the cover strip’s size and tracking at the regular weight, without the semibold’s factor', () => {
    const montserrat = "'Montserrat', sans-serif";
    const strip = MKTG_FAMILY_PRINT_COVER_STRIP_MEASURE;
    const regular = mktgFamilyPrintCapsWidth('Synthetic Documents Project', montserrat, strip);
    // The same capitals at the head's semibold and wider tracking measure wider; at the strip's regular weight the semibold's factor is off.
    expect(regular).toBeLessThan(mktgFamilyPrintCapsWidth('Synthetic Documents Project', montserrat));
    expect(mktgFamilyPrintCapsWidth('Synthetic Documents Project', montserrat, { ...strip, weight: 600 })).toBeCloseTo(
      regular * MKTG_FAMILY_PRINT_HEAD_CAPS.weight,
      6
    );
    // A face the family has not measured reads the grammar's measure at that measure.
    const poppins = "'Poppins', sans-serif";
    expect(mktgFamilyPrintCapsWidth('Contents', poppins, strip)).toBe(
      mktgPortraitTextWidth('Contents', strip.size, { caps: true, weight: strip.weight, family: poppins, tracking: strip.tracking })
    );
  });
});

describe('mktgFamilyPrintCoverStrip', () => {
  const width = MKTG_PORTRAIT_PAGE.width - 2 * MKTG_PORTRAIT_PAGE.coverInset;
  const right = `one.example.org${MKTG_PORTRAIT_COVER_STRIP.separator}7 Nov 2026`;

  it('keeps the strip as written when the face’s capitals fit it, where the grammar’s lowercase measure would drop the LF suffix', () => {
    // The e2e fixture's cover in Montserrat (M10b): 630 px by the capitals in the 672 px inset, 675 by the grammar's measure, which
    // dropped "a Linux Foundation project" where it fits. The suffix stays; Inter and Instrument Sans fit it under both measures.
    const left = mktgPortraitFootLeft('Synthetic Documents Project');
    const montserrat = "'Montserrat', sans-serif";
    expect(mktgPortraitCoverStrip(left, right, width, montserrat).left).toBe('Synthetic Documents Project');
    expect(mktgFamilyPrintCoverStrip(left, right, width, montserrat)).toEqual({ left, right, wraps: false });
    expect(mktgFamilyPrintCoverStrip(left, right, width, "'Instrument Sans', sans-serif")).toEqual({ left, right, wraps: false });
    expect(mktgFamilyPrintCoverStrip(left, right, width, 'Inter, sans-serif')).toEqual({ left, right, wraps: false });
  });

  it('hands a strip the capitals do not fit to the grammar’s fit, unchanged: the long name drops the suffix, one word each still too wide wraps', () => {
    // The editor's p01 name is too wide with its suffix under the capitals too (706 px in Inter, 730 in Montserrat): the grammar's answer.
    const cncf = mktgPortraitFootLeft('Cloud Native Computing Foundation (CNCF)');
    const site = `synthetic.example${MKTG_PORTRAIT_COVER_STRIP.separator}7 Nov 2026`;
    for (const face of ["'Montserrat', sans-serif", 'Inter, sans-serif']) {
      expect(mktgFamilyPrintCoverStrip(cncf, site, width, face)).toEqual(mktgPortraitCoverStrip(cncf, site, width, face));
      expect(mktgFamilyPrintCoverStrip(cncf, site, width, face)).toEqual({ left: 'Cloud Native Computing Foundation (CNCF)', right: site, wraps: false });
    }
    const word = mktgPortraitFootLeft('Synthetic'.repeat(12));
    expect(mktgFamilyPrintCoverStrip(word, site, width, 'Inter, sans-serif')).toEqual({ left: word, right: site, wraps: true });
  });

  it('gives a face the family has not measured the grammar’s answer', () => {
    const left = mktgPortraitFootLeft('Synthetic Documents Project');
    const poppins = "'Poppins', sans-serif";
    expect(mktgFamilyPrintCoverStrip(left, right, width, poppins)).toEqual(mktgPortraitCoverStrip(left, right, width, poppins));
  });
});

describe('mktgFamilyPrintHeadTight', () => {
  // The labels a family book mounts on the left (Inter, the default face): its own pages' and the inner prints'
  // `Document · Section`, the framework's message house the widest of them.
  const sections = [
    'Contents',
    'Messaging framework · Framework',
    'Messaging framework · Message house',
    'Brand kit · Logo',
    'Brand kit · Color',
    '03 Boilerplates',
    '04 FAQ',
    'Sources',
  ];
  const face = 'Inter, sans-serif';

  it('keeps the label’s size while the longest section, the gap and the document name fit the content width', () => {
    expect(mktgFamilyPrintHeadTight(sections, 'Agentic AI Foundation positioning & brand', face)).toBe(false);
    expect(mktgFamilyPrintHeadTight(sections, 'Synthetic project positioning & brand', face)).toBe(false);
    // No section label at all: the name alone, measured against the whole width.
    expect(mktgFamilyPrintHeadTight([], 'Agentic AI Foundation positioning & brand', face)).toBe(false);
  });

  it('steps the head down when the measured line runs over, by the measure and not by a count of characters', () => {
    expect(mktgFamilyPrintHeadTight(sections, 'Cloud Native Computing Foundation (CNCF) positioning & brand', face)).toBe(true);
    // The e2e's synthetic project, 47 characters, fits by the measure where the old count of 44 stepped it down.
    expect(mktgFamilyPrintHeadTight(sections, 'Synthetic Documents Project positioning & brand', face)).toBe(false);
    // The same name fits beside shorter sections; a wider face makes a fitting name overflow.
    expect(mktgFamilyPrintHeadTight(['04 FAQ'], 'Cloud Native Computing Foundation (CNCF) positioning & brand', face)).toBe(false);
    expect(mktgFamilyPrintHeadTight(sections, 'Cloud Native Computing Foundation (CNCF) positioning & brand', 'Montserrat, sans-serif')).toBe(true);
  });

  it('keeps the label’s size for the e2e fixture’s head in its own face, Montserrat, as the face sets it', () => {
    // The fixture's kit face: in Chromium the widest section label sets 278.42 px and the document name 359.91 px at the
    // label's size (600, +0.12em, capitals), 662.33 px with the gap in the 704 px: the head fits at 10 px (M9). The
    // lowercase factor measured them 316 and 408 and stepped the book down to 9 px.
    const montserrat = "'Montserrat', sans-serif";
    expect(mktgFamilyPrintHeadTight(sections, 'Synthetic Documents Project positioning & brand', montserrat)).toBe(false);
    // The long-name case the e2e pins steps down in the same face: 790.91 px for the name alone in Chromium.
    expect(
      mktgFamilyPrintHeadTight(sections, 'The Open Foundation for Cloud Native Computing, Edge and Confidential Infrastructure positioning & brand', montserrat)
    ).toBe(true);
  });
});

describe('mktgFamilyPrintOneStop', () => {
  it('drops the sentence’s stop after a quote that ends on its own, and keeps it after one that does not', () => {
    expect(mktgFamilyPrintOneStop('The tagline is “Build on them.”.')).toBe('The tagline is “Build on them.”');
    expect(mktgFamilyPrintOneStop('The tagline is “Why not?”. Next.')).toBe('The tagline is “Why not?” Next.');
    expect(mktgFamilyPrintOneStop('The tagline is “Open source for AI”.')).toBe('The tagline is “Open source for AI”.');
    expect(mktgFamilyPrintOneStop('Version 2.0.')).toBe('Version 2.0.');
  });
});

describe('mktgFamilyPrintFigure', () => {
  it('reads a key number whole, with its magnitude, and refuses what it cannot interpret', () => {
    expect(['299', '7,181', '10,000+', '1.2M', '2bn', '3 thousand', 'over 300', '$10,000', '12%', '1.2M a day', 'many'].map(mktgFamilyPrintFigure)).toEqual([
      299,
      7181,
      10000,
      1200000,
      2000000000,
      3000,
      300,
      null,
      null,
      null,
      null,
    ]);
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
        text: 'The framework’s key numbers say 7,181 code contributors, last 12 months; the boilerplates says “A community of 299 member organizations, 7,100 code contributors and more than 10,000 published MCP servers.”',
        rerun: 'Re-run the boilerplates so it reads the approved framework.',
      },
    ]);
  });

  it('reports no conflict for a price, a year, a rounded figure, a part of the measure, a sentence that states the framework’s figure, a word that only starts with the measure, or a figure elsewhere', () => {
    const sentences = [
      // The dev project's FAQ sentences the first reading mistook for conflicts.
      'Platinum membership is $350000 per year and Gold membership is $200000 per year. Silver membership runs from $5000 to $75000 per year depending on company size.',
      'More than 10,000 published MCP servers at launch, with clients such as VS Code and ChatGPT.',
      'AAIF has 299 member organizations, holding 8 Platinum, 50 Gold, 188 Silver and 53 Associate memberships.',
      'Membership costs $5,000.',
      'Founded in 2023 with 20 members.',
      'Over 7,000 code contributors in the last 12 months.',
      'The 2026 report counts member organizations by tier.',
      // The second reading's false positives: a figure with words between it and the measure counts a part of it,
      // a trailing `+` is a rounded figure, and a sentence that also states the framework's figure agrees with it.
      '18 new member organizations joined this year.',
      'The foundation counts 7,000+ code contributors.',
      'AAIF grew to 299 member organizations, up from 150 member organizations at launch.',
      'Some 300 member organizations take part.',
      'In 2024 member organizations met twice.',
    ];
    expect(mktgFamilyPrintNumberConflicts(numbers, [{ title: 'FAQ', texts: sentences }])).toEqual([]);
    // No figure or no measure in the key number: no row.
    expect(
      mktgFamilyPrintNumberConflicts(
        [
          { number: 'many', label: 'members' },
          { number: '12', label: 'over' },
        ],
        [{ title: 'FAQ', texts: ['308 members. 12 over.'] }]
      )
    ).toEqual([]);
    // A figure's magnitude is read on both sides: `1.2M` downloads and `1,200,000 downloads` agree; `1.5 million
    // downloads` is another count. A key number the reader cannot interpret whole is skipped, not compared.
    const downloads = [{ number: '1.2M', label: 'Downloads' }];
    expect(
      mktgFamilyPrintNumberConflicts(downloads, [{ title: 'FAQ', texts: ['The project has 1,200,000 downloads.', 'Some 1.3M downloads a year.'] }])
    ).toEqual([]);
    expect(mktgFamilyPrintNumberConflicts(downloads, [{ title: 'FAQ', texts: ['It counts 1.5 million downloads.'] }])).toMatchObject([
      { text: 'The framework’s key numbers say 1.2M downloads; the FAQ says “It counts 1.5 million downloads.”' },
    ]);
    expect(mktgFamilyPrintNumberConflicts([{ number: '1.2M a day', label: 'Downloads' }], [{ title: 'FAQ', texts: ['It counts 900 downloads.'] }])).toEqual([]);
    // A short word in the label is part of the measure (`MCP servers at launch`), not a stop word.
    expect(
      mktgFamilyPrintNumberConflicts(
        [{ number: '10,000+', label: 'Published MCP servers at launch' }],
        [{ title: 'FAQ', texts: ['There were 9,500 published MCP servers at launch.'] }]
      )
    ).toHaveLength(1);
  });
});

describe('mktgFamilyPrintContentsLayout', () => {
  const width = (MKTG_PORTRAIT_PAGE.contentWidth - MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.columnGap) / 2;
  const room = MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.bottom - MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.top;

  /** The dev project's four chapters with `framework` and `kit` inner pages of the titles given. */
  function chaptersOf(framework: string[], kit: string[]) {
    return mktgFamilyPrintPlan([
      { document: doc('foundation-message', 1), innerPageTitles: framework },
      { document: doc('brand-kit', 2, 4), innerPageTitles: kit },
      { document: doc('boilerplates', 3, 2), boilerplateCount: 4 },
      { document: doc('faq', 4, 16), faqGroups: faqGroups([5, 4]) },
    ]).chapters;
  }

  /** A column's height as the page draws it: each block's row, its entries and the cut note's line when it has one. */
  function height(blocks: ReturnType<typeof mktgFamilyPrintContentsLayout>['columns'][number]): number {
    const note = MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.entry.padding + MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.entry.size * MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.entry.line;
    return blocks.reduce(
      (sum, block) =>
        sum +
        mktgFamilyPrintContentsChapterHeight(block.chapter, width) +
        block.entries.reduce((entries, entry) => entries + mktgFamilyPrintContentsEntryHeight(entry, width), 0) +
        (block.cut ? note : 0),
      0
    );
  }

  const describeBlocks = (layout: ReturnType<typeof mktgFamilyPrintContentsLayout>) =>
    layout.columns.map((blocks) => blocks.map((block) => `${block.chapter.document.number}${block.continued ? '+' : ''}:${block.entries.length}`));

  it('keeps the board\u2019s split for a book the page holds: the first two chapters in the first column, whole, nothing continued or cut', () => {
    // The mock's book: 12 framework pages, 14 kit pages, the boilerplates, two FAQ pages.
    const framework = [
      'Framework',
      'Goal 1 · Events',
      'Goal 2 · Adoption',
      'Goal 3 · Community',
      'Goal 4 · Membership',
      'Say and avoid · anchor questions',
      'Ideal customer profiles',
      'Ideal customer profiles (2)',
      'Ideal customer profiles (3)',
      'Message house',
      'Key numbers',
      'Sources & gaps',
    ];
    const kit = [
      'Logo system',
      'Colorways',
      'Clear space & minimum size',
      'Symbol & symbol in shape',
      'Partnership lockup',
      'Watchouts',
      'Color palette',
      'Color contrast',
      'Typography',
      'Iconography',
      'Imagery & graphic elements',
      'Example usage',
      'Voice in brief',
      'Sources & decisions',
    ];
    const chapters = chaptersOf(framework, kit);
    const layout = mktgFamilyPrintContentsLayout(chapters);
    expect(describeBlocks(layout)).toEqual([
      ['01:12', '02:14'],
      [`03:${chapters[2].entries.length}`, `04:${chapters[3].entries.length}`],
    ]);
    expect(layout.cut).toBe(0);
    expect(height(layout.columns[0])).toBeLessThanOrEqual(room);
    expect(height(layout.columns[1])).toBeLessThanOrEqual(room - MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.tail);
    // Every entry of every chapter is on the page, in order, once.
    expect(layout.columns.flat().flatMap((block) => block.entries.map((entry) => entry.n))).toEqual(
      chapters.flatMap((chapter) => chapter.entries.map((entry) => entry.n))
    );
  });

  it('continues a chapter the first column cannot finish under a repeated row at the top of the second, by measured height', () => {
    // Eight goals and ten ICPs: 22 framework entries, then the kit's 14; the first column holds the framework and the kit's first rows.
    const framework = [
      'Framework',
      ...Array.from({ length: 8 }, (_, index) => `Goal ${index + 1} · A goal title long enough to wrap onto a second line in the column`),
      'Say and avoid · anchor questions',
      ...Array.from({ length: 10 }, (_, index) => `Ideal customer profiles${index ? ` (${index + 1})` : ''}`),
      'Message house',
      'Key numbers',
      'Sources & gaps',
    ];
    const kit = Array.from({ length: 14 }, (_, index) => `Kit page ${index + 1}`);
    const layout = mktgFamilyPrintContentsLayout(chaptersOf(framework, kit));
    const [first, second] = layout.columns;
    expect(first.map((block) => block.chapter.document.number)).toEqual(['01', '02']);
    expect(first[1].continued).toBe(false);
    expect(first[1].entries.length).toBeGreaterThan(0);
    expect(first[1].entries.length).toBeLessThan(14);
    expect(second[0]).toMatchObject({ continued: true, cut: 0 });
    expect(second[0].chapter.document.number).toBe('02');
    expect(first[1].entries.length + second[0].entries.length).toBe(14);
    expect(second.slice(1).map((block) => block.chapter.document.number)).toEqual(['03', '04']);
    expect(layout.cut).toBe(0);
    expect(height(first)).toBeLessThanOrEqual(room);
    expect(height(second)).toBeLessThanOrEqual(room - MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.tail);
  });

  it('never clips: when the entries exceed the page, the last block keeps one line for the cut note and counts every entry it stands for', () => {
    const framework = Array.from({ length: 40 }, (_, index) => `Framework page ${index + 1}`);
    const kit = Array.from({ length: 40 }, (_, index) => `Kit page ${index + 1}`);
    const chapters = chaptersOf(framework, kit);
    const layout = mktgFamilyPrintContentsLayout(chapters);
    const shown = layout.columns.flat().reduce((count, block) => count + block.entries.length, 0);
    const total = chapters.reduce((count, chapter) => count + chapter.entries.length, 0);
    expect(layout.cut).toBeGreaterThan(0);
    expect(shown + layout.cut).toBe(total);
    const blocks = layout.columns.flat();
    expect(blocks[blocks.length - 1].cut).toBe(layout.cut);
    expect(blocks.slice(0, -1).every((block) => block.cut === 0)).toBe(true);
    expect(mktgFamilyPrintCutNote(layout.cut)).toBe(`+${layout.cut} more in LFX One`);
    expect(height(layout.columns[0])).toBeLessThanOrEqual(room);
    expect(height(layout.columns[1])).toBeLessThanOrEqual(room - MKTG_FAMILY_PRINT_CONTENTS_LAYOUT.tail);
  });

  it('lays an empty book out as two empty columns', () => {
    expect(mktgFamilyPrintContentsLayout([])).toEqual({ columns: [[], []], cut: 0 });
  });
});

describe('mktgFamilyPrintFaqSourceLabel', () => {
  it('prints a stored source as its chip, none for the run\u2019s internal Notes label, and measures the entry without the chip\u2019s line then', () => {
    expect(mktgFamilyPrintFaqSourceLabel('Framework')).toBe('Framework');
    expect(mktgFamilyPrintFaqSourceLabel(' website ')).toBe('website');
    expect(mktgFamilyPrintFaqSourceLabel('Notes')).toBe('');
    expect(mktgFamilyPrintFaqSourceLabel('notes')).toBe('');
    expect(mktgFamilyPrintFaqSourceLabel('')).toBe('');
    const width = (MKTG_PORTRAIT_PAGE.contentWidth - MKTG_FAMILY_PRINT_FAQ_LAYOUT.columnGap) / 2;
    const entry = faqGroups([1])[0].questions[0];
    const withChip = mktgFamilyPrintFaqEntryHeight(entry, width);
    expect(mktgFamilyPrintFaqEntryHeight({ ...entry, source: 'Notes' }, width)).toBe(withChip - MKTG_FAMILY_PRINT_FAQ_LAYOUT.source);
    expect(mktgFamilyPrintFaqEntryHeight({ ...entry, source: '' }, width)).toBe(withChip - MKTG_FAMILY_PRINT_FAQ_LAYOUT.source);
  });
});

describe('mktgFamilyPrintBrand', () => {
  const kit = brandKitTestRevision();
  const book = buildBrandKitBookView(kit, 4);
  const brand = mktgPrintBrand(kit);
  const reversedFile = { ref: 'r.svg', name: 'r.svg', src: 'data:image/svg+xml,reversed' };

  it('draws the kit\u2019s multi-colour primary, which no filter reverses, on the white plate, named by the brand\u2019s alt', () => {
    expect(brand.logoOnDark?.filter).toBe('');
    expect(mktgFamilyPrintBrand(brand, book).logoOnDark).toEqual({ src: book.logos.primary?.src, alt: brand.logoOnDark?.alt, filter: '', plate: true });
  });

  it('draws the supplied reversed file as it is, with no plate', () => {
    const withReversed = { ...book, logos: { ...book.logos, reversed: reversedFile } };
    expect(mktgFamilyPrintBrand(brand, withReversed).logoOnDark).toEqual({ src: reversedFile.src, alt: brand.logoOnDark?.alt, filter: '' });
  });

  it('reverses a one-ink primary by filter, with no plate', () => {
    const mono = { ...book, derivable: { lockup: true, symbol: false } };
    expect(mktgFamilyPrintBrand(brand, mono).logoOnDark).toEqual({
      src: book.logos.primary?.src,
      alt: brand.logoOnDark?.alt,
      filter: 'brightness(0) invert(1)',
    });
  });

  it('keeps the brand as built without a kit book (the Linux Foundation\u2019s), or when the brand draws no logo on the dark', () => {
    const lfBrand = mktgPrintBrand(null);
    expect(mktgFamilyPrintBrand(lfBrand, null)).toBe(lfBrand);
    const logoless = { ...brand, logoOnDark: null };
    expect(mktgFamilyPrintBrand(logoless, book)).toBe(logoless);
  });
});
