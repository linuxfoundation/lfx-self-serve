// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MKTG_PRINT_INK_ON_LIGHT, MKTG_PRINT_LANDSCAPE_CLASS, MKTG_PRINT_LF_LOOK } from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView } from '@lfx-one/shared/interfaces';
import { buildFoundationMessagePrintView } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, describe, expect, it } from 'vitest';

import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * Locks the framework print's own behaviour: it prints the deck's pages
 * (framework-print.ts) on the page shell, in the deck's order and numbering,
 * and it loads the kit's typeface from Google Fonts once, in the browser
 * only, under the same link id the brand kit book uses. Without a kit (the LF
 * look) or on the server it leaves the head alone. The shared builder's spec
 * covers each page's elements; the framework view's spec how the print is
 * placed and printed.
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

  it('prints the deck’s pages: the cover and the content pages of the four sections in framework-print.ts order, every one a landscape page frame', async () => {
    await configure('browser', printView(null));
    const wrapper = query('mktg-framework-print');
    expect(wrapper?.classList.contains('lfx-framework-pages')).toBe(true);
    // Outside the portrait prints' root class and its side padding (styles.scss): the frames are the root's block children.
    expect(host().querySelector('.lfx-framework-print')).toBeNull();
    expect(wrapper?.getAttribute('data-brand')).toBe('lf');
    const pages = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="framework-print-page"]'));
    expect(pages.map((page) => page.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-title'))).toEqual([
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
    expect(wrapper?.getAttribute('data-pages')).toBe('10');
    expect(pages.map((page) => page.getAttribute('data-section'))).toEqual([
      'framework',
      'framework',
      'framework',
      'framework',
      'icps',
      'icps',
      'message-house',
      'message-house',
      'numbers',
    ]);
    const frames = host().querySelectorAll('lfx-mktg-print-page');
    expect(frames).toHaveLength(10);
    expect(Array.from(frames).every((frame) => frame.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS) && frame.classList.contains('block'))).toBe(true);
    expect(Array.from(wrapper?.children ?? []).map((child) => child.tagName.toLowerCase())).toEqual([
      'lfx-mktg-print-cover',
      ...Array(9).fill('lfx-mktg-print-page'),
    ]);
    // Nothing of the portrait document: no sheets, no tables, no running heads; no back cover (the deck has none for the framework).
    expect(
      host().querySelector('table, lfx-mktg-print-sheet, lfx-mktg-print-running-head, lfx-mktg-print-chapter-header, lfx-mktg-print-back-cover')
    ).toBeNull();
    // The reviewer's note is the run's, not the reader's.
    expect(host().textContent).not.toContain('For the reviewer.');
  });

  it('sets the cover as the deck does: the title at 36 pt over the tagline, the eyebrow, the version, the accent bar and the line of sections; no logo', async () => {
    await configure('browser', printView(null));
    const cover = query('framework-print-cover');
    expect(cover?.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('cover');
    expect(cover?.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Messaging Framework');
    expect(cover?.querySelector<HTMLElement>('[data-testid="mktg-print-page-title"] .pp-para')?.style.fontSize).toBe('calc(var(--mktg-page-scale) * 36pt)');
    expect(cover?.querySelector('[data-testid="mktg-print-page-subtitle"]')?.textContent?.trim()).toBe('Release, open.');
    expect(cover?.textContent).toContain('TestOrbit · a Linux Foundation project');
    expect(cover?.textContent).toContain('Version 2');
    expect(cover?.textContent?.replace(/\s+/g, ' ')).toContain('01 Framework 02 ICPs 03 Message house 04 Key numbers');
    expect(cover?.querySelector('img')).toBeNull();
    expect(cover?.querySelector<HTMLElement>('[data-testid="mktg-print-page"]')?.style.getPropertyValue('--pp-dark')).toBe(MKTG_PRINT_LF_LOOK.dark);
  });

  it('numbers each content page from the cover in the footer, with no footer line, and sets its section’s running head', async () => {
    await configure('browser', printView(null));
    const pages = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="framework-print-page"]'));
    expect(pages.map((page) => page.getAttribute('data-page'))).toEqual(pages.map((_, index) => String(index + 2)));
    for (const page of pages) {
      const footer = Array.from(page.querySelectorAll('[data-testid="mktg-print-page-footer"]'), (el) => el.textContent?.trim());
      expect(footer).toEqual(['', page.getAttribute('data-page')]);
      expect(page.textContent).not.toContain('Version 2');
    }
    expect(Array.from(pages[4].querySelectorAll('[data-testid="mktg-print-page-head"]'), (el) => el.textContent?.trim())).toEqual([
      '02 ICPs',
      'TestOrbit Messaging Framework',
    ]);
    // The LF look's lockup sits in the layout's logo frame on every content page.
    expect(pages.every((page) => page.querySelector('[data-testid="mktg-print-page-logo"] img'))).toBe(true);
  });

  it('draws the Say and avoid page with the avoided phrase struck through and the goal column with its proof source in small capitals', async () => {
    await configure('browser', printView(null));
    const pages = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="framework-print-page"]'));
    const sayAvoid = pages.find((page) => page.querySelector('[data-title="Say and avoid"]'));
    const struck = sayAvoid?.querySelector<HTMLElement>('.pp-para--strike');
    expect(struck?.textContent?.trim()).toBe('synergy');
    expect(sayAvoid?.textContent).toContain('working together');
    expect(sayAvoid?.textContent).toContain('open');
    const goals = pages.find((page) => page.querySelector('[data-title="Goal columns"]'));
    expect(goals?.textContent?.replace(/\s+/g, ' ')).toContain('1,200 members · WEBSITE');
    expect(goals?.textContent).toContain('For End users, Maintainers');
  });

  it('sets its body text in the brand’s ink, not its dark: a kit whose "dark" is white still prints readable text', async () => {
    const kit = brandKitTestRevision();
    const pale: BrandKitRevision = { ...kit, kit: { ...kit.kit, dark: '#FFFFFF' } };
    const view = printView(pale);
    expect(view.brand.dark).toBe('#FFFFFF');
    expect(view.brand.ink).toBe(MKTG_PRINT_INK_ON_LIGHT);
    await configure('browser', view);
    const page = host().querySelector<HTMLElement>('[data-testid="framework-print-page"] [data-testid="mktg-print-page"]');
    expect(page?.style.getPropertyValue('--pp-ink')).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(page?.style.getPropertyValue('--pp-dark')).toBe('#FFFFFF');
  });

  it('inside a larger document, numbers from firstPage and accepts the family number without drawing it', async () => {
    await configure('browser', printView(null));
    fixture.componentRef.setInput('firstPage', 4);
    fixture.componentRef.setInput('number', '01');
    await fixture.whenStable();
    expect(query('framework-print-page')?.getAttribute('data-page')).toBe('5');
    expect(query('mktg-framework-print')?.getAttribute('data-pages')).toBe('10');
    expect(host().textContent).not.toContain('01.');
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
