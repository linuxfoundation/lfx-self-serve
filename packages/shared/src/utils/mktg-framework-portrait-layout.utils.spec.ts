// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the framework portrait book's list rule and key numbers
// pages: a list is tightened before it is cut and the cut is said under it;
// the figures print as tiles by their count up to six, past that as a table
// of every one, continued on another page when a page fills. Every fixture
// is synthetic.

import { describe, expect, it } from 'vitest';

import {
  FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES,
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_PRINT_OBJECTION_DASH,
} from '../constants/mktg-print.constants';
import { MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import { MKTG_READABLE_SOURCE } from '../constants/mktg-readable-source.constants';
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import { FoundationMessagePrintNumber } from '../interfaces/mktg-print.interface';
import {
  foundationMessagePrintCutNote,
  frameworkPortraitCutList,
  frameworkPortraitCutNoteHeight,
  frameworkPortraitFactRowHeight,
  frameworkPortraitFigureSize,
  frameworkPortraitGlyphTextHeight,
  frameworkPortraitNumberTiles,
  frameworkPortraitLfxSourced,
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
  frameworkPortraitMatrixColumns,
  frameworkPortraitMatrixProofRowSize,
  frameworkPortraitMatrixTitleSize,
  frameworkPortraitPillHeight,
  frameworkPortraitPillList,
  frameworkPortraitPillWidth,
  frameworkPortraitPillarHeadHeight,
  frameworkPortraitPillarProofHeight,
  frameworkPortraitPillsHeight,
  frameworkPortraitSayRoom,
  frameworkPortraitServedCards,
  frameworkPortraitServedCount,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  frameworkPortraitTextHeight,
  frameworkPortraitTitle,
  frameworkPortraitTitlesAtOneSize,
} from './mktg-framework-portrait-layout.utils';
import type {
  FoundationMessagePrintCutList,
  FoundationMessagePrintGoal,
  FoundationMessagePrintGoalProof,
  FoundationMessagePrintIcp,
  FoundationMessagePrintView,
} from '../interfaces/mktg-print.interface';
import type { FoundationMessagePillarView } from '../interfaces/foundation-message.interface';
import type { MktgPortraitPlanPage } from '../interfaces/mktg-portrait-print.interface';
import { mktgPortraitCharEm, mktgPortraitCharsPerLine, mktgPortraitParaHeight, mktgPortraitWrapLines } from './mktg-portrait-print.utils';
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
    expect(frameworkPortraitCutList(rows, 120, normal, tight)).toEqual({ rows, cut: 0, tight: false, note: '' });
  });

  it('tightens first: every row at the tight measure when that is what fits', () => {
    expect(frameworkPortraitCutList(rows, 100, normal, tight)).toEqual({ rows, cut: 0, tight: true, note: '' });
  });

  it('then cuts to the leading whole rows that fit beside the note, and counts the rest', () => {
    const note = frameworkPortraitCutNoteHeight();
    expect(note).toBeCloseTo(6 + 10.5 * 1.4);
    // Four tight rows are 80: at 79 the list is cut, and the rows that stay (three at 60) must leave the note its room too.
    const cutTo = (kept: string[], cut: number) => ({ rows: kept, cut, tight: true, note: `+${cut} more in LFX One` });
    expect(frameworkPortraitCutList(rows, 79, normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 40 + note, normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 39 + note, normal, tight)).toEqual(cutTo(['a'], 3));
    // A room too small for any row still says what was cut: the note carries the count, the rows are none.
    expect(frameworkPortraitCutList(rows, 10, normal, tight)).toEqual(cutTo([], 4));
    expect(frameworkPortraitCutList([], 0, normal, tight)).toEqual({ rows: [], cut: 0, tight: false, note: '' });
  });

  it('words the note from the count alone, the editor’s one form everywhere (W5)', () => {
    expect(foundationMessagePrintCutNote(3)).toBe('+3 more in LFX One');
    expect(foundationMessagePrintCutNote(1)).toBe('+1 more in LFX One');
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
    // A goal title the record does not cap is kept at the row's one size (its words fit the column) and prints WHOLE, the head row
    // growing to hold it (the editor's FA1): no title is cut and none is set smaller than its neighbors.
    const titled = frameworkPortraitMatrix([goal(2, { t: long.repeat(2).trim() }), goal(1)], 'Across the goals.', 664);
    expect(titled.cells.map((cell) => cell.title)).toEqual([
      { text: long.repeat(2).trim(), size: 15 },
      { text: goal(1).t, size: 15 },
    ]);
    expect(titled.bands).toEqual([{ offset: 0, count: 2, columns: 2 }]);
    expect(titled.height).toBeLessThanOrEqual(664);
    // The head's growth comes off the body's room: the matrix is taller than with short titles by the lines the long title adds.
    const shortTitled = frameworkPortraitMatrix([goal(2), goal(1)], 'Across the goals.', 664);
    expect(titled.height).toBeGreaterThan(shortTitled.height);
    const bounded = frameworkPortraitMatrix([goal(12), goal(1)], 'Across the goals.', 664);
    expect(bounded.proofs[0].rows.length).toBeGreaterThan(0);
    expect(bounded.proofs[0].rows.length).toBeLessThan(12);
    expect(bounded.proofs[0].tight).toBe(true);
    expect(bounded.proofs[0].note).toBe(`+${12 - bounded.proofs[0].rows.length} more in LFX One`);
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
      if (cell.cut > 0) expect(cell.note).toBe(`+${cell.cut} more in LFX One`);
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
      expect(cell.note).toBe('+3 more in LFX One');
      expect((cell.rows[0].size ?? 10.5) < 10.5 || cell.rows[0].fact.length < sentence.length).toBe(true);
      const type = { ...FRAMEWORK_PORTRAIT_TYPE.matrixProofTight, size: cell.rows[0].size ?? 10.5 };
      expect(frameworkPortraitTextHeight(`${cell.rows[0].fact} ${cell.rows[0].source}`, type, column)).toBeLessThan(400);
    }
    expect(matrix.proofs[1]).toMatchObject({ cut: 0, rows: goals[1].proofRows });
  });

  it('bounds every head title to its column at one size, and breaks eight goals into two bands of four where the strip cannot hold their words (editor C2b)', () => {
    // The overfull record's titles: eight columns of 57 px cannot hold "Certification" at a readable size, so the matrix is two bands of the board's four.
    const titles = ['Adoption', 'Contributors', 'Certification', 'End users', 'Events', 'Security', 'Membership', 'Education'];
    const em = mktgPortraitCharEm({ weight: FRAMEWORK_PORTRAIT_TYPE.matrixGoal.weight });
    expect(frameworkPortraitMatrixColumn(8)).toBe(57);
    expect(frameworkPortraitMatrixTitleSize(titles, 57)).toBeLessThan(FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin);
    expect('Certification'.length * FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin * em).toBeGreaterThan(57);
    const goals = titles.map((t, index) => goal(4, { id: `g${index}`, n: index + 1, t }));
    expect(frameworkPortraitMatrixColumns(goals)).toBe(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns);
    const matrix = frameworkPortraitMatrix(goals, 'Across the goals.', 664);
    expect(matrix.bands).toEqual([
      { offset: 0, count: 4, columns: 4 },
      { offset: 4, count: 4, columns: 4 },
    ]);
    expect(matrix.height).toBeLessThanOrEqual(664);
    expect(matrix.cells).toHaveLength(8);
    expect(matrix.proofs).toHaveLength(8);
    // One size across the row, and every title's longest word inside the band's column: nothing overflows into its neighbor.
    const column = frameworkPortraitMatrixColumn(4);
    const sizes = new Set(matrix.cells.map((cell) => cell.title.size));
    expect(sizes.size).toBe(1);
    expect(matrix.cells[0].title.size).toBe(15);
    for (const cell of matrix.cells) {
      for (const word of cell.title.text.split(' ')) expect(word.length * cell.title.size * em).toBeLessThanOrEqual(column);
      expect(cell.title.text).toBe(goals[matrix.cells.indexOf(cell)].t);
    }
    // Every proof cell keeps a row in each band (the editor's F3 holds in the bands too).
    for (const cell of matrix.proofs) expect(cell.rows.length).toBeGreaterThan(0);
    // Short titles at eight goals stay one strip of eight: the words fit the narrow column at the floor or above.
    const short = Array.from({ length: 8 }, (_, index) => goal(1, { id: `s${index}`, n: index + 1, t: `Goal ${index + 1} title` }));
    expect(frameworkPortraitMatrixColumns(short)).toBe(8);
    const strip = frameworkPortraitMatrix(short, '', 664);
    expect(strip.bands).toEqual([{ offset: 0, count: 8, columns: 8 }]);
    expect(new Set(strip.cells.map((cell) => cell.title.size)).size).toBe(1);
    expect(strip.cells[0].title.size).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin);
    // At the board's count or fewer the strip is the widest shape: three goals, one with a 40-character word, stay three columns
    // (a band of four would be narrower), the title at the floor and printed whole (the editor's FA1: the word breaks inside its
    // column as the head's `overflow-wrap` lets it; the head row grows, never cuts).
    const wordy = [goal(1, { id: 'w1', n: 1, t: 'Events' }), goal(1, { id: 'w2', n: 2, t: 'A'.repeat(40) }), goal(1, { id: 'w3', n: 3, t: 'Adoption' })];
    expect(frameworkPortraitMatrixColumns(wordy)).toBe(3);
    const three = frameworkPortraitMatrix(wordy, '', 664);
    expect(three.bands).toEqual([{ offset: 0, count: 3, columns: 3 }]);
    expect(three.cells.map((cell) => cell.title.size)).toEqual([
      FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin,
      FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin,
      FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin,
    ]);
    expect(three.cells.map((cell) => cell.title.text)).toEqual(wordy.map((goal) => goal.t));
    expect(three.height).toBeLessThanOrEqual(664);
    // Seven goals in bands: the second band holds three in four columns.
    expect(frameworkPortraitMatrix(goals.slice(0, 7), '', 664).bands).toEqual([
      { offset: 0, count: 4, columns: 4 },
      { offset: 4, count: 3, columns: 4 },
    ]);
  });

  it('packs the say pills into their column and cuts them from the end, tight first; cuts the avoid rows to whole rows', () => {
    const pills = Array.from({ length: 12 }, (_, index) => `${long.slice(0, 40).trim()} ${index}`);
    expect(frameworkPortraitPillsHeight(['open'], 320, false)).toBe(13 * 1.2 + 18);
    // A phrase wider than the column wraps inside its pill: its row is as tall as the lines it takes, not one line (the phrase count is bounded, not the phrase).
    const phrase = 'A say phrase so long that it cannot sit on one line of a say column at the pill measure, and wraps';
    expect(frameworkPortraitPillWidth(phrase, false)).toBeGreaterThan(2 * 320);
    expect(frameworkPortraitPillHeight(phrase, 320, false)).toBe(3 * 13 * 1.2 + 18);
    expect(frameworkPortraitPillsHeight(['open', phrase, 'honest'], 320, false)).toBe(13 * 1.2 + 18 + 8 + 3 * 13 * 1.2 + 18 + 8 + 13 * 1.2 + 18);
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
    expect(frameworkPortraitPillsHeight(cut.rows, 320, true) + frameworkPortraitCutNoteHeightIn(cut.cut, 320)).toBeLessThanOrEqual(frameworkPortraitSayRoom());
    const rows = Array.from({ length: 12 }, (_, index) => ({ avoid: `${long.slice(0, 50).trim()} ${index}`, instead: long.slice(0, 60).trim() }));
    const avoid = frameworkPortraitAvoidList(rows, 360, frameworkPortraitSayRoom());
    expect(avoid.rows.length).toBeGreaterThan(0);
    expect(avoid.rows.length).toBeLessThan(12);
    expect(avoid.tight).toBe(true);
    expect(avoid.note).toBe(`+${12 - avoid.rows.length} more in LFX One`);
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
    // A brand line that wraps moves the pillars, and the lower blocks with them, by the lines it takes as printed (`Brand line · <text>`).
    const wrapped = view([pillar(1)], 2);
    wrapped.mh = {
      ...wrapped.mh,
      line: 'A brand line long enough to need a second line across the whole page at the brand line’s measure, and then some words more.',
    };
    const two = frameworkPortraitHouse(wrapped, { text: 'Umbrella.', size: 19 });
    expect(two.lowerTop).toBe(short.lowerTop + 13 * 1.3);
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
    expect(tall.pillars[0].note).toBe(`+${4 - tall.pillars[0].rows.length} more in LFX One`);
    expect(tall.lowerTop).toBeLessThanOrEqual(1000 - 80);
    expect(tall.lowerTop).toBeGreaterThan(780);
    // Why now keeps its body size and is cut at a sentence instead (the editor's read, 7 Nov 2026: never the shrunk text).
    expect(tall.whyNow?.size).toBe(13);
    expect(tall.whyNow?.text.length).toBeLessThan('Why now. '.repeat(40).trim().length);
    expect(tall.whyNow?.text).toMatch(/^(Why now\. )*Why now\.$/);
    expect(tall.audiences.rows.length).toBeLessThan(6);
    expect(tall.audiences.rows.length).toBeGreaterThan(0);
    expect(tall.audiences.note).toBe(`+${6 - tall.audiences.rows.length} more in LFX One`);
    expect(frameworkPortraitHouse(view([pillar(1)], 0, ''), { text: '', size: 19 }).whyNow).toBeNull();
  });

  it('keeps the first audience at least when every row would be cut, its lead cut at a sentence to the room above the note (editor W2)', () => {
    // Seven audiences whose leads run to many lines, under five tall pillars: the list rule would keep no row and print only "+7 more"
    // over an empty block; the first audience prints instead, tight, its lead cut to whole sentences, the note counting the six left off.
    const long = pillar(4, 'A message that runs on for several lines in a five-column pillar, saying what the pillar stands for.');
    const lead = [
      'This audience ships the project in production and reads the release notes first.',
      'It weighs every change against the uptime it owes its own users.',
      'It asks for the migration path before the feature.',
      'It reads the security advisories the day they land and plans the rollout.',
      'It expects the release cadence to hold.',
      'It files the bug with the reproduction and the version.',
      'It joins the community call when a change touches its stack.',
      'It votes with its deployment, not with a comment.',
      'It wants the upgrade to be boring.',
    ].join(' ');
    const audiences = Array.from({ length: 7 }, (_, index) => ({ name: `Audience ${index}`, lead }));
    const house = frameworkPortraitHouse(
      viewWith({
        mh: { umbrella: 'Umbrella.', line: 'Brand line.', pillars: [long, long, long, long, long], found: 'Why now.', aud: [] },
        pillars: [long, long, long, long, long],
        audiences,
      }),
      {
        text: 'An umbrella statement that runs to three lines of the dark bar, saying what the project is and whom it is the home for.',
        size: 19,
      }
    );
    expect(house.audiences.rows).toHaveLength(1);
    expect(house.audiences.rows[0].name).toBe('Audience 0');
    expect(house.audiences.rows[0].lead.length).toBeLessThan(lead.length);
    // Whole sentences, the first kept, none broken inside (a sentence cut, not a word cut with an ellipsis).
    expect(house.audiences.rows[0].lead).toMatch(/^This audience ships the project in production and reads the release notes first\.( It [^.]+\.)*$/);
    expect(house.audiences).toMatchObject({ cut: 6, tight: true, note: '+6 more in LFX One' });
    // The kept row ends above the footer with the note under it.
    const row =
      frameworkPortraitTextHeight(
        `Audience 0. ${house.audiences.rows[0].lead}`,
        FRAMEWORK_PORTRAIT_TYPE.audienceRowTight,
        FRAMEWORK_PORTRAIT_ROOM.audiencesColumn
      ) + FRAMEWORK_PORTRAIT_ROOM.audienceRowTight;
    const noteHeight = frameworkPortraitCutNoteHeightIn(6, FRAMEWORK_PORTRAIT_ROOM.audiencesColumn);
    expect(house.lowerTop + FRAMEWORK_PORTRAIT_ROOM.label + FRAMEWORK_PORTRAIT_ROOM.audienceListTop + row + noteHeight).toBeLessThanOrEqual(
      FRAMEWORK_PORTRAIT_TOPS.footer
    );
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
    const row2 =
      eyebrow +
      Math.max(
        field(short.cta),
        field(`“Too early?”${MKTG_PRINT_OBJECTION_DASH}${short.objectionResponse}`),
        field('Docs · Slack') + 4 + field('A fact. Docs')
      );
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

  it('dates the LFX figures in the intro only when a key number or fact on the pages is LFX-sourced (editor S-c)', () => {
    const dated = (overrides: Partial<FoundationMessagePrintView>): string =>
      frameworkPortraitNumbersPages(viewWith({ dateReadLabel: '7 Nov 2026', ...overrides }))[0].intro;
    // The smallest record: its one figure and fact come from the site; the sentence is not printed.
    expect(dated({})).toBe('The figures the framework leans on, with where each came from.');
    // A key number the LFX project record states, or a fact LFX Insights states, is an LFX figure: the sentence dates it.
    const number = { ...view(1).numbers[0], source: MKTG_READABLE_SOURCE.lfxRecord };
    expect(dated({ numbers: [number] })).toBe('The figures the framework leans on, with where each came from. LFX figures are as of 7 Nov 2026.');
    const fact = { ...view(1).facts[0], source: 'LFX Insights: members' };
    expect(dated({ facts: [fact] })).toContain('LFX figures are as of 7 Nov 2026.');
    // No read date: no sentence, LFX-sourced or not.
    expect(dated({ dateReadLabel: '', numbers: [number] })).toBe('The figures the framework leans on, with where each came from.');
    expect(['LFX Insights: members', MKTG_READABLE_SOURCE.lfxRecord, 'Website', 'lfx.example.org'].map(frameworkPortraitLfxSourced)).toEqual([
      true,
      true,
      false,
      false,
    ]);
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
    // The figures print separated (`mktgPrintFigure`): the fixture's bare "2000" is a count under a count's label, separated too (editor S1).
    expect(pages[0].numbersTable.map((entry) => entry.number)).toEqual(['1,234,567,890,123,456', '2,000', '3,000', '4,000', '5,000', '6,000']);
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
    expect(pages.flatMap((page) => page.numbersTable.map((row) => row.number))).toEqual(['1,000', '2,000', '3,000', '4,000', '5,000', '6,000', '9', '10']);
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
    expect(nine[0].numbersTable.map((row) => row.number)).toEqual(['1,000', '2,000', '3,000', '4,000', '5,000', '6,000', '7,000', '8,000', '9,000']);
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

// The overfull record's shape (the W1 and W4 specs): eight goals whose titles break the matrix into two bands of four, each with a long value proposition
// and key message, a sound bite and four proofs (synthetic figures).
const facts = [
  'Kubernetes runs in production at 96 percent of the organizations surveyed in the latest annual survey',
  'More than 250 projects are hosted across the graduated, incubating and sandbox tiers',
  'Over 290,000 contributors from 190 countries have committed to hosted projects',
  'KubeCon + CloudNativeCon North America drew 12,000 attendees in person last year',
  'More than 180,000 certifications have been issued under the Kubernetes certification program',
  '900 member organizations across every continent, from startups to the largest cloud providers',
  'Twenty-two graduated projects have passed the open governance and security audit bar',
  'Over 200 Kubernetes community days were held in 60 countries over the last twelve months',
];
const overfull: [string, string, string, string][] = [
  [
    'Adoption',
    'Teams standardize on projects every major cloud and vendor already supports, so platforms outlive any one supplier.',
    'The cloud native stack is open, governed in the open and run everywhere.',
    'Open, everywhere, governed in the open.',
  ],
  [
    'Contributors',
    'Maintainers find a neutral home, a release cadence they set and a security process the whole industry trusts.',
    'Build it where the whole industry maintains it with you.',
    'Build it where the industry maintains it.',
  ],
  [
    'Certification',
    'Certified engineers prove the skills employers hire for, against a vendor-neutral curriculum.',
    'The certification employers recognize, against the standard everyone ships.',
    'The credential the whole stack recognizes.',
  ],
  [
    'End users',
    'End users shape the roadmaps they depend on, through the technical oversight committee and the end user community.',
    'Your production needs set the roadmap: bring them to the end user community.',
    'Your production sets the roadmap.',
  ],
  [
    'Events',
    'Practitioners meet the maintainers, in person and in every region, at events the community runs.',
    'Where cloud native is built, taught and decided: come to the next event.',
    'Where cloud native is built in person.',
  ],
  [
    'Security',
    'Projects reach the security bar enterprises require, with audits, fuzzing and a disclosure process they share.',
    'Security is a shared practice here, not a product.',
    'Security as a shared practice.',
  ],
  [
    'Membership',
    'Members fund the neutral infrastructure the ecosystem builds on and sit where its direction is set.',
    'Sustain the neutral home the whole ecosystem depends on.',
    'Sustain the neutral home.',
  ],
  [
    'Education',
    'Learners take a free, structured path from the first container to production operations.',
    'Learn cloud native the way the maintainers teach it.',
    'From the first container to production.',
  ],
];
const goals = (shape: readonly [string, string, string, string][]): FoundationMessagePrintGoal[] =>
  shape.map(([t, vp, key, bite], index) => ({
    id: `g${index + 1}`,
    n: index + 1,
    t,
    vp,
    key,
    bite,
    proof: [],
    icps: [],
    segmentLabel: '',
    segmentNames: [],
    proofRows: Array.from({ length: 4 }, (_, at) => ({ fact: facts[(index + at) % facts.length], source: at % 2 ? 'LFX field' : 'Website' })),
  }));
const crosscut =
  'Every goal shares the proof that the stack runs in production at scale and that no single vendor controls its direction; use the figures for the audience in front of you.';
const room = FRAMEWORK_PORTRAIT_TOPS.footer - FRAMEWORK_PORTRAIT_TOPS.matrix;

describe('the framework portrait book’s goal matrix in bands (editor W1)', () => {
  const column = frameworkPortraitMatrixColumn(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns);
  const type = FRAMEWORK_PORTRAIT_TYPE;
  const linesOf = (text: string, size: number, weight: number) => mktgPortraitWrapLines(text, mktgPortraitCharsPerLine(column, size, { weight }));

  it('drops the value-proposition and sound-bite rows from every band, prints every key message whole at its type and says so once under the bands (W1b)', () => {
    // The overfull record at the matrix's room: two bands of four, no value row, no sound-bite row (each goal page prints both in
    // full), every key message as written at 11 px, never clamped or cut, the one note under the last band, the matrix on its page.
    const matrix = frameworkPortraitMatrix(goals(overfull), crosscut, room);
    expect(matrix.bands).toHaveLength(2);
    expect(matrix.rows).toEqual({ value: false, bite: false, proof: true });
    expect(matrix.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages]);
    expect(matrix.notes).toEqual(['Value propositions and sound bites are on each goal page.']);
    expect(matrix.height).toBeLessThanOrEqual(room);
    expect(matrix.cells.map((cell) => cell.key)).toEqual(overfull.map((goal) => ({ text: goal[2], size: type.matrixKey.size })));
    for (const cell of matrix.cells) {
      expect(cell.key.text.endsWith('…')).toBe(false);
      expect(linesOf(cell.key.text, cell.key.size, type.matrixKey.weight)).toBeGreaterThan(0);
    }
    // The record's longest key messages run past two lines of a band's column: they print whole all the same (the clamp is gone).
    expect(matrix.cells.some((cell) => linesOf(cell.key.text, cell.key.size, type.matrixKey.weight) > 2)).toBe(true);
    // The proof clamp stays: every cell keeps a row at the tight type or above, the rest counted in its note (F3, W4).
    for (const cell of matrix.proofs) {
      expect(cell.rows.length).toBeGreaterThan(0);
      expect(cell.tight).toBe(true);
      for (const row of cell.rows) expect(row.size ?? type.matrixProofTight.size).toBeGreaterThanOrEqual(type.matrixProofTight.size);
    }
  });

  it('prints the same rows in bands at any room: no row comes back when the room is wide, the proof row alone goes when it is narrow; the key message always prints whole (W1b, FA1b stepping)', () => {
    // The band shape has two steps, by the room: the value and bite rows are gone by rule (the former bites-then-values stepping went with
    // the clamp); the proof row prints while its cells hold the tight floor and goes, once, below it (the editor's FA1b), never back.
    // The ladder's three steps by the room, in order and never back: the proofs with their own "+N more" lines; those lines folded
    // into the caption (the maintainer's word of 7 Nov 2026); the proof row dropped.
    const steps: string[] = [
      FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages,
      FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesFold,
      FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesAll,
    ];
    let step = 0;
    let proofsDropped = false;
    for (let at = 2000; at >= 200; at -= 10) {
      const matrix = frameworkPortraitMatrix(goals(overfull), '', at);
      expect(matrix.cells.map((cell) => cell.key.text)).toEqual(overfull.map((goal) => goal[2]));
      expect(matrix.cells.every((cell) => cell.key.size === type.matrixKey.size)).toBe(true);
      expect(matrix.notes).toHaveLength(1);
      const now = steps.indexOf(matrix.notes[0]);
      expect(now).toBeGreaterThanOrEqual(step);
      step = now;
      if (!matrix.rows.proof) proofsDropped = true;
      if (proofsDropped) {
        expect(matrix.rows).toEqual({ value: false, bite: false, proof: false });
        expect(matrix.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesAll]);
        expect(matrix.proofs.every((cell) => cell.rows.length === 0)).toBe(true);
      } else {
        expect(matrix.rows).toEqual({ value: false, bite: false, proof: true });
        expect(matrix.proofs.every((cell) => cell.rows.length > 0)).toBe(true);
        // Folded: no cell prints its own line, its cut still counted; not folded: every cut cell says "+N more".
        expect(matrix.proofs.every((cell) => (now === 1 ? cell.note === '' : cell.cut === 0 || cell.note !== ''))).toBe(true);
        for (const cell of matrix.proofs)
          for (const row of cell.rows) expect(row.size ?? type.matrixProofTight.size).toBeGreaterThanOrEqual(type.matrixProofTight.size);
      }
    }
    expect(proofsDropped).toBe(true);
    expect(step).toBe(2);
    // The page's own room keeps the proofs (one row at the floor): the overfull record's page does not move.
    expect(frameworkPortraitMatrix(goals(overfull), crosscut, room).rows.proof).toBe(true);
    // The one note takes one caption line of the matrix's room, between the bands and the crosscut.
    const bare = frameworkPortraitMatrix(goals(overfull), '', 200);
    const noted = frameworkPortraitMatrix(goals(overfull), crosscut, 200);
    expect(noted.height - bare.height).toBeCloseTo(
      FRAMEWORK_PORTRAIT_ROOM.matrixCrosscutGap + frameworkPortraitTextHeight(crosscut, type.matrixCrosscut, 704 - FRAMEWORK_PORTRAIT_ROOM.matrixPadding),
      6
    );
    // A wide room holds the bands with their proofs at the normal type: the note still prints (the rows are gone by rule, not by room).
    const wide = frameworkPortraitMatrix(goals(overfull), '', 2000);
    expect(wide.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages]);
    expect(wide.proofs.every((cell) => !cell.tight && cell.cut === 0)).toBe(true);
  });

  it('leaves a strip as it was: four goals print every row, the texts fitted by the fit model, no clamp and no note', () => {
    const strip = frameworkPortraitMatrix(goals(overfull.slice(0, 4)), crosscut, room);
    expect(strip.bands).toEqual([{ offset: 0, count: 4, columns: 4 }]);
    expect(strip.rows).toEqual({ value: true, bite: true, proof: true });
    expect(strip.notes).toEqual([]);
    // A strip of four holds the record's texts whole at their type (the AAIF shape): nothing is cut, and the sound bites print whole.
    expect(strip.cells.map((cell) => cell.vp.text)).toEqual(overfull.slice(0, 4).map((goal) => goal[1]));
    expect(strip.cells.map((cell) => cell.key.text)).toEqual(overfull.slice(0, 4).map((goal) => goal[2]));
    expect(strip.cells.map((cell) => cell.bite?.text)).toEqual(overfull.slice(0, 4).map((goal) => goal[3]));
    expect(strip.height).toBeLessThanOrEqual(room);
    // A strip whose rows crowd the proofs is still fitted by the fit model (smaller, then cut at a sentence), not clamped to two lines.
    const crowded = frameworkPortraitMatrix(goals(overfull.slice(0, 4)), '', 300);
    expect(crowded.rows).toEqual({ value: true, bite: true, proof: true });
    expect(crowded.notes).toEqual([]);
    expect(crowded.cells.some((cell) => cell.vp.size < type.matrixCell.size)).toBe(true);
    // Eight goals with short titles are one strip of eight, not bands: no clamp, no note.
    const eight = frameworkPortraitMatrix(
      goals(overfull).map((goal, index) => ({ ...goal, t: `Goal ${index + 1}` })),
      crosscut,
      room
    );
    expect(eight.bands).toEqual([{ offset: 0, count: 8, columns: 8 }]);
    expect(eight.rows).toEqual({ value: true, bite: true, proof: true });
    expect(eight.notes).toEqual([]);
  });
});

describe('the framework portrait book’s goal matrix proof row (editor W4)', () => {
  const long = 'A long sentence about the project and the many things it does for the people who use it every day. ';
  const goal = (proofs: number, overrides: Partial<FoundationMessagePrintGoal> = {}): FoundationMessagePrintGoal => ({
    ...goals(overfull.slice(0, 1))[0],
    vp: 'Value',
    key: 'Key',
    bite: 'Bite',
    proofRows: Array.from({ length: proofs }, (_, index) => ({ fact: `${long.trim()} (${index})`, source: 'Source' })),
    ...overrides,
  });
  const tight = FRAMEWORK_PORTRAIT_TYPE.matrixProofTight.size;
  const normal = FRAMEWORK_PORTRAIT_TYPE.matrixProof.size;
  const sizeOf = (cell: FoundationMessagePrintCutList<FoundationMessagePrintGoalProof>): number => (cell.tight ? (cell.rows[0]?.size ?? tight) : normal);

  it('reads a row’s one size: the type’s where every cell printed at it, the tight type’s past that, else the smallest a kept first proof fell to', () => {
    const plain = { rows: [{ fact: 'A', source: 'S' }], cut: 0, tight: false, note: '' };
    const tightened = { rows: [{ fact: 'A', source: 'S' }], cut: 2, tight: true, note: 'n' };
    const kept = { rows: [{ fact: 'A', source: 'S', size: 9.24 }], cut: 3, tight: true, note: 'n' };
    const empty = { rows: [], cut: 0, tight: false, note: '' };
    expect(frameworkPortraitMatrixProofRowSize([])).toBe(normal);
    expect(frameworkPortraitMatrixProofRowSize([plain, empty])).toBe(normal);
    expect(frameworkPortraitMatrixProofRowSize([plain, tightened])).toBe(tight);
    expect(frameworkPortraitMatrixProofRowSize([plain, tightened, kept, empty])).toBe(9.24);
  });

  it('sets every proof cell of a row at the smallest size any cell needed, re-cutting the others at it, as the titles do', () => {
    // Every cell fits at the type: nothing is tightened, no row carries a size.
    const whole = frameworkPortraitMatrix([goal(2, { id: 'a' }), goal(1, { id: 'b' })], '', 664);
    expect(whole.proofs.map((cell) => cell.tight)).toEqual([false, false]);
    expect(whole.proofs.flatMap((cell) => cell.rows.map((row) => row.size))).toEqual([undefined, undefined, undefined]);
    // One goal with twelve long proofs beside two with one short proof: the first is tightened and cut, and the row follows it to the
    // tight type (the cell's class, no size on a row); the short cells keep their whole row.
    const tightened = frameworkPortraitMatrix([goal(12, { id: 'a' }), goal(1, { id: 'b' }), goal(1, { id: 'c' })], '', 664);
    expect(tightened.proofs[0].cut).toBeGreaterThan(0);
    expect(tightened.proofs.map((cell) => cell.tight)).toEqual([true, true, true]);
    expect(tightened.proofs.flatMap((cell) => cell.rows.map((row) => row.size))).toEqual(tightened.proofs.flatMap((cell) => cell.rows.map(() => undefined)));
    expect(tightened.proofs[1]).toEqual({ rows: goal(1).proofRows, cut: 0, tight: true, note: '' });
    expect(frameworkPortraitMatrixProofRowSize(tightened.proofs)).toBe(tight);
    // The editor's F3 shape: a kept first proof set smaller carries its size to every cell of the row, the short cells keeping their
    // row at it, and the row's height is measured at that size.
    const sentence = `${long.trim()}. ${long.trim()}.`;
    const wordy = { vp: long.repeat(3).trim(), key: long.repeat(3).trim(), bite: long.trim() };
    const shapes = [
      goal(4, { id: 'g1', n: 1, ...wordy, proofRows: Array.from({ length: 4 }, () => ({ fact: sentence, source: 'Source' })) }),
      goal(1, { id: 'g2', n: 2 }),
      goal(1, { id: 'g3', n: 3 }),
      goal(4, { id: 'g4', n: 4, ...wordy, proofRows: Array.from({ length: 4 }, () => ({ fact: sentence, source: 'Source' })) }),
    ];
    const kept = frameworkPortraitMatrix(shapes, '', 400);
    expect(kept.height).toBeLessThanOrEqual(400);
    const sizes = new Set(kept.proofs.map(sizeOf));
    expect(sizes.size).toBe(1);
    const [size] = [...sizes];
    expect(size).toBeLessThan(tight);
    for (const [index, cell] of kept.proofs.entries()) {
      expect(cell.tight).toBe(true);
      expect(cell.rows.length).toBeGreaterThan(0);
      expect(cell.rows.length + cell.cut).toBe(shapes[index].proofRows.length);
      for (const row of cell.rows) expect(row.size).toBe(size);
    }
    expect(kept.proofs[1].rows).toEqual([{ ...shapes[1].proofRows[0], size }]);
    expect(kept.proofs[1].cut).toBe(0);
  });

  it('prints each band’s proof row of the overfull shape at one size, no cell smaller than its neighbors', () => {
    const matrix = frameworkPortraitMatrix(goals(overfull), crosscut, room);
    expect(matrix.bands).toHaveLength(2);
    expect(matrix.height).toBeLessThanOrEqual(room);
    for (const band of matrix.bands) {
      const cells = matrix.proofs.slice(band.offset, band.offset + band.count);
      expect(new Set(cells.map(sizeOf)).size).toBe(1);
      // The bands dropped their rows before setting the proofs smaller (W1 d): the one size is the tight type's or above.
      expect(sizeOf(cells[0])).toBeGreaterThanOrEqual(tight);
      for (const cell of cells) {
        expect(cell.rows.length).toBeGreaterThan(0);
        expect(cell.rows.length + cell.cut).toBe(4);
      }
    }
  });
});

// The overfull record's Goal 1 "Who it's for" cards (synthetic profiles): two long cards beside "Vendors and cloud providers", whose
// lines are short enough to hold the card at the type's size while its siblings are set smaller (the editor's S-a).
const servedProfiles = [
  {
    id: 'platform-teams',
    name: 'Platform engineering teams',
    need: 'A platform built from projects every vendor supports, so no supplier can hold the roadmap or the price.',
    cta: 'Join the end user community and bring your production needs to the roadmap.',
  },
  {
    id: 'security-teams',
    name: 'Security and compliance teams',
    need: 'Projects that meet a security bar they can cite, with audits, a disclosure process and a verifiable supply chain.',
    cta: 'Read the security audits and join the security technical advisory group.',
  },
  {
    id: 'vendors',
    name: 'Vendors and cloud providers',
    need: 'A level field, a visible seat in the community and a membership that pays back.',
    cta: 'Explore membership and the program committees your team can join.',
  },
];

describe('the framework portrait book’s "Who it’s for" cards (editor S-a)', () => {
  const type = FRAMEWORK_PORTRAIT_TYPE;
  const width = MKTG_PORTRAIT_PAGE.contentWidth;
  // Three cards across the page: a card's text width, and the room the goal page leaves a card's three lines (the component's measure:
  // under the label and the row's margin, inside the card's padding and border, less the two fixed gaps between the lines).
  const cardWidth = (width - 2 * FRAMEWORK_PORTRAIT_ROOM.servedGap) / 3 - FRAMEWORK_PORTRAIT_ROOM.cardPaddingSide;
  const room =
    FRAMEWORK_PORTRAIT_TOPS.footer -
    FRAMEWORK_PORTRAIT_TOPS.goalServed -
    FRAMEWORK_PORTRAIT_ROOM.label -
    FRAMEWORK_PORTRAIT_ROOM.servedTop -
    FRAMEWORK_PORTRAIT_ROOM.cardPadding -
    FRAMEWORK_PORTRAIT_ROOM.cardBorder -
    FRAMEWORK_PORTRAIT_ROOM.servedLineTop -
    FRAMEWORK_PORTRAIT_ROOM.servedLineGap;
  const height = (card: { name: { text: string; size: number }; need: { text: string; size: number }; cta: { text: string; size: number } }) =>
    mktgPortraitParaHeight({ text: card.name.text, size: card.name.size, line: type.servedName.line, weight: type.servedName.weight }, cardWidth) +
    mktgPortraitParaHeight({ text: `Needs ${card.need.text}`, size: card.need.size, line: type.servedLine.line }, cardWidth) +
    mktgPortraitParaHeight({ text: `Ask them to ${card.cta.text}`, size: card.cta.size, line: type.servedLine.line }, cardWidth);

  it('sets every card of the row at the one size the longest card needs, never one card larger than its siblings', () => {
    // The record's Goal 1 at the goal page's room: alone, "Vendors and cloud providers" holds a larger size than the two long cards
    // (the editor's S-a on p03/p06/p09); in the row it takes theirs.
    const alone = frameworkPortraitServedCards([servedProfiles[2]], cardWidth, room);
    const cards = frameworkPortraitServedCards(servedProfiles, cardWidth, room);
    expect(cards.map((card) => card.id)).toEqual(['platform-teams', 'security-teams', 'vendors']);
    expect(cards[0].need.size).toBeLessThan(type.servedLine.size);
    expect(alone[0].need.size).toBeGreaterThan(cards[0].need.size);
    // One size across the row: the name's, the need's and the ask's, each the same on every card, the short card's with them.
    expect(new Set(cards.map((card) => card.name.size)).size).toBe(1);
    expect(new Set(cards.map((card) => card.need.size)).size).toBe(1);
    expect(new Set(cards.map((card) => card.cta.size)).size).toBe(1);
    expect(cards[2].need.size).toBe(cards[0].need.size);
    expect(cards[2].name.size).toBe(cards[0].name.size);
    // Nothing is cut and every card holds its room at the row's size; the leads the template sets in bold are not in the text.
    expect(cards.map((card) => card.need.text)).toEqual(servedProfiles.map((profile) => profile.need));
    expect(cards.map((card) => card.cta.text)).toEqual(servedProfiles.map((profile) => profile.cta));
    for (const card of cards) expect(height(card)).toBeLessThanOrEqual(room + 0.01);
  });

  it('leaves a row that fits as written at the type’s size, and at the floor cuts only the cards that need it', () => {
    const roomy = frameworkPortraitServedCards(servedProfiles, cardWidth, 1000);
    expect(roomy.map((card) => [card.name.size, card.need.size, card.cta.size])).toEqual(
      servedProfiles.map(() => [type.servedName.size, type.servedLine.size, type.servedLine.size])
    );
    expect(roomy.map((card) => card.name.text)).toEqual(servedProfiles.map((profile) => profile.name));
    // A row at the fit model's floor: the two long cards are cut at a sentence; the short one, set at the floor with them, prints whole.
    const floor = frameworkPortraitServedCards(servedProfiles, cardWidth, 60);
    expect(new Set(floor.map((card) => card.need.size)).size).toBe(1);
    expect(floor.map((card) => card.need.text.endsWith('…'))).toEqual([true, true, false]);
    expect(floor[2].need.text).toBe(servedProfiles[2].need);
    expect(frameworkPortraitServedCards([], cardWidth, 100)).toEqual([]);
  });
});

describe('the framework portrait book’s goal matrix measured on the glyph table (the editor’s read of the dropped proof row)', () => {
  const column = frameworkPortraitMatrixColumn(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns);
  const type = FRAMEWORK_PORTRAIT_TYPE;
  const key = 'The cloud native stack is open, governed in the open and run everywhere.';

  it('wraps a band cell word by word on the glyph measure, a line under the flat average in the band’s column, never cutting', () => {
    // The family seeds' key message in a 130 px column: the flat average counts five lines, the glyph table four, as the page prints it.
    const flat = frameworkPortraitTextHeight(key, type.matrixKey, column);
    const glyph = frameworkPortraitGlyphTextHeight(key, type.matrixKey, column);
    expect(flat).toBeCloseTo(5 * type.matrixKey.size * type.matrixKey.line, 6);
    expect(glyph).toBeCloseTo(4 * type.matrixKey.size * type.matrixKey.line, 6);
    // A short text is one line; an empty one keeps its line; a hard break adds one.
    expect(frameworkPortraitGlyphTextHeight('Open.', type.matrixKey, column)).toBeCloseTo(type.matrixKey.size * type.matrixKey.line, 6);
    expect(frameworkPortraitGlyphTextHeight('', type.matrixKey, column)).toBeCloseTo(type.matrixKey.size * type.matrixKey.line, 6);
    expect(frameworkPortraitGlyphTextHeight('Open.\nEverywhere.', type.matrixKey, column)).toBeCloseTo(2 * type.matrixKey.size * type.matrixKey.line, 6);
    // A word wider than the column breaks inside it (the cells' overflow-wrap), counted by the pieces it needs.
    const wide = 'Supercalifragilisticexpialidocious-interoperability';
    expect(frameworkPortraitGlyphTextHeight(wide, type.matrixKey, column)).toBeGreaterThan(type.matrixKey.size * type.matrixKey.line);
    expect(frameworkPortraitGlyphTextHeight(`${wide} ok`, type.matrixKey, column)).toBeCloseTo(
      frameworkPortraitGlyphTextHeight(wide, type.matrixKey, column),
      6
    );
    // The book's family widens or narrows the measure as the grammar's table says: a wide face takes more room than the default, a narrow one less.
    expect(frameworkPortraitGlyphTextHeight(key, type.matrixProofTight, column, "'Montserrat', sans-serif")).toBeGreaterThanOrEqual(
      frameworkPortraitGlyphTextHeight(key, type.matrixProofTight, column, "'Instrument Sans', sans-serif")
    );
  });

  it('lays the bands on the glyph measure for the book’s family, and a strip on the flat one', () => {
    // The overfull record in bands: the matrix is shorter for a narrow face than for a wide one, and the proof row is kept either way.
    const narrow = frameworkPortraitMatrix(goals(overfull), crosscut, room, "'Instrument Sans', sans-serif");
    const wide = frameworkPortraitMatrix(goals(overfull), crosscut, room, "'Montserrat', sans-serif");
    expect(narrow.bands).toHaveLength(2);
    expect(narrow.height).toBeLessThan(wide.height);
    expect([narrow.rows.proof, wide.rows.proof]).toEqual([true, true]);
    expect(Math.max(narrow.height, wide.height)).toBeLessThanOrEqual(room);
    // A strip (four goals) is the fit model's: the family changes nothing.
    const strip = frameworkPortraitMatrix(goals(overfull.slice(0, 4)), crosscut, room);
    expect(strip.bands).toHaveLength(1);
    expect(frameworkPortraitMatrix(goals(overfull.slice(0, 4)), crosscut, room, "'Montserrat', sans-serif")).toEqual(strip);
  });
});

describe('the framework portrait book’s goal matrix head row (editor FA1)', () => {
  // The family seeds' shape: goal names of forty characters and more, on the overfull record's keys and proofs.
  const longTitles = [
    'Adoption across every cloud and vendor',
    'Contributors and maintainers of the projects',
    'Certification for the engineers employers hire',
    'End users who shape the roadmap they depend on',
    'Events in every region of the world',
    'Security as a shared industry practice',
    'Membership that funds the neutral home',
    'Education from the first container onward',
  ];
  const type = FRAMEWORK_PORTRAIT_TYPE;

  it('prints every goal name whole in the head row, at one size, and grows the row to hold them; clamps stay in the body', () => {
    const named = goals(overfull).map((goal, index) => ({ ...goal, t: longTitles[index] }));
    const matrix = frameworkPortraitMatrix(named, crosscut, room);
    expect(matrix.bands).toHaveLength(2);
    expect(matrix.cells.map((cell) => cell.title.text)).toEqual(longTitles);
    expect(matrix.cells.some((cell) => cell.title.text.includes('…'))).toBe(false);
    expect(new Set(matrix.cells.map((cell) => cell.title.size)).size).toBe(1);
    expect(matrix.cells[0].title.size).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin);
    // The head row grows: the long names take more lines than the record's one-word titles, and the matrix is taller by that much
    // at a room that holds everything (the proofs at the normal type in both).
    const wide = frameworkPortraitMatrix(named, '', 2000);
    const wideShort = frameworkPortraitMatrix(goals(overfull), '', 2000);
    const column = frameworkPortraitMatrixColumn(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns);
    // A band's cells are measured on the glyph table (the editor's read of 7 Nov 2026: the flat average dropped a proof row over an empty page).
    const tallest = (titles: readonly string[]) =>
      Math.max(...titles.map((title) => frameworkPortraitGlyphTextHeight(title, { ...type.matrixGoal, size: wide.cells[0].title.size }, column)));
    const grown =
      tallest(longTitles.slice(0, 4)) -
      tallest(overfull.slice(0, 4).map((goal) => goal[0])) +
      (tallest(longTitles.slice(4)) - tallest(overfull.slice(4).map((goal) => goal[0])));
    expect(wide.height - wideShort.height).toBeCloseTo(grown, 6);
    expect(grown).toBeGreaterThan(0);
    // On the page the growth comes off the body: the key messages still print whole and the matrix stays in its room; on the
    // table's default width even the folded proof row ends under the buffer above the footer gap, so the row goes (the ladder, below).
    expect(matrix.height).toBeLessThanOrEqual(room);
    expect(matrix.cells.map((cell) => cell.key.text)).toEqual(overfull.map((goal) => goal[2]));
    expect(matrix.rows.proof).toBe(false);
    expect(matrix.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesAll]);
    // A strip of four long names: whole as well, one size, in its room.
    const strip = frameworkPortraitMatrix(named.slice(0, 4), crosscut, room);
    expect(strip.bands).toEqual([{ offset: 0, count: 4, columns: 4 }]);
    expect(strip.cells.map((cell) => cell.title.text)).toEqual(longTitles.slice(0, 4));
    expect(strip.height).toBeLessThanOrEqual(room);
  });

  it('folds the cells’ "+N more" lines into the caption before any proof goes, and drops the proof row when even folded it ends under the buffer above the footer gap (FA1b, the maintainer’s fold step, the editor’s 12 px)', () => {
    // The family seeds' shape (the long names on the overfull record's key messages and proofs) on its page, in the record's brand
    // face: with the cells' own "+3 more" lines the proof row would end under the buffer, so the lines fold into the one caption
    // (the drop note as is plus one sentence, on one line) and every goal keeps one whole first proof at the tight type; the key
    // messages print whole; the matrix ends the buffer or more above the footer gap.
    const named = goals(overfull).map((goal, index) => ({ ...goal, t: longTitles[index] }));
    const face = "'Instrument Sans', sans-serif";
    const folded = frameworkPortraitMatrix(named, crosscut, room, face);
    expect(folded.bands).toHaveLength(2);
    expect(folded.rows).toEqual({ value: false, bite: false, proof: true });
    expect(folded.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesFold]);
    expect(folded.notes).toEqual(['Value propositions and sound bites are on each goal page. More proofs for each goal are in LFX One.']);
    expect(folded.proofs).toHaveLength(8);
    expect(folded.proofs.every((cell) => cell.rows.length === 1 && cell.cut === 3 && cell.note === '' && cell.tight)).toBe(true);
    for (const cell of folded.proofs) expect(cell.rows[0].size ?? type.matrixProofTight.size).toBeGreaterThanOrEqual(type.matrixProofTight.size);
    expect(folded.cells.map((cell) => cell.key.text)).toEqual(overfull.map((goal) => goal[2]));
    expect(room - folded.height).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixBuffer);
    // The one caption stays on its line in every face the books set (the fold's saving is the whole cell line, ≈21 px a band).
    const captionWidth = MKTG_PORTRAIT_PAGE.contentWidth - FRAMEWORK_PORTRAIT_ROOM.matrixPadding;
    for (const family of [undefined, face, "'Inter', sans-serif", "'Montserrat', sans-serif"])
      expect(frameworkPortraitGlyphTextHeight(FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesFold, type.cutNote, captionWidth, family)).toBe(
        type.cutNote.size * type.cutNote.line
      );
    // The fold is what keeps the row: the cells' own lines are one caption line a cell, and with them the row ends under the buffer.
    const noteLine = frameworkPortraitCutNoteHeightIn(1, frameworkPortraitMatrixColumn(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns));
    expect(folded.height + 2 * noteLine + FRAMEWORK_PORTRAIT_ROOM.matrixBuffer).toBeGreaterThan(room);
    // The record's first proofs in that face, lines at the tight type in a band's column: never six, the row's height is the tallest.
    const column = frameworkPortraitMatrixColumn(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns);
    const lines = (family?: string) =>
      named.map(
        (goal) =>
          frameworkPortraitGlyphTextHeight(`${goal.proofRows[0].fact} ${goal.proofRows[0].source}`, type.matrixProofTight, column, family) /
          (type.matrixProofTight.size * type.matrixProofTight.line)
      );
    expect(lines(face)).toEqual([5, 4, 4, 5, 5, 4, 4, 4]);
    expect(lines()).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    // On the table's default width (no face) the same shape, folded, ends a few px above the footer gap, under the buffer: the proof
    // row goes to the goal pages, every cell empty, the note naming all three rows.
    const dropped = frameworkPortraitMatrix(named, crosscut, room);
    expect(dropped.bands).toHaveLength(2);
    expect(dropped.rows).toEqual({ value: false, bite: false, proof: false });
    expect(dropped.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesAll]);
    expect(dropped.notes).toEqual(['Value propositions, sound bites and proofs are on each goal page.']);
    expect(dropped.proofs).toHaveLength(8);
    expect(dropped.proofs.every((cell) => cell.rows.length === 0 && cell.cut === 0 && cell.note === '')).toBe(true);
    expect(dropped.cells.map((cell) => cell.key.text)).toEqual(overfull.map((goal) => goal[2]));
    expect(dropped.cells.some((cell) => cell.key.text.includes('…'))).toBe(false);
    expect(dropped.cells.map((cell) => cell.title.text)).toEqual(longTitles);
    expect(dropped.height).toBeLessThanOrEqual(room);
    // ... and a little more room (the buffer's worth) folds it instead: the drop was the buffer's, not the floor's.
    const almost = frameworkPortraitMatrix(named, crosscut, room + FRAMEWORK_PORTRAIT_ROOM.matrixBuffer);
    expect(almost.rows.proof).toBe(true);
    expect(almost.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesFold]);
    // A wide room needs neither step: the proofs print with their own lines under the plain caption.
    const wide = frameworkPortraitMatrix(named, crosscut, room * 2);
    expect(wide.rows.proof).toBe(true);
    expect(wide.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages]);
    expect(wide.proofs.every((cell) => cell.cut === 0 || cell.note !== '')).toBe(true);
    // The overfull record itself keeps its proofs (one row at the tight floor) with their own "+3 more" lines and the plain caption:
    // nothing moves on its page.
    const kept = frameworkPortraitMatrix(goals(overfull), crosscut, room);
    expect(kept.rows).toEqual({ value: false, bite: false, proof: true });
    expect(kept.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages]);
    expect(kept.proofs.every((cell) => cell.rows.length === 1 && cell.cut === 3 && cell.note === '+3 more in LFX One')).toBe(true);
    for (const cell of kept.proofs)
      for (const row of cell.rows) expect(row.size ?? type.matrixProofTight.size).toBeGreaterThanOrEqual(type.matrixProofTight.size);
    expect(kept.height).toBeLessThanOrEqual(room);
  });

  it('re-measures the bands after each step: the room the dropped rows freed goes to the proof row first, in its minimal format, by need and not in halves, and the proofs drop only when that row does not fit (the editor’s rule, 7 Nov 2026)', () => {
    // The measures the ladder re-takes at the bands' level, on the glyph table as the bands are measured: each band's head (at the
    // title size the layout chose) and its whole key messages, the chrome around the bands at each level's caption, and the proof
    // row's minimal format (one whole first proof at the tight type, beside the note counting the rest or without it, folded).
    const named = goals(overfull).map((goal, index) => ({ ...goal, t: longTitles[index] }));
    const column = frameworkPortraitMatrixColumn(FRAMEWORK_PORTRAIT_ROOM.matrixBandColumns);
    const bandsOf = (all: readonly FoundationMessagePrintGoal[]) => [all.slice(0, 4), all.slice(4)];
    const fixed = (band: readonly FoundationMessagePrintGoal[], titleSize: number) =>
      2 * FRAMEWORK_PORTRAIT_ROOM.matrixRow +
      type.cutNote.size * type.cutNote.line +
      3 +
      Math.max(...band.map((goal) => frameworkPortraitGlyphTextHeight(goal.t, { ...type.matrixGoal, size: titleSize }, column))) +
      Math.max(...band.map((goal) => frameworkPortraitGlyphTextHeight(goal.key, type.matrixKey, column)));
    const minimal = (band: readonly FoundationMessagePrintGoal[], fold: boolean) =>
      FRAMEWORK_PORTRAIT_ROOM.matrixRow +
      Math.max(
        ...band.map(
          (goal) =>
            frameworkPortraitGlyphTextHeight(`${goal.proofRows[0].fact} ${goal.proofRows[0].source}`, type.matrixProofTight, column) +
            FRAMEWORK_PORTRAIT_ROOM.matrixProofGap +
            (fold ? 0 : frameworkPortraitCutNoteHeightIn(goal.proofRows.length - 1, column))
        )
      );
    const captionWidth = MKTG_PORTRAIT_PAGE.contentWidth - FRAMEWORK_PORTRAIT_ROOM.matrixPadding;
    const free = (caption: string) =>
      room -
      FRAMEWORK_PORTRAIT_ROOM.matrixBuffer -
      FRAMEWORK_PORTRAIT_ROOM.matrixCrosscutGap -
      frameworkPortraitTextHeight(crosscut, type.matrixCrosscut, captionWidth) -
      FRAMEWORK_PORTRAIT_ROOM.cutNoteGap -
      frameworkPortraitGlyphTextHeight(caption, type.cutNote, captionWidth) -
      FRAMEWORK_PORTRAIT_ROOM.matrixBandGap;
    // The long names on the record's proofs (facts of a hundred characters and more), on the table's default width: the two bands'
    // heads and whole key messages leave less than the two minimal proof rows need, with their notes and folded, so the proofs truly
    // do not fit and the row goes.
    const dropped = frameworkPortraitMatrix(named, crosscut, room);
    const titleSize = dropped.cells[0].title.size;
    for (const fold of [false, true]) {
      const need = bandsOf(named).reduce((sum, band) => sum + fixed(band, titleSize) + minimal(band, fold), 0);
      expect(need).toBeGreaterThan(free(fold ? FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesFold : FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages));
    }
    expect(dropped.rows).toEqual({ value: false, bite: false, proof: false });
    // Long names in the first band only, a first proof of a sentence: the minimal rows fit the room the key messages leave, so the
    // proofs are KEPT with their notes, every cell one whole proof at the tight type or better, the note saying what moved to the goal
    // pages, in the room ...
    const mixed = goals(overfull).map((goal, index) => ({
      ...goal,
      t: index < 4 ? longTitles[index] : goal.t,
      proofRows: [{ fact: 'Runs in production at 96% of the organizations surveyed last year', source: 'Survey' }, ...goal.proofRows.slice(1)],
    }));
    const kept = frameworkPortraitMatrix(mixed, crosscut, room);
    const need = bandsOf(mixed).map((band) => fixed(band, kept.cells[0].title.size) + minimal(band, false));
    expect(need[0] + need[1]).toBeLessThanOrEqual(free(FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages));
    // ... and an equal share of the room would have starved the taller band: the measure the ladder took before this fix.
    expect(Math.max(...need)).toBeGreaterThan(free(FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages) / 2);
    expect(kept.bands).toHaveLength(2);
    expect(kept.rows).toEqual({ value: false, bite: false, proof: true });
    expect(kept.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPages]);
    expect(kept.proofs).toHaveLength(8);
    for (const cell of kept.proofs) {
      expect(cell.rows.length).toBeGreaterThanOrEqual(1);
      expect(cell.rows[0].fact).toBe('Runs in production at 96% of the organizations surveyed last year');
      expect(cell.rows.length + cell.cut).toBe(4);
      expect(cell.note).toBe(`+${cell.cut} more in LFX One`);
      for (const row of cell.rows)
        expect(row.size ?? (cell.tight ? type.matrixProofTight.size : type.matrixProof.size)).toBeGreaterThanOrEqual(type.matrixProofTight.size);
    }
    expect(frameworkPortraitMatrixProofRowSize(kept.proofs)).toBeGreaterThanOrEqual(type.matrixProofTight.size);
    expect(kept.cells.map((cell) => cell.key.text)).toEqual(overfull.map((goal) => goal[2]));
    expect(kept.cells.map((cell) => cell.title.text)).toEqual(mixed.map((goal) => goal.t));
    expect(room - kept.height).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixBuffer);
    expect(kept.height).toBeGreaterThan(dropped.height);
  });
});
