// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The family PDF's own pages: the family's grammar (parts, numbers, cover,
// dividers, running heads), the appendix paginated from the data by the
// shell's measure, and the page plan. The measure and the fit are the shell's
// (mktg-print-fit.utils.spec.ts).

import { describe, expect, it } from 'vitest';

import { MKTG_FAMILY_EXPORT_VERSION_LABELS } from '../constants/mktg-family-export.constants';
import { FOUNDATION_MESSAGE_PRINT_TITLE, MKTG_FAQ_PRINT_UNANSWERED } from '../constants/mktg-print.constants';
import { BOILERPLATES_INTAKE, BRAND_KIT_INTAKE, FAQ_INTAKE } from '../constants/mktg-run.constants';
import {
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_CAPS_TRACKING_EM,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LINE,
  MKTG_PRINT_PAGE_LOGO_FRAME,
  MKTG_PRINT_PAGE_MIN_SCALE,
  MKTG_PRINT_PAGE_SIZE,
} from '../constants/mktg-print-page.constants';
import {
  MKTG_PRINT_APPENDIX_LAYOUT,
  MKTG_PRINT_DIVIDER_LAYOUT,
  MKTG_PRINT_SECTION_TITLES,
  MKTG_PRINT_SOURCE_LEAD,
} from '../constants/mktg-print-pages.constants';
import type { BoilerplatesLengthRow } from '../interfaces/boilerplates.interface';
import type { FaqGroupView } from '../interfaces/faq.interface';
import type { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import type { MktgFamilyPrintView } from '../interfaces/mktg-family-export.interface';
import type { FoundationMessagePrintView } from '../interfaces/mktg-print.interface';
import type { MktgPrintPara, MktgPrintPageShapeEl } from '../interfaces/mktg-print-page.interface';
import type { MktgPrintCardRow, MktgPrintFaqEntry } from '../interfaces/mktg-print-pages.interface';
import boilerplatesEnvelope from './__fixtures__/boilerplates.envelope.json';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import faqEnvelope from './__fixtures__/faq-envelope.json';
import { boilerplatesAssetOfRevision } from './boilerplates.utils';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import { faqAssetOfRevision } from './faq.utils';
import { mktgPrintCharEm, mktgPrintCharsPerLine, mktgPrintRichHeight, mktgPrintScaleRich, mktgPrintWrapLines } from './mktg-print-fit.utils';
import { mktgPrintContinued, mktgPrintMixHex, mktgPrintPageLook, mktgPrintPara } from './mktg-print-page.utils';
import {
  mktgBoilerplatesPageCount,
  mktgFaqPageCount,
  mktgPrintCardHead,
  mktgPrintDivider,
  mktgPrintDividerPage,
  mktgPrintFamilyCover,
  mktgPrintFamilyPartNumbers,
  mktgPrintFamilyParts,
  mktgPrintFamilyPlan,
  mktgPrintFaqQuestionCount,
  mktgPrintPageChrome,
  paginateBoilerplateCards,
  paginateFaqPairs,
} from './mktg-print-pages.utils';
import { buildBoilerplatesPrintView, buildFaqPrintView, buildFoundationMessagePrintView, mktgPrintBrand } from './mktg-print.utils';

const layout = MKTG_PRINT_APPENDIX_LAYOUT;
const area = MKTG_PRINT_PAGE_AREA;

function fixtureLengths(): BoilerplatesLengthRow[] {
  const asset = boilerplatesAssetOfRevision(JSON.stringify(boilerplatesEnvelope.content), boilerplatesEnvelope);
  if (!asset) throw new Error('Invalid synthetic boilerplates');
  return buildBoilerplatesPrintView(asset, mktgPrintBrand(null)).lengths;
}

function fixtureGroups(): FaqGroupView[] {
  const asset = faqAssetOfRevision(JSON.stringify(faqEnvelope.content), faqEnvelope);
  if (!asset) throw new Error('Invalid synthetic FAQ');
  return buildFaqPrintView(asset, mktgPrintBrand(null)).groups;
}

/** A synthetic length row of `words` words. */
function lengthRow(index: number, label: string, words: number, max: number): BoilerplatesLengthRow {
  const text = Array.from({ length: words }, (_, i) => (i % 9 === 8 ? 'project.' : 'Synthetic')).join(' ');
  return { index, label, hint: '', text, words, max, over: words > max, countLabel: `${words} / ${max} words` };
}

/** The height a column of text takes, by the shell's measure, its insets taken off. */
function textHeight(paras: MktgPrintPara[], width: number): number {
  return mktgPrintRichHeight({ paras, color: '', font: null }, width + 2 * MKTG_PRINT_PAGE_INSET) - 2 * MKTG_PRINT_PAGE_INSET;
}

/** A type size at a share of itself, as the shell rounds it. */
function scaledSize(size: number, scale: number): number {
  return mktgPrintScaleRich({ paras: [mktgPrintPara('', size)], color: '', font: null }, scale).paras[0].size;
}

/** One line of text at `size`: what a page keeps free under its rows. */
function lineOf(size: number): number {
  return size * MKTG_PRINT_PAGE_LINE;
}

/** The height a row of cards takes on the page, from the measure the pagination uses: the card's text column inside its border and padding, the tracked head wrapping as in a narrower column. */
function cardRowHeight(row: MktgPrintCardRow): number {
  const inner = (area.w - layout.cardColumnGap) / 2 - 2 * layout.cardPaddingX - 2 * layout.cardBorder;
  const capsEm = mktgPrintCharEm({ caps: true });
  const headInner = (inner * capsEm) / (capsEm - MKTG_PRINT_PAGE_CAPS_TRACKING_EM + layout.cardLabelTracking);
  return Math.max(
    ...row.cards.map((card) =>
      Math.max(
        layout.cardMinHeight,
        2 * layout.cardPaddingY +
          2 * layout.cardBorder +
          textHeight([{ text: card.head, size: MKTG_PRINT_PAGE_SIZE.eyebrow, weight: 600, caps: true }], headInner) +
          textHeight([{ text: card.text, size: card.size, above: layout.cardBodyGap }], inner)
      )
    )
  );
}

/** The width of a grid column: a text box of the deck's (327 pt on the page area), its insets inside. */
const faqColumnWidth = Math.floor((area.w - layout.faqColumnGap) / 2);

/** The height a FAQ entry's text takes in its column (the box's height less its insets), from the deck's measure (a plain answer, the source line when one). */
function faqEntryHeight(entry: MktgPrintFaqEntry): number {
  return (
    mktgPrintRichHeight(
      {
        paras: [
          { text: entry.question, size: entry.questionSize, weight: layout.faqQuestionWeight },
          { text: entry.answered ? entry.answer : MKTG_FAQ_PRINT_UNANSWERED, size: entry.answerSize, above: entry.answerGap },
          ...(entry.source ? [{ text: `${MKTG_PRINT_SOURCE_LEAD} · ${entry.source}`, size: entry.sourceSize, above: entry.sourceGap }] : []),
        ],
        color: '',
        font: null,
      },
      faqColumnWidth
    ) -
    2 * MKTG_PRINT_PAGE_INSET
  );
}

/** A framework print built by its builder from a synthetic content with the brand line and tagline given. */
function frameworkView(line: string, tagline: string): FoundationMessagePrintView {
  const content: FoundationMessageContent = {
    mf: {
      vision: 'A vision.',
      mission: 'A mission.',
      positioning: 'For platform teams.',
      tagline,
      goals: [{ id: 'adoption', n: 1, t: 'Adoption', vp: 'VP.', key: 'Key.', proof: [['1,200 members', 'Website']], bite: 'In the open', icps: ['users'] }],
      crosscut: 'Every column grows the audience.',
      say: ['open'],
      avoid: [['synergy', 'working together']],
      anchor: ['Which goal does this serve?'],
      notes: '',
    },
    icp: [
      {
        id: 'users',
        name: 'End users',
        kind: 'Individual',
        who: 'Engineers.',
        goals: ['adoption'],
        need: 'Need.',
        value: 'Value.',
        lead: 'Ship with confidence.',
        proof: [['A fact', 'Docs']],
        cta: 'Try it.',
        channels: ['Docs'],
        objection: ['Too early?', null],
        personas: [['SRE', 'uptime']],
        basis: 'Website',
      },
    ],
    mh: { umbrella: 'Umbrella.', line, pillars: [{ t: 'Open', m: 'Open message.', p: [['Fact', 'Web']] }], found: 'A Linux Foundation project.', aud: [] },
    nums: [['1,200', 'members']],
  };
  return buildFoundationMessagePrintView(content, 'Synthetic Mesh', 3, null);
}

function printView(overrides: Partial<MktgFamilyPrintView> = {}): MktgFamilyPrintView {
  const brand = mktgPrintBrand(null);
  return {
    framework: null,
    kit: null,
    boilerplates: { brand, lengths: [] },
    faq: { brand, groups: [] },
    brand,
    projectName: 'Synthetic Mesh',
    printedAt: '2026-11-06T00:00:00Z',
    newestRevisionAt: '2026-10-21T10:00:00Z',
    revisionNumbers: { boilerplates: 2, faq: 1 },
    fontFamily: null,
    weights: [400],
    ...overrides,
  };
}

describe("the family's grammar", () => {
  it('lists the parts present in the deck order, renumbered when one is missing', () => {
    expect(mktgPrintFamilyParts(printView())).toEqual(['boilerplates', 'faq']);
    expect(mktgPrintFamilyPartNumbers(printView())).toEqual({ boilerplates: '01', faq: '02' });
  });

  it('says a content page running head and a divider as the deck does', () => {
    expect(mktgPrintPageChrome('Acme Mesh', 'Positioning & brand', '03', 'Boilerplates')).toEqual({
      eyebrowLeft: '03 Boilerplates',
      eyebrowRight: 'Acme Mesh Positioning & brand',
      footerLine: 'Acme Mesh · a Linux Foundation project',
    });
    expect(mktgPrintDivider('boilerplates', '03', 4, 'Positioning & brand')).toEqual({
      eyebrow: '03 · POSITIONING & BRAND',
      title: 'Boilerplates',
      countLine: '4 boilerplates',
    });
    expect(mktgPrintDivider('faq', '04', 1, 'Positioning & brand').countLine).toBe('1 question and answer');
    expect(mktgPrintDivider('faq', '04', 12, 'Positioning & brand').countLine).toBe('12 questions and answers');
    expect(mktgPrintFaqQuestionCount(fixtureGroups())).toBe(4);
  });

  it('models a divider as a dark cover page: the eyebrow in the accent, the title and the softened count line in the on-dark ink, the lockup in the logo frame', () => {
    const look = mktgPrintPageLook({ ...mktgPrintBrand(null), dark: '#0F172A', accent: '#2563EB' });
    const divider = mktgPrintDivider('boilerplates', '03', 4, 'Positioning & brand');
    const page = mktgPrintDividerPage(look, divider, { src: 'data:image/svg+xml,logo', alt: 'Synthetic', filter: '' });
    expect(page.layout).toBe('cover');
    expect(page.title).toBe('');
    expect(page.head).toBeUndefined();
    expect(page.footer).toBeUndefined();
    const [eyebrow, title, count] = page.els as MktgPrintPageShapeEl[];
    expect(eyebrow.box).toEqual(MKTG_PRINT_DIVIDER_LAYOUT.eyebrow);
    expect(eyebrow.text?.paras[0]).toEqual(expect.objectContaining({ text: '03 · POSITIONING & BRAND', caps: true, color: '#2563EB' }));
    expect(title.box).toEqual(MKTG_PRINT_DIVIDER_LAYOUT.title);
    expect(title.text?.paras[0]).toEqual(expect.objectContaining({ text: 'Boilerplates', size: 30, weight: 600 }));
    expect(title.text?.color).toBe(look.onDark);
    expect(count.text?.paras[0]).toEqual(expect.objectContaining({ text: '4 boilerplates', size: 11 }));
    expect(count.text?.color).toBe(mktgPrintMixHex(look.onDark, look.dark, 0.3));
    expect(page.els[3]).toEqual({ t: 'image', box: MKTG_PRINT_PAGE_LOGO_FRAME, src: 'data:image/svg+xml,logo', alt: 'Synthetic', filter: '' });
    expect(mktgPrintDividerPage(look, divider, null).els).toHaveLength(3);
  });

  it("sets the divider's eyebrow in the on-dark ink when the accent does not read 3:1 on the dark", () => {
    const eyebrowColor = (dark: string, accent: string) => {
      const look = mktgPrintPageLook({ ...mktgPrintBrand(null), dark, accent });
      const [eyebrow] = mktgPrintDividerPage(look, mktgPrintDivider('faq', '04', 2, 'Positioning & brand'), null).els as MktgPrintPageShapeEl[];
      return { color: eyebrow.text?.paras[0].color, look };
    };
    const coral = eyebrowColor('#000000', '#FF702D');
    expect(coral.color).toBe('#FF702D');
    const close = eyebrowColor('#003B5C', '#005EB8');
    expect(close.color).toBe(close.look.onDark);
    expect(close.color).not.toBe('#005EB8');
  });

  it('says the family cover: the eyebrow in capitals, the newest revision month, the parts as the subtitle and the versions line', () => {
    const cover = mktgPrintFamilyCover(printView(), 'Positioning & brand');
    expect(cover).toEqual({
      eyebrow: 'SYNTHETIC MESH · A LINUX FOUNDATION PROJECT',
      date: 'October 2026',
      title: 'Positioning & brand',
      subtitle: 'Boilerplates · Questions and answers',
      footerLeft: 'Synthetic Mesh · a Linux Foundation project',
      footerRight: 'Boilerplates v2 · FAQ v1',
    });
  });

  it("prefers the brand line, falls back to the print date, and says the versions line in the spec's names, the kit's in its own form", () => {
    const framework = frameworkView(' Open mesh for everyone ', 'Tagline');
    const kit = buildBrandKitBookView(brandKitTestRevision(), 1);
    const cover = mktgPrintFamilyCover(
      printView({ framework, kit, newestRevisionAt: null, revisionNumbers: { 'foundation-message': 3, 'brand-kit': 1, boilerplates: 2 } }),
      'Positioning & brand'
    );
    expect(cover.subtitle).toBe('Open mesh for everyone');
    expect(cover.date).toBe('November 2026');
    expect(cover.footerRight).toBe('Messaging Framework v3 · Brand Kit V1.0 · Boilerplates v2');
    // The names are the catalog's documents (the framework's its print title, the spec's casing), so D1 §4's line is theirs.
    expect(MKTG_FAMILY_EXPORT_VERSION_LABELS).toEqual({
      'foundation-message': FOUNDATION_MESSAGE_PRINT_TITLE,
      'brand-kit': BRAND_KIT_INTAKE.documentName,
      boilerplates: BOILERPLATES_INTAKE.documentName,
      faq: FAQ_INTAKE.documentName,
    });
    expect(Object.values(MKTG_FAMILY_EXPORT_VERSION_LABELS)).toEqual(['Messaging Framework', 'Brand Kit', 'Boilerplates', 'FAQ']);
    expect(mktgPrintFamilyCover(printView({ framework: frameworkView('', 'Tagline') }), 'Positioning & brand').subtitle).toBe('Tagline');
  });
});

describe('paginateBoilerplateCards', () => {
  it('gives one page with no rows for no lengths, so the page keeps its title and proportions', () => {
    expect(paginateBoilerplateCards([])).toEqual([{ title: MKTG_PRINT_SECTION_TITLES.boilerplates, rows: [] }]);
    expect(mktgBoilerplatesPageCount([])).toBe(1);
  });

  it('puts one short card on one page at the card size, headed by its label and word count', () => {
    const pages = paginateBoilerplateCards([lengthRow(0, 'One-liner', 10, 12)]);
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe('Boilerplates');
    expect(pages[0].rows).toHaveLength(1);
    expect(pages[0].rows[0].scale).toBe(1);
    expect(pages[0].rows[0].height).toBe(layout.cardMinHeight);
    expect(pages[0].rows[0].cards).toEqual([expect.objectContaining({ index: 0, head: 'ONE-LINER · 10 WORDS', size: MKTG_PRINT_PAGE_SIZE.card, cut: false })]);
  });

  it('lays the fixture out two cards to a row in contract order at one size, the head carrying the agent count', () => {
    const lengths = fixtureLengths();
    const pages = paginateBoilerplateCards(lengths);
    expect(pages).toHaveLength(1);
    expect(pages[0].rows.map((row) => row.cards.map((card) => card.index))).toEqual([
      [0, 1],
      [2, 3],
    ]);
    const cards = pages[0].rows.flatMap((row) => row.cards);
    cards.forEach((card, index) => {
      expect(card.head).toBe(mktgPrintCardHead(lengths[index]));
      expect(card.head).toBe(`${lengths[index].label.toUpperCase()} · ${lengths[index].words} WORDS`);
      expect(card.text).toBe(lengths[index].text);
      expect(card.cut).toBe(false);
      expect(card.size).toBe(MKTG_PRINT_PAGE_SIZE.card);
    });
    const miscounted = { ...lengths[0], words: 99 };
    expect(mktgPrintCardHead(miscounted)).toBe(`${lengths[0].label.toUpperCase()} · 99 WORDS`);
  });

  it('spreads twelve long cards over several pages, one body line kept free on each, titled in sequence', () => {
    const lengths = Array.from({ length: 12 }, (_, i) => lengthRow(i, `Length ${i + 1}`, 90, 100));
    const pages = paginateBoilerplateCards(lengths);
    expect(pages).toHaveLength(6);
    expect(mktgBoilerplatesPageCount(lengths)).toBe(pages.length);
    expect(pages.map((page) => page.title)).toEqual(pages.map((_, i) => (i === 0 ? 'Boilerplates' : `Boilerplates (${i + 1})`)));
    expect(pages.flatMap((page) => page.rows.flatMap((row) => row.cards)).map((card) => card.index)).toEqual(lengths.map((row) => row.index));
    pages.forEach((page) => {
      expect(page.rows.length).toBeGreaterThan(0);
      page.rows.forEach((row) => {
        expect(row.cards.length).toBeLessThanOrEqual(2);
        expect(row.height).toBeCloseTo(cardRowHeight(row), 6);
      });
      const height = page.rows.reduce((h, row) => h + row.height, 0) + (page.rows.length - 1) * layout.cardRowGap;
      expect(height).toBeLessThanOrEqual(area.h - lineOf(MKTG_PRINT_PAGE_SIZE.card) + 0.01);
    });
  });

  it('brings the row before down to join a short lone last card', () => {
    const lengths = [...Array.from({ length: 4 }, (_, i) => lengthRow(i, `Length ${i + 1}`, 40, 50)), lengthRow(4, 'Tail', 8, 12)];
    const pages = paginateBoilerplateCards(lengths);
    expect(pages.map((page) => page.rows.map((row) => row.cards.map((card) => card.index)))).toEqual([[[0, 1]], [[2, 3], [4]]]);
  });

  it('fits a boilerplate too long for a row of its own: the row set smaller, then cut at a sentence, never past the frame', () => {
    const pages = paginateBoilerplateCards([lengthRow(0, 'Essay', 900, 1000)]);
    expect(pages).toHaveLength(1);
    const [row] = pages[0].rows;
    const [card] = row.cards;
    expect(row.scale).toBe(layout.cardRowMinScale);
    expect(card.cut).toBe(true);
    expect(card.size).toBeLessThan(MKTG_PRINT_PAGE_SIZE.card);
    expect(card.text.endsWith('.') || card.text.endsWith('…')).toBe(true);
    expect(card.text.length).toBeLessThan(lengthRow(0, 'Essay', 900, 1000).text.length);
    expect(row.height).toBeLessThanOrEqual(area.h - lineOf(MKTG_PRINT_PAGE_SIZE.card) + 0.01);
  });
});

describe('paginateFaqPairs', () => {
  it('gives one page with no rows for no questions, so the page keeps its title and proportions', () => {
    expect(paginateFaqPairs([])).toEqual([{ title: MKTG_PRINT_SECTION_TITLES.faq, scale: 1, rows: [] }]);
    expect(paginateFaqPairs([{ name: 'Empty', path: 'faq[0]', questions: [], unanswered: 0 }])[0].rows).toEqual([]);
    expect(mktgFaqPageCount([])).toBe(1);
  });

  it('flows the fixture row by row in group order at full size, and marks the unanswered one', () => {
    const pages = paginateFaqPairs(fixtureGroups());
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe('Questions and answers');
    expect(pages[0].scale).toBe(1);
    expect(pages[0].rows.map((row) => row.entries.map((entry) => entry.path))).toEqual([
      ['faq[0][1][0]', 'faq[0][1][1]'],
      ['faq[0][1][2]', 'faq[1][1][0]'],
    ]);
    const [first, , third] = pages[0].rows.flatMap((row) => row.entries);
    expect(first).toEqual(
      expect.objectContaining({
        question: 'What is Example Search?',
        answer: 'Example Search is an open source search and analytics suite.',
        answered: true,
        source: 'Website',
        questionSize: layout.faqQuestionSize,
        answerSize: layout.faqAnswerSize,
        sourceSize: MKTG_PRINT_PAGE_SIZE.eyebrow,
        answerGap: layout.faqAnswerGap,
        listItemGap: layout.faqListItemGap,
        sourceGap: layout.faqSourceGap,
        cut: false,
      })
    );
    expect(third).toEqual(expect.objectContaining({ question: 'How much does membership cost?', answer: '', answered: false, source: '', cut: false }));
  });

  it('wraps a column as the deck wraps its text box: 327 pt wide, the text inside the insets, a bullet line 18 pt in, the height without the insets', () => {
    expect(faqColumnWidth).toBe(327);
    const long = Array.from({ length: 200 }, () => 'word').join(' ');
    const [page] = paginateFaqPairs([
      {
        name: 'Wrap',
        path: 'faq[0]',
        questions: [
          { path: 'faq[0][1][0]', question: 'Plain?', answer: long, source: '', answered: true },
          { path: 'faq[0][1][1]', question: 'Bullet?', answer: `- ${long}`, source: '', answered: true },
        ],
        unanswered: 0,
      },
    ]);
    const [plain, bullet] = page.rows[0].entries;
    const size = layout.faqAnswerSize;
    const lines = (p: { bullet?: boolean }) => mktgPrintWrapLines(long, mktgPrintCharsPerLine(faqColumnWidth, size, p));
    expect(mktgPrintCharsPerLine(faqColumnWidth, size)).toBe(Math.floor((327 - 2 * MKTG_PRINT_PAGE_INSET) / (size * mktgPrintCharEm({}))));
    expect(mktgPrintCharsPerLine(faqColumnWidth, size, { bullet: true })).toBe(
      Math.floor((327 - 2 * MKTG_PRINT_PAGE_INSET - 18) / (size * mktgPrintCharEm({})))
    );
    expect(lines({ bullet: true })).toBeGreaterThanOrEqual(lines({}));
    const question = layout.faqQuestionSize * MKTG_PRINT_PAGE_LINE;
    expect(faqEntryHeight(plain)).toBeCloseTo(question + layout.faqAnswerGap + lines({}) * size * MKTG_PRINT_PAGE_LINE, 6);
    expect(faqEntryHeight(bullet)).toBeCloseTo(question + layout.faqAnswerGap + lines({ bullet: true }) * size * MKTG_PRINT_PAGE_LINE, 6);
    expect(page.rows[0].height).toBeCloseTo(faqEntryHeight(bullet), 6);
  });

  it("reads the deck's list markers ('-', '*', '•', '1.', '1)'), hands the renderer every item as a bullet as the deck draws them, and measures the paragraphs with the deck's gaps", () => {
    const answer = 'Lead-in:\n• One\n* Two\n- Three\n1) First\n2. Second\n\n+ Not a marker\n\nClosing line.';
    const [page] = paginateFaqPairs([
      { name: 'Lists', path: 'faq[0]', questions: [{ path: 'faq[0][1][0]', question: 'Which steps?', answer, source: '', answered: true }], unanswered: 0 },
    ]);
    const [entry] = page.rows[0].entries;
    expect(entry.answer).toBe('Lead-in:\n\n- One\n- Two\n- Three\n- First\n- Second\n\n+ Not a marker\n\nClosing line.');
    expect(entry.cut).toBe(false);
    const size = layout.faqAnswerSize;
    const item = (text: string, above: number) => mktgPrintPara(text, size, { bullet: true, above });
    const paras: MktgPrintPara[] = [
      mktgPrintPara('Which steps?', layout.faqQuestionSize, { weight: layout.faqQuestionWeight }),
      mktgPrintPara('Lead-in:', size, { above: layout.faqAnswerGap }),
      item('One', size * layout.faqBulletAfterPlainEm),
      item('Two', layout.faqListItemGap),
      item('Three', layout.faqListItemGap),
      item('First', layout.faqListItemGap),
      item('Second', layout.faqListItemGap),
      mktgPrintPara('+ Not a marker', size, { above: size * layout.faqPlainAfterBulletEm }),
      mktgPrintPara('Closing line.', size, { above: 0 }),
    ];
    expect(layout.faqListItemGap).toBe(2);
    expect(page.rows[0].height).toBeCloseTo(mktgPrintRichHeight({ paras, color: '', font: null }, faqColumnWidth) - 2 * MKTG_PRINT_PAGE_INSET, 6);
  });

  it('fills a page at 100, 95 or 90 % before continuing on a numbered page, one answer line kept free', () => {
    const questions = Array.from({ length: 40 }, (_, q) => ({
      path: `faq[0][1][${q}]`,
      question: `Question number ${q + 1} of the synthetic set?`,
      answer: Array.from({ length: 30 }, () => 'Answer').join(' ') + '.',
      source: 'Docs',
      answered: true,
    }));
    const pages = paginateFaqPairs([{ name: 'Many', path: 'faq[0]', questions, unanswered: 0 }]);
    expect(pages.length).toBeGreaterThan(1);
    expect(mktgFaqPageCount([{ name: 'Many', path: 'faq[0]', questions, unanswered: 0 }])).toBe(pages.length);
    expect(pages.map((page) => page.title)).toEqual(pages.map((_, i) => mktgPrintContinued('Questions and answers', i)));
    expect(pages.flatMap((page) => page.rows.flatMap((row) => row.entries)).map((entry) => entry.path)).toEqual(questions.map((row) => row.path));
    pages.forEach((page) => {
      expect(layout.faqPageScales).toContain(page.scale);
      expect(page.rows.length).toBeGreaterThan(0);
      page.rows.forEach((row) => {
        expect(row.entries.length).toBeLessThanOrEqual(2);
        expect(row.height).toBeCloseTo(Math.max(...row.entries.map((entry) => faqEntryHeight(entry))), 6);
      });
      const height = page.rows.reduce((h, row) => h + row.height, 0) + (page.rows.length - 1) * layout.faqRowGap;
      expect(height).toBeLessThanOrEqual(area.h - lineOf(scaledSize(layout.faqAnswerSize, page.scale)) + 0.01);
    });
    // A page set smaller carries the sizes and the gaps at its scale on every entry, rounded as the shell rounds them.
    const smaller = pages.find((page) => page.scale < 1);
    expect(smaller).toBeDefined();
    smaller?.rows.forEach((row) =>
      row.entries.forEach((entry) => {
        expect(entry.answerSize).toBe(scaledSize(layout.faqAnswerSize, smaller.scale));
        expect(entry.questionSize).toBe(scaledSize(layout.faqQuestionSize, smaller.scale));
        expect(entry.answerGap).toBe(Math.round(layout.faqAnswerGap * smaller.scale * 10) / 10);
        expect(entry.sourceGap).toBe(Math.round(layout.faqSourceGap * smaller.scale * 10) / 10);
      })
    );
  });

  it("composes the scales as the deck's gridPages does: an entry fitted to the floor alone, on a page set to 0.9, draws at 0.9 of its fitted sizes (0.648 of the base)", () => {
    const items = Array.from({ length: 80 }, (_, i) => `- Step ${i + 1}`);
    const tall = { path: 'faq[0][1][0]', question: 'Which steps, in order?', answer: ['Steps:', ...items].join('\n'), source: 'Docs', answered: true };
    const filler = Array.from({ length: 3 }, (_, q) => ({
      path: `faq[0][1][${q + 1}]`,
      question: `Question ${q + 1}?`,
      answer: Array.from({ length: 16 }, () => 'Answer').join(' ') + '.',
      source: 'Docs',
      answered: true,
    }));
    // On the deck's area a fitted entry fills its page alone; a taller area leaves the room for a second row at 0.9 only.
    const tallArea = { ...area, h: 600 };
    const pages = paginateFaqPairs([{ name: 'Mixed', path: 'faq[0]', questions: [tall, ...filler], unanswered: 0 }], layout, tallArea);
    const first = pages[0];
    expect(first.rows.length).toBeGreaterThan(1);
    const [entry] = first.rows[0].entries;
    expect(entry.path).toBe(tall.path);
    expect(first.scale).toBe(0.9);
    // The sizes the entry was fitted to alone (the floor), then the page's scale on top, each step rounded as the shell rounds.
    expect(entry.answerSize).toBe(scaledSize(scaledSize(layout.faqAnswerSize, MKTG_PRINT_PAGE_MIN_SCALE), first.scale));
    expect(entry.questionSize).toBe(scaledSize(scaledSize(layout.faqQuestionSize, MKTG_PRINT_PAGE_MIN_SCALE), first.scale));
    expect(entry.answerSize).toBeLessThan(scaledSize(layout.faqAnswerSize, MKTG_PRINT_PAGE_MIN_SCALE));
    // The full-size entries sharing the page take the page's scale once.
    first.rows
      .flatMap((row) => row.entries)
      .filter((e) => e.path !== tall.path)
      .forEach((e) => expect(e.answerSize).toBe(scaledSize(layout.faqAnswerSize, first.scale)));
  });

  it('fits a pair of many short list items as the deck does: the question whole, the answer at the floor, the items too short to cut, the trailing ones dropped and the last kept marked', () => {
    const items = Array.from({ length: 80 }, (_, i) => `- Step ${i + 1}`);
    const answer = ['Steps:', ...items].join('\n');
    const [page] = paginateFaqPairs([
      {
        name: 'Steps',
        path: 'faq[0]',
        questions: [{ path: 'faq[0][1][0]', question: 'Which steps, in order?', answer, source: 'Docs', answered: true }],
        unanswered: 0,
      },
    ]);
    const [entry] = page.rows[0].entries;
    expect(entry.cut).toBe(true);
    expect(entry.question).toBe('Which steps, in order?');
    expect(entry.questionSize).toBe(scaledSize(layout.faqQuestionSize, MKTG_PRINT_PAGE_MIN_SCALE));
    expect(entry.answerSize).toBe(scaledSize(layout.faqAnswerSize, MKTG_PRINT_PAGE_MIN_SCALE));
    const lines = entry.answer.split('\n').filter((line) => line !== '');
    expect(lines[0]).toBe('Steps:');
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBeLessThan(items.length + 1);
    lines.slice(1).forEach((line) => expect(line.startsWith('- Step ')).toBe(true));
    expect(lines[lines.length - 1].endsWith('…')).toBe(true);
    expect(lines.slice(0, -1).some((line) => line.includes('…'))).toBe(false);
    expect(page.rows[0].height).toBeLessThanOrEqual(area.h - lineOf(entry.answerSize) + 0.01);
  });
});

describe('mktgPrintFamilyPlan', () => {
  it('counts the cover, the framework and kit pages, each divider and each appendix page, the back cover last', () => {
    const framework = frameworkView('Open mesh for everyone', 'Tagline');
    const kit = buildBrandKitBookView(brandKitTestRevision(), 1);
    const brand = mktgPrintBrand(null);
    const view = printView({ framework, kit, boilerplates: { brand, lengths: fixtureLengths() }, faq: { brand, groups: fixtureGroups() } });
    const plan = mktgPrintFamilyPlan(view, 5, 7);
    // 1 cover, 2–6 framework, 7–13 kit, 14 divider, 15 cards, 16 divider, 17 grid, 18 back cover.
    expect(plan).toEqual({
      numbers: { framework: '01', kit: '02', boilerplates: '03', faq: '04' },
      kitFirstPage: 7,
      boilerplatesFirstPage: 15,
      faqFirstPage: 17,
      boilerplateCount: 4,
      faqQuestionCount: 4,
      pageCount: 18,
    });
  });

  it('renumbers the parts present and skips a missing part, with no back cover when the kit is missing', () => {
    const plan = mktgPrintFamilyPlan(printView(), 5, 7);
    // 1 cover, 2 divider, 3 cards (none), 4 divider, 5 grid (none).
    expect(plan).toEqual({
      numbers: { boilerplates: '01', faq: '02' },
      kitFirstPage: 2,
      boilerplatesFirstPage: 3,
      faqFirstPage: 5,
      boilerplateCount: 0,
      faqQuestionCount: 0,
      pageCount: 5,
    });
    const faqOnly = mktgPrintFamilyPlan(printView({ boilerplates: null }));
    expect(faqOnly.numbers).toEqual({ faq: '01' });
    expect(faqOnly.faqFirstPage).toBe(3);
    expect(faqOnly.pageCount).toBe(3);
  });
});
