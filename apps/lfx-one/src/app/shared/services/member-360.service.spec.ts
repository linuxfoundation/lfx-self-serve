// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Member360Service } from './member-360.service';
import { UserService } from './user.service';

describe('Member360Service workbook transport', () => {
  let api: Member360Service;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: UserService, useValue: { user: signal({ sub: 'synthetic-subject' }) } }],
    });
    api = TestBed.inject(Member360Service);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    sessionStorage.clear();
  });
  function startPending(onActivity?: Parameters<Member360Service['waitForStored']>[2]) {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    api.generate({ project: 'sample-project' }).subscribe();
    http
      .expectOne('/api/mktg-agents/member-360/generate')
      .flush({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' });
    return api.waitForStored('sample-project', 'run-0123456789abcdef01234567', onActivity);
  }
  it('does not cancel or overlap a slow result request', () => {
    let stored = false;
    startPending().subscribe(() => {
      stored = true;
    });
    http.expectNone('/api/mktg-agents/member-360/result');
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    const first = http.expectOne('/api/mktg-agents/member-360/result');
    vi.advanceTimersByTime(3 * MKTG_RUN_POLL.intervalMs);
    expect(first.cancelled).toBe(false);
    http.expectNone('/api/mktg-agents/member-360/result');
    first.flush({ status: 'ready', stored: true });
    expect(stored).toBe(true);
  });
  it.each([0, 503])('retries a transient %s without losing the pending run', (status) => {
    let stored = false;
    startPending().subscribe(() => {
      stored = true;
    });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({}, { status, statusText: 'Temporary failure' });
    expect(stored).toBe(false);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'ready', stored: true });
    expect(stored).toBe(true);
  });
  it('delivers activity without releasing the storage gate, retaining the feed across a failed poll', () => {
    const onActivity = vi.fn();
    const stored = vi.fn();
    startPending(onActivity).subscribe(stored);
    expect(api.pendingStartedAt('sample-project', 'run-0123456789abcdef01234567')).toBeTypeOf('number');
    expect(api.pendingStartedAt('other-project', 'run-0123456789abcdef01234567')).toBeNull();
    const activity = [{ id: 'step-1', kind: 'lfx', label: 'Checking LFX', status: 'running', startedAt: '2026-10-19T10:00:00.000Z' }];
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'pending', activity });
    expect(onActivity).toHaveBeenCalledWith(activity);
    expect(stored).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({}, { status: 503, statusText: 'Temporary failure' });
    expect(onActivity).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'ready', stored: false });
    expect(stored).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'ready', stored: true });
    expect(stored).toHaveBeenCalledTimes(1);
    expect(api.pendingStartedAt('sample-project', 'run-0123456789abcdef01234567')).toBeNull();
  });
  it('emits a failed run once, forgets its capability and never polls it again', () => {
    const received = vi.fn();
    const completed = vi.fn();
    startPending().subscribe({ next: received, complete: completed });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    const result = { status: 'failed', message: 'No entitled project was found for this session.' };
    http.expectOne('/api/mktg-agents/member-360/result').flush(result);
    expect(received).toHaveBeenCalledExactlyOnceWith(result);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it('stops polling on needs_input without forgetting the open run', () => {
    const received = vi.fn();
    startPending().subscribe(received);
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'needs_input' });
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_input' }));
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it.each([400, 403])('fails fast on a terminal %s result error', (status) => {
    let denied = false;
    startPending().subscribe({
      error: () => {
        denied = true;
      },
    });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({}, { status, statusText: 'Invalid or denied' });
    expect(denied).toBe(true);
    vi.advanceTimersByTime(2 * MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });

  it('downloads a stored document through the BFF without sending client tabs', () => {
    const blob = new Blob(['synthetic workbook']);
    let received: Blob | undefined;
    api.download('sample-project', 'run-0123456789abcdef01234567').subscribe((value) => {
      received = value;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/documents/run-0123456789abcdef01234567/workbook?project=sample-project');
    expect(request.request.method).toBe('GET');
    expect(request.request.body).toBeNull();
    expect(request.request.responseType).toBe('blob');
    request.flush(blob);
    expect(received).toBe(blob);
  });
});
