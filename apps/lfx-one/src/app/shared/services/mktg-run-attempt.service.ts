// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  MKTG_AGENT_INTAKES,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_PENDING_RUN_STORAGE_KEY_PREFIX,
  MKTG_RUN_STORAGE_TTL_MS,
  MKTG_STARTED_RUN_ID_REGEX,
} from '@lfx-one/shared/constants';
import {
  MktgGenerateRequest,
  MktgPendingGeneration,
  MktgPreparedGeneration,
  MktgStoredPendingGeneration,
  MktgRunSessionResponse,
} from '@lfx-one/shared/interfaces';
import { UserService } from './user.service';

/** Private recovery only. A server run remains authoritative across browsers; never infer completion from this cache. */
@Injectable({ providedIn: 'root' })
export class MktgRunAttemptService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly user = inject(UserService);
  private readonly memory = new Map<string, MktgPendingGeneration>();
  /** Same-visit inputs survive successful recovery cleanup, never localStorage or a new session. */
  private readonly inputMemory = new Map<string, MktgPendingGeneration>();
  private readonly prepared = new Map<string, MktgPreparedGeneration>();
  private readonly freshDrafts = new WeakMap<MktgPendingGeneration, string>();

  public subject(): string {
    return this.user.user()?.sub ?? '';
  }

  /** URL token names an in-memory request only; it contains no source text or owner proof. */
  public prepare(request: MktgGenerateRequest, resume = false): string {
    if (!isPlatformBrowser(this.platformId) || !this.subject()) {
      return '';
    }
    if (request.intake.oneOffDocument && (!resume || !request.documentId)) return '';
    const pending = (resume ? this.load(request.projectUid, request.agentId, request.documentId) : null) ?? this.reserve(request);
    const token = `generation-${window.crypto.randomUUID()}`;
    this.prepared.set(token, { subject: this.subject(), pending });
    if (!resume) this.freshDrafts.set(pending, this.subject());
    return token;
  }

  /** Dedicated Generate already ACKed: explicitly project its minimal proof into the existing handoff map. */
  public prepareAccepted(request: MktgGenerateRequest, session: MktgRunSessionResponse): string {
    if (
      !request.intake.oneOffDocument ||
      !request.intake.tracksDocumentRun ||
      !session.documentId ||
      !MKTG_DOCUMENT_ID_REGEX.test(session.documentId) ||
      session.documentId === MKTG_LIVING_DOCUMENT_ID ||
      !session.runId ||
      !MKTG_STARTED_RUN_ID_REGEX.test(session.runId) ||
      !session.sessionId ||
      !session.ownerToken ||
      !isPlatformBrowser(this.platformId) ||
      !this.subject()
    )
      return '';
    const scoped = { ...request, documentId: session.documentId };
    this.save({
      request: scoped,
      state: 'writing',
      updatedAt: new Date().toISOString(),
      attempt: {
        documentId: session.documentId,
        runId: session.runId,
        priorVersion: 0,
        session: { agentId: request.agentId, sessionId: session.sessionId, ownerToken: session.ownerToken },
      },
    });
    return this.prepare(scoped, true);
  }

  public consume(token: string, projectUid: string, agentId: string, documentId?: string): MktgPreparedGeneration | null {
    const prepared = this.prepared.get(token);
    if (
      !prepared ||
      prepared.subject !== this.subject() ||
      prepared.pending.request.projectUid !== projectUid ||
      prepared.pending.request.agentId !== agentId ||
      (prepared.pending.request.intake.oneOffDocument &&
        (!documentId || prepared.pending.request.documentId !== documentId || prepared.pending.attempt?.documentId !== documentId)) ||
      !Number.isFinite(Date.parse(prepared.pending.updatedAt)) ||
      Date.now() - Date.parse(prepared.pending.updatedAt) > MKTG_RUN_STORAGE_TTL_MS
    ) {
      return null;
    }
    this.prepared.delete(token);
    return prepared;
  }

  /** Intake questions use the destination retained in the same opaque handoff, not another URL parameter. */
  public consumeQuestions(token: string, projectUid: string, agentId: string): MktgPreparedGeneration | null {
    const pending = this.prepared.get(token)?.pending;
    if (pending?.state !== 'questions' || !pending.pendingQuestions) return null;
    return this.consume(token, projectUid, agentId, pending.request.documentId);
  }

  /** Single-use object provenance: storage/reserve alone never grants a Generate handoff. */
  public takeFreshDraft(pending: MktgPendingGeneration): boolean {
    const subject = this.freshDrafts.get(pending);
    this.freshDrafts.delete(pending);
    if (!subject || subject !== this.subject() || pending.state !== 'draft') return false;
    const elapsed = Date.now() - Date.parse(pending.updatedAt);
    return Number.isFinite(elapsed) && elapsed <= MKTG_RUN_STORAGE_TTL_MS;
  }

  /** Cancel a pending navigation without deleting the user's recoverable intake draft. */
  public discard(token: string): void {
    const prepared = this.prepared.get(token);
    if (prepared) this.freshDrafts.delete(prepared.pending);
    this.prepared.delete(token);
  }

  public reserve(request: MktgGenerateRequest): MktgPendingGeneration {
    const pending: MktgPendingGeneration = { request, state: 'draft', updatedAt: new Date().toISOString() };
    this.save(pending);
    return pending;
  }

  public save(pending: MktgPendingGeneration, subject = this.subject()): void {
    if (!subject || subject !== this.subject() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    const key = this.key(pending.request.projectUid, pending.request.agentId, subject, pending.request.documentId);
    const oneOff = pending.request.intake.oneOffDocument === true;
    const value = { ...pending, updatedAt: new Date().toISOString() };
    this.memory.set(key, value);
    this.inputMemory.set(key, value);
    try {
      const stored: MktgStoredPendingGeneration = {
        request: {
          agentId: value.request.agentId,
          projectUid: value.request.projectUid,
          answers: oneOff ? {} : { ...value.request.answers },
          ...(value.request.documentId && { documentId: value.request.documentId }),
          ...(!oneOff && value.request.feedback !== undefined && { feedback: value.request.feedback }),
        },
        state: value.state,
        updatedAt: value.updatedAt,
        ...(value.attempt && {
          attempt: {
            session: { agentId: value.request.agentId, sessionId: value.attempt.session.sessionId, ownerToken: value.attempt.session.ownerToken },
            priorVersion: value.attempt.priorVersion,
            ...(value.attempt.runId && { runId: value.attempt.runId }),
            ...(value.attempt.documentId && { documentId: value.attempt.documentId }),
            ...(!oneOff && value.attempt.readme && { readme: value.attempt.readme }),
          },
        }),
        ...(!oneOff && value.pendingQuestions && { pendingQuestions: value.pendingQuestions }),
        ...(!oneOff && value.answered && { answered: value.answered }),
        ...(oneOff &&
          (value.answered?.questionsId || value.answeredQuestionsId) && { answeredQuestionsId: value.answered?.questionsId || value.answeredQuestionsId }),
        requiresReattachment: !!(value.requiresReattachment || value.request.documents?.length || value.request.logoFiles?.length),
      };
      window.localStorage.setItem(key, JSON.stringify(stored));
    } catch {
      /* Memory remains authoritative for this visit. */
    }
  }

  /** Peek at source inputs without consuming a token, reserving, or changing a live attempt. */
  public lastInputs(project: string, agentId: string, documentId?: string): MktgGenerateRequest | null {
    if (!this.subject() || !isPlatformBrowser(this.platformId)) return null;
    const key = this.key(project, agentId, this.subject(), documentId);
    const value = this.inputMemory.get(key);
    const elapsed = value ? Date.now() - Date.parse(value.updatedAt) : NaN;
    if (!value || !Number.isFinite(elapsed) || elapsed > MKTG_RUN_STORAGE_TTL_MS) {
      this.inputMemory.delete(key);
      return null;
    }
    return value.request;
  }

  public load(project: string, agentId: string, documentId?: string): MktgPendingGeneration | null {
    if (!this.subject() || !isPlatformBrowser(this.platformId)) {
      return null;
    }
    const key = this.key(project, agentId, this.subject(), documentId);
    const cached = this.memory.get(key);
    if (cached) {
      return cached;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as MktgStoredPendingGeneration;
      if (
        parsed.request?.projectUid !== project ||
        parsed.request.agentId !== agentId ||
        parsed.request.documentId !== documentId ||
        (MKTG_AGENT_INTAKES[agentId]?.oneOffDocument &&
          (!documentId || !MKTG_DOCUMENT_ID_REGEX.test(documentId) || parsed.attempt?.documentId !== documentId)) ||
        !parsed.request.answers ||
        !MKTG_AGENT_INTAKES[agentId] ||
        !Number.isFinite(Date.parse(parsed.updatedAt)) ||
        Date.now() - Date.parse(parsed.updatedAt) > MKTG_RUN_STORAGE_TTL_MS
      ) {
        this.clear(project, agentId, this.subject(), documentId);
        return null;
      }
      // The live registry, never a serialized endpoint/config, decides where a resumed attempt calls.
      const restored: MktgPendingGeneration = {
        request: {
          agentId,
          projectUid: project,
          intake: MKTG_AGENT_INTAKES[agentId],
          answers: MKTG_AGENT_INTAKES[agentId].oneOffDocument ? {} : { ...parsed.request.answers },
          ...(documentId && { documentId }),
          ...(!MKTG_AGENT_INTAKES[agentId].oneOffDocument && parsed.request.feedback !== undefined && { feedback: parsed.request.feedback }),
        },
        state: parsed.state,
        updatedAt: parsed.updatedAt,
        requiresReattachment: parsed.requiresReattachment === true,
        ...(parsed.attempt && { attempt: parsed.attempt }),
        ...(!MKTG_AGENT_INTAKES[agentId].oneOffDocument && parsed.pendingQuestions && { pendingQuestions: parsed.pendingQuestions }),
        ...(!MKTG_AGENT_INTAKES[agentId].oneOffDocument && parsed.answered && { answered: parsed.answered }),
        ...(MKTG_AGENT_INTAKES[agentId].oneOffDocument &&
          /^[a-f0-9]{64}$/.test(parsed.answeredQuestionsId ?? '') && { answeredQuestionsId: parsed.answeredQuestionsId }),
      };
      this.memory.set(key, restored);
      return restored;
    } catch {
      return null;
    }
  }

  public clear(project: string, agentId: string, subject = this.subject(), documentId?: string): void {
    if (!subject || subject !== this.subject() || !isPlatformBrowser(this.platformId)) {
      return;
    }
    const key = this.key(project, agentId, subject, documentId);
    this.memory.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* No cross-visit restore when storage is disabled. */
    }
  }

  private key(project: string, agentId: string, subject: string, documentId?: string): string {
    return `${MKTG_PENDING_RUN_STORAGE_KEY_PREFIX}:${subject}:${project}:${agentId}${documentId ? `:${documentId}` : ''}`;
  }
}
