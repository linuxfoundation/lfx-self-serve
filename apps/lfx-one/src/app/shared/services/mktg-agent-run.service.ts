// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS, MKTG_RUN_POLL, MKTG_RUN_STORAGE_KEY_PREFIX, MKTG_RUN_STORAGE_TTL_MS } from '@lfx-one/shared/constants';
import {
  MktgAgentIntake,
  MktgChatRequest,
  MktgChatResponse,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgRunAnswer,
  MktgRunAnswersBody,
  MktgRunAnswersResponse,
  MktgPreparedGeneration,
  MktgReadmeOutcome,
  MktgRunAttempt,
  MktgRunGenerateBody,
  MktgRunQuestionsPending,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
  MktgRunVersion,
  MktgSessionInfo,
  MktgStoredAgentRun,
} from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import {
  catchError,
  concat,
  concatMap,
  defer,
  EMPTY,
  exhaustMap,
  filter,
  map,
  Observable,
  of,
  switchMap,
  take,
  takeWhile,
  tap,
  throwError,
  timer,
  TimeoutError,
} from 'rxjs';

import { isTransientHttpError } from '@shared/utils/http-error.utils';

import { UserService } from './user.service';

/**
 * Form-first agent runs for the Marketing OS marketplace. A first run submits
 * the batch intake answers to the agent's validated generate endpoint (the BFF
 * renders the batch message server-side); a follow-up — edit-inputs
 * resubmit or feedback regeneration — takes one of three paths, per the
 * intake's flags: default intakes post the full form plus the stored run's
 * prior version (and feedback, when given) on the run's EXISTING Guild
 * session via the chat/session BFF; `regenerateViaGenerate` intakes (e.g. the
 * ICP) send the same through the validated generate endpoint on a FRESH
 * session, replacing the stored run's session while keeping its version
 * history; and `freshRunPerSubmission` intakes (the Messaging Document) send
 * every submission as a fresh first-run generate with no prior version or
 * feedback. Revisions are numbered by the document store and shown in the
 * document view. An agent that researches
 * first (the Messaging Document) may answer the poll with `questions` instead
 * of a document: the run stops at a questions step, and `answerQuestions`
 * sends the answers to the SAME session and polls on. Either way the
 * document comes exclusively
 * from the agent's result endpoint, which returns only schema-validated,
 * sha256-verified envelopes — raw chat text is never treated as the document.
 * Each run (session + answers + versions) persists in localStorage, keyed to
 * the EFFECTIVE user (login/impersonation swaps `user` without a reload — the
 * user-keyed invalidation precedent in user.service.ts), so one user's stored
 * session — whose ownerToken is HMAC-bound to their sub — can never be replayed
 * as another's. Persistence is time-bounded (`MKTG_RUN_STORAGE_TTL_MS`): the
 * record carries the session's capability ownerToken, so expired records are
 * pruned on load instead of lingering at rest indefinitely. If a stored session still turns stale (the server 401/403s the
 * follow-up), the run drops it and falls back to a fresh session instead of
 * dead-ending the user.
 */
