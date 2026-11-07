// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MKTG_PRINT_INK_ON_LIGHT, MKTG_PRINT_LF_LOOK } from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView, FoundationMessageReport } from '@lfx-one/shared/interfaces';
import { buildFoundationMessagePrintView } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, describe, expect, it } from 'vitest';

import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * Locks the framework print's own behaviour: it prints the portrait book as
 * one fixed US Letter frame per plan page on the portrait print grammar, in
 * the plan's order, with the running head, the chapter band and the footer's
 * page number on every inner page and the live data in each page's slots;
 * standalone it is its own book, inside the family the family's; and it
 * loads the kit's typeface from Google Fonts once, in the browser only,
 * under the same link id the brand kit book uses. Without a kit (the LF
 * look) or on the server it leaves the head alone. The framework view's
 * spec covers how the print is placed and printed.
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

describe('MktgFrameworkPrintComponent', () => {
  let fixture: ComponentFixture<MktgFrameworkPrintComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
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

  it('prints one fixed Letter frame per plan page, in the book’s order, on the portrait grammar, numbered from the cover', async () => {
    await configure('browser', printView(null));
    const root = query('mktg-framework-print');
    expect(root?.classList.contains('lfx-mktg-portrait')).toBe(true);
    expect(root?.getAttribute('data-pages')).toBe('8');
    const pages = Array.from(root?.children ?? []);
    expect(pages.every((page) => page.tagName === 'LFX-MKTG-PORTRAIT-PAGE' && page.classList.contains('pp-page'))).toBe(true);
    // One goal and two profiles: the cover, the framework, one goal page, say and avoid, one profile page, the house, the numbers, sources and gaps.
    expect(pages.map((page) => page.getAttribute('data-page-id'))).toEqual([
      'cover',
      'framework',
      'goal-1',
      'say-avoid',
      'icps-1',
      'message-house',
      'key-numbers',
      'sources',
    ]);
    expect(pages.map((page) => page.getAttribute('data-page'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(pages.map((page) => page.getAttribute('data-testid'))).toEqual([
      'mktg-framework-print-page-cover',
      'mktg-framework-print-page-framework',
      'mktg-framework-print-page-goal-1',
      'mktg-framework-print-page-say-avoid',
      'mktg-framework-print-page-icps-1',
      'mktg-framework-print-page-message-house',
      'mktg-framework-print-page-key-numbers',
      'mktg-framework-print-page-sources',
    ]);
    expect(pages.map((page) => page.getAttribute('data-section'))).toEqual([
      'Cover',
      '01 Framework',
      '01 Framework',
      '01 Framework',
      '02 ICPs',
      '03 Message house',
      '04 Key numbers',
      '05 Sources',
    ]);
    // No table head or foot group anywhere: Chromium prints an empty page per table for one, and WebKit repeats neither.
    expect(root?.querySelectorAll('thead, tfoot')).toHaveLength(0);
    // The inner pages carry the running head (the section, the document's name), the title and the footer's two-digit number; the cover is bare.
    const inner = pages.slice(1);
    expect(inner.map((page) => page.querySelector('[data-testid="mktg-portrait-page-section"]')?.textContent?.trim())).toEqual([
      '01 Framework',
      '01 Framework',
      '01 Framework',
      '02 ICPs',
      '03 Message house',
      '04 Key numbers',
      '05 Sources',
    ]);
    expect(inner.every((page) => page.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent?.trim() === 'TestOrbit messaging framework')).toBe(
      true
    );
    expect(inner.map((page) => page.querySelector('[data-testid="mktg-portrait-page-title"]')?.textContent?.trim())).toEqual([
      'Framework',
      'Goal 1 · Adoption',
      'Say and avoid · anchor questions',
      'Ideal customer profiles',
      'Message house',
      'Key numbers',
      'Sources & gaps',
    ]);
    expect(inner.map((page) => page.querySelector('[data-testid="mktg-portrait-page-number"]')?.textContent?.trim())).toEqual([
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
    ]);
    expect(
      inner.every((page) => page.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent?.includes('TestOrbit · a Linux Foundation project'))
    ).toBe(true);
    // The chapter band on a chapter's first page only; the later pages of the framework chapter carry none.
    expect(inner.map((page) => page.querySelector('[data-testid="mktg-portrait-page-band"]') !== null)).toEqual([true, false, false, true, true, true, true]);
    expect(pages[0].querySelector('[data-testid="mktg-portrait-page-head"]')).toBeNull();
    expect(pages[0].querySelector('[data-testid="mktg-portrait-page-foot"]')).toBeNull();
    // Nothing above the footer says "a Linux Foundation project" but the cover's strip.
    const stray = Array.from(root?.querySelectorAll('*') ?? []).filter(
      (element) =>
        element.children.length === 0 &&
        element.textContent?.includes('a Linux Foundation project') &&
        !element.closest('[data-testid="mktg-portrait-page-foot"], [data-testid="mktg-framework-print-cover-strip"]')
    );
    expect(stray).toEqual([]);
  });

  it('opens on a cover with the tagline, the umbrella, the title and edition, the contents of every page after it, and the strip', async () => {
    const view = printView(null);
    await configure('browser', view);
    const cover = query('mktg-framework-print-page-cover');
    expect(query('mktg-framework-print-tagline')?.textContent?.trim()).toBe('Release, open.');
    expect(query('mktg-framework-print-umbrella')?.textContent?.trim()).toBe('Umbrella.');
    expect(query('mktg-framework-print-title')?.textContent?.trim()).toBe('Messaging Framework');
    expect(query('mktg-framework-print-version')?.textContent?.trim()).toBe('V2.0 · Approved 6 Nov 2026 · figures as of 4 Nov 2026');
    const rows = Array.from(cover?.querySelectorAll('[data-testid="mktg-framework-print-contents"] li') ?? []);
    expect(rows.map((row) => text(row))).toEqual([
      '02 Framework 2',
      '03 Goal 1 · Adoption 3',
      '04 Say and avoid · anchor questions 4',
      '05 Ideal customer profiles 5',
      '06 Message house 6',
      '07 Key numbers 7',
      '08 Sources & gaps 8',
    ]);
    // The LF look has no kit, so no web host: the strip's right carries the version and the approval's date.
    expect(text(query('mktg-framework-print-cover-strip'))).toBe('TestOrbit · a Linux Foundation project V2.0 · 6 Nov 2026');
    // The LF logo stands on the dark band.
    expect(query('mktg-framework-print-cover-logo')?.getAttribute('src')).toBe('/images/logo_lf_white.svg');
    // Without the approval and read dates, the edition shows the version alone; without any, no line.
    await setView(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null));
    expect(query('mktg-framework-print-version')?.textContent?.trim()).toBe('V2.0');
    await setView(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', null, null));
    expect(query('mktg-framework-print-version')).toBeNull();
  });

  it('prints the framework page’s statements and the goal matrix, one column per goal, with the tagline’s accent on its text', async () => {
    const view = printView(null);
    await configure('browser', view);
    const statements = query('mktg-framework-print-statements');
    expect(Array.from(statements?.querySelectorAll('.pp-lab') ?? []).map((label) => label.textContent?.trim())).toEqual([
      'Vision',
      'Mission',
      'Positioning statement',
      'Tagline',
    ]);
    expect(query('mktg-framework-print-tagline-accent')?.textContent?.trim()).toBe(view.mf.tagline);
    const matrix = query('mktg-framework-print-goals');
    expect(matrix?.style.getPropertyValue('--fwp-goal-count')).toBe('1');
    expect(Array.from(matrix?.querySelectorAll('.fwp-matrix-row > .pp-lab') ?? []).map((label) => label.textContent?.trim())).toEqual([
      'Value proposition',
      'Key message',
      'Proof',
      'Sound bite',
    ]);
    expect(matrix?.querySelector('.fwp-matrix-goal')?.textContent?.trim()).toBe('Adoption');
    expect(text(matrix?.querySelector('.fwp-matrix-proofs li'))).toBe('1,200 members Website');
    expect(matrix?.querySelector('.fwp-matrix-bite')?.textContent?.trim()).toBe('“In the open”');
    expect(matrix?.querySelector('.fwp-matrix-crosscut')?.textContent?.trim()).toBe('Every column grows the audience.');
    // Segments belong to the profile pages: the matrix does not name them.
    expect(matrix?.textContent).not.toContain('End users');
    await setView({ ...view, mf: { ...view.mf, tagline: '' } });
    expect(query('mktg-framework-print-tagline-accent')).toBeNull();
  });

  it('gives each goal a page: its number, value proposition, key message, proof points with sources, sound bite and the profiles it is for, in the goal’s order', async () => {
    await configure('browser', printView(null));
    const page = query('mktg-framework-print-page-goal-1');
    expect(page?.querySelector('[data-testid="mktg-framework-print-goal-1"] .fwp-goal-number')?.textContent?.trim()).toBe('01');
    expect(page?.querySelector('.fwp-goal-vp')?.textContent?.trim()).toBe('VP.');
    expect(text(page?.querySelector('.fwp-goal-key'))).toBe('Key message Key.');
    expect(text(page?.querySelector('.fwp-proof-row'))).toBe('1,200 members Website');
    expect(page?.querySelector('.fwp-goal-bite-text')?.textContent?.trim()).toBe('“In the open”');
    const served = Array.from(page?.querySelectorAll('.fwp-served-card') ?? []);
    expect(served.map((card) => card.querySelector('.fwp-served-name')?.textContent?.trim())).toEqual(['End users', 'Maintainers']);
    expect(text(served[0])).toBe('End users Needs Need. Ask them to Try it.');
    // The blocks sit where the design places them (the grammar's [lfxPpRect]).
    expect(page?.querySelector('[data-testid="mktg-framework-print-goal-1"]')?.getAttribute('style')).toContain('top: 136px');
    expect(page?.querySelector('.fwp-goal-key')?.getAttribute('style')).toContain('top: 330px');
  });

  it('fits a long value proposition and sound bite to their room: smaller first, cut at a sentence past 72 %', async () => {
    const long = 'A very long value proposition that goes on and on about the project and its many benefits. '.repeat(8).trim();
    await configure(
      'browser',
      buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], vp: long, bite: long }] } }, 'TestOrbit', 2, null)
    );
    const page = query('mktg-framework-print-page-goal-1');
    const vp = page?.querySelector<HTMLElement>('.fwp-goal-vp');
    expect(parseFloat(vp?.style.fontSize ?? '22')).toBeLessThan(22);
    expect(parseFloat(vp?.style.fontSize ?? '0')).toBeGreaterThanOrEqual(22 * 0.72 - 0.01);
    expect((vp?.textContent ?? '').length).toBeLessThan(long.length);
    const bite = page?.querySelector<HTMLElement>('.fwp-goal-bite-text');
    expect(parseFloat(bite?.style.fontSize ?? '34')).toBeLessThan(34);
    // A short one is set at its size.
    await setView(printView(null));
    expect(page?.querySelector<HTMLElement>('.fwp-goal-vp')?.style.fontSize).toBe('22px');
  });

  it('prints say and avoid with the anchor questions, numbered, and the crosscut note; says when nothing is to be avoided', async () => {
    const view = printView(null);
    await configure('browser', view);
    expect(Array.from(query('mktg-framework-print-say')?.querySelectorAll('li') ?? []).map((pill) => pill.textContent?.trim())).toEqual(['open']);
    expect(text(query('mktg-framework-print-avoid')?.querySelector('li'))).toBe('synergy → working together');
    expect(text(query('mktg-framework-print-anchor')?.querySelector('li'))).toBe('01 Which goal does this serve?');
    expect(text(query('mktg-framework-print-page-say-avoid')?.querySelector('.fwp-crosscut-box'))).toBe('Across the goals Every column grows the audience.');
    await setView({ ...view, avoidRows: [] });
    expect(query('mktg-framework-print-avoid')).toBeNull();
    expect(query('mktg-framework-print-avoid-empty')?.textContent?.trim()).toBe('Nothing to avoid was stated.');
  });

  it('prints the profiles two a page with their goal chips and fields, and the goals × profiles matrix only where a page holds one', async () => {
    await configure('browser', printView(null));
    const page = query('mktg-framework-print-page-icps-1');
    expect(page?.querySelector('.fwp-intro-icps')?.textContent).toContain('2 profiles. Each names who they are, what they need, what TestOrbit gives them,');
    const rows = Array.from(page?.querySelectorAll('.fwp-icp-row') ?? []);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['mktg-framework-print-icp-users', 'mktg-framework-print-icp-maintainers']);
    expect(Array.from(rows[0].querySelectorAll('.fwp-icp-chips .pp-chip')).map((chip) => chip.textContent?.trim())).toEqual(['Individual', 'Goal 1']);
    expect(Array.from(rows[0].querySelectorAll('dt')).map((term) => term.textContent?.trim())).toEqual([
      'Need',
      'Value',
      'Lead message',
      'Call to action',
      'Objection',
      'Channels',
    ]);
    expect(rows[0].querySelector('.fwp-icp-lead')?.textContent?.trim()).toBe('Ship with confidence.');
    expect(text(rows[0].querySelectorAll('dd')[4])).toBe('“Too early?” — Not at all.');
    expect(text(rows[0].querySelectorAll('dd')[5])).toBe('Docs · Slack A fact Docs');
    expect(rows[0].querySelector('.fwp-icp-personas')?.textContent?.trim()).toBe('SRE · uptime');
    // An objection without an answer is not printed, question included; the profile's other fields stand (the editor's rule).
    expect(Array.from(rows[1].querySelectorAll('dt')).map((term) => term.textContent?.trim())).toEqual([
      'Need',
      'Value',
      'Lead message',
      'Call to action',
      'Channels',
    ]);
    expect(rows[1].textContent).not.toContain('Too early?');
    expect(host().textContent).not.toContain('no answer');
    // The first profile page's rows start under the intro at 214 (the chapter's first page).
    expect(rows[0].parentElement?.getAttribute('style')).toContain('top: 214px');
    expect(query('mktg-framework-print-matrix')).toBeNull();
    // One profile: the page has room for the goals × profiles matrix, one row per profile, a dot where the goal is written for it.
    await setView(buildFoundationMessagePrintView({ ...CONTENT, icp: [CONTENT.icp[0]] }, 'TestOrbit', 2, null));
    const matrix = query('mktg-framework-print-matrix');
    expect(Array.from(matrix?.querySelectorAll('th') ?? []).map((cell) => text(cell))).toEqual(['Profile', 'Goal 1 Adoption']);
    expect(matrix?.querySelector('.fwp-grid-name')?.textContent?.trim()).toBe('End users');
    expect(matrix?.querySelectorAll('.fwp-grid-dot')).toHaveLength(1);
  });

  it('prints the message house with its pillars, why now and the audiences, and the key numbers with every figure’s source', async () => {
    await configure('browser', printView(null));
    const house = query('mktg-framework-print-house');
    expect(house?.querySelector('.fwp-house-umbrella')?.textContent?.trim()).toBe('Umbrella.');
    expect(house?.querySelector('.fwp-house-line')?.textContent?.trim()).toBe('Brand line · Release, open.');
    expect(query('mktg-framework-print-pillars')?.style.getPropertyValue('--fwp-pillar-count')).toBe('1');
    expect(text(query('mktg-framework-print-pillars'))).toBe('Open Open message. Fact Web');
    expect(query('mktg-framework-print-pillars')?.querySelector('.fwp-pillar')?.classList.contains('fwp-pillar-spark')).toBe(true);
    expect(query('mktg-framework-print-page-message-house')?.querySelector('.fwp-why-now-text')?.textContent?.trim()).toBe('A Linux Foundation project.');
    expect(text(query('mktg-framework-print-audiences'))).toBe('End users. Ship with confidence.');
    const numbers = query('mktg-framework-print-numbers');
    expect(numbers?.querySelector('.fwp-number')?.textContent?.trim()).toBe('1,200');
    expect(numbers?.querySelector('.fwp-number-label')?.textContent?.trim()).toBe('members');
    expect(query('mktg-framework-print-page-key-numbers')?.querySelector('.pp-body')?.textContent?.trim()).toBe(
      'The figures the framework leans on, with where each came from. LFX figures are as of 4 Nov 2026.'
    );
    const facts = Array.from(query('mktg-framework-print-facts')?.querySelectorAll('tbody tr') ?? []).slice(1);
    expect(facts.map((row) => text(row))).toEqual(['1,200 members Website Goal 1 · Adoption']);
  });

  it('sets the key numbers’ tiles in full rows: pairs of 344, an odd count’s last tile across the column, the table under them', async () => {
    const nums = (count: number) => Array.from({ length: count }, (_, index) => pair(`${index + 1},000`, `figure ${index + 1}`));
    await configure('browser', buildFoundationMessagePrintView({ ...CONTENT, nums: nums(4) }, 'TestOrbit', 2, null));
    const tiles = () => Array.from(host().querySelectorAll('.fwp-number-tile'));
    expect(tiles().map((tile) => tile.classList.contains('fwp-number-tile-wide'))).toEqual([false, false, false, false]);
    expect(tiles().map((tile) => tile.classList.contains('fwp-number-tile-lead'))).toEqual([true, false, false, false]);
    // Two rows of 140 from 210, a 16 gap, then 28 to the table: 534.
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 534px');
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: nums(3) }, 'TestOrbit', 2, null));
    expect(tiles().map((tile) => tile.classList.contains('fwp-number-tile-wide'))).toEqual([false, false, true]);
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 534px');
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: nums(1) }, 'TestOrbit', 2, null));
    expect(tiles().map((tile) => tile.classList.contains('fwp-number-tile-wide'))).toEqual([true]);
    expect(query('mktg-framework-print-facts')?.getAttribute('style')).toContain('top: 378px');
  });

  it('closes on the sources and gaps: what was read (named plainly), what could not be, the gaps, the notes, and the approval card', async () => {
    const view = printView(null);
    await configure('browser', view);
    expect(query('mktg-framework-print-sources-intro')?.textContent?.trim()).toBe(
      'What the framework was built from on 4 Nov 2026, what could not be read, and what is still open.'
    );
    expect(Array.from(query('mktg-framework-print-sources-read')?.querySelectorAll('li') ?? []).map((item) => item.textContent?.trim())).toEqual([
      'https://orbit.example.org',
      'https://orbit.example.org/about',
      'The launch press release (linuxfoundation.org/press)',
    ]);
    expect(query('mktg-framework-print-sources-failed')?.textContent?.trim()).toBe('Members page — timed out');
    expect(query('mktg-framework-print-gaps')?.textContent?.trim()).toBe('No 2027 figures yet.');
    expect(Array.from(query('mktg-framework-print-notes')?.querySelectorAll('li') ?? []).map((item) => item.textContent?.trim())).toEqual([
      'First note.',
      'Second note.',
    ]);
    expect(text(query('mktg-framework-print-approval'))).toBe(
      'V2.0 · Approved 6 Nov 2026. The gaps above were open at approval. A later run re-reads the sources and refreshes the LFX figures.'
    );
    // The reviewer's note is not printed anywhere.
    expect(host().textContent).not.toContain('For the reviewer.');
    // An empty report: the shared empty states for the failed sources and the gaps, no notes block, no read date in the intro, no approval clause.
    await setView(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null));
    expect(query('mktg-framework-print-sources-intro')?.textContent?.trim()).toBe(
      'What the framework was built from, what could not be read, and what is still open.'
    );
    expect(query('mktg-framework-print-sources-failed-empty')?.textContent?.trim()).toBe('No source failed.');
    expect(query('mktg-framework-print-gaps-empty')?.textContent?.trim()).toBe('The sources left no gap.');
    expect(query('mktg-framework-print-notes')).toBeNull();
    expect(text(query('mktg-framework-print-approval'))).toBe('V2.0. A later run re-reads the sources and refreshes the LFX figures.');
  });

  it('inside the family’s book drops the cover and the band, prints the family’s running head and footer, and numbers from the family’s first page', async () => {
    await configure('browser', printView(null));
    fixture.componentRef.setInput('book', { inFamily: true, headRight: 'TestOrbit positioning & brand', footLeft: 'The family footer', firstPage: 4 });
    await fixture.whenStable();
    const pages = Array.from(query('mktg-framework-print')?.children ?? []);
    expect(pages.map((page) => page.getAttribute('data-page-id'))).toEqual([
      'framework',
      'goal-1',
      'say-avoid',
      'icps-1',
      'message-house',
      'key-numbers',
      'sources',
    ]);
    expect(pages.map((page) => page.getAttribute('data-page'))).toEqual(['4', '5', '6', '7', '8', '9', '10']);
    expect(pages.map((page) => page.getAttribute('data-section'))).toEqual([
      'Messaging framework · Framework',
      'Messaging framework · Framework',
      'Messaging framework · Framework',
      'Messaging framework · ICPs',
      'Messaging framework · Message house',
      'Messaging framework · Key numbers',
      'Messaging framework · Sources',
    ]);
    expect(host().querySelectorAll('[data-testid="mktg-portrait-page-band"]')).toHaveLength(0);
    expect(pages[0].querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent?.trim()).toBe('TestOrbit positioning & brand');
    expect(text(pages[0].querySelector('[data-testid="mktg-portrait-page-foot"]'))).toBe('The family footer 04');
    // The first profile page's rows start at 190 without the band's first-page intro room.
    expect(pages[3].querySelector('.fwp-icp-row')?.parentElement?.getAttribute('style')).toContain('top: 190px');
  });

  it('sets the pages in the view’s brand through the grammar’s look, or in the look the family passes', async () => {
    const kit = brandKitTestRevision();
    const pale: BrandKitRevision = { ...kit, kit: { ...kit.kit, dark: '#FFFFFF' } };
    await configure('browser', printView(pale));
    const frame = query('mktg-framework-print-page-framework');
    expect(frame?.style.getPropertyValue('--pp-dark')).toBe('#FFFFFF');
    expect(frame?.style.getPropertyValue('--pp-on-dark')).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(frame?.style.getPropertyValue('--pp-font')).toContain('Montserrat');
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('kit');
    fixture.componentRef.setInput('look', { dark: '#101010', accent: '#FF0000', spark: '#00FF00', onAccent: '#FFFFFF', onDark: '#FFFFFF', fontStack: 'serif' });
    await fixture.whenStable();
    expect(frame?.style.getPropertyValue('--pp-dark')).toBe('#101010');
    expect(frame?.style.getPropertyValue('--pp-spark')).toBe('#00FF00');
    expect(frame?.style.getPropertyValue('--pp-font')).toBe('serif');
    // The LF look without a kit.
    fixture.componentRef.setInput('look', null);
    await setView(printView(null));
    expect(frame?.style.getPropertyValue('--pp-dark')).toBe(MKTG_PRINT_LF_LOOK.dark);
  });

  describe('in the browser', () => {
    it('with a kit, appends the typeface’s Google Fonts stylesheet once under the book’s link id', async () => {
      const view = printView(brandKitTestRevision());
      const url = view.brand.fontUrl;
      expect(url).toContain('family=Montserrat');
      await configure('browser', view);

      const links = fontLinks();
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(`brand-kit-font-${encodeURIComponent(url ?? '')}`);
      expect(links[0].rel).toBe('stylesheet');
      expect(links[0].getAttribute('href')).toBe(url);

      // A new view of the same kit (another project name, same typeface) loads nothing more.
      await setView(printView(brandKitTestRevision(), 'Another Orbit'));
      expect(fontLinks()).toHaveLength(1);
    });

    it('with a kit whose typeface is already loaded (the kit view loaded it), adds no second link', async () => {
      const view = printView(brandKitTestRevision());
      const existing = document.createElement('link');
      existing.id = `brand-kit-font-${encodeURIComponent(view.brand.fontUrl ?? '')}`;
      existing.rel = 'stylesheet';
      document.head.appendChild(existing);

      await configure('browser', view);
      expect(fontLinks()).toEqual([existing]);
    });

    it('in the LF look (no kit, no typeface to load), touches nothing in the head', async () => {
      const linksBefore = document.head.querySelectorAll('link').length;
      const view = printView(null);
      expect(view.brand.fontUrl).toBeNull();
      await configure('browser', view);
      expect(fontLinks()).toHaveLength(0);
      expect(document.head.querySelectorAll('link')).toHaveLength(linksBefore);
    });
  });

  describe('on the server', () => {
    it('renders the print in the fallback typeface without touching the head, even with a kit', async () => {
      await configure('server', printView(brandKitTestRevision()));
      expect(query('mktg-framework-print')).not.toBeNull();
      expect(fontLinks()).toHaveLength(0);
    });
  });
});
