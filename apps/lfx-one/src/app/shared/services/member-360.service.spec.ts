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
  it('fails fast on denied result access', () => {
    let denied = false;
    startPending().subscribe({
      error: () => {
        denied = true;
      },
    });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne('/api/mktg-agents/member-360/result').flush({}, { status: 403, statusText: 'Denied' });
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
