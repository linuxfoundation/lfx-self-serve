// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants';
import { MktgGenerateRequest, User } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserService } from './user.service';
import { MktgRunAttemptService } from './mktg-run-attempt.service';

describe('MktgRunAttemptService', () => {
  const user = signal<User | null>({ sub: 'synthetic-subject' } as User);
  const request: MktgGenerateRequest = {
    agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
    projectUid: 'synthetic-project',
    intake: FOUNDATION_MESSAGE_INTAKE,
    answers: { project_name: 'TestOrbit' },
  };
  let service: MktgRunAttemptService;
  beforeEach(() => {
    window.localStorage.clear();
    user.set({ sub: 'synthetic-subject' } as User);
    TestBed.configureTestingModule({ providers: [{ provide: UserService, useValue: { user } }] });
    service = TestBed.inject(MktgRunAttemptService);
  });

  it('retains the draft before a session exists, restoring its answers without an owner token', () => {
    service.reserve(request);
    expect(service.load(request.projectUid, request.agentId)).toMatchObject({ state: 'draft', request: { answers: request.answers } });
    expect(service.load(request.projectUid, request.agentId)?.attempt).toBeUndefined();
  });

  it('keeps accepted answers and their block together with the same attempt through reload', () => {
    const attempt = { session: { agentId: request.agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-owner-proof' }, priorVersion: 0 };
    const answered = { questions: [], answers: [{ key: 'goal', text: 'Grow adoption', origin: 'accepted' as const }], questionsId: 'a1234567' };
    service.save({ request, attempt, answered, state: 'failed', updatedAt: new Date().toISOString() });
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService());
    expect(restored.load(request.projectUid, request.agentId)).toMatchObject({ attempt, answered, state: 'failed' });
  });

  it('binds handoffs and drafts to effective subject, project and agent; consumes a token only once', () => {
    const token = service.prepare(request);
    expect(service.consume(token, 'other-project', request.agentId)).toBeNull();
    user.set({ sub: 'another-synthetic-subject' } as User);
    expect(service.load(request.projectUid, request.agentId)).toBeNull();
    expect(service.consume(token, request.projectUid, request.agentId)).toBeNull();
    user.set({ sub: 'synthetic-subject' } as User);
    expect(service.consume(token, request.projectUid, request.agentId)?.pending.request.answers).toEqual(request.answers);
    expect(service.consume(token, request.projectUid, request.agentId)).toBeNull();
  });

  it('discards a cancelled navigation token while retaining its intake draft', () => {
    const token = service.prepare(request);
    service.discard(token);
    expect(service.consume(token, request.projectUid, request.agentId)).toBeNull();
    expect(service.load(request.projectUid, request.agentId)?.request.answers).toEqual(request.answers);
  });

  it('keeps uploads in memory but persists only safe intake/context and requires reattachment after reload', () => {
    const uploaded: MktgGenerateRequest = {
      ...request,
      feedback: 'Synthetic feedback',
      documents: [{ kind: 'file', title: 'synthetic.txt', text: 'private-document-marker' }],
      logoFiles: [{ name: 'synthetic.svg', text: 'private-logo-marker', base64: 'c3ludGhldGljLWJ5dGVz' }],
    };
    service.reserve(uploaded);
    expect(service.load(request.projectUid, request.agentId)?.request.documents).toEqual(uploaded.documents);
    const stored = window.localStorage.getItem(window.localStorage.key(0) ?? '') ?? '';
    expect(stored).toContain('projectUid');
    for (const value of ['private-document-marker', 'private-logo-marker', 'c3ludGhldGljLWJ5dGVz', 'batchPreamble', 'endpoints'])
      expect(stored).not.toContain(value);
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService()).load(request.projectUid, request.agentId);
    expect(restored?.request.intake).toBe(FOUNDATION_MESSAGE_INTAKE);
    expect(restored?.request.feedback).toBe(uploaded.feedback);
    expect(restored?.request.documents).toBeUndefined();
    expect(restored?.request.logoFiles).toBeUndefined();
    expect(restored?.requiresReattachment).toBe(true);
  });

  it('grants fresh generation only to one prepared draft object, never a reserve or restore', () => {
    const draft = service.reserve(request);
    expect(service.takeFreshDraft(draft)).toBe(false);
    const token = service.prepare(request);
    const prepared = service.consume(token, request.projectUid, request.agentId);
    if (!prepared) throw new Error('Missing synthetic handoff');
    expect(service.takeFreshDraft(prepared.pending)).toBe(true);
    expect(service.takeFreshDraft(prepared.pending)).toBe(false);
    const resumed = service.prepare(request, true);
    const restored = service.consume(resumed, request.projectUid, request.agentId);
    if (!restored) throw new Error('Missing synthetic restored handoff');
    expect(service.takeFreshDraft(restored.pending)).toBe(false);
  });

  it('keeps in-memory recovery when localStorage refuses a write', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic quota');
    });
    service.reserve(request);
    expect(service.load(request.projectUid, request.agentId)?.request.answers).toEqual(request.answers);
    write.mockRestore();
  });
});
