// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
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
  MEMBER_IMPORT_FATAL_HTTP_STATUSES,
  MEMBER_IMPORT_MAX_FILE_BYTES,
  MEMBER_IMPORT_MAX_RECORDS,
  MEMBER_IMPORT_STATUS_DISPLAY,
  MEMBER_IMPORT_TEMPLATE_FILENAME,
} from '@lfx-one/shared/constants';
import {
  CommitteeInvite,
  MemberImportDialogData,
  MemberImportDialogPhase,
  MemberImportDialogResult,
  MemberImportFieldGuide,
  MemberImportGroupRules,
  MemberImportRow,
  MemberImportRowView,
} from '@lfx-one/shared/interfaces';
import {
  committeeRequiresOrganization,
  downloadCsv,
  getMemberImportFieldGuide,
  getMemberImportTemplateHeaders,
  parseMemberImportCsv,
  prepareMemberImportRows,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { FileSelectEvent } from 'primeng/fileupload';
import { catchError, from, map, mergeMap, Observable, of, switchMap } from 'rxjs';

/**
 * Import members into an existing group from a CSV (GH-3849).
 *
 * The file is read and validated locally into a read-only preview; nothing is written until the
 * user confirms. Confirmed rows are created one POST per member through the same direct-add route
 * as Add Member (bounded by COMMITTEE_INVITE_CONCURRENCY), so the per-member server checks still
 * apply. Each row keeps its own outcome; Retry resubmits failed rows only, and Close returns the
 * cumulative added/conflict counts so the roster refreshes. Never resolves organizations, creates
 * invitations, or changes permissions.
 */
@Component({
  selector: 'lfx-import-members-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, CheckboxComponent, FileUploadComponent, TableComponent, TagComponent],
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
  /** Set when an auth/not-found response stopped the run; unsent rows stay retryable. */
  public stopReason = signal<string | null>(null);
  public batchTotal = signal(0);
  public batchSettled = signal(0);

  public readonly busy = computed(() => this.reading() || this.phase() === 'importing');
  public readonly readyCount = computed(() => this.countRows('ready'));
  public readonly invalidCount = computed(() => this.countRows('invalid'));
  public readonly skippedCount = computed(() => this.countRows('skipped'));
  public readonly addedCount = computed(() => this.countRows('added'));
  public readonly failedCount = computed(() => this.countRows('failed'));
  public readonly conflictCount = computed(() => this.rows().filter((row) => row.conflict).length);
  public readonly cleanupWarningCount = computed(() => this.rows().filter((row) => row.cleanupWarning).length);
  public readonly canImport = computed(() => this.phase() === 'preview' && this.readyCount() > 0 && this.invalidCount() === 0);
  public readonly canRetry = computed(() => this.phase() === 'results' && this.failedCount() > 0);
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
    this.submitRows(this.rows().filter((row) => row.status === 'ready'));
  }

  public retryFailed(): void {
    if (!this.canRetry()) {
      return;
    }
    this.submitRows(this.rows().filter((row) => row.status === 'failed'));
  }

  public close(): void {
    if (this.busy()) {
      return;
    }
    const result: MemberImportDialogResult = { added: this.addedCount(), conflicts: this.conflictCount() };
    this.dialogRef.close(result);
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
   * Creates the given rows, at most COMMITTEE_INVITE_CONCURRENCY at a time, recording each outcome as
   * it settles. mergeMap calls the project function only when a slot frees, so a fatal response stops
   * every not-yet-started row; in-flight requests are left to settle rather than cancelled, because a
   * cancelled request may still have been committed upstream.
   */
  private submitRows(rows: MemberImportRow[]): void {
    if (rows.length === 0) {
      return;
    }
    const skipNotification = !this.form.controls.send_notification.value;
    let stopReason: string | null = null;

    this.stopReason.set(null);
    this.batchTotal.set(rows.length);
    this.batchSettled.set(0);
    this.form.controls.send_notification.disable();
    this.phase.set('importing');

    from(rows)
      .pipe(
        mergeMap((row): Observable<Partial<MemberImportRow> & { rowNumber: number }> => {
          if (stopReason || !row.payload) {
            return of({ rowNumber: row.rowNumber, status: 'failed', reason: `Not sent: ${stopReason ?? 'missing member data.'}` });
          }
          this.patchRow(row.rowNumber, { status: 'importing', reason: undefined });
          return this.committeeService.createCommitteeMember(this.committeeUid, row.payload, { skipNotification }).pipe(
            switchMap(() => this.revokePendingInvite(row)),
            map((cleanupWarning) => ({ rowNumber: row.rowNumber, status: 'added' as const, reason: undefined, cleanupWarning })),
            catchError((err: HttpErrorResponse) => {
              if (err.status === 409) {
                return of({ rowNumber: row.rowNumber, status: 'skipped' as const, conflict: true, reason: 'Already a member of this group.' });
              }
              const reason = this.failureReason(err);
              if (MEMBER_IMPORT_FATAL_HTTP_STATUSES.has(err.status) && !stopReason) {
                stopReason = reason;
                this.stopReason.set(reason);
              }
              return of({ rowNumber: row.rowNumber, status: 'failed' as const, reason });
            })
          );
        }, COMMITTEE_INVITE_CONCURRENCY),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ rowNumber, ...outcome }) => {
          this.patchRow(rowNumber, outcome);
          this.batchSettled.update((count) => count + 1);
        },
        complete: () => {
          // takeUntilDestroyed also completes the stream when the dialog is torn down mid-import.
          if (this.destroyRef.destroyed) {
            return;
          }
          this.form.controls.send_notification.enable();
          this.phase.set('results');
          this.focusResultSummary();
        },
      });
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
      catchError(() => of('Added, but their pending invitation could not be revoked. Revoke it from the Pending tab.'))
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

  private patchRow(rowNumber: number, patch: Partial<MemberImportRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row)));
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
          return `Adding members: ${this.batchSettled()} of ${this.batchTotal()} done.`;
        case 'results':
          return `${this.addedCount()} added, ${this.skippedCount()} skipped, ${this.failedCount()} failed.`;
        default:
          return this.fileErrors().length > 0 ? 'The file could not be imported. See the errors below.' : '';
      }
    });
  }
}
