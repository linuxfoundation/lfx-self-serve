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
    expect(root.textContent).toContain('PDF: framework, brand kit, boilerplates and FAQ (approved current).');
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
    expect(root.textContent).toContain('Approve a revision first');
    expect(button('pdf')?.disabled).toBe(true);
    writer.set(false);
    await fixture.whenStable();
    expect(root.textContent).toContain('You need write access');
    expect(button('slides')?.disabled).toBe(true);
    expect(api.run).not.toHaveBeenCalled();
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
      'lfx-brand-kit-view',
      'lfx-mktg-boilerplates-print',
      'lfx-mktg-faq-print',
    ]);
    const cover = document?.querySelector('[data-testid="family-export-print-cover"]');
    expect(cover?.textContent).toContain('Synthetic project');
    expect(cover?.textContent).toContain('28 Oct 2026');
    expect(cover?.querySelectorAll('dd')).toHaveLength(4);
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

  it('does not call browser or API operations during SSR', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const { button } = await setup();
    expect(button('slides')?.disabled).toBe(true);
    expect(api.last).not.toHaveBeenCalled();
  });
});
