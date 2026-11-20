// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES,
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_TILE_SHARES,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_SEP,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
} from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView, FoundationMessageReport } from '@lfx-one/shared/interfaces';
import { buildFoundationMessagePrintView, frameworkPortraitMatrix, frameworkPortraitPlan, mktgPortraitLook } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, describe, expect, it } from 'vitest';
import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * The framework print's pages past the framework chapter: the key numbers'
 * tiles and table, the cut lists' notes, the Sources & gaps page and its
 * room, a goal page keyed on its position, and the goal matrix's bands and
 * their fold. The component's base behaviors are in
 * `mktg-framework-print.component.spec.ts`; the fit model's in `.fit.spec.ts`,
 * the book's and the cover's in `.book.spec.ts`. Each part mounts the
 * component on the same synthetic record (the editor's rule for this pull
 * request: spec files only, so the setup is repeated, not shared).
 */

const pair = (a: string, b: string): [string, string] => [a, b];

const CONTENT: FoundationMessageContent = {
  mf: {
    vision: 'A vision.',
    mission: 'A mission.',
    positioning: 'For platform teams.',
    tagline: 'Release, open.',
    goals: [
      {
        id: 'adoption',
        n: 1,
        t: 'Adoption',
        vp: 'VP.',
        key: 'Key.',
        proof: [pair('1,200 members', 'Website')],
        bite: 'In the open',
        icps: ['users', 'maintainers'],
      },
    ],
    crosscut: 'Every column grows the audience.',
    say: ['open'],
    avoid: [pair('synergy', 'working together')],
    anchor: ['Which goal does this serve?'],
    notes: 'For the reviewer.',
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
      proof: [pair('A fact', 'Docs')],
      cta: 'Try it.',
      channels: ['Docs', 'Slack'],
      objection: ['Too early?', 'Not at all.'],
      personas: [pair('SRE', 'uptime')],
      basis: 'Website',
    },
    {
      id: 'maintainers',
      name: 'Maintainers',
      kind: 'Individual',
      who: 'Committers.',
      goals: ['adoption'],
      need: 'Need.',
      value: 'Value.',
      lead: 'Lead.',
      proof: [pair('A fact', 'Docs')],
      cta: 'Join.',
      channels: ['Mailing list'],
      objection: ['Too early?', null],
      personas: [pair('Maintainer', 'review load')],
      basis: 'Website',
    },
  ],
  mh: {
    umbrella: 'Umbrella.',
    line: 'Release, open.',
    pillars: [{ t: 'Open', m: 'Open message.', p: [pair('Fact', 'Web')] }],
    found: 'A Linux Foundation project.',
    aud: [pair('End users', 'Ship with confidence.')],
  },
  nums: [pair('1,200', 'members')],
};

const REPORT: FoundationMessageReport = {
  sources_read: ['Website: https://orbit.example.org', 'Link: https://orbit.example.org/about', 'Press release: https://www.linuxfoundation.org/press/orbit'],
  sources_failed: [{ name: 'Members page', reason: 'timed out' }],
  gaps: ['No 2027 figures yet.'],
  notes: 'First note.\nSecond note.\n',
};

const printView = (kit: BrandKitRevision | null, projectName = 'TestOrbit'): FoundationMessagePrintView =>
  buildFoundationMessagePrintView(CONTENT, projectName, 2, kit, '2026-11-06T09:00:00Z', REPORT, '2026-11-04');

