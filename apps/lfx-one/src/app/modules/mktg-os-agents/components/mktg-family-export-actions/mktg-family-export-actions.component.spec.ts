// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MktgFamilyExportLastResponse, MktgFamilyExportRunUpdate } from '@lfx-one/shared/interfaces';
import { MKTG_FAMILY_PRINT_BODY_CLASS, MKTG_FAMILY_PRINT_ONLY_CLASS, MKTG_SLIDES_EXPORT_START_MESSAGES } from '@lfx-one/shared/constants';
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
  buildBrandKitBookView,
  buildFaqPrintView,
  buildFoundationMessagePrintView,
  faqAssetOfRevision,
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
  const print = { print: vi.fn(), clear: vi.fn(), ensureFontStylesheet: vi.fn() };
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
        fontFamily: null,
        weights: [400],
      })
    );
    print.print.mockResolvedValue(undefined);
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
    expect(api.last).toHaveBeenCalledWith({ project: 'synthetic-project', familyId: 'positioning-brand' }, false);
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

  it('scrolls to the slot and focuses Download PDF when lookup finishes, without starting an export', async () => {
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
    expect(focus).toHaveBeenCalledOnce();
    expect(api.run).not.toHaveBeenCalled();
    expect(api.printView).not.toHaveBeenCalled();
    expect(print.print).not.toHaveBeenCalled();
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
    button('pdf')?.click();
    await fixture.whenStable();
    expect(api.printView).toHaveBeenCalledWith(expect.anything(), [familyExportMember()], 'Synthetic project');
    expect(print.print).toHaveBeenCalledWith(MKTG_FAMILY_PRINT_BODY_CLASS, null, [400]);
    fixture.destroy();
    expect(print.clear).toHaveBeenCalledWith(MKTG_FAMILY_PRINT_BODY_CLASS);
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
    api.printView.mockReturnValue(
      of({
        framework,
        kit: buildBrandKitBookView(kit, 1),
        boilerplates: buildBoilerplatesPrintView(boilerplates, brand),
        faq: buildFaqPrintView(faq, brand),
        brand,
        projectName: 'Synthetic project',
        printedAt: '2026-10-28T00:00:00Z',
        fontFamily: brand.fontFamily,
        weights: [400],
      })
    );
    const { fixture, root, button } = await setup();
    button('pdf')?.click();
    await fixture.whenStable();
    const document = root.querySelector('[data-testid="family-export-print-document"]');
    expect(Array.from(document?.children ?? []).map((child) => child.tagName.toLowerCase())).toEqual([
      'section',
      'lfx-mktg-framework-print',
      'lfx-mktg-brand-kit-print',
      'lfx-mktg-boilerplates-print',
      'lfx-mktg-faq-print',
    ]);
    const cover = document?.querySelector<HTMLElement>('[data-testid="family-export-print-cover"]');
    expect(cover?.textContent).toContain('Synthetic project');
    expect(cover?.textContent).toContain('28 Oct 2026');
    expect(Array.from(cover?.querySelectorAll('dd') ?? []).map((entry) => entry.textContent?.trim())).toEqual([
      'Messaging framework',
      'Brand kit',
      'Boilerplates',
      'FAQ',
    ]);
    expect(cover?.querySelector('h1')?.textContent).toBe('Positioning & brand kit');
    expect(cover?.querySelector('h1')?.classList.contains('text-balance')).toBe(true);
    expect(cover?.classList.contains('grid')).toBe(true);
    expect(cover?.classList.contains('h-screen')).toBe(false);
    expect(cover?.querySelector('.flex-1')).toBeNull();
    expect(cover?.querySelector('[data-testid="family-export-print-logo"]')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
    expect(cover?.style.getPropertyValue('--mfp-ink')).toBe(brand.ink);
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
    });
    expect(document.querySelector('[data-testid="mktg-framework-print-icps"]')).toBeNull();
    expect(document.querySelector('[data-testid="mktg-framework-print-message-house"]')).toBeNull();
    const body = root.ownerDocument.body;
    const wasPrinting = body.classList.contains(MKTG_FAMILY_PRINT_BODY_CLASS);
    body.classList.add(MKTG_FAMILY_PRINT_BODY_CLASS);
    try {
      expect(document.classList.contains(MKTG_FAMILY_PRINT_ONLY_CLASS)).toBe(true);
      const frames = document.querySelectorAll<HTMLElement>('lfx-mktg-brand-kit-print .kit-usage-frame');
      expect(frames).toHaveLength(4);
      frames.forEach((frame) => {
        expect(frame.closest(`.${MKTG_FAMILY_PRINT_ONLY_CLASS}`)).toBe(document);
        expect(frame.closest(`body.${MKTG_FAMILY_PRINT_BODY_CLASS}`)).toBe(body);
        expect(getComputedStyle(frame).position).toBe('relative');
        expect(getComputedStyle(frame).overflow).toBe('hidden');
        expect(getComputedStyle(frame).breakInside).toBe('avoid');
        const inner = frame.querySelector('.kit-usage-inner');
        if (!inner) throw new Error('Missing synthetic family-frame content box');
        expect(getComputedStyle(inner).position).toBe('absolute');
        inner.querySelectorAll('img, p').forEach((child) => {
          expect(child.closest('.kit-usage-frame')).toBe(frame);
          expect(getComputedStyle(child).position).toBe('absolute');
        });
      });
    } finally {
      if (!wasPrinting) body.classList.remove(MKTG_FAMILY_PRINT_BODY_CLASS);
    }
    expect(document.querySelectorAll('lfx-mktg-brand-kit-print .kit-chapter')).toHaveLength(5);
    expect(document?.querySelectorAll('lfx-mktg-brand-kit-print .kit-chapter > thead')).toHaveLength(5);
    expect(document?.querySelectorAll('lfx-mktg-brand-kit-print lfx-mktg-print-chapter-header')).toHaveLength(5);
    expect(document?.querySelector('lfx-brand-kit-view')).toBeNull();
    expect(document?.querySelector('lfx-mktg-brand-kit-print [data-testid="mktg-print-running-head"]')?.textContent).toContain('Synthetic project Brand kit');
    expect(Array.from(document?.querySelectorAll('lfx-mktg-brand-kit-print h2 > span') ?? []).map((span) => span.textContent?.trim())).toEqual([
      '02.1',
      '02.2',
      '02.3',
      '02.4',
      '02.5',
    ]);
    const numbers = Array.from(cover?.querySelectorAll('dt') ?? []).map((entry) => entry.textContent?.trim());
    expect(numbers).toEqual(['01', '02', '03', '04']);
    const sectionNumbers = Array.from(document?.querySelectorAll('lfx-mktg-framework-print h2 > span') ?? []).map((span) => span.textContent?.trim());
    expect(sectionNumbers).toEqual([`${numbers[0]}.1`, `${numbers[0]}.2`]);
    expect(document?.querySelector('lfx-mktg-boilerplates-print h2 > span')?.textContent?.trim()).toBe(numbers[2]);
    expect(document?.querySelector('lfx-mktg-faq-print h2 > span')?.textContent?.trim()).toBe(numbers[3]);
    expect(document?.querySelector('lfx-mktg-boilerplates-print [data-testid="mktg-print-running-head"]')?.textContent).toContain('Synthetic project');
    expect(document?.querySelector('lfx-mktg-faq-print [data-testid="mktg-print-running-head"]')?.textContent).toContain('Synthetic project');
    expect(print.ensureFontStylesheet).toHaveBeenCalledWith(brand.fontUrl);
  });

  it('reports PDF preparation failure and never prints unapproved bytes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.printView.mockReturnValue(throwError(() => new Error('Changed approval')));
    const { fixture, root, button } = await setup();
    button('pdf')?.click();
    await fixture.whenStable();
    expect(root.textContent).toContain('could not be prepared for PDF');
    expect(print.print).not.toHaveBeenCalled();
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
    const { button } = await setup();
    expect(button('slides')?.disabled).toBe(true);
    expect(api.last).not.toHaveBeenCalled();
  });
});
