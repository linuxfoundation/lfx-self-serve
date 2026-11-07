// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the framework portrait book's list rule and key numbers
// pages: a list is tightened before it is cut and the cut is said under it;
// the figures print as tiles by their count up to six, past that as a table
// of every one, continued on another page when a page fills. Every fixture
// is synthetic.

import { describe, expect, it } from 'vitest';

import {
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
} from '../constants/mktg-print.constants';
import { FOUNDATION_MESSAGE_VIEW_TABS } from '../constants/foundation-message.constants';
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import { FoundationMessagePrintNumber } from '../interfaces/mktg-print.interface';
import {
  foundationMessagePrintCutNote,
  frameworkPortraitCutList,
  frameworkPortraitCutNoteHeight,
  frameworkPortraitFactRowHeight,
  frameworkPortraitFigureSize,
  frameworkPortraitNumberTiles,
  frameworkPortraitNumbersPages,
  frameworkPortraitNumbersRowIn,
  frameworkPortraitWordCut,
  frameworkPortraitChipWidth,
  frameworkPortraitIcpWhoWidth,
  frameworkPortraitAnchors,
  frameworkPortraitAvoidList,
  frameworkPortraitBodyTop,
  frameworkPortraitChipHeight,
  frameworkPortraitContents,
  frameworkPortraitContentsHeight,
  frameworkPortraitContentsTitleWidth,
  frameworkPortraitContentsRoom,
  frameworkPortraitCutNoteHeightIn,
  frameworkPortraitHouse,
  frameworkPortraitIcpHeight,
  frameworkPortraitIcpIn,
  frameworkPortraitIcpMatrixHeight,
  frameworkPortraitIcpPages,
  frameworkPortraitIcpRoom,
  frameworkPortraitIcpsAligned,
  frameworkPortraitMatrix,
  frameworkPortraitMatrixColumn,
  frameworkPortraitPillList,
  frameworkPortraitPillarHeadHeight,
  frameworkPortraitPillarProofHeight,
  frameworkPortraitPillsHeight,
  frameworkPortraitSayRoom,
  frameworkPortraitServedCount,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  frameworkPortraitTextHeight,
  frameworkPortraitTitle,
  frameworkPortraitTitlesAtOneSize,
} from './mktg-framework-portrait-layout.utils';
import type { FoundationMessagePrintGoal, FoundationMessagePrintIcp, FoundationMessagePrintView } from '../interfaces/mktg-print.interface';
import type { FoundationMessagePillarView } from '../interfaces/foundation-message.interface';
import type { MktgPortraitPlanPage } from '../interfaces/mktg-portrait-print.interface';
import { mktgPortraitCharsPerLine } from './mktg-portrait-print.utils';
import { buildFoundationMessagePrintView } from './mktg-print.utils';

const pair = (a: string, b: string): [string, string] => [a, b];

const content = (numbers: number, proofs: number): FoundationMessageContent => ({
  mf: {
    vision: 'V.',
    mission: 'M.',
    positioning: 'P.',
    tagline: 'T.',
    goals: [
      {
        id: 'g1',
        n: 1,
        t: 'Goal',
        vp: 'VP.',
        key: 'Key.',
        proof: Array.from({ length: proofs }, (_, index) => pair(`A proof sentence that takes some room in the facts table, number ${index + 1}.`, 'Report')),
        bite: 'Bite',
        icps: [],
      },
    ],
    crosscut: '',
    say: [],
    avoid: [],
    anchor: [],
    notes: '',
  },
  icp: [],
  mh: { umbrella: 'U.', line: 'L.', pillars: [], found: 'F.', aud: [] },
  nums: Array.from({ length: numbers }, (_, index) => pair(`${(index + 1) * 1000}`, `figure ${index + 1}`)),
});

const view = (numbers: number, proofs = 1): FoundationMessagePrintView => buildFoundationMessagePrintView(content(numbers, proofs), 'TestOrbit', 1, null);

/** A full print view (the real builder's, from the smallest content) with the fields a test sets spread last. */
const viewWith = (overrides: Partial<FoundationMessagePrintView>): FoundationMessagePrintView => ({ ...view(1), ...overrides });

/** A full profile (every field of FoundationMessagePrintIcp) with the fields a test sets spread last. */
const icpWith = (overrides: Partial<FoundationMessagePrintIcp> & Pick<FoundationMessagePrintIcp, 'id'>): FoundationMessagePrintIcp => ({
  name: `Profile ${overrides.id}`,
  kind: 'Organization',
  who: 'Who.',
  goals: ['g1'],
  need: 'Need.',
  value: 'Value.',
  lead: 'Lead.',
  proof: [pair('A fact.', 'Docs')],
  cta: 'CTA.',
  channels: ['Docs', 'Slack'],
  objection: ['Too early?', null],
  personas: [pair('Role', 'Cares')],
  basis: 'Inferred',
  proofRows: [{ fact: 'A fact.', source: 'Docs' }],
  goalTitles: ['Goal'],
  personaRows: [{ role: 'Role', cares: 'Cares' }],
  objectionText: 'Too early?',
  objectionResponse: '',
  goalLabel: 'Goal',
  channelsLabel: 'Docs · Slack',
  goalChips: ['Goal 1'],
  personaLines: ['Role · Cares'],
  whoWidth: 190,
  ...overrides,
});

describe('the framework portrait book’s cut lists', () => {
  const rows = ['a', 'b', 'c', 'd'];
  const normal = () => 30;
  const tight = () => 20;

  it('keeps every row at the normal measure when they fit', () => {
    expect(frameworkPortraitCutList(rows, 120, 'framework', normal, tight)).toEqual({ rows, cut: 0, tight: false, note: '' });
  });

  it('tightens first: every row at the tight measure when that is what fits', () => {
    expect(frameworkPortraitCutList(rows, 100, 'framework', normal, tight)).toEqual({ rows, cut: 0, tight: true, note: '' });
  });

  it('then cuts to the leading whole rows that fit beside the note, and counts the rest', () => {
    const note = frameworkPortraitCutNoteHeight();
    expect(note).toBeCloseTo(6 + 10.5 * 1.4);
    // Four tight rows are 80: at 79 the list is cut, and the rows that stay (three at 60) must leave the note its room too.
    const cutTo = (kept: string[], cut: number) => ({ rows: kept, cut, tight: true, note: `+${cut} more on the framework's Framework tab in LFX One` });
    expect(frameworkPortraitCutList(rows, 79, 'framework', normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 40 + note, 'framework', normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 39 + note, 'framework', normal, tight)).toEqual(cutTo(['a'], 3));
    // A room too small for any row still says what was cut: the note carries the count, the rows are none.
    expect(frameworkPortraitCutList(rows, 10, 'framework', normal, tight)).toEqual(cutTo([], 4));
    expect(frameworkPortraitCutList([], 0, 'framework', normal, tight)).toEqual({ rows: [], cut: 0, tight: false, note: '' });
  });

  it('words the note from the count and the tab the rows live on', () => {
    // The tab is named as the screen labels it (FOUNDATION_MESSAGE_VIEW_TABS), never a literal of the print's own.
    expect(foundationMessagePrintCutNote(3, 'sources')).toBe("+3 more on the framework's Sources and gaps tab in LFX One");
    expect(foundationMessagePrintCutNote(1, 'framework')).toBe("+1 more on the framework's Framework tab in LFX One");
    expect(FOUNDATION_MESSAGE_VIEW_TABS.map((tab) => tab.label)).toEqual(['Framework', 'Key numbers', 'Sources and gaps']);
  });
});

