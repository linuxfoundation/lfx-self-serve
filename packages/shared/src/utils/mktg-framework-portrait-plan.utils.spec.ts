// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Messaging Framework's portrait plan: the pages follow
// the data (one page per goal, two profiles a page), the ids are stable, the
// family drops the cover. Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import { frameworkPortraitIcpPages, frameworkPortraitPlan } from './mktg-framework-portrait-plan.utils';
import { buildFoundationMessagePrintView } from './mktg-print.utils';
import { mktgPortraitOpensChapter } from './mktg-portrait-plan.utils';

const pair = (a: string, b: string): [string, string] => [a, b];

const icp = (id: string, name: string, goals: string[]): FoundationMessageContent['icp'][number] => ({
  id,
  name,
  kind: 'Individual',
  who: 'People.',
  goals,
  need: 'Need.',
  value: 'Value.',
  lead: 'Lead.',
  proof: [],
  cta: 'Act.',
  channels: ['Docs'],
  objection: ['Why?', null],
  personas: [pair('Role', 'cares')],
  basis: 'Website',
});

const content = (goalCount: number, icpCount: number): FoundationMessageContent => ({
  mf: {
    vision: 'V.',
    mission: 'M.',
    positioning: 'P.',
    tagline: 'T.',
    goals: Array.from({ length: goalCount }, (_, index) => ({
      id: `g${index + 1}`,
      n: index + 1,
      t: `Goal ${index + 1} title`,
      vp: 'VP.',
      key: 'Key.',
      proof: [pair('Fact', 'Source')],
      bite: 'Bite',
      icps: [`i1`],
    })),
    crosscut: '',
    say: [],
    avoid: [],
    anchor: [],
    notes: '',
  },
  icp: Array.from({ length: icpCount }, (_, index) => icp(`i${index + 1}`, `Profile ${index + 1}`, ['g1'])),
  mh: { umbrella: 'U.', line: 'L.', pillars: [], found: 'F.', aud: [] },
  nums: [],
});

const plan = (goalCount: number, icpCount: number, inFamily = false) =>
  frameworkPortraitPlan(buildFoundationMessagePrintView(content(goalCount, icpCount), 'TestOrbit', 1, null), { inFamily });

describe('the framework’s portrait plan', () => {
  it('pages the book from the data: the cover, the framework chapter with one page per goal, the profiles two a page, the house, the numbers, the sources', () => {
    expect(plan(4, 5).map((page) => [page.id, page.section, page.title])).toEqual([
      ['cover', 'Cover', 'Cover'],
      ['framework', '01 Framework', 'Framework'],
      ['goal-1', '01 Framework', 'Goal 1 · Goal 1 title'],
      ['goal-2', '01 Framework', 'Goal 2 · Goal 2 title'],
      ['goal-3', '01 Framework', 'Goal 3 · Goal 3 title'],
      ['goal-4', '01 Framework', 'Goal 4 · Goal 4 title'],
      ['say-avoid', '01 Framework', 'Say and avoid · anchor questions'],
      ['icps-1', '02 ICPs', 'Ideal customer profiles'],
      ['icps-2', '02 ICPs', 'Ideal customer profiles (2)'],
      ['icps-3', '02 ICPs', 'Ideal customer profiles (3)'],
      ['message-house', '03 Message house', 'Message house'],
      ['key-numbers', '04 Key numbers', 'Key numbers'],
      ['sources', '05 Sources', 'Sources & gaps'],
    ]);
  });

  it('counts the pages by the data: 0, 1, 2 and 5 profiles; inside the family the cover goes', () => {
    expect(plan(4, 0)).toHaveLength(10);
    expect(plan(4, 1)).toHaveLength(11);
    expect(plan(4, 2)).toHaveLength(11);
    expect(plan(4, 5)).toHaveLength(13);
    expect(plan(1, 1)).toHaveLength(8);
    expect(plan(4, 5, true)).toHaveLength(12);
    expect(plan(4, 5, true)[0].id).toBe('framework');
    expect(plan(4, 5, true).some((page) => page.id === 'cover')).toBe(false);
  });

  it('opens a chapter on the framework’s first page, the first profile page, the house, the numbers and the sources, never on a goal page', () => {
    const pages = plan(2, 3);
    expect(pages.map((page, index) => mktgPortraitOpensChapter(pages, index))).toEqual([false, true, false, false, false, true, false, true, true, true]);
  });

  it('slices the profiles two a page in data order, the last page taking one when the count is odd', () => {
    const view = buildFoundationMessagePrintView(content(1, 5), 'TestOrbit', 1, null);
    expect(frameworkPortraitIcpPages(view.icps).map((page) => page.map((row) => row.id))).toEqual([['i1', 'i2'], ['i3', 'i4'], ['i5']]);
    expect(frameworkPortraitIcpPages([])).toEqual([]);
  });
});
