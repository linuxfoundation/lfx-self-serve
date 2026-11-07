// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { PLATFORM_ID, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ProjectContextService } from '@services/project-context.service';
import { BRAND_KIT_PRINT_BODY_CLASS, BRAND_KIT_PRINT_ONLY_CLASS, FOUNDATION_MESSAGE_PRINT_ONLY_CLASS } from '@lfx-one/shared/constants';
import { BrandKitRevision } from '@lfx-one/shared/interfaces';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgPrintService } from '@services/mktg-print.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { brandKitReportV2Fixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2.fixture';
import { brandKitReportV2RulesFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2-rules.fixture';
import { mktgAcceptedSnapshotOf } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { NEVER, of } from 'rxjs';
import { isMktgDocumentCommentAnchor, readMktgDocumentCommentField } from '@lfx-one/shared/utils';
import { provideMktgCommentsStub, mktgCommentScopeFixture } from '@shared/testing/mktg-comments-test-service';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { BrandKitWebViewComponent } from './brand-kit-web-view.component';

/** A logo uploaded to a CDN that names files by an opaque hash: one long unbroken token. */
const CDN_LOGO_URL = 'https://cdn.sanity.io/images/p4x9k2m1/production/0f3e9c2b8a7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f-838x203.svg';

/**
 * Locks the kit's web view (hand test, 18 Oct: the kit on screen as an app
 * page, the book for print): the framework view's header and keyboard tabs,
 * each tab rendered from a fixture kit, the built-from text with no URL, the
 * book in its print-only wrapper (never on screen), and Download PDF printing
 * it in an isolated frame, cleared after the print and on destroy, never
 * on the server.
 */
describe('BrandKitWebViewComponent', () => {
  const activeContext = signal({ slug: 'synthetic', name: 'Synthetic project' });
  let fixture: ComponentFixture<BrandKitWebViewComponent>;
  let print: ReturnType<typeof vi.spyOn>;
  let slidesExport: { last: Mock; start: Mock; poll: Mock };
  /** The Download PDF flag (#5302), pinned on so the PDF tests see today's screens; one test turns it off. */
  const pdfFlag = signal(true);

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => Array.from(host().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const button = (testId: string): HTMLButtonElement | null => query(testId)?.querySelector('button') ?? null;
  const tab = (id: string): HTMLButtonElement => query(`brand-kit-web-view-tab-${id}`) as HTMLButtonElement;
  const open = async (id: string): Promise<void> => {
    tab(id).click();
    await fixture.whenStable();
  };

  const configure = async (platformId: 'browser' | 'server', kit: BrandKitRevision = brandKitTestRevision(), url = '/'): Promise<void> => {
    activeContext.set({ slug: 'synthetic', name: 'Synthetic project' });
    pdfFlag.set(true);
    slidesExport = {
      last: vi.fn(() => of({ last: null, latestRevision: null })),
      start: vi.fn(() => of({ sessionId: 's', ownerToken: 't', revision: { id: 'r', number: 1, contentSha256: 'a' }, mode: 'create', logoNote: null })),
      poll: vi.fn(() => NEVER),
    };
    await TestBed.configureTestingModule({
      imports: [BrandKitWebViewComponent],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ProjectContextService, useValue: { activeContext } },
        provideNoopAnimations(),
        provideMktgCommentsStub({
          loaded: signal(true),
          selectedScope: signal({ ...mktgCommentScopeFixture(), agentKey: 'brand-kit' }),
          labelContent: signal(kit),
        }),
        { provide: PLATFORM_ID, useValue: platformId },
        provideMktgSlidesExportStub(slidesExport),
        { provide: MktgDependencyService, useValue: { documentsChanged$: NEVER } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => pdfFlag } },
      ],
    }).compileComponents();
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(BrandKitWebViewComponent);
    fixture.componentRef.setInput('kit', kit);
    // This fixture explicitly supplies the independently approved print payload.
    fixture.componentRef.setInput('approvedKit', kit);
    fixture.componentRef.setInput('approvedVersion', 1);
    fixture.componentRef.setInput('approvedCreatedAt', '2026-10-20T23:30:00Z');
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

  it('opts stored kits into string-only passage pins in original chapter order without changing artwork or print', async () => {
    const kit = brandKitTestRevision();
    const before = JSON.stringify(kit);
    await configure('browser', kit);
    expect(host().querySelector('lfx-mktg-field-comments')).toBeNull();
    fixture.componentRef.setInput('commentsEnabled', true);
    for (const id of ['logo', 'color', 'type', 'visual', 'usage', 'voice']) {
      await open(id);
      const pins = Array.from(host().querySelectorAll<HTMLElement>('[data-mktg-comment-field]'));
      expect(pins.length).toBeGreaterThan(0);
      for (const pin of pins) {
        const key = pin.getAttribute('data-mktg-comment-field') ?? '';
        const field = readMktgDocumentCommentField(kit, key);
        const group = pin.closest('[data-mktg-comment-group]');
        expect(group?.querySelectorAll('[data-mktg-comment-field]')).toHaveLength(1);
        expect(pin.classList.contains('font-sans')).toBe(true);
        expect(pin.classList.contains('text-gray-900')).toBe(true);
        expect(typeof field?.value).toBe('string');
        expect(field?.value).not.toBe('');
        expect(isMktgDocumentCommentAnchor('brand-kit', kit, { kind: 'passage', key })).toBe(true);
      }
      if (id === 'color') {
        expect(pins.filter((pin) => pin.getAttribute('data-mktg-comment-field')?.endsWith('.hex')).map((pin) => pin.parentElement?.textContent)).toEqual(
          kit.chapters.color.palette.map((entry) => expect.stringContaining(entry.hex))
        );
      }
    }
    expect(host().querySelector('[data-mktg-comment-field="chapters.voice.attributes[1].line"]')?.parentElement?.textContent).toContain('A number.');
    expect(query('brand-kit-web-view-print')?.querySelector('lfx-mktg-field-comments')).toBeNull();
    await open('sources');
    expect(host().querySelector('lfx-mktg-field-comments')).toBeNull();
    expect(JSON.stringify(kit)).toBe(before);
  });

  it('loads its URL tab and pushes one history entry per user switch', async () => {
    await configure('browser', brandKitTestRevision(), '/?project=synthetic&profile=edit&tab=logo');
    expect(tab('logo').getAttribute('aria-selected')).toBe('true');
    const push = vi.spyOn(TestBed.inject(Location), 'go');
    await open('color');
    expect(TestBed.inject(Router).url).toContain('tab=color');
    expect(TestBed.inject(Router).url).toContain('profile=edit');
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('focuses the opened panel start only after routed content renders', async () => {
    await configure('browser');
    const router = TestBed.inject(Router);
    const navigate = router.navigate.bind(router);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = vi.spyOn(router, 'navigate').mockImplementationOnce(async (...args) => {
      await gate;
      return navigate(...args);
    });
    tab('overview').focus();
    const before = document.activeElement;
    tab('color').click();
    await fixture.whenStable();
    expect(query('brand-kit-web-view-panel-color')).toBeNull();
    expect(document.activeElement).toBe(before);
    release();
    await pending.mock.results[0]?.value;
    await fixture.whenStable();
    const panel = query('brand-kit-web-view-panel-color');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
    expect(panel?.getAttribute('tabindex')).toBe('-1');
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
      expect(query('brand-kit-web-view-footer')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'PDF in portrait pages: logo, colour, typography, visual and voice. Export to Google Slides builds the kit as a deck in Google Drive, in the kit’s colours, typeface and logo.'
      );
    });

    it('hides Download PDF, the footer’s PDF sentence and the whole book while its flag is off, Export to Google Slides solid and alone, restoring today’s row when it turns on (#5302)', async () => {
      pdfFlag.set(false);
      await fixture.whenStable();
      const actions = query('brand-kit-web-view-actions');
      expect(button('brand-kit-web-view-download-pdf')).toBeNull();
      expect(Array.from(actions?.querySelectorAll('lfx-button') ?? [], (button) => button.textContent?.trim())).toEqual(['Export to Google Slides']);
      expect(button('brand-kit-web-view-export-slides')?.classList.contains('p-button-outlined')).toBe(false);
      expect(query('brand-kit-web-view-footer-pdf')).toBeNull();
      expect(query('brand-kit-web-view-footer')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Export to Google Slides builds the kit as a deck in Google Drive, in the kit’s colours, typeface and logo.'
      );
      // Nothing of the book is in the page without the flag: neither the button nor the print-only wrapper and its frames.
      expect(query('brand-kit-web-view-print')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('[data-testid="lfx-mktg-portrait-page"]')).toHaveLength(0);
      pdfFlag.set(true);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-print')).not.toBeNull();
      expect(Array.from(actions?.querySelectorAll('lfx-button') ?? [], (button) => button.textContent?.trim())).toEqual([
        'Export to Google Slides',
        'Download PDF',
      ]);
      expect(button('brand-kit-web-view-export-slides')?.classList.contains('p-button-outlined')).toBe(true);
      expect(button('brand-kit-web-view-download-pdf')?.classList.contains('p-button-outlined')).toBe(false);
      expect(query('brand-kit-web-view-footer')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'PDF in portrait pages: logo, colour, typography, visual and voice. Export to Google Slides builds the kit as a deck in Google Drive, in the kit’s colours, typeface and logo.'
      );
    });

    it('replaces draft exports with a quiet explanation and restores Slides then solid PDF on approval', async () => {
      fixture.componentRef.setInput('viewingDraft', true);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-approval-required')?.textContent).toBe('Export is available once this version is approved');
      expect(button('brand-kit-web-view-download-pdf')).toBeNull();
      expect(button('brand-kit-web-view-export-slides')).toBeNull();
      fixture.componentRef.setInput('viewingDraft', false);
      await fixture.whenStable();
      const actions = query('brand-kit-web-view-actions');
      expect(Array.from(actions?.querySelectorAll('lfx-button') ?? [], (button) => button.textContent?.trim())).toEqual([
        'Export to Google Slides',
        'Download PDF',
      ]);
      expect(button('brand-kit-web-view-export-slides')?.classList.contains('p-button-outlined')).toBe(true);
      expect(button('brand-kit-web-view-download-pdf')?.classList.contains('p-button-outlined')).toBe(false);
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
      expect(query('mktg-brand-kit-print')?.getAttribute('data-revision')).toBe('V1.0');
      // The book's cover names the approved revision it prints, not the Draft on screen.
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
      expect(query('mktg-brand-kit-print')?.getAttribute('data-revision')).toBe('V1.0');
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

    it('prints the active project identity and local chapter numbers, not kit-content identity or family prefixes', async () => {
      const wrapper = query('brand-kit-web-view-print');
      const head = () => wrapper?.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent;
      expect(head()).toContain('Synthetic project brand kit');
      expect(head()).not.toContain('Project One');
      // The running heads number the kit's own chapters from 01, with no family prefix.
      const sections = Array.from(wrapper?.querySelectorAll('[data-testid="mktg-portrait-page-section"]') ?? [], (span) => span.textContent?.trim());
      expect([...new Set(sections)]).toEqual(['Contents', '01 Logo', '02 Color', '03 Type', '04 Visual', '05 Usage', '06 Voice', '07 Sources']);
      activeContext.set({ slug: 'synthetic', name: 'Updated project context' });
      await fixture.whenStable();
      expect(head()).toContain('Updated project context brand kit');
      expect(wrapper?.querySelector('[data-testid="mktg-brand-kit-print"]')?.getAttribute('data-revision')).toBe('V1.0');
    });

    it('keeps the portrait book in the print-only wrapper without changing screen content', () => {
      const wrapper = query('brand-kit-web-view-print');
      expect(wrapper?.classList.contains(BRAND_KIT_PRINT_ONLY_CLASS)).toBe(true);
      expect(wrapper?.classList.contains(FOUNDATION_MESSAGE_PRINT_ONLY_CLASS)).toBe(true);
      // The kit's portrait book: one frame per plan page (the synthetic kit has no symbol, so sixteen), on the portrait root.
      expect(wrapper?.querySelector('.lfx-brand-kit-portrait.lfx-mktg-portrait')).not.toBeNull();
      expect(wrapper?.querySelectorAll('lfx-mktg-brand-kit-print [data-testid="lfx-mktg-portrait-page"]')).toHaveLength(16);
      expect(wrapper?.querySelectorAll('lfx-mktg-brand-kit-print [data-testid="mktg-portrait-page-head"]')).toHaveLength(14);
      expect(host().querySelectorAll('.lfx-brand-kit-page')).toHaveLength(0);
      expect(host().querySelector(`.${BRAND_KIT_PRINT_ONLY_CLASS}`)?.contains(query('mktg-brand-kit-print'))).toBe(true);
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

    it('Overview: six plain chapter cards, with navigation only through the tabs', async () => {
      expect(query('brand-kit-web-view-built-from')?.textContent).toContain('Built from the logo file logo.svg, the messaging framework');
      expect(query('brand-kit-web-view-glance')?.querySelector('img')?.getAttribute('alt')).toBe('Primary lockup — logo.svg');
      const chapters = Array.from(query('brand-kit-web-view-chapters')?.querySelectorAll('article') ?? []);
      expect(chapters.map((chapter) => chapter.getAttribute('data-testid'))).toEqual(
        ['logo', 'color', 'type', 'visual', 'usage', 'voice'].map((id) => `brand-kit-web-view-chapter-${id}`)
      );
      expect(query('brand-kit-web-view-chapter-color')?.textContent).toContain('Charcoal and white carry the brand.');

      expect(host().querySelector('[data-testid^="brand-kit-web-view-open-"]')).toBeNull();
      tab('color').click();
      await fixture.whenStable();
      expect(tab('color').getAttribute('aria-selected')).toBe('true');
      expect(query('brand-kit-web-view-panel-color')).not.toBeNull();
      // Selecting a chapter tab moves focus to the new panel's start.
      expect(document.activeElement).toBe(query('brand-kit-web-view-panel-color'));
    });

    it('Overview: a pill under each chapter’s title says where its rules come from — the project, the LF reference, or how many of them the reference supplied', async () => {
      const kit = brandKitTestRevision();
      kit.report = brandKitReportV2RulesFixture();
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();
      const pills = Object.fromEntries(
        ['logo', 'color', 'type', 'visual', 'usage', 'voice'].map((id) => [id, query(`brand-kit-web-view-chapter-basis-${id}`)?.textContent?.trim() ?? null])
      );
      expect(pills).toEqual({
        logo: 'LF reference default for 20 of 21 rules',
        color: 'LF reference default for 4 of 5 rules',
        type: 'LF reference default for 5 of 11 rules',
        visual: 'LF reference default',
        usage: 'LF reference default',
        voice: 'LF reference default for 1 of 8 rules',
      });
      // The pill sits in its own row right under the chapter's heading row (title and number only), in the mode pill's style.
      const heading = query('brand-kit-web-view-chapter-logo')?.querySelector('div');
      expect(heading?.textContent).toContain('01');
      expect(heading?.contains(query('brand-kit-web-view-chapter-basis-logo'))).toBe(false);
      expect(heading?.nextElementSibling?.contains(query('brand-kit-web-view-chapter-basis-logo'))).toBe(true);
      expect(query('brand-kit-web-view-chapter-basis-logo')?.className).toBe('rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600');
      expect(query('brand-kit-web-view-panel-overview')?.textContent).not.toContain('chapters.');
    });

    it('Overview: no basis pill for a v1 report, nor for a chapter the report lists no rule for', async () => {
      expect(host().querySelector('[data-testid^="brand-kit-web-view-chapter-basis-"]')).toBeNull();
      const kit = brandKitTestRevision();
      kit.report = { ...kit.report, version: 2, rules: [{ path: 'chapters.voice', basis: 'project' }] };
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();
      expect(queryAll('brand-kit-web-view-chapter-basis-voice').map((pill) => pill.textContent?.trim())).toEqual(['From the project']);
      expect(host().querySelectorAll('[data-testid^="brand-kit-web-view-chapter-basis-"]')).toHaveLength(1);
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
      // The reversed tile sits on the kit's dark; the fixture's three-colour lockup cannot be reversed by filter (it
      // would flatten), so the tile says "Not supplied" instead of a filtered image.
      const reversed = colorways[1].firstElementChild as HTMLElement;
      expect(reversed.style.background).toContain('rgb(77, 78, 78)');
      expect((reversed.firstElementChild as HTMLElement).style.filter).toBe('');
      expect(reversed.textContent?.trim()).toBe('Not supplied');
      expect(reversed.querySelector('img')).toBeNull();
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

    it('Visual: the board’s sample icons in the kit’s colours above the iconography rules and the recommended set, the imagery rule and what to avoid, the graphic elements in the kit’s colours', async () => {
      await open('visual');

      const icons = query('brand-kit-web-view-icons');
      expect(icons?.textContent).toContain('Line.');
      expect(icons?.textContent).toContain('Label.');
      expect(icons?.querySelectorAll('i')).toHaveLength(0);
      expect(icons?.textContent).toContain('Recommended set: Lucide');
      // The samples sit between the title and the rules; the rules and the caption keep their comment fields.
      const samples = icons?.querySelector<HTMLElement>('[data-testid="brand-kit-icon-samples"]');
      expect(samples?.previousElementSibling?.tagName).toBe('H3');
      expect(samples?.nextElementSibling?.tagName).toBe('UL');
      // Hand-test feedback 1: a clear gap above the rules (the card's gap-2 + mt-3), the rules close together: each rule's
      // comment affordance floats at the right end of the rule's first line (never a row of its own), its empty count hidden,
      // back to a block under the text while its composer is open; a clearfix keeps the float inside the list item.
      const rules = samples?.nextElementSibling;
      for (const cls of ['mt-3', 'gap-0.5', 'leading-snug', 'list-disc']) {
        expect(rules?.classList.contains(cls)).toBe(true);
      }
      expect(rules?.classList.contains('gap-1')).toBe(false);
      const ruleItems = Array.from(rules?.querySelectorAll<HTMLElement>(':scope > li') ?? []);
      expect(ruleItems).toHaveLength(brandKitTestRevision().chapters.visual.icons.rules.length);
      for (const item of ruleItems) {
        expect(item.classList.contains('group/commentfield')).toBe(true);
        expect(item.hasAttribute('data-mktg-comment-group')).toBe(true);
        for (const cls of [
          '[&>lfx-mktg-field-comments]:float-right',
          '[&>lfx-mktg-field-comments]:ml-2',
          '[&_[data-testid=mktg-field-comment-count].invisible]:hidden',
          '[&>lfx-mktg-field-comments:has([data-testid=mktg-field-comment-composer])]:float-none',
          '[&>lfx-mktg-field-comments:has([data-testid=mktg-field-comment-composer])]:block',
          '[&>lfx-mktg-field-comments:has([data-testid=mktg-field-comment-composer])]:ml-0',
          'after:block',
          'after:clear-both',
          "after:content-['']",
        ]) {
          expect(item.classList.contains(cls)).toBe(true);
        }
        expect(item.classList.contains('flow-root')).toBe(false);
        expect(Array.from(item.classList).some((cls) => /inline-block|flex/.test(cls))).toBe(false);
        expect(item.querySelector('.flex, .flex-wrap')).toBeNull();
        expect(item.children).toHaveLength(0);
      }
      // With comments on, the affordance is the list item's direct child, in the text's flow after it.
      fixture.componentRef.setInput('commentsEnabled', true);
      await fixture.whenStable();
      for (const item of ruleItems) {
        expect(Array.from(item.children, (child) => child.tagName.toLowerCase())).toEqual(['lfx-mktg-field-comments']);
        expect(item.firstChild?.textContent?.trim().length).toBeGreaterThan(0);
      }
      expect(samples?.querySelectorAll('[data-testid^="brand-kit-icon-tile-"]')).toHaveLength(8);
      expect(samples?.querySelectorAll('[data-testid^="brand-kit-icon-strip-"]')).toHaveLength(8);
      expect(samples?.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tile-documents"]')?.textContent?.trim()).toBe('Documents');
      const inkProbe = document.createElement('span');
      inkProbe.style.color = brandKitTestRevision().kit.dark;
      expect(samples?.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tile-documents"]')?.style.color).toBe(inkProbe.style.color);
      expect(samples?.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]')?.style.backgroundColor).toBe(inkProbe.style.color);
      const highlightProbe = document.createElement('span');
      highlightProbe.style.color = brandKitTestRevision().kit.spark;
      const highlighted = samples?.querySelector<HTMLElement>('[data-highlight="true"]');
      expect(highlighted?.getAttribute('data-testid')).toBe('brand-kit-icon-strip-global');
      expect(highlighted?.style.color).toBe(highlightProbe.style.color);
      expect(icons?.querySelectorAll('[data-mktg-comment-group]').length).toBe(brandKitTestRevision().chapters.visual.icons.rules.length + 1);
      expect(query('brand-kit-web-view-imagery')?.textContent).toContain('Structure.');
      expect(query('brand-kit-web-view-imagery')?.textContent).toContain('Hackers');
      expect(query('brand-kit-web-view-elements')?.textContent).toContain('Primary button');
      // The renderer's Primary button: the kit's dark fill with white text, never white on an accent that fails AA.
      const primary = Array.from(query('brand-kit-web-view-elements')?.querySelectorAll<HTMLElement>('span') ?? []).find(
        (span) => span.textContent === 'Primary button'
      );
      const probe = document.createElement('span');
      probe.style.background = brandKitTestRevision().kit.dark;
      expect(primary?.style.background).toBe(probe.style.background);
      expect(primary?.classList.contains('text-white')).toBe(true);
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

    it('Sources and gaps stays reachable through its tab without a duplicate Report control', async () => {
      const kit = brandKitTestRevision();
      kit.report = {
        sources_read: ['https://one.example.org', 'logo.svg'],
        sources_failed: [{ name: 'https://one.example.org/brand', reason: 'HTTP 404' }],
        gaps: ['No stacked lockup was given.', 'The brand page could not be read.'],
        notes: 'Two files were read.\nThe accent is from the CSS.',
      };
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();
      expect(query('brand-kit-web-view-report')).toBeNull();
      expect(tab('sources').textContent?.trim()).toBe('Sources and gaps (3)');

      tab('sources').click();
      await fixture.whenStable();

      expect(tab('sources').getAttribute('aria-selected')).toBe('true');
      expect(query('brand-kit-web-view-sources-read')?.textContent).toContain('logo.svg');
      expect(query('brand-kit-web-view-sources-failed')?.textContent).toContain('HTTP 404');
      expect(query('brand-kit-web-view-gaps')?.querySelectorAll('li')).toHaveLength(2);
      expect(query('brand-kit-web-view-gaps-accepted')).toBeNull();
      expect(query('brand-kit-web-view-report-notes')?.querySelectorAll('li')).toHaveLength(2);
    });

    it('says under an approved revision’s gaps that they were accepted at that approval and are still open', async () => {
      const kit = brandKitTestRevision();
      kit.report = { ...kit.report, gaps: ['No stacked lockup was given.'] };
      fixture.componentRef.setInput('kit', kit);
      fixture.componentRef.setInput('version', 3);
      fixture.componentRef.setInput('approval', { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: null } });
      await open('sources');

      expect(query('brand-kit-web-view-gaps')?.querySelectorAll('li')).toHaveLength(1);
      expect(query('brand-kit-web-view-gaps-accepted')?.textContent?.trim()).toBe('Accepted when v3 was approved; still open.');
    });

    it('shows a v2 report’s findings in the agent’s words: failed sources, missing assets, warnings and colour conflicts', async () => {
      const kit = brandKitTestRevision();
      const v2 = brandKitReportV2Fixture();
      kit.report = v2;
      fixture.componentRef.setInput('kit', kit);
      await fixture.whenStable();
      expect(tab('sources').textContent?.trim()).toBe(`Sources and gaps (${v2.gaps.length + (v2.findings?.sources_failed.length ?? 0)})`);
      await open('sources');

      const failed = query('brand-kit-web-view-sources-failed');
      expect(failed?.querySelectorAll('li')).toHaveLength(v2.findings?.sources_failed.length ?? 0);
      expect(failed?.textContent).toContain(v2.findings?.sources_failed[0].source ?? 'fixture');
      expect(failed?.textContent).toContain('This page does not exist on the site (the server answered 404).');
      expect(failed?.textContent).toContain('HTTP 404');
      const missing = query('brand-kit-web-view-missing-assets');
      expect(Array.from(missing?.querySelectorAll('li') ?? []).map((item) => item.firstElementChild?.textContent?.trim())).toEqual([
        'Primary logo',
        'Stacked logo',
        'Symbol',
        'Reversed logo',
      ]);
      const stacked = v2.findings?.missing_assets[1];
      expect(stacked?.fix).toBeTruthy();
      expect(missing?.textContent).toContain(stacked?.reason ?? 'fixture');
      expect(missing?.textContent).toContain(`Fix: ${stacked?.fix}`);
      const warnings = query('brand-kit-web-view-warnings');
      expect(warnings?.querySelectorAll('li')).toHaveLength(v2.findings?.warnings.length ?? 0);
      expect(warnings?.textContent).toContain(v2.findings?.warnings[0].text ?? 'fixture');
      expect(Array.from(warnings?.querySelectorAll('a') ?? []).map((link) => link.getAttribute('href'))).toEqual(
        v2.findings?.warnings.map((warning) => warning.source)
      );
      const conflicts = query('brand-kit-web-view-color-conflicts');
      const conflictList = v2.color_conflicts ?? [];
      expect(conflicts?.querySelectorAll(':scope > li')).toHaveLength(conflictList.length);
      expect(conflicts?.textContent).toContain('Coral');
      expect(conflicts?.textContent).toContain('#FF7D2D');
      for (const conflict of conflictList) expect(conflicts?.textContent).toContain(`kept ${conflict.chosen}`);
      const swatches = Array.from(conflicts?.querySelectorAll('[data-testid^="brand-kit-web-view-swatch-"]') ?? []) as HTMLElement[];
      expect(swatches).toHaveLength(conflictList.reduce((count, conflict) => count + conflict.values.length, 0));
      // The Colour chapter's swatch card at list size: the hex sits on its own ground.
      expect(swatches[0].closest('li')?.className).toContain('rounded-xl');
      expect(swatches[0].textContent?.trim()).toBe(conflictList[0].values[0].hex);
      expect(query('brand-kit-web-view-panel-sources')?.textContent).not.toContain('lf-reference');
      expect(query('brand-kit-web-view-accepted')).toBeNull();
    });

    it('shows a v1 report’s legacy failed list in the Failed sources group and the empty lines in the others', async () => {
      const kit = brandKitTestRevision();
      kit.report = { ...kit.report, sources_failed: [{ name: 'https://one.example.org/brand', reason: 'HTTP 404' }] };
      fixture.componentRef.setInput('kit', kit);
      await open('sources');

      expect(query('brand-kit-web-view-sources-failed')?.textContent).toContain('HTTP 404');
      expect(query('brand-kit-web-view-missing-assets-empty')?.textContent?.trim()).toBe('Nothing is missing.');
      expect(query('brand-kit-web-view-warnings-empty')?.textContent?.trim()).toBe('No warnings.');
      expect(query('brand-kit-web-view-color-conflicts-empty')?.textContent?.trim()).toBe('No colour conflicts.');
    });

    it('marks each item the approval’s snapshot lists with when it was accepted, and leaves newer items unmarked', async () => {
      const kit = brandKitTestRevision();
      const report = brandKitReportV2Fixture();
      const accepted = mktgAcceptedSnapshotOf(report);
      report.findings?.warnings.push({ code: 'font_unverified', text: 'The typeface could not be verified.' });
      kit.report = report;
      fixture.componentRef.setInput('kit', kit);
      fixture.componentRef.setInput('version', 4);
      fixture.componentRef.setInput('approval', { approvedAt: '2026-11-04T10:00:00Z', approvedBy: { name: null }, accepted });
      await open('sources');

      const markers = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="brand-kit-web-view-accepted"]')) as HTMLElement[];
      // Every item the snapshot lists, and not the warning added since.
      const listed = Object.values(accepted).reduce((count, keys) => count + keys.length, 0);
      expect(markers).toHaveLength(listed);
      expect(new Set(markers.map((marker) => marker.textContent?.trim()))).toEqual(new Set(['Accepted when v4 was approved']));
      expect(query('brand-kit-web-view-warnings')?.querySelectorAll('li')).toHaveLength(accepted.warnings.length + 1);
      expect(query('brand-kit-web-view-warnings')?.querySelectorAll('[data-testid="brand-kit-web-view-accepted"]')).toHaveLength(accepted.warnings.length);
      // The per-item markers replace the derived line.
      expect(query('brand-kit-web-view-gaps-accepted')).toBeNull();
    });

    it('says so where the run left nothing to report, and leaves the Sources and gaps tab uncounted', async () => {
      expect(query('brand-kit-web-view-report')).toBeNull();
      expect(tab('sources').textContent?.trim()).toBe('Sources and gaps');
      await open('sources');

      expect(query('brand-kit-web-view-sources-failed-empty')?.textContent?.trim()).toBe('No source failed.');
      expect(query('brand-kit-web-view-gaps-empty')).not.toBeNull();
      expect(query('brand-kit-web-view-notes-empty')).not.toBeNull();
    });

    it('Download PDF creates the isolated print frame in the click task and clears it when printing ends', async () => {
      button('brand-kit-web-view-download-pdf')?.click();
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="lfx-print-frame"]');
      expect(frame?.contentDocument?.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(true);
      expect(frame?.contentDocument?.querySelector('lfx-mktg-brand-kit-print')).not.toBeNull();
      // The frame's title names the saved PDF like the deck: the project, the asset, the approved revision and that revision's own date.
      expect(frame?.contentDocument?.title).toBe('Synthetic project · Brand kit · v1 · 2026-10-20');
      expect(frame?.contentDocument?.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toContain('Synthetic project brand kit');
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
      expect(print).not.toHaveBeenCalled();

      frame?.contentWindow?.dispatchEvent(new Event('afterprint'));
      expect(frame?.isConnected).toBe(false);
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });

    it('prints the approved revision’s own approval, not the viewed revision’s, on the contents page', async () => {
      // Viewing a later draft (v2) of a kit whose approved current is v1: the PDF's approval line is v1's record.
      fixture.componentRef.setInput('version', 2);
      fixture.componentRef.setInput('approval', null);
      fixture.componentRef.setInput('approvedVersion', 1);
      fixture.componentRef.setInput('approvedApproval', { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } });
      await fixture.whenStable();
      button('brand-kit-web-view-download-pdf')?.click();
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="lfx-print-frame"]');
      expect(frame?.contentDocument?.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe(
        'Approved 19 Oct 2026 by Synthetic Approver'
      );
      frame?.contentWindow?.dispatchEvent(new Event('afterprint'));
    });

    it('prepares the kit typeface ahead of creating the PDF frame in the click task', async () => {
      const prepare = vi.spyOn(TestBed.inject(MktgPrintService), 'prepare').mockResolvedValue(undefined);
      try {
        const kit = brandKitTestRevision();
        fixture.componentRef.setInput('approvedKit', { ...kit, chapters: { ...kit.chapters, type: { ...kit.chapters.type, family: 'Synthetic Font' } } });
        await fixture.whenStable();
        expect(print).not.toHaveBeenCalled();
        expect(prepare).toHaveBeenCalledWith('Synthetic Font', [400, 700]);
        button('brand-kit-web-view-download-pdf')?.click();
        expect(document.querySelector('[data-testid="lfx-print-frame"]')).not.toBeNull();
        expect(print).not.toHaveBeenCalled();
      } finally {
        prepare.mockRestore();
      }
    });

    it('clears the isolated print frame when the view is destroyed with the dialog still up', async () => {
      button('brand-kit-web-view-download-pdf')?.click();
      await fixture.whenStable();
      expect(document.querySelector('[data-testid="lfx-print-frame"]')).not.toBeNull();
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);

      fixture.destroy();

      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
      expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
    });
  });

  describe('on the server', () => {
    beforeEach(async () => configure('server'));

    it('renders the page and the hidden portrait book, and never prints on the server', async () => {
      expect(query('brand-kit-web-view-panel-overview')).not.toBeNull();
      expect(query('brand-kit-web-view-print')?.querySelectorAll('lfx-mktg-brand-kit-print [data-testid="lfx-mktg-portrait-page"]')).toHaveLength(16);

      button('brand-kit-web-view-download-pdf')?.click();
      await fixture.whenStable();

      expect(print).not.toHaveBeenCalled();
      expect(document.body.classList.contains(BRAND_KIT_PRINT_BODY_CLASS)).toBe(false);
    });
  });
});
