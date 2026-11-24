// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  COMMITTEE_INVITE_CONCURRENCY,
  MEMBER_IMPORT_BULK_CHUNK_SIZE,
  MEMBER_IMPORT_FATAL_HTTP_STATUSES,
  MEMBER_IMPORT_MAX_PAUSES,
  MEMBER_IMPORT_RETRY_AFTER_MAX_MS,
} from '@lfx-one/shared/constants';
import {
  CommitteeMemberBulkCreateResult,
  MemberImportRow,
  MemberImportRun,
  MemberImportRunInput,
  MemberImportRunRef,
  MemberImportRunSummary,
  MemberImportSettlement,
} from '@lfx-one/shared/interfaces';
import { classifyMemberImportBulkResult, getMemberImportRetryDelayMs, isMemberImportRowRetryable } from '@lfx-one/shared/utils';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import {
  catchError,
  concat,
  concatMap,
  defer,
  distinctUntilChanged,
  EMPTY,
  from,
  ignoreElements,
  map,
  mergeMap,
  Observable,
  of,
  race,
  Subject,
  Subscription,
  switchMap,
  take,
  tap,
  timer,
} from 'rxjs';

import { CommitteeService } from './committee.service';
import { ImpersonationService } from './impersonation.service';
import { UserService } from './user.service';

