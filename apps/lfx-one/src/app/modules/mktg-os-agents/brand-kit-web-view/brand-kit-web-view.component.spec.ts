// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BRAND_KIT_PRINT_BODY_CLASS, BRAND_KIT_PRINT_ONLY_CLASS } from '@lfx-one/shared/constants';
import { BrandKitRevision } from '@lfx-one/shared/interfaces';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrandKitWebViewComponent } from './brand-kit-web-view.component';

/** A logo uploaded to a CDN that names files by an opaque hash: one long unbroken token. */
const CDN_LOGO_URL = 'https://cdn.sanity.io/images/p4x9k2m1/production/0f3e9c2b8a7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f-838x203.svg';

/**
 * Locks the kit's web view (hand test, 18 Oct: the kit on screen as an app
 * page, the book for print): the framework view's header and keyboard tabs,
 * each tab rendered from a fixture kit, the built-from text with no URL, the
 * book in its print-only wrapper (never on screen), and Download PDF printing
 * it — the print class on the body, cleared after the print and on destroy,
 * never on the server.
 */
describe('BrandKitWebViewComponent', () => {
  let fixture: ComponentFixture<BrandKitWebViewComponent>;
  let print: ReturnType<typeof vi.spyOn>;
  let slidesExport: { last: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => Array.from(host().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const button = (testId: string): HTMLButtonElement | null => query(testId)?.querySelector('button') ?? null;
  const tab = (id: string): HTMLButtonElement => query(`brand-kit-web-view-tab-${id}`) as HTMLButtonElement;
  const open = async (id: string): Promise<void> => {
    tab(id).click();
    await fixture.whenStable();
  };

  const configure = async (platformId: 'browser' | 'server', kit: BrandKitRevision = brandKitTestRevision()): Promise<void> => {
    slidesExport = {
      last: vi.fn(() => of({ last: null, latestRevision: null })),
      start: vi.fn(() => of({ sessionId: 's', ownerToken: 't', revision: { id: 'r', number: 1, contentSha256: 'a' }, mode: 'create', logoNote: null })),
      poll: vi.fn(() => NEVER),
    };
    await TestBed.configureTestingModule({
      imports: [BrandKitWebViewComponent],
      providers: [provideNoopAnimations(), { provide: PLATFORM_ID, useValue: platformId }, provideMktgSlidesExportStub(slidesExport)],
    }).compileComponents();
    fixture = TestBed.createComponent(BrandKitWebViewComponent);
    fixture.componentRef.setInput('kit', kit);
    // This fixture explicitly supplies the independently approved print payload.
    fixture.componentRef.setInput('approvedKit', kit);
    fixture.componentRef.setInput('approvedVersion', 1);
    await fixture.whenStable();
  };

  beforeEach(() => {
    // jsdom has no printer: the dialog is the browser's, and the test only needs to see it was asked for.
    print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  afterEach(() => {
    print.mockRestore();
    document.body.classList.remove(BRAND_KIT_PRINT_BODY_CLASS);
    document.head.querySelectorAll('link[id^="brand-kit-font-"]').forEach((link) => link.remove());
  });

  describe('in the browser', () => {
    beforeEach(async () => configure('browser'));

    it('exports the stored kit to Google Slides, the panel showing the progress', async () => {
      const target = { project: 'proj-1', agentKey: 'brand-kit' as const, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
      fixture.componentRef.setInput('exportTarget', target);
      await fixture.whenStable();
      expect(button('brand-kit-web-view-export-slides')?.disabled).toBe(false);

      button('brand-kit-web-view-export-slides')?.click();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();

      expect(slidesExport.start).toHaveBeenCalledWith({ ...target, mode: 'create' });
      expect(query('mktg-slides-export-running')).not.toBeNull();
      expect(button('brand-kit-web-view-export-slides')?.disabled).toBe(true);
      expect(query('brand-kit-web-view-footer')?.textContent).toContain('Export to Google Slides builds the kit as a deck');
    });

    it('heads the page as the framework view does: the title, the kit’s version, the mode, and the actions', async () => {
      expect(query('brand-kit-web-view-title')?.textContent?.trim()).toBe('Project One Brand Kit');
      expect(query('brand-kit-web-view-version')?.textContent?.trim()).toBe('v1');
      expect(query('brand-kit-web-view-approval-state')?.textContent?.trim()).toBe('Draft');
      expect(query('brand-kit-web-view-mode')).toBeNull();
      expect(query('brand-kit-web-view-header')?.textContent?.match(/v1/g)).toHaveLength(1);
      expect(button('brand-kit-web-view-download-pdf')?.disabled).toBe(false);
      // Export to Google Slides waits for the page to name a stored revision.
      expect(button('brand-kit-web-view-export-slides')?.disabled).toBe(true);

      fixture.componentRef.setInput('version', 3);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-version')?.textContent?.trim()).toBe('v3');
      // Viewing a new Draft does not relabel the independently approved print target.
      expect(query('brand-kit-web-view-print')?.textContent).toContain('V1.0');
      expect(query('brand-kit-web-view-print')?.textContent).not.toContain('V3.0');
    });

    it('prints approved kit bytes while the screen renders a different Draft', async () => {
      fixture.componentRef.setInput('kit', { ...brandKitTestRevision(), projectName: 'Synthetic draft only' });
      fixture.componentRef.setInput('version', 3);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-title')?.textContent).toContain('Synthetic draft only');
      expect(query('brand-kit-web-view-print')?.textContent).toContain('Project One');
      expect(query('brand-kit-web-view-print')?.textContent).not.toContain('Synthetic draft only');
      expect(query('brand-kit-web-view-print')?.textContent).toContain('V1.0');
    });

    it('omits the book and guards Download PDF when no approved kit is supplied', async () => {
      fixture.componentRef.setInput('approvedKit', null);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-print')).toBeNull();
      expect(button('brand-kit-web-view-download-pdf')?.disabled).toBe(true);
      button('brand-kit-web-view-download-pdf')?.click();
      await fixture.whenStable();
      expect(print).not.toHaveBeenCalled();
    });

    it('shows Approved only from a store approval and hides the draft mode badge', async () => {
      fixture.componentRef.setInput('approval', { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: null } });
      await fixture.whenStable();
      expect(query('brand-kit-web-view-approval-state')?.textContent?.trim()).toBe('Approved');
      expect(query('brand-kit-web-view-version')?.textContent?.trim()).toBe('v1');
      expect(query('brand-kit-web-view-mode')).toBeNull();
    });

    it.each([
      ['redraft', 'Redraft'],
      ['check', 'Checked'],
    ] as const)('retains the distinct %s mode beside the state word', async (mode, label) => {
      fixture.componentRef.setInput('kit', { ...brandKitTestRevision(), mode });
      await fixture.whenStable();
      expect(query('brand-kit-web-view-approval-state')?.textContent?.trim()).toBe('Draft');
      expect(query('brand-kit-web-view-mode')?.textContent?.trim()).toBe(label);
    });

    it('keeps the book in its print-only wrapper — never on screen — and wraps every text block', () => {
      const wrapper = query('brand-kit-web-view-print');
      expect(wrapper?.classList.contains(BRAND_KIT_PRINT_ONLY_CLASS)).toBe(true);
      // The book is inside it, and nowhere else on the page.
      expect(wrapper?.querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(host().querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);
      expect(host().querySelector(`.${BRAND_KIT_PRINT_ONLY_CLASS}`)?.contains(query('brand-kit-book'))).toBe(true);
      // The book brings no toolbar of its own: the actions are the web view's.
      expect(query('brand-kit-view-toolbar')).toBeNull();
      expect(query('brand-kit-web-view')?.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
    });

    it('moves the selection and the focus along the tabs with the arrow keys, Home and End (roving tabindex)', async () => {
      const tabs = (): HTMLButtonElement[] => Array.from(host().querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      expect(tabs().map((element) => element.textContent?.trim())).toEqual([
        'Overview',
        'Logo',
        'Color',
        'Type',
        'Visual',
        'Usage',
        'Voice',
        'Sources and gaps',
      ]);
      expect(tabs().map((element) => element.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1', '-1']);
      const tablist = query('brand-kit-web-view-tabs') as HTMLElement;

      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await fixture.whenStable();
      expect(tab('logo').getAttribute('aria-selected')).toBe('true');
      expect(tab('logo').getAttribute('tabindex')).toBe('0');
      expect(document.activeElement).toBe(tab('logo'));
      expect(query('brand-kit-web-view-panel-logo')).not.toBeNull();

      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await fixture.whenStable();
      expect(tab('sources').getAttribute('aria-selected')).toBe('true');

      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await fixture.whenStable();
      expect(tab('overview').getAttribute('aria-selected')).toBe('true');

      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await fixture.whenStable();
      expect(tab('sources').getAttribute('aria-selected')).toBe('true');

      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await fixture.whenStable();
      expect(tab('overview').getAttribute('aria-selected')).toBe('true');
      expect(query('brand-kit-web-view-panel-overview')?.getAttribute('aria-labelledby')).toBe('brand-kit-web-view-tab-overview');
    });

    it('Overview: what the kit is built from, the brand at a glance, and the six chapters, each opening its tab', async () => {
      expect(query('brand-kit-web-view-built-from')?.textContent).toContain('Built from the logo file logo.svg, the messaging framework');
      expect(query('brand-kit-web-view-glance')?.querySelector('img')?.getAttribute('alt')).toBe('Primary lockup — logo.svg');
      const chapters = Array.from(query('brand-kit-web-view-chapters')?.querySelectorAll('article') ?? []);
      expect(chapters.map((chapter) => chapter.getAttribute('data-testid'))).toEqual(
        ['logo', 'color', 'type', 'visual', 'usage', 'voice'].map((id) => `brand-kit-web-view-chapter-${id}`)
      );
      expect(query('brand-kit-web-view-chapter-color')?.textContent).toContain('Charcoal and white carry the brand.');

      query('brand-kit-web-view-open-color')?.click();
      await fixture.whenStable();
      expect(tab('color').getAttribute('aria-selected')).toBe('true');
      expect(query('brand-kit-web-view-panel-color')).not.toBeNull();
      // The clicked button went with the Overview panel: focus lands on the tab it opened, once that has rendered.
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement).toBe(tab('color'));
    });

    it('Overview: a logo on a CDN is named as the logo you supplied — never its URL', async () => {
      const kit = brandKitTestRevision();
      kit.chapters.logo.files.primary = { ref: CDN_LOGO_URL, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' };
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();

      const builtFrom = query('brand-kit-web-view-built-from')?.textContent ?? '';
      expect(builtFrom).toContain('Built from the logo you supplied, the messaging framework');
      expect(builtFrom).not.toContain('https://');
      expect(builtFrom).not.toContain('cdn.sanity.io');
      expect(host().textContent).not.toContain(CDN_LOGO_URL);
    });

    it('Logo: the lockups from the files, the four colorways on their grounds, clear space, minimum sizes and the six watchouts', async () => {
      await open('logo');

      expect(query('brand-kit-web-view-lockups')?.querySelectorAll('img').length).toBeGreaterThan(0);
      expect(query('brand-kit-web-view-lockups')?.textContent).toContain('logo.svg');
      const colorways = queryAll('brand-kit-web-view-colorway');
      expect(colorways.map((element) => element.textContent?.trim())).toEqual([
        'Full color · on white',
        'Reversed · on Charcoal',
        'Full color · on light tint',
        'One-color black · print only',
      ]);
      // The reversed tile sits on the kit's dark and draws the logo white.
      const reversed = colorways[1].firstElementChild as HTMLElement;
      expect(reversed.style.background).toContain('rgb(77, 78, 78)');
      expect((reversed.firstElementChild as HTMLElement).style.filter).toBe('brightness(0) invert(1)');
      expect(query('brand-kit-web-view-clear-space')?.textContent).toContain('X on every side.');
      expect(query('brand-kit-web-view-minimum-size')?.textContent).toContain('32 px tall on screen, 10 mm in print.');
      expect(queryAll('brand-kit-web-view-watchout')).toHaveLength(6);
      expect(query('brand-kit-web-view-placeholder')).toBeNull();
    });

    it('Color: a swatch card per value with name, hex, RGB, role and where it was found, the proportion, and the contrast table with pass or fail', async () => {
      await open('color');

      const orange = query('brand-kit-web-view-swatch-F37625')?.textContent ?? '';
      expect(orange).toContain('Orange');
      expect(orange).toContain('#F37625');
      expect(orange).toContain('243 118 37');
      expect(orange).toContain('Accent');
      // Where it was found, by the site's host — never a raw URL.
      expect(orange).toContain('From the site’s CSS — one.example.org');
      expect(orange).not.toContain('https://');
      expect(query('brand-kit-web-view-swatch-4D4E4E')?.textContent).toContain('logo.svg');
      expect(query('brand-kit-web-view-proportion')?.getAttribute('aria-label')).toBe(
        'How much of a surface each color takes: Charcoal 55%, White 30%, Orange 10%, Mid gray 5%'
      );
      const contrast = query('brand-kit-web-view-contrast-0')?.textContent ?? '';
      expect(contrast).toContain('Charcoal on White');
      expect(contrast).toContain('8.3:1');
      expect(contrast).toContain('AAA');
      expect(contrast).toContain('Pass');
    });

    it('Type: the specimen set in the kit’s typeface, its weights, and the scale', async () => {
      await open('type');

      const specimen = query('brand-kit-web-view-specimen');
      expect(specimen?.textContent).toContain('Montserrat');
      expect(specimen?.textContent).toContain('AaBbCc');
      expect((specimen?.querySelector('[style]') as HTMLElement | null)?.style.fontFamily).toContain('Montserrat');
      expect(specimen?.textContent).toContain('Regular 400');
      expect(specimen?.textContent).toContain('Bold 700');
      const scale = query('brand-kit-web-view-scale');
      expect(scale?.textContent).toContain('H1 / Display');
      expect(scale?.textContent).toContain('500 · 64/72');
      expect(scale?.textContent).toContain('Eyebrow');
    });

    it('Visual: the iconography rules and icons, the imagery rule and what to avoid, the graphic elements in the kit’s colours', async () => {
      await open('visual');

      expect(query('brand-kit-web-view-icons')?.querySelectorAll('i')).toHaveLength(8);
      expect(query('brand-kit-web-view-icons')?.textContent).toContain('Recommended set: Lucide');
      expect(query('brand-kit-web-view-imagery')?.textContent).toContain('Structure.');
      expect(query('brand-kit-web-view-imagery')?.textContent).toContain('Hackers');
      expect(query('brand-kit-web-view-elements')?.textContent).toContain('Primary button');
    });

    it('Usage: the four example usages set in the kit, with their formats', async () => {
      await open('usage');

      const usages = queryAll('brand-kit-web-view-usage');
      expect(usages).toHaveLength(4);
      expect(usages[0].textContent).toContain('Keynote slide · 16:9');
      expect(usages[3].textContent).toContain('[Partner] joins Project One');
    });

    it('Voice: the umbrella, the brand line and the four attributes, from the messaging framework', async () => {
      await open('voice');

      expect(query('brand-kit-web-view-umbrella')?.textContent).toContain('Where organizations fund Project One.');
      expect(query('brand-kit-web-view-line')?.textContent).toContain('Open standards for one computing');
      expect(query('brand-kit-web-view-attributes')?.querySelectorAll('article')).toHaveLength(4);
      expect(query('brand-kit-web-view-panel-voice')?.textContent).toContain('From the messaging framework');
    });

    it('Sources and gaps: the framework view’s treatment, opened by Report with the count of gaps and failures', async () => {
      const kit = brandKitTestRevision();
      kit.report = {
        sources_read: ['https://one.example.org', 'logo.svg'],
        sources_failed: [{ name: 'https://one.example.org/brand', reason: 'HTTP 404' }],
        gaps: ['No stacked lockup was given.', 'The brand page could not be read.'],
        notes: 'Two files were read.\nThe accent is from the CSS.',
      };
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-report')?.querySelector('.p-badge')?.textContent?.trim()).toBe('3');

      button('brand-kit-web-view-report')?.click();
      await fixture.whenStable();

      expect(tab('sources').getAttribute('aria-selected')).toBe('true');
      expect(query('brand-kit-web-view-sources-read')?.textContent).toContain('logo.svg');
      expect(query('brand-kit-web-view-sources-failed')?.textContent).toContain('HTTP 404');
      expect(query('brand-kit-web-view-gaps')?.querySelectorAll('li')).toHaveLength(2);
      expect(query('brand-kit-web-view-report-notes')?.querySelectorAll('li')).toHaveLength(2);
    });

    it('says so where the run left nothing to report, and shows no count on Report', async () => {
      expect(query('brand-kit-web-view-report')?.querySelector('.p-badge')).toBeNull();
      await open('sources');

      expect(query('brand-kit-web-view-sources-failed-empty')).not.toBeNull();
      expect(query('brand-kit-web-view-gaps-empty')).not.toBeNull();
      expect(query('brand-kit-web-view-notes-empty')).not.toBeNull();
    });

    it('Download PDF marks the body for the print, asks the browser to print the book, and clears the mark when the print ends', async () => {
      button('brand-kit-web-view-download-pdf')?.click();
      await fixture.whenStable();

      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(true);
      expect(print).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('afterprint'));
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });

    it('Download PDF waits for the kit’s typeface in the kit’s weights before the dialog opens: the book is never laid out on screen', async () => {
      const load = vi.fn(() => Promise.resolve([]));
      Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
      try {
        button('brand-kit-web-view-download-pdf')?.click();
        await fixture.whenStable();

        expect(load.mock.calls).toEqual([['400 1em "Montserrat"'], ['700 1em "Montserrat"']]);
        expect(print).toHaveBeenCalledTimes(1);
      } finally {
        delete (document as unknown as Record<string, unknown>)['fonts'];
      }
    });

    it('clears the print mark when the view is destroyed with the dialog still up', async () => {
      button('brand-kit-web-view-download-pdf')?.click();
      await fixture.whenStable();
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(true);

      fixture.destroy();

      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });
  });

  describe('on the server', () => {
    beforeEach(async () => configure('server'));

    it('renders the page and the print-only book, and never prints', async () => {
      expect(query('brand-kit-web-view-panel-overview')).not.toBeNull();
      expect(query('brand-kit-web-view-print')?.querySelectorAll('.lfx-brand-kit-page')).toHaveLength(16);

      button('brand-kit-web-view-download-pdf')?.click();
      await fixture.whenStable();

      expect(print).not.toHaveBeenCalled();
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });
  });
});
