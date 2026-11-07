// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Messaging Framework's portrait plan: the pages follow
// the data (one page per goal, two profiles a page), the ids are stable, the
// family drops the cover. Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import { FRAMEWORK_PORTRAIT_SEP } from '../constants/mktg-print.constants';
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import { frameworkPortraitIcpPages } from './mktg-framework-portrait-layout.utils';
import { frameworkPortraitPlan } from './mktg-framework-portrait-plan.utils';
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
      ['goal-1', '01 Framework', `Goal 1${FRAMEWORK_PORTRAIT_SEP}Goal 1 title`],
      ['goal-2', '01 Framework', `Goal 2${FRAMEWORK_PORTRAIT_SEP}Goal 2 title`],
      ['goal-3', '01 Framework', `Goal 3${FRAMEWORK_PORTRAIT_SEP}Goal 3 title`],
      ['goal-4', '01 Framework', `Goal 4${FRAMEWORK_PORTRAIT_SEP}Goal 4 title`],
      ['say-avoid', '01 Framework', `Say and avoid${FRAMEWORK_PORTRAIT_SEP}anchor questions`],
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

  it('adds key numbers pages as the figures need them: one page to six figures and for a short table, "Key numbers (2)" when the table runs on', () => {
    const withNumbers = (count: number) =>
      frameworkPortraitPlan(
        buildFoundationMessagePrintView(
          { ...content(1, 1), nums: Array.from({ length: count }, (_, index) => pair(`${index + 1}`, `figure ${index + 1}`)) },
          'TestOrbit',
          1,
          null
        ),
        { inFamily: false }
      );
    expect(
      withNumbers(6)
        .filter((page) => page.section === '04 Key numbers')
        .map((page) => page.id)
    ).toEqual(['key-numbers']);
    expect(
      withNumbers(9)
        .filter((page) => page.section === '04 Key numbers')
        .map((page) => page.id)
    ).toEqual(['key-numbers']);
    const many = withNumbers(40).filter((page) => page.section === '04 Key numbers');
    expect(many.map((page) => [page.id, page.title])).toEqual([
      ['key-numbers', 'Key numbers'],
      ['key-numbers-2', 'Key numbers (2)'],
    ]);
    expect(
      withNumbers(40)
        .map((page) => page.id)
        .slice(-3)
    ).toEqual(['key-numbers', 'key-numbers-2', 'sources']);
  });

  it('keys a goal page on the goal’s position, never its number: two goals sharing an `n` both get a page, each titled with its own number', () => {
    // The validator asks only that `n` be a positive integer, so a hand-edited record may repeat one.
    const base = content(3, 1);
    const twins = { ...base, mf: { ...base.mf, goals: base.mf.goals.map((goal, index) => (index === 2 ? { ...goal, n: 2 } : goal)) } };
    const view = buildFoundationMessagePrintView(twins, 'TestOrbit', 1, null);
    const goalPages = frameworkPortraitPlan(view, { inFamily: false }).filter((page) => page.id.startsWith('goal-'));
    expect(goalPages.map((page) => page.id)).toEqual(['goal-1', 'goal-2', 'goal-3']);
    expect(goalPages.map((page) => page.title.slice(0, 6))).toEqual(['Goal 1', 'Goal 2', 'Goal 2']);
    expect(goalPages.map((page) => page.title.endsWith(view.goals[Number(page.id.slice('goal-'.length)) - 1].t))).toEqual([true, true, true]);
  });

  it('pages the profiles two a page in data order, the last page taking one when the count is odd', () => {
    const view = buildFoundationMessagePrintView(content(1, 5), 'TestOrbit', 1, null);
    expect(frameworkPortraitIcpPages(view.icps).map((page) => page.icps.map((row) => row.id))).toEqual([['i1', 'i2'], ['i3', 'i4'], ['i5']]);
    expect(frameworkPortraitIcpPages(view.icps).map((page) => page.tight)).toEqual([false, false, false]);
    expect(frameworkPortraitIcpPages([])).toEqual([]);
  });
});
