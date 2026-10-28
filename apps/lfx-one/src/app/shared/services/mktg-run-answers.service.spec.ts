// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgRunAnswersService } from './mktg-run-answers.service';

describe('MktgRunAnswersService', () => {
  let http: HttpTestingController;
  let service: MktgRunAnswersService;
  const runId = 'c'.repeat(64);
  const request = {
    project: 'synthetic-project',
    questionsId: 'd'.repeat(64),
    answers: [{ key: 'audience', text: 'Synthetic maintainers', origin: 'accepted' as const }],
  };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MktgRunAnswersService);
  });
  afterEach(() => http.verify());

  it('sends only public run scope and answers, without a session capability', () => {
    const next = vi.fn();
    service.answer(runId, request).subscribe(next);
    const call = http.expectOne(`/api/mktg-agents/runs/${runId}/answers`);
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(request);
    call.flush({ runId, state: 'writing' });
    expect(next).toHaveBeenCalledExactlyOnceWith({ runId, state: 'writing' });
  });

  it.each([403, 409, 412, 503])('propagates %s for the questions UI and never retries', (status) => {
    const error = vi.fn();
    service.answer(runId, request).subscribe({ error });
    http.expectOne(`/api/mktg-agents/runs/${runId}/answers`).flush({}, { status, statusText: 'Synthetic response' });
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0].status).toBe(status);
    http.expectNone(`/api/mktg-agents/runs/${runId}/answers`);
  });
});
