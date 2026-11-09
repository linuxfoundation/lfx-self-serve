// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_SEP,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_PORTRAIT_PAGE,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_FIT,
} from '@lfx-one/shared/constants';
import { FoundationMessageContent, FoundationMessagePrintView, FoundationMessageReport } from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessagePrintView,
  foundationMessagePrintCutNote,
  frameworkPortraitCutNoteHeightIn,
  frameworkPortraitIcpPages,
  frameworkPortraitIcpWhoWidth,
  frameworkPortraitServedCount,
  mktgPortraitCharsPerLine,
  mktgPortraitParaHeight,
} from '@lfx-one/shared/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * The framework print's fit: the statements, the titles and the who-cards at
 * one size, every variable block bounded to its page, and the profile cards'
 * one width. The component's base behaviors are in
 * `mktg-framework-print.component.spec.ts`; its pages in `.pages.spec.ts`, the
 * book's and the cover's in `.book.spec.ts`. Each part mounts the component on
 * the same synthetic record (the editor's rule for this pull request: spec
 * files only, so the setup is repeated, not shared).
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

describe('MktgFrameworkPrintComponent, the fit', () => {
  let fixture: ComponentFixture<MktgFrameworkPrintComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  /** One frame by its plan id (the grammar's host contract: data-testid lfx-mktg-portrait-page + data-page-id). */
  const frame = (pageId: string): HTMLElement | null => host().querySelector(`[data-testid="lfx-mktg-portrait-page"][data-page-id="${pageId}"]`);
  /** Where the frame places an element: its inline top, px (the [lfxPpRect] style). */
  const top = (element: Element | null | undefined): number => parseFloat((element as HTMLElement | null)?.style.top ?? 'NaN');
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

  it('sets the three statements at one size, the smallest any card needs, never one card shrunk alone (the editor’s read)', async () => {
    // The logo-less record's shape: a vision that runs long beside a short mission and positioning (two sentences: what the board's narrow
    // vision card holds whole at the fit model's floor; a third would be cut there).
    const long = 'A long sentence about the project and the many things it does for the people who use it every day. ';
    const content: FoundationMessageContent = { ...CONTENT, mf: { ...CONTENT.mf, vision: long.repeat(2).trim() } };
    await configure('browser', buildFoundationMessagePrintView(content, 'TestOrbit', 2, null));
    const cards = Array.from(query('mktg-framework-print-statements')?.querySelectorAll<HTMLElement>('.fwp-statement') ?? []).slice(0, 3);
    expect(new Set(cards.map((card) => card.style.fontSize)).size).toBe(1);
    expect(parseFloat(cards[0].style.fontSize)).toBeLessThan(11.5);
    expect(parseFloat(cards[0].style.fontSize)).toBeGreaterThanOrEqual(Math.floor(11.5 * MKTG_PORTRAIT_FIT.minScale * 2) / 2);
    // The short cards print whole at that size (the row is the board's one box: the cards stretch to it, `.fwp-statements`).
    expect(cards.map((card) => card.textContent?.trim())).toEqual([content.mf.vision, 'A mission.', 'For platform teams.']);
  });

  it('sets every goal page’s title at one size, the smallest any of them needs, and the sound bite at one top on each (the editor’s read)', async () => {
    const titles = ['Events', 'A goal whose title runs well past the width of the page’s title line at the grammar’s size', 'Adoption'];
    const goals = titles.map((t, index) => ({ ...CONTENT.mf.goals[0], id: `g${index}`, n: index + 1, t }));
    await configure('browser', buildFoundationMessagePrintView({ ...CONTENT, mf: { ...CONTENT.mf, goals } }, 'TestOrbit', 2, null));
    const sizes = [1, 2, 3].map((n) => frame(`goal-${n}`)?.style.getPropertyValue('--fwp-title-size'));
    expect(new Set(sizes).size).toBe(1);
    expect(parseFloat(sizes[0] ?? '34')).toBeLessThan(34);
    expect(parseFloat(sizes[0] ?? '0')).toBeGreaterThanOrEqual(Math.ceil(34 * MKTG_PORTRAIT_FIT.minScale));
    // The other pages keep their own fit (the framework page's short title at the grammar's 34 px).
    expect(frame('framework')?.style.getPropertyValue('--fwp-title-size')).toBe('34px');
    // The sound bite's block tops the same fixed y on every goal page (the board's 690), whatever the proof rows above it took.
    for (const n of [1, 2, 3]) expect(top(frame(`goal-${n}`)?.querySelector('.fwp-goal-bite-text')?.parentElement)).toBe(FRAMEWORK_PORTRAIT_TOPS.goalBite);
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
    const cards = Array.from(goalPage?.querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-served-card"]') ?? []);
    expect(cards).toHaveLength(frameworkPortraitServedCount());
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.querySelector('.fwp-served-name')?.textContent?.trim())).toEqual([
      'A profile name long enough to wrap inside a narrow card',
      'Profile maintainers',
      'Profile c',
      'Profile d',
    ]);
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-served-cut"]')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(2));
    // The name is part of the fitted block: it prints at the size the fit model gave it, never past the type's.
    const names = cards.map((card) => parseFloat(card.querySelector<HTMLElement>('.fwp-served-name')?.style.fontSize ?? '0'));
    expect(names.every((size) => size > 0 && size <= FRAMEWORK_PORTRAIT_TYPE.servedName.size)).toBe(true);
    // Six served profiles with long need and ask lines: the four cards' fitted lines, measured by the fit model at the sizes they
    // print, stay inside the room the note under the row leaves them, so the block ends above the footer rule (1000).
    const long = 'a line long enough to wrap several times inside a quarter-width card, with a second clause that runs on past the first';
    const longNeed = { ...many, icp: many.icp.map((icp) => ({ ...icp, need: `${long}.`, cta: `${long}.` })) };
    await setView(buildFoundationMessagePrintView(longNeed, 'TestOrbit', 2, null));
    const longPage = frame('goal-1');
    const longCards = Array.from(longPage?.querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-served-card"]') ?? []);
    expect(longCards).toHaveLength(4);
    const noteText = longPage?.querySelector('[data-testid="mktg-framework-print-served-cut"]')?.textContent?.trim() ?? '';
    expect(noteText).toBe(foundationMessagePrintCutNote(2));
    const width = MKTG_PORTRAIT_PAGE.contentWidth;
    const cardWidth = (width - 3 * FRAMEWORK_PORTRAIT_ROOM.servedGap) / 4 - FRAMEWORK_PORTRAIT_ROOM.cardPaddingSide;
    const room =
      FRAMEWORK_PORTRAIT_TOPS.footer -
      FRAMEWORK_PORTRAIT_TOPS.goalServed -
      FRAMEWORK_PORTRAIT_ROOM.label -
      FRAMEWORK_PORTRAIT_ROOM.servedTop -
      FRAMEWORK_PORTRAIT_ROOM.cardPadding -
      FRAMEWORK_PORTRAIT_ROOM.cardBorder -
      frameworkPortraitCutNoteHeightIn(2, width);
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
    expect(frame('goal-1')?.querySelectorAll('[data-testid="mktg-framework-print-served-card"]')).toHaveLength(2);
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
    expect(new Set(cards.slice(0, 3).map((card) => card.style.fontSize)).size).toBe(1);
    // The framework page's matrix: the goal's twelve proofs cut to the whole rows that fit the proof row's room (tight first), the cut said in the
    // cell, so the sound bite row stays above the footer.
    const matrixProofs = Array.from(query('mktg-framework-print-goals')?.querySelectorAll('[data-testid="mktg-framework-print-matrix-proof"]') ?? []);
    expect(matrixProofs.length).toBeGreaterThan(0);
    expect(matrixProofs.length).toBeLessThan(12);
    expect(query('mktg-framework-print-matrix-proof-cell')?.classList.contains('fwp-matrix-proofs--tight')).toBe(true);
    expect(query('mktg-framework-print-matrix-proofs-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(12 - matrixProofs.length));
    // The goal page: its long title at the floor size over the lines it needs, whole, and the lead set under those lines (the number and the lead
    // never overlap it); the value, the key message and the sound bite fitted; the proof list keeps the leading whole rows that fit above the
    // bite; four cards' lines fitted.
    const goalPage = frame('goal-1');
    const titleSize = parseFloat(goalPage?.style.getPropertyValue('--fwp-title-size') ?? '34');
    const title = goalPage?.querySelector('.pp-title')?.textContent?.trim() ?? '';
    expect(titleSize).toBe(Math.ceil(34 * MKTG_PORTRAIT_FIT.minScale));
    expect(title).toBe(`Goal 1${FRAMEWORK_PORTRAIT_SEP}A goal whose title runs far past the width of the page’s title line`);
    const titleLines = Math.ceil(title.length / mktgPortraitCharsPerLine(MKTG_PORTRAIT_PAGE.contentWidth, titleSize, { weight: 500 }));
    expect(titleLines).toBe(2);
    expect(frame('framework')?.style.getPropertyValue('--fwp-title-size')).toBe('34px');
    expect([top(goalPage?.querySelector('.fwp-goal-key')), top(query('mktg-framework-print-goal-1'))]).toEqual([tops.goalKey, 136 + titleSize * 1.1]);
    const proofs = Array.from(goalPage?.querySelectorAll('[data-testid="mktg-framework-print-proof-row"]') ?? []);
    expect(proofs.length).toBeGreaterThan(0);
    expect(proofs.length).toBeLessThan(12);
    expect(proofs.map((row) => row.querySelector('span')?.textContent?.trim())).toEqual(proofs.map((_, index) => `${long.repeat(2).trim()} (${index})`));
    // Tightened before the cut (9 px padding, 14 px type), and the cut said under the list: "+N more", N the rows left off.
    expect(goalPage?.querySelector('.fwp-proof-list')?.classList.contains('fwp-proof-list-tight')).toBe(true);
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-proofs-cut"]')?.textContent?.trim()).toBe(
      foundationMessagePrintCutNote(12 - proofs.length)
    );
    expect(goalPage?.querySelector('[data-testid="mktg-framework-print-proofs-cut"]')?.textContent?.trim()).toBe(`+${12 - proofs.length} more in LFX One`);
    expect(parseFloat(goalPage?.querySelector<HTMLElement>('.fwp-goal-vp')?.style.fontSize ?? '22')).toBeLessThan(22);
    expect(parseFloat(goalPage?.querySelector<HTMLElement>('.fwp-goal-key-text')?.style.fontSize ?? '19')).toBeLessThan(19);
    expect(parseFloat(goalPage?.querySelector<HTMLElement>('.fwp-goal-bite-text')?.style.fontSize ?? '34')).toBeLessThan(34);
    const served = Array.from(goalPage?.querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-served-card"] .fwp-served-line') ?? []);
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
      factRows.length < 12 ? foundationMessagePrintCutNote(12 - factRows.length) : null
    );
    if (factRows.length < 12) expect(factsTight).toBe(true);
    // Sources & gaps: each list tightened (11.5/1.5) then cut to the whole rows that fit above the approval card at 880, in order, the cut said under it;
    // the read and the failed lists share the left column, bulleted as the board draws them, so a row's text is measured at the column less the
    // bullet's indent (ROOM.sourceBullet), as the component measures it.
    const rowHeight = (value: string | null | undefined) =>
      mktgPortraitParaHeight(
        { text: value?.trim() ?? '', ...FRAMEWORK_PORTRAIT_TYPE.sourceTight },
        MKTG_PORTRAIT_COLUMNS.half - FRAMEWORK_PORTRAIT_ROOM.sourceBullet
      );
    const read = Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-sources-read-row"]'));
    const failed = Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-sources-failed-row"]'));
    const gaps = Array.from(host().querySelectorAll('[data-testid="mktg-framework-print-gaps-row"]'));
    expect(query('mktg-framework-print-sources-read')?.classList.contains('fwp-source-list-tight')).toBe(true);
    expect(query('mktg-framework-print-gaps')?.classList.contains('fwp-source-list-tight')).toBe(true);
    expect(query('mktg-framework-print-sources-read-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(60 - read.length));
    expect(query('mktg-framework-print-gaps-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(60 - gaps.length));
    expect(query('mktg-framework-print-sources-failed-cut')?.textContent?.trim() ?? null).toBe(
      failed.length < 30 ? foundationMessagePrintCutNote(30 - failed.length) : null
    );
    expect([read.length > 0, read.length < 60, failed.length > 0, failed.length < 30, gaps.length > 0, gaps.length < 60]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    // The read list prints each source as its host (editor F2: never a path).
    expect(read[0].textContent?.trim()).toBe('site-0.example.org');
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
    const pills = Array.from(sayAvoid?.querySelectorAll('[data-testid="mktg-framework-print-say-row"]') ?? []);
    const avoidRows = Array.from(sayAvoid?.querySelectorAll('[data-testid="mktg-framework-print-avoid-row"]') ?? []);
    expect([pills.length > 0, pills.length < 12, avoidRows.length > 0, avoidRows.length < 12]).toEqual([true, true, true, true]);
    expect(sayAvoid?.querySelector('.fwp-say-list')?.classList.contains('fwp-say-list--tight')).toBe(true);
    expect(sayAvoid?.querySelector('.fwp-avoid-list')?.classList.contains('fwp-avoid-list--tight')).toBe(true);
    expect(query('mktg-framework-print-say-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(12 - pills.length));
    expect(query('mktg-framework-print-avoid-cut')?.textContent?.trim()).toBe(foundationMessagePrintCutNote(12 - avoidRows.length));
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

  it('sets every profile card’s name-and-tags column at the book’s one width, so the fields start at one x on every profile page, a lone card too', async () => {
    // One profile serves three goals, so its tags grow its column past the board's 190; the others' tags fit 190. Three profiles: two on the
    // first page, one alone on the second. (The kind is the record's union, so the tags that grow the column are the goal chips.)
    const [first] = CONTENT.mf.goals;
    const goals = [first, { ...first, id: 'g2', n: 2, t: 'Second' }, { ...first, id: 'g3', n: 3, t: 'Third' }];
    await configure(
      'browser',
      buildFoundationMessagePrintView(
        {
          ...CONTENT,
          mf: { ...CONTENT.mf, goals },
          icp: [{ ...CONTENT.icp[0], goals: goals.map((goal) => goal.id) }, CONTENT.icp[1], { ...CONTENT.icp[1], id: 'c', name: 'C' }],
        },
        'TestOrbit',
        2,
        null
      )
    );
    const widest = frameworkPortraitIcpWhoWidth([CONTENT.icp[0].kind, 'Goal 1', 'Goal 2', 'Goal 3']);
    expect(widest).toBeGreaterThan(FRAMEWORK_PORTRAIT_ROOM.icpWho);
    const pages = [frame('icps-1'), frame('icps-2')];
    expect(pages.map((page) => page?.querySelectorAll('article[data-testid^="mktg-framework-print-icp-"]').length)).toEqual([2, 1]);
    const columns = pages.flatMap((page) =>
      Array.from(page?.querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-icp-who"]') ?? []).map((who) => who.style.width)
    );
    expect(columns).toEqual([`${widest}px`, `${widest}px`, `${widest}px`]);
    // The rows are placed at one left (the page margin) on both pages, so the fields grid's x is the margin, the shared column and the row's gap everywhere.
    expect(pages.map((page) => (page?.querySelector('[data-testid="mktg-framework-print-icp-rows"]') as HTMLElement | null)?.style.left)).toEqual([
      `${MKTG_PORTRAIT_PAGE.margin}px`,
      `${MKTG_PORTRAIT_PAGE.margin}px`,
    ]);
  });
});