describe('the framework portrait book’s bounded blocks', () => {
  const long = 'A long sentence about the project and the many things it does for the people who use it every day. ';
  const goal = (proofs: number, overrides: Partial<FoundationMessagePrintGoal> = {}): FoundationMessagePrintGoal => ({
    id: 'g',
    n: 1,
    t: 'Adoption',
    vp: 'Value',
    key: 'Key',
    bite: 'Bite',
    proof: [],
    icps: [],
    segmentLabel: '',
    segmentNames: [],
    proofRows: Array.from({ length: proofs }, (_, index) => ({ fact: `${long.trim()} (${index})`, source: 'Source' })),
    ...overrides,
  });

  it('fits a page title to its room: the grammar’s 34 px on one line where it fits, smaller to the floor, then the lines it needs, never cut', () => {
    expect(frameworkPortraitTitle('framework')).toEqual({ text: 'framework', size: 34, lines: 1 });
    expect(frameworkPortraitBodyTop(frameworkPortraitTitle('framework'))).toBe(136);
    const longTitle = 'Goal 2 · Grow adoption across the enterprise';
    const fitted = frameworkPortraitTitle(longTitle);
    expect(fitted).toEqual({ text: longTitle, size: fitted.size, lines: 1 });
    expect(fitted.size).toBeLessThan(34);
    expect(fitted.size).toBeGreaterThanOrEqual(25);
    expect(mktgPortraitCharsPerLine(704, fitted.size, { weight: 500 })).toBeGreaterThanOrEqual(longTitle.length);
    const wrapped = frameworkPortraitTitle(`Goal 3 · ${long.trim()}`);
    expect(wrapped).toEqual({ text: `Goal 3 · ${long.trim()}`, size: 25, lines: 3 });
    expect(frameworkPortraitBodyTop(wrapped)).toBe(136 + 2 * 25 * 1.1);
    // The goal pages' titles at one size (the editor's rule): the smallest any needs, each at it with its own lines; a lone title fits alone.
    const one = frameworkPortraitTitlesAtOneSize(['Goal 1 · Events', longTitle, 'Goal 3 · Adoption']);
    expect(one.map((fit) => fit.size)).toEqual([fitted.size, fitted.size, fitted.size]);
    expect(one.map((fit) => fit.lines)).toEqual([1, 1, 1]);
    expect(frameworkPortraitTitlesAtOneSize(['Goal 1 · Events', `Goal 3 · ${long.trim()}`]).map((fit) => fit.size)).toEqual([25, 25]);
    expect(frameworkPortraitTitlesAtOneSize(['Goal 1 · Events'])).toEqual([{ text: 'Goal 1 · Events', size: 34, lines: 1 }]);
    expect(frameworkPortraitTitlesAtOneSize([])).toEqual([]);
  });

  it('widens the tagline’s card and sets the tagline no larger than two words a line', () => {
    // 704 less three 12 gaps, shared 0.7 / 1 / 1.25 / 1.05; the tagline's card less its padding, rule and inset.
    expect(frameworkPortraitStatementWidth(1)).toBe(668 / 4 - 32);
    expect(frameworkPortraitStatementWidth(1.05, true)).toBeCloseTo((668 * 1.05) / 4 - 32 - 13, 6);
    const width = frameworkPortraitStatementWidth(1.05, true);
    expect(frameworkPortraitTaglineSize('Build openly.', width)).toBe(18);
    // Two words of fourteen characters ("Open standards") hold one line at 16 px, one size under the design's 18.
    expect(frameworkPortraitTaglineSize('Open standards for agentic AI', width)).toBe(16);
    const smaller = frameworkPortraitTaglineSize('Open standards for the agentic stack', width);
    expect(smaller).toBe(16);
    expect(mktgPortraitCharsPerLine(width, smaller, { weight: 500 })).toBeGreaterThanOrEqual('Open standards'.length);
    // A pair no size to the floor holds ("agentic infrastructure") leaves the tagline at the floor; one word keeps the design's size.
    expect(frameworkPortraitTaglineSize('Open standards for agentic infrastructure', width)).toBe(13);
    expect(frameworkPortraitTaglineSize('Supercalifragilisticexpialidocious', width)).toBe(18);
  });

  it('bounds the goal matrix’s proof cells to the room the other rows leave, tight first, then whole rows with the note', () => {
    expect(frameworkPortraitMatrixColumn(4)).toBe((704 - 24 - 96 - 64) / 4);
    const whole = frameworkPortraitMatrix([goal(2)], 'Across the goals.', 664);
    expect(whole.proofs[0]).toEqual({ rows: goal(2).proofRows, cut: 0, tight: false, note: '' });
    // Short text cells print as written, at their type.
    expect(whole.cells).toEqual([
      { title: { text: goal(2).t, size: 15 }, vp: { text: 'Value', size: 11 }, key: { text: 'Key', size: 11 }, bite: { text: 'Bite', size: 12.5 } },
    ]);
    expect(whole.height).toBeLessThanOrEqual(664);
    // A goal title the record does not cap is fitted into the head row's two lines (smaller first, then cut at a word), so the head stays its height.
    const titled = frameworkPortraitMatrix([goal(2, { t: long.repeat(2).trim() }), goal(1)], 'Across the goals.', 664);
    const titleRoom = 15 * 1.2 * 2;
    for (const cell of titled.cells) {
      expect(
        frameworkPortraitTextHeight(cell.title.text, { ...FRAMEWORK_PORTRAIT_TYPE.matrixGoal, size: cell.title.size }, frameworkPortraitMatrixColumn(2))
      ).toBeLessThanOrEqual(titleRoom);
    }
    expect(titled.cells[0].title.size).toBeLessThan(15);
    expect(titled.cells[0].title.text.length).toBeLessThan(long.repeat(2).trim().length);
    expect(titled.cells[1].title).toEqual({ text: goal(1).t, size: 15 });
    expect(titled.height).toBeLessThanOrEqual(664);
    const bounded = frameworkPortraitMatrix([goal(12), goal(1)], 'Across the goals.', 664);
    expect(bounded.proofs[0].rows.length).toBeGreaterThan(0);
    expect(bounded.proofs[0].rows.length).toBeLessThan(12);
    expect(bounded.proofs[0].tight).toBe(true);
    expect(bounded.proofs[0].note).toBe(`+${12 - bounded.proofs[0].rows.length} more on the framework's Framework tab in LFX One`);
    expect(bounded.proofs[1].cut).toBe(0);
    expect(bounded.height).toBeLessThanOrEqual(664);
  });

  it('fits the matrix’s text cells at the record’s cap: eight goals with long cells and four proofs each end inside the room, the proofs keeping their note', () => {
    const text = long.repeat(3).trim();
    const goals = Array.from({ length: 8 }, (_, index) =>
      goal(4, { id: `g${index}`, n: index + 1, t: `Goal ${index + 1} title`, vp: text, key: text, bite: long.trim() })
    );
    const column = frameworkPortraitMatrixColumn(8);
    expect(column).toBe((704 - 24 - 96 - 128) / 8);
    // Unfitted, the three text rows alone would run past the room the matrix has on the page (the P1 the review measured at about 1224 px).
    const unfitted = ['vp', 'key'].reduce((sum) => sum + frameworkPortraitTextHeight(text, FRAMEWORK_PORTRAIT_TYPE.matrixCell, column), 0);
    expect(unfitted).toBeGreaterThan(664);
    const matrix = frameworkPortraitMatrix(goals, 'Across the goals.', 664);
    expect(matrix.height).toBeLessThanOrEqual(664);
    expect(matrix.cells).toHaveLength(8);
    for (const cell of matrix.cells) {
      // Fitted: smaller than the type, or cut at a sentence (shorter than the text), never past the room.
      expect(cell.vp.size < 11 || cell.vp.text.length < text.length).toBe(true);
      expect(cell.key.size <= 11).toBe(true);
      expect(cell.bite?.text.length ?? 0).toBeGreaterThan(0);
    }
    // Every proof cell keeps its note at the real count: none is cut to nothing without the line that says so.
    for (const cell of matrix.proofs) {
      expect(cell.rows.length + cell.cut).toBe(4);
      if (cell.cut > 0) expect(cell.note).toBe(`+${cell.cut} more on the framework's Framework tab in LFX One`);
    }
  });

  it('never leaves a matrix proof cell with only its note: the first proof stays, set smaller to the room above the note (editor F3)', () => {
    // The editor's shapes: a goal whose proofs are long sentences beside goals with short ones, in a matrix whose text rows take the room.
    const sentence = `${long.trim()}. ${long.trim()}.`;
    const column = frameworkPortraitMatrixColumn(4);
    const goals = [
      goal(4, { id: 'g1', n: 1, vp: long.repeat(3).trim(), key: long.repeat(3).trim(), bite: long.trim() }),
      goal(1, { id: 'g2', n: 2 }),
      goal(1, { id: 'g3', n: 3 }),
      goal(4, { id: 'g4', n: 4, vp: long.repeat(3).trim(), key: long.repeat(3).trim(), bite: long.trim() }),
    ].map((entry, index) => (index === 0 || index === 3 ? { ...entry, proofRows: entry.proofRows.map((proof) => ({ ...proof, fact: sentence })) } : entry));
    const matrix = frameworkPortraitMatrix(goals, 'Across the goals.', 400);
    expect(matrix.height).toBeLessThanOrEqual(400);
    for (const [index, cell] of matrix.proofs.entries()) {
      expect(cell.rows.length).toBeGreaterThan(0);
      expect(cell.rows.length + cell.cut).toBe(goals[index].proofRows.length);
      // The first row is the goal's first proof: as written, or its opening cut at a sentence; smaller than the tight type when it had to be.
      expect(goals[index].proofRows[0].fact.startsWith(cell.rows[0].fact.replace(/…$/, ''))).toBe(true);
      expect(cell.rows[0].size ?? FRAMEWORK_PORTRAIT_TYPE.matrixProofTight.size).toBeLessThanOrEqual(FRAMEWORK_PORTRAIT_TYPE.matrixProofTight.size);
    }
    // The long goals kept one proof, smaller or cut, with the note counting the three left off; the short goals print theirs whole.
    for (const index of [0, 3]) {
      const cell = matrix.proofs[index];
      expect(cell.cut).toBe(3);
      expect(cell.note).toBe("+3 more on the framework's Framework tab in LFX One");
      expect((cell.rows[0].size ?? 10.5) < 10.5 || cell.rows[0].fact.length < sentence.length).toBe(true);
      const type = { ...FRAMEWORK_PORTRAIT_TYPE.matrixProofTight, size: cell.rows[0].size ?? 10.5 };
      expect(frameworkPortraitTextHeight(`${cell.rows[0].fact} ${cell.rows[0].source}`, type, column)).toBeLessThan(400);
    }
    expect(matrix.proofs[1]).toMatchObject({ cut: 0, rows: goals[1].proofRows });
  });

  it('packs the say pills into their column and cuts them from the end, tight first; cuts the avoid rows to whole rows', () => {
    const pills = Array.from({ length: 12 }, (_, index) => `${long.slice(0, 40).trim()} ${index}`);
    expect(frameworkPortraitPillsHeight(['open'], 320, false)).toBe(13 * 1.2 + 18);
    expect(frameworkPortraitPillList(['open', 'honest'], 320, frameworkPortraitSayRoom())).toEqual({
      rows: ['open', 'honest'],
      cut: 0,
      tight: false,
      note: '',
    });
    const cut = frameworkPortraitPillList(pills, 320, frameworkPortraitSayRoom());
    expect(cut.rows.length).toBeGreaterThan(0);
    expect(cut.rows.length).toBeLessThan(12);
    expect(cut.rows).toEqual(pills.slice(0, cut.rows.length));
    expect(cut.tight).toBe(true);
    expect(frameworkPortraitPillsHeight(cut.rows, 320, true) + frameworkPortraitCutNoteHeightIn(cut.cut, 'framework', 320)).toBeLessThanOrEqual(
      frameworkPortraitSayRoom()
    );
    const rows = Array.from({ length: 12 }, (_, index) => ({ avoid: `${long.slice(0, 50).trim()} ${index}`, instead: long.slice(0, 60).trim() }));
    const avoid = frameworkPortraitAvoidList(rows, 360, frameworkPortraitSayRoom());
    expect(avoid.rows.length).toBeGreaterThan(0);
    expect(avoid.rows.length).toBeLessThan(12);
    expect(avoid.tight).toBe(true);
    expect(avoid.note).toBe(`+${12 - avoid.rows.length} more on the framework's Framework tab in LFX One`);
  });

  it('keeps the anchors at their top and the crosscut box at the design’s, sets long questions smaller then cuts them so both end above the footer', () => {
    const short = frameworkPortraitAnchors(['Which goal does this serve?'], 'Across the goals.');
    expect(short).toEqual({ anchors: [{ numberLabel: '01', question: 'Which goal does this serve?', size: 22 }], crosscutTop: 760 });
    const five = Array.from({ length: 5 }, (_, index) => `${long.trim()} Question ${index}?`);
    const fitted = frameworkPortraitAnchors(five, 'Across the goals.');
    expect(fitted.anchors.map((anchor) => anchor.numberLabel)).toEqual(['01', '02', '03', '04', '05']);
    expect(fitted.anchors.every((anchor) => anchor.size < 22 && anchor.size >= 22 * 0.72 - 1e-9)).toBe(true);
    expect(fitted.crosscutTop).toBeGreaterThanOrEqual(760);
    const box = 36 + 26 + 8 + 13 * 1.6;
    expect(fitted.crosscutTop + box).toBeLessThanOrEqual(1000);
    const longer = frameworkPortraitAnchors(
      five.map((question) => question.repeat(3)),
      ''
    );
    expect(longer.anchors.every((anchor) => anchor.question.length < question(0).repeat(3).length)).toBe(true);
    function question(index: number): string {
      return five[index];
    }
  });
});

