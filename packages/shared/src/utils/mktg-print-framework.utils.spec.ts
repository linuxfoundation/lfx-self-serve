// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { FOUNDATION_MESSAGE_PRINT_TITLE } from '../constants/mktg-print.constants';
import { MKTG_PRINT_FRAMEWORK_NUMBERS_PER_PAGE, MKTG_PRINT_FRAMEWORK_SECTIONS } from '../constants/mktg-print-framework.constants';
import { MKTG_PRINT_PAGE_AREA, MKTG_PRINT_PAGE_LEFT, MKTG_PRINT_PAGE_RIGHT } from '../constants/mktg-print-page.constants';
import type { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import type { MktgPrintPage, MktgPrintPageShapeEl } from '../interfaces/mktg-print-page.interface';
import type { FoundationMessagePrintView } from '../interfaces/mktg-print.interface';
import { buildFoundationMessagePrintView } from './mktg-print.utils';
import {
  buildFrameworkPrintPages,
  mktgFrameworkPrintPageCount,
  mktgPrintFrameworkCover,
  mktgPrintFrameworkSectionOf,
  mktgPrintFrameworkSections,
} from './mktg-print-framework.utils';
import { mktgPrintMixHex, mktgPrintPageLook } from './mktg-print-page.utils';

/** A synthetic framework with every part filled once: the deck's slides, one each. */
function content(over: Partial<FoundationMessageContent> = {}): FoundationMessageContent {
  return {
    mf: {
      vision: 'A world where every organisation builds on open, audited infrastructure.',
      mission: 'We maintain a neutral toolkit and fund the work that keeps it trustworthy.',
      positioning: 'For platform teams, the open foundation that turns a checklist into a platform.',
      tagline: 'Open foundations, audited in public.',
      goals: [
        {
          id: 'adoption',
          n: 1,
          t: 'Adoption',
          vp: 'Ship in weeks.',
          key: 'The fastest route.',
          proof: [['1,200,000 downloads', 'Website']],
          bite: 'From empty to compliant',
          icps: ['teams'],
        },
        { id: 'community', n: 2, t: 'Community', vp: 'Reviewed quickly.', key: 'No single company steers.', proof: [], bite: '', icps: ['contributors'] },
      ],
      crosscut: 'Every goal reinforces the others.',
      say: ['open foundations', 'audited in public', 'neutral home'],
      avoid: [['enterprise-ready', 'audited in public and adopted by regulated teams']],
      anchor: ['Which goal does this serve?', 'Which segment is it for?'],
      notes: 'For the reviewer only.',
    },
    icp: [
      {
        id: 'teams',
        name: 'Platform teams',
        kind: 'Organization',
        who: 'Teams who run the internal platform.',
        goals: ['adoption'],
        need: 'A compliant toolchain.',
        value: 'A vetted toolkit.',
        lead: 'The fastest route to a compliant platform.',
        proof: [['Adopted by 38 teams', 'Press release']],
        cta: 'Deploy the reference stack.',
        channels: ['Docs', 'Summit'],
        objection: ['Will this survive a vendor leaving?', 'Governance by contributors.'],
        personas: [['Platform lead', 'predictability']],
        basis: 'Website',
      },
      {
        id: 'contributors',
        name: 'Contributors',
        kind: 'Individual',
        who: 'Engineers who maintain a component.',
        goals: ['community'],
        need: 'Fast reviews.',
        value: 'A public record.',
        lead: 'Your work, reviewed and credited.',
        proof: [],
        cta: 'Open a pull request.',
        channels: [],
        objection: ['Too early?', null],
        personas: [],
        basis: '',
      },
    ],
    mh: {
      umbrella: 'Open foundations for everyone.',
      line: 'Open foundations, audited in public.',
      pillars: [
        { t: 'Open', m: 'Governed in the open.', p: [['3,400 contributors', 'Plan']] },
        { t: 'Audited', m: 'Two audits a year.', p: [['Published since 2024', 'Deck']] },
        { t: 'Neutral', m: 'No single vendor.', p: [] },
      ],
      found: 'A Linux Foundation project.',
      aud: [
        ['Platform teams', 'The fastest route to a compliant platform.'],
        ['Contributors', 'Your work, reviewed and credited.'],
      ],
    },
    nums: [
      ['1.2M', 'downloads'],
      ['3,400', 'contributors'],
    ],
    ...over,
  };
}

function view(over: Partial<FoundationMessageContent> = {}, version: number | null = 3): FoundationMessagePrintView {
  return buildFoundationMessagePrintView(content(over), 'Project One', version, null);
}

const shapes = (page: MktgPrintPage): MktgPrintPageShapeEl[] => page.els.filter((el): el is MktgPrintPageShapeEl => el.t === 'shape');
const texts = (page: MktgPrintPage): string[] => shapes(page).flatMap((el) => el.text?.paras.map((p) => p.text) ?? []);
const titles = (pages: MktgPrintPage[]): string[] => pages.map((p) => p.title);

describe('the framework’s print sections', () => {
  it('lists the deck’s four when the framework has them all, the message house always, in the cover’s numbering', () => {
    expect(mktgPrintFrameworkSections(view()).map((s) => `${s.number} ${s.title}`)).toEqual(['01 Framework', '02 ICPs', '03 Message house', '04 Key numbers']);
    expect(MKTG_PRINT_FRAMEWORK_SECTIONS.map((s) => s.id)).toEqual(['framework', 'icps', 'message-house', 'numbers']);
  });

  it('drops the ICPs and the key numbers when there are none, and the framework when every statement and list is empty', () => {
    expect(mktgPrintFrameworkSections(view({ icp: [], nums: [] })).map((s) => s.id)).toEqual(['framework', 'message-house']);
    const bare = view({ mf: { ...content().mf, vision: '', mission: '', positioning: '', tagline: '', goals: [], say: [], avoid: [], anchor: [] } });
    expect(mktgPrintFrameworkSections(bare).map((s) => s.id)).toEqual(['icps', 'message-house', 'numbers']);
  });
});

describe('the framework’s cover', () => {
  it('sets the deck’s cover: the title, the tagline, the eyebrow, the version, the accent bar, the rule and the contents line with the numbers softened', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const cover = mktgPrintFrameworkCover(v, look);
    expect(cover.title).toBe(FOUNDATION_MESSAGE_PRINT_TITLE);
    expect(cover.subtitle).toBe('Open foundations, audited in public.');
    expect(cover.eyebrow).toBe('Project One · a Linux Foundation project');
    expect(cover.topRight).toBe('Version 3');
    const [bar, rule, contents] = cover.els as MktgPrintPageShapeEl[];
    expect(bar).toMatchObject({ shape: 'RECTANGLE', box: { x: 38, y: 118, w: 36, h: 3 }, fill: look.accent });
    expect(rule).toMatchObject({ box: { x: 38, y: 340, w: 624, h: 0.75 }, fill: mktgPrintMixHex(look.dark, look.onDark, 0.3) });
    expect(contents.box).toEqual({ x: 38, y: 346, w: 624, h: 30 });
    expect(contents.text?.color).toBe(look.onDark);
    const para = contents.text?.paras[0];
    expect(para?.text).toBe('01  Framework        02  ICPs        03  Message house        04  Key numbers');
    expect(para?.runs?.[0]).toEqual({ text: '01', color: mktgPrintMixHex(look.onDark, look.dark, 0.4) });
    expect(para?.runs?.[1]).toEqual({ text: '  Framework' });
  });

  it('falls back to the message house’s line for the subtitle, the LF line for the eyebrow, and shows no version when there is none', () => {
    const v = buildFoundationMessagePrintView(content({ mf: { ...content().mf, tagline: '' } }), '', null, null);
    const cover = mktgPrintFrameworkCover(v, mktgPrintPageLook(v.brand));
    expect(cover.subtitle).toBe('Open foundations, audited in public.');
    expect(cover.eyebrow).toBe('A Linux Foundation project');
    expect(cover.topRight).toBe('');
  });
});

