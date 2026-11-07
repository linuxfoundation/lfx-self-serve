// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_TILE_SHARES,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_PORTRAIT_PAGE,
  MKTG_PRINT_INK_ON_LIGHT,
  MKTG_PRINT_LF_LOOK,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_FIT,
} from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView, FoundationMessageReport } from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessagePrintView,
  foundationMessagePrintCutNote,
  frameworkPortraitCutNoteHeightIn,
  frameworkPortraitHouse,
  frameworkPortraitIcpPages,
  frameworkPortraitServedCount,
  frameworkPortraitPlan,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  mktgPortraitCharsPerLine,
  mktgPortraitParaHeight,
} from '@lfx-one/shared/utils';
import { brandKitLogolessFixture, brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, describe, expect, it } from 'vitest';

import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * Locks the framework print's own behavior: it prints the portrait book as
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
  /** One frame by its plan id (the grammar's host contract: data-testid lfx-mktg-portrait-page + data-page-id). */
  const frame = (pageId: string): HTMLElement | null => host().querySelector(`[data-testid="lfx-mktg-portrait-page"][data-page-id="${pageId}"]`);
  /** Where the frame places an element: its inline top, px (the [lfxPpRect] style). */
  const top = (element: Element | null | undefined): number => parseFloat((element as HTMLElement | null)?.style.top ?? 'NaN');
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
    // One data-testid per frame, the grammar's: the plan id lives in data-page-id alone.
    expect(pages.every((page) => page.getAttribute('data-testid') === 'lfx-mktg-portrait-page')).toBe(true);
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
    const cover = frame('cover');
    expect(query('mktg-framework-print-tagline')?.textContent?.trim()).toBe('Release, open.');
    expect(query('mktg-framework-print-umbrella')?.textContent?.trim()).toBe('Umbrella.');
    expect(query('mktg-framework-print-title')?.textContent?.trim()).toBe('Messaging Framework');
    expect(query('mktg-framework-print-version')?.textContent?.trim()).toBe('V2.0 · Approved 6 Nov 2026 · figures as of 4 Nov 2026');
    // The editor's gap under the cover title (16–24 px, set at 18) is the global partial's `.fwp-cover-edition` rule, which the
    // unit build does not load: the class is asserted here, the computed gap in the e2e (mktg-os-asset-views.spec.ts).
    expect(query('mktg-framework-print-version')?.classList.contains('fwp-cover-edition')).toBe(true);
    // Each row's page number once, as the two-digit leader (the editor's read: no trailing duplicate); a short book's rows at the design's
    // measure, not tightened, no run collapsed (frameworkPortraitContents bounds the list above the strip).
    const list = cover?.querySelector('[data-testid="mktg-framework-print-contents"]');
    expect(list?.classList.contains('fwp-contents--tight')).toBe(false);
    expect(list?.getAttribute('data-collapsed')).toBeNull();
    const rows = Array.from(list?.querySelectorAll('li') ?? []);
    expect(rows.map((row) => text(row))).toEqual([
      '02 Framework',
      '03 Goal 1 · Adoption',
      '04 Say and avoid · anchor questions',
      '05 Ideal customer profiles',
      '06 Message house',
      '07 Key numbers',
      '08 Sources & gaps',
    ]);
    expect(rows.map((row) => row.querySelectorAll('span').length)).toEqual(rows.map(() => 2));
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
    // The cards share the row by FRAMEWORK_PORTRAIT_STATEMENT_SHARES: the tagline's widened from the design's 0.7 so it holds two words a line,
    // at the design's 18 px when its longest pair of words fits that line, smaller otherwise.
    expect(Array.from(statements?.querySelectorAll<HTMLElement>('.fwp-card') ?? []).map((card) => card.style.flexGrow)).toEqual(['0.7', '1', '1.25', '1.05']);
    expect(query('mktg-framework-print-tagline-accent')?.style.fontSize).toBe(
      `${frameworkPortraitTaglineSize(view.mf.tagline, frameworkPortraitStatementWidth(1.05, true))}px`
    );
    await setView({ ...view, mf: { ...view.mf, tagline: 'Open standards for agentic AI' } });
    const taglineSize = parseFloat(query('mktg-framework-print-tagline-accent')?.style.fontSize ?? '0');
    expect(taglineSize).toBe(16);
    expect(mktgPortraitCharsPerLine(frameworkPortraitStatementWidth(1.05, true), taglineSize, { weight: 500 })).toBeGreaterThanOrEqual('Open standards'.length);
    await setView(view);
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
    // The source tag is the fixed vocabulary, kept whole as the mock's: the fact before it wraps, never the tag ("LFX / FIELD").
    const tag = matrix?.querySelector('.fwp-matrix-source');
    expect(tag?.textContent?.trim()).toBe('Website');
    // Its `white-space: nowrap` is the global partial's rule, asserted computed in the e2e (mktg-os-asset-views.spec.ts).
    expect(tag?.classList.contains('fwp-matrix-source')).toBe(true);
    expect(matrix?.querySelector('.fwp-matrix-bite')?.textContent?.trim()).toBe('“In the open”');
    // Short cells print as written at their type (frameworkPortraitMatrix fits them only where the rows would crowd the proofs out).
    const vp = matrix?.querySelector<HTMLElement>('.fwp-matrix-vp');
    const key = matrix?.querySelector<HTMLElement>('.fwp-matrix-key');
    expect([vp?.textContent?.trim(), vp?.style.fontSize, key?.textContent?.trim(), key?.style.fontSize]).toEqual([
      CONTENT.mf.goals[0].vp,
      `${FRAMEWORK_PORTRAIT_TYPE.matrixCell.size}px`,
      CONTENT.mf.goals[0].key,
      `${FRAMEWORK_PORTRAIT_TYPE.matrixKey.size}px`,
    ]);
    expect(matrix?.querySelector<HTMLElement>('.fwp-matrix-bite')?.style.fontSize).toBe(`${FRAMEWORK_PORTRAIT_TYPE.matrixBite.size}px`);
    // The head row's title too: a short title at its type (a long one is fitted into the board's two lines by the layout).
    const title = matrix?.querySelector<HTMLElement>('.fwp-matrix-goal');
    expect([title?.textContent?.trim(), title?.style.fontSize]).toEqual([CONTENT.mf.goals[0].t, `${FRAMEWORK_PORTRAIT_TYPE.matrixGoal.size}px`]);
    expect(matrix?.querySelector('.fwp-matrix-crosscut')?.textContent?.trim()).toBe('Every column grows the audience.');
    // Segments belong to the profile pages: the matrix does not name them.
    expect(matrix?.textContent).not.toContain('End users');
    await setView({ ...view, mf: { ...view.mf, tagline: '' } });
    expect(query('mktg-framework-print-tagline-accent')).toBeNull();
  });

  it('gives each goal a page: its number, value proposition, key message, proof points with sources, sound bite and the profiles it is for, in the goal’s order', async () => {
    await configure('browser', printView(null));
    const page = frame('goal-1');
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
    const page = frame('goal-1');
    const vp = page?.querySelector<HTMLElement>('.fwp-goal-vp');
    expect(parseFloat(vp?.style.fontSize ?? '22')).toBeLessThan(22);
    // The floor is 72 % as the fit model measures it: in half-px steps (22 × 0.72 = 15.84 → 15.5), the size the text was measured at (P2-4).
    expect(parseFloat(vp?.style.fontSize ?? '0')).toBeGreaterThanOrEqual(Math.floor(22 * 0.72 * 2) / 2);
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
    // The intro counts the anchor questions in words, as the mock's sentence does ("the three questions") with the agent's three.
    expect(text(frame('say-avoid')?.querySelector('.fwp-intro-say'))).toBe(
      'The words the framework uses, the ones it replaces, and the one question every piece of content answers.'
    );
    expect(text(frame('say-avoid')?.querySelector('.fwp-crosscut-box'))).toBe('Across the goals Every column grows the audience.');
    await setView({ ...view, mf: { ...view.mf, anchor: ['Which goal?', 'Which segment?', 'Which key message?'] } });
    expect(text(frame('say-avoid')?.querySelector('.fwp-intro-say'))).toBe(
      'The words the framework uses, the ones it replaces, and the three questions every piece of content answers.'
    );
    await setView({ ...view, avoidRows: [] });
    expect(query('mktg-framework-print-avoid')).toBeNull();
    expect(query('mktg-framework-print-avoid-empty')?.textContent?.trim()).toBe('Nothing to avoid was stated.');
  });

  it('prints the profiles two a page with their goal chips and fields, and the goals × profiles matrix only where a page holds one', async () => {
    await configure('browser', printView(null));
    const page = frame('icps-1');
    expect(page?.querySelector('.fwp-intro-icps')?.textContent).toContain('2 profiles. Each names who they are, what they need, what TestOrbit gives them,');
    const rows = Array.from(page?.querySelectorAll('.fwp-icp-row') ?? []);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['mktg-framework-print-icp-users', 'mktg-framework-print-icp-maintainers']);
    expect(Array.from(rows[0].querySelectorAll('.fwp-icp-chips .pp-chip')).map((chip) => chip.textContent?.trim())).toEqual(['Individual', 'Goal 1']);
    // The board's six fields, two rows of three: the proof figures sit under the channels, as its card draws them.
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
    expect(rows[0].querySelector('.fwp-icp-proofs')?.parentElement?.previousElementSibling?.textContent?.trim()).toBe('Channels');
    expect(rows[0].querySelector('.fwp-icp-personas')?.textContent?.trim()).toBe('SRE · uptime');
    // An objection without a response prints its question alone: no dash, no placeholder (the editor's rule, 7 Nov).
    expect(Array.from(rows[1].querySelectorAll('dt')).map((term) => term.textContent?.trim())).toEqual([
      'Need',
      'Value',
      'Lead message',
      'Call to action',
      'Objection',
      'Channels',
    ]);
    expect(text(rows[1].querySelectorAll('dd')[4])).toBe('“Too early?”');
    expect(host().textContent).not.toContain('no answer');
    expect(host().textContent).not.toContain('” —  ');
    // The name-and-tags column: the board's 190 px, grown so the tags hold one line; here two short tags fit the board's width.
    expect((rows[0].querySelector('.fwp-icp-who') as HTMLElement).style.width).toBe('190px');
    // The first profile page's rows start under the intro at 214 (the chapter's first page).
    expect(rows[0].parentElement?.getAttribute('style')).toContain('top: 214px');
    expect(query('mktg-framework-print-matrix')).toBeNull();
    // One profile: the page has room for the goals × profiles matrix, one row per profile, a dot where the goal is written for it.
    await setView(buildFoundationMessagePrintView({ ...CONTENT, icp: [CONTENT.icp[0]] }, 'TestOrbit', 2, null));
    const matrix = query('mktg-framework-print-matrix');
    expect(Array.from(matrix?.querySelectorAll('th') ?? []).map((cell) => text(cell))).toEqual(['Profile', 'Goal 1 Adoption']);
    expect(matrix?.querySelector('.fwp-grid-name')?.textContent?.trim()).toBe('End users');
    expect(matrix?.querySelectorAll('[data-testid="mktg-framework-print-matrix-row"]')).toHaveLength(1);
    expect(matrix?.querySelectorAll('[data-testid="mktg-framework-print-matrix-dot"]')).toHaveLength(1);
    expect(matrix?.querySelector('[data-testid="mktg-framework-print-matrix-dot"]')?.getAttribute('role')).toBe('img');
  });

  it('prints the message house with its pillars, why now and the audiences, and the key numbers with every figure’s source', async () => {
    await configure('browser', printView(null));
    const house = query('mktg-framework-print-house');
    expect(house?.querySelector('.fwp-house-umbrella')?.textContent?.trim()).toBe('Umbrella.');
    expect(house?.querySelector('.fwp-house-line')?.textContent?.trim()).toBe('Brand line · Release, open.');
    expect(query('mktg-framework-print-pillars')?.style.getPropertyValue('--fwp-pillar-count')).toBe('1');
    expect(text(query('mktg-framework-print-pillars'))).toBe('Open Open message. Fact Web');
    expect(query('mktg-framework-print-pillars')?.querySelector('.fwp-pillar')?.classList.contains('fwp-pillar-spark')).toBe(true);
    expect(frame('message-house')?.querySelector('.fwp-why-now-text')?.textContent?.trim()).toBe('A Linux Foundation project.');
    expect(text(query('mktg-framework-print-audiences'))).toBe('End users. Ship with confidence.');
    // Why now and the audiences sit a gap under the measured pillars (one short pillar here: well above the design's 780), side by side.
    const whyNowTop = top(query('mktg-framework-print-why-now'));
    expect(whyNowTop).toBe(frameworkPortraitHouse(printView(null), { text: 'Umbrella.', size: 19 }).lowerTop);
    expect(whyNowTop).toBeLessThan(500);
    expect(top(query('mktg-framework-print-audiences')?.parentElement)).toBe(whyNowTop);
    const numbers = query('mktg-framework-print-numbers');
    expect(numbers?.querySelector('.fwp-number')?.textContent?.trim()).toBe('1,200');
    expect(numbers?.querySelector('.fwp-number-label')?.textContent?.trim()).toBe('members');
    expect(frame('key-numbers')?.querySelector('.pp-body')?.textContent?.trim()).toBe(
      'The figures the framework leans on, with where each came from. LFX figures are as of 4 Nov 2026.'
    );
    const facts = Array.from(query('mktg-framework-print-facts')?.querySelectorAll('tbody tr') ?? []).slice(1);
    expect(facts.map((row) => text(row))).toEqual(['1,200 members Website Goal 1 · Adoption']);
    // The table's columns are its <colgroup> (fixed layout reads <col>): 50/25/25 %; the source chip wraps within the framework's cap.
    const cols = Array.from(query('mktg-framework-print-facts-table')?.querySelectorAll<HTMLTableColElement>('colgroup > col') ?? []);
    expect(cols.map((col) => col.style.width)).toEqual(['50%', '25%', '25%']);
    expect(facts[0].querySelector('.fwp-fact-source .pp-chip')?.classList.contains('fwp-chip-wrap')).toBe(true);
  });

  it('binds the fitted blocks’ type on the root as --fwp-* custom properties, one value for the fit model and the stylesheet', async () => {
    await configure('browser', printView(null));
    const root = query('mktg-framework-print');
    expect(root?.style.getPropertyValue('--fwp-statement-size')).toBe(`${FRAMEWORK_PORTRAIT_TYPE.statement.size}px`);
    expect(root?.style.getPropertyValue('--fwp-statement-line')).toBe(`${FRAMEWORK_PORTRAIT_TYPE.statement.line}`);
    expect(root?.style.getPropertyValue('--fwp-goal-value-weight')).toBe(`${FRAMEWORK_PORTRAIT_TYPE.goalValue.weight}`);
    // The audience's name is bold where its row is regular (the stylesheet reads `--fwp-audience-name-weight` on the strong).
    expect(root?.style.getPropertyValue('--fwp-audience-name-weight')).toBe('600');
    expect(root?.style.getPropertyValue('--fwp-audience-row-weight')).toBe('400');
    expect(root?.style.getPropertyValue('--fwp-cover-umbrella-size')).toBe('32px');
    expect(root?.style.getPropertyValue('--fwp-source-line')).toBe('1.6');
    // The goal matrix sits at the shared top under the statement cards.
    expect(top(query('mktg-framework-print-goals'))).toBe(FRAMEWORK_PORTRAIT_TOPS.matrix);
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
    const tileBox = tiles()[0].getBoundingClientRect();
    const figureBox = tiles()[0].querySelector('.fwp-number')?.getBoundingClientRect();
    expect(figureBox && figureBox.right <= tileBox.right + 0.5).toBe(true);
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
    const rows = () => Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-number-row"]'));
    expect(rows().map((row) => row.querySelector('.fwp-number-cell')?.textContent?.trim())).toEqual(nums(9).map(([number]) => number));
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
    const firstRows = Array.from(frame('key-numbers')?.querySelectorAll('[data-testid="mktg-framework-print-number-row"]') ?? []);
    const secondRows = Array.from(second?.querySelectorAll('[data-testid="mktg-framework-print-number-row"]') ?? []);
    expect(firstRows.length).toBeGreaterThan(6);
    expect(firstRows.length + secondRows.length).toBe(40);
    expect(secondRows[0].querySelector('.fwp-number-cell')?.textContent?.trim()).toBe(`${firstRows.length + 1},000`);
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
    expect(goalPage?.querySelectorAll('.fwp-proof-row')).toHaveLength(0);
    expect(goalPage?.textContent).toContain('Proof points');
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-proofs-cut"]')?.textContent?.trim()).toBe(
      "+3 more on the framework's Framework tab in LFX One"
    );
  });

  it('closes on the sources and gaps: what was read as stored (its type prefix off), what could not be, the gaps, and the approval card; never the notes', async () => {
    const view = printView(null);
    await configure('browser', view);
    expect(query('mktg-framework-print-sources-intro')?.textContent?.trim()).toBe(
      'What the framework was built from on 4 Nov 2026, what could not be read, and what is still open.'
    );
    // Each source in a reader's words and never a path (foundationMessagePrintSourceRows): its type prefix off, a URL as its host, the pages
    // of one host gathered into one counted row, a press release named with its site's host.
    expect(Array.from(query('mktg-framework-print-sources-read')?.querySelectorAll('li') ?? []).map((item) => item.textContent?.trim())).toEqual([
      'orbit.example.org · 2 pages',
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
      'V2.0 · Approved 6 Nov 2026. The gaps above were open at approval. A later run re-reads the sources and refreshes the LFX figures.'
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
    expect(text(query('mktg-framework-print-approval'))).toBe('V2.0 · Approved 6 Nov 2026. A later run re-reads the sources and refreshes the LFX figures.');
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
    const failed = query('mktg-framework-print-sources-failed')?.querySelectorAll('li').length ?? 0;
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

  it('holds four "Who it’s for" cards at most, the board’s narrowest, and says the rest under the row; a long name is fitted with its lines', async () => {
    const ids = ['users', 'maintainers', 'c', 'd', 'e', 'f'];
    const many: FoundationMessageContent = {
      ...CONTENT,
      mf: { ...CONTENT.mf, goals: [{ ...CONTENT.mf.goals[0], icps: ids }] },
      icp: ids.map((id, index) => ({
        ...CONTENT.icp[index % 2],
        id,
        name: index === 0 ? 'A profile name long enough to wrap inside a narrow card' : `Profile ${id}`,
      })),
    };
    await configure('browser', buildFoundationMessagePrintView(many, 'TestOrbit', 2, null));
    const goalPage = frame('goal-1');
    const cards = Array.from(goalPage?.querySelectorAll<HTMLElement>('.fwp-served-card') ?? []);
    expect(cards).toHaveLength(frameworkPortraitServedCount());
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.querySelector('.fwp-served-name')?.textContent?.trim())).toEqual([
      'A profile name long enough to wrap inside a narrow card',
      'Profile maintainers',
      'Profile c',
      'Profile d',
    ]);
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-served-cut"]')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(2, 'framework'));
    // The name is part of the fitted block: it prints at the size the fit model gave it, never past the type's.
    const names = cards.map((card) => parseFloat(card.querySelector<HTMLElement>('.fwp-served-name')?.style.fontSize ?? '0'));
    expect(names.every((size) => size > 0 && size <= FRAMEWORK_PORTRAIT_TYPE.servedName.size)).toBe(true);
    // Six served profiles with long need and ask lines: the four cards' fitted lines, measured by the fit model at the sizes they
    // print, stay inside the room the note under the row leaves them, so the block ends above the footer rule (1000).
    const long = 'a line long enough to wrap several times inside a quarter-width card, with a second clause that runs on past the first';
    const longNeed = { ...many, icp: many.icp.map((icp) => ({ ...icp, need: `${long}.`, cta: `${long}.` })) };
    await setView(buildFoundationMessagePrintView(longNeed, 'TestOrbit', 2, null));
    const longPage = frame('goal-1');
    const longCards = Array.from(longPage?.querySelectorAll<HTMLElement>('.fwp-served-card') ?? []);
    expect(longCards).toHaveLength(4);
    const noteText = longPage?.querySelector('[data-testid="mktg-framework-print-served-cut"]')?.textContent?.trim() ?? '';
    expect(noteText).toBe(foundationMessagePrintCutNote(2, 'framework'));
    const width = MKTG_PORTRAIT_PAGE.contentWidth;
    const cardWidth = (width - 3 * FRAMEWORK_PORTRAIT_ROOM.servedGap) / 4 - FRAMEWORK_PORTRAIT_ROOM.cardPaddingSide;
    const room =
      FRAMEWORK_PORTRAIT_TOPS.footer -
      FRAMEWORK_PORTRAIT_TOPS.goalServed -
      FRAMEWORK_PORTRAIT_ROOM.label -
      FRAMEWORK_PORTRAIT_ROOM.servedTop -
      FRAMEWORK_PORTRAIT_ROOM.cardPadding -
      FRAMEWORK_PORTRAIT_ROOM.cardBorder -
      frameworkPortraitCutNoteHeightIn(2, 'framework', width);
    for (const card of longCards) {
      const [name, need, cta] = Array.from(card.querySelectorAll<HTMLElement>('.fwp-served-name, .fwp-served-line'));
      const height =
        mktgPortraitParaHeight(
          {
            text: name.textContent ?? '',
            size: parseFloat(name.style.fontSize),
            line: FRAMEWORK_PORTRAIT_TYPE.servedName.line,
            weight: FRAMEWORK_PORTRAIT_TYPE.servedName.weight,
          },
          cardWidth
        ) +
        FRAMEWORK_PORTRAIT_ROOM.servedLineTop +
        mktgPortraitParaHeight(
          { text: need.textContent ?? '', size: parseFloat(need.style.fontSize), line: FRAMEWORK_PORTRAIT_TYPE.servedLine.line },
          cardWidth
        ) +
        FRAMEWORK_PORTRAIT_ROOM.servedLineGap +
        mktgPortraitParaHeight({ text: cta.textContent ?? '', size: parseFloat(cta.style.fontSize), line: FRAMEWORK_PORTRAIT_TYPE.servedLine.line }, cardWidth);
      expect(height).toBeLessThanOrEqual(room);
      // The lines were fitted (smaller than the type), not left to overflow.
      expect(parseFloat(need.style.fontSize)).toBeLessThan(FRAMEWORK_PORTRAIT_TYPE.servedLine.size);
    }
    // The two served by the goal on the approved record print without a note.
    await setView(buildFoundationMessagePrintView(CONTENT, 'TestOrbit', 2, null));
    expect(frame('goal-1')?.querySelectorAll('.fwp-served-card')).toHaveLength(2);
    expect(frame('goal-1')?.querySelector('[data-testid="mktg-framework-print-served-cut"]')).toBeNull();
  });

  it('bounds every variable-length block on a fixed-top page so none passes the next block’s top or the footer: text fitted, lists cut to whole rows, nothing added', async () => {
    const long = 'A long sentence about the project and the many things it does for the people who use it every day. ';
    const proof = (index: number) => pair(`${long.repeat(2).trim()} (${index})`, 'Source');
    const profile = (icp: FoundationMessageContent['icp'][number], id: string, name: string) => ({
      ...icp,
      id,
      name,
      need: long.repeat(2).trim(),
      cta: long.trim(),
    });
    const content: FoundationMessageContent = {
      ...CONTENT,
      mf: {
        ...CONTENT.mf,
        vision: long.repeat(6).trim(),
        mission: long.repeat(6).trim(),
        positioning: long.repeat(6).trim(),
        say: Array.from({ length: 12 }, (_, index) => `${long.slice(0, 40).trim()} ${index}`),
        avoid: Array.from({ length: 12 }, (_, index) => pair(`${long.slice(0, 50).trim()} ${index}`, long.slice(0, 60).trim())),
        anchor: Array.from({ length: 5 }, (_, index) => `${long.trim()} Question ${index}?`),
        goals: [
          {
            ...CONTENT.mf.goals[0],
            t: 'A goal whose title runs far past the width of the page’s title line',
            vp: long.repeat(4).trim(),
            key: long.repeat(3).trim(),
            bite: long.repeat(3).trim(),
            proof: Array.from({ length: 12 }, (_, index) => proof(index)),
            icps: ['users', 'maintainers', 'c', 'd'],
          },
        ],
      },
      icp: [
        profile(CONTENT.icp[0], 'users', 'End users'),
        profile(CONTENT.icp[1], 'maintainers', 'Maintainers'),
        profile(CONTENT.icp[0], 'c', 'C'),
        profile(CONTENT.icp[0], 'd', 'D'),
      ],
      nums: Array.from({ length: 4 }, (_, index) => pair(`${index + 1},000`, 'figures')),
    };
    const report: FoundationMessageReport = {
      // Sixty hosts (one host's pages would gather into one row).
      sources_read: Array.from({ length: 60 }, (_, index) => `Link: https://site-${index}.example.org/page`),
      sources_failed: Array.from({ length: 30 }, (_, index) => ({ name: `Source ${index}`, reason: 'timed out' })),
      gaps: Array.from({ length: 60 }, (_, index) => `Gap ${index}: ${long.trim()}`),
      notes: '',
    };
    const printed = buildFoundationMessagePrintView(content, 'TestOrbit', 2, null, '2026-11-06T09:00:00Z', report, '2026-11-04');
    await configure('browser', printed);
    const tops = FRAMEWORK_PORTRAIT_TOPS;
    // The statements: four cards of one height from 136, each text fitted smaller or cut to its card, so every card closes 16 px above the goal band at 336.
    const statements = query('mktg-framework-print-statements');
    expect(top(statements)).toBe(136);
    const cards = Array.from(statements?.querySelectorAll<HTMLElement>('.fwp-statement') ?? []);
    expect(cards).toHaveLength(4);
    expect(cards.slice(0, 3).every((card) => parseFloat(card.style.fontSize) < 11.5 || (card.textContent ?? '').length < long.repeat(6).trim().length)).toBe(
      true
    );
    // The framework page's matrix: the goal's twelve proofs cut to the whole rows that fit the proof row's room (tight first), the cut said in the
    // cell, so the sound bite row stays above the footer.
    const matrixProofs = Array.from(query('mktg-framework-print-goals')?.querySelectorAll('.fwp-matrix-proofs li') ?? []);
    expect(matrixProofs.length).toBeGreaterThan(0);
    expect(matrixProofs.length).toBeLessThan(12);
    expect(query('mktg-framework-print-goals')?.querySelector('.fwp-matrix-proofs')?.classList.contains('fwp-matrix-proofs--tight')).toBe(true);
    expect(query('mktg-framework-print-matrix-proofs-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(12 - matrixProofs.length, 'framework'));
    // The goal page: its long title at the floor size over the lines it needs, whole, and the lead set under those lines (the number and the lead
    // never overlap it); the value, the key message and the sound bite fitted; the proof list keeps the leading whole rows that fit above the
    // bite; four cards' lines fitted.
    const goalPage = frame('goal-1');
    const titleSize = parseFloat(goalPage?.style.getPropertyValue('--fwp-title-size') ?? '34');
    const title = goalPage?.querySelector('.pp-title')?.textContent?.trim() ?? '';
    expect(titleSize).toBe(Math.ceil(34 * MKTG_PORTRAIT_FIT.minScale));
    expect(title).toBe('Goal 1 · A goal whose title runs far past the width of the page’s title line');
    const titleLines = Math.ceil(title.length / mktgPortraitCharsPerLine(MKTG_PORTRAIT_PAGE.contentWidth, titleSize, { weight: 500 }));
    expect(titleLines).toBe(2);
    expect(frame('framework')?.style.getPropertyValue('--fwp-title-size')).toBe('34px');
    expect([top(goalPage?.querySelector('.fwp-goal-key')), top(query('mktg-framework-print-goal-1'))]).toEqual([tops.goalKey, 136 + titleSize * 1.1]);
    const proofs = Array.from(goalPage?.querySelectorAll('.fwp-proof-row') ?? []);
    expect(proofs.length).toBeGreaterThan(0);
    expect(proofs.length).toBeLessThan(12);
    expect(proofs.map((row) => row.querySelector('span')?.textContent?.trim())).toEqual(proofs.map((_, index) => `${long.repeat(2).trim()} (${index})`));
    // Tightened before the cut (9 px padding, 14 px type), and the cut said under the list: "+N more", N the rows left off.
    expect(goalPage?.querySelector('.fwp-proof-list')?.classList.contains('fwp-proof-list-tight')).toBe(true);
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-proofs-cut"]')?.textContent?.trim()).toBe(
      foundationMessagePrintCutNote(12 - proofs.length, 'framework')
    );
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-proofs-cut"]')?.textContent?.trim()).toBe(
      `+${12 - proofs.length} more on the framework's Framework tab in LFX One`
    );
    expect(parseFloat(goalPage?.querySelector<HTMLElement>('.fwp-goal-vp')?.style.fontSize ?? '22')).toBeLessThan(22);
    expect(parseFloat(goalPage?.querySelector<HTMLElement>('.fwp-goal-key-text')?.style.fontSize ?? '19')).toBeLessThan(19);
    expect(parseFloat(goalPage?.querySelector<HTMLElement>('.fwp-goal-bite-text')?.style.fontSize ?? '34')).toBeLessThan(34);
    const served = Array.from(goalPage?.querySelectorAll<HTMLElement>('.fwp-served-card .fwp-served-line') ?? []);
    expect(served).toHaveLength(8);
    expect(served.every((line) => parseFloat(line.style.fontSize) <= 11.5)).toBe(true);
    // The printed size is the size the fit model measured (its half-px steps), not the preferred size times the scale.
    const printedSizes = [goalPage?.querySelector<HTMLElement>('.fwp-goal-vp'), goalPage?.querySelector<HTMLElement>('.fwp-goal-bite-text'), ...served].map(
      (el) => parseFloat(el?.style.fontSize ?? '0')
    );
    expect(printedSizes.every((size) => Math.abs(size * 2 - Math.round(size * 2)) < 1e-9)).toBe(true);
    // The key numbers: the facts table under two full rows of tiles, cut to the whole rows that fit above the footer, measured at the
    // first <col>'s real width (contentWidth × 50 % less the cell padding): the kept rows' heights stay inside the room.
    const facts = query('mktg-framework-print-facts');
    expect(top(facts)).toBe(560);
    const factRows = Array.from(facts?.querySelectorAll('[data-testid^="mktg-framework-print-fact-"]') ?? []);
    expect(factRows.length).toBeGreaterThan(0);
    expect(factRows.length).toBeLessThan(12);
    const factWidth = (MKTG_PORTRAIT_PAGE.contentWidth * FRAMEWORK_PORTRAIT_FACT_COLUMNS[0]) / 100 - FRAMEWORK_PORTRAIT_ROOM.factCellPadding;
    expect(factWidth).toBe(340);
    expect(facts?.querySelector<HTMLTableColElement>('colgroup > col')?.style.width).toBe(`${FRAMEWORK_PORTRAIT_FACT_COLUMNS[0]}%`);
    const factType = FRAMEWORK_PORTRAIT_TYPE.fact;
    const factsTight = facts?.querySelector('table')?.classList.contains('fwp-facts-table-tight') === true;
    const factsUsed = factRows.reduce(
      (sum, row) =>
        sum +
        mktgPortraitParaHeight({ text: row.querySelector('.fwp-fact')?.textContent?.trim() ?? '', ...factType }, factWidth) +
        (factsTight ? FRAMEWORK_PORTRAIT_ROOM.factRowTight : FRAMEWORK_PORTRAIT_ROOM.factRow),
      0
    );
    expect(560 + FRAMEWORK_PORTRAIT_ROOM.label + FRAMEWORK_PORTRAIT_ROOM.tableHead + factsUsed).toBeLessThanOrEqual(tops.footer);
    // Twelve proof points make twelve facts; a cut table says how many more there are (tight first), a whole one says nothing.
    expect(query('mktg-framework-print-facts-cut')?.textContent?.trim() ?? null).toBe(
      factRows.length < 12 ? foundationMessagePrintCutNote(12 - factRows.length, 'framework') : null
    );
    if (factRows.length < 12) expect(factsTight).toBe(true);
    // Sources & gaps: each list tightened (11.5/1.5) then cut to the whole rows that fit above the approval card at 880, in order, the cut said under it;
    // the read and the failed lists share the left column, flush left at the column's full width (the editor's read).
    const rowHeight = (value: string | null | undefined) =>
      mktgPortraitParaHeight({ text: value?.trim() ?? '', ...FRAMEWORK_PORTRAIT_TYPE.sourceTight }, MKTG_PORTRAIT_COLUMNS.half);
    const read = Array.from(query('mktg-framework-print-sources-read')?.querySelectorAll('li') ?? []);
    const failed = Array.from(query('mktg-framework-print-sources-failed')?.querySelectorAll('li') ?? []);
    const gaps = Array.from(query('mktg-framework-print-gaps')?.querySelectorAll('li') ?? []);
    expect(query('mktg-framework-print-sources-read')?.classList.contains('fwp-source-list-tight')).toBe(true);
    expect(query('mktg-framework-print-gaps')?.classList.contains('fwp-source-list-tight')).toBe(true);
    expect(query('mktg-framework-print-sources-read-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(60 - read.length, 'sources'));
    expect(query('mktg-framework-print-gaps-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(60 - gaps.length, 'sources'));
    expect(query('mktg-framework-print-sources-failed-cut')?.textContent?.trim() ?? null).toBe(
      failed.length < 30 ? foundationMessagePrintCutNote(30 - failed.length, 'sources') : null
    );
    expect([read.length > 0, read.length < 60, failed.length > 0, failed.length < 30, gaps.length > 0, gaps.length < 60]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    // The read list prints each source in a reader's words (mktgReadableSourceName): a URL as its host and path.
    expect(read[0].textContent?.trim()).toBe('orbit.example.org/page-0');
    expect(gaps[gaps.length - 1].textContent?.trim()).toBe(`Gap ${gaps.length - 1}: ${long.trim()}`);
    const room = tops.sourcesApproval - tops.sourcesLists;
    expect(
      26 + read.reduce((sum, item) => sum + rowHeight(item.textContent), 0) + 18 + 26 + failed.reduce((sum, item) => sum + rowHeight(item.textContent), 0)
    ).toBeLessThanOrEqual(room);
    expect(26 + gaps.reduce((sum, item) => sum + rowHeight(item.textContent), 0)).toBeLessThanOrEqual(room);
    expect(top(query('mktg-framework-print-approval'))).toBe(tops.sourcesApproval);
    // Four profiles, two a page (their measured pairs end above the footer): the second page's rows start at the short intro's top; no page's cards
    // are set tight; the pages hold the cards the layout packed, in order.
    expect(top(frame('icps-1')?.querySelector('.fwp-icp-row')?.parentElement)).toBe(tops.icpRowsFirst);
    expect(top(frame('icps-2')?.querySelector('.fwp-icp-row')?.parentElement)).toBe(tops.icpRows);
    const icpPages = frameworkPortraitIcpPages(printed.icps);
    expect(icpPages.map((page) => page.icps.length)).toEqual([2, 2]);
    expect(host().querySelectorAll('.fwp-icp-rows--tight')).toHaveLength(0);
    expect(host().querySelectorAll('[data-testid="mktg-framework-print-icp-rows"][data-cut]')).toHaveLength(0);
    expect(Array.from(frame('icps-2')?.querySelectorAll('.fwp-icp-row') ?? []).map((row) => row.getAttribute('data-testid'))).toEqual([
      'mktg-framework-print-icp-c',
      'mktg-framework-print-icp-d',
    ]);
    // Say and avoid: the pills and the rows cut to their columns above the anchors (tight first), each cut said; the anchors at their top, the five
    // questions set smaller so they and the crosscut box end above the footer; the box under the anchors, no higher than the design's top.
    const sayAvoid = frame('say-avoid');
    const pills = Array.from(sayAvoid?.querySelectorAll('.fwp-say-pill') ?? []);
    const avoidRows = Array.from(sayAvoid?.querySelectorAll('.fwp-avoid-row') ?? []);
    expect([pills.length > 0, pills.length < 12, avoidRows.length > 0, avoidRows.length < 12]).toEqual([true, true, true, true]);
    expect(sayAvoid?.querySelector('.fwp-say-list')?.classList.contains('fwp-say-list--tight')).toBe(true);
    expect(sayAvoid?.querySelector('.fwp-avoid-list')?.classList.contains('fwp-avoid-list--tight')).toBe(true);
    expect(query('mktg-framework-print-say-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(12 - pills.length, 'framework'));
    expect(query('mktg-framework-print-avoid-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(12 - avoidRows.length, 'framework'));
    expect(pills.map((pill) => pill.textContent?.trim())).toEqual(pills.map((_, index) => `${long.slice(0, 40).trim()} ${index}`));
    const anchorsBlock = query('mktg-framework-print-anchor')?.parentElement;
    expect(top(anchorsBlock)).toBe(tops.anchors);
    const questions = Array.from(sayAvoid?.querySelectorAll<HTMLElement>('.fwp-anchor-question') ?? []);
    expect(questions).toHaveLength(5);
    expect(questions.every((question) => parseFloat(question.style.fontSize) < 22)).toBe(true);
    const anchorsHeight = questions.reduce(
      (sum, question) =>
        sum +
        Math.max(
          FRAMEWORK_PORTRAIT_TYPE.anchorNumber.size * FRAMEWORK_PORTRAIT_TYPE.anchorNumber.line,
          mktgPortraitParaHeight(
            { text: question.textContent?.trim() ?? '', size: parseFloat(question.style.fontSize), line: 1.3, weight: 500 },
            MKTG_PORTRAIT_PAGE.contentWidth - FRAMEWORK_PORTRAIT_ROOM.anchorNumber - FRAMEWORK_PORTRAIT_ROOM.anchorGap
          )
        ) +
        FRAMEWORK_PORTRAIT_ROOM.anchorRow,
      0
    );
    const crosscutBox = sayAvoid?.querySelector<HTMLElement>('.fwp-crosscut-box');
    const crosscutTop = top(crosscutBox);
    expect(crosscutTop).toBeGreaterThanOrEqual(tops.sayCrosscut);
    expect(
      tops.anchors + FRAMEWORK_PORTRAIT_ROOM.label + FRAMEWORK_PORTRAIT_ROOM.anchorListTop + anchorsHeight + FRAMEWORK_PORTRAIT_ROOM.gap
    ).toBeLessThanOrEqual(crosscutTop);
    expect(
      crosscutTop +
        FRAMEWORK_PORTRAIT_ROOM.crosscutPadding +
        FRAMEWORK_PORTRAIT_ROOM.label +
        FRAMEWORK_PORTRAIT_ROOM.crosscutTextTop +
        mktgPortraitParaHeight(
          { text: CONTENT.mf.crosscut, ...FRAMEWORK_PORTRAIT_TYPE.crosscutText },
          MKTG_PORTRAIT_PAGE.contentWidth - FRAMEWORK_PORTRAIT_ROOM.crosscutPaddingAcross
        )
    ).toBeLessThanOrEqual(tops.footer);
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
    // The first profile page's rows start under the long intro at 214, band or no band (the top is the page's, not the band's).
    expect(pages[3].querySelector('.fwp-icp-row')?.parentElement?.getAttribute('style')).toContain('top: 214px');
  });

  it('sets the pages in the view’s brand through the grammar’s look, or in the look the family passes', async () => {
    const kit = brandKitTestRevision();
    const pale: BrandKitRevision = { ...kit, kit: { ...kit.kit, dark: '#FFFFFF' } };
    await configure('browser', printView(pale));
    const framework = frame('framework');
    expect(framework?.style.getPropertyValue('--pp-dark')).toBe('#FFFFFF');
    expect(framework?.style.getPropertyValue('--pp-on-dark')).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(framework?.style.getPropertyValue('--pp-font')).toContain('Montserrat');
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('kit');
    fixture.componentRef.setInput('look', { dark: '#101010', accent: '#FF0000', spark: '#00FF00', onAccent: '#FFFFFF', onDark: '#FFFFFF', fontStack: 'serif' });
    await fixture.whenStable();
    expect(framework?.style.getPropertyValue('--pp-dark')).toBe('#101010');
    expect(framework?.style.getPropertyValue('--pp-spark')).toBe('#00FF00');
    expect(framework?.style.getPropertyValue('--pp-font')).toBe('serif');
    // The LF look without a kit.
    fixture.componentRef.setInput('look', null);
    await setView(printView(null));
    expect(framework?.style.getPropertyValue('--pp-dark')).toBe(MKTG_PRINT_LF_LOOK.dark);
  });

  it('skips the cover’s logo block on a kit with no drawable artwork, and keeps the rest of the cover', async () => {
    await configure('browser', printView(brandKitLogolessFixture()));
    expect(query('mktg-framework-print-cover-logo')).toBeNull();
    expect(query('mktg-framework-print-cover')?.querySelector('.fwp-cover-logo')).toBeNull();
    expect(query('mktg-framework-print-tagline')?.textContent?.trim()).toBe('Release, open.');
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('kit');
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
