// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FRAMEWORK_PORTRAIT_SEP, FRAMEWORK_PORTRAIT_TOPS, FRAMEWORK_PORTRAIT_TYPE, MKTG_PRINT_OBJECTION_DASH } from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView, FoundationMessageReport } from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessagePrintView,
  frameworkPortraitHouse,
  frameworkPortraitStatementWidth,
  frameworkPortraitTaglineSize,
  mktgPortraitCharsPerLine,
} from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
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
      `Goal 1${FRAMEWORK_PORTRAIT_SEP}Adoption`,
      `Say and avoid${FRAMEWORK_PORTRAIT_SEP}anchor questions`,
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
    expect(query('mktg-framework-print-version')?.textContent?.trim()).toBe(
      `V2.0${FRAMEWORK_PORTRAIT_SEP}Approved 6 Nov 2026${FRAMEWORK_PORTRAIT_SEP}figures as of 4 Nov 2026`
    );
    // The editor's gap under the cover title (16–24 px, set at 18) is the global partial's `.fwp-cover-edition` rule, which the
    // unit build does not load: the class is asserted here, the computed gap in the e2e (mktg-os-asset-views.spec.ts).
    expect(query('mktg-framework-print-version')?.classList.contains('fwp-cover-edition')).toBe(true);
    // Each row's page number once, as the two-digit leader (the editor's read: no trailing duplicate); a short book's rows at the design's
    // measure, not tightened, no run collapsed (frameworkPortraitContents bounds the list above the strip).
    const list = cover?.querySelector('[data-testid="mktg-framework-print-contents"]');
    expect(list?.classList.contains('fwp-contents--tight')).toBe(false);
    expect(list?.getAttribute('data-collapsed')).toBeNull();
    const rows = Array.from(list?.querySelectorAll('[data-testid="mktg-framework-print-contents-row"]') ?? []);
    expect(rows.map((row) => text(row))).toEqual([
      '02 Framework',
      `03 Goal 1${FRAMEWORK_PORTRAIT_SEP}Adoption`,
      `04 Say and avoid${FRAMEWORK_PORTRAIT_SEP}anchor questions`,
      '05 Ideal customer profiles',
      '06 Message house',
      '07 Key numbers',
      '08 Sources & gaps',
    ]);
    expect(rows.map((row) => row.querySelectorAll('span').length)).toEqual(rows.map(() => 2));
    // The LF look has no kit, so no web host: the strip's right carries the version and the approval's date.
    expect(text(query('mktg-framework-print-cover-strip'))).toBe(
      `TestOrbit${FRAMEWORK_PORTRAIT_SEP}a Linux Foundation project V2.0${FRAMEWORK_PORTRAIT_SEP}6 Nov 2026`
    );
    expect(query('mktg-framework-print-cover-strip')?.classList.contains('pp-cover-strip--wrapped')).toBe(false);
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
    // One goal, one band of one column (`--fwp-goal-count` on the band).
    expect(query('mktg-framework-print-goals-band-0')?.style.getPropertyValue('--fwp-goal-count')).toBe('1');
    expect(query('mktg-framework-print-goals-band-1')).toBeNull();
    expect(Array.from(matrix?.querySelectorAll('.fwp-matrix-row > .pp-lab') ?? []).map((label) => label.textContent?.trim())).toEqual([
      'Value proposition',
      'Key message',
      'Proof',
      'Sound bite',
    ]);
    expect(matrix?.querySelector('.fwp-matrix-goal')?.textContent?.trim()).toBe('Adoption');
    expect(text(query('mktg-framework-print-matrix-proof'))).toBe('1,200 members Website');
    // The source tag is the fixed vocabulary, kept whole as the mock's: the fact before it wraps, never the tag ("LFX / FIELD").
    const tag = matrix?.querySelector('.fwp-matrix-source');
    expect(tag?.textContent?.trim()).toBe('Website');
    // Its `white-space: nowrap` is the global partial's rule, asserted computed in the e2e (mktg-os-asset-views.spec.ts).
    expect(tag?.classList.contains('fwp-matrix-source')).toBe(true);
    expect(matrix?.querySelector('.fwp-matrix-bite')?.textContent?.trim()).toBe('“In the open”');
    // Short cells print as written at their type (frameworkPortraitMatrix fits them only where the rows would crowd the proofs out).
    const vp = query('mktg-framework-print-matrix-vp');
    const key = matrix?.querySelector<HTMLElement>('.fwp-matrix-key');
    expect([vp?.textContent?.trim(), vp?.style.fontSize, key?.textContent?.trim(), key?.style.fontSize]).toEqual([
      CONTENT.mf.goals[0].vp,
      `${FRAMEWORK_PORTRAIT_TYPE.matrixCell.size}px`,
      CONTENT.mf.goals[0].key,
      `${FRAMEWORK_PORTRAIT_TYPE.matrixKey.size}px`,
    ]);
    expect(matrix?.querySelector<HTMLElement>('.fwp-matrix-bite')?.style.fontSize).toBe(`${FRAMEWORK_PORTRAIT_TYPE.matrixBite.size}px`);
    // The head row's title too: a short title at its type (a long one is cut at a word into the board's two lines by the layout).
    const title = query('mktg-framework-print-matrix-title');
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
    expect(text(page?.querySelector('[data-testid="mktg-framework-print-proof-row"]'))).toBe('1,200 members Website');
    expect(page?.querySelector('.fwp-goal-bite-text')?.textContent?.trim()).toBe('“In the\u00a0open”');
    const served = Array.from(page?.querySelectorAll('[data-testid="mktg-framework-print-served-card"]') ?? []);
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
    // The bite's last two words are joined (the grammar's widow rule), so no line ends on one short word; a bite cut at a sentence keeps its
    // closing mark; its block sits at the board's top.
    expect(bite?.textContent).toMatch(/\S\u00a0\S+”$/);
    expect((bite?.textContent ?? '').length).toBeLessThan(long.length);
    expect(top(bite?.parentElement)).toBe(FRAMEWORK_PORTRAIT_TOPS.goalBite);
    // A short one is set at its size.
    await setView(printView(null));
    expect(page?.querySelector<HTMLElement>('.fwp-goal-vp')?.style.fontSize).toBe('22px');
    expect(page?.querySelector<HTMLElement>('.fwp-goal-bite-text')?.textContent?.trim()).toBe('“In the\u00a0open”');
  });

  it('prints say and avoid with the anchor questions, numbered, and the crosscut note; says when nothing is to be avoided', async () => {
    const view = printView(null);
    await configure('browser', view);
    expect(Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-say-row"]')).map((pill) => pill.textContent?.trim())).toEqual(['open']);
    expect(text(query('mktg-framework-print-avoid-row'))).toBe('synergy → working together');
    expect(text(query('mktg-framework-print-anchor-row'))).toBe('01 Which goal does this serve?');
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
    expect(text(rows[0].querySelectorAll('dd')[4])).toBe(`“Too early?”${MKTG_PRINT_OBJECTION_DASH}Not at all.`);
    // The dash is bound to the question by a no-break space, so it never opens the response's line (editor S-d).
    expect(rows[0].querySelectorAll('dd')[4].textContent).toContain(`”${MKTG_PRINT_OBJECTION_DASH}Not at all.`);
    expect(MKTG_PRINT_OBJECTION_DASH).toBe('\u00a0— ');
    expect(text(rows[0].querySelectorAll('dd')[5])).toBe(`Docs${FRAMEWORK_PORTRAIT_SEP}Slack A fact Docs`);
    expect(rows[0].querySelector('.fwp-icp-proofs')?.parentElement?.previousElementSibling?.textContent?.trim()).toBe('Channels');
    expect(rows[0].querySelector('.fwp-icp-personas')?.textContent?.trim()).toBe(`SRE${FRAMEWORK_PORTRAIT_SEP}uptime`);
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
    // One profile: the intro in the singular (editor S-c).
    expect(frame('icps-1')?.querySelector('.fwp-intro-icps')?.textContent).toContain(
      '1 profile. It names who they are, what they need, what TestOrbit gives them,'
    );
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
    expect(house?.querySelector('.fwp-house-line')?.textContent?.trim()).toBe(`Brand line${FRAMEWORK_PORTRAIT_SEP}Release, open.`);
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
    // The one figure and its fact come from the site, so the "as of" sentence, the LFX figures', is not printed (editor S-c).
    expect(frame('key-numbers')?.querySelector('.pp-body')?.textContent?.trim()).toBe('The figures the framework leans on, with where each came from.');
    const facts = Array.from(query('mktg-framework-print-facts')?.querySelectorAll('tbody tr') ?? []).slice(1);
    expect(facts.map((row) => text(row))).toEqual([`1,200 members Website Goal 1${FRAMEWORK_PORTRAIT_SEP}Adoption`]);
    // The table's columns are its <colgroup> (fixed layout reads <col>): 50/25/25 %; the source chip wraps within the framework's cap.
    const cols = Array.from(query('mktg-framework-print-facts-table')?.querySelectorAll<HTMLTableColElement>('colgroup > col') ?? []);
    expect(cols.map((col) => col.style.width)).toEqual(['50%', '25%', '25%']);
    expect(facts[0].querySelector('.fwp-fact-source .pp-chip')?.classList.contains('fwp-chip-wrap')).toBe(true);
    // A figure stored without its separators prints with them (the editor's rule); a percentage prints as stored.
    await setView(buildFoundationMessagePrintView({ ...CONTENT, nums: [pair('$8000', 'raised'), pair('96%', 'of users')] }, 'TestOrbit', 2, null));
    expect(Array.from(query('mktg-framework-print-numbers')?.querySelectorAll('.fwp-number') ?? []).map((figure) => figure.textContent?.trim())).toEqual([
      '$8,000',
      '96%',
    ]);
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