describe('the framework’s pages', () => {
  it('prints the deck’s slides in its order with its headings, each numbered from the cover in the footer and no footer line', () => {
    const pages = buildFrameworkPrintPages(view());
    expect(titles(pages)).toEqual([
      'Framework',
      'Goal columns',
      'Say and avoid',
      'Every piece of content answers',
      'ICPs',
      'ICPs (2)',
      'Message house',
      'Audiences',
      'Key numbers',
    ]);
    expect(pages.map((p) => p.footer)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10'].map((number) => ({ left: '', number })));
    expect(pages.map((p) => p.head?.left)).toEqual([
      '01 Framework',
      '01 Framework',
      '01 Framework',
      '01 Framework',
      '02 ICPs',
      '02 ICPs',
      '03 Message house',
      '03 Message house',
      '04 Key numbers',
    ]);
    expect(pages[0].head?.right).toBe('Project One Messaging Framework');
    expect(pages.every((p) => p.layout === 'content')).toBe(true);
    expect(mktgPrintFrameworkSectionOf(pages[4])).toBe('icps');
    expect(mktgFrameworkPrintPageCount(view())).toBe(10);
  });

  it('numbers from firstPage inside a larger document', () => {
    const pages = buildFrameworkPrintPages(view(), { firstPage: 5 });
    expect(pages[0].footer?.number).toBe('6');
    expect(mktgFrameworkPrintPageCount(view(), { firstPage: 5 })).toBe(10);
  });

  it('sets the Framework page as the deck does: the three statements in cards, the tagline in a tinted panel with the accent bar', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const [page] = buildFrameworkPrintPages(v);
    const cards = shapes(page).filter((el) => el.shape === 'ROUND_RECTANGLE' && el.line);
    expect(cards.map((c) => c.box)).toEqual([
      { x: 25, y: 91, w: 330, h: 82 },
      { x: 366, y: 91, w: 330, h: 82 },
      { x: 25, y: 181, w: 671, h: 82 },
    ]);
    expect(cards.map((c) => c.text?.paras[0].text)).toEqual(['Vision', 'Mission', 'Positioning']);
    expect(cards[0].text?.paras[0]).toMatchObject({ caps: true, color: look.muted });
    const tagline = shapes(page).find((el) => el.fill === look.tint);
    expect(tagline).toMatchObject({ box: { x: 25, y: 271, w: 671, h: 85 }, line: null });
    expect(tagline?.text?.paras[1]).toMatchObject({ text: 'Open foundations, audited in public.', size: 15, weight: 500 });
    expect(shapes(page).find((el) => el.box.x === 25 && el.box.w === 3)).toMatchObject({ box: { y: 279, h: 69 }, fill: look.accent });
    // Nothing of the run's own: the reviewer's note is not printed.
    expect(texts(page).join(' ')).not.toContain('For the reviewer only.');
  });

  it('skips a statement that is empty and the tagline panel without a tagline', () => {
    const [page] = buildFrameworkPrintPages(view({ mf: { ...content().mf, mission: '', tagline: '' } }));
    expect(shapes(page).map((el) => el.text?.paras[0].text)).toEqual(['Vision', 'Positioning']);
  });

  it('sets two goal columns to a page when both fit, the cross-cutting note under them, and gives a column that does not fit a page of its own', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const page = buildFrameworkPrintPages(v).find((p) => p.title === 'Goal columns');
    if (!page) throw new Error('Expected the goal columns page');
    const cards = shapes(page).filter((el) => el.line);
    expect(cards.map((c) => c.box)).toEqual([
      { x: 25, y: MKTG_PRINT_PAGE_AREA.y, w: 330, h: MKTG_PRINT_PAGE_AREA.h - 34 },
      { x: 366, y: MKTG_PRINT_PAGE_AREA.y, w: 330, h: MKTG_PRINT_PAGE_AREA.h - 34 },
    ]);
    const first = cards[0].text?.paras.map((p) => p.text);
    expect(first).toEqual([
      'Adoption',
      'Goal 1',
      'Value proposition',
      'Ship in weeks.',
      'Key message',
      'The fastest route.',
      'Proof',
      '1,200,000 downloads  ·  WEBSITE',
      '“From empty to compliant”',
      'For Platform teams',
    ]);
    const proof = cards[0].text?.paras.find((p) => p.text.startsWith('1,200,000'));
    expect(proof?.runs).toEqual([{ text: '1,200,000 downloads' }, { text: '  ·  WEBSITE', color: look.muted }]);
    expect(cards[1].text?.paras.map((p) => p.text)).toEqual([
      'Community',
      'Goal 2',
      'Value proposition',
      'Reviewed quickly.',
      'Key message',
      'No single company steers.',
      'For Contributors',
    ]);
    const note = shapes(page).find((el) => el.text?.paras[0]?.text === 'Every goal reinforces the others.');
    expect(note?.box).toEqual({ x: 25, y: MKTG_PRINT_PAGE_AREA.y + MKTG_PRINT_PAGE_AREA.h - 34 + 4, w: 671, h: 30 });

    const long = Array.from(
      { length: 40 },
      (_, i) => [`Fact ${i + 1} about the adoption of the toolkit by platform teams across regions`, 'Website'] as [string, string]
    );
    const goals = content().mf.goals.map((g) => ({ ...g, proof: long, vp: g.vp.repeat(12), key: g.key.repeat(12) }));
    const pages = buildFrameworkPrintPages(view({ mf: { ...content().mf, goals } })).filter((p) => p.title.startsWith('Goal columns'));
    expect(titles(pages)).toEqual(['Goal columns', 'Goal columns (2)']);
    expect(shapes(pages[0]).filter((el) => el.line)[0].box).toMatchObject({ x: 25, w: 671 });
  });

  it('sets Say and avoid as two cards: the say chips in rows, the avoid pairs struck and answered, and says when nothing is to be avoided', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const page = buildFrameworkPrintPages(v).find((p) => p.title === 'Say and avoid');
    if (!page) throw new Error('Expected the say and avoid page');
    const all = shapes(page);
    expect(all[0]).toMatchObject({ shape: 'ROUND_RECTANGLE', box: { x: 25, y: MKTG_PRINT_PAGE_AREA.y, w: 330, h: MKTG_PRINT_PAGE_AREA.h }, fill: '#FFFFFF' });
    expect(all[1].box).toEqual({ x: 366, y: MKTG_PRINT_PAGE_AREA.y, w: 330, h: MKTG_PRINT_PAGE_AREA.h });
    expect(texts(page).slice(0, 2)).toEqual(['Say', 'Avoid']);
    const chips = all.filter((el) => el.shape === 'ROUND_RECTANGLE' && el.box.h === 20);
    expect(chips).toHaveLength(3);
    expect(chips[0].box).toMatchObject({ x: 37, y: MKTG_PRINT_PAGE_AREA.y + 40 });
    expect(chips[1].box.x).toBe(chips[0].box.x + chips[0].box.w + 6);
    expect(chips[0].line?.color).toBe(mktgPrintMixHex('#FFFFFF', look.dark, 0.25));
    expect(texts(page)).toEqual(
      expect.arrayContaining([
        'open foundations',
        'audited in public',
        'neutral home',
        'Avoid',
        'Say instead',
        'enterprise-ready',
        'audited in public and adopted by regulated teams',
      ])
    );
    const struck = all.find((el) => el.text?.paras[0]?.strike);
    expect(struck?.text?.paras[0]).toMatchObject({ text: 'enterprise-ready', size: 9, color: look.muted });

    const none = buildFrameworkPrintPages(view({ mf: { ...content().mf, avoid: [] } })).find((p) => p.title === 'Say and avoid');
    expect(none && texts(none)).toContain('Nothing to avoid was stated.');
    expect(none && texts(none)).not.toContain('Say instead');
  });

  it('continues the say chips and the avoid rows that do not fit the cards on a numbered page', () => {
    const say = Array.from({ length: 60 }, (_, i) => `a phrase to say number ${i + 1}`);
    const pages = buildFrameworkPrintPages(view({ mf: { ...content().mf, say } })).filter((p) => p.title.startsWith('Say and avoid'));
    expect(pages.length).toBeGreaterThan(1);
    expect(titles(pages)).toEqual(pages.map((_, i) => (i === 0 ? 'Say and avoid' : `Say and avoid (${i + 1})`)));
    expect(pages.flatMap((p) => shapes(p).filter((el) => el.box.h === 20))).toHaveLength(60);
    // Every page keeps both cards and their headings; the avoid rows sit on the first.
    expect(pages.every((p) => texts(p).slice(0, 2).join() === 'Say,Avoid')).toBe(true);
    expect(texts(pages[1])).not.toContain('Say instead');
  });

  it('sets the anchor questions numbered in one card', () => {
    const page = buildFrameworkPrintPages(view()).find((p) => p.title === 'Every piece of content answers');
    expect(page && shapes(page)[0]).toMatchObject({ shape: 'ROUND_RECTANGLE', box: { x: 25, y: MKTG_PRINT_PAGE_AREA.y, w: 671, h: MKTG_PRINT_PAGE_AREA.h } });
    expect(page && texts(page)).toEqual(['1.  Which goal does this serve?', '2.  Which segment is it for?']);
    expect(page && shapes(page)[0].text?.paras.map((p) => p.above)).toEqual([4, 12]);
  });

  it('gives each segment a page: its name, kind and basis, who and goals left; its label-and-value rows right, the empty ones left out', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const [teams, contributors] = buildFrameworkPrintPages(v).filter((p) => p.title.startsWith('ICPs'));
    const left = shapes(teams)[0];
    expect(left.box).toEqual(MKTG_PRINT_PAGE_LEFT);
    expect(left.text?.paras.map((p) => p.text)).toEqual([
      'Platform teams',
      'Organization · Basis: Website',
      'Teams who run the internal platform.',
      'Goals: Adoption',
    ]);
    const labels = shapes(teams)
      .filter((el) => el.text?.paras[0]?.caps && el.box.x === MKTG_PRINT_PAGE_RIGHT.x)
      .map((el) => el.text?.paras[0].text);
    expect(labels).toEqual(['Need', 'Value', 'Lead', 'Proof', 'Call to action', 'Channels', 'Objection', 'Personas']);
    const values = shapes(teams)
      .filter((el) => el.box.x === MKTG_PRINT_PAGE_RIGHT.x + 92)
      .map((el) => el.text?.paras.map((p) => p.text));
    expect(values).toEqual([
      ['A compliant toolchain.'],
      ['A vetted toolkit.'],
      ['The fastest route to a compliant platform.'],
      ['Adopted by 38 teams  ·  PRESS RELEASE'],
      ['Deploy the reference stack.'],
      ['Docs · Summit'],
      ['Will this survive a vendor leaving?', '→ Governance by contributors.'],
      ['Platform lead — predictability'],
    ]);
    expect(shapes(teams).filter((el) => el.fill === look.rule)).toHaveLength(8);
    const persona = values[7] && shapes(teams).find((el) => el.text?.paras[0]?.text === 'Platform lead — predictability');
    expect(persona?.text?.paras[0].runs).toEqual([{ text: 'Platform lead', weight: 600 }, { text: ' — predictability' }]);
    expect(shapes(contributors)[0].text?.paras.map((p) => p.text)).toEqual([
      'Contributors',
      'Individual',
      'Engineers who maintain a component.',
      'Goals: Community',
    ]);
    expect(
      shapes(contributors)
        .filter((el) => el.text?.paras[0]?.caps && el.box.x === MKTG_PRINT_PAGE_RIGHT.x)
        .map((el) => el.text?.paras[0].text)
    ).toEqual(['Need', 'Value', 'Lead', 'Call to action', 'Objection']);
  });

  it('sets the message house: the umbrella on the dark, the pillars side by side under accent bars, the foundation tinted; the audiences as rows on their own page', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const pages = buildFrameworkPrintPages(v);
    const house = pages.find((p) => p.title === 'Message house');
    if (!house) throw new Error('Expected the message house page');
    const all = shapes(house);
    expect(all[0]).toMatchObject({ shape: 'ROUND_RECTANGLE', box: { x: 25, y: MKTG_PRINT_PAGE_AREA.y, w: 671, h: 66 }, fill: look.dark, line: null });
    expect(all[0].text?.paras.map((p) => p.text)).toEqual(['Umbrella', 'Open foundations for everyone.', 'Open foundations, audited in public.']);
    expect(all[0].text?.paras.every((p) => p.color === look.onDark)).toBe(true);
    const pw = (671 - 2 * 10) / 3;
    const pillars = all.filter((el) => el.shape === 'RECTANGLE' && el.line);
    expect(pillars.map((p) => p.box)).toEqual([0, 1, 2].map((i) => ({ x: 25 + i * (pw + 10), y: 163, w: pw, h: 136 })));
    expect(pillars.map((p) => p.text?.paras.map((q) => q.text))).toEqual([
      ['Open', 'Governed in the open.', '3,400 contributors  ·  PLAN'],
      ['Audited', 'Two audits a year.', 'Published since 2024  ·  DECK'],
      ['Neutral', 'No single vendor.'],
    ]);
    const bars = all.filter((el) => el.shape === 'RECTANGLE' && el.fill === look.accent);
    expect(bars.map((b) => b.box)).toEqual([0, 1, 2].map((i) => ({ x: 25 + i * (pw + 10), y: 163, w: pw, h: 3 })));
    const found = all.find((el) => el.fill === look.tint);
    expect(found).toMatchObject({ box: { x: 25, y: 307, w: 671, h: 49 } });
    expect(found?.text?.paras.map((p) => p.text)).toEqual(['Foundation', 'A Linux Foundation project.']);

    const audiences = pages.find((p) => p.title === 'Audiences');
    if (!audiences) throw new Error('Expected the audiences page');
    expect(texts(audiences)).toEqual(['Platform teams', 'The fastest route to a compliant platform.', 'Contributors', 'Your work, reviewed and credited.']);
    const rows = shapes(audiences).filter((el) => el.text);
    expect(rows[0].box.x).toBe(25);
    expect(rows[1].box).toMatchObject({ x: 25 + 190, w: 671 - 190 });
    expect(rows[0].text?.paras[0]).toMatchObject({ weight: 600, size: 10.5 });
    expect(shapes(audiences).filter((el) => el.fill === look.rule)).toHaveLength(2);
  });

  it('continues the pillars’ proof points on a second house page when they do not fit the pillars at 85%', () => {
    const proof = Array.from(
      { length: 12 },
      (_, i) => [`A long proof point number ${i + 1} about the project's audits and releases`, 'Website'] as [string, string]
    );
    const pillars = content().mh.pillars.map((p) => ({ ...p, p: proof }));
    const pages = buildFrameworkPrintPages(view({ mh: { ...content().mh, pillars } }));
    expect(titles(pages).filter((t) => t.startsWith('Message house'))).toEqual(['Message house', 'Message house (2)']);
    const house = pages.find((p) => p.title === 'Message house');
    const more = pages.find((p) => p.title === 'Message house (2)');
    // The house's pillars carry title and message only; the continuation the proof points without the message.
    expect(
      house &&
        shapes(house)
          .filter((el) => el.shape === 'RECTANGLE' && el.line)[0]
          .text?.paras.map((p) => p.text)
    ).toEqual(['Open', 'Governed in the open.']);
    const cont = more && shapes(more).filter((el) => el.shape === 'RECTANGLE' && el.line)[0];
    expect(cont?.box).toMatchObject({ y: MKTG_PRINT_PAGE_AREA.y, h: MKTG_PRINT_PAGE_AREA.h });
    expect(cont?.text?.paras[0].text).toBe('Open');
    expect(cont?.text?.paras[1].text).toContain('A long proof point number 1');
  });

  it('tiles the key numbers three to a row, six to a page, with the project line under them, and continues on a numbered page', () => {
    const v = view();
    const look = mktgPrintPageLook(v.brand);
    const page = buildFrameworkPrintPages(v).find((p) => p.title === 'Key numbers');
    if (!page) throw new Error('Expected the key numbers page');
    const w = (671 - 20) / 3;
    const tiles = shapes(page).filter((el) => el.fill === look.tint);
    expect(tiles.map((t) => t.box)).toEqual([
      { x: 25, y: MKTG_PRINT_PAGE_AREA.y, w, h: 100 },
      { x: 25 + w + 10, y: MKTG_PRINT_PAGE_AREA.y, w, h: 100 },
    ]);
    expect(tiles[0].text?.paras).toEqual([
      { text: '1.2M', size: 28, weight: 500, color: look.accent },
      { text: 'downloads', size: 9, color: look.muted, above: 4 },
    ]);
    expect(tiles[0].text).toMatchObject({ align: 'CENTER', anchor: 'MIDDLE' });
    expect(texts(page).at(-1)).toBe('Project One · a Linux Foundation project');

    const nums = Array.from({ length: MKTG_PRINT_FRAMEWORK_NUMBERS_PER_PAGE + 1 }, (_, i) => [`${i + 1}`, `metric ${i + 1}`] as [string, string]);
    const pages = buildFrameworkPrintPages(view({ nums })).filter((p) => p.title.startsWith('Key numbers'));
    expect(titles(pages)).toEqual(['Key numbers', 'Key numbers (2)']);
    expect(shapes(pages[0]).filter((el) => el.fill === look.tint)).toHaveLength(6);
    expect(shapes(pages[0]).filter((el) => el.fill === look.tint)[3].box.y).toBe(MKTG_PRINT_PAGE_AREA.y + 110);
    expect(shapes(pages[1]).filter((el) => el.fill === look.tint)).toHaveLength(1);
  });

  it('prints the message house alone when the framework, the segments and the numbers are empty', () => {
    const bare = view({
      mf: { ...content().mf, vision: '', mission: '', positioning: '', tagline: '', goals: [], say: [], avoid: [], anchor: [] },
      icp: [],
      nums: [],
    });
    const pages = buildFrameworkPrintPages(bare);
    expect(titles(pages)).toEqual(['Message house', 'Audiences']);
    expect(pages[0].head?.left).toBe('03 Message house');
    expect(mktgFrameworkPrintPageCount(bare)).toBe(3);
  });
});
