// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_SLIDES_EXPORT_FAILURE_MESSAGES, MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import { MktgSlidesExportResultResponse, MktgSlidesExportStartResponse, MktgSlidesExportTarget } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MktgSlidesExportService } from './mktg-slides-export.service';

/**
 * The export client: the last export read, the start, and the poll — which
 * keeps going through pending answers and transient failures, stops on the
 * first ready or failed answer, and answers the timeout message when the
 * export is still pending at the end. The logo is never drawn on the server.
 */
describe('MktgSlidesExportService', () => {
  const SHA = 'a'.repeat(64);
  const TARGET: MktgSlidesExportTarget = { project: 'proj-1', agentKey: 'brand-kit', documentId: 'living', revisionId: `000001-${SHA}` };
  const STARTED: MktgSlidesExportStartResponse = {
    sessionId: 'session-1',
    ownerToken: 'token',
    revision: { id: `000001-${SHA}`, number: 1, contentSha256: SHA },
    mode: 'create',
    logoNote: null,
  };

  function configure(platformId: 'browser' | 'server' = 'browser'): { service: MktgSlidesExportService; http: HttpTestingController } {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: platformId }] });
    return { service: TestBed.inject(MktgSlidesExportService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the last export of the document and starts an export', () => {
    const { service, http } = configure();

    service.last(TARGET).subscribe();
    const last = http.expectOne((request) => request.url === '/api/mktg-agents/slides-export/last');
    expect(last.request.params.get('project')).toBe('proj-1');
    expect(last.request.params.get('agentKey')).toBe('brand-kit');
    expect(last.request.params.get('documentId')).toBe('living');
    last.flush({ last: null, latestRevision: null });

    service.start({ ...TARGET, mode: 'create', logoPng: 'UE5H' }).subscribe();
    const start = http.expectOne('/api/mktg-agents/slides-export/start');
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual({ ...TARGET, mode: 'create', logoPng: 'UE5H' });
    start.flush(STARTED);
    http.verify();
  });

  it('polls through pending answers and a transient failure until the deck is ready', async () => {
    vi.useFakeTimers();
    const { service, http } = configure();
    const results: MktgSlidesExportResultResponse[] = [];

    service.poll(TARGET, STARTED).subscribe((result) => results.push(result));

    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    const first = http.expectOne('/api/mktg-agents/slides-export/result');
    expect(first.request.body).toEqual({ ...TARGET, revisionId: STARTED.revision.id, sessionId: 'session-1', ownerToken: 'token' });
    first.flush({ status: 'pending' });
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/slides-export/result').flush(null, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/slides-export/result').flush({ status: 'failed', failure: 'google', message: 'm', deckLink: null });

    expect(results).toEqual([{ status: 'failed', failure: 'google', message: 'm', deckLink: null }]);
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs * 3);
    http.verify();
  });

  it('answers the timeout message when the export is still pending at the end', async () => {
    vi.useFakeTimers();
    const { service, http } = configure();
    const results: MktgSlidesExportResultResponse[] = [];

    service.poll(TARGET, STARTED).subscribe((result) => results.push(result));
    for (let attempt = 0; attempt < MKTG_SLIDES_EXPORT_POLL.maxAttempts; attempt++) {
      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
      http.expectOne('/api/mktg-agents/slides-export/result').flush({ status: 'pending' });
    }

    expect(results).toEqual([{ status: 'failed', failure: 'timeout', message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.timeout, deckLink: null }]);
    http.verify();
  });

  it('draws no logo on the server or without an SVG', async () => {
    expect(await configure('server').service.drawLogoPng('<svg/>')).toBeUndefined();
    TestBed.resetTestingModule();
    expect(await configure().service.drawLogoPng(null)).toBeUndefined();
  });
});
