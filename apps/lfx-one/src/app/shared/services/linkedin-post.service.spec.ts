// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LINKEDIN_API, LINKEDIN_POST_INTAKE, MKTG_PENDING_DOCUMENT_STORAGE_PREFIX, MKTG_RUN_STORAGE_TTL_MS, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { UserService } from './user.service';
import { LinkedinPostService } from './linkedin-post.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('LinkedIn pending document recovery', () => {
  const user = signal({ sub: 'subject-one' });
  const run = {
    sessionId: 'synthetic-session',
    ownerToken: 'synthetic-token',
    documentId: 'run-0123456789abcdef01234567',
    source: { label: 'Example release', words: 10, fetched: false },
    answers: { share_link: 'https://public.example/shared' },
  };
  beforeEach(() => {
    user.set({ sub: 'subject-one' });
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: UserService, useValue: { user } }] });
  });
  afterEach(() => vi.useRealTimers());
  it('polls public activity, pauses at questions, answers the same session and ignores an already answered round', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    service.start(LINKEDIN_POST_INTAKE, 'project-one', {}).subscribe();
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    const progress = vi.fn();
    const next = vi.fn();
    service.wait(LINKEDIN_POST_INTAKE, 'project-one', run, progress).subscribe(next);
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.result).flush({ status: 'pending', activity: [{ label: 'Reading the public source.' }] });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(next).not.toHaveBeenCalled();
    const questions = { status: 'questions', questionsId: 'a'.repeat(64), questions: [{ key: 'tendency' }], activity: [] };
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.result).flush(questions);
    expect(next).toHaveBeenCalledWith(questions);
    const answers = [{ key: 'tendency', text: 'Direct and practical, with a friendly tone.', origin: 'accepted' as const }];
    service.answer(LINKEDIN_POST_INTAKE, 'project-one', run, questions.questionsId, answers).subscribe();
    const send = http.expectOne(`${LINKEDIN_API}/answers`);
    expect(send.request.body).toMatchObject({
      sessionId: run.sessionId,
      ownerToken: run.ownerToken,
      project: 'project-one',
      questionsId: questions.questionsId,
      answers,
    });
    send.flush({ success: true });
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')?.answeredQuestionsId).toBe(questions.questionsId);
    localStorage.clear(); // Same-session acknowledgement must not depend on recovery storage.
    expect(run).not.toHaveProperty('answeredQuestionsId');
    const completed = vi.fn();
    service.wait(LINKEDIN_POST_INTAKE, 'project-one', run, progress).subscribe(completed);
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.result).flush(questions);
    expect(completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.result).flush({ status: 'ready', envelope: { version: 1 }, persistence: { version: 1 }, activity: [] });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')).toBeNull();
    http.verify();
  });

  it('keeps the sibling pending shape, isolates users/projects and prunes expired capabilities', () => {
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    service.start(LINKEDIN_POST_INTAKE, 'project-one', { content_source: 'text', content_text: 'Example content' }).subscribe();
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')).toMatchObject({ ...run, agentId: LINKEDIN_POST_INTAKE.agentId, projectUid: 'project-one' });
    const reloaded = TestBed.inject(LinkedinPostService).pending(LINKEDIN_POST_INTAKE, 'project-one');
    expect(reloaded?.answers).toEqual(run.answers);
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-two')).toBeNull();
    user.set({ sub: 'subject-two' });
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')).toBeNull();
    user.set({ sub: 'subject-one' });
    const key = `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:subject-one:project-one:${run.documentId}`;
    localStorage.setItem(key, JSON.stringify({ ...run, savedAt: new Date(Date.now() - MKTG_RUN_STORAGE_TTL_MS - 1).toISOString() }));
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    http.verify();
  });
  it('carries a saved link through an existing pending record without renewing or recreating capabilities', () => {
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    service.start(LINKEDIN_POST_INTAKE, 'project-one', {}).subscribe();
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    const before = service.pending(LINKEDIN_POST_INTAKE, 'project-one');
    service.rememberShareLink('project-one', run, 'https://public.example/edited');
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')).toMatchObject({
      answers: { share_link: 'https://public.example/edited' },
      savedAt: before?.savedAt,
    });
    service.rememberShareLink('project-two', run, 'https://public.example/other-project');
    user.set({ sub: 'subject-two' });
    service.rememberShareLink('project-one', run, 'https://public.example/other-user');
    user.set({ sub: 'subject-one' });
    expect(service.pending(LINKEDIN_POST_INTAKE, 'project-one')?.answers).toEqual({ share_link: 'https://public.example/edited' });
    localStorage.clear();
    service.rememberShareLink('project-one', run, '');
    expect(localStorage.length).toBe(0);
    http.verify();
  });

  it('does not retain the old subject’s owner token after an impersonation switch', () => {
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    const error = vi.fn();
    service.start(LINKEDIN_POST_INTAKE, 'project-one', {}).subscribe({ error });
    user.set({ sub: 'subject-two' });
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    expect(error).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    http.verify();
  });
});
