// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the framework portrait book's list rule and key numbers
// pages: a list is tightened before it is cut and the cut is said under it;
// the figures print as tiles by their count up to six, past that as a table
// of every one, continued on another page when a page fills. Every fixture
// is synthetic.

import { describe, expect, it } from 'vitest';

import { FRAMEWORK_PORTRAIT_MAX_TILES, FRAMEWORK_PORTRAIT_NUMBER_TILE, FRAMEWORK_PORTRAIT_TOPS } from '../constants/mktg-print.constants';
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import {
  foundationMessagePrintCutNote,
  frameworkPortraitCutList,
  frameworkPortraitCutNoteHeight,
  frameworkPortraitNumberTiles,
  frameworkPortraitNumbersPages,
} from './mktg-framework-portrait-layout.utils';
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
    expect(frameworkPortraitCutList(rows, 120, normal, tight)).toEqual({ rows, cut: 0, tight: false });
  });

  it('tightens first: every row at the tight measure when that is what fits', () => {
    expect(frameworkPortraitCutList(rows, 100, normal, tight)).toEqual({ rows, cut: 0, tight: true });
  });

  it('then cuts to the leading whole rows that fit beside the note, and counts the rest', () => {
    const note = frameworkPortraitCutNoteHeight();
    expect(note).toBeCloseTo(6 + 10.5 * 1.4);
    // Four tight rows are 80: at 79 the list is cut, and the rows that stay (three at 60) must leave the note its room too.
    expect(frameworkPortraitCutList(rows, 79, normal, tight)).toEqual({ rows: ['a', 'b'], cut: 2, tight: true });
    expect(frameworkPortraitCutList(rows, 40 + note, normal, tight)).toEqual({ rows: ['a', 'b'], cut: 2, tight: true });
    expect(frameworkPortraitCutList(rows, 39 + note, normal, tight)).toEqual({ rows: ['a'], cut: 3, tight: true });
    expect(frameworkPortraitCutList([], 0, normal, tight)).toEqual({ rows: [], cut: 0, tight: false });
  });

  it('words the note from the count', () => {
    expect(foundationMessagePrintCutNote(3)).toBe("+3 more in the framework's Sources tab in LFX One");
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
    expect(pages[0].facts).toMatchObject({ cut: 0, tight: false });
    expect(pages[0].facts.rows).toHaveLength(3);
    // Five tiles take two rows too (three, then two); one tile takes one.
    expect(frameworkPortraitNumbersPages(view(5))[0].factsTop).toBe(534);
    expect(frameworkPortraitNumbersPages(view(1))[0].factsTop).toBe(378);
    expect(frameworkPortraitNumbersPages(view(0))[0]).toMatchObject({ tiles: [], numbersTable: [], factsTop: tile.top });
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
