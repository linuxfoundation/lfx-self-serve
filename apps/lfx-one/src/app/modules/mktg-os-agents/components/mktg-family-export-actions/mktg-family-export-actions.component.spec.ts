// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MktgFamilyExportLastResponse, MktgFamilyExportRunUpdate, MktgFamilyPrintView } from '@lfx-one/shared/interfaces';
import {
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_FAMILY_PRINT_ONLY_CLASS,
  MKTG_SLIDES_EXPORT_START_MESSAGES,
  MKTG_FAMILY_EXPORT_HIGHLIGHT_MS,
  MKTG_FAMILY_EXPORT_FORMAT_HINT,
} from '@lfx-one/shared/constants';
import { MktgFamilyExportService } from '@services/mktg-family-export.service';
import { MktgPrintService } from '@services/mktg-print.service';
import { ProjectContextService } from '@services/project-context.service';
import { familyExportMember, familyExportRecord } from '@shared/testing/mktg-family-export-test-data';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgBrandKitPrintComponent } from '../../mktg-brand-kit-print/mktg-brand-kit-print.component';
import { MktgFamilyExportActionsComponent } from './mktg-family-export-actions.component';
import {
  boilerplatesAssetOfRevision,
  buildBoilerplatesPrintView,
  buildBrandKitBookView,
  buildFaqPrintView,
  buildFoundationMessagePrintView,
  faqAssetOfRevision,
  mktgBrandKitBookPageCount,
  mktgPrintBrand,
} from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import boilerplatesEnvelope from '@lfx-one/shared/utils/__fixtures__/boilerplates.envelope.json';
import faqEnvelope from '@lfx-one/shared/utils/__fixtures__/faq-envelope.json';