describe('the framework portrait book’s message house', () => {
  const view = (pillars: FoundationMessagePillarView[], audiences: number, found = 'Why now.'): FoundationMessagePrintView =>
    viewWith({
      mh: { umbrella: 'Umbrella.', line: 'Brand line.', pillars, found, aud: [] },
      pillars,
      audiences: Array.from({ length: audiences }, (_, index) => ({ name: `Audience ${index}`, lead: 'A lead sentence for the audience row.' })),
    });
  const pillar = (proofs: number, message = 'A message.'): FoundationMessagePillarView => ({
    t: 'Open',
    m: message,
    p: [],
    proofRows: Array.from({ length: proofs }, () => ({ fact: 'A fact about the project that runs to a second line in a column.', source: 'Web' })),
  });

  it('measures a pillar: its rule, title and message, and each proof row with its chip as the chip prints', () => {
    expect(frameworkPortraitPillarHeadHeight(pillar(0, ''), 221)).toBe(15 + 16 * 1.25);
    expect(frameworkPortraitPillarHeadHeight(pillar(1), 221)).toBe(15 + 16 * 1.25 + 8 + 12.5 * 1.5);
    // The chip: "Web" in capitals at 8.5 px on one line (8.5), its padding and border down (8), under its 4 px margin.
    expect(frameworkPortraitChipHeight('Web', 221)).toBe(8.5 + 8);
    expect(frameworkPortraitPillarProofHeight(pillar(1).proofRows[0], 221)).toBe(17 + 2 * 11.5 * 1.45 + 4 + 16.5);
    // A long source wraps inside the chip's 140 px cap (124 of text): three lines of capitals, not the one line a text measure gives.
    const long = 'Linux Foundation annual report, members and projects';
    expect(frameworkPortraitChipHeight(long, 500)).toBe(3 * 8.5 + 8);
    expect(frameworkPortraitPillarProofHeight({ fact: 'A fact.', source: long }, 221)).toBe(17 + 11.5 * 1.45 + 4 + 3 * 8.5 + 8);
  });

  it('sets Why now and the audiences a gap under the measured pillars, the text fitted and the rows cut to the footer', () => {
    const short = frameworkPortraitHouse(view([pillar(1)], 2), { text: 'Umbrella.', size: 19 });
    const umbrella = 48 + 19 * 1.4;
    const line = 36 + 13 * 1.3;
    expect(short.pillars).toEqual([{ rows: pillar(1).proofRows, cut: 0, tight: false, note: '' }]);
    expect(short.lowerTop).toBe(
      140 + umbrella + line + frameworkPortraitPillarHeadHeight(pillar(1), 704) + 12 + frameworkPortraitPillarProofHeight(pillar(1).proofRows[0], 704) + 32
    );
    expect(short.lowerTop).toBeLessThan(500);
    expect(short.whyNow).toEqual({ text: 'Why now.', size: 13 });
    expect(short.audiences).toEqual({ rows: short.audiences.rows, cut: 0, tight: false, note: '' });
    expect(short.audiences.rows).toHaveLength(2);
    // Five pillars (the record's cap) of four long proofs under long messages would run past the footer: each pillar's proofs are cut to whole rows
    // that leave the lower blocks their least room (80 px above the footer), the lower blocks follow the cut pillars down, the long Why now text is
    // fitted smaller and six audiences are cut to what ends above the footer, the cut said under each list.
    const long = pillar(4, 'A message that runs on for several lines in a five-column pillar, saying what the pillar stands for.');
    const tall = frameworkPortraitHouse(view([long, long, long, long, long], 6, 'Why now. '.repeat(40).trim()), {
      text: 'An umbrella statement that runs to three lines of the dark bar, saying what the project is and whom it is the home for.',
      size: 19,
    });
    expect(tall.pillars).toHaveLength(5);
    expect(tall.pillars[0].rows.length).toBeLessThan(4);
    expect(tall.pillars[0].rows.length).toBeGreaterThan(0);
    expect(tall.pillars[0].note).toBe(`+${4 - tall.pillars[0].rows.length} more on the framework's Framework tab in LFX One`);
    expect(tall.lowerTop).toBeLessThanOrEqual(1000 - 80);
    expect(tall.lowerTop).toBeGreaterThan(780);
    expect(tall.whyNow?.size).toBeLessThan(13);
    expect(tall.audiences.rows.length).toBeLessThan(6);
    expect(tall.audiences.rows.length).toBeGreaterThan(0);
    expect(tall.audiences.note).toBe(`+${6 - tall.audiences.rows.length} more on the framework's Framework tab in LFX One`);
    expect(frameworkPortraitHouse(view([pillar(1)], 0, ''), { text: '', size: 19 }).whyNow).toBeNull();
  });
});

