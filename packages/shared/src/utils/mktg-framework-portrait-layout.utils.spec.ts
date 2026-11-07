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
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import {
  foundationMessagePrintCutNote,
  frameworkPortraitCutList,
  frameworkPortraitCutNoteHeight,
  frameworkPortraitFigureSize,
  frameworkPortraitNumberTiles,
  frameworkPortraitNumbersPages,
  frameworkPortraitChipWidth,
  frameworkPortraitIcpWhoWidth,
  frameworkPortraitAnchors,
  frameworkPortraitAvoidList,
  frameworkPortraitBodyTop,
  frameworkPortraitContents,
  frameworkPortraitContentsHeight,
  frameworkPortraitContentsRoom,
  frameworkPortraitCutNoteHeightIn,
  frameworkPortraitHouse,
  frameworkPortraitIcpHeight,
  frameworkPortraitIcpMatrixHeight,
  frameworkPortraitIcpPages,
  frameworkPortraitIcpRoom,
  frameworkPortraitMatrix,
  frameworkPortraitMatrixColumn,
  frameworkPortraitPillList,
  frameworkPortraitPillarHeadHeight,
  frameworkPortraitPillarProofHeight,
  frameworkPortraitPillsHeight,
  frameworkPortraitSayRoom,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  frameworkPortraitTextHeight,
  frameworkPortraitTitle,
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

const view = (numbers: number, proofs = 1) => buildFoundationMessagePrintView(content(numbers, proofs), 'TestOrbit', 1, null);

describe('the framework portrait book’s cut lists', () => {
  const rows = ['a', 'b', 'c', 'd'];
  const normal = () => 30;
  const tight = () => 20;

  it('keeps every row at the normal measure when they fit', () => {
    expect(frameworkPortraitCutList(rows, 120, 'Framework', normal, tight)).toEqual({ rows, cut: 0, tight: false, note: '' });
  });

  it('tightens first: every row at the tight measure when that is what fits', () => {
    expect(frameworkPortraitCutList(rows, 100, 'Framework', normal, tight)).toEqual({ rows, cut: 0, tight: true, note: '' });
  });

  it('then cuts to the leading whole rows that fit beside the note, and counts the rest', () => {
    const note = frameworkPortraitCutNoteHeight();
    expect(note).toBeCloseTo(6 + 10.5 * 1.4);
    // Four tight rows are 80: at 79 the list is cut, and the rows that stay (three at 60) must leave the note its room too.
    const cutTo = (kept: string[], cut: number) => ({ rows: kept, cut, tight: true, note: `+${cut} more on the framework's Framework tab in LFX One` });
    expect(frameworkPortraitCutList(rows, 79, 'Framework', normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 40 + note, 'Framework', normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 39 + note, 'Framework', normal, tight)).toEqual(cutTo(['a'], 3));
    // A room too small for any row still says what was cut: the note carries the count, the rows are none.
    expect(frameworkPortraitCutList(rows, 10, 'Framework', normal, tight)).toEqual(cutTo([], 4));
    expect(frameworkPortraitCutList([], 0, 'Framework', normal, tight)).toEqual({ rows: [], cut: 0, tight: false, note: '' });
  });

  it('words the note from the count and the tab the rows live on', () => {
    expect(foundationMessagePrintCutNote(3, 'Sources')).toBe("+3 more on the framework's Sources tab in LFX One");
    expect(foundationMessagePrintCutNote(1, 'Framework')).toBe("+1 more on the framework's Framework tab in LFX One");
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
    expect(frameworkPortraitTitle('Framework')).toEqual({ text: 'Framework', size: 34, lines: 1 });
    expect(frameworkPortraitBodyTop(frameworkPortraitTitle('Framework'))).toBe(136);
    const longTitle = 'Goal 2 · Grow adoption across the enterprise';
    const fitted = frameworkPortraitTitle(longTitle);
    expect(fitted).toEqual({ text: longTitle, size: fitted.size, lines: 1 });
    expect(fitted.size).toBeLessThan(34);
    expect(fitted.size).toBeGreaterThanOrEqual(25);
    expect(mktgPortraitCharsPerLine(704, fitted.size, { weight: 500 })).toBeGreaterThanOrEqual(longTitle.length);
    const wrapped = frameworkPortraitTitle(`Goal 3 · ${long.trim()}`);
    expect(wrapped).toEqual({ text: `Goal 3 · ${long.trim()}`, size: 25, lines: 3 });
    expect(frameworkPortraitBodyTop(wrapped)).toBe(136 + 2 * 25 * 1.1);
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
    expect(whole.cells).toEqual([{ vp: { text: 'Value', size: 11 }, key: { text: 'Key', size: 11 }, bite: { text: 'Bite', size: 12.5 } }]);
    expect(whole.height).toBeLessThanOrEqual(664);
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
    expect(frameworkPortraitPillsHeight(cut.rows, 320, true) + frameworkPortraitCutNoteHeightIn(cut.cut, 'Framework', 320)).toBeLessThanOrEqual(
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
    ({
      mh: { umbrella: 'Umbrella.', line: 'Brand line.', pillars, found, aud: [] },
      pillars,
      audiences: Array.from({ length: audiences }, (_, index) => ({ name: `Audience ${index}`, lead: 'A lead sentence for the audience row.' })),
    }) as unknown as FoundationMessagePrintView;
  const pillar = (proofs: number, message = 'A message.'): FoundationMessagePillarView => ({
    t: 'Open',
    m: message,
    p: [],
    proofRows: Array.from({ length: proofs }, () => ({ fact: 'A fact about the project that runs to a second line in a column.', source: 'Web' })),
  });

  it('measures a pillar: its rule, title and message, and each proof row with its chip', () => {
    expect(frameworkPortraitPillarHeadHeight(pillar(0, ''), 221)).toBe(15 + 16 * 1.25);
    expect(frameworkPortraitPillarHeadHeight(pillar(1), 221)).toBe(15 + 16 * 1.25 + 8 + 12.5 * 1.5);
    expect(frameworkPortraitPillarProofHeight(pillar(1).proofRows[0], 221)).toBe(17 + 2 * 11.5 * 1.45 + 20.5);
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
    { id: 'framework', section: '01 Framework', title: 'Framework' },
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
    expect(short.rows[0]).toEqual({ id: 'framework', title: 'Framework', number: 2, numberLabel: '02' });
    // The record's cap: eight goals, ten profile pages, two numbers pages, 25 frames: 24 rows in twelve pairs, tight, every page listed.
    const cap = frameworkPortraitContents(plan(8, 10, 2), 1);
    expect(frameworkPortraitContentsHeight(24, false)).toBeGreaterThan(frameworkPortraitContentsRoom());
    expect(cap).toMatchObject({ tight: true, collapsed: false });
    expect(cap.rows).toHaveLength(24);
    expect(frameworkPortraitContentsHeight(cap.rows.length, true)).toBeLessThanOrEqual(frameworkPortraitContentsRoom());
  });

  it('collapses each run of repeated pages to one row with its page range when the tight rows still pass the strip, dropping no page', () => {
    // Beyond the record (41 frames): the goals, the profile pages and the continued table each become one row with a range.
    const long = frameworkPortraitContents(plan(8, 24, 4), 1);
    expect(frameworkPortraitContentsHeight(40, true)).toBeGreaterThan(frameworkPortraitContentsRoom());
    expect(long.collapsed).toBe(true);
    expect(long.rows.map((row) => [row.title, row.numberLabel])).toEqual([
      ['Framework', '02'],
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
    ({
      id,
      name: `Profile ${id}`,
      kind: 'Segment',
      who: sentence.repeat(repeat).trim(),
      need: sentence.repeat(repeat).trim(),
      value: sentence.repeat(repeat).trim(),
      lead: sentence.repeat(repeat).trim(),
      cta: sentence.repeat(repeat).trim(),
      objectionText: 'Too early?',
      objectionResponse: sentence.repeat(repeat).trim(),
      channelsLabel: 'Docs · Slack',
      proofRows: [{ fact: 'A fact.', source: 'Docs' }],
      personaRows: Array.from({ length: personas }, (_, index) => ({ role: `Role ${index}`, cares: sentence.trim() })),
      goalChips: ['Goal 1'],
      whoWidth: 190,
    }) as unknown as FoundationMessagePrintIcp;

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
    // One card alone past the room: its fields set tight; the page still holds the one card.
    const tall = frameworkPortraitIcpPages([icp('a', 14, 3)]);
    expect(frameworkPortraitIcpHeight(icp('a', 14, 3))).toBeGreaterThan(frameworkPortraitIcpRoom(1));
    expect(tall).toEqual([{ icps: [icp('a', 14, 3)], tight: true, height: frameworkPortraitIcpHeight(icp('a', 14, 3), true) }]);
    // The matrix under a lone card: label, note, head row and one row per profile.
    expect(frameworkPortraitIcpMatrixHeight(4)).toBe(26 + 4 + 11.5 * 1.5 + 12 + 13 + 2 * 9.5 * 1.4 + 4 * (19 + 12 * 1.4));
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
    // The figure never goes under half its size: a very long figure stops there.
    expect(frameworkPortraitFigureSize('1,234,567,890,123,456', content)).toBe(27);
  });

  it('keeps at least one row on every fresh page, so a row taller than a page still moves the table on', () => {
    const tall = 'x\n'.repeat(80).trim();
    const base = view(6, 1);
    const pages = frameworkPortraitNumbersPages({
      ...base,
      numbers: [...base.numbers, { number: '9', label: tall, source: '' }, { number: '10', label: 'after', source: '' }],
    });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.flatMap((page) => page.numbersTable.map((row) => row.number))).toEqual(['1000', '2000', '3000', '4000', '5000', '6000', '9', '10']);
    expect(pages.some((page) => page.numbersTable.length === 1 && page.numbersTable[0].label === tall)).toBe(true);
  });

  it('past six prints the table of every figure, and continues it on more pages when a page fills, the facts last', () => {
    const nine = frameworkPortraitNumbersPages(view(9, 2));
    expect(nine).toHaveLength(1);
    expect(nine[0].tiles).toEqual([]);
    expect(nine[0].numbersTable.map((row) => row.number)).toEqual(['1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000', '9000']);
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