describe('Family export slot', () => {
  const writer = signal(true);
  const activeContext = signal({ uid: 'synthetic-project', name: 'Synthetic project' });
  let run: Subject<MktgFamilyExportRunUpdate>;
  const lookup = (): MktgFamilyExportLastResponse => ({
    last: null,
    currentMembers: [familyExportMember()],
    skippedMembers: ['brand-kit', 'boilerplates', 'faq'],
    stale: false,
  });
  const api = { last: vi.fn(), running: vi.fn(), run: vi.fn(), printView: vi.fn() };
  const print = { prepare: vi.fn(), printNow: vi.fn(), clear: vi.fn(), ensureFontStylesheet: vi.fn() };
  /** The frame's title names the saved PDF like the deck: the project, the family, the newest member revision's date; no version, as the family binds several revisions. */
  const pdfTitle = 'Synthetic project · Positioning & brand · 2026-10-21';
  beforeEach(() => {
    vi.clearAllMocks();
    writer.set(true);
    activeContext.set({ uid: 'synthetic-project', name: 'Synthetic project' });
    run = new Subject();
    api.last.mockReturnValue(of(lookup()));
    api.running.mockReturnValue(null);
    api.run.mockReturnValue(run);
    api.printView.mockReturnValue(
      of({
        framework: null,
        kit: null,
        boilerplates: null,
        faq: null,
        brand: mktgPrintBrand(null),
        projectName: 'Synthetic project',
        printedAt: '2026-10-28T00:00:00Z',
        newestRevisionAt: '2026-10-21T10:00:00Z',
        revisionNumbers: {},
        fontFamily: null,
        weights: [400],
      })
    );
    print.prepare.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [MktgFamilyExportActionsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext, canWrite: writer } },
        { provide: MktgFamilyExportService, useValue: api },
        { provide: MktgPrintService, useValue: print },
      ],
    });
  });
  async function setup() {
    const fixture = TestBed.createComponent(MktgFamilyExportActionsComponent);
    fixture.componentRef.setInput('familyId', 'positioning-brand');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const button = (id: string) => root.querySelector<HTMLButtonElement>(`[data-testid="family-export-${id}"] button`);
    return { fixture, root, button };
  }

  it('eagerly checks last export and starts create only when there is no earlier deck', async () => {
    const { fixture, root, button } = await setup();
    expect(api.last).toHaveBeenCalledWith({ project: 'synthetic-project', familyId: 'positioning-brand' }, true);
    expect(root.querySelector('h2')?.textContent).toBe('Export the family');
    expect(root.textContent).toContain('Google Slides: framework, brand kit, boilerplates and FAQ (approved current).');
    expect(root.textContent).toContain('PDF: framework, brand kit, boilerplates and FAQ (approved current).');
    for (const action of ['pdf', 'slides']) expect(button(action)?.classList.contains('p-button-outlined')).toBe(true);
    button('slides')?.click();
    await fixture.whenStable();
    expect(api.run).toHaveBeenCalledWith({ project: 'synthetic-project', familyId: 'positioning-brand' }, 'create');
    run.next({ mode: 'create', logoNote: null, skippedMembers: [], result: null });
    await fixture.whenStable();
    expect(root.textContent).toContain('Exporting the family');
    expect(button('slides')?.disabled).toBe(true);
    run.next({ mode: 'create', logoNote: null, skippedMembers: [], result: { status: 'ready', record: familyExportRecord() } });
    await fixture.whenStable();
    expect(root.textContent).toContain('Your deck is ready');
    expect(root.querySelector('[data-testid="family-export-last-link"]')?.getAttribute('href')).toBe(familyExportRecord().link);
  });

  it.each(['update', 'create'] as const)('offers both choices and honours %s with existing revision details and stale status', async (mode) => {
    api.last.mockReturnValue(of({ ...lookup(), last: familyExportRecord(), stale: true }));
    const { fixture, root, button } = await setup();
    expect(root.textContent).toContain('v1');
    expect(root.textContent).toContain('Out of date');
    button('slides')?.click();
    await fixture.whenStable();
    expect(button('update')).not.toBeNull();
    expect(button('create')).not.toBeNull();
    button(mode)?.click();
    await fixture.whenStable();
    expect(api.run).toHaveBeenCalledWith(expect.anything(), mode);
    api.last.mockReturnValue(new Subject<MktgFamilyExportLastResponse>());
    run.next({ mode, logoNote: null, skippedMembers: [], result: { status: 'ready', record: familyExportRecord() } });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-stale"]')).toBeNull();
    expect(root.textContent).toContain('Your deck is ready');
  });

  it('disables actions during lookup and after failure; retry checks again instead of guessing Create', async () => {
    const pending = new Subject<MktgFamilyExportLastResponse>();
    api.last.mockReturnValue(pending);
    const { fixture, root, button } = await setup();
    expect(button('slides')?.disabled).toBe(true);
    expect(root.textContent).toContain('Checking approved assets');
    pending.error(new Error('Synthetic lookup failure'));
    await fixture.whenStable();
    expect(button('slides')?.disabled).toBe(true);
    expect(root.textContent).toContain('no second deck');
    api.last.mockReturnValue(of(lookup()));
    button('check-again')?.click();
    await fixture.whenStable();
    expect(api.last).toHaveBeenLastCalledWith(expect.anything(), true);
    expect(button('slides')?.disabled).toBe(false);
  });

  it('shows approval-empty and reader-disabled states without calling the exporter', async () => {
    api.last.mockReturnValue(of({ ...lookup(), currentMembers: [] }));
    const { fixture, root, button } = await setup();
    expect(root.textContent).toContain('Available once the framework is approved: PDF and Slides use the approved current.');
    expect(button('pdf')?.disabled).toBe(true);
    writer.set(false);
    await fixture.whenStable();
    expect(root.textContent).toContain('You need write access');
    expect(button('slides')?.disabled).toBe(true);
    expect(root.querySelector('[role="note"]')).toBeNull();
    expect(root.querySelector('[pTooltip]')).toBeNull();
    expect(api.run).not.toHaveBeenCalled();
  });

  it('scrolls to the slot and focuses Download PDF only after lookup and PDF preparation finish', async () => {
    let ready: () => void = () => undefined;
    print.prepare.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
    const pending = new Subject<MktgFamilyExportLastResponse>();
    api.last.mockReturnValue(pending);
    const { fixture, root, button } = await setup();
    root.scrollIntoView = vi.fn();
    const pdf = button('pdf');
    if (!pdf) throw new Error('Missing synthetic PDF action');
    const focus = vi.spyOn(pdf, 'focus');
    fixture.componentInstance.focusDownload();
    await fixture.whenStable();
    expect(root.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focus).not.toHaveBeenCalled();
    pending.next(lookup());
    await fixture.whenStable();
    expect(button('pdf')?.disabled).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    expect(fixture.componentInstance['focusRequested']()).toBe(true);
    ready();
    await Promise.resolve();
    await fixture.whenStable();
    expect(button('pdf')?.disabled).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(api.run).not.toHaveBeenCalled();
    expect(api.printView).toHaveBeenCalledOnce();
    expect(print.printNow).not.toHaveBeenCalled();
  });

  it.each([false, true])('reveals format choices with temporary paint, focus and no export (reduced motion: %s)', async (reduced) => {
    const { fixture, root, button } = await setup();
    root.scrollIntoView = vi.fn();
    vi.spyOn(root, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    expect(fixture.componentInstance.isRendered()).toBe(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: reduced }))
    );
    const pdf = button('pdf');
    if (!pdf) throw new Error('Missing synthetic PDF action');
    const focus = vi.spyOn(pdf, 'focus');
    try {
      fixture.componentInstance.focusDownload();
      await fixture.whenStable();
      expect(root.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      expect(root.querySelector('section')?.classList.contains('lfx-mktg-export-highlight')).toBe(true);
      expect(root.querySelector('[data-testid="family-export-format-hint"]')?.textContent).toBe(MKTG_FAMILY_EXPORT_FORMAT_HINT);
      expect(focus).toHaveBeenCalledOnce();
      expect(api.run).not.toHaveBeenCalled();
      expect(api.printView).toHaveBeenCalledOnce();
      expect(print.printNow).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, MKTG_FAMILY_EXPORT_HIGHLIGHT_MS + 20));
      await fixture.whenStable();
      expect(root.querySelector('section')?.classList.contains('lfx-mktg-export-highlight')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('focuses an already printable PDF on request without a reason line', async () => {
    const { fixture, root, button } = await setup();
    root.scrollIntoView = vi.fn();
    const pdf = button('pdf');
    if (!pdf) throw new Error('Missing synthetic PDF action');
    const focus = vi.spyOn(pdf, 'focus');
    fixture.componentInstance.focusDownload();
    await fixture.whenStable();
    expect(focus).toHaveBeenCalledOnce();
    expect(root.querySelector('[data-testid="family-export-pdf-reason"]')).toBeNull();
  });
  it('expires a focus request when lookup settles without an approved asset', async () => {
    const pending = new Subject<MktgFamilyExportLastResponse>();
    api.last.mockReturnValue(pending);
    const { fixture, root, button } = await setup();
    root.scrollIntoView = vi.fn();
    const pdf = button('pdf');
    if (!pdf) throw new Error('Missing synthetic PDF action');
    const focus = vi.spyOn(pdf, 'focus');
    fixture.componentInstance.focusDownload();
    await fixture.whenStable();
    pending.next({ ...lookup(), currentMembers: [] });
    await fixture.whenStable();
    expect(fixture.componentInstance['focusRequested']()).toBe(false);
    expect(root.querySelector('[data-testid="family-export-empty"]')?.textContent).toContain('Available once the framework is approved');
    pending.next(lookup());
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-pdf-reason"]')).toBeNull();
    expect(focus).not.toHaveBeenCalled();
  });
  it('shows failures and allows another export without leaving a spinner', async () => {
    const { fixture, root, button } = await setup();
    button('slides')?.click();
    run.next({
      mode: 'create',
      skippedMembers: [],
      logoNote: null,
      result: { status: 'failed', failure: 'google', message: 'Synthetic export failure.', deckLink: null },
    });
    await fixture.whenStable();
    expect(root.textContent).toContain('Synthetic export failure.');
    expect(button('slides')?.disabled).toBe(false);
  });

  it.each(['family', 'project', 'writer'])('clears an incomplete deck link when the %s scope changes', async (scope) => {
    const { fixture, root, button } = await setup();
    const link = familyExportRecord().link;
    button('slides')?.click();
    run.next({
      mode: 'create',
      skippedMembers: [],
      logoNote: null,
      result: { status: 'failed', failure: 'google', message: 'Synthetic export failure.', deckLink: link },
    });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-partial"]')?.getAttribute('href')).toBe(link);

    if (scope === 'family') fixture.componentRef.setInput('familyId', 'synthetic-unsupported-family');
    if (scope === 'project') activeContext.set({ uid: 'synthetic-other-project', name: 'Synthetic other project' });
    if (scope === 'writer') writer.set(false);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-partial"]')).toBeNull();
    expect(root.textContent).not.toContain('Synthetic export failure.');
  });

  it.each(['FAMILY_NOTHING_APPROVED', 'FAMILY_ASSET_UNREADABLE'])('shows the family-specific 409 message for %s', async (code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.run.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code } })));
    const { fixture, root, button } = await setup();
    button('slides')?.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-error"]')?.textContent).toBe(MKTG_SLIDES_EXPORT_START_MESSAGES[code]);
    expect(root.textContent).not.toContain('This revision holds nothing');
  });

  it('prepares approved print renderings, prints with the family body class and clears on destroy', async () => {
    const { fixture, button, root } = await setup();
    expect(root.querySelector('[data-testid="family-export-print-document"]')?.classList.contains(MKTG_FAMILY_PRINT_ONLY_CLASS)).toBe(true);
    expect(api.printView).toHaveBeenCalledWith(expect.anything(), [familyExportMember()], 'Synthetic project');
    expect(print.prepare).toHaveBeenCalledWith(null, [400]);
    expect(print.printNow).not.toHaveBeenCalled();
    button('pdf')?.click();
    expect(print.printNow).toHaveBeenCalledWith(MKTG_FAMILY_PRINT_BODY_CLASS, pdfTitle);
    expect(api.printView).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(print.clear).toHaveBeenCalled();
  });

  it('marks readiness when preparation resolves after rendering and prints synchronously on the first enabled click', async () => {
    let ready: () => void = () => undefined;
    print.prepare.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
    const { fixture, root, button } = await setup();
    expect(root.querySelector('[data-testid="family-export-print-document"] > *')).not.toBeNull();
    expect(fixture.componentInstance['pdfReady']()).toBe(false);
    expect(button('pdf')?.disabled).toBe(true);
    ready();
    await Promise.resolve();
    // Do not call detectChanges/whenStable here: the original zoneless latch needed a click to render.
    expect(fixture.componentInstance['pdfReady']()).toBe(true);
    expect(fixture.componentInstance['pdfPending']()).toBe(false);
    await fixture.whenStable();
    expect(button('pdf')?.disabled).toBe(false);
    button('pdf')?.click();
    expect(print.printNow).toHaveBeenCalledExactlyOnceWith(MKTG_FAMILY_PRINT_BODY_CLASS, pdfTitle);
    expect(api.printView).toHaveBeenCalledOnce();
  });

  it('keeps the PDF disabled until completed preparation has also been marked ready', async () => {
    const { fixture, button } = await setup();
    expect(fixture.componentInstance['pdfPreparedScope']()).not.toBe('');
    fixture.componentInstance['pdfReady'].set(false);
    await fixture.whenStable();
    expect(button('pdf')?.disabled).toBe(true);
    button('pdf')?.click();
    expect(print.printNow).not.toHaveBeenCalled();
    expect(api.printView).toHaveBeenCalledOnce();
  });

  it('keeps the checking line and Download PDF disabled during font preparation, with no new copy or print', async () => {
    let ready: () => void = () => undefined;
    print.prepare.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
    const { fixture, root, button } = await setup();
    button('pdf')?.click();
    expect(print.printNow).not.toHaveBeenCalled();
    await fixture.whenStable();
    expect(button('pdf')?.disabled).toBe(true);
    expect(button('slides')?.disabled).toBe(false);
    expect(root.querySelector('[data-testid="family-export-loading"]')?.textContent).toContain('Checking approved assets and the last export…');
    expect(root.textContent).not.toContain('Preparing PDF');
    ready();
    await Promise.resolve();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-export-pdf-ready"]')).toBeNull();
    expect(button('pdf')?.textContent?.trim()).toBe('Download PDF');
    expect(button('pdf')?.disabled).toBe(false);
    expect(print.printNow).not.toHaveBeenCalled();
    button('pdf')?.click();
    expect(print.printNow).toHaveBeenCalledExactlyOnceWith(MKTG_FAMILY_PRINT_BODY_CLASS, pdfTitle);
    expect(api.printView).toHaveBeenCalledOnce();
  });

  it('reports a font preparation failure without printing or leaving the PDF busy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail: (reason: Error) => void = () => undefined;
    print.prepare.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)));
    const { fixture, root, button } = await setup();
    expect(button('pdf')?.disabled).toBe(true);
    button('pdf')?.click();
    await fixture.whenStable();
    fail(new Error('Synthetic font preparation failure'));
    await Promise.resolve();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-error"]')?.textContent).toContain('could not be prepared for PDF');
    expect(root.querySelector('[data-testid="family-export-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-export-pdf-ready"]')).toBeNull();
    expect(button('pdf')?.disabled).toBe(false);
    expect(fixture.componentInstance['pdfReady']()).toBe(false);
    expect(print.printNow).not.toHaveBeenCalled();
    let ready: () => void = () => undefined;
    print.prepare.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
    button('pdf')?.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-export-loading"]')).not.toBeNull();
    expect(button('pdf')?.disabled).toBe(true);
    expect(button('pdf')?.textContent?.trim()).toBe('Download PDF');
    button('pdf')?.click();
    expect(api.printView).toHaveBeenCalledTimes(2);
    ready();
    await Promise.resolve();
    await fixture.whenStable();
    expect(button('pdf')?.disabled).toBe(false);
    expect(root.querySelector('[data-testid="family-export-pdf-ready"]')).toBeNull();
    expect(print.printNow).not.toHaveBeenCalled();
    button('pdf')?.click();
    expect(print.printNow).toHaveBeenCalledExactlyOnceWith(MKTG_FAMILY_PRINT_BODY_CLASS, pdfTitle);
  });

  it('composes all four print roots in exporter order with a family cover, contents and branded type', async () => {
    const kit = brandKitTestRevision();
    const brand = mktgPrintBrand(kit);
    const boilerplates = boilerplatesAssetOfRevision(JSON.stringify(boilerplatesEnvelope.content), boilerplatesEnvelope);
    const faq = faqAssetOfRevision(JSON.stringify(faqEnvelope.content), faqEnvelope);
    if (!boilerplates || !faq) throw new Error('Invalid synthetic assets');
    const framework = buildFoundationMessagePrintView(
      {
        mf: { vision: '', mission: '', positioning: '', tagline: 'Synthetic tagline', goals: [], crosscut: '', say: [], avoid: [], anchor: [], notes: '' },
        icp: [],
        mh: { umbrella: '', line: '', pillars: [], found: '', aud: [] },
        nums: [],
      },
      'Synthetic project',
      1,
      kit
    );
    const kitView = buildBrandKitBookView(kit, 1);
    api.printView.mockReturnValue(
      of({
        framework,
        kit: kitView,
        boilerplates: buildBoilerplatesPrintView(boilerplates, brand),
        faq: buildFaqPrintView(faq, brand),
        brand,
        projectName: 'Synthetic project',
        printedAt: '2026-10-28T00:00:00Z',
        newestRevisionAt: '2026-10-21T10:00:00Z',
        revisionNumbers: { 'foundation-message': 3, 'brand-kit': 1, boilerplates: 2, faq: 1 },
        fontFamily: brand.fontFamily,
        weights: [400],
      })
    );
    const { fixture, root, button } = await setup();
    button('pdf')?.click();
    await fixture.whenStable();
    const document = root.querySelector('[data-testid="family-export-print-document"]');
    // The family deck's order: the cover, the framework, the kit, a divider and the pages of each appendix part, the back cover last.
    expect(Array.from(document?.children ?? []).map((child) => child.tagName.toLowerCase())).toEqual([
      'lfx-mktg-print-family-cover',
      'lfx-mktg-framework-print',
      'lfx-mktg-brand-kit-print',
      'lfx-mktg-print-divider',
      'lfx-mktg-boilerplates-print',
      'lfx-mktg-print-divider',
      'lfx-mktg-faq-print',
      'lfx-mktg-print-back-cover',
    ]);
    const cover = document?.querySelector<HTMLElement>('[data-testid="family-export-print-cover"]');
    // The cover is the deck's: the project's eyebrow line in capitals, the newest revision's month, the family's name, and
    // the versions line of the parts present, on the dark ground with the reversed lockup; no number.
    expect(cover?.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('cover');
    expect(cover?.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Positioning & brand');
    const coverEls = Array.from(cover?.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]') ?? []);
    expect(coverEls.map((el) => el.textContent?.trim())).toEqual([
      'SYNTHETIC PROJECT · A LINUX FOUNDATION PROJECT',
      'October 2026',
      'Synthetic project · a Linux Foundation project',
      'Messaging Framework v3 · Brand Kit V1.0 · Boilerplates v2 · FAQ v1',
      '',
    ]);
    expect(coverEls[4].querySelector('img')?.getAttribute('src')).toBe(brand.logoOnDark?.src);
    expect(cover?.querySelector('[data-testid="mktg-print-page-footer"]')).toBeNull();
    // The parts are numbered in the family order; the dividers count each part; the kit's and the appendix pages are
    // numbered deck-wide after the cover, the kit and the dividers (the framework prints in its own flow for now: none
    // of its pages are counted).
    const dividers = Array.from(document?.querySelectorAll('lfx-mktg-print-divider') ?? []);
    const dividerEls = (divider: Element) => Array.from(divider.querySelectorAll('[data-testid="mktg-print-page-el"]'), (el) => el.textContent?.trim());
    expect(dividers.map(dividerEls)).toEqual([
      ['03 · POSITIONING & BRAND', 'Boilerplates', '4 boilerplates', ''],
      ['04 · POSITIONING & BRAND', 'Questions and answers', '4 questions and answers', ''],
    ]);
    expect(dividers.every((divider) => divider.querySelector('[data-testid="mktg-print-page-footer"]') === null)).toBe(true);
    // The kit inside the family: its cover at 2, its fourteen content pages 3–16 with the family's running count, no back
    // cover of its own; then the divider 17, the cards 18, the divider 19, the grid 20, the family's back cover 21.
    const kitPages = mktgBrandKitBookPageCount(kitView, brand, 'Synthetic project', { backCover: false });
    expect(kitPages).toBe(15);
    const kitPrint = document?.querySelector('[data-testid="mktg-brand-kit-print"]');
    expect(kitPrint?.getAttribute('data-pages')).toBe('15');
    expect(kitPrint?.querySelectorAll('[data-testid="kit-print-cover"]')).toHaveLength(1);
    expect(kitPrint?.querySelectorAll('[data-testid="kit-print-back-cover"]')).toHaveLength(0);
    const kitContent = Array.from(kitPrint?.querySelectorAll('[data-testid="kit-print-page"]') ?? []);
    expect(kitContent).toHaveLength(14);
    expect(kitContent[0].getAttribute('data-page')).toBe('03');
    expect(kitContent[0].textContent).toContain('04   Logo system');
    const line = 'Synthetic project · a Linux Foundation project';
    const footers = Array.from(document?.querySelectorAll('[data-testid="mktg-print-page-footer"]') ?? []).map((el) => el.textContent?.trim());
    expect(footers).toEqual([...kitContent.flatMap((_, i) => [line, String(3 + i).padStart(2, '0')]), line, '18', line, '20']);
    expect(
      Array.from(document?.querySelectorAll('lfx-mktg-boilerplates-print [data-testid="mktg-print-page-head"]') ?? []).map((el) => el.textContent?.trim())
    ).toEqual(['03 Boilerplates', 'Synthetic project Positioning & brand']);
    // The back cover closes the file, the very page the kit prints last on its own: the kit's brand line in capitals, its
    // host and the trademark notice, on the dark ground.
    const back = document?.querySelector<HTMLElement>('[data-testid="family-export-print-back-cover"]');
    expect(back?.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('back');
    expect(back?.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe(kitView.voice.line || 'Synthetic project');
    expect(kitView.voice.line).not.toBe('');
    expect(back?.textContent).toContain('trademarks of the Linux Foundation');
    const kitAlone = TestBed.createComponent(MktgBrandKitPrintComponent);
    kitAlone.componentRef.setInput('view', kitView);
    kitAlone.componentRef.setInput('brand', brand);
    kitAlone.componentRef.setInput('projectName', 'Synthetic project');
    await kitAlone.whenStable();
    const kitBack = (kitAlone.nativeElement as HTMLElement).querySelector('[data-testid="kit-print-back-cover"]');
    expect(back?.querySelector('[data-testid="mktg-print-page"]')?.innerHTML).toBe(kitBack?.querySelector('[data-testid="mktg-print-page"]')?.innerHTML);
    if (!document) throw new Error('Missing synthetic family print composition');
    expect(Array.from(document.querySelectorAll('lfx-mktg-framework-print h2 > span')).map((span) => span.textContent?.trim())).toEqual(['01.1', '01.2']);
    const frameworkRoot = document.querySelector('[data-testid="mktg-framework-print"]');
    expect(frameworkRoot?.classList.contains('flex')).toBe(false);
    expect(frameworkRoot?.querySelector('.h-screen, .min-h-screen, .flex-1')).toBeNull();
    expect(frameworkRoot?.lastElementChild?.getAttribute('data-testid')).toBe('mktg-framework-print-numbers');
    const goals = document.querySelector('[data-testid="mktg-framework-print-goals"]');
    expect(goals).not.toBeNull();
    expect(goals?.querySelector('thead th')?.classList.contains('w-[1.1in]')).toBe(true);
    goals?.querySelectorAll('tbody th').forEach((label) => {
      expect(getComputedStyle(label).overflowWrap).toBe('normal');
      expect(getComputedStyle(label).wordBreak).toBe('normal');
      expect(getComputedStyle(label).hyphens).toBe('none');
      expect(label.classList.contains('uppercase')).toBe(true);
      expect(label.classList.contains('tracking-[0.16em]')).toBe(true);
    });
    expect(document.querySelector('[data-testid="mktg-framework-print-icps"]')).toBeNull();
    expect(document.querySelector('[data-testid="mktg-framework-print-message-house"]')).toBeNull();
    expect(document.classList.contains(MKTG_FAMILY_PRINT_ONLY_CLASS)).toBe(true);
    expect(document.querySelector('lfx-brand-kit-view')).toBeNull();
    // The kit's pages are the deck's landscape pages (its own component, numbered from the family's plan), none of the
    // portrait kit's chapters.
    expect(document.querySelectorAll('lfx-mktg-brand-kit-print .kit-chapter, lfx-mktg-brand-kit-print lfx-mktg-print-chapter-header')).toHaveLength(0);
    expect(Array.from(kitContent[1].querySelectorAll('[data-testid="mktg-print-page-head"]'), (el) => el.textContent?.trim())).toEqual([
      '01 Logo',
      'Synthetic project Brand Kit',
    ]);
    // The framework takes its part number from the same plan as the appendix.
    expect(Array.from(document?.querySelectorAll('lfx-mktg-framework-print h2 > span') ?? []).map((span) => span.textContent?.trim())).toEqual([
      '01.1',
      '01.2',
    ]);
    expect(document?.querySelector('[data-testid="mktg-framework-print-goals"]')).not.toBeNull();
    expect(document?.querySelector('[data-testid="mktg-framework-print-icps"]')).toBeNull();
    expect(document?.querySelector('[data-testid="mktg-framework-print-message-house"]')).toBeNull();
    expect(print.ensureFontStylesheet).toHaveBeenCalledWith(brand.fontUrl);
  });

  it('reports PDF preparation failure and never prints unapproved bytes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.printView.mockReturnValue(throwError(() => new Error('Changed approval')));
    const { fixture, root, button } = await setup();
    button('pdf')?.click();
    await fixture.whenStable();
    expect(root.textContent).toContain('could not be prepared for PDF');
    expect(print.printNow).not.toHaveBeenCalled();
  });

  it('holds Download PDF disabled while approved revisions load, then prints on the first enabled click', async () => {
    const pending = new Subject<MktgFamilyPrintView>();
    api.printView.mockReturnValue(pending);
    const { fixture, root, button } = await setup();
    expect(api.printView).toHaveBeenCalledOnce();
    expect(button('pdf')?.disabled).toBe(true);
    expect(button('pdf')?.textContent?.trim()).toBe('Download PDF');
    expect(root.querySelector('[data-testid="family-export-loading"]')).not.toBeNull();
    button('pdf')?.click();
    await fixture.whenStable();
    expect(print.printNow).not.toHaveBeenCalled();
    expect(button('pdf')?.disabled).toBe(true);
    pending.next({
      framework: null,
      kit: null,
      boilerplates: null,
      faq: null,
      brand: mktgPrintBrand(null),
      projectName: 'Synthetic project',
      printedAt: '2026-10-28T00:00:00Z',
      newestRevisionAt: '2026-10-21T10:00:00Z',
      revisionNumbers: {},
      fontFamily: null,
      weights: [400],
    });
    pending.complete();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="family-export-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-export-pdf-ready"]')).toBeNull();
    expect(button('pdf')?.textContent?.trim()).toBe('Download PDF');
    expect(button('pdf')?.disabled).toBe(false);
    expect(print.printNow).not.toHaveBeenCalled();
    button('pdf')?.click();
    expect(print.printNow).toHaveBeenCalledWith(MKTG_FAMILY_PRINT_BODY_CLASS, pdfTitle);
    expect(api.printView).toHaveBeenCalledOnce();
  });

  it.each(['writer', 'project', 'destroy'])('ignores a pending preparation after %s changes', async (change) => {
    let ready: () => void = () => undefined;
    print.prepare.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      })
    );
    const { fixture, button } = await setup();
    button('pdf')?.click();
    if (change === 'writer') writer.set(false);
    if (change === 'project') activeContext.set({ uid: 'synthetic-other-project', name: 'Other project' });
    if (change === 'destroy') fixture.destroy();
    else await fixture.whenStable();
    ready();
    if (change !== 'destroy') await fixture.whenStable();
    expect(print.printNow).not.toHaveBeenCalled();
    if (change === 'writer') expect(fixture.componentInstance['printView']()).toBeNull();
  });

  it('refreshes cached server truth on every page entry without restarting a running export', async () => {
    const first = await setup();
    first.fixture.destroy();
    api.last.mockClear();
    api.running.mockReturnValue(run);
    await setup();
    expect(api.last).toHaveBeenCalledWith({ project: 'synthetic-project', familyId: 'positioning-brand' }, true);
    expect(api.run).not.toHaveBeenCalled();
  });

  it('unsupported families show the title and one line, without buttons, PDF or Drive notes', async () => {
    const { fixture, root } = await setup();
    fixture.componentRef.setInput('familyId', 'social-community');
    await fixture.whenStable();
    expect(root.querySelector('h2')?.textContent).toBe('Export the family');
    expect(root.querySelector('[data-testid="family-export-unsupported"]')?.textContent).toBe('This family has no assets supported by the exporter yet.');
    expect(root.querySelectorAll('section p')).toHaveLength(1);
    expect(root.querySelector('lfx-button')).toBeNull();
    expect(root.querySelector('[data-testid="family-export-pdf-note"]')).toBeNull();
    expect(root.textContent).not.toContain('Drive');
    writer.set(false);
    await fixture.whenStable();
    expect(root.querySelectorAll('section p')).toHaveLength(1);
  });
  it('does not call browser or API operations during SSR', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const { fixture, button } = await setup();
    expect(button('slides')?.disabled).toBe(true);
    expect(api.last).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isRendered()).toBe(false);
    fixture.componentInstance.focusDownload();
    expect(fixture.componentInstance['highlighted']()).toBe(false);
  });
});