describe('the framework portrait book’s cover contents', () => {
  const plan = (goals: number, icpPages: number, numbersPages = 1): MktgPortraitPlanPage[] => [
    { id: 'cover', section: 'Cover', title: 'Cover' },
    { id: 'framework', section: '01 Framework', title: 'framework' },
    ...Array.from({ length: goals }, (_, index) => ({ id: `goal-${index + 1}`, section: '01 Framework', title: `Goal ${index + 1} · Title` })),
    { id: 'say-avoid', section: '01 Framework', title: 'Say and avoid' },
    ...Array.from({ length: icpPages }, (_, index) => ({
      id: `icps-${index + 1}`,
      section: '02 ICPs',
      title: index === 0 ? 'Ideal customer profiles' : `Ideal customer profiles (${index + 1})`,
    })),
    { id: 'message-house', section: '03 Message house', title: 'Message house' },
    ...Array.from({ length: numbersPages }, (_, index) => ({
      id: index === 0 ? 'key-numbers' : `key-numbers-${index + 1}`,
      section: '04 Key numbers',
      title: index === 0 ? 'Key numbers' : `Key numbers (${index + 1})`,
    })),
    { id: 'sources', section: '05 Sources', title: 'Sources & gaps' },
  ];

  it('lists every page after the cover at the design’s measure while the rows end above the strip, tight past that', () => {
    expect(frameworkPortraitContentsRoom()).toBe(984 - 620 - 26 - 8);
    expect(frameworkPortraitContentsHeight(12, false)).toBe(6 * (13 * 1.3 + 17));
    expect(frameworkPortraitContentsHeight(23, true)).toBe(12 * (12 * 1.3 + 11));
    const short = frameworkPortraitContents(plan(4, 2), 1);
    expect(short).toMatchObject({ tight: false, collapsed: false });
    expect(short.rows.map((row) => row.numberLabel)).toEqual(['02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
    expect(short.rows[0]).toEqual({ id: 'framework', title: 'framework', number: 2, numberLabel: '02' });
    // The record's cap: eight goals, ten profile pages, two numbers pages, 25 frames: 24 rows in twelve pairs, tight, every page listed.
    const cap = frameworkPortraitContents(plan(8, 10, 2), 1);
    expect(frameworkPortraitContentsHeight(24, false)).toBeGreaterThan(frameworkPortraitContentsRoom());
    expect(cap).toMatchObject({ tight: true, collapsed: false });
    expect(cap.rows).toHaveLength(24);
    expect(frameworkPortraitContentsHeight(cap.rows.length, true)).toBeLessThanOrEqual(frameworkPortraitContentsRoom());
  });

  it('sets every title on one line of its column, cut at a word past the row’s measure, so the list’s height is its count’s', () => {
    // A column is half the content width less the gap, less the page number's 30 px: 310 px, about 43 characters at 13 px.
    expect(frameworkPortraitContentsTitleWidth()).toBe((704 - 24) / 2 - 30);
    const max = mktgPortraitCharsPerLine(frameworkPortraitContentsTitleWidth(), 13);
    expect(max).toBe(43);
    // Eight goals with real-shaped titles at the cap, one of them long enough to wrap: every row is one line, the long one cut with the ellipsis.
    const longTitle = 'Goal 4 · Events where the roadmap is decided in the open, with the people who build it';
    const pages = plan(8, 2).map((page) => (page.id === 'goal-4' ? { ...page, title: longTitle } : page));
    const contents = frameworkPortraitContents(pages, 1);
    expect(contents).toMatchObject({ tight: false, collapsed: false });
    for (const row of contents.rows) expect(row.title.length).toBeLessThanOrEqual(max);
    const cut = contents.rows.find((row) => row.id === 'goal-4');
    expect(cut?.title).toBe('Goal 4 · Events where the roadmap is…');
    expect(contents.rows.find((row) => row.id === 'goal-3')?.title).toBe('Goal 3 · Title');
    // At the tight measure the row holds more (12 px): the same title is cut later.
    const tight = frameworkPortraitContents(
      plan(8, 10, 2).map((page) => (page.id === 'goal-4' ? { ...page, title: longTitle } : page)),
      1
    );
    expect(tight.tight).toBe(true);
    expect(tight.rows.find((row) => row.id === 'goal-4')?.title).toBe('Goal 4 · Events where the roadmap is decided…');
    // A title with a sentence inside the measure is still cut at a word with the mark, never at the sentence with none
    // (the provisional call: a reader sees the title goes on); the function word it would end on goes (the grammar's rule).
    const sentences = 'Goal 3 · Grow adoption. Then grow the number of maintainers who stay a second year';
    expect(frameworkPortraitWordCut(sentences, frameworkPortraitContentsTitleWidth(), 13)).toBe('Goal 3 · Grow adoption. Then grow…');
    expect(frameworkPortraitWordCut('Goal 3 · Title', frameworkPortraitContentsTitleWidth(), 13)).toBe('Goal 3 · Title');
    const probe = plan(8, 2).map((page) => (page.id === 'goal-3' ? { ...page, title: sentences } : page));
    expect(frameworkPortraitContents(probe, 1).rows.find((row) => row.id === 'goal-3')?.title).toBe('Goal 3 · Grow adoption. Then grow…');
  });

  it('collapses each run of repeated pages to one row with its page range when the tight rows still pass the strip, dropping no page', () => {
    // Beyond the record (41 frames): the goals, the profile pages and the continued table each become one row with a range.
    const long = frameworkPortraitContents(plan(8, 24, 4), 1);
    expect(frameworkPortraitContentsHeight(40, true)).toBeGreaterThan(frameworkPortraitContentsRoom());
    expect(long.collapsed).toBe(true);
    expect(long.rows.map((row) => [row.title, row.numberLabel])).toEqual([
      ['framework', '02'],
      ['Goals 1–8', '03–10'],
      ['Say and avoid', '11'],
      ['Ideal customer profiles', '12–35'],
      ['Message house', '36'],
      ['Key numbers', '37–40'],
      ['Sources & gaps', '41'],
    ]);
    expect(long.tight).toBe(false);
    expect(frameworkPortraitContentsHeight(long.rows.length, false)).toBeLessThanOrEqual(frameworkPortraitContentsRoom());
    // Inside the family (no cover, first page 5) the numbers follow the family's.
    expect(frameworkPortraitContents(plan(1, 1).slice(1), 5).rows.map((row) => row.numberLabel)).toEqual(['05', '06', '07', '08', '09', '10', '11']);
  });
});

describe('the framework portrait book’s profile pages', () => {
  const sentence = 'A sentence of the profile that runs on for a while to take a second line in its column. ';
  const icp = (id: string, repeat: number, personas = 1): FoundationMessagePrintIcp =>
    icpWith({
      id,
      who: sentence.repeat(repeat).trim(),
      need: sentence.repeat(repeat).trim(),
      value: sentence.repeat(repeat).trim(),
      lead: sentence.repeat(repeat).trim(),
      cta: sentence.repeat(repeat).trim(),
      objectionResponse: sentence.repeat(repeat).trim(),
      personaRows: Array.from({ length: personas }, (_, index) => ({ role: `Role ${index}`, cares: sentence.trim() })),
      personaLines: Array.from({ length: personas }, (_, index) => `Role ${index} · ${sentence.trim()}`),
    });

  it('measures a card: its chrome and the taller of the name column and the fields grid, the fields three a row', () => {
    const short = icp('a', 1);
    const column = (704 - 190 - 24 - 40) / 3;
    const field = (text: string, tight = false) =>
      frameworkPortraitTextHeight(text, tight ? FRAMEWORK_PORTRAIT_TYPE.icpFieldTight : FRAMEWORK_PORTRAIT_TYPE.icpField, column);
    const eyebrow = 9.5 * 1.2 + 4;
    const row1 = eyebrow + Math.max(field(short.need), field(short.value), field(short.lead));
    const row2 = eyebrow + Math.max(field(short.cta), field(`“Too early?” — ${short.objectionResponse}`), field('Docs · Slack') + 4 + field('A fact. Docs'));
    const grid = row1 + 18 + row2;
    const whoColumn =
      frameworkPortraitTextHeight(short.name, FRAMEWORK_PORTRAIT_TYPE.icpName, 190) +
      8 +
      16.5 +
      10 +
      frameworkPortraitTextHeight(short.who, FRAMEWORK_PORTRAIT_TYPE.icpWho, 190) +
      8 +
      frameworkPortraitTextHeight(`Role 0 · ${sentence.trim()}`, FRAMEWORK_PORTRAIT_TYPE.icpPersona, 190);
    expect(frameworkPortraitIcpHeight(short)).toBe(49 + Math.max(whoColumn, grid));
    expect(frameworkPortraitIcpHeight(short, true)).toBeLessThan(frameworkPortraitIcpHeight(short));
  });

  it('packs the cards two a page while the measured pair ends above the footer, one when it would not, tight when one alone outruns it', () => {
    // Four short cards: two a page, the design's.
    expect(frameworkPortraitIcpPages([icp('a', 1), icp('b', 1), icp('c', 1), icp('d', 1)]).map((page) => page.icps.map((row) => row.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // Two long cards would end past the first page's footer together: the second moves whole to the next page, at the normal measure.
    const long = frameworkPortraitIcpPages([icp('a', 3), icp('b', 3)]);
    expect(frameworkPortraitIcpHeight(icp('a', 3))).toBeLessThanOrEqual(frameworkPortraitIcpRoom(1));
    expect(frameworkPortraitIcpHeight(icp('a', 3)) * 2).toBeGreaterThan(frameworkPortraitIcpRoom(1));
    expect(long.map((page) => [page.icps.map((row) => row.id), page.tight])).toEqual([
      [['a'], false],
      [['b'], false],
    ]);
    expect(long.every((page) => page.height <= frameworkPortraitIcpRoom(1))).toBe(true);
    // One card alone past the room: its fields set tight, and, this one outrunning the page even so, its longest texts cut until it ends
    // in the room (frameworkPortraitIcpIn); the page still holds the one card.
    const tall = frameworkPortraitIcpPages([icp('a', 14, 3)]);
    expect(frameworkPortraitIcpHeight(icp('a', 14, 3))).toBeGreaterThan(frameworkPortraitIcpRoom(1));
    expect(frameworkPortraitIcpHeight(icp('a', 14, 3), true)).toBeGreaterThan(frameworkPortraitIcpRoom(1));
    const fitted = frameworkPortraitIcpIn(icp('a', 14, 3), frameworkPortraitIcpRoom(1));
    expect(tall).toEqual([{ icps: [fitted], tight: true, cut: true, height: frameworkPortraitIcpHeight(fitted, true) }]);
    expect(tall[0].height).toBeLessThanOrEqual(frameworkPortraitIcpRoom(1));
    // A card the tight measure alone brings inside the room is not cut.
    const tightOnly = frameworkPortraitIcpPages([icp('a', 4, 3)]);
    expect(frameworkPortraitIcpHeight(icp('a', 4, 3))).toBeGreaterThan(frameworkPortraitIcpRoom(1));
    expect(tightOnly).toEqual([{ icps: [icp('a', 4, 3)], tight: true, cut: false, height: frameworkPortraitIcpHeight(icp('a', 4, 3), true) }]);
    // The matrix under a lone card: label, note, head row and one row per profile.
    expect(frameworkPortraitIcpMatrixHeight(4)).toBe(26 + 4 + 11.5 * 1.5 + 12 + 13 + 2 * 9.5 * 1.4 + 4 * (19 + 12 * 1.4));
  });
});

describe('the framework portrait book’s lone overlong profile', () => {
  const sentence = 'A sentence of the profile that runs on for a while to take a second line in its column. ';
  const huge = icpWith({
    id: 'huge',
    who: sentence.repeat(30).trim(),
    need: sentence.repeat(30).trim(),
    value: sentence.repeat(30).trim(),
    lead: sentence.repeat(30).trim(),
    cta: sentence.repeat(30).trim(),
    objectionResponse: sentence.repeat(30).trim(),
  });

  it('cuts a lone card’s longest texts at a sentence until it ends in the room when the tight measure is not enough, and leaves a card that fits alone', () => {
    const room = frameworkPortraitIcpRoom(1);
    expect(frameworkPortraitIcpHeight(huge, true)).toBeGreaterThan(room);
    const cut = frameworkPortraitIcpIn(huge, room);
    expect(frameworkPortraitIcpHeight(cut, true)).toBeLessThanOrEqual(room);
    expect(cut.need.length).toBeLessThan(huge.need.length);
    expect(huge.need.startsWith(cut.need.replace(/…$/, ''))).toBe(true);
    expect([cut.id, cut.name, cut.kind]).toEqual([huge.id, huge.name, huge.kind]);
    const pages = frameworkPortraitIcpPages([huge]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ tight: true, cut: true });
    expect(pages[0].height).toBeLessThanOrEqual(room);
    expect(pages[0].icps[0]).toEqual(cut);
    // A card that fits is the same object, untouched.
    const small = icpWith({ id: 'small' });
    expect(frameworkPortraitIcpIn(small, room)).toBe(small);
    expect(frameworkPortraitIcpPages([small])[0]).toMatchObject({ tight: false, cut: false, icps: [small] });
  });

  it('holds four "Who it’s for" cards across the page at the board’s narrowest card', () => {
    // (704 + 16) / (164 + 16) = 4; a half-width row holds one.
    expect(frameworkPortraitServedCount()).toBe(4);
    expect(frameworkPortraitServedCount(340)).toBe(1);
  });
});

describe('the framework portrait book’s profile rows', () => {
  it('sizes the name-and-tags column to hold the kind and goal tags on one line, from the board’s 190 to a cap', () => {
    // Two short tags fit the board's column; four grow it to what they measure; past the cap the column stops growing.
    expect(frameworkPortraitChipWidth('Goal 1')).toBe(Math.ceil(6 * 8.5 * 0.72) + 16);
    expect(frameworkPortraitIcpWhoWidth(['Individual', 'Goal 1'])).toBe(190);
    const four = frameworkPortraitIcpWhoWidth(['Individual', 'Goal 1', 'Goal 2', 'Goal 3']);
    expect(four).toBe(frameworkPortraitChipWidth('Individual') + 3 * frameworkPortraitChipWidth('Goal 1') + 3 * 4);
    expect(four).toBeGreaterThan(190);
    expect(four).toBeLessThan(300);
    expect(frameworkPortraitIcpWhoWidth(['Member companies and prospects', 'Goal 1', 'Goal 2', 'Goal 3', 'Goal 4'])).toBe(300);
  });
});

describe('the framework portrait book’s key numbers', () => {
  it('lays the tiles out by the count: pairs to three, 2×2, three then two, 3×2; none past six', () => {
    const shares = (count: number) => frameworkPortraitNumberTiles(view(count).numbers).map((tile) => [tile.share, tile.wide]);
    expect(shares(1)).toEqual([[1, true]]);
    expect(shares(2)).toEqual([
      [2, false],
      [2, false],
    ]);
    expect(shares(3)).toEqual([
      [2, false],
      [2, false],
      [1, true],
    ]);
    expect(shares(4)).toEqual([
      [2, false],
      [2, false],
      [2, false],
      [2, false],
    ]);
    expect(shares(5).map(([share]) => share)).toEqual([3, 3, 3, 2, 2]);
    expect(shares(6).map(([share]) => share)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(FRAMEWORK_PORTRAIT_MAX_TILES).toBe(6);
    expect(shares(7)).toEqual([]);
    expect(shares(0)).toEqual([]);
  });

  it('prints one page with the tiles and the facts under them when the count allows tiles', () => {
    const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
    const pages = frameworkPortraitNumbersPages(view(4, 3));
    expect(pages).toHaveLength(1);
    expect(pages[0].tiles).toHaveLength(4);
    expect(pages[0].numbersTable).toEqual([]);
    expect(pages[0].intro).toContain('The figures the framework leans on');
    expect(pages[0].factsTop).toBe(tile.top + 2 * tile.height + tile.gap + tile.tableGap);
    expect(pages[0].facts).toMatchObject({ cut: 0, tight: false, note: '' });
    expect(pages[0].facts.rows).toHaveLength(3);
    // Two rows of tiles put the facts table where the mock draws it (560); five tiles take two rows too (three, then two); one tile takes one.
    expect(pages[0].factsTop).toBe(560);
    expect(frameworkPortraitNumbersPages(view(5))[0].factsTop).toBe(560);
    expect(frameworkPortraitNumbersPages(view(1))[0].factsTop).toBe(388);
    expect(frameworkPortraitNumbersPages(view(0))[0]).toMatchObject({ tiles: [], numbersTable: [], factsTop: tile.top });
  });

  it('steps the figure down to the half-size floor and fits the label to the room under it', () => {
    // A third-width tile: (704 − 2 × 16) / 3 = 224 wide, 176 of content. Six seven-digit figures with a 30-character label.
    const content = (704 - 2 * 16) / 3 - 2 * 24;
    expect(content).toBe(176);
    const label = 'members across five continents';
    expect(label.length).toBe(30);
    const row = (number: string, source = '') => ({ number, label, source });
    const tiles = frameworkPortraitNumberTiles(Array.from({ length: 6 }, (_, index) => row(`${index + 1},200,000`)));
    expect(tiles.every((tile) => tile.share === 3)).toBe(true);
    // "1,200,000" at 54/500 is 9 × 54 × 0.55 = 267 px: too wide for 176, so the size steps down to the first whole px that
    // holds nine characters (176 / (9 × 0.55) = 35.5 → 35).
    expect(frameworkPortraitFigureSize('1,200,000', content)).toBe(35);
    expect(tiles.map((tile) => tile.figureSize)).toEqual([35, 35, 35, 35, 35, 35]);
    expect(frameworkPortraitFigureSize('41', content)).toBe(FRAMEWORK_PORTRAIT_TYPE.tileFigure.size);
    // The label's room is 156 − 44 − 35 − 10 = 67: two lines of 14/1.4 (39.2) fit as written.
    expect(tiles[0].labelSize).toBe(FRAMEWORK_PORTRAIT_TYPE.tileLabel.size);
    expect(tiles[0].labelText).toBe(label);
    // Under a 54 px figure the room is 48: two lines of 14/1.4 (39.2) still fit.
    const short = frameworkPortraitNumberTiles(Array.from({ length: 6 }, () => row('41')));
    expect(short[0].figureSize).toBe(54);
    expect(short[0].labelSize).toBe(FRAMEWORK_PORTRAIT_TYPE.tileLabel.size);
    // With a source pill under the label the room loses the pill and its gap (10 + 17): 21 is left, so the two lines come down to
    // one (10.5 px holds 30 characters in 176: 14.7 ≤ 21), the label whole; a half-width tile (296) holds it at 14 on one line.
    const sourced = frameworkPortraitNumberTiles(Array.from({ length: 6 }, () => row('41', 'LFX field')));
    expect(sourced[0].source).toBe('LFX field');
    expect(sourced[0].labelSize).toBe(10.5);
    expect(sourced[0].labelText).toBe(label);
    expect(frameworkPortraitNumberTiles(Array.from({ length: 4 }, () => row('299', 'LFX field')))[0].labelSize).toBe(14);
    // A half-width tile (296 of content) holds the same figure at its full size.
    expect(frameworkPortraitNumberTiles([row('1,200,000'), row('2')])[0].figureSize).toBe(54);
    // Eleven characters hold at 29 (176 / (29 × 0.55) = 11.03); the floor, 27, holds no more (11.8 → 11), so twelve pass it.
    expect(frameworkPortraitFigureSize('1,234,567,8', content)).toBe(29);
    expect(frameworkPortraitFigureSize('1,234,567,89', content)).toBeNull();
    // Past the floor there is no tile: the figure returns null and the numbers print as the table, whole, every tile given up.
    expect(frameworkPortraitFigureSize('1,234,567,890,123,456', content)).toBeNull();
    const overlong = frameworkPortraitNumberTiles([row('1,234,567,890,123,456'), ...Array.from({ length: 5 }, () => row('41'))]);
    expect(overlong).toEqual([]);
    const pages = frameworkPortraitNumbersPages({ ...view(1), numbers: [{ number: '1,234,567,890,123,456', label, source: '' }, ...view(6).numbers.slice(1)] });
    expect(pages[0].tiles).toEqual([]);
    // The figures print separated (`mktgPrintFigure`); the fixture's bare "2000" is in the year range and prints as stored.
    expect(pages[0].numbersTable.map((entry) => entry.number)).toEqual(['1,234,567,890,123,456', '2000', '3,000', '4,000', '5,000', '6,000']);
  });

  it('measures a facts row by the chip its source prints as, so a long source makes the row taller', () => {
    const fact = { fact: 'A fact.', usedBy: 'Goal 1', source: 'Web' };
    // "Web" on one chip line (16.5) over the fact's one line (14.3), plus the row's padding and hairline (9).
    expect(frameworkPortraitFactRowHeight(fact, false)).toBe(16.5 + 9);
    // The source column is 164 px, the chip capped at 140 (124 of text, 20 capitals a line): three chip lines.
    expect(frameworkPortraitFactRowHeight({ ...fact, source: 'Linux Foundation annual report, members and projects' }, false)).toBe(3 * 8.5 + 8 + 9);
  });

  it('keeps at least one row on every fresh page, and cuts a row taller than a whole page inside it', () => {
    // 160 sentences: about 76 lines of 11/1.3 in the label column (516 px), near 1090 px, taller than a page's 804 of room.
    const tall = Array.from({ length: 160 }, (_, index) => `Sentence ${index + 1} of a label that runs on.`).join(' ');
    const base = view(6, 1);
    const pages = frameworkPortraitNumbersPages({
      ...base,
      numbers: [...base.numbers, { number: '9', label: tall, source: '' }, { number: '10', label: 'after', source: '' }],
    });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.flatMap((page) => page.numbersTable.map((row) => row.number))).toEqual(['1,000', '2000', '3,000', '4,000', '5,000', '6,000', '9', '10']);
    // The tall row opens a fresh page, its label cut at a sentence so the row ends above the footer; the figure cell is kept.
    const tallPage = pages.find((page) => page.numbersTable.some((row) => row.number === '9'));
    expect(tallPage?.numbersTable[0].number).toBe('9');
    const cut = tallPage?.numbersTable[0];
    expect(cut?.label.length).toBeLessThan(tall.length);
    expect(tall.startsWith((cut?.label ?? '').replace(/…$/, ''))).toBe(true);
    const room = FRAMEWORK_PORTRAIT_TOPS.footer - FRAMEWORK_PORTRAIT_TOPS.numbersContinued - 26 - 34;
    // A print row (with its source) goes in and comes out as one: the util is generic over the row's type.
    const tallRow: FoundationMessagePrintNumber = { number: '9', label: tall, source: 'Website' };
    const fitted: FoundationMessagePrintNumber = frameworkPortraitNumbersRowIn(tallRow, room);
    expect(fitted).toEqual({ ...cut, source: 'Website' });
    const shortRow: FoundationMessagePrintNumber = { number: '9', label: 'short', source: '' };
    expect(frameworkPortraitNumbersRowIn(shortRow, room)).toEqual(shortRow);
  });

  it('past six prints the table of every figure, and continues it on more pages when a page fills, the facts last', () => {
    const nine = frameworkPortraitNumbersPages(view(9, 2));
    expect(nine).toHaveLength(1);
    expect(nine[0].tiles).toEqual([]);
    expect(nine[0].numbersTable.map((row) => row.number)).toEqual(['1,000', '2000', '3,000', '4,000', '5,000', '6,000', '7,000', '8,000', '9,000']);
    expect(nine[0].numbersTop).toBe(FRAMEWORK_PORTRAIT_NUMBER_TILE.top);
    expect(nine[0].factsTop).toBeGreaterThan(nine[0].numbersTop);
    expect(nine[0].facts.rows).toHaveLength(2);
    const forty = frameworkPortraitNumbersPages(view(40, 2));
    expect(forty.length).toBeGreaterThanOrEqual(2);
    expect(forty.map((page) => page.index)).toEqual(forty.map((_, index) => index + 1));
    expect(forty.flatMap((page) => page.numbersTable.map((row) => row.label))).toEqual(Array.from({ length: 40 }, (_, index) => `figure ${index + 1}`));
    expect(forty.slice(1).every((page) => page.intro === '' && page.tiles.length === 0 && page.numbersTop === FRAMEWORK_PORTRAIT_TOPS.numbersContinued)).toBe(
      true
    );
    expect(forty.slice(0, -1).every((page) => page.factsTop === null)).toBe(true);
    expect(forty[forty.length - 1].facts.rows).toHaveLength(2);
  });

  it('puts the facts on a page of their own when the table leaves no room for a row of them', () => {
    const pages = frameworkPortraitNumbersPages(view(200, 1));
    const last = pages[pages.length - 1];
    expect(last.facts.rows).toHaveLength(1);
    expect(pages.every((page, index) => index === pages.length - 1 || page.factsTop === null)).toBe(true);
    expect(pages.flatMap((page) => page.numbersTable)).toHaveLength(200);
  });
});

describe('the framework portrait book’s profile columns', () => {
  it('gives every card the book’s one name-and-tags width, the widest any card’s tags grew to, so the fields start at one x on every page', () => {
    const narrow = icpWith({ id: 'narrow', whoWidth: 190 });
    const wide = icpWith({ id: 'wide', whoWidth: 240 });
    const other = icpWith({ id: 'other', whoWidth: 204 });
    const aligned = frameworkPortraitIcpsAligned([narrow, wide, other]);
    expect(aligned.map((icp) => icp.whoWidth)).toEqual([240, 240, 240]);
    expect(aligned.map((icp) => icp.id)).toEqual(['narrow', 'wide', 'other']);
    // The card already at the width is the same object; the others are copies with the width alone changed.
    expect(aligned[1]).toBe(wide);
    expect(aligned[0]).toEqual({ ...narrow, whoWidth: 240 });
    // Cards all at the board's 190 stay as they are; no card: nothing.
    const same = [icpWith({ id: 'a' }), icpWith({ id: 'b' })];
    expect(frameworkPortraitIcpsAligned(same)).toEqual(same);
    expect(frameworkPortraitIcpsAligned(same)[0]).toBe(same[0]);
    expect(frameworkPortraitIcpsAligned([])).toEqual([]);
    // The pages carry the aligned cards, measured at the shared width (a wider name column makes the fields grid narrower and taller).
    const pages = frameworkPortraitIcpPages([narrow, wide, other]);
    expect(pages.flatMap((page) => page.icps.map((icp) => icp.whoWidth))).toEqual([240, 240, 240]);
    expect(pages[0].height).toBe(frameworkPortraitIcpHeight({ ...narrow, whoWidth: 240 }) + frameworkPortraitIcpHeight(wide));
  });
});
