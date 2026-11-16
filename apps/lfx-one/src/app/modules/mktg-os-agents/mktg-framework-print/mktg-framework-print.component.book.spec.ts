// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_SEP,
  FRAMEWORK_PORTRAIT_TOPS,
  MKTG_PRINT_INK_ON_LIGHT,
  MKTG_PRINT_LF_LOOK,
  MKTG_PRINT_REVERSED_FILTER,
  MKTG_PORTRAIT_COVER_STRIP,
} from '@lfx-one/shared/constants';
import { BrandKitRevision, FoundationMessageContent, FoundationMessagePrintView, FoundationMessageReport } from '@lfx-one/shared/interfaces';
import {
  brandKitWebsiteHost,
  buildFoundationMessagePrintView,
  mktgPortraitAccentOnDark,
  mktgPortraitPlatePadding,
  mktgPortraitPlateRadius,
  mktgPrintBrand,
} from '@lfx-one/shared/utils';
import { brandKitLogolessFixture, brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, describe, expect, it } from 'vitest';
import { MktgFrameworkPrintComponent } from './mktg-framework-print.component';

/**
 * The framework print inside the family's book and in its look, and the cover
 * in a project's kit: the kit's lockup and band, the strip's one line, the
 * white plate under a lockup the kit cannot reverse, and the logo-less kit.
 * The component's base behaviors are in `mktg-framework-print.component.spec.ts`;
 * its pages in `.pages.spec.ts`, the fit model's in `.fit.spec.ts`. Each part
 * mounts the component on the same synthetic record (the editor's rule for this
 * pull request: spec files only, so the setup is repeated, not shared).
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

describe('MktgFrameworkPrintComponent, the book and the cover', () => {
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

  it('prints the cover in the project’s Brand Kit when the view carries one: the kit’s lockup, its dark band, its accent (editor C1)', async () => {
    // The kit's primary is the fixture's multi-colour lockup with no reversed file: on the dark band it is drawn as it is (never
    // flattened to white, K's rule), the band is the kit's dark, the eyebrow and the goal labels read the grammar's accent on
    // that dark (the accent where it reaches AA there, else the ink), never the LF look's.
    const kit = brandKitTestRevision();
    const brand = mktgPrintBrand(kit);
    await configure('browser', printView(kit));
    const logo = query('mktg-framework-print-cover-logo');
    expect(brand.logoOnDark).not.toBeNull();
    // The alt names the kit's project (`mktgPrintBrand`), the fixture's 'Project One'.
    expect([logo?.getAttribute('src'), logo?.getAttribute('alt'), logo?.style.filter]).toEqual([brand.logoOnDark?.src, `${kit.projectName} logo`, '']);
    expect(logo?.getAttribute('src')).not.toBe('/images/logo_lf_white.svg');
    expect(logo?.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    const cover = frame('cover');
    expect(cover?.style.getPropertyValue('--pp-dark')).toBe(kit.kit.dark);
    expect(cover?.style.getPropertyValue('--pp-accent')).toBe(kit.kit.accent);
    expect(cover?.style.getPropertyValue('--pp-accent-on-dark')).toBe(
      mktgPortraitAccentOnDark({ accent: kit.kit.accent, dark: kit.kit.dark, onDark: brand.onDark })
    );
    expect(cover?.style.getPropertyValue('--pp-dark')).not.toBe(MKTG_PRINT_LF_LOOK.dark);
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('kit');
    expect(query('mktg-framework-print-tagline')?.classList.contains('fwp-cover-eyebrow')).toBe(true);
  });

  it('keeps the cover strip on one line by the grammar’s rule: a long name loses the Linux Foundation segment first; only one word each still too long wraps it, moved up a line (order 41)', async () => {
    // The overfull record's name with the kit's host: the left half gives up "· a Linux Foundation project" and both halves share
    // the one line (K's `mktgPortraitCoverStrip`, the kit cover's rule), the strip at the design's top.
    const kit = brandKitTestRevision();
    await configure('browser', printView(kit, 'Cloud Native Computing Foundation (CNCF)'));
    const strip = query('mktg-framework-print-cover-strip');
    const halves = (): string[] => Array.from(strip?.querySelectorAll('span') ?? []).map((span) => span.textContent?.trim() ?? '');
    expect(halves()).toEqual([
      'Cloud Native Computing Foundation (CNCF)',
      `${brandKitWebsiteHost(kit.websiteUrl)}${FRAMEWORK_PORTRAIT_SEP}V2.0${FRAMEWORK_PORTRAIT_SEP}6 Nov 2026`,
    ]);
    expect(strip?.classList.contains('pp-cover-strip')).toBe(true);
    expect(strip?.classList.contains('pp-cover-strip--wrapped')).toBe(false);
    expect(top(strip)).toBe(FRAMEWORK_PORTRAIT_TOPS.coverStrip);
    // One word each that still does not fit: the strip wraps whole, moved up one line so it ends where the one line did.
    const word = 'Supercalifragilisticexpialidociousfoundationofeverythingopenandneutralforever';
    const wide = brandKitTestRevision();
    wide.websiteUrl = `https://${word.toLowerCase()}.example.org/`;
    await setView(printView(wide, word));
    expect(strip?.classList.contains('pp-cover-strip--wrapped')).toBe(true);
    // The foot line's segments the rule keeps print with the framework's separator, as the right half does (S-b).
    expect(halves()[0]).toBe(`${word}${FRAMEWORK_PORTRAIT_SEP}a Linux Foundation project`);
    expect(top(strip)).toBe(FRAMEWORK_PORTRAIT_TOPS.coverStrip - MKTG_PORTRAIT_COVER_STRIP.size * MKTG_PORTRAIT_COVER_STRIP.lineHeight);
  });

  it('sets a full-colour lockup the kit cannot reverse on the grammar’s white plate, padded by half its height, the artwork kept in place; no plate for a one-ink or a supplied reversed lockup (editor W3)', async () => {
    // The fixture's primary is drawn in three colours and the kit supplied no reversed file: on the dark band it sits on the
    // white plate (K's precedence: supplied reversed > derived one-ink > plate), padded by half the 40 px drawn height, the
    // block started that padding higher so the artwork itself keeps the band's lockup place.
    const padding = mktgPortraitPlatePadding(FRAMEWORK_PORTRAIT_ROOM.coverLogoHeight);
    await configure('browser', printView(brandKitTestRevision()));
    // The plate is the grammar's directive, given the lockup's outer height: its class, padding and radius are the directive's.
    const plate = query('mktg-portrait-plate');
    expect(plate?.classList.contains('pp-plate')).toBe(true);
    expect([plate?.style.padding, plate?.style.marginTop]).toEqual([`${padding}px`, `${FRAMEWORK_PORTRAIT_ROOM.coverLogoTop - padding}px`]);
    expect(parseFloat(plate?.style.borderRadius ?? '')).toBeCloseTo(mktgPortraitPlateRadius(null, FRAMEWORK_PORTRAIT_ROOM.coverLogoHeight + 2 * padding), 3);
    const plated = plate?.querySelector<HTMLElement>('[data-testid="mktg-framework-print-cover-logo"]');
    expect([plated?.style.filter, plated?.style.height]).toEqual(['', `${FRAMEWORK_PORTRAIT_ROOM.coverLogoHeight}px`]);
    // A one-ink primary reverses by filter: no plate, the block at the band's place.
    const oneInk = brandKitTestRevision();
    oneInk.chapters.logo.files.primary = {
      ref: 'mark.svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>',
    };
    await setView(printView(oneInk));
    expect(query('mktg-portrait-plate')).toBeNull();
    const filtered = query('mktg-framework-print-cover-logo');
    expect(filtered?.style.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
    expect(filtered?.parentElement?.style.marginTop).toBe(`${FRAMEWORK_PORTRAIT_ROOM.coverLogoTop}px`);
    // A supplied reversed file is drawn as it is: no plate, no filter.
    const reversed = brandKitTestRevision();
    reversed.chapters.logo.files.reversed = {
      ref: 'reversed.svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    };
    await setView(printView(reversed));
    expect(query('mktg-portrait-plate')).toBeNull();
    expect(query('mktg-framework-print-cover-logo')?.style.filter).toBe('');
  });

  it('skips the cover’s logo block on a kit with no drawable artwork, and keeps the rest of the cover', async () => {
    await configure('browser', printView(brandKitLogolessFixture()));
    expect(query('mktg-framework-print-cover-logo')).toBeNull();
    expect(query('mktg-framework-print-cover')?.querySelector('.fwp-cover-logo')).toBeNull();
    expect(query('mktg-framework-print-tagline')?.textContent?.trim()).toBe('Release, open.');
    expect(query('mktg-framework-print')?.getAttribute('data-brand')).toBe('kit');
  });
});
