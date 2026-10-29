// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MKTG_PRINT_INK_ON_LIGHT } from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView } from '@lfx-one/shared/interfaces';
import { buildFoundationMessagePrintView } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, describe, expect, it } from 'vitest';

import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * Locks the framework print's own behaviour: it sets the lists it prints as
 * one line each, and it loads the kit's typeface from Google Fonts once, in
 * the browser only, under the same link id the brand kit book uses. Without
 * a kit (the LF look) or on the server it leaves the head alone. The
 * framework view's spec covers how the print is placed and printed.
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
      objection: ['Too early?', null],
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

const printView = (kit: BrandKitRevision | null, projectName = 'TestOrbit'): FoundationMessagePrintView =>
  buildFoundationMessagePrintView(CONTENT, projectName, 2, kit);

describe('MktgFrameworkPrintComponent', () => {
  let fixture: ComponentFixture<MktgFrameworkPrintComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
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

  it('prints the goals as one table and leaves the hidden ICPs and message house off the page', async () => {
    await configure('browser', printView(null));
    const goals = query('mktg-framework-print-goals');
    expect(goals?.tagName).toBe('TABLE');
    const groups = goals?.querySelectorAll('tbody');
    expect(groups).toHaveLength(2);
    groups?.forEach((group) => {
      expect(group.querySelectorAll('tr')).toHaveLength(2);
      expect(getComputedStyle(group).breakInside).toBe('avoid');
    });
    const header = goals?.querySelector('thead');
    if (!header) throw new Error('Missing synthetic goals header');
    expect(getComputedStyle(header).display).toBe('table-header-group');
    expect(getComputedStyle(header).breakAfter).toBe('avoid');
    expect(Array.from(goals?.querySelectorAll('tbody th') ?? []).map((th) => th.textContent?.trim())).toEqual([
      'Value proposition',
      'Key message',
      'Proof',
      'Sound bite',
    ]);
    expect(goals?.querySelector('thead th')?.classList.contains('w-[1.1in]')).toBe(true);
    goals?.querySelectorAll('tbody th').forEach((label) => {
      const style = getComputedStyle(label);
      expect(style.wordBreak).toBe('normal');
      expect(style.overflowWrap).toBe('normal');
      expect(style.hyphens).toBe('none');
      expect(style.letterSpacing).toBe('normal');
      expect(style.textTransform).toBe('none');
      expect(parseFloat(style.minWidth) * (style.minWidth.endsWith('in') ? 96 : 1)).toBeCloseTo(105.6);
    });
    // Segments belong to the hidden ICPs: the table does not name them.
    expect(goals?.textContent).not.toContain('End users');
    // A proof point stacks its source under the fact: the goal columns are too narrow for the two side by side.
    const proof = goals?.querySelector('tbody li');
    expect(proof?.className).toContain('flex-col');
    expect(proof?.querySelector('span:last-child')?.textContent?.trim()).toBe('Website');
    expect(proof?.querySelector('span:last-child')?.className).not.toContain('shrink-0');
    expect(query('mktg-framework-print-icp-users')).toBeNull();
    expect(query('mktg-framework-print-pillars')).toBeNull();
  });

  it('ends in content flow with no viewport-height flex child or hidden trailing sections', async () => {
    await configure('browser', printView(null));
    const root = query('mktg-framework-print');
    const cover = query('mktg-framework-print-cover');
    expect(root?.classList.contains('flex')).toBe(false);
    expect(cover?.classList.contains('grid')).toBe(true);
    expect(root?.querySelector('.h-screen, .min-h-screen, .flex-1')).toBeNull();
    expect(Array.from(root?.children ?? []).map((child) => child.getAttribute('data-testid'))).toEqual([
      'mktg-framework-print-cover',
      'mktg-framework-print-framework',
      'mktg-framework-print-numbers',
    ]);
    expect(root?.lastElementChild?.classList.contains('break-after-page')).toBe(false);
  });

  it('sets its body text in the brand’s ink, not its dark: a kit whose "dark" is white still prints readable text', async () => {
    const kit = brandKitTestRevision();
    const pale: BrandKitRevision = { ...kit, kit: { ...kit.kit, dark: '#FFFFFF' } };
    await configure('browser', printView(pale));
    const root = query('mktg-framework-print');
    expect(root?.style.getPropertyValue('--mfp-dark')).toBe('#FFFFFF');
    expect(root?.style.getPropertyValue('--mfp-ink')).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(root?.className).toContain('text-[color:var(--mfp-ink)]');
    expect(root?.className).not.toContain('text-[color:var(--mfp-dark)]');
  });

  it('prefixes family section numbers without changing standalone numbering and shares the running head', async () => {
    await configure('browser', printView(null));
    const numbers = () => Array.from(host().querySelectorAll('h2 > span')).map((span) => span.textContent?.trim());
    expect(numbers()).toEqual(['01', '02']);
    expect(Array.from(query('mktg-framework-print-contents')?.querySelectorAll('dt') ?? []).map((entry) => entry.textContent?.trim())).toEqual(['01', '02']);
    expect(Array.from(query('mktg-framework-print-contents')?.querySelectorAll('dd') ?? []).map((entry) => entry.textContent?.trim())).toEqual([
      'Framework',
      'Key numbers',
    ]);
    fixture.componentRef.setInput('number', '01');
    await fixture.whenStable();
    expect(numbers()).toEqual(['01.1', '01.2']);
    expect(host().querySelectorAll('lfx-mktg-print-chapter-header .lfx-print-chapter-title')).toHaveLength(2);
    const heads = host().querySelectorAll('[data-testid="mktg-print-running-head"]');
    expect(heads).toHaveLength(2);
    heads.forEach((head) => expect(head.textContent).toContain('TestOrbit Messaging Framework'));
  });

  it('keeps the tagline accent on its text, never on an empty grid continuation', async () => {
    const view = printView(null);
    await configure('browser', view);
    const accent = query('mktg-framework-print-tagline-accent');
    expect(accent?.textContent?.trim()).toBe(view.mf.tagline);
    expect(accent?.parentElement?.className).not.toContain('border-l-');
    await setView({ ...view, mf: { ...view.mf, tagline: '' } });
    expect(query('mktg-framework-print-tagline-accent')).toBeNull();
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
