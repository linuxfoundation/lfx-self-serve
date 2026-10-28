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
  MKTG_RUN_QUESTIONS_ID_REGEX,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_COMMENT_ID_REGEX,
  MKTG_STARTED_RUN_ID_REGEX,
} from '@lfx-one/shared/constants';
import {
  MktgGenerateRequest,
  MktgPendingGeneration,
  MktgPreparedGeneration,
  MktgStoredPendingGeneration,
  MktgPendingRedraftIntent,
  MktgDocumentCommentScope,
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
  private readonly redrafts = new Map<string, MktgPendingRedraftIntent>();

  public subject(): string {
    return this.user.user()?.sub ?? '';
  }

  /** URL token names an in-memory request only; it contains no source text or owner proof. */
  public prepare(request: MktgGenerateRequest, resume = false): string {
    if (!isPlatformBrowser(this.platformId) || !this.subject()) {
      return '';
    }
    if (
      request.intake.oneOffDocument &&
      (!resume || !request.documentId || request.documentId === MKTG_LIVING_DOCUMENT_ID || !MKTG_DOCUMENT_ID_REGEX.test(request.documentId))
    )
      return '';
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
        (!documentId ||
          documentId === MKTG_LIVING_DOCUMENT_ID ||
          !MKTG_DOCUMENT_ID_REGEX.test(documentId) ||
          prepared.pending.request.documentId !== documentId ||
          (prepared.pending.attempt ? prepared.pending.attempt.documentId !== documentId : prepared.pending.state !== 'failed'))) ||
      !Number.isFinite(Date.parse(prepared.pending.updatedAt)) ||
      Date.now() - Date.parse(prepared.pending.updatedAt) > MKTG_RUN_STORAGE_TTL_MS
    ) {
      return null;
    }
    this.prepared.delete(token);
    return prepared;
  }

  /** Questions OR failed-intake re-entry use this same destination-bound map; a failed public hint grants no Generate/poll capability. */
  public consumeQuestions(token: string, projectUid: string, agentId: string): MktgPreparedGeneration | null {
    const pending = this.prepared.get(token)?.pending;
    if (!pending || (pending.state !== 'failed' && (pending.state !== 'questions' || !pending.pendingQuestions))) return null;
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

  /** Persist the exact ID-only nonce before POST. Restoring it NEVER grants a new session/automatic send. */
  public saveRedraft(value: MktgPendingRedraftIntent, subject = this.subject()): void {
    if (!isPlatformBrowser(this.platformId) || !subject || subject !== this.subject()) return;
    const key = this.redraftKey(value.scope, subject);
    const frozen = { ...value, scope: { ...value.scope }, commentIds: [...value.commentIds] };
    this.redrafts.set(key, frozen);
    try {
      window.localStorage.setItem(key, JSON.stringify(frozen));
    } catch {
      /* Memory retains the same nonce; never regenerate after uncertain POST. */
    }
  }

  public loadRedraft(scope: MktgDocumentCommentScope): MktgPendingRedraftIntent | null {
    if (!isPlatformBrowser(this.platformId) || !this.subject()) return null;
    const key = this.redraftKey(scope, this.subject());
    try {
      const raw = this.redrafts.get(key) ?? (JSON.parse(window.localStorage.getItem(key) ?? 'null') as MktgPendingRedraftIntent | null);
      if (!raw) return null;
      const same =
        raw.scope?.projectUid === scope.projectUid &&
        raw.scope?.agentKey === scope.agentKey &&
        raw.scope?.documentId === scope.documentId &&
        raw.scope?.revisionId === scope.revisionId;
      const age = typeof raw.updatedAt === 'string' ? Date.now() - Date.parse(raw.updatedAt) : NaN;
      const stale = !Number.isFinite(age) || age < 0 || age > MKTG_RUN_STORAGE_TTL_MS;
      const valid =
        same &&
        Object.hasOwn(MKTG_DOCUMENT_COMMENT_LIMITS, scope.agentKey) &&
        typeof raw.clientRequestId === 'string' &&
        MKTG_DOCUMENT_COMMENT_ID_REGEX.test(raw.clientRequestId) &&
        Array.isArray(raw.commentIds) &&
        raw.commentIds.length > 0 &&
        raw.commentIds.length <= MKTG_DOCUMENT_COMMENT_LIMITS[scope.agentKey] &&
        raw.commentIds.every((id) => typeof id === 'string' && MKTG_DOCUMENT_COMMENT_ID_REGEX.test(id)) &&
        new Set(raw.commentIds).size === raw.commentIds.length &&
        Number.isSafeInteger(raw.priorVersion) &&
        raw.priorVersion > 0 &&
        raw.priorVersion < Number.MAX_SAFE_INTEGER;
      if (
        !valid ||
        (!stale &&
          raw.attempt &&
          (!MKTG_STARTED_RUN_ID_REGEX.test(raw.attempt.runId ?? '') ||
            typeof raw.attempt.session?.sessionId !== 'string' ||
            !raw.attempt.session.sessionId ||
            typeof raw.attempt.session.ownerToken !== 'string' ||
            !raw.attempt.session.ownerToken ||
            raw.attempt.priorVersion !== raw.priorVersion))
      ) {
        this.clearRedraft(scope);
        return null;
      }
      if (stale) {
        const retained: MktgPendingRedraftIntent = {
          scope: { ...raw.scope },
          clientRequestId: raw.clientRequestId,
          commentIds: [...raw.commentIds],
          priorVersion: raw.priorVersion,
          updatedAt: Number.isFinite(age) ? raw.updatedAt : new Date(0).toISOString(),
          releaseAllowed: raw.releaseAllowed === true,
        };
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* Memory still retains the ID-only recovery. */
        }
        this.saveRedraft(retained);
        return retained;
      }
      return raw;
    } catch {
      this.clearRedraft(scope);
      return null;
    }
  }

  public clearRedraft(scope: MktgDocumentCommentScope, subject = this.subject()): void {
    if (!isPlatformBrowser(this.platformId) || !subject) return;
    const key = this.redraftKey(scope, subject);
    this.redrafts.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* No cross-visit recovery if unavailable. */
    }
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
    const answeredQuestionsId = value.answered?.questionsId || value.answeredQuestionsId;
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
        ...(oneOff && MKTG_RUN_QUESTIONS_ID_REGEX.test(answeredQuestionsId ?? '') && { answeredQuestionsId }),
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

  public load(project: string, agentId: string): MktgPendingGeneration | null {
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
          (!documentId ||
            documentId === MKTG_LIVING_DOCUMENT_ID ||
            !MKTG_DOCUMENT_ID_REGEX.test(documentId) ||
            (parsed.attempt ? parsed.attempt.documentId !== documentId : parsed.state !== 'failed'))) ||
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
          MKTG_RUN_QUESTIONS_ID_REGEX.test(parsed.answeredQuestionsId ?? '') && { answeredQuestionsId: parsed.answeredQuestionsId }),
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

  private redraftKey(scope: MktgDocumentCommentScope, subject: string): string {
    return `${MKTG_PENDING_RUN_STORAGE_KEY_PREFIX}:redraft:${subject}:${scope.projectUid}:${scope.agentKey}:${scope.documentId}:${scope.revisionId}`;
  }

  private key(project: string, agentId: string, subject: string, documentId?: string): string {
    return `${MKTG_PENDING_RUN_STORAGE_KEY_PREFIX}:${subject}:${project}:${agentId}${documentId ? `:${documentId}` : ''}`;
  }
}
