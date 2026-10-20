// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MKTG_SLIDES_EXPORT_FAILURE_MESSAGES, MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import { MktgSlidesExportResultResponse, MktgSlidesExportRunUpdate, MktgSlidesExportStartResponse, MktgSlidesExportTarget } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MktgSlidesExportService } from './mktg-slides-export.service';

/**
 * The export client: the last export read, the start, and the poll — which
 * keeps going through pending answers and transient failures, stops on the
 * first ready or failed answer, and answers the timeout message when the
 * export is still pending at the end. Failed reads are logged before their
 * fallback.
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

  function configure(): { service: MktgSlidesExportService; http: HttpTestingController } {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    return { service: TestBed.inject(MktgSlidesExportService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads the last export of the document and starts an export', () => {
    const { service, http } = configure();

    service.last(TARGET).subscribe();
    const last = http.expectOne((request) => request.url === '/api/mktg-agents/slides-export/last');
    expect(last.request.params.get('project')).toBe('proj-1');
    expect(last.request.params.get('agentKey')).toBe('brand-kit');
    expect(last.request.params.get('documentId')).toBe('living');
    last.flush({ last: null, latestRevision: null });

    service.start({ ...TARGET, mode: 'create' }).subscribe();
    const start = http.expectOne('/api/mktg-agents/slides-export/start');
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual({ ...TARGET, mode: 'create' });
    start.flush(STARTED);
    http.verify();
  });

  it('logs a failed last-export read and passes the failure on, never answering "no last export"', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, http } = configure();
    const answers: unknown[] = [];
    let failed = false;

    service.last(TARGET).subscribe({ next: (answer) => answers.push(answer), error: () => (failed = true) });
    http.expectOne((request) => request.url === '/api/mktg-agents/slides-export/last').flush(null, { status: 500, statusText: 'Server Error' });

    expect(answers).toEqual([]);
    expect(failed).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('[mktg-slides-export] last export read failed', expect.objectContaining({ documentId: 'living' }));
    http.verify();
  });

  it('runs one export per document: its mode, started, then its result, shared with whoever comes back to the document until it ends', async () => {
    vi.useFakeTimers();
    const { service, http } = configure();
    const first: MktgSlidesExportRunUpdate[] = [];

    const subscription = service.run(TARGET, 'update').subscribe((update) => first.push(update));
    expect(first).toEqual([{ mode: 'update', logoNote: null, result: null }]);
    http.expectOne('/api/mktg-agents/slides-export/start').flush({ ...STARTED, mode: 'update', logoNote: 'not-public' });
    expect(first.at(-1)).toEqual({ mode: 'update', logoNote: 'not-public', result: null });
    // The panel goes; the export does not.
    subscription.unsubscribe();

    const otherRevision = { ...TARGET, revisionId: `000002-${'b'.repeat(64)}` };
    const running = service.running(otherRevision);
    expect(running).not.toBeNull();
    expect(service.run(otherRevision, 'create')).toBe(running);
    expect(service.running({ ...TARGET, documentId: 'other' })).toBeNull();
    const second: MktgSlidesExportRunUpdate[] = [];
    running?.subscribe((update) => second.push(update));
    // Whoever attaches learns the export is an Update, so a retry never makes a second deck.
    expect(second).toEqual([{ mode: 'update', logoNote: 'not-public', result: null }]);

    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/slides-export/result').flush({ status: 'failed', failure: 'google', message: 'm', deckLink: null });

    expect(second.at(-1)).toEqual({ mode: 'update', logoNote: 'not-public', result: { status: 'failed', failure: 'google', message: 'm', deckLink: null } });
    expect(service.running(TARGET)).toBeNull();
    http.verify();
  });

  it('polls through pending answers and a transient failure until the deck is ready', async () => {
    vi.useFakeTimers();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    expect(consoleWarn).toHaveBeenCalledWith('[mktg-slides-export] poll failed, retrying', expect.objectContaining({ sessionId: 'session-1' }));
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

  it('answers the timeout message at the deadline behind a poll that never answers, and drops that poll', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { service, http } = configure();
    const results: MktgSlidesExportResultResponse[] = [];

    service.poll(TARGET, STARTED).subscribe((result) => results.push(result));
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
    const stalled = http.expectOne('/api/mktg-agents/slides-export/result');
    await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.timeoutMs);

    expect(results).toEqual([{ status: 'failed', failure: 'timeout', message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.timeout, deckLink: null }]);
    expect(stalled.cancelled).toBe(true);
    http.verify();
  });
});
