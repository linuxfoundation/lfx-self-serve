// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BrandKitRevision } from '@lfx-one/shared/interfaces';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrandKitViewComponent } from './brand-kit-view.component';

/**
 * Locks the book's own behaviour — the kit's print rendering, which the web
 * view holds in a print-only wrapper and prints with Download PDF (the print
 * itself is the web view's spec): the 16 pages with no toolbar of their own,
 * the layout utilities, the logo files named and never shown as URLs, and the
 * Google Fonts stylesheet appended once per URL in the browser and never on
 * the server.
 */
describe('BrandKitViewComponent', () => {
  let fixture: ComponentFixture<BrandKitViewComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  const fontLinks = (): HTMLLinkElement[] => Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[id^="brand-kit-font-"]'));

  const configure = async (platformId: 'browser' | 'server', kit: BrandKitRevision = brandKitTestRevision()): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [BrandKitViewComponent],
      providers: [provideNoopAnimations(), { provide: PLATFORM_ID, useValue: platformId }],
    }).compileComponents();
    fixture = TestBed.createComponent(BrandKitViewComponent);
    fixture.componentRef.setInput('view', buildBrandKitBookView(kit));
    await fixture.whenStable();
  };

  afterEach(() => {
    fontLinks().forEach((link) => link.remove());
  });

  describe('in the browser', () => {
    beforeEach(async () => configure('browser'));

    it('lays the kit out as the 16 pages with no toolbar of its own (the web view has the actions), and names every share on the proportion bar', () => {
      expect(host().querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(query('brand-kit-view-toolbar')).toBeNull();
      expect(query('brand-kit-view-download-pdf')).toBeNull();
      expect(query('brand-kit-view-report')).toBeNull();
      // The bar's segments are paint; the accessible name lists what each one is.
      expect(query('brand-kit-proportion')?.getAttribute('aria-label')).toBe(
        'How much of a surface each color takes: Charcoal 55%, White 30%, Orange 10%, Mid gray 5%'
      );
      expect(host().querySelector('[data-testid="brand-kit-proportion"] [title]')).toBeNull();
    });

    it('lays every page out with utilities on the kit’s custom properties — the cover keeps the dark grid next to the sheet utilities, and no inline style sets layout', () => {
      const cover = query('brand-kit-page-cover')?.firstElementChild;
      // The sheet's utility set (bound) and the dark grid (static) land on the same element.
      expect(cover?.classList.contains('lfx-brand-kit-dark-grid')).toBe(true);
      expect(cover?.classList.contains('flex')).toBe(true);
      expect(cover?.classList.contains('font-[family-name:var(--bk-font)]')).toBe(true);
      // Layout never rides a style attribute: only the kit's own values (its colours, its sizes) are bound.
      const styled = Array.from(host().querySelectorAll<HTMLElement>('[data-testid="brand-kit-book"] [style]'));
      const layoutProperties = ['max-width', 'max-height', 'top', 'left', 'right', 'bottom', 'opacity', 'row-gap', 'aspect-ratio', 'font-family'];
      const layoutByStyle = styled.filter((element) => layoutProperties.some((property) => element.style.getPropertyValue(property)));
      expect(layoutByStyle.map((element) => element.getAttribute('style'))).toEqual([]);
    });

    it('stacks every colorway, watchout and usage tile with the tile utilities — the loop item never shadows the class string', () => {
      const wrappers = ['brand-kit-colorway-tile', 'brand-kit-watchout-tile', 'brand-kit-usage-tile'].map((testId) => ({
        testId,
        elements: Array.from(host().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)),
      }));
      wrappers.forEach(({ testId, elements }) => {
        expect(elements.length, testId).toBeGreaterThan(0);
        elements.forEach((element) => {
          expect(element.classList.contains('flex-col'), testId).toBe(true);
          expect(element.classList.contains('min-h-0'), testId).toBe(true);
          // A loop item bound as [class] would land its own keys here.
          ['name', 'light', 'ground', 'label', 'caption', 'dark', 'layout'].forEach((key) =>
            expect(element.classList.contains(key), `${testId} ${key}`).toBe(false)
          );
        });
      });
    });

    it('appends the Google Fonts stylesheet once per URL, however many times the kit is set', async () => {
      const links = fontLinks();
      expect(links).toHaveLength(1);
      expect(links[0].rel).toBe('stylesheet');
      expect(links[0].href).toContain('fonts.googleapis.com');
      expect(links[0].href).toContain('Montserrat');

      // A new revision of the same kit, and a second view of it on the same page: still one link.
      fixture.componentRef.setInput('view', buildBrandKitBookView({ ...brandKitTestRevision(), version: 2 }));
      await fixture.whenStable();
      const second = TestBed.createComponent(BrandKitViewComponent);
      second.componentRef.setInput('view', buildBrandKitBookView(brandKitTestRevision()));
      await second.whenStable();

      expect(fontLinks()).toHaveLength(1);
      second.destroy();
    });

    it('appends no stylesheet for a typeface that is not on Google Fonts', async () => {
      fontLinks().forEach((link) => link.remove());
      const kit = brandKitTestRevision();
      kit.chapters.type.google_fonts = false;
      fixture.componentRef.setInput('view', buildBrandKitBookView(kit));
      await fixture.whenStable();

      expect(fontLinks()).toHaveLength(0);
    });

    it('names a logo file by its own name, never its URL, and breaks long tokens inside their column', async () => {
      const kit = brandKitTestRevision();
      kit.chapters.logo.files.primary = { ref: 'https://cdn.example.org/images/a1/production/orbit-logo%20horizontal.png?w=200', svg: null };
      fixture.componentRef.setInput('view', buildBrandKitBookView(kit));
      await fixture.whenStable();

      const book = query('brand-kit-book');
      expect(book?.textContent).toContain('orbit-logo horizontal.png');
      expect(book?.textContent).not.toContain('https://cdn.example.org');
      expect(query('brand-kit-page-contents')?.textContent).toContain('Built from the logo file orbit-logo horizontal.png,');
      // Every page's sheet makes its text wrap anywhere, so no value runs across the next column.
      expect(query('brand-kit-page-contents')?.firstElementChild?.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
    });
  });

  describe('on the server', () => {
    beforeEach(async () => configure('server'));

    it('renders the book without touching the head', () => {
      expect(host().querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(fontLinks()).toHaveLength(0);
    });
  });
});
