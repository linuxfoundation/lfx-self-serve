// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FOUNDATION_MESSAGE_INTAKE, LINKEDIN_POST_INTAKE, MKTG_RUN_STORAGE_TTL_MS } from '@lfx-one/shared/constants';
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

  it('restores only the exact subject/revision redraft nonce, with no source text or serialized endpoint', () => {
    const scope = { projectUid: request.projectUid, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
    const intent = { scope, clientRequestId: 'send-one', commentIds: ['comment-one'], priorVersion: 1, updatedAt: new Date().toISOString() };
    service.saveRedraft(intent);
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService());
    expect(restored.loadRedraft(scope)).toEqual(intent);
    expect(restored.loadRedraft({ ...scope, revisionId: `000002-${'b'.repeat(64)}` })).toBeNull();
    user.set({ sub: 'other-synthetic' } as User);
    expect(restored.loadRedraft(scope)).toBeNull();
    user.set({ sub: 'synthetic-subject' } as User);
    service.saveRedraft({
      ...intent,
      updatedAt: new Date(Date.now() - MKTG_RUN_STORAGE_TTL_MS - 1).toISOString(),
      attempt: {
        runId: 'c'.repeat(64),
        priorVersion: 1,
        session: { agentId: request.agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-expired-capability' },
      },
    });
    expect(service.loadRedraft(scope)).toMatchObject({ clientRequestId: intent.clientRequestId, commentIds: intent.commentIds });
    expect(service.loadRedraft(scope)?.attempt).toBeUndefined();
    expect(Object.values(window.localStorage).join('')).not.toContain('synthetic-expired-capability');
  });

  it('keeps redraft intents and document-scoped one-off proofs in disjoint namespaces through reload and cleanup', () => {
    const scope = { projectUid: request.projectUid, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
    const intent = { scope, clientRequestId: 'send-one', commentIds: ['comment-one'], priorVersion: 1, updatedAt: new Date().toISOString() };
    service.saveRedraft(intent);
    const oneOff = { ...request, agentId: LINKEDIN_POST_INTAKE.agentId, intake: LINKEDIN_POST_INTAKE, documentId: 'run-' + 'b'.repeat(24), answers: {} };
    service.prepareAccepted(oneOff, { documentId: oneOff.documentId, runId: 'c'.repeat(64), sessionId: 'synthetic-oneoff', ownerToken: 'synthetic-proof' });
    expect(localStorage.length).toBe(2);
    expect(service['redraftKey'](scope, service.subject())).toContain(':redraft:');
    expect(service['redraftKey'](scope, service.subject())).not.toBe(service['key'](scope.projectUid, scope.agentKey, service.subject(), scope.documentId));
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService());
    expect(restored.loadRedraft(scope)).toEqual(intent);
    expect(restored.load(oneOff.projectUid, oneOff.agentId, oneOff.documentId)?.attempt?.session.sessionId).toBe('synthetic-oneoff');
    restored.clearRedraft(scope);
    expect(restored.load(oneOff.projectUid, oneOff.agentId, oneOff.documentId)).not.toBeNull();
    restored.saveRedraft(intent);
    restored.clear(oneOff.projectUid, oneOff.agentId, restored.subject(), oneOff.documentId);
    expect(restored.loadRedraft(scope)).toEqual(intent);
  });

  it.each(['a'.repeat(64), 'b'.repeat(8), 'invalid-digest'])('validates a one-off answered digest at save and reload: %s', (digest) => {
    const accepted = { ...request, agentId: LINKEDIN_POST_INTAKE.agentId, intake: LINKEDIN_POST_INTAKE, documentId: 'run-' + 'a'.repeat(24), answers: {} };
    service.save({
      request: accepted,
      state: 'writing',
      updatedAt: new Date().toISOString(),
      answeredQuestionsId: digest,
      attempt: {
        documentId: accepted.documentId,
        runId: 'c'.repeat(64),
        session: { agentId: accepted.agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' },
        priorVersion: 0,
      },
    });
    const stored = JSON.parse(localStorage.getItem(localStorage.key(0) ?? '') ?? '{}');
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService()).load(request.projectUid, accepted.agentId, accepted.documentId);
    const expected = digest === 'invalid-digest' ? undefined : digest;
    expect(stored.answeredQuestionsId).toBe(expected);
    expect(restored?.answeredQuestionsId).toBe(expected);
  });

  it('projects an accepted one-off into a single-use document-scoped handoff, never a fresh Generate draft', () => {
    const accepted = { ...request, agentId: LINKEDIN_POST_INTAKE.agentId, intake: LINKEDIN_POST_INTAKE, answers: { content_text: 'private-source' } };
    const run = { documentId: 'run-' + 'a'.repeat(24), runId: 'b'.repeat(64), sessionId: 'synthetic-session', ownerToken: 'synthetic-capability' };
    expect(service.prepare(accepted)).toBe('');
    expect(service.prepareAccepted(accepted, { ...run, documentId: 'living' })).toBe('');
    const token = service.prepareAccepted(accepted, run);
    expect(token).toMatch(/^generation-/);
    expect(service.consume(token, request.projectUid, accepted.agentId, 'run-' + 'c'.repeat(24))).toBeNull();
    const prepared = service.consume(token, request.projectUid, accepted.agentId, run.documentId);
    expect(prepared?.pending).toMatchObject({
      state: 'writing',
      request: { documentId: run.documentId },
      attempt: { documentId: run.documentId, runId: run.runId },
    });
    if (!prepared) throw new Error('Missing synthetic accepted handoff');
    expect(service.takeFreshDraft(prepared.pending)).toBe(false);
    expect(service.consume(token, request.projectUid, accepted.agentId, run.documentId)).toBeNull();
    expect(service.load(request.projectUid, accepted.agentId)).toBeNull();
  });

  it('uses the same map for a failed public intake hint after reload without granting Generate provenance', () => {
    const failed = { ...request, agentId: LINKEDIN_POST_INTAKE.agentId, intake: LINKEDIN_POST_INTAKE, documentId: 'run-' + 'a'.repeat(24), answers: {} };
    service.save({ request: failed, state: 'failed', updatedAt: new Date().toISOString() });
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService());
    expect(restored.prepare({ ...failed, documentId: 'living' }, true)).toBe('');
    expect(restored.prepare({ ...failed, documentId: 'invalid' }, true)).toBe('');
    const token = restored.prepare(failed, true);
    const hint = restored.consumeQuestions(token, failed.projectUid, failed.agentId)?.pending;
    expect(hint?.state).toBe('failed');
    expect(hint?.attempt).toBeUndefined();
    if (!hint) throw new Error('Missing synthetic hint');
    expect(restored.takeFreshDraft(hint)).toBe(false);
    expect(restored.consumeQuestions(token, failed.projectUid, failed.agentId)).toBeNull();
  });

  it('consumes a one-off questions handoff on the intake using its retained destination and subject', () => {
    const accepted = { ...request, agentId: LINKEDIN_POST_INTAKE.agentId, intake: LINKEDIN_POST_INTAKE, answers: {} };
    const documentId = 'run-' + 'a'.repeat(24);
    const token = service.prepareAccepted(accepted, { documentId, runId: 'b'.repeat(64), sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' });
    expect(service.consumeQuestions(token, request.projectUid, accepted.agentId)).toBeNull();
    const pending = service.load(request.projectUid, accepted.agentId, documentId);
    if (!pending?.attempt) throw new Error('Missing synthetic accepted proof');
    service.save({ ...pending, state: 'questions', pendingQuestions: { attempt: pending.attempt, questionsId: 'c'.repeat(64), questions: [] } });
    const questions = service.prepare({ ...accepted, documentId }, true);
    expect(service.consumeQuestions(questions, 'other-project', accepted.agentId)).toBeNull();
    expect(service.consumeQuestions(questions, request.projectUid, accepted.agentId)?.pending.request.documentId).toBe(documentId);
    expect(service.consumeQuestions(questions, request.projectUid, accepted.agentId)).toBeNull();
  });

  it('keeps independent one-off proofs per document and only digests/capabilities across reload', () => {
    const first = 'run-' + 'a'.repeat(24);
    const second = 'run-' + 'b'.repeat(24);
    const accepted = {
      ...request,
      agentId: LINKEDIN_POST_INTAKE.agentId,
      intake: LINKEDIN_POST_INTAKE,
      documentId: first,
      answers: { content_text: 'private-source' },
      feedback: 'private-feedback',
    };
    const run = {
      documentId: first,
      runId: 'c'.repeat(64),
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-capability',
      retryInputs: { setup: 'private-setup' },
      source: 'private-source-label',
    };
    service.prepareAccepted(accepted, run);
    const pending = service.load(request.projectUid, accepted.agentId, first);
    if (!pending) throw new Error('Missing synthetic accepted proof');
    service.save({
      ...pending,
      answered: {
        questions: [{ key: 'gap', question: 'private-question', label: 'Gap', why: '', suggestedAnswer: '', basis: [] }],
        answers: [{ key: 'gap', text: 'private-answer', origin: 'requester' }],
        questionsId: 'd'.repeat(64),
      },
    });
    service.prepareAccepted(accepted, { ...run, documentId: second, sessionId: 'other-session' });
    const serialized = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index) ?? '')).join('');
    for (const text of ['private-source', 'private-feedback', 'private-question', 'private-answer', 'private-setup', 'private-source-label', 'retryInputs'])
      expect(serialized).not.toContain(text);
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService());
    expect(restored.load(request.projectUid, accepted.agentId, first)).toMatchObject({
      answeredQuestionsId: 'd'.repeat(64),
      request: { answers: {}, documentId: first },
    });
    expect(restored.load(request.projectUid, accepted.agentId, first)?.answered).toBeUndefined();
    expect(restored.load(request.projectUid, accepted.agentId, first)?.pendingQuestions).toBeUndefined();
    expect(restored.load(request.projectUid, accepted.agentId, second)?.attempt?.session.sessionId).toBe('other-session');
    restored.clear(request.projectUid, accepted.agentId, restored.subject(), first);
    expect(restored.load(request.projectUid, accepted.agentId, first)).toBeNull();
    expect(restored.load(request.projectUid, accepted.agentId, second)).not.toBeNull();
    user.set({ sub: 'another-subject' } as User);
    expect(restored.load(request.projectUid, accepted.agentId, second)).toBeNull();
  });

  it('keeps completed source payloads for same-visit reuse without retaining a recoverable attempt or persisting bytes', () => {
    const uploaded = { ...request, documents: [{ kind: 'file' as const, title: 'synthetic.txt', text: 'private-source' }] };
    service.reserve(uploaded);
    service.clear(request.projectUid, request.agentId);
    expect(service.load(request.projectUid, request.agentId)).toBeNull();
    expect(service.lastInputs(request.projectUid, request.agentId)).toBe(uploaded);
    expect(window.localStorage.length).toBe(0);
    expect(TestBed.runInInjectionContext(() => new MktgRunAttemptService()).lastInputs(request.projectUid, request.agentId)).toBeNull();
    user.set({ sub: 'other-subject' } as User);
    expect(service.lastInputs(request.projectUid, request.agentId)).toBeNull();
  });

  it('does not reuse inputs across project/agent boundaries or after the input TTL', () => {
    service.reserve(request);
    expect(service.lastInputs('other-project', request.agentId)).toBeNull();
    expect(service.lastInputs(request.projectUid, 'other-agent')).toBeNull();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + MKTG_RUN_STORAGE_TTL_MS + 1);
    expect(service.lastInputs(request.projectUid, request.agentId)).toBeNull();
    clock.mockRestore();
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