/**
 * Runs confirmed Members-tab CSV imports (GH-3849, GH-5111) independently of the import dialog (#5730).
 *
 * Rows are sent in chunks of MEMBER_IMPORT_BULK_CHUNK_SIZE, one bulk request at a time, and each row
 * keeps its own outcome. Temporary limits and unknown outcomes pause the run and resubmit only the
 * affected rows, at most MEMBER_IMPORT_MAX_PAUSES times; resubmitting is safe because upstream reports
 * a row that was already written as an existing member. A stop ends a pause immediately or lets the
 * in-flight chunk settle, because a cancelled request may still have been committed upstream.
 *
 * At most one run is retained per group for the signed-in subject, in memory only. Its subscriptions,
 * stop requests and timers belong to this service, never to a view, so closing the dialog or navigating
 * within the tab only detaches a view (#5731). A different observed subject can neither read nor extend
 * another subject's run: its state is discarded and no further request is scheduled.
 *
 * Each settled attempt is announced once: `settlements$` lets mounted hosts refresh their counts, and a
 * root toast names the group and its outcome. A settled report stays until it is explicitly dismissed.
 * While any run is writing, a best-effort browser leave warning is installed; it is not recovery.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeMemberImportService {
  private readonly committeeService = inject(CommitteeService);
  private readonly userService = inject(UserService);
  private readonly impersonationService = inject(ImpersonationService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly runs = signal(new Map<string, MemberImportRun>());
  private readonly settlementEvents = new Subject<MemberImportSettlement>();
  /** Ends a run's current pause early, keyed by run ID so a replacement run never receives a stale stop. */
  private readonly stopRequests = new Map<string, Subject<void>>();
  private readonly retryDeadlineTimers = new Map<string, Subscription>();
  private owner: string | null = null;
  private runSequence = 0;

  /** No import owner is available while this tab changes its server-side impersonation session. */
  public readonly viewerSubject = computed(() => {
    if (this.impersonationService.transition()) return null;
    return this.userService.user()?.sub ?? null;
  });
  /** Counts-only projections of this subject's retained runs, by group UID. */
  public readonly summaries: Signal<ReadonlyMap<string, MemberImportRunSummary>> = this.initSummaries();
  /** Emits once per settled attempt, only while its subject is still the observed subject. */
  public readonly settlements$: Observable<MemberImportSettlement> = this.settlementEvents.asObservable();

  public constructor() {
    toObservable(this.viewerSubject)
      .pipe(takeUntilDestroyed())
      .subscribe((owner) => this.synchronizeOwner(owner));
    this.initLeaveWarning();
    this.destroyRef.onDestroy(() => {
      this.discardAll();
      this.settlementEvents.complete();
    });
  }

  /** A different observed subject cannot read the previous subject's runs, even before the cleanup subscription runs. */
  public getRun(committeeUid: string): MemberImportRun | undefined {
    const run = this.runs().get(committeeUid);
    const owner = this.viewerSubject();
    if (!owner || this.owner !== owner || run?.ownerSubject !== owner) return undefined;
    return run;
  }

  /** Starts the ready rows of a confirmed preview. Refused while any run is retained for this subject and group. */
  public start(input: MemberImportRunInput): boolean {
    const owner = this.viewerSubject();
    if (!owner) return false;
    this.synchronizeOwner(owner);
    const ready = input.rows.filter((row) => row.status === 'ready');
    if (this.getRun(input.committeeUid) || ready.length === 0) return false;

    const run: MemberImportRun = {
      ...input,
      rows: [...input.rows],
      pendingInviteUidByEmail: { ...input.pendingInviteUidByEmail },
      runId: `member-import-${++this.runSequence}`,
      ownerSubject: owner,
      status: 'importing',
      attempt: 0,
      batchTotal: 0,
      batchSettled: 0,
      pauseCount: 0,
      resumeAt: null,
      resumeInSeconds: 0,
      retryNotBefore: 0,
      stopReason: null,
      manualStopRequested: false,
      reconciliationTarget: input.baselineMemberCount,
    };
    this.runs.update((runs) => new Map(runs).set(input.committeeUid, run));
    this.stopRequests.set(run.runId, new Subject<void>());
    this.submitRows(run, ready, input.skipNotification);
    return true;
  }

  /**
   * Resubmits unsent rows and failures that can still succeed, keeping every confirmed outcome.
   * Refused while writing, before a server cooldown ends, or when nothing can be retried.
   */
  public retry(committeeUid: string, options?: { skipNotification: boolean }): boolean {
    const run = this.getRun(committeeUid);
    if (!run || run.status !== 'settled' || Date.now() < run.retryNotBefore) return false;
    const rows = run.rows.filter(isMemberImportRowRetryable);
    if (rows.length === 0) return false;
    this.submitRows(run, rows, options?.skipNotification ?? run.skipNotification);
    return true;
  }

  /**
   * Ends the run after the in-flight chunk settles, or ends a pause immediately, without losing
   * unknown outcomes; genuinely unsent rows remain Not yet submitted.
   */
  public stop(committeeUid: string): void {
    const run = this.getRun(committeeUid);
    if (!run || run.status !== 'importing' || run.stopReason) return;
    this.updateRun(run, (current) => ({ ...current, manualStopRequested: true, stopReason: 'You stopped the import.' }));
    this.stopRequests.get(run.runId)?.next();
  }

  public getSummary(committeeUid: string): MemberImportRunSummary | undefined {
    return this.summaries().get(committeeUid);
  }

  /** Only a settled run can be dismissed; an active run must not become a second import of the same rows. */
  public dismiss(committeeUid: string): void {
    const run = this.getRun(committeeUid);
    if (!run || run.status !== 'settled') return;
    this.retireRun(run.runId);
    this.runs.update((runs) => {
      const next = new Map(runs);
      next.delete(committeeUid);
      return next;
    });
  }

  /**
   * Definitive loss of manager access or of the group itself: schedules no further request and discards the
   * retained details so they cannot be shown. Requests already sent may still commit upstream.
   */
  public revoke(committeeUid: string): void {
    const run = this.getRun(committeeUid);
    if (!run) return;
    this.runs.update((runs) => {
      const next = new Map(runs);
      next.delete(committeeUid);
      return next;
    });
    this.retireRun(run.runId);
  }

  private initSummaries(): Signal<ReadonlyMap<string, MemberImportRunSummary>> {
    return computed(() => {
      const owner = this.viewerSubject();
      const summaries = new Map<string, MemberImportRunSummary>();
      if (!owner) return summaries;
      for (const run of this.runs().values()) {
        if (run.ownerSubject === owner) summaries.set(run.committeeUid, this.toSummary(run));
      }
      return summaries;
    });
  }

  /** Best-effort only: browsers may ignore it, and nothing keeps processing after the tab is gone. */
  private initLeaveWarning(): void {
    const view = this.document.defaultView;
    if (!isPlatformBrowser(this.platformId) || !view) return;
    const warn = (event: BeforeUnloadEvent): void => {
      // The session changes before reload; never let this warning keep an old-owner run alive.
      if (this.impersonationService.transition()) return;
      event.preventDefault();
      // Some browsers still require a return value to show the prompt.
      event.returnValue = '';
    };
    const active = computed(() => [...this.summaries().values()].some((summary) => summary.phase !== 'settled'));
    toObservable(active)
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((importing) => {
        if (importing) {
          view.addEventListener('beforeunload', warn);
        } else {
          view.removeEventListener('beforeunload', warn);
        }
      });
    this.destroyRef.onDestroy(() => view.removeEventListener('beforeunload', warn));
  }

  private toSummary(run: MemberImportRun): MemberImportRunSummary {
    const count = (status: MemberImportRow['status']): number => run.rows.filter((row) => row.status === status).length;
    return {
      committeeUid: run.committeeUid,
      committeeName: run.committeeName,
      runId: run.runId,
      attempt: run.attempt,
      phase: this.runPhase(run),
      batchTotal: run.batchTotal,
      batchSettled: run.batchSettled,
      added: count('added'),
      failed: count('failed'),
      unknown: count('unknown'),
      notSubmitted: count('not_submitted'),
      retryable: run.rows.filter(isMemberImportRowRetryable).length,
      stopReason: run.stopReason,
      manualStopRequested: run.manualStopRequested,
      baselineMemberCount: run.baselineMemberCount,
      reconciliationTarget: run.reconciliationTarget,
    };
  }

  private runPhase(run: MemberImportRun): MemberImportRunSummary['phase'] {
    if (run.status === 'settled') return 'settled';
    if (run.resumeAt !== null) return 'paused';
    return run.manualStopRequested ? 'stopping' : 'importing';
  }

  /** Announces a settled attempt once: hosts reconcile counts, and the toast never opens a view or navigates. */
  private announceSettlement(ref: MemberImportRunRef): void {
    const run = this.currentRun(ref);
    if (!run || run.status !== 'settled') return;
    const summary = this.toSummary(run);
    this.settlementEvents.next({ key: `${run.runId}:${run.attempt}`, summary });
    this.messageService.add({ ...this.settlementNotice(summary), life: 8000 });
  }

  private settlementNotice(summary: MemberImportRunSummary): { severity: 'success' | 'info' | 'warn' | 'error'; summary: string; detail: string } {
    const group = summary.committeeName;
    const added = `${summary.added} ${summary.added === 1 ? 'member' : 'members'} added`;
    const report = "Open the report from the group's Members tab.";
    if (summary.unknown > 0) {
      return {
        severity: 'warn',
        summary: 'Import Outcome Unknown',
        detail: `Import into ${group} finished: ${added}, ${summary.unknown} with an unknown outcome. ${report}`,
      };
    }
    if (summary.stopReason) {
      return {
        severity: 'warn',
        summary: 'Import Stopped',
        detail: `Import into ${group} stopped: ${added}, ${summary.notSubmitted} not yet submitted. ${report}`,
      };
    }
    if (summary.added === 0 && (summary.failed > 0 || summary.notSubmitted > 0)) {
      return {
        severity: 'error',
        summary: 'Import Failed',
        detail: `Import into ${group} finished: no members added, ${summary.failed + summary.notSubmitted} not added. ${report}`,
      };
    }
    if (summary.failed > 0 || summary.notSubmitted > 0) {
      return {
        severity: 'warn',
        summary: 'Import Partly Complete',
        detail: `Import into ${group} finished: ${added}, ${summary.failed + summary.notSubmitted} not added. ${report}`,
      };
    }
    if (summary.added === 0) {
      return {
        severity: 'info',
        summary: 'Import Finished',
        detail: `Import into ${group} finished: no members added. ${report}`,
      };
    }
    return { severity: 'success', summary: 'Import Complete', detail: `${added} to ${group}. New members may take a moment to appear.` };
  }

  private synchronizeOwner(owner: string | null): void {
    if (this.owner === owner) return;
    this.owner = owner;
    this.discardAll();
  }

  /**
   * Requests already sent may still commit upstream; only later chunks, pauses and timers end here.
   * Clearing the runs first makes every later chunk, resumed pause and late response a no-op.
   */
  private discardAll(): void {
    this.runs.set(new Map());
    for (const runId of [...this.stopRequests.keys(), ...this.retryDeadlineTimers.keys()]) {
      this.retireRun(runId);
    }
  }

  private retireRun(runId: string): void {
    this.retryDeadlineTimers.get(runId)?.unsubscribe();
    this.retryDeadlineTimers.delete(runId);
    const stopRequested = this.stopRequests.get(runId);
    this.stopRequests.delete(runId);
    stopRequested?.next();
    stopRequested?.complete();
  }

  /**
   * Sends the given rows in chunks, one bulk request at a time. A chunk (including its invite cleanup
   * and any pause) finishes before the next starts, so a stop leaves every later chunk unsent.
   */
  private submitRows(ref: MemberImportRunRef, rows: MemberImportRow[], skipNotification: boolean): void {
    const targets = new Set(rows.map((row) => row.rowNumber));
    const chunks: MemberImportRow[][] = [];
    for (let start = 0; start < rows.length; start += MEMBER_IMPORT_BULK_CHUNK_SIZE) {
      chunks.push(rows.slice(start, start + MEMBER_IMPORT_BULK_CHUNK_SIZE));
    }

    this.updateRun(ref, (run) => ({
      ...run,
      // An earlier attempt may have committed; retain that fact until an authoritative result arrives.
      rows: run.rows.map((row) =>
        targets.has(row.rowNumber) ? { ...row, status: row.uncertain ? 'unknown' : 'not_submitted', reason: undefined, retryable: undefined } : row
      ),
      status: 'importing',
      attempt: run.attempt + 1,
      skipNotification,
      manualStopRequested: false,
      stopReason: null,
      pauseCount: 0,
      resumeAt: null,
      batchTotal: rows.length,
      batchSettled: 0,
    }));
    this.setRetryDeadline(ref, 0);

    from(chunks)
      .pipe(
        concatMap((chunk) => this.submitChunk(ref, chunk, skipNotification)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        complete: () => {
          const run = this.currentRun(ref);
          if (!run) {
            return;
          }
          const unsettled = run.rows.filter((row) => row.status === 'waiting' || row.status === 'importing');
          this.markUnsubmitted(ref, unsettled, 'The import stopped.');
          this.updateRun(ref, (current) => ({ ...current, resumeAt: null, status: 'settled' }));
          this.announceSettlement(ref);
        },
      });
  }

  /** Sends one chunk, applies its per-row results, and pauses then resubmits any rows that can be retried. */
  private submitChunk(ref: MemberImportRunRef, rows: MemberImportRow[], skipNotification: boolean): Observable<void> {
    return defer(() => {
      const run = this.currentRun(ref);
      // A dismissed run or a replaced subject schedules nothing more.
      if (!run) {
        return EMPTY;
      }
      if (run.stopReason) {
        this.markUnsubmitted(ref, rows, run.stopReason);
        return EMPTY;
      }
      const sendable = rows.filter((row) => row.payload);
      const missing = rows.filter((row) => !row.payload);
      this.patchRows(ref, missing, { status: 'failed', reason: 'Not sent: missing member data.', retryable: false });
      this.addSettled(ref, missing.length);
      if (sendable.length === 0) {
        return EMPTY;
      }

      this.patchRows(ref, sendable, { status: 'importing', reason: undefined });
      return this.committeeService
        .bulkCreateCommitteeMembers(
          ref.committeeUid,
          sendable.map((row) => row.payload as NonNullable<MemberImportRow['payload']>),
          { skipNotification }
        )
        .pipe(
          switchMap((result) => this.applyChunkResult(ref, sendable, result, skipNotification)),
          catchError((err: unknown) => this.handleChunkError(ref, sendable, err, skipNotification))
        );
    });
  }

  /** Maps each result back to its row by index, cleans up pending invites for new members, then resubmits waiting rows. */
  private applyChunkResult(
    ref: MemberImportRunRef,
    rows: MemberImportRow[],
    result: CommitteeMemberBulkCreateResult,
    skipNotification: boolean
  ): Observable<void> {
    // A late response after logout/impersonation must neither retain PII nor overwrite another run.
    if (!this.currentRun(ref)) {
      return EMPTY;
    }
    const byIndex = new Map((result.results ?? []).map((rowResult) => [rowResult.index, rowResult]));
    const added: MemberImportRow[] = [];
    const waiting: MemberImportRow[] = [];
    let settled = 0;

    rows.forEach((row, index) => {
      const current = this.findRow(ref, row.rowNumber) ?? row;
      const rowResult = byIndex.get(index);
      const patch: Partial<MemberImportRow> = rowResult
        ? classifyMemberImportBulkResult(rowResult, current)
        : { status: 'waiting', uncertain: true, reason: 'No result came back for this row. It will be checked and sent again automatically.' };
      this.patchRows(ref, [row], patch);
      if (patch.status === 'waiting') {
        waiting.push(row);
      } else {
        settled++;
        if (patch.status === 'added') {
          added.push(current);
        }
      }
    });
    this.addSettled(ref, settled);

    const cleanup$ = from(added).pipe(
      mergeMap(
        (row) =>
          this.revokePendingInvite(ref, row).pipe(
            tap((cleanupWarning) => {
              if (cleanupWarning) {
                this.patchRows(ref, [row], { cleanupWarning });
              }
            })
          ),
        COMMITTEE_INVITE_CONCURRENCY
      ),
      ignoreElements()
    );
    return concat(
      cleanup$,
      defer(() => (waiting.length > 0 ? this.pauseThenResubmit(ref, waiting, null, skipNotification) : EMPTY))
    );
  }

  /**
   * Request-level failures: 429 pauses unless its cooldown exceeds the automatic wait limit;
   * 401/403/404 stop the run, 400 rejects the chunk, and anything else leaves its outcome unknown.
   */
  private handleChunkError(ref: MemberImportRunRef, rows: MemberImportRow[], err: unknown, skipNotification: boolean): Observable<void> {
    const httpError = err instanceof HttpErrorResponse ? err : null;
    const status = httpError?.status ?? 0;
    // Log only the status: raw errors may contain imported personal data.
    console.error('CSV member import chunk failed', { status });
    if (!this.currentRun(ref)) {
      return EMPTY;
    }

    if (httpError && status === 429) {
      // Both the BFF and upstream can throttle. Preserve any uncertainty from an earlier attempt.
      this.patchRows(ref, rows, { status: 'waiting', reason: 'The service asked the import to slow down. It will resume automatically.' });
      return this.pauseThenResubmit(ref, rows, httpError.headers?.get('Retry-After') ?? '', skipNotification);
    }
    if (httpError && MEMBER_IMPORT_FATAL_HTTP_STATUSES.has(status)) {
      const reason = this.failureReason(httpError);
      this.stopForFatalError(ref, httpError, reason);
      this.markUnsubmitted(ref, rows, reason);
      return EMPTY;
    }
    if (httpError && status === 400) {
      const message = extractErrorMessage(httpError, 'The service rejected these rows.');
      for (const row of rows) {
        const uncertain = this.findRow(ref, row.rowNumber)?.uncertain;
        this.patchRows(ref, [row], {
          status: uncertain ? 'unknown' : 'failed',
          retryable: false,
          reason: `${uncertain ? 'The earlier outcome is unknown. ' : ''}${message} Fix the file and import it again.`,
        });
      }
      this.addSettled(ref, rows.length);
      return EMPTY;
    }

    this.patchRows(ref, rows, {
      status: 'waiting',
      uncertain: true,
      reason: 'The outcome is unknown. These rows will be checked and sent again automatically.',
    });
    return this.pauseThenResubmit(ref, rows, null, skipNotification);
  }

  /**
   * Waits, then resubmits the rows as a new chunk. Stops when the pause budget is spent, a server
   * cooldown exceeds the automatic wait limit, or the run already stopped. Unresolved submitted
   * attempts remain Outcome unknown; only unsent rows are Not yet submitted.
   */
  private pauseThenResubmit(ref: MemberImportRunRef, rows: MemberImportRow[], retryAfter: string | null, skipNotification: boolean): Observable<void> {
    return defer(() => {
      const run = this.currentRun(ref);
      const stopRequested = this.stopRequests.get(ref.runId);
      if (!run || !stopRequested) {
        return EMPTY;
      }
      const delay = getMemberImportRetryDelayMs(retryAfter, run.pauseCount);
      if (retryAfter !== null) {
        this.setRetryDeadline(ref, Math.max(run.retryNotBefore, Date.now() + delay));
      }
      if (delay > MEMBER_IMPORT_RETRY_AFTER_MAX_MS) {
        const reason = 'The service cooldown exceeds the automatic wait limit. Automatic recovery stopped; retry once the service permits.';
        this.updateRun(ref, (current) => ({ ...current, stopReason: reason }));
        this.markUnsubmitted(ref, rows, reason);
        return EMPTY;
      }
      if (run.stopReason) {
        this.markUnsubmitted(ref, rows, run.stopReason);
        return EMPTY;
      }
      if (run.pauseCount >= MEMBER_IMPORT_MAX_PAUSES) {
        const reason = 'Automatic recovery has stopped after three pauses. Review the outcomes before retrying.';
        this.updateRun(ref, (current) => ({ ...current, stopReason: reason }));
        this.markUnsubmitted(ref, rows, reason);
        return EMPTY;
      }

      this.patchRows(ref, rows, { status: 'waiting' });
      this.updateRun(ref, (current) => ({
        ...current,
        pauseCount: current.pauseCount + 1,
        resumeInSeconds: Math.ceil(delay / 1000),
        resumeAt: Date.now() + delay,
      }));

      return race(
        timer(delay).pipe(map(() => true)),
        stopRequested.pipe(
          take(1),
          map(() => false)
        )
      ).pipe(
        switchMap((resume) => {
          this.updateRun(ref, (current) => ({ ...current, resumeAt: null }));
          if (!resume) {
            this.markUnsubmitted(ref, rows, 'You stopped the import.');
            return EMPTY;
          }
          return this.submitChunk(ref, rows, skipNotification);
        })
      );
    });
  }

  /** Clear elapsed cooldowns without resubmitting; recheck long deadlines in bounded timer intervals. */
  private setRetryDeadline(ref: MemberImportRunRef, deadline: number): void {
    this.retryDeadlineTimers.get(ref.runId)?.unsubscribe();
    this.retryDeadlineTimers.delete(ref.runId);
    if (!this.updateRun(ref, (run) => ({ ...run, retryNotBefore: deadline }))) {
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0 || !Number.isFinite(remaining)) {
      return;
    }
    this.retryDeadlineTimers.set(
      ref.runId,
      timer(Math.min(remaining, MEMBER_IMPORT_RETRY_AFTER_MAX_MS)).subscribe(() => this.setRetryDeadline(ref, Date.now() < deadline ? deadline : 0))
    );
  }

  /** Emits the cleanup warning (or undefined) — a failed revoke never turns an added member into a failure. */
  private revokePendingInvite(ref: MemberImportRunRef, row: MemberImportRow): Observable<string | undefined> {
    return defer(() => {
      const inviteUid = this.currentRun(ref)?.pendingInviteUidByEmail[row.normalizedEmail];
      if (!inviteUid) {
        return of(undefined);
      }
      return this.committeeService.revokeCommitteeInvite(ref.committeeUid, inviteUid).pipe(
        map(() => {
          this.updateRun(ref, (run) => {
            const pendingInviteUidByEmail = { ...run.pendingInviteUidByEmail };
            delete pendingInviteUidByEmail[row.normalizedEmail];
            return { ...run, pendingInviteUidByEmail };
          });
          return undefined;
        }),
        catchError((err: HttpErrorResponse) => {
          console.error('CSV member import invitation cleanup failed', { status: err.status });
          const reason =
            err.status === 404 ? 'The pending invitation could not be found. Review pending invitations before retrying.' : this.failureReason(err);
          this.stopForFatalError(ref, err, reason);
          return of('Added, but their pending invitation could not be revoked. Revoke it from the Pending tab.');
        })
      );
    });
  }

  /** Fatal guidance overrides a manual stop without replacing an earlier fatal reason or an added row's outcome. */
  private stopForFatalError(ref: MemberImportRunRef, err: HttpErrorResponse, reason: string): void {
    this.updateRun(ref, (run) =>
      MEMBER_IMPORT_FATAL_HTTP_STATUSES.has(err.status) && (!run.stopReason || run.manualStopRequested)
        ? { ...run, manualStopRequested: false, stopReason: reason }
        : run
    );
  }

  private failureReason(err: HttpErrorResponse): string {
    if (err.status === 401) {
      return 'Your session has expired. Sign in again, then retry.';
    }
    if (err.status === 403) {
      return 'You no longer have permission to manage this group.';
    }
    if (err.status === 404) {
      return 'This group could not be found.';
    }
    return extractErrorMessage(err, 'The member could not be added.');
  }

  /** Do not claim that a row with an unconfirmed earlier attempt was never submitted. */
  private markUnsubmitted(ref: MemberImportRunRef, targets: MemberImportRow[], reason: string): void {
    for (const target of targets) {
      const uncertain = this.findRow(ref, target.rowNumber)?.uncertain;
      this.patchRows(ref, [target], {
        status: uncertain ? 'unknown' : 'not_submitted',
        reason: uncertain ? `The outcome of an earlier attempt is unknown. Review the roster before retrying. ${reason}` : `Not sent: ${reason}`,
      });
    }
  }

  private patchRows(ref: MemberImportRunRef, targets: MemberImportRow[], patch: Partial<MemberImportRow>): void {
    if (targets.length === 0) {
      return;
    }
    const rowNumbers = new Set(targets.map((row) => row.rowNumber));
    this.updateRun(ref, (run) => ({ ...run, rows: run.rows.map((row) => (rowNumbers.has(row.rowNumber) ? { ...row, ...patch } : row)) }));
  }

  private addSettled(ref: MemberImportRunRef, count: number): void {
    if (count > 0) {
      this.updateRun(ref, (run) => ({ ...run, batchSettled: run.batchSettled + count }));
    }
  }

  private findRow(ref: MemberImportRunRef, rowNumber: number): MemberImportRow | undefined {
    return this.currentRun(ref)?.rows.find((row) => row.rowNumber === rowNumber);
  }

  /** The retained run only while it is still this run and its subject is still the observed subject. */
  private currentRun(ref: MemberImportRunRef): MemberImportRun | undefined {
    const run = this.getRun(ref.committeeUid);
    return run?.runId === ref.runId && run.ownerSubject === ref.ownerSubject ? run : undefined;
  }

  /** Applies an immutable update to a live run; the reconciliation target only advances with confirmed additions. */
  private updateRun(ref: MemberImportRunRef, update: (run: MemberImportRun) => MemberImportRun): boolean {
    const run = this.currentRun(ref);
    if (!run) {
      return false;
    }
    const next = update(run);
    if (next === run) {
      return true;
    }
    const confirmedAdded = next.rows.filter((row) => row.status === 'added').length;
    this.runs.update((runs) => new Map(runs).set(ref.committeeUid, { ...next, reconciliationTarget: next.baselineMemberCount + confirmedAdded }));
    return true;
  }
}
