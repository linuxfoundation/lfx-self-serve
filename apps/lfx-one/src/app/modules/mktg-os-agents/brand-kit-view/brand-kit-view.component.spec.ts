// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { BrandKitRevision } from '@lfx-one/shared/interfaces';
import { brandKitTestRevision } from '@shared/testing/brand-kit-test-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrandKitViewComponent } from './brand-kit-view.component';

/**
 * Locks the kit view's own behaviour — what the run page's spec, which only
 * checks that the book mounts, cannot see: Download PDF's print class on the
 * body and its removal after the print and on destroy, the SSR guard, the
 * Google Fonts stylesheet appended once per URL in the browser and never on
 * the server, and the report toggle with its gap count.
 */
describe('BrandKitViewComponent', () => {
  let fixture: ComponentFixture<BrandKitViewComponent>;
  let component: BrandKitViewComponent;
  let print: ReturnType<typeof vi.spyOn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  const button = (testId: string): HTMLButtonElement | null => query(testId)?.querySelector('button') ?? null;
  const fontLinks = (): HTMLLinkElement[] => Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[id^="brand-kit-font-"]'));

  const configure = async (platformId: 'browser' | 'server', kit: BrandKitRevision = brandKitTestRevision()): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [BrandKitViewComponent],
      providers: [provideNoopAnimations(), { provide: PLATFORM_ID, useValue: platformId }],
    }).compileComponents();
    fixture = TestBed.createComponent(BrandKitViewComponent);
    fixture.componentRef.setInput('kit', kit);
    component = fixture.componentInstance;
    await fixture.whenStable();
  };

  beforeEach(() => {
    // jsdom has no printer: the dialog is the browser's, and the test only needs to see it was asked for.
    print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  afterEach(() => {
    print.mockRestore();
    fontLinks().forEach((link) => link.remove());
    document.body.classList.remove(BRAND_KIT_PRINT_BODY_CLASS);
  });

  describe('in the browser', () => {
    beforeEach(async () => configure('browser'));

    it('lays the kit out as the 16 pages with the toolbar, and names every share on the proportion bar', () => {
      expect(host().querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(query('brand-kit-view-toolbar')).not.toBeNull();
      expect(button('brand-kit-view-export-slides')?.disabled).toBe(true);
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

    it('Download PDF marks the body for the print, asks the browser to print, and clears the mark when the print ends', () => {
      button('brand-kit-view-download-pdf')?.click();

      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(true);
      expect(print).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('afterprint'));
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });

    it('clears the print mark when the view is destroyed with the dialog still up', () => {
      button('brand-kit-view-download-pdf')?.click();
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(true);

      fixture.destroy();

      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });

    it('appends the Google Fonts stylesheet once per URL, however many times the kit is set', async () => {
      const links = fontLinks();
      expect(links).toHaveLength(1);
      expect(links[0].rel).toBe('stylesheet');
      expect(links[0].href).toContain('fonts.googleapis.com');
      expect(links[0].href).toContain('Montserrat');

      // A new revision of the same kit, and a second view of it on the same page: still one link.
      fixture.componentRef.setInput('kit', { ...brandKitTestRevision(), version: 2 });
      await fixture.whenStable();
      const second = TestBed.createComponent(BrandKitViewComponent);
      second.componentRef.setInput('kit', brandKitTestRevision());
      await second.whenStable();

      expect(fontLinks()).toHaveLength(1);
      second.destroy();
    });

    it('appends no stylesheet for a typeface that is not on Google Fonts', async () => {
      fontLinks().forEach((link) => link.remove());
      const kit = brandKitTestRevision();
      kit.chapters.type.google_fonts = false;
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();

      expect(fontLinks()).toHaveLength(0);
    });

    it('opens the report with the sources read, the sources that failed and the gaps, and counts the gaps and failures on the toggle', async () => {
      const kit = brandKitTestRevision();
      kit.report = {
        sources_read: ['https://one.example.org', 'logo.svg'],
        sources_failed: [{ name: 'https://one.example.org/brand', reason: 'HTTP 404' }],
        gaps: ['No stacked lockup was given.', 'The brand page could not be read.'],
        notes: 'Two files were read.',
      };
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();

      expect(component['gapCount']()).toBe(3);
      expect(query('brand-kit-view-report-toggle')?.querySelector('.p-badge')?.textContent?.trim()).toBe('3');
      expect(query('brand-kit-view-report')).toBeNull();

      button('brand-kit-view-report-toggle')?.click();
      await fixture.whenStable();

      const report = query('brand-kit-view-report');
      expect(report?.textContent).toContain('logo.svg');
      expect(report?.textContent).toContain('https://one.example.org/brand');
      expect(report?.textContent).toContain('HTTP 404');
      expect(report?.textContent).toContain('No stacked lockup was given.');
      expect(report?.textContent).toContain('Two files were read.');
      expect(button('brand-kit-view-report-toggle')?.getAttribute('aria-expanded')).toBe('true');

      button('brand-kit-view-report-toggle')?.click();
      await fixture.whenStable();
      expect(query('brand-kit-view-report')).toBeNull();
    });

    it('shows no count on the toggle when every chapter is sourced', () => {
      expect(component['gapCount']()).toBe(0);
      expect(query('brand-kit-view-report-toggle')?.querySelector('.p-badge')).toBeNull();
    });
  });

  describe('on the server', () => {
    beforeEach(async () => configure('server'));

    it('renders the book without touching the head, and never prints', () => {
      expect(host().querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(fontLinks()).toHaveLength(0);

      component['onDownloadPdf']();

      expect(print).not.toHaveBeenCalled();
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });
  });
});
