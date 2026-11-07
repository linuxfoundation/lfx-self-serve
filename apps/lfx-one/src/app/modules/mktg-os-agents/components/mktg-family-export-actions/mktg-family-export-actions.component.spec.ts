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
  MKTG_KIT_POSITIONING_FAMILY_ID,
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
import { MktgFamilyExportActionsComponent } from './mktg-family-export-actions.component';
import {
  boilerplatesAssetOfRevision,
  buildBoilerplatesPrintView,
  brandKitPortraitPlan,
  frameworkPortraitPlan,
  mktgPortraitSectionLabel,
  buildBrandKitBookView,
  buildFaqPrintView,
  buildFoundationMessagePrintView,
  faqAssetOfRevision,
  mktgFamilyPrintDocument,
  mktgFamilyPrintSourceLabel,
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
        fontFamily: null,
        weights: [400],
        documents: [],
        tagline: '',
        websiteLabel: '',
        boilerplatesSources: [],
        conflicts: [],
      } satisfies MktgFamilyPrintView)
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
    expect(Array.from(root.querySelectorAll('section > lfx-button'), (element) => element.textContent?.trim())).toEqual([
      'Download PDF',
      'Export to Google Slides',
    ]);
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

  it('composes the family book: fixed frames in exporter order, numbered by one plan, with the framework and kit prints inside', async () => {
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
    const approval = { approvedAt: '2026-11-06T18:00:00Z', approvedBy: { name: 'Synthetic Approver' } };
    const documents = (['foundation-message', 'brand-kit', 'boilerplates', 'faq'] as const).map((agentKey, index) =>
      mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, agentKey, index + 1, index + 1, approval, index === 3 ? faq.report.gaps : [])
    );
    const kitView = buildBrandKitBookView(kit, 1);
    const faqView = buildFaqPrintView(faq, brand);
    api.printView.mockReturnValue(
      of({
        framework,
        kit: kitView,
        boilerplates: buildBoilerplatesPrintView(boilerplates, brand),
        faq: faqView,
        brand,
        projectName: 'Synthetic project',
        printedAt: '2026-10-28T00:00:00Z',
        newestRevisionAt: '2026-10-21T10:00:00Z',
        fontFamily: brand.fontFamily,
        weights: [400],
        documents,
        tagline: 'Synthetic tagline',
        websiteLabel: 'one.example.org',
        boilerplatesSources: boilerplates.report.sources_read,
        conflicts: [
          {
            id: 'Brand line · Brand kit',
            topic: 'Brand line',
            text: 'The brand kit carries “A”; the framework’s tagline is “B”.',
            rerun: 'Re-run the brand kit.',
          },
        ],
      })
    );
    const { fixture, root, button } = await setup();
    button('pdf')?.click();
    await fixture.whenStable();
    const document = root.querySelector('[data-testid="family-export-print-document"]');
    if (!document) throw new Error('Missing synthetic family print composition');
    const book = document.querySelector<HTMLElement>('[data-testid="family-print-book"]');
    if (!book) throw new Error('Missing synthetic family book');
    expect(document.children).toHaveLength(1);
    expect(book.tagName.toLowerCase()).toBe('lfx-mktg-family-print');
    expect(book.classList.contains('lfx-mktg-portrait')).toBe(true);
    // The book in exporter order: cover, contents, then an opener before each document; the framework and the kit
    // print their own portrait pages in the family's book, the boilerplates, the FAQ and the Sources page as the
    // family's frames.
    const kitPlan = brandKitPortraitPlan(kitView, { inFamily: true });
    const frameworkPlan = frameworkPortraitPlan(framework, { inFamily: true });
    const frameworkPages = frameworkPlan.length;
    const kitFirst = 3 + frameworkPages + 2;
    const kitLast = kitFirst + kitPlan.length - 1;
    const total = kitLast + 6;
    const frames = Array.from(book.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'));
    // The kit's frames in the book: every page of its family plan, in order, numbered from the chapter's first page,
    // under the family's running head, no band; nothing of it flows as a chapter.
    const kitFrames = frames.filter((frame) => frame.closest('lfx-mktg-brand-kit-print'));
    const kitIds = kitFrames.map((frame) => frame.dataset['pageId']);
    expect(kitIds).toEqual(kitPlan.map((page) => page.id));
    expect(kitFrames.map((frame) => Number(frame.dataset['page']))).toEqual(kitPlan.map((_, index) => kitFirst + index));
    expect(kitFrames.map((frame) => frame.dataset['section'])).toEqual(kitPlan.map((page) => mktgPortraitSectionLabel(page.section, true, 'Brand kit')));
    expect(
      document.querySelector(
        'lfx-mktg-brand-kit-print [data-testid="mktg-portrait-page-band"], .kit-chapter, lfx-mktg-print-chapter-header, .lfx-brand-kit-page'
      )
    ).toBeNull();
    // The framework's frames in the book: every page of its family plan (no cover), in order, numbered from its
    // chapter's first page, under the family's running head and on the kit's look; no band inside the family.
    const frameworkFrames = frames.filter((frame) => frame.closest('lfx-mktg-framework-print'));
    const frameworkIds = frameworkFrames.map((frame) => frame.dataset['pageId']);
    expect(frameworkIds).toEqual(frameworkPlan.map((page) => page.id));
    expect(frameworkFrames.map((frame) => Number(frame.dataset['page']))).toEqual(frameworkPlan.map((_, index) => 4 + index));
    expect(frameworkFrames.map((frame) => frame.dataset['section'])).toEqual(
      frameworkPlan.map((page) => mktgPortraitSectionLabel(page.section, true, 'Messaging framework'))
    );
    expect(frameworkFrames.every((frame) => frame.style.getPropertyValue('--pp-spark') === kitView.spark)).toBe(true);
    expect(document.querySelector('lfx-mktg-framework-print [data-testid="mktg-portrait-page-band"], [data-testid="mktg-framework-print-cover"]')).toBeNull();
    expect(frames.map((frame) => frame.dataset['pageId'])).toEqual([
      'cover',
      'contents',
      'opener-foundation-message',
      ...frameworkIds,
      'opener-brand-kit',
      ...kitIds,
      'opener-boilerplates',
      'boilerplates',
      'opener-faq',
      'faq-1',
      'sources',
      'back-cover',
    ]);
    // One plan numbers every frame: the family's own pages after the kit's chapter count on from its last page.
    expect(
      frames.filter((frame) => !frame.closest('lfx-mktg-brand-kit-print, lfx-mktg-framework-print')).map((frame) => Number(frame.dataset['page']))
    ).toEqual([1, 2, 3, 3 + frameworkPages + 1, kitLast + 1, kitLast + 2, kitLast + 3, kitLast + 4, kitLast + 5, kitLast + 6]);
    expect(frames.every((frame) => frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent !== 'Synthetic project brand kit')).toBe(true);
    expect(
      frames.every((frame) => frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent !== 'Synthetic project messaging framework')
    ).toBe(true);
    expect(
      frameworkFrames.every((frame) => frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent === 'Synthetic project positioning & brand')
    ).toBe(true);
    expect(
      kitFrames.every((frame) => frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent === 'Synthetic project positioning & brand')
    ).toBe(true);
    const cover = frames[0];
    expect(cover.querySelector('[data-testid="family-print-cover-title"]')?.textContent).toBe('Positioning & brand');
    expect(cover.querySelector('[data-testid="family-print-cover-tagline"]')?.textContent).toBe('Synthetic tagline');
    expect(cover.querySelector('[data-testid="family-print-cover-logo"]')?.getAttribute('src')).toBe(brand.logoOnDark?.src);
    expect(cover.textContent).toContain('one.example.org · 28 Oct 2026');
    expect(cover.querySelectorAll('[data-testid="family-print-cover-documents"] > *')).toHaveLength(4);
    expect(cover.textContent).toContain('V2.0 · 6 Nov 2026');
    // The contents page reads the same numbers as the openers and the footers.
    const contents = frames[1];
    expect(contents.querySelector('[data-testid="family-print-contents-intro"]')?.textContent).toContain(`4 documents, ${total} pages.`);
    expect(Array.from(contents.querySelectorAll('[data-testid="family-print-contents-opener-page"]')).map((n) => n.textContent?.trim())).toEqual([
      '3',
      String(3 + frameworkPages + 1),
      String(kitLast + 1),
      String(kitLast + 3),
    ]);
    expect(
      Array.from(contents.querySelectorAll('[data-testid="family-print-contents-entry"]')).map((n) =>
        Array.from(n.children)
          .map((cell) => cell.textContent?.trim())
          .join(' ')
      )
    ).toEqual([
      ...frameworkPlan.map((page, index) => `${page.title} ${4 + index}`),
      ...kitPlan.map((page, index) => `${page.title} ${kitFirst + index}`),
      `Boilerplates ${kitLast + 2}`,
      `Frequently asked questions ${kitLast + 4}`,
    ]);
    expect(contents.querySelector('[data-testid="family-print-contents-sources"]')?.textContent).toContain(String(kitLast + 5));
    const openers = Array.from(book.querySelectorAll<HTMLElement>('lfx-mktg-portrait-opener'));
    expect(openers.map((opener) => opener.querySelector('[data-testid="mktg-portrait-opener-title"]')?.textContent)).toEqual([
      'Messaging framework',
      'Brand kit',
      'Boilerplates',
      'FAQ',
    ]);
    expect(
      openers.map((opener) =>
        Array.from(opener.querySelectorAll('[data-testid="mktg-portrait-opener-meta"] :is(dt, dd)'))
          .map((cell) => cell.textContent?.trim())
          .join(' ')
      )
    ).toEqual([
      `Version V1.0 Approved 6 Nov 2026 Pages 4–${3 + frameworkPages}`,
      `Version V2.0 Approved 6 Nov 2026 Pages ${kitFirst}–${kitLast}`,
      `Version V3.0 Approved 6 Nov 2026 Pages ${kitLast + 2}`,
      `Version V4.0 Approved 6 Nov 2026 Pages ${kitLast + 4}`,
    ]);
    // The running head names the chapter left and the family right; nothing in the book is hand-numbered.
    const boilerplatesPage = frames.find((frame) => frame.dataset['pageId'] === 'boilerplates');
    expect(
      Array.from(boilerplatesPage?.querySelectorAll('[data-testid="mktg-portrait-page-head"] > span') ?? []).map((span) => span.textContent?.trim())
    ).toEqual(['03 Boilerplates', 'Synthetic project positioning & brand']);
    expect(book.querySelectorAll('[data-testid="family-print-boilerplate-card"]')).toHaveLength(4);
    // What the run was built from, each source as a short readable name; the run's notes never print.
    expect(Array.from(book.querySelectorAll('[data-testid="family-print-boilerplate-sources"] li')).map((item) => item.textContent)).toEqual(
      boilerplates.report.sources_read.map(mktgFamilyPrintSourceLabel)
    );
    expect(book.querySelector('[data-testid="family-print-boilerplate-notes"]')).toBeNull();
    expect(book.textContent).not.toContain('Notes from the run');
    // Answered questions only, and only the groups left with one.
    const answeredGroups = faqView.groups.map((group) => group.questions.filter((entry) => entry.answered).length).filter((size) => size > 0);
    expect(book.querySelectorAll('[data-testid="family-print-faq-group"]')).toHaveLength(answeredGroups.length);
    expect(book.querySelectorAll('[data-testid="family-print-faq-entry"]')).toHaveLength(answeredGroups.reduce((sum, size) => sum + size, 0));
    expect(book.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toContain(
      `${answeredGroups.reduce((sum, size) => sum + size, 0)} questions in ${answeredGroups.length} groups`
    );
    // The family's own Sources page, not the framework's or the kit's `sources` frame of the same plan id.
    const sources = frames.find((frame) => frame.dataset['pageId'] === 'sources' && !frame.closest('lfx-mktg-framework-print, lfx-mktg-brand-kit-print'));
    expect(sources?.querySelectorAll('[data-testid="family-print-sources-row"]')).toHaveLength(4);
    expect(sources?.querySelector('[data-testid="family-print-sources-conflicts"]')?.textContent).toContain('Brand line');
    expect(sources?.querySelector('[data-testid="family-print-sources-open"]')?.textContent).toContain('How much does membership cost?');
    expect(book.querySelector('[data-testid="mktg-portrait-back-cover-notice"]')?.textContent).toContain('Synthetic project and its logo are trademarks');
    // The kit's and the framework's own cover, contents and back cover stay out of the book.
    expect(document.querySelector('lfx-mktg-brand-kit-print [data-page-id="cover"], lfx-mktg-brand-kit-print [data-page-id="back-cover"]')).toBeNull();
    expect(document.querySelector('lfx-mktg-framework-print [data-page-id="cover"]')).toBeNull();
    // The boilerplates and the FAQ print as the family's frames, not as main's sheets; no sheet anywhere in the book.
    expect(document.querySelector('lfx-mktg-boilerplates-print, lfx-mktg-faq-print')).toBeNull();
    expect(document.querySelector('lfx-mktg-print-sheet')).toBeNull();
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
      fontFamily: null,
      weights: [400],
      documents: [],
      tagline: '',
      websiteLabel: '',
      boilerplatesSources: [],
      conflicts: [],
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