describe('MktgFrameworkPrintComponent, the pages', () => {
  let fixture: ComponentFixture<MktgFrameworkPrintComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  /** One frame by its plan id (the grammar's host contract: data-testid lfx-mktg-portrait-page + data-page-id). */
  const frame = (pageId: string): HTMLElement | null => host().querySelector(`[data-testid="lfx-mktg-portrait-page"][data-page-id="${pageId}"]`);
  /** The element's text as a reader sees it: each text node trimmed, one space between them (the template's own whitespace is stripped). */
  const text = (element: Element | null | undefined): string => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(element ?? document.createElement('div'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const part = node.textContent?.trim();
      if (part) parts.push(part);
    }
    return parts.join(' ');
  };
  const fontLinks = (): HTMLLinkElement[] => Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[id^="brand-kit-font-"]'));

  const configure = async (platformId: 'browser' | 'server', view: FoundationMessagePrintView): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [MktgFrameworkPrintComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platformId }],
    }).compileComponents();
    fixture = TestBed.createComponent(MktgFrameworkPrintComponent);
    fixture.componentRef.setInput('view', view);
    await fixture.whenStable();
  };

  const setView = async (view: FoundationMessagePrintView): Promise<void> => {
    fixture.componentRef.setInput('view', view);
    await fixture.whenStable();
  };

  afterEach(() => {
    fontLinks().forEach((link) => link.remove());
  });

  it('lays the key numbers’ tiles out by their count: 2×2 for four, a row of three then two for five, 3×2 for six, the table under them', async () => {
    const nums = (count: number) => Array.from({ length: count }, (_, index) => pair(`${index + 1},000`, `figure ${index + 1}`));
    await configure('browser', buildFoundationMessagePrintView({ ...CONTENT, nums: nums(4) }, 'TestOrbit', 2, null));
    const tiles = () => Array.from(host().querySelectorAll<HTMLElement>('[data-testid^="mktg-framework-print-number-tile-"]'));
    const shares = () => tiles().map((tile) => Number(tile.getAttribute('data-share')));
    const wide = () => tiles().map((tile) => tile.getAttribute('data-wide') === 'true');
    expect(tiles().map((tile) => tile.getAttribute('data-testid'))).toEqual([
      'mktg-framework-print-number-tile-0',
      'mktg-framework-print-number-tile-1',
      'mktg-framework-print-number-tile-2',
      'mktg-framework-print-number-tile-3',
    ]);
    expect(shares()).toEqual([...FRAMEWORK_PORTRAIT_TILE_SHARES[4]]);
    expect(shares()).toEqual([2, 2, 2, 2]);
    expect(tiles().map((tile) => tile.style.gridColumn)).toEqual(['span 3', 'span 3', 'span 3', 'span 3']);
    expect(wide()).toEqual([false, false, false, false]);
    expect(tiles().map((tile) => tile.classList.contains('fwp-number-tile-lead'))).toEqual([true, false, false, false]);
    expect(host().textContent).toContain('Figures and their sources');
    expect(host().textContent).not.toContain('Every figure and its source');
    // Two rows of 156 from 210, a 16 gap, then 22 to the table: 560, where the mock draws it.
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 560px');
    // No proof point states these figures, so no tile carries a source pill: nothing is invented.
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-number-source"]')).toHaveLength(0);
    // 2×2 with the proof points stating two of the figures: those two tiles print the proof's source as the grammar's chip under
    // the label (the mock's pill), the others none.
    const stated = {
      ...CONTENT,
      nums: nums(4),
      mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], proof: [pair('1,000 members', 'LFX field'), pair('About 3,000 downloads', 'Website')] }] },
    };
    await setView(buildFoundationMessagePrintView(stated, 'TestOrbit', 2, null));
    expect(tiles().map((tile) => tile.querySelector('[data-testid="mktg-framework-print-number-source"]')?.textContent?.trim() ?? null)).toEqual([
      'LFX field',
      null,
      'Website',
      null,
    ]);
    expect(tiles()[0].querySelector('.fwp-number-source')?.classList.contains('pp-chip')).toBe(true);
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: nums(5) }, 'TestOrbit', 2, null));
    expect(shares()).toEqual([3, 3, 3, 2, 2]);
    expect(tiles().map((tile) => tile.style.gridColumn)).toEqual(['span 2', 'span 2', 'span 2', 'span 3', 'span 3']);
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 560px');
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: nums(6) }, 'TestOrbit', 2, null));
    expect(FRAMEWORK_PORTRAIT_MAX_TILES).toBe(6);
    expect(shares()).toEqual([3, 3, 3, 3, 3, 3]);
    // Six tiles a third wide (176 of content): seven-digit figures step down from 54 to the size that holds them on one line, a
    // 30-character label fits under them as written; the sizes are set inline from the layout, nothing overflows the tile.
    const long = (count: number) => Array.from({ length: count }, (_, index) => pair(`${index + 1},200,000`, 'members across five continents'));
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: long(6) }, 'TestOrbit', 2, null));
    expect(tiles().map((tile) => tile.querySelector<HTMLElement>('.fwp-number')?.style.fontSize)).toEqual(Array.from({ length: 6 }, () => '35px'));
    expect(tiles().map((tile) => tile.querySelector<HTMLElement>('.fwp-number-label')?.style.fontSize)).toEqual(Array.from({ length: 6 }, () => '14px'));
    expect(tiles()[0].querySelector('.fwp-number-label')?.textContent?.trim()).toBe('members across five continents');
    // (The figure's box inside the tile's is a layout fact: jsdom lays nothing out, so the e2e's real-Chrome tile check holds it, not this spec.)
    // 3×2 under a short figure at its full 54 px: the label's 48 px hold two lines as written; with a source pill under it (a proof
    // point states the figure) the label loses the pill's 27 px and comes down to one line, the pill on every stated tile.
    await setView(
      buildFoundationMessagePrintView({ ...CONTENT, nums: Array.from({ length: 6 }, () => pair('41', 'members across five continents')) }, 'TestOrbit', 2, null)
    );
    expect(tiles()[0].querySelector<HTMLElement>('.fwp-number')?.style.fontSize).toBe('54px');
    expect(tiles()[0].querySelector<HTMLElement>('.fwp-number-label')?.style.fontSize).toBe('14px');
    await setView(
      buildFoundationMessagePrintView(
        {
          ...CONTENT,
          nums: Array.from({ length: 6 }, () => pair('41', 'members across five continents')),
          mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], proof: [pair('41 members across five continents', 'LFX field')] }] },
        },
        'TestOrbit',
        2,
        null
      )
    );
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-number-source"]')).toHaveLength(6);
    expect(tiles()[0].querySelector<HTMLElement>('.fwp-number-label')?.style.fontSize).toBe('10.5px');
    expect(tiles()[0].querySelector('.fwp-number-label')?.textContent?.trim()).toBe('members across five continents');
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 560px');
    // One to three figures: pairs, an odd count's last tile across the row.
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: nums(3) }, 'TestOrbit', 2, null));
    expect(wide()).toEqual([false, false, true]);
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 560px');
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: nums(1) }, 'TestOrbit', 2, null));
    expect(wide()).toEqual([true]);
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 388px');
  });

  it('past six figures prints no tiles but the key numbers table, every figure, continued on "Key numbers (2)" when a page is full; never a figure dropped', async () => {
    const nums = (count: number) => Array.from({ length: count }, (_, index) => pair(`${index + 1},000`, `figure ${index + 1}`));
    const view = buildFoundationMessagePrintView({ ...CONTENT, nums: nums(9) }, 'TestOrbit', 2, null);
    await configure('browser', view);
    expect(host().querySelectorAll('[data-testid^="mktg-framework-print-number-tile-"]')).toHaveLength(0);
    const rows = () => Array.from(host().querySelectorAll('[data-testid^="mktg-framework-print-number-row-"]'));
    expect(rows().map((row) => row.querySelector('[data-testid="mktg-framework-print-number-figure"]')?.textContent?.trim())).toEqual(
      nums(9).map(([number]) => number)
    );
    expect(rows()[8].textContent).toContain('figure 9');
    expect(frame('key-numbers')?.querySelector('[data-testid="mktg-framework-print-numbers-table"]')?.getAttribute('style')).toContain('top: 210px');
    expect(frame('key-numbers-2')).toBeNull();
    expect(frame('key-numbers')?.querySelector('[data-testid="mktg-framework-print-facts"]')).not.toBeNull();
    // Forty figures: the table runs past the footer, so the rest continue on a second frame under the same running head, the facts after them.
    const many = buildFoundationMessagePrintView({ ...CONTENT, nums: nums(40) }, 'TestOrbit', 2, null);
    await setView(many);
    const plan = frameworkPortraitPlan(many, { inFamily: false });
    expect(plan.filter((page) => page.id.startsWith('key-numbers')).map((page) => [page.id, page.title])).toEqual([
      ['key-numbers', 'Key numbers'],
      ['key-numbers-2', 'Key numbers (2)'],
    ]);
    expect(host().querySelectorAll('[data-testid="lfx-mktg-portrait-page"]')).toHaveLength(plan.length);
    expect(rows()).toHaveLength(40);
    const second = frame('key-numbers-2');
    expect(second?.getAttribute('data-section')).toBe('04 Key numbers');
    expect(second?.textContent).toContain('Key numbers (2)');
    expect(second?.querySelector('[data-testid="mktg-framework-print-numbers-table"]')?.getAttribute('style')).toContain('top: 136px');
    expect(frame('key-numbers')?.querySelector('.pp-body')?.textContent).toContain('The figures the framework leans on');
    expect(second?.querySelector('.pp-body--wide')).toBeNull();
    expect(frame('key-numbers')?.querySelector('[data-testid="mktg-framework-print-facts"]')).toBeNull();
    expect(second?.querySelector('[data-testid="mktg-framework-print-facts"]')).not.toBeNull();
    // The first page's rows, then the second's, in the data's order, split where the first page filled.
    const firstRows = Array.from(frame('key-numbers')?.querySelectorAll('[data-testid^="mktg-framework-print-number-row-"]') ?? []);
    const secondRows = Array.from(second?.querySelectorAll('[data-testid^="mktg-framework-print-number-row-"]') ?? []);
    expect(firstRows.length).toBeGreaterThan(6);
    expect(firstRows.length + secondRows.length).toBe(40);
    expect(secondRows[0].querySelector('[data-testid="mktg-framework-print-number-figure"]')?.textContent?.trim()).toBe(`${firstRows.length + 1},000`);
    // The rows are indexed within their page's table, as the facts are (`-fact-<i>`).
    expect(secondRows[0].getAttribute('data-testid')).toBe('mktg-framework-print-number-row-0');
    // The contents page counts every page the data needs.
    expect(query('mktg-framework-print-contents')?.textContent).toContain('Key numbers (2)');
  });

  it('says what a list cut to no rows left off: the heading and the "+N more" line still print', async () => {
    // Proof facts so tall that none fits the proofs' room even tightened: the "Proof points" heading and the note print, no row.
    const tall = Array.from({ length: 3 }, (_, index) =>
      pair(`${'A very long proof sentence that fills the column. '.repeat(40).trim()} (${index})`, 'Report')
    );
    await configure(
      'browser',
      buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], proof: tall }] } }, 'TestOrbit', 2, null)
    );
    const goalPage = frame('goal-1');
    expect(goalPage?.querySelectorAll('[data-testid="mktg-framework-print-proof-row"]')).toHaveLength(0);
    expect(goalPage?.textContent).toContain('Proof points');
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-proofs-cut"]')?.textContent?.trim()).toBe('+3 more in LFX One');
  });

  it('closes on the sources and gaps: what was read as stored (its type prefix off), what could not be, the gaps, and the approval card; never the notes', async () => {
    const view = printView(null);
    await configure('browser', view);
    expect(query('mktg-framework-print-sources-intro')?.textContent?.trim()).toBe(
      'What the framework was built from on 4 Nov 2026, what could not be read, and what is still open.'
    );
    // Each source in a reader's words and never a path (foundationMessagePrintSourceRows): its type prefix off, a URL as its host, the pages
    // of one host gathered into one counted row, a press release named with its site's host.
    expect(Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-sources-read-row"]')).map((item) => item.textContent?.trim())).toEqual([
      `orbit.example.org${FRAMEWORK_PORTRAIT_SEP}2 pages`,
      'The press release (linuxfoundation.org)',
    ]);
    expect(query('mktg-framework-print-sources-read')?.textContent).not.toContain('/');
    expect(query('mktg-framework-print-sources-failed')?.textContent?.trim()).toBe('Members page — timed out');
    expect(query('mktg-framework-print-gaps')?.textContent?.trim()).toBe('No 2027 figures yet.');
    // The run's notes stay on screen: no Notes block, no raw field name.
    expect(query('mktg-framework-print-notes')).toBeNull();
    expect(frame('sources')?.textContent).not.toContain('Notes');
    expect(frame('sources')?.textContent).not.toContain('First note.');
    expect(text(query('mktg-framework-print-approval'))).toBe(
      `V2.0${FRAMEWORK_PORTRAIT_SEP}Approved 6 Nov 2026. The gaps above were open at approval. A later run re-reads the sources and refreshes the LFX figures.`
    );
    // The reviewer's note is not printed anywhere.
    expect(host().textContent).not.toContain('For the reviewer.');
    // A report with empty lists: no Read block (no heading over nothing), the shared empty-state lines for the failed sources and the
    // gaps, the intro without a date, no gaps clause on the card.
    await setView(
      buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null, '2026-11-06T09:00:00Z', { sources_read: [], sources_failed: [], gaps: [], notes: '' })
    );
    expect(query('mktg-framework-print-sources-intro')?.textContent?.trim()).toBe(
      'What the framework was built from, what could not be read, and what is still open.'
    );
    expect(query('mktg-framework-print-sources-read')).toBeNull();
    expect(frame('sources')?.textContent).not.toMatch(/\bRead\b/);
    expect(query('mktg-framework-print-sources-failed-empty')?.textContent?.trim()).toBe('No source failed.');
    expect(query('mktg-framework-print-gaps-empty')?.textContent?.trim()).toBe('The sources left no gap.');
    expect(text(query('mktg-framework-print-approval'))).toBe(
      `V2.0${FRAMEWORK_PORTRAIT_SEP}Approved 6 Nov 2026. A later run re-reads the sources and refreshes the LFX figures.`
    );
    // No report at all (a record without one): the page says nothing the store never said — no intro, no Read, Could-not-be-read or Gaps
    // block, no empty-state line; the approval card alone, and the page stays in the plan.
    await setView(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null));
    expect(frame('sources')).not.toBeNull();
    expect(query('mktg-framework-print-sources-intro')).toBeNull();
    expect(query('mktg-framework-print-sources-read')).toBeNull();
    expect(query('mktg-framework-print-sources-failed-empty')).toBeNull();
    expect(query('mktg-framework-print-gaps')).toBeNull();
    expect(query('mktg-framework-print-gaps-empty')).toBeNull();
    expect(frame('sources')?.textContent).not.toContain('What the framework was built from');
    expect(text(query('mktg-framework-print-approval'))).toBe('V2.0. A later run re-reads the sources and refreshes the LFX figures.');
  });

  it('gives the failed sources the room the Read block leaves as it prints: twenty short failures under no Read block all print, with no note', async () => {
    const failed = Array.from({ length: 20 }, (_, index) => ({ name: `Source ${index + 1}`, reason: 'timed out' }));
    await configure(
      'browser',
      buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null, '2026-11-06T09:00:00Z', { sources_read: [], sources_failed: failed, gaps: [], notes: '' })
    );
    expect(query('mktg-framework-print-sources-read')).toBeNull();
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-sources-failed-row"]')).toHaveLength(20);
    expect(query('mktg-framework-print-sources-failed-cut')).toBeNull();
    // With a long Read list in the column, the failures keep at least the half the design gives them while the Read list is cut to leave it.
    const read = Array.from({ length: 40 }, (_, index) => `Website: https://site-${index + 1}.example.org`);
    await setView(
      buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null, '2026-11-06T09:00:00Z', {
        sources_read: read,
        sources_failed: failed,
        gaps: [],
        notes: '',
      })
    );
    expect(query('mktg-framework-print-sources-read-cut')).not.toBeNull();
    const kept = host().querySelectorAll('[data-testid="mktg-framework-print-sources-failed-row"]').length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(20);
    expect(query('mktg-framework-print-sources-failed-cut')?.textContent?.trim()).toBe(`+${20 - kept} more in LFX One`);
  });

  it('keys a goal page’s frame and lead on the goal’s position: two goals numbered alike both print, each under its own number', async () => {
    const twin = { ...CONTENT.mf.goals[0], id: 'twin', t: 'Twin', vp: 'Twin VP.' };
    await configure(
      'browser',
      buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals: [CONTENT.mf.goals[0], twin] } }, 'TestOrbit', 2, null)
    );
    expect(frame('goal-1')?.querySelector('[data-testid="mktg-framework-print-goal-1"] .fwp-goal-vp')?.textContent?.trim()).toBe('VP.');
    expect(frame('goal-2')?.querySelector('[data-testid="mktg-framework-print-goal-2"] .fwp-goal-vp')?.textContent?.trim()).toBe('Twin VP.');
    expect(frame('goal-2')?.querySelector('.fwp-goal-number')?.textContent?.trim()).toBe('01');
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-goal-1"]')).toHaveLength(1);
  });

  it('decides the empty-state lines by the report’s counts, not by the rows that fit, and prints no heading or label over nothing', async () => {
    const long = 'A long sentence about the project and the many things it does for the people who use it every day. ';
    const report: FoundationMessageReport = {
      sources_read: ['Website: https://orbit.example.org'],
      sources_failed: Array.from({ length: 80 }, (_, index) => ({ name: `Source ${index}`, reason: long.trim() })),
      gaps: Array.from({ length: 80 }, (_, index) => `Gap ${index}: ${long.trim()}`),
      notes: '',
    };
    await configure('browser', buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null, '2026-11-06T09:00:00Z', report));
    // The failed list is cut to the room, yet the page never says "No source failed."; the same for the gaps.
    const failed = host().querySelectorAll('[data-testid="mktg-framework-print-sources-failed-row"]').length;
    expect(failed).toBeGreaterThan(0);
    expect(failed).toBeLessThan(80);
    expect(query('mktg-framework-print-sources-failed-empty')).toBeNull();
    expect(query('mktg-framework-print-gaps-empty')).toBeNull();
    // A goal with no proof, no served profile, no key message: no "Proof points", "Who it's for" or key-message bar; a profile with no need or
    // value, and an audience with no lead, print no label over nothing; no anchor questions, no "Every piece of content answers"; no audiences, no "Audiences".
    const bare: FoundationMessageContent = {
      ...CONTENT,
      mf: { ...CONTENT.mf, anchor: [], say: [], goals: [{ ...CONTENT.mf.goals[0], key: '', proof: [], icps: [] }] },
      icp: [{ ...CONTENT.icp[0], need: '', value: '', objection: ['', null] }],
      mh: { ...CONTENT.mh, pillars: [{ t: 'Open', m: '', p: [] }], aud: [] },
    };
    await setView(buildFoundationMessagePrintView(bare, 'TestOrbit', 2, null));
    const goalPage = frame('goal-1');
    expect(goalPage?.textContent).not.toContain('Proof points');
    expect(goalPage?.textContent).not.toContain("Who it's for");
    expect(goalPage?.textContent).not.toContain('Key message');
    // No proof in the record: no "Figures and their sources" over an empty table; no phrase to say: no "Say" over an empty list; an
    // objection with no question: no "Objection" field (never `“” — …`).
    expect(frame('key-numbers')?.textContent).not.toContain('Figures and their sources');
    expect(query('mktg-framework-print-facts')).toBeNull();
    expect(query('mktg-framework-print-say')).toBeNull();
    expect(Array.from(frame('say-avoid')?.querySelectorAll('.pp-lab--dark') ?? []).map((label) => label.textContent?.trim())).not.toContain('Say');
    expect(frame('icps-1')?.textContent).not.toContain('“”');
    expect(Array.from(frame('icps-1')?.querySelectorAll('dt') ?? []).map((term) => term.textContent?.trim())).toEqual([
      'Lead message',
      'Call to action',
      'Channels',
    ]);
    expect(frame('say-avoid')?.textContent).not.toContain('Every piece of content answers');
    expect(frame('message-house')?.textContent).not.toContain('Audiences');
    expect(frame('message-house')?.querySelector('.fwp-pillar-message')).toBeNull();
  });

  it('breaks eight goals with the overfull record’s titles into two bands of four, every title at one size inside its column (editor C2b)', async () => {
    const titles = ['Adoption', 'Contributors', 'Certification', 'End users', 'Events', 'Security', 'Membership', 'Education'];
    const goals = titles.map((t, index) => ({ ...CONTENT.mf.goals[0], id: `g${index}`, n: index + 1, t }));
    await configure('browser', buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals } }, 'TestOrbit', 2, null));
    const bands = [query('mktg-framework-print-goals-band-0'), query('mktg-framework-print-goals-band-1')];
    expect(bands.map((band) => band?.style.getPropertyValue('--fwp-goal-count'))).toEqual(['4', '4']);
    expect(query('mktg-framework-print-goals-band-2')).toBeNull();
    const heads = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-matrix-title"]'));
    expect(heads.map((head) => head.textContent?.trim())).toEqual(titles);
    expect(new Set(heads.map((head) => head.style.fontSize)).size).toBe(1);
    expect(parseFloat(heads[0].style.fontSize)).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin);
    // The bands drop rows only by the room (the editor's ladder): these short texts fit whole, so each band prints every row for its
    // four goals, the value and sound-bite rows included, with no note under the bands; every proof cell keeps a row (F3 in the bands too).
    expect(bands.map((band) => band?.querySelectorAll('[data-testid="mktg-framework-print-matrix-vp"]').length)).toEqual([4, 4]);
    expect(bands.map((band) => band?.querySelectorAll('[data-testid="mktg-framework-print-matrix-bite"]').length)).toEqual([4, 4]);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-proof"]').length).toBeGreaterThanOrEqual(8);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-row-note"]')).toHaveLength(0);
    // One size across each band's proof row (editor W4): every cell tightened together, every row at the one size the layout set.
    for (const band of [query('mktg-framework-print-goals-band-0'), query('mktg-framework-print-goals-band-1')]) {
      const cells = Array.from(band?.querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-matrix-proof-cell"]') ?? []);
      expect(cells).toHaveLength(4);
      expect(new Set(cells.map((cell) => cell.classList.contains('fwp-matrix-proofs--tight'))).size).toBe(1);
      expect(new Set(cells.flatMap((cell) => Array.from(cell.querySelectorAll<HTMLElement>('li')).map((row) => row.style.fontSize))).size).toBe(1);
    }
    // The overfull record's texts in the bands (editor W1b): every key message whole at its type, never clamped or cut; the value and
    // sound-bite rows gone from both bands (each goal page prints them in full) with the one note under them; a dropped row leaves no
    // empty row behind.
    const wordy = 'Teams standardize on projects every major cloud and vendor already supports, so platforms outlive any one supplier.';
    const fact = 'Kubernetes runs in production at 96 percent of the organizations surveyed in the latest annual survey';
    const longGoals = goals.map((goal) => ({
      ...goal,
      vp: wordy,
      key: wordy,
      bite: 'Open, everywhere, governed in the open.',
      proof: Array.from({ length: 4 }, () => pair(fact, 'Website')),
    }));
    const longView = buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals: longGoals } }, 'TestOrbit', 2, null);
    await setView(longView);
    // The spec measures as the component does: on the brand's face (the look's font stack).
    const laid = frameworkPortraitMatrix(
      longView.goals,
      longView.mf.crosscut,
      FRAMEWORK_PORTRAIT_TOPS.footer - FRAMEWORK_PORTRAIT_TOPS.matrix,
      mktgPortraitLook(longView.brand).fontStack
    );
    expect(laid.bands).toHaveLength(2);
    const labels = Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-goals-label"]')).map((label) => label.textContent?.trim());
    expect(labels.filter((label) => label === 'Key message')).toHaveLength(2);
    // Measured on the glyph table in the LF look's face as the served print set it (the matrix's own Inter factor, the source tag on
    // its own line when the fact's last line cannot hold it): this shape's seven-line key messages and six-line first proofs leave the
    // proof row no room even folded (the folded bands end 11 px under the buffer), so the ladder's last step takes it: no proof row,
    // every cell empty, the caption naming all three rows; the key messages print whole at their type.
    expect(labels.filter((label) => label === 'Proof')).toHaveLength(0);
    expect(labels.filter((label) => label === 'Value proposition')).toHaveLength(0);
    expect(labels.filter((label) => label === 'Sound bite')).toHaveLength(0);
    expect(laid.rows).toEqual({ value: false, bite: false, proof: false });
    expect(laid.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesAll]);
    expect(FRAMEWORK_PORTRAIT_TOPS.footer - FRAMEWORK_PORTRAIT_TOPS.matrix - laid.height).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixBuffer);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-proof-cell"]')).toHaveLength(0);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-proofs-cut"]')).toHaveLength(0);
    expect(Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-row-note"]')).map((note) => note.textContent?.trim())).toEqual([
      'Value propositions, sound bites and proofs are on each goal page.',
    ]);
    const keys = Array.from(host().querySelectorAll<HTMLElement>('.fwp-matrix-key'));
    expect(keys.map((key) => key.style.fontSize)).toEqual(Array.from({ length: 8 }, () => `${FRAMEWORK_PORTRAIT_TYPE.matrixKey.size}px`));
    expect(keys.map((key) => key.textContent?.trim())).toEqual(Array.from({ length: 8 }, () => wordy));
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-vp"]')).toHaveLength(0);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-bite"]')).toHaveLength(0);
    // Short titles at eight goals stay one strip of eight columns.
    await setView(
      buildFoundationMessagePrintView(
        { ...CONTENT, mf: { ...CONTENT.mf, goals: goals.map((goal, index) => ({ ...goal, t: `Goal ${index + 1} title` })) } },
        'TestOrbit',
        2,
        null
      )
    );
    expect(query('mktg-framework-print-goals-band-0')?.style.getPropertyValue('--fwp-goal-count')).toBe('8');
    expect(query('mktg-framework-print-goals-band-1')).toBeNull();
  });

  it('folds the proof cells’ "+N more" lines into the one caption when that is what keeps a whole first proof a goal (the maintainer’s fold step)', async () => {
    // The family seeds' shape: long goal names on the overfull record's key messages and proofs, in the seeds' own brand face
    // (Instrument Sans). The head row grows for the names, and with each cell's own "+3 more" line the first proofs would fall below
    // the tight floor: the lines fold into the caption, every goal keeps one whole first proof at 10.5 px, and no cell prints a line
    // of its own. In the LF look the same shape drops the proof row instead (Inter measured as the served print sets it, the matrix's
    // calibrated factor), as the eight-goal test above reads it; the shared layout spec pins both faces.
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
    const keys = [
      'The cloud native stack is open, governed in the open and run everywhere.',
      'Build it where the whole industry maintains it with you.',
      'The certification employers recognize, against the standard everyone ships.',
      'Your production needs set the roadmap: bring them to the end user community.',
      'Where cloud native is built, taught and decided: come to the next event.',
      'Security is a shared practice here, not a product.',
      'Sustain the neutral home the whole ecosystem depends on.',
      'Learn cloud native the way the maintainers teach it.',
    ];
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
    const goals = longTitles.map((t, index) => ({
      ...CONTENT.mf.goals[0],
      id: `g${index}`,
      n: index + 1,
      t,
      key: keys[index],
      proof: Array.from({ length: 4 }, (_, at) => pair(facts[(index + at) % facts.length], at % 2 ? 'LFX field' : 'Website')),
    }));
    const seeds = brandKitTestRevision();
    const kit: BrandKitRevision = {
      ...seeds,
      kit: { ...seeds.kit, font: 'Instrument Sans' },
      chapters: { ...seeds.chapters, type: { ...seeds.chapters.type, family: 'Instrument Sans' } },
    };
    const view = buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals } }, 'TestOrbit', 2, kit);
    await configure('browser', view);
    const room = FRAMEWORK_PORTRAIT_TOPS.footer - FRAMEWORK_PORTRAIT_TOPS.matrix;
    expect(mktgPortraitLook(view.brand).fontStack).toContain('Instrument Sans');
    const laid = frameworkPortraitMatrix(view.goals, view.mf.crosscut, room, mktgPortraitLook(view.brand).fontStack);
    expect(laid.rows).toEqual({ value: false, bite: false, proof: true });
    expect(laid.notes).toEqual([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.goalPagesFold]);
    // The matrix ends a real buffer above the footer gap (the editor's 12 px): the fold is what keeps the row, not a margin of a few px.
    expect(room - laid.height).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixBuffer);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-title"]')).toHaveLength(8);
    const cells = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-matrix-proof-cell"]'));
    expect(cells).toHaveLength(8);
    expect(cells.map((cell) => cell.querySelectorAll('li').length)).toEqual(Array.from({ length: 8 }, () => 1));
    expect(cells.every((cell) => cell.classList.contains('fwp-matrix-proofs--tight'))).toBe(true);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-proofs-cut"]')).toHaveLength(0);
    expect(Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-matrix-row-note"]')).map((note) => note.textContent?.trim())).toEqual([
      'Value propositions and sound bites are on each goal page. More proofs for each goal are in LFX One.',
    ]);
  });
});
