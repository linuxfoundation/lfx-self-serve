// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserService } from './user.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgRunAnswersService } from './mktg-run-answers.service';

describe('MktgRunAnswersService', () => {
  let http: HttpTestingController;
  let service: MktgRunAnswersService;
  const runId = 'c'.repeat(64);
  const user = signal<{ sub: string } | null>({ sub: 'synthetic-writer' });
  const target = { agentKey: 'faq' as const, documentId: 'living' };
  const request = {
    project: 'synthetic-project',
    questionsId: 'd'.repeat(64),
    answers: [{ key: 'audience', text: 'Synthetic maintainers', origin: 'accepted' as const }],
  };
  beforeEach(() => {
    user.set({ sub: 'synthetic-writer' });
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: UserService, useValue: { user } }] });
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

  it('records a late conflict after the run view unsubscribes and never repeats its POST', () => {
    const response = service.answer(runId, request, target);
    const subscription = response.subscribe({ error: vi.fn() });
    const call = http.expectOne(`/api/mktg-agents/runs/${runId}/answers`);
    subscription.unsubscribe();
    expect(call.cancelled).toBe(false);
    call.flush({ code: 'MKTG_RUN_ANSWERED', details: { answeredBy: null } }, { status: 409, statusText: 'Conflict' });
    expect(service.notice(request.project, target.agentKey, target.documentId)?.message).toBe(
      'Someone on your team already answered these — the agent is writing.'
    );
    const late = vi.fn();
    response.subscribe({ error: late });
    expect(late).toHaveBeenCalledOnce();
    http.expectNone(`/api/mktg-agents/runs/${runId}/answers`);
  });

  it.each(['new-run', 'other-user'])('does not publish an old conflict after %s', (change) => {
    service.answer(runId, request, target).subscribe({ error: vi.fn() });
    const call = http.expectOne(`/api/mktg-agents/runs/${runId}/answers`);
    if (change === 'new-run') service.observeRun(request.project, target.agentKey, target.documentId, 'e'.repeat(64));
    else user.set({ sub: 'another-synthetic-writer' });
    call.flush({ code: 'MKTG_RUN_ANSWERED', details: { answeredBy: 'Synthetic writer' } }, { status: 409, statusText: 'Conflict' });
    expect(service.notice(request.project, target.agentKey, target.documentId)).toBeNull();
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
