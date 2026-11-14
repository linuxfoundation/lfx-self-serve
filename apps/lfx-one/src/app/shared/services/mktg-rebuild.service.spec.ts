// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MKTG_REBUILD_API_PATH, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgRebuildResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgRebuildService } from './mktg-rebuild.service';

const initial = (): MktgRebuildResponse => ({
  project: 'synthetic-project',
  chainId: 'chain',
  ownerToken: 'token',
  status: 'running',
  framework: { agentKey: 'foundation-message', revisionId: 'framework', revisionNumber: 2, contentSha256: 'a'.repeat(64) },
  steps: [
    { agentId: 'boilerplates', agentKey: 'boilerplates', status: 'running', activity: [] },
    { agentId: 'faq', agentKey: 'faq', status: 'queued', activity: [] },
  ],
});

describe('MktgRebuildService sequential HTTP flow', () => {
  let service: MktgRebuildService;
  let http: HttpTestingController;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MktgRebuildService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });
  it('posts small owner-bound DTOs and advances only after a committed Draft', async () => {
    const updates: MktgRebuildResponse[] = [];
    const subscription = service.run({ project: 'synthetic-project', frameworkRevisionId: 'framework' }).subscribe((value) => updates.push(value));
    http.expectOne(`${MKTG_REBUILD_API_PATH}/start`).flush(initial());
    expect(updates).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    const result = http.expectOne(`${MKTG_REBUILD_API_PATH}/result`);
    expect(result.request.body).toEqual({ project: 'synthetic-project', chainId: 'chain', ownerToken: 'token' });
    const next = initial();
    next.steps[0].status = 'draft';
    result.flush(next);
    const advance = http.expectOne(`${MKTG_REBUILD_API_PATH}/advance`);
    expect(advance.request.body.stepIndex).toBe(1);
    advance.flush({ ...next, status: 'complete', steps: next.steps.map((step) => ({ ...step, status: 'draft' })) });
    expect(updates.at(-1)?.status).toBe('complete');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    http.expectNone(`${MKTG_REBUILD_API_PATH}/result`);
    subscription.unsubscribe();
  });
  it('stops polling for questions and resumes via advance with the same turn capability', async () => {
    const pending = initial();
    pending.status = 'questions';
    pending.steps[0] = { ...pending.steps[0], status: 'questions', questionsId: 'q1', questions: [] };
    service.run({ project: pending.project, frameworkRevisionId: 'framework' }).subscribe();
    http.expectOne(`${MKTG_REBUILD_API_PATH}/start`).flush(pending);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    http.expectNone(`${MKTG_REBUILD_API_PATH}/result`);
    const subscription = service.answer(pending, 0, [{ key: 'domain', text: 'mesh.example', origin: 'accepted' }]).subscribe();
    const advance = http.expectOne(`${MKTG_REBUILD_API_PATH}/advance`);
    expect(advance.request.body).toMatchObject({
      chainId: pending.chainId,
      ownerToken: pending.ownerToken,
      stepIndex: 0,
      questionsId: 'q1',
      answers: [{ key: 'domain', text: 'mesh.example', origin: 'accepted' }],
    });
    advance.flush(initial());
    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    http.expectNone(`${MKTG_REBUILD_API_PATH}/result`);
  });
  it.each([0, 408, 429, 503])('retains running progress on transient %i polls and retries within the same stream', async (status) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const updates: MktgRebuildResponse[] = [];
    service.run({ project: 'synthetic-project', frameworkRevisionId: 'framework' }).subscribe((value) => updates.push(value));
    http.expectOne(`${MKTG_REBUILD_API_PATH}/start`).flush(initial());
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    const poll = http.expectOne(`${MKTG_REBUILD_API_PATH}/result`);
    if (status === 0) poll.error(new ProgressEvent('error'));
    else poll.flush({}, { status, statusText: 'Temporary read failure' });
    expect(updates.at(-1)).toEqual(initial());
    expect(warning).toHaveBeenCalledWith('Transient rebuild poll failure; retrying', expect.objectContaining({ status }));
    warning.mockRestore();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    http.expectOne(`${MKTG_REBUILD_API_PATH}/result`).flush({ ...initial(), status: 'complete' });
    expect(updates.at(-1)?.status).toBe('complete');
  });
  it.each([false, true])('resets the deadline only when the active step changes (%s)', async (changeStep) => {
    const failed = vi.fn();
    service.run({ project: 'synthetic-project', frameworkRevisionId: 'framework' }).subscribe({ error: failed });
    http.expectOne(`${MKTG_REBUILD_API_PATH}/start`).flush(initial());
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    const first = http.expectOne(`${MKTG_REBUILD_API_PATH}/result`);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs - 2 * MKTG_RUN_POLL.intervalMs);
    if (changeStep) {
      const next = initial();
      next.steps[0].status = 'draft';
      first.flush(next);
      next.steps[1].status = 'running';
      http.expectOne(`${MKTG_REBUILD_API_PATH}/advance`).flush(next);
    } else first.flush(initial());
    await vi.advanceTimersByTimeAsync(2 * MKTG_RUN_POLL.intervalMs);
    if (changeStep) {
      expect(failed).not.toHaveBeenCalled();
      http.expectOne(`${MKTG_REBUILD_API_PATH}/result`).flush({ ...initial(), status: 'complete' });
    } else expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('timed out') }));
  });
  it('still enforces the active-step deadline with a poll in flight', async () => {
    const failed = vi.fn();
    service.run({ project: 'synthetic-project', frameworkRevisionId: 'framework' }).subscribe({ error: failed });
    http.expectOne(`${MKTG_REBUILD_API_PATH}/start`).flush(initial());
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    const poll = http.expectOne(`${MKTG_REBUILD_API_PATH}/result`);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs);
    expect(poll.cancelled).toBe(true);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('timed out') }));
  });
  it.each([403, 503])('propagates %i errors without retrying side-effectful requests', (status) => {
    const failed = vi.fn();
    service.run({ project: 'synthetic-project', frameworkRevisionId: 'framework' }).subscribe({ error: failed });
    http.expectOne(`${MKTG_REBUILD_API_PATH}/start`).flush({}, { status, statusText: 'Request failed' });
    expect(failed).toHaveBeenCalledOnce();
    http.expectNone(`${MKTG_REBUILD_API_PATH}/start`);
  });
});
