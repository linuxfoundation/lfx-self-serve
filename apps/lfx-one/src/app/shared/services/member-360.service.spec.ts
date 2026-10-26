// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { MEMBER_360_RUN_CEILING_MS, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
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
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
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
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });
  it.each([0, 503])('retries a transient %s without losing the pending run', (status) => {
    let stored = false;
    startPending().subscribe(() => {
      stored = true;
    });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({}, { status, statusText: 'Temporary failure' });
    expect(stored).toBe(false);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    expect(sessionStorage.length).toBe(1);
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
  it('keeps polling after needs_input without forgetting the open run', () => {
    const received = vi.fn();
    const completed = vi.fn();
    startPending().subscribe({ next: received, complete: completed });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'needs_input' });
    expect(received).toHaveBeenCalledExactlyOnceWith({ status: 'needs_input' });
    expect(completed).not.toHaveBeenCalled();
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'ready', stored: true });
    expect(received).toHaveBeenNthCalledWith(2, { status: 'ready', stored: true });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it('completes and forgets the open run when needs_input is followed by failed', () => {
    const received = vi.fn();
    const completed = vi.fn();
    startPending().subscribe({ next: received, complete: completed });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'needs_input' });
    expect(received).toHaveBeenCalledExactlyOnceWith({ status: 'needs_input' });
    expect(completed).not.toHaveBeenCalled();
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'failed' });
    expect(received).toHaveBeenNthCalledWith(2, { status: 'failed' });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it('keeps the absolute ceiling and pending capability despite needs_input on every interval', () => {
    const received = vi.fn();
    const error = vi.fn();
    startPending().subscribe({ next: received, error });
    const startedAt = Date.now();
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    while (Date.now() < startedAt + MEMBER_360_RUN_CEILING_MS) {
      http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'needs_input' });
      expect(error).not.toHaveBeenCalled();
      vi.advanceTimersByTime(Math.min(MKTG_RUN_POLL.intervalMs, startedAt + MEMBER_360_RUN_CEILING_MS - Date.now()));
    }
    expect(received.mock.calls.length).toBeGreaterThan(1);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TimeoutError' }));
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    expect(sessionStorage.length).toBe(1);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it.each([400, 401, 403, 404])('forgets the capability on a permanent %s result error', (status) => {
    let denied = false;
    startPending().subscribe({
      error: () => {
        denied = true;
      },
    });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({}, { status, statusText: 'Denied' });
    expect(denied).toBe(true);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
    expect(sessionStorage.length).toBe(0);
    vi.advanceTimersByTime(2 * MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });

  it.each([0, 50 * 60_000])('keeps polling past ten minutes with a ceiling from startedAt after a %sms reload', (elapsed) => {
    startPending();
    vi.advanceTimersByTime(elapsed);
    const reloaded = TestBed.runInInjectionContext(() => new Member360Service());
    const error = vi.fn();
    reloaded.waitForStored('sample-project', 'run-0123456789abcdef01234567').subscribe({ error });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    const request = http.expectOne('/api/mktg-agents/member-360/result');
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs);
    expect(error).not.toHaveBeenCalled();
    expect(request.cancelled).toBe(false);
    vi.advanceTimersByTime(MEMBER_360_RUN_CEILING_MS - elapsed - MKTG_RUN_POLL.initialDelayMs - MKTG_RUN_POLL.timeoutMs - 1);
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(request.cancelled).toBe(true);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TimeoutError' }));
    expect(reloaded.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    expect(sessionStorage.length).toBe(1);
    const expired = vi.fn();
    reloaded.waitForStored('sample-project', 'run-0123456789abcdef01234567').subscribe({ error: expired });
    vi.advanceTimersByTime(1);
    const check = http.expectOne('/api/mktg-agents/member-360/result');
    expect(expired).not.toHaveBeenCalled();
    check.flush({ status: 'pending' });
    expect(expired).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'TimeoutError' }));
    expect(reloaded.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it('delivers a stored result from one slow check after the ceiling and forgets the pending run', () => {
    startPending();
    vi.advanceTimersByTime(MEMBER_360_RUN_CEILING_MS + 1);
    const received = vi.fn();
    const completed = vi.fn();
    const error = vi.fn();
    api.waitForStored('sample-project', 'run-0123456789abcdef01234567').subscribe({ next: received, complete: completed, error });
    vi.advanceTimersByTime(1);
    const check = http.expectOne('/api/mktg-agents/member-360/result');
    vi.advanceTimersByTime(2 * MKTG_RUN_POLL.intervalMs);
    expect(check.cancelled).toBe(false);
    expect(error).not.toHaveBeenCalled();
    http.expectNone('/api/mktg-agents/member-360/result');
    check.flush({ status: 'ready', stored: true });
    expect(received).toHaveBeenCalledExactlyOnceWith({ status: 'ready', stored: true });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
    expect(sessionStorage.length).toBe(0);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectNone('/api/mktg-agents/member-360/result');
  });
  it('passes URI-encoded tracker filenames in the upload header, never the URL', () => {
    const filename = 'Q3+sponsors — draft.csv';
    api.parseTracker('sample-project', new File(['company\nAcme Motors'], filename)).subscribe();
    const request = http.expectOne('/api/mktg-agents/member-360/tracker?project=sample-project');
    expect(request.request.headers.get('X-File-Name')).toBe(encodeURIComponent(filename));
    expect(request.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.request.body).toBeInstanceOf(File);
    expect(request.request.urlWithParams).not.toContain('filename');
    request.flush({ filename, rows: [{ company: 'Acme Motors' }] });
  });
  it('reports a missing pending capability through the observable error channel', () => {
    const error = vi.fn();
    const result = api.waitForStored('sample-project', 'missing');
    result.subscribe({ error });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'No pending run for this user and project' }));
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
