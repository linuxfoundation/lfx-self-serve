// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MKTG_DOCUMENT_TYPES, MKTG_FAMILY_EXPORT_API_PATH, MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import { MktgFamilyExportResultResponse, MktgFamilyPrintView, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { familyExportMember, familyExportRecord, familyExportStarted } from '@shared/testing/mktg-family-export-test-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgFamilyExportService } from './mktg-family-export.service';
import boilerplatesEnvelope from '@lfx-one/shared/utils/__fixtures__/boilerplates.envelope.json';
import faqEnvelope from '@lfx-one/shared/utils/__fixtures__/faq-envelope.json';

describe('Family export client', () => {
  const target = { project: 'synthetic-project', familyId: 'positioning-brand' };
  let service: MktgFamilyExportService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MktgFamilyExportService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deduplicates eager lookup but refreshes on request, never turning failed reads into no export', () => {
    service.last(target).subscribe();
    service.last(target).subscribe();
    const request = http.expectOne((request) => request.url === `${MKTG_FAMILY_EXPORT_API_PATH}/last`);
    expect(request.request.params.get('project')).toBe(target.project);
    expect(request.request.params.get('familyId')).toBe(target.familyId);
    request.flush({ last: null, currentMembers: [], skippedMembers: [], stale: false });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = vi.fn();
    service.last(target, true).subscribe({ error });
    http.expectOne((request) => request.url.endsWith('/family/last')).flush({}, { status: 500, statusText: 'Synthetic failure' });
    expect(error).toHaveBeenCalled();
  });

  it('keeps one run per family after the page leaves and polls the exact signed snapshot to ready', async () => {
    vi.useFakeTimers();
    const run = service.run(target, 'create');
    const subscription = run.subscribe();
    expect(service.run(target, 'update')).toBe(run);
    const start = http.expectOne(`${MKTG_FAMILY_EXPORT_API_PATH}/start`);
    expect(start.request.body).toEqual({ ...target, mode: 'create' });
    start.flush(familyExportStarted());
    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    const pending = http.expectOne(`${MKTG_FAMILY_EXPORT_API_PATH}/result`);
    expect(pending.request.body.snapshot).toEqual(familyExportStarted().snapshot);
    expect(pending.request.body.ownerToken).toBe('synthetic-token');
    pending.flush({ status: 'pending' });
    const result = vi.fn();
    service.running(target)?.subscribe(result);
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne(`${MKTG_FAMILY_EXPORT_API_PATH}/result`).flush({ status: 'ready', record: familyExportRecord() });
    expect(result).toHaveBeenLastCalledWith(expect.objectContaining({ result: { status: 'ready', record: familyExportRecord() } }));
    expect(service.running(target)).toBeNull();
  });

  it('bounds a hung poll and returns a timeout instead of an endless spinner', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let result: MktgFamilyExportResultResponse | undefined;
    service.poll(familyExportStarted()).subscribe((value) => (result = value));
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne(`${MKTG_FAMILY_EXPORT_API_PATH}/result`);
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.timeoutMs);
    expect(result).toMatchObject({ status: 'failed', failure: 'timeout' });
  });

  it('uses the shared transient retry and logged permanent-error policy', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = vi.fn();
    service.poll(familyExportStarted()).subscribe({ error });
    http.expectNone(`${MKTG_FAMILY_EXPORT_API_PATH}/result`);
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne(`${MKTG_FAMILY_EXPORT_API_PATH}/result`).flush({}, { status: 503, statusText: 'Synthetic transient failure' });
    expect(warning).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne(`${MKTG_FAMILY_EXPORT_API_PATH}/result`).flush({}, { status: 403, statusText: 'Synthetic refusal' });
    expect(errorLog).toHaveBeenCalledWith('[mktg-slides-export] poll refused', expect.objectContaining({ sessionId: 'synthetic-session' }));
    expect(error).toHaveBeenCalled();
  });

  function approvedKit(): MktgRevisionResponse {
    const type = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'brand-kit');
    if (!type) throw new Error('Missing synthetic type');
    const kit = brandKitTestRevision();
    const member = familyExportMember({ agentKey: 'brand-kit' });
    const approval = { approvedAt: '2026-10-20T00:00:00Z', approvedBy: null };
    const revision = {
      id: member.revisionId,
      number: 1,
      createdAt: null,
      origin: 'generated' as const,
      restoredFromNumber: null,
      intakeMode: 'form' as const,
      status: '',
      contentSha256: member.contentSha256,
      format: 'markdown' as const,
      commentCount: 0,
      latest: true,
      approval,
    };
    return {
      project: target.project,
      type,
      documentId: 'living',
      revisions: [revision],
      current: null,
      approvedCurrent: { revisionId: member.revisionId, number: 1 },
      revision,
      approval,
      markdown: '# Synthetic kit',
      sidecar: {
        contract: 'brand-kit-output/v2',
        project_name: kit.projectName,
        version: 1,
        kit: kit.kit,
        chapters: kit.chapters,
        report: kit.report,
        generated_at: kit.generatedAt,
      },
    };
  }

  it('composes the approved kit book with branded boilerplates and FAQ from the same approved snapshots', () => {
    let view: MktgFamilyPrintView | undefined;
    service
      .printView(
        target,
        (['brand-kit', 'boilerplates', 'faq'] as const).map((agentKey) => familyExportMember({ agentKey })),
        'Synthetic project'
      )
      .subscribe((value) => (view = value));
    const revision = http.expectOne((request) => request.url.includes('/documents/brand-kit/living/revisions/'));
    revision.flush(approvedKit());
    for (const [agentKey, envelope] of [
      ['boilerplates', boilerplatesEnvelope],
      ['faq', faqEnvelope],
    ] as const) {
      const type = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === agentKey);
      http
        .expectOne((request) => request.url.includes(`/documents/${agentKey}/living/revisions/`))
        .flush({
          ...approvedKit(),
          type,
          markdown: JSON.stringify(envelope.content),
          sidecar: envelope,
        });
    }
    expect(view?.boilerplates?.lengths).toHaveLength(4);
    expect(view?.faq?.groups).toHaveLength(2);
    expect(view?.faq?.groups[0].questions[2]).toMatchObject({ answered: false, source: '' });
    expect(view?.boilerplates?.brand.fontStack).toBe(view?.brand.fontStack);
    expect(view?.faq?.brand.source).toBe('kit');
    expect(view?.kit?.projectName).toBe('Project One');
    expect(view?.framework).toBeNull();
    expect(view?.fontFamily).toBe('Montserrat');
  });

  it.each(['boilerplates', 'faq'] as const)('rejects unreadable approved %s instead of silently omitting it', (agentKey) => {
    const error = vi.fn();
    service.printView(target, [familyExportMember({ agentKey })], 'Synthetic project').subscribe({ error });
    http
      .expectOne((request) => request.url.includes(`/documents/${agentKey}/living/revisions/`))
      .flush({
        ...approvedKit(),
        type: MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === agentKey),
        markdown: '{}',
        sidecar: null,
      });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('could not be read') }));
  });

  it('rejects a changed approval before PDF composition rather than falling back to draft bytes', () => {
    const error = vi.fn();
    service.printView(target, [familyExportMember({ agentKey: 'brand-kit' })], 'Synthetic project').subscribe({ error });
    http.expectOne((request) => request.url.includes('/documents/brand-kit/living/revisions/')).flush({ ...approvedKit(), approvedCurrent: null });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('approved current changed') }));
  });
});
