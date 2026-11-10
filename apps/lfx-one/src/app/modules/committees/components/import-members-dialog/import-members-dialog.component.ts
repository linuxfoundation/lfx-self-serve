// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  COMMITTEE_INVITE_CONCURRENCY,
  MEMBER_IMPORT_BULK_CHUNK_SIZE,
  MEMBER_IMPORT_FATAL_HTTP_STATUSES,
  MEMBER_IMPORT_MAX_FILE_BYTES,
  MEMBER_IMPORT_MAX_PAUSES,
  MEMBER_IMPORT_MAX_RECORDS,
  MEMBER_IMPORT_RETRY_AFTER_MAX_MS,
  MEMBER_IMPORT_STATUS_DISPLAY,
  MEMBER_IMPORT_TEMPLATE_FILENAME,
} from '@lfx-one/shared/constants';
import {
  CommitteeInvite,
  CommitteeMemberBulkCreateResult,
  MemberImportDialogData,
  MemberImportDialogPhase,
  MemberImportDialogResult,
  MemberImportFieldGuide,
  MemberImportGroupRules,
  MemberImportRow,
  MemberImportRowView,
  StagedCommitteeMemberRequest,
} from '@lfx-one/shared/interfaces';
import {
  classifyMemberImportBulkResult,
  committeeRequiresOrganization,
  downloadCsv,
  getMemberImportFieldGuide,
  getMemberImportRetryDelayMs,
  getMemberImportTemplateHeaders,
  parseMemberImportCsv,
  prepareMemberImportRows,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { FileSelectEvent } from 'primeng/fileupload';
import {
  catchError,
  concat,
  concatMap,
  defer,
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

/**
 * Import members into an existing group from a CSV (GH-3849).
 *
 * The file is read and validated locally into a read-only preview; nothing is written until the
 * user confirms. Confirmed rows are sent in chunks of MEMBER_IMPORT_BULK_CHUNK_SIZE, one chunk at a
 * time, to the committee bulk member route (GH-5111), which applies the same per-member checks as
 * Add Member and reports one result per row. Temporary limits and unknown outcomes pause the run
 * and resubmit only the affected rows, at most MEMBER_IMPORT_MAX_PAUSES times; resubmitting is safe
 * because upstream reports a row that was already written as an existing member. Each row keeps its
 * own outcome; Retry resubmits rows that were not sent and failures that can still succeed, and
 * Close returns confirmed counts and any unresolved attempt so the roster refreshes. Never resolves
 * organizations, creates invitations, or changes permissions.
 * In collect-only mode, confirmation returns validated member requests to the create or edit wizard
 * instead of writing them; the wizard saves them with Done or Update Group.
 */
@Component({
  selector: 'lfx-import-members-dialog',
  imports: [DatePipe, ReactiveFormsModule, ButtonComponent, CheckboxComponent, FileUploadComponent, TableComponent, TagComponent],
  templateUrl: './import-members-dialog.component.html',
  styleUrl: './import-members-dialog.component.scss',
})
export class ImportMembersDialogComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly resultSummary = viewChild<ElementRef<HTMLElement>>('resultSummary');

  private readonly data: MemberImportDialogData = this.config.data;
  /** Pinned at open — every write targets this group even if the page navigates elsewhere. */
  private readonly committeeUid: string = this.data.committee.uid;
  public readonly committeeName: string = this.data.committee.name;
  public readonly collectOnly = !!this.data.collectOnly;
  public readonly rules: MemberImportGroupRules = {
    requiresOrganization: committeeRequiresOrganization(this.data.committee),
    votingEnabled: !!this.data.committee.enable_voting,
  };
  public readonly fieldGuide: MemberImportFieldGuide[] = getMemberImportFieldGuide(this.rules);
  public readonly maxRecords = MEMBER_IMPORT_MAX_RECORDS;
  public readonly maxFileMegabytes = MEMBER_IMPORT_MAX_FILE_BYTES / (1024 * 1024);
  private readonly existingMemberEmails = new Set<string>(
    (this.data.existingMembers ?? []).map((member) => (member.email ?? '').trim().toLowerCase()).filter(Boolean)
  );
  /** Pending invite UID by email — revoked after a direct add so the roster does not show member + invite. */
  private readonly pendingInviteUidByEmail: Map<string, string> = this.initPendingInvites(this.data.existingInvites ?? []);

  public readonly form = new FormGroup({
    send_notification: new FormControl<boolean>(false, { nonNullable: true }),
  });

  public phase = signal<MemberImportDialogPhase>('select');
  public fileName = signal<string | null>(null);
  public fileErrors = signal<string[]>([]);
  public reading = signal(false);
  public rows = signal<MemberImportRow[]>([]);
  /** Set when auth/not-found, the pause cap, an excessive server cooldown or Stop import ends the run. */
  public stopReason = signal<string | null>(null);
  public batchTotal = signal(0);
  public batchSettled = signal(0);
  /** Epoch ms when a paused run resumes automatically; null while not paused. */
  public resumeAt = signal<number | null>(null);
  /** Length of the current pause, rounded up to whole seconds, for the paused notice. */
  public resumeInSeconds = signal(0);
  /** Automatic pauses taken by the current run (at most MEMBER_IMPORT_MAX_PAUSES). */
  public pauseCount = signal(0);
  /** Minimum server deadline, retained even if automatic recovery or a pause is stopped. */
  public retryNotBefore = signal(0);
  public readonly maxPauses = MEMBER_IMPORT_MAX_PAUSES;
  /** Ends the current pause early; in-flight requests are never cancelled. */
  private readonly stopRequested = new Subject<void>();
  private retryDeadlineTimer?: Subscription;

  public readonly busy = computed(() => this.reading() || this.phase() === 'importing');
  public readonly readyCount = computed(() => this.countRows('ready'));
  public readonly invalidCount = computed(() => this.countRows('invalid'));
  public readonly skippedCount = computed(() => this.countRows('skipped'));
  public readonly addedCount = computed(() => this.countRows('added'));
  public readonly failedCount = computed(() => this.countRows('failed'));
  public readonly unknownCount = computed(() => this.countRows('unknown'));
  public readonly waitingCount = computed(() => this.countRows('waiting'));
  public readonly notSubmittedCount = computed(() => this.countRows('not_submitted'));
  public readonly retryableCount = computed(() => this.rows().filter((row) => this.isRetryable(row)).length);
  public readonly paused = computed(() => this.resumeAt() !== null);
  public readonly conflictCount = computed(() => this.rows().filter((row) => row.conflict).length);
  public readonly cleanupWarningCount = computed(() => this.rows().filter((row) => row.cleanupWarning).length);
  public readonly canImport = computed(() => this.phase() === 'preview' && this.readyCount() > 0 && this.invalidCount() === 0);
  public readonly canRetry = computed(() => this.phase() === 'results' && this.retryableCount() > 0);
  public readonly retryDeadlineLabel = computed(() => {
    if (!this.canRetry() || this.retryNotBefore() === 0) {
      return null;
    }
    const deadline = new Date(this.retryNotBefore());
    return Number.isNaN(deadline.getTime())
      ? 'The service requested an unsupported cooldown. Close and try again later.'
      : `Retry no earlier than ${deadline.toLocaleString()}. Retry is unavailable until this cooldown ends.`;
  });
  public readonly canChooseFile = computed(() => (this.phase() === 'select' || this.phase() === 'preview') && !this.busy());
  public readonly closeLabel = computed(() => (this.phase() === 'results' ? 'Close' : 'Cancel'));
  public readonly rowViews: Signal<MemberImportRowView[]> = this.initRowViews();
  public readonly statusMessage: Signal<string> = this.initStatusMessage();

  public downloadTemplate(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    downloadCsv(MEMBER_IMPORT_TEMPLATE_FILENAME, [getMemberImportTemplateHeaders(this.rules)]);
  }

  public onFileSelect(event: FileSelectEvent): void {
    const file = event.files?.[0];
    if (!file || !this.canChooseFile() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    this.fileName.set(file.name);
    this.rows.set([]);
    this.phase.set('select');

    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.fileErrors.set(['Choose a .csv file. Save spreadsheets as "CSV UTF-8 (comma delimited)".']);
      return;
    }
    if (file.size > MEMBER_IMPORT_MAX_FILE_BYTES) {
      this.fileErrors.set([`The file is larger than ${this.maxFileMegabytes} MB. Split it into smaller files.`]);
      return;
    }

    this.fileErrors.set([]);
    this.reading.set(true);
    file
      .arrayBuffer()
      .then((buffer) => this.applyFileText(new TextDecoder('utf-8', { fatal: true }).decode(buffer)))
      .catch(() => this.fileErrors.set(['The file could not be read as UTF-8 text. Save it as "CSV UTF-8" and choose it again.']))
      .finally(() => this.reading.set(false));
  }

  public removeRow(rowNumber: number): void {
    if (this.phase() !== 'preview') {
      return;
    }
    // Removing the retained occurrence releases the next duplicate, keeping original source row numbers.
    this.rows.update((rows) =>
      prepareMemberImportRows(
        rows.filter((row) => row.rowNumber !== rowNumber).map(({ rowNumber, cells }) => ({ rowNumber, cells })),
        this.rules,
        this.existingMemberEmails
      )
    );
  }

  public startImport(): void {
    if (!this.canImport()) {
      return;
    }
    if (this.collectOnly) {
      const members: StagedCommitteeMemberRequest[] = this.rows().flatMap((row) => {
        if (row.status !== 'ready' || !row.payload) {
          return [];
        }
        const pendingInviteUids = (this.data.existingInvites ?? [])
          .filter((invite) => (invite.status ?? '').toLowerCase() === 'pending' && (invite.invitee_email ?? '').trim().toLowerCase() === row.normalizedEmail)
          .map((invite) => invite.uid)
          .filter(Boolean);
        return [{ ...row.payload, createOptions: { skipNotification: !this.form.controls.send_notification.value }, pendingInviteUids }];
      });
      this.dialogRef.close(members);
      return;
    }
    this.submitRows(this.rows().filter((row) => row.status === 'ready'));
  }

  public retryFailed(): void {
    if (!this.canRetry() || Date.now() < this.retryNotBefore()) {
      return;
    }
    this.submitRows(this.rows().filter((row) => this.isRetryable(row)));
  }

  /** Ends a pause without losing unknown outcomes; genuinely unsent rows remain Not yet submitted. */
  public stopImport(): void {
    if (!this.paused()) {
      return;
    }
    this.stopReason.set('You stopped the import.');
    this.stopRequested.next();
  }

  public close(): void {
    if (this.busy()) {
      return;
    }
    if (this.collectOnly) {
      this.dialogRef.close();
      return;
    }
    const result: MemberImportDialogResult = {
      added: this.addedCount(),
      conflicts: this.conflictCount(),
      ...(this.rows().some((row) => row.uncertain) ? { uncertain: true } : {}),
    };
    this.dialogRef.close(result);
  }

  private initPendingInvites(invites: CommitteeInvite[]): Map<string, string> {
    const byEmail = new Map<string, string>();
    for (const invite of invites) {
      const email = (invite.invitee_email ?? '').trim().toLowerCase();
      if (email && invite.uid && (invite.status ?? '').toLowerCase() === 'pending') {
        byEmail.set(email, invite.uid);
      }
    }
    return byEmail;
  }

  private initRowViews(): Signal<MemberImportRowView[]> {
    return computed(() =>
      this.rows().map((row) => {
        const { cells } = row;
        const display = MEMBER_IMPORT_STATUS_DISPLAY[row.status];
        return {
          row,
          name: [cells.first_name, cells.last_name].filter(Boolean).join(' '),
          organization: cells.organization_name ?? '',
          governance: [cells.role, cells.voting_status].filter(Boolean).join(' · '),
          statusLabel: display.label,
          statusSeverity: display.severity,
          details: this.fieldGuide.flatMap(({ column }) => (cells[column] ? [{ column, value: cells[column] }] : [])),
        };
      })
    );
  }

  private initStatusMessage(): Signal<string> {
    return computed(() => {
      switch (this.phase()) {
        case 'preview':
          return `${this.readyCount()} ready, ${this.invalidCount()} invalid, ${this.skippedCount()} skipped.`;
        case 'importing':
          if (this.paused()) {
            return `Paused: resuming automatically in about ${this.resumeInSeconds()} seconds (pause ${this.pauseCount()} of ${MEMBER_IMPORT_MAX_PAUSES}).`;
          }
          return `Adding members: ${this.batchSettled()} of ${this.batchTotal()} done.`;
        case 'results': {
          const notSubmitted = this.notSubmittedCount() > 0 ? `, ${this.notSubmittedCount()} not yet submitted` : '';
          const unknown = this.unknownCount() > 0 ? `, ${this.unknownCount()} outcome unknown` : '';
          return `${this.addedCount()} added, ${this.skippedCount()} skipped, ${this.failedCount()} failed${unknown}${notSubmitted}.`;
        }
        default:
          return this.fileErrors().length > 0 ? 'The file could not be imported. See the errors below.' : '';
      }
    });
  }

  private applyFileText(text: string): void {
    const parsed = parseMemberImportCsv(text, this.rules);
    if (parsed.errors.length > 0) {
      this.fileErrors.set(parsed.errors);
      return;
    }
    this.rows.set(prepareMemberImportRows(parsed.records, this.rules, this.existingMemberEmails));
    this.phase.set('preview');
  }

  /**
   * Sends the given rows in chunks of MEMBER_IMPORT_BULK_CHUNK_SIZE, one bulk request at a time, and
   * records each row's outcome. A chunk (including its invite cleanup and any pause) finishes before
   * the next starts, so a stop leaves every later chunk unsent. In-flight requests are left to settle
   * rather than cancelled, because a cancelled request may still have been committed upstream.
   */
  private submitRows(rows: MemberImportRow[]): void {
    if (rows.length === 0) {
      return;
    }
    const skipNotification = !this.form.controls.send_notification.value;
    const targets = new Set(rows.map((row) => row.rowNumber));
    const chunks: MemberImportRow[][] = [];
    for (let start = 0; start < rows.length; start += MEMBER_IMPORT_BULK_CHUNK_SIZE) {
      chunks.push(rows.slice(start, start + MEMBER_IMPORT_BULK_CHUNK_SIZE));
    }

    // An earlier attempt may have committed; retain that fact until an authoritative result arrives.
    this.rows.update((all) =>
      all.map((row) =>
        targets.has(row.rowNumber) ? { ...row, status: row.uncertain ? 'unknown' : 'not_submitted', reason: undefined, retryable: undefined } : row
      )
    );
    this.stopReason.set(null);
    this.pauseCount.set(0);
    this.resumeAt.set(null);
    this.setRetryDeadline(0);
    this.batchTotal.set(rows.length);
    this.batchSettled.set(0);
    this.form.controls.send_notification.disable();
    this.phase.set('importing');

    from(chunks)
      .pipe(
        concatMap((chunk) => this.submitChunk(chunk, skipNotification)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        complete: () => {
          // takeUntilDestroyed also completes the stream when the dialog is torn down mid-import.
          if (this.destroyRef.destroyed) {
            return;
          }
          this.resumeAt.set(null);
          this.markUnsubmitted(
            this.rows().filter((row) => row.status === 'waiting' || row.status === 'importing'),
            'The import stopped.'
          );
          this.form.controls.send_notification.enable();
          this.phase.set('results');
          this.focusResultSummary();
        },
      });
  }

  /** Sends one chunk, applies its per-row results, and pauses then resubmits any rows that can be retried. */
  private submitChunk(rows: MemberImportRow[], skipNotification: boolean): Observable<void> {
    return defer(() => {
      const stopReason = this.stopReason();
      if (stopReason) {
        this.markUnsubmitted(rows, stopReason);
        return EMPTY;
      }
      const sendable = rows.filter((row) => row.payload);
      const missing = rows.filter((row) => !row.payload);
      this.patchRows(missing, { status: 'failed', reason: 'Not sent: missing member data.', retryable: false });
      this.batchSettled.update((count) => count + missing.length);
      if (sendable.length === 0) {
        return EMPTY;
      }

      this.patchRows(sendable, { status: 'importing', reason: undefined });
      return this.committeeService
        .bulkCreateCommitteeMembers(
          this.committeeUid,
          sendable.map((row) => row.payload as NonNullable<MemberImportRow['payload']>),
          { skipNotification }
        )
        .pipe(
          switchMap((result) => this.applyChunkResult(sendable, result, skipNotification)),
          catchError((err: unknown) => this.handleChunkError(sendable, err, skipNotification))
        );
    });
  }

  /** Maps each result back to its row by index, cleans up pending invites for new members, then resubmits waiting rows. */
  private applyChunkResult(rows: MemberImportRow[], result: CommitteeMemberBulkCreateResult, skipNotification: boolean): Observable<void> {
    const byIndex = new Map((result.results ?? []).map((rowResult) => [rowResult.index, rowResult]));
    const added: MemberImportRow[] = [];
    const waiting: MemberImportRow[] = [];
    let settled = 0;

    rows.forEach((row, index) => {
      const current = this.findRow(row.rowNumber) ?? row;
      const rowResult = byIndex.get(index);
      const patch: Partial<MemberImportRow> = rowResult
        ? classifyMemberImportBulkResult(rowResult, current)
        : { status: 'waiting', uncertain: true, reason: 'No result came back for this row. It will be checked and sent again automatically.' };
      this.patchRow(row.rowNumber, patch);
      if (patch.status === 'waiting') {
        waiting.push(row);
      } else {
        settled++;
        if (patch.status === 'added') {
          added.push(current);
        }
      }
    });
    this.batchSettled.update((count) => count + settled);

    const cleanup$ = from(added).pipe(
      mergeMap(
        (row) =>
          this.revokePendingInvite(row).pipe(
            tap((cleanupWarning) => {
              if (cleanupWarning) {
                this.patchRow(row.rowNumber, { cleanupWarning });
              }
            })
          ),
        COMMITTEE_INVITE_CONCURRENCY
      ),
      ignoreElements()
    );
    return concat(
      cleanup$,
      defer(() => (waiting.length > 0 ? this.pauseThenResubmit(waiting, null, skipNotification) : EMPTY))
    );
  }

  /**
   * Request-level failures: 429 pauses unless its cooldown exceeds the automatic wait limit;
   * 401/403/404 stop the run, 400 rejects the chunk, and anything else leaves its outcome unknown.
   */
  private handleChunkError(rows: MemberImportRow[], err: unknown, skipNotification: boolean): Observable<void> {
    const httpError = err instanceof HttpErrorResponse ? err : null;
    const status = httpError?.status ?? 0;
    // Log only the status: raw errors may contain imported personal data.
    console.error('CSV member import chunk failed', { status });

    if (httpError && status === 429) {
      // Both the BFF and upstream can throttle. Preserve any uncertainty from an earlier attempt.
      this.patchRows(rows, { status: 'waiting', reason: 'The service asked the import to slow down. It will resume automatically.' });
      return this.pauseThenResubmit(rows, httpError.headers?.get('Retry-After') ?? '', skipNotification);
    }
    if (httpError && MEMBER_IMPORT_FATAL_HTTP_STATUSES.has(status)) {
      const reason = this.failureReason(httpError);
      this.stopReason.set(this.stopReason() ?? reason);
      this.markUnsubmitted(rows, reason);
      return EMPTY;
    }
    if (httpError && status === 400) {
      const message = extractErrorMessage(httpError, 'The service rejected these rows.');
      for (const row of rows) {
        const uncertain = this.findRow(row.rowNumber)?.uncertain;
        this.patchRow(row.rowNumber, {
          status: uncertain ? 'unknown' : 'failed',
          retryable: false,
          reason: `${uncertain ? 'The earlier outcome is unknown. ' : ''}${message} Fix the file and import it again.`,
        });
      }
      this.batchSettled.update((count) => count + rows.length);
      return EMPTY;
    }

    this.patchRows(rows, {
      status: 'waiting',
      uncertain: true,
      reason: 'The outcome is unknown. These rows will be checked and sent again automatically.',
    });
    return this.pauseThenResubmit(rows, null, skipNotification);
  }

  /**
   * Waits, then resubmits the rows as a new chunk. Stops when the pause budget is spent, a server
   * cooldown exceeds the automatic wait limit, or the run already stopped. Unresolved submitted
   * attempts remain Outcome unknown; only unsent rows are Not yet submitted.
   */
  private pauseThenResubmit(rows: MemberImportRow[], retryAfter: string | null, skipNotification: boolean): Observable<void> {
    return defer(() => {
      const delay = getMemberImportRetryDelayMs(retryAfter, this.pauseCount());
      if (retryAfter !== null) {
        this.setRetryDeadline(Math.max(this.retryNotBefore(), Date.now() + delay));
      }
      if (delay > MEMBER_IMPORT_RETRY_AFTER_MAX_MS) {
        const reason = 'The service cooldown exceeds the automatic wait limit. Automatic recovery stopped; retry once the service permits.';
        this.stopReason.set(reason);
        this.markUnsubmitted(rows, reason);
        return EMPTY;
      }
      const stopReason = this.stopReason();
      if (stopReason) {
        this.markUnsubmitted(rows, stopReason);
        return EMPTY;
      }
      if (this.pauseCount() >= MEMBER_IMPORT_MAX_PAUSES) {
        const reason = 'Automatic recovery has stopped after three pauses. Review the outcomes before retrying.';
        this.stopReason.set(reason);
        this.markUnsubmitted(rows, reason);
        return EMPTY;
      }

      this.patchRows(rows, { status: 'waiting' });
      this.pauseCount.update((count) => count + 1);
      this.resumeInSeconds.set(Math.ceil(delay / 1000));
      this.resumeAt.set(Date.now() + delay);

      return race(
        timer(delay).pipe(map(() => true)),
        this.stopRequested.pipe(
          take(1),
          map(() => false)
        )
      ).pipe(
        switchMap((resume) => {
          this.resumeAt.set(null);
          if (!resume) {
            this.markUnsubmitted(rows, 'You stopped the import.');
            return EMPTY;
          }
          return this.submitChunk(rows, skipNotification);
        })
      );
    });
  }

  /** Clear elapsed cooldowns without resubmitting; recheck long deadlines in bounded timer intervals. */
  private setRetryDeadline(deadline: number): void {
    this.retryDeadlineTimer?.unsubscribe();
    this.retryNotBefore.set(deadline);
    const remaining = deadline - Date.now();
    if (remaining <= 0 || !Number.isFinite(remaining)) {
      return;
    }
    this.retryDeadlineTimer = timer(Math.min(remaining, MEMBER_IMPORT_RETRY_AFTER_MAX_MS))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.setRetryDeadline(Date.now() < deadline ? deadline : 0));
  }

  /** Emits the cleanup warning (or undefined) — a failed revoke never turns an added member into a failure. */
  private revokePendingInvite(row: MemberImportRow): Observable<string | undefined> {
    const inviteUid = this.pendingInviteUidByEmail.get(row.normalizedEmail);
    if (!inviteUid) {
      return of(undefined);
    }
    return this.committeeService.revokeCommitteeInvite(this.committeeUid, inviteUid).pipe(
      map(() => {
        this.pendingInviteUidByEmail.delete(row.normalizedEmail);
        return undefined;
      }),
      catchError((err: HttpErrorResponse) => {
        console.error('CSV member import invitation cleanup failed', { status: err.status });
        const reason = err.status === 404 ? 'The pending invitation could not be found. Review pending invitations before retrying.' : this.failureReason(err);
        this.stopForFatalError(err, reason);
        return of('Added, but their pending invitation could not be revoked. Revoke it from the Pending tab.');
      })
    );
  }

  /** Share stop handling across creation and cleanup without changing an already-added row's outcome. */
  private stopForFatalError(err: HttpErrorResponse, reason: string): void {
    if (MEMBER_IMPORT_FATAL_HTTP_STATUSES.has(err.status) && !this.stopReason()) {
      this.stopReason.set(reason);
    }
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
  private markUnsubmitted(targets: MemberImportRow[], reason: string): void {
    for (const target of targets) {
      const uncertain = this.findRow(target.rowNumber)?.uncertain;
      this.patchRow(target.rowNumber, {
        status: uncertain ? 'unknown' : 'not_submitted',
        reason: uncertain ? `The outcome of an earlier attempt is unknown. Review the roster before retrying. ${reason}` : `Not sent: ${reason}`,
      });
    }
  }

  private patchRow(rowNumber: number, patch: Partial<MemberImportRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row)));
  }

  private patchRows(targets: MemberImportRow[], patch: Partial<MemberImportRow>): void {
    if (targets.length === 0) {
      return;
    }
    const rowNumbers = new Set(targets.map((row) => row.rowNumber));
    this.rows.update((rows) => rows.map((row) => (rowNumbers.has(row.rowNumber) ? { ...row, ...patch } : row)));
  }

  private findRow(rowNumber: number): MemberImportRow | undefined {
    return this.rows().find((row) => row.rowNumber === rowNumber);
  }

  /** Retry unresolved attempts, unsent rows and retryable failures, but never unchanged invalid data. */
  private isRetryable(row: MemberImportRow): boolean {
    return row.status === 'not_submitted' || ((row.status === 'failed' || row.status === 'unknown') && row.retryable !== false);
  }

  private countRows(status: MemberImportRow['status']): number {
    return this.rows().filter((row) => row.status === status).length;
  }

  /** Moves focus to the outcome summary — the Import button that had focus is gone once results show. */
  private focusResultSummary(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    afterNextRender(() => this.resultSummary()?.nativeElement.focus(), { injector: this.injector });
  }
}
