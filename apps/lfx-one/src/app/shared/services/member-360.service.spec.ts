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
  function startPending() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    api.generate({ project: 'sample-project' }).subscribe();
    http
      .expectOne('/api/mktg-agents/member-360/generate')
      .flush({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' });
    return api.waitForStored('sample-project', 'run-0123456789abcdef01234567');
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

  it('retains the capability after a poll timeout so a reload can resume', () => {
    const error = vi.fn();
    startPending().subscribe({ error });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    const request = http.expectOne('/api/mktg-agents/member-360/result');
    request.flush({ status: 'pending' });
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs);
    const cancelled = http.match('/api/mktg-agents/member-360/result');
    expect(cancelled.every((request) => request.cancelled)).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ name: 'TimeoutError' }));
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    expect(sessionStorage.length).toBe(1);
    const resume = api.waitForStored('sample-project', 'run-0123456789abcdef01234567').subscribe();
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({ status: 'ready', stored: true });
    expect(resume.closed).toBe(true);
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(false);
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
});