@Injectable({ providedIn: 'root' })
export class MktgAgentRunService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userService = inject(UserService);

  /**
   * In-memory runs, keyed exactly like localStorage. The authoritative record
   * for THIS page session: `loadRun` prefers it, so when `setItem` fails
   * (quota, disabled storage) the next follow-up still derives its version
   * directive and poll gate from the run the user is looking at — persistence
   * loss only ever costs cross-visit restore, never in-session correctness.
   */
  private readonly memoryRuns = new Map<string, MktgStoredAgentRun>();
  private prepared: MktgPreparedGeneration | null = null;
  private preparedId = 0;

  /** A single-use, subject-bound handoff. The document view, not the intake, owns the polling subscription. */
  public prepareGeneration(request: MktgGenerateRequest): string {
    this.prepared = { userSub: this.userService.user()?.sub ?? '', request };
    return String(++this.preparedId);
  }

  public takePreparedGeneration(id: string, projectUid: string, agentId: string): MktgGenerateRequest | null {
    const prepared = this.prepared;
    if (
      !prepared ||
      id !== String(this.preparedId) ||
      !prepared.userSub ||
      prepared.userSub !== this.userService.user()?.sub ||
      prepared.request.projectUid !== projectUid ||
      prepared.request.agentId !== agentId
    ) {
      return null;
    }
    this.prepared = null;
    return prepared.request;
  }

  /** Resume a pending result poll after reloading or returning to its document. */
  public resumeGeneration(projectUid: string, agentId: string, intake: MktgAgentIntake): Observable<MktgGenerateProgress> | null {
    const stored = this.loadRun(projectUid, agentId);
    if (!stored?.pendingAttempt) {
      return null;
    }
    return this.finishAttempt({ projectUid, agentId, intake, answers: stored.answers }, stored.pendingAttempt);
  }

  /** Explicit user retry, including a terminally failed attempt that normal document opens must not resume. */
  public retryGeneration(projectUid: string, agentId: string, intake: MktgAgentIntake): Observable<MktgGenerateProgress> | null {
    const stored = this.loadRun(projectUid, agentId);
    const attempt = stored?.failedAttempt ?? stored?.pendingAttempt;
    if (!stored || !attempt) {
      return null;
    }
    return defer(() => {
      this.saveRun({ ...stored, pendingAttempt: attempt, failedAttempt: undefined });
      return this.finishAttempt({ projectUid, agentId, intake, answers: stored.answers }, attempt);
    });
  }

  /**
   * Generates (or regenerates) an agent document. Emits, in order:
   *
   * - `submitted` — the generate/chat POST resolved.
   * - `questions` — INSTEAD of a document, and last: the agent asks the gaps
   *   it could not settle from the sources. The run continues through
   *   {@link answerQuestions} on the same session.
   * - `document` — the validated document landed, with the updated stored run.
   * - `persisted` — OPTIONAL and last: the server-side copy exists. Emitted
   *   only for agents that persist their document (`persistsDocument`) whose
   *   ready result carried no persistence receipt and whose retry later got
   *   one. A subscriber that resolves anything from the SERVER copy has to
   *   handle it — dependency gating does — because at `document` time the
   *   server may still be serving the previous version.
   *
   * The stream therefore stays open a little longer than the document for
   * those agents: `retryPersistence` spends a small bounded budget of extra
   * polls so a transient storage failure still ends with the server copy
   * written. The document view keeps its generating/saving state until the
   * receipt identifies the stored revision; on a later run the previous
   * revision remains visible meanwhile. Cancelling the subscription (project
   * switch, a new submission, leaving the page) cancels the retry with it.
   */
  public generate(request: MktgGenerateRequest): Observable<MktgGenerateProgress> {
    if (request.answersRound) {
      const { pending, answers, submitted } = request.answersRound;
      return submitted
        ? concat(
            of<MktgGenerateProgress>({ type: 'submitted' }),
            this.awaitOutcome(request, pending.attempt, { questions: pending.questions, answers, questionsId: pending.questionsId })
          )
        : this.answerQuestions(request, pending, answers);
    }
    const stored = this.loadRun(request.projectUid, request.agentId);
    const startedAt = request.startedAt ?? new Date().toISOString();
    let attempt$: Observable<MktgRunAttempt>;
    if (!stored || request.intake.freshRunPerSubmission) {
      // `freshRunPerSubmission` intakes (the Messaging Document) carry no
      // prior version or feedback: every submission is a first run on a fresh
      // session, appended to the stored run's history by `appendVersion`.
      attempt$ = this.startRun(request);
    } else if (request.intake.regenerateViaGenerate) {
      attempt$ = this.resubmitRun(request, stored);
    } else {
      attempt$ = this.followUp(request, stored);
    }

    return attempt$.pipe(
      switchMap((attempt) => {
        const pendingAttempt = { ...attempt, startedAt };
        this.saveRun({
          agentId: request.agentId,
          projectUid: request.projectUid,
          answers: request.answers,
          sessionId: attempt.session.sessionId,
          ownerToken: attempt.session.ownerToken,
          versions: this.loadRun(request.projectUid, request.agentId)?.versions ?? [],
          pendingAttempt,
          savedAt: new Date().toISOString(),
        });
        return this.finishAttempt(request, pendingAttempt);
      })
    );
  }

  /**
   * Answers the agent's questions on the SAME session the run started on and
   * polls on for the document. Emits `submitted` once the answers POST
   * resolved, then exactly what {@link generate} emits after its own
   * `submitted` — including, should the agent ask again, another `questions`.
   * The questions and answers are stored with the version they produce.
   *
   * The block just answered is passed as the poll's ignore-id: the result
   * endpoint keeps reporting the session's latest questions block until the
   * agent writes something newer, and that block is the one these answers
   * are for, not a new round.
   */
  public answerQuestions(request: MktgGenerateRequest, pending: MktgRunQuestionsPending, answers: MktgRunAnswer[]): Observable<MktgGenerateProgress> {
    const answersPath = request.intake.endpoints.answers;
    if (!answersPath) {
      return throwError(() => new Error(`The ${request.intake.documentName} agent takes no answers.`));
    }
    const body: MktgRunAnswersBody = {
      sessionId: pending.attempt.session.sessionId,
      ownerToken: pending.attempt.session.ownerToken,
      answers,
      project: request.projectUid,
      questionsId: pending.questionsId,
    };
    return this.http
      .post<MktgRunAnswersResponse>(answersPath, body)
      .pipe(
        switchMap(() =>
          concat(
            of<MktgGenerateProgress>({ type: 'submitted' }),
            this.awaitOutcome(request, pending.attempt, { questions: pending.questions, answers, questionsId: pending.questionsId })
          )
        )
      );
  }

  /** Reads the stored run for a project + agent. Returns null on the server, when signed out, or when nothing is stored. */
  public loadRun(projectUid: string, agentId: string): MktgStoredAgentRun | null {
    if (!isPlatformBrowser(this.platformId) || !projectUid) {
      return null;
    }
    const key = this.storageKey(projectUid, agentId);
    if (!key) {
      return null;
    }
    const cached = this.memoryRuns.get(key);
    if (cached) {
      return cached;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as MktgStoredAgentRun;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.versions) || !parsed.sessionId || !parsed.ownerToken) {
        return null;
      }
      // TTL prune: the persisted record carries the session's capability
      // ownerToken, so it must not linger at rest indefinitely. Past
      // MKTG_RUN_STORAGE_TTL_MS (or with an unreadable savedAt — e.g. a record
      // written before the TTL existed) the record is removed and the user
      // simply starts a fresh run. The in-memory cache above is exempt: it
      // only lives for this page session and its token is actively in use.
      const savedAtMs = Date.parse(parsed.savedAt ?? '');
      if (Number.isNaN(savedAtMs) || Date.now() - savedAtMs > MKTG_RUN_STORAGE_TTL_MS) {
        window.localStorage.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private finishAttempt(request: MktgGenerateRequest, attempt: MktgRunAttempt): Observable<MktgGenerateProgress> {
    return concat(of<MktgGenerateProgress>({ type: 'submitted' }), this.awaitOutcome(request, attempt)).pipe(
      catchError((error: unknown) => {
        const stored = this.loadRun(request.projectUid, request.agentId);
        if (stored?.pendingAttempt?.session.sessionId === attempt.session.sessionId) {
          this.saveRun({ ...stored, pendingAttempt: undefined, failedAttempt: attempt });
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * First run: one-shot form-mode generation through the agent's validated
   * generate endpoint. The BFF validates the answers against the agent's own
   * intake schema and renders the batch message server-side. A fresh session
   * has no prior draft, so the result poll's gate is 0.
   */
  private startRun(request: MktgGenerateRequest): Observable<MktgRunAttempt> {
    const body: MktgRunGenerateBody = {
      answers: request.answers,
      project: request.projectUid,
      ...(request.documents?.length && { documents: request.documents }),
    };
    return this.http.post<MktgRunSessionResponse>(request.intake.endpoints.generate, body).pipe(
      map((response) => ({
        session: { agentId: request.agentId, sessionId: response.sessionId, ownerToken: response.ownerToken },
        priorVersion: 0,
        // The BFF reports what its server-side README fetch produced for THIS
        // submission; it travels with the attempt so the version it generates
        // can say it was written without one.
        readme: response.readme,
      }))
    );
  }

  /**
   * Follow-up for `regenerateViaGenerate` intakes (e.g. the Message
   * Foundation): re-running the intake is a full resubmit through the generate
   * endpoint on a fresh Guild session. The BFF re-renders the typed batch
   * payload (re-fetching server-side inputs like the README) with `priorVersion`
   * and optional feedback reserved for the later comments/Revise flow, so
   * the agent finalizes as `priorVersion + 1`, which is exactly the version
   * the result poll's strictly-newer gate accepts. The stored run keeps the
   * version history; only its session is replaced by `appendVersion`.
   */
  private resubmitRun(request: MktgGenerateRequest, stored: MktgStoredAgentRun): Observable<MktgRunAttempt> {
    const priorVersion = stored.versions.at(-1)?.version ?? 0;
    if (priorVersion === 0) {
      // A stored run without versions has nothing to revise — plain first run.
      return this.startRun(request);
    }
    const body: MktgRunGenerateBody = { answers: request.answers, priorVersion, project: request.projectUid };
    if (request.feedback?.trim()) {
      body.feedback = request.feedback.trim();
    }
    return this.http.post<MktgRunSessionResponse>(request.intake.endpoints.generate, body).pipe(
      map((response) => ({
        session: { agentId: request.agentId, sessionId: response.sessionId, ownerToken: response.ownerToken },
        priorVersion,
        // Every resubmit re-fetches the README, so this version's outcome is
        // the fresh one — a corrected URL must not inherit the old verdict.
        readme: response.readme,
      }))
    );
  }

  /**
   * Re-run the intake on the run's existing Guild session: the full form is
   * rendered as the agent's batch message with the prior-version directive
   * so the agent finalizes as v+1, then posted through the chat/session BFF.
   * Optional feedback is retained for the later comments/Revise flow; no
   * current UI supplies it.
   *
   * The stored run's latest version is the single source of truth for BOTH the
   * message's "finalize as version N+1" directive and the result poll's gate —
   * deriving them together means the agent is always told to produce the exact
   * version the poll will accept. (The result endpoint reports the best
   * envelope in the WHOLE session, so on a follow-up the prior draft is
   * already `ready` — only a strictly newer version counts.)
   *
   * Recovery: a 401/403 means the stored session no longer belongs to this
   * browser's effective user (the HMAC-bound ownerToken stopped verifying —
   * e.g. a session written before runs were user-keyed). The stored run is
   * unusable forever, so it is dropped and the submission falls back to a
   * fresh run instead of dead-ending every subsequent submit.
   */
  private followUp(request: MktgGenerateRequest, stored: MktgStoredAgentRun): Observable<MktgRunAttempt> {
    const priorVersion = stored.versions.at(-1)?.version ?? 0;
    const body: MktgChatRequest = {
      agentId: request.agentId,
      project: request.projectUid,
      priorVersion,
      message: renderMktgIntakeMessage(request.intake, request.answers, request.feedback, priorVersion || undefined),
      sessionId: stored.sessionId,
      ownerToken: stored.ownerToken,
    };
    return this.http.post<MktgChatResponse>('/api/mktg-agents/chat', body).pipe(
      map(() => ({ session: { agentId: request.agentId, sessionId: stored.sessionId, ownerToken: stored.ownerToken }, priorVersion })),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
          this.clearRun(request.projectUid, request.agentId);
          return this.startRun(request);
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * What one generate attempt (or one answers round) ends in: the agent's
   * questions, which end the stream, or the document with its stored run and
   * the bounded persistence retry behind it. `answered` is the round the
   * attempt is continuing, when it is one: its block is ignored by the poll
   * and stored with the version.
   */
  private awaitOutcome(
    request: MktgGenerateRequest,
    attempt: MktgRunAttempt,
    answered?: { questions: MktgRunQuestionsPending['questions']; answers: MktgRunAnswer[]; questionsId: string }
  ): Observable<MktgGenerateProgress> {
    return this.pollForOutcome(request.intake, attempt.session, attempt.priorVersion, request.projectUid, answered?.questionsId, attempt.readme).pipe(
      concatMap(({ result, terminal }) => {
        // Intakes with a live feed get the whole feed so far on every poll that changed it, the last one included.
        const activity$ = result.activity && request.intake.liveActivity ? of<MktgGenerateProgress>({ type: 'activity', activity: result.activity }) : EMPTY;
        if (!terminal) {
          return activity$;
        }
        if (result.status === 'failed') {
          const stored = this.loadRun(request.projectUid, request.agentId);
          if (stored?.sessionId === attempt.session.sessionId) {
            this.saveRun({ ...stored, pendingAttempt: undefined, failedAttempt: attempt });
          }
          return concat(activity$, of<MktgGenerateProgress>({ type: 'failed', failureText: result.failureText ?? '' }));
        }
        if (result.status === 'questions') {
          // pollForOutcome let it through, so the block is present and new.
          return concat(
            activity$,
            of<MktgGenerateProgress>({
              type: 'questions',
              pending: { attempt, questionsId: result.questionsId ?? '', questions: result.questions ?? [] },
            })
          );
        }
        return concat(
          activity$,
          of<MktgGenerateProgress>({
            type: 'document',
            run: this.appendVersion(request, attempt, result, answered),
            ...(result.persistence?.document && { location: result.persistence.document }),
          }),
          this.retryPersistence(request, attempt.session, result, attempt.readme)
        );
      })
    );
  }

  /**
   * Polls the agent's validated result endpoint (owner token in the POST body,
   * never the query string) until it reports a `ready` document with a version
   * newer than the prior draft's — or, for intakes with an answers endpoint, a
   * `questions` block other than the one already answered. The endpoint
   * surfaces only schema-validated, sha256-verified envelopes, so agent status
   * chatter can never be mistaken for the document — anything else stays
   * `pending`.
   *
   * A transient failure of one poll attempt (network drop, 408/429, upstream
   * 5xx — the app-wide `isTransientHttpError` policy) must never abort a
   * multi-minute generation whose session may not even be persisted yet, so it
   * degrades to a `pending` tick and the next interval retries; the overall
   * `timeout` still bounds the wait. Non-transient responses (401/403 — the
   * owner token stopped verifying) keep failing fast.
   *
   * `exhaustMap` — never `switchMap` — maps the ticks: a tick that fires while
   * a poll is still in flight is dropped instead of cancelling it. With
   * `switchMap`, result-endpoint latency consistently above the interval would
   * abort every attempt before it resolved, timing out a multi-minute
   * generation whose document may already be ready. The deadline is checked
   * on every tick BEFORE `exhaustMap`, so a poll that never answers (a
   * stalled request has no timeout of its own) cannot hide the deadline
   * behind it: the tick past it errors the stream and tears the request down.
   *
   * The run's project uid rides every poll: agents that persist their output
   * partition storage by the SERVER-resolved project and require the caller's
   * writer grant on it, so the run must say which project it belongs to.
   */
  private pollForOutcome(
    intake: MktgAgentIntake,
    session: MktgSessionInfo,
    priorVersion: number,
    projectUid: string,
    answeredQuestionsId?: string,
    readme?: MktgReadmeOutcome
  ): Observable<{ result: MktgRunResultResponse; terminal: boolean }> {
    const body = this.resultBody(session, projectUid, readme, priorVersion);
    const isDocument = (result: MktgRunResultResponse): boolean =>
      result.status === 'ready' && typeof result.documentMarkdown === 'string' && (result.version ?? 0) > priorVersion;
    const isNewQuestions = (result: MktgRunResultResponse): boolean =>
      !!intake.endpoints.answers &&
      result.status === 'questions' &&
      (result.questions?.length ?? 0) > 0 &&
      !!result.questionsId &&
      result.questionsId !== answeredQuestionsId;
    const isTerminal = (result: MktgRunResultResponse): boolean => result.status === 'failed' || isDocument(result) || isNewQuestions(result);
    return defer(() => {
      // One wall-clock deadline for the whole wait: with a live feed the poll
      // emits along the way, so a per-emission timeout would never fire.
      const deadline = Date.now() + MKTG_RUN_POLL.timeoutMs;
      let lastActivity = '';
      // Only a feed that changed is worth an emission; intakes without a feed emit their terminal result alone.
      const isNewActivity = (result: MktgRunResultResponse): boolean => {
        if (!intake.liveActivity || !result.activity) {
          return false;
        }
        const key = JSON.stringify(result.activity);
        if (key === lastActivity) {
          return false;
        }
        lastActivity = key;
        return true;
      };
      return timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs).pipe(
        tap(() => {
          if (Date.now() > deadline) {
            throw new TimeoutError();
          }
        }),
        exhaustMap(() =>
          this.http.post<MktgRunResultResponse>(intake.endpoints.result, body).pipe(
            catchError((error: unknown) => {
              if (isTransientHttpError(error)) {
                return of<MktgRunResultResponse>({ status: 'pending' });
              }
              return throwError(() => error);
            })
          )
        ),
        takeWhile((result) => !isTerminal(result), true),
        filter((result) => isTerminal(result) || isNewActivity(result)),
        map((result) => ({ result, terminal: isTerminal(result) }))
      );
    });
  }

  /**
   * Bounded background persistence retry for agents whose result endpoint
   * persists the validated document (`intake.persistsDocument`, today the
   * Brand Kit's dec-brand-kit-storage-v2 write path).
   *
   * A `ready` result with NO persistence receipt means the server-side write
   * did not happen — usually a transient object-store failure, which the BFF
   * degrades through (WARN, document still returned) rather than failing the
   * run. Because the write is content-addressed and idempotent, another poll
   * simply re-runs it. Without this, the only copy of the document is this
   * browser's stored run: the project's server copy — what dependency gating
   * reads for every other browser and user (a dependent agent stays locked
   * until it exists) — would be lost to a blip no one ever sees.
   *
   * The validated document is already emitted into the browser run record,
   * but the document view still shows saving until a receipt arrives. Failed
   * retry polls spend the shared `MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS` budget
   * without discarding that local draft; exhaustion lets the view show a save
   * failure. The one `persisted` event carries the receipt's document location
   * when available, then polling stops. That event exists because dependency resolution
   * prefers the SERVER copy over any browser-stored run: a v2 announced while
   * the write was still failing would leave consumers attached to the server's
   * v1 with nothing to tell them it had been superseded. No project scope
   * means the BFF never persists at all, so there is nothing to retry.
   */
  private retryPersistence(
    request: MktgGenerateRequest,
    session: MktgSessionInfo,
    result: MktgRunResultResponse,
    readme?: MktgReadmeOutcome
  ): Observable<MktgGenerateProgress> {
    if (!request.intake.persistsDocument || result.persistence || !request.projectUid) {
      return EMPTY;
    }
    const body = this.resultBody(session, request.projectUid, readme);
    return timer(MKTG_RUN_POLL.intervalMs, MKTG_RUN_POLL.intervalMs).pipe(
      exhaustMap(() =>
        this.http
          .post<MktgRunResultResponse>(request.intake.endpoints.result, body)
          // A failed retry poll spends one attempt like any other; the next
          // interval tries again within the budget.
          .pipe(catchError(() => of<MktgRunResultResponse>({ status: 'pending' })))
      ),
      take(MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS),
      // Announce the moment the SERVER copy exists, then stop. Consumers
      // resolve dependencies from the server copy in preference to any
      // browser-stored run, so a document announced at `document` time while
      // the write was still failing would leave them on the PREVIOUS server
      // version with nothing to tell them it had been superseded.
      // `takeWhile` is inclusive here so the receipt-bearing response is the
      // one that emits, and the stream completes right after it.
      takeWhile((response) => !response.persistence, true),
      filter((response) => !!response.persistence),
      map((response): MktgGenerateProgress => {
        const stored = this.loadRun(request.projectUid, request.agentId);
        if (stored) {
          this.saveRun({ ...stored, pendingAttempt: undefined });
        }
        return { type: 'persisted', ...(response.persistence?.document && { location: response.persistence.document }) };
      })
    );
  }

  /** Result-endpoint body: the owner token travels in the body (never the query string), with the run's project scope when there is one. */
  private resultBody(session: MktgSessionInfo, projectUid: string, readme?: MktgReadmeOutcome, priorVersion = 0): MktgRunResultBody {
    return {
      sessionId: session.sessionId,
      ownerToken: session.ownerToken,
      ...(projectUid && { project: projectUid }),
      ...(readme && { readme }),
      ...(priorVersion > 0 && { priorVersion }),
    };
  }

  /** Appends the validated document as the next version — with the questions and answers that produced it, when any — and persists the run. */
  private appendVersion(
    request: MktgGenerateRequest,
    attempt: MktgRunAttempt,
    result: MktgRunResultResponse,
    answered?: { questions: MktgRunQuestionsPending['questions']; answers: MktgRunAnswer[] }
  ): MktgStoredAgentRun {
    const stored = this.loadRun(request.projectUid, request.agentId);
    const lastVersion = stored?.versions.length ? stored.versions[stored.versions.length - 1].version : 0;
    const existing = stored?.versions.find(
      (entry) =>
        entry.source?.sessionId === attempt.session.sessionId && entry.source.draftVersion === result.version && entry.document === result.documentMarkdown
    );
    const version: MktgRunVersion = {
      // The envelope's own version is authoritative. awaitOutcome reaches this
      // only for a result that is not `questions`, which pollForOutcome's
      // isDocument gate let through with its document and version present, so
      // the fallbacks only narrow the type. A fresh-run intake's envelope
      // always says version 1, so the run numbers its own history instead.
      version: existing?.version ?? (request.intake.freshRunPerSubmission ? lastVersion + 1 : (result.version ?? lastVersion + 1)),
      source: { sessionId: attempt.session.sessionId, draftVersion: result.version ?? 0 },
      document: result.documentMarkdown ?? '',
      feedback: request.feedback,
      derivatives: result.derivatives,
      // Recorded per version: the submission that produced this document is
      // the one whose README fetch matters, and it is what the result note
      // and a restored run both read.
      readme: attempt.readme,
      ...(answered && { questions: answered.questions, answers: answered.answers }),
      createdAt: new Date().toISOString(),
    };
    const run: MktgStoredAgentRun = {
      agentId: request.agentId,
      projectUid: request.projectUid,
      sessionId: attempt.session.sessionId,
      ownerToken: attempt.session.ownerToken,
      answers: { ...request.answers },
      versions: existing ? (stored?.versions ?? []) : [...(stored?.versions ?? []), version],
      ...(!result.persistence && request.intake.persistsDocument && { pendingAttempt: attempt }),
      savedAt: new Date().toISOString(),
    };
    this.saveRun(run);
    return run;
  }

  /**
   * Saves to the in-memory cache (authoritative for this page session), then
   * best-effort to localStorage — a quota/disabled-storage failure never fails
   * the run and, thanks to the cache, never desyncs later follow-ups either.
   */
  private saveRun(run: MktgStoredAgentRun): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const key = this.storageKey(run.projectUid, run.agentId);
    if (!key) {
      return;
    }
    this.memoryRuns.set(key, run);
    try {
      window.localStorage.setItem(key, JSON.stringify(run));
    } catch {
      // Ignore — memoryRuns keeps this session coherent; only cross-visit restore is lost.
    }
  }

  /** Drops a stored run whose session the server no longer accepts. Storage removal is best-effort, like saveRun. */
  private clearRun(projectUid: string, agentId: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const key = this.storageKey(projectUid, agentId);
    if (!key) {
      return;
    }
    this.memoryRuns.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore — loadRun's validation treats an unremovable stale record as absent-on-error anyway.
    }
  }

  /**
   * Storage key scoped to the EFFECTIVE user's sub (impersonation swaps
   * `user()` in place), so a login or impersonation change can never surface —
   * or overwrite — another user's stored run. Null when signed out: stored
   * runs simply don't exist without an authenticated user to own them.
   */
  private storageKey(projectUid: string, agentId: string): string | null {
    const userSub = this.userService.user()?.sub;
    if (!userSub) {
      return null;
    }
    return `${MKTG_RUN_STORAGE_KEY_PREFIX}:${userSub}:${projectUid}:${agentId}`;
  }
}
