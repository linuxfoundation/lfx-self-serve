// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  MEMBER_IMPORT_INVALID_ROWS_FILENAME,
  MEMBER_IMPORT_MAX_FILE_BYTES,
  MEMBER_IMPORT_MAX_PAUSES,
  MEMBER_IMPORT_MAX_RECORDS,
  MEMBER_IMPORT_PAGE_SIZE,
  MEMBER_IMPORT_STATUS_DISPLAY,
  MEMBER_IMPORT_TEMPLATE_FILENAME,
} from '@lfx-one/shared/constants';
import {
  CommitteeInvite,
  FilterPillColor,
  FilterPillOption,
  MemberImportDialogData,
  MemberImportDialogPhase,
  MemberImportDialogResult,
  MemberImportFieldGuide,
  MemberImportGroupRules,
  MemberImportRow,
  MemberImportRowStatus,
  MemberImportRowView,
  MemberImportRun,
  MemberImportStatusFilter,
  StagedCommitteeMemberRequest,
} from '@lfx-one/shared/interfaces';
import {
  buildMemberImportInvalidRowsCsv,
  committeeRequiresOrganization,
  decodeMemberImportFile,
  downloadCsv,
  getMemberImportFieldGuide,
  getMemberImportTemplateHeaders,
  isMemberImportRowRetryable,
  parseMemberImportCsv,
  prepareMemberImportRows,
} from '@lfx-one/shared/utils';
import { CommitteeMemberImportService } from '@services/committee-member-import.service';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { FileSelectEvent } from 'primeng/fileupload';
import { TablePageEvent } from 'primeng/table';
import { pairwise } from 'rxjs';

/**
 * Import members into an existing group from a CSV (GH-3849).
 *
 * The file is read and validated locally into a read-only preview; nothing is written until the
 * user confirms. CommitteeMemberImportService then runs the confirmed rows against the committee bulk
 * member route (GH-5111) and retains the run per group (#5730); this dialog projects that run. Each
 * row keeps its own outcome; Retry resubmits rows that were not sent and failures that can still
 * succeed, and Close returns confirmed counts and any unresolved attempt so the roster refreshes, then
 * dismisses the settled run. Reopening the dialog for a group with a retained run shows that run
 * instead of starting another. Until hide/reopen controls exist (#5731), destroying the dialog stops
 * its active run after the in-flight batch. An inline spinner stays active through automatic recovery;
 * processed counts come only from results. Never resolves organizations, creates invitations, or
 * changes permissions.
 * In collect-only mode, confirmation returns validated member requests to the create or edit wizard
 * instead of writing them; the wizard saves them with Done or Update Group.
 */
@Component({
  selector: 'lfx-import-members-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    CheckboxComponent,
    FileUploadComponent,
    FilterPillsComponent,
    TableComponent,
    TagComponent,
    UiSpinnerComponent,
  ],
  templateUrl: './import-members-dialog.component.html',
  styleUrl: './import-members-dialog.component.scss',
})
export class ImportMembersDialogComponent {
  private readonly importService = inject(CommitteeMemberImportService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  /** The subject that opened the dialog; a different observed subject closes it without a result. */
  private readonly viewerSubject = this.importService.viewerSubject();

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
  private readonly pendingInviteUidByEmail: Record<string, string> = this.initPendingInvites(this.data.existingInvites ?? []);

  public readonly form = new FormGroup({
    send_notification: new FormControl<boolean>(false, { nonNullable: true }),
  });

  public fileName = signal<string | null>(null);
  public fileErrors = signal<string[]>([]);
  /** Non-blocking notes about how the chosen file was read (encoding fallback, ignored columns). */
  public fileNotices = signal<string[]>([]);
  public reading = signal(false);
  public readonly maxPauses = MEMBER_IMPORT_MAX_PAUSES;
  public readonly tablePageSize = MEMBER_IMPORT_PAGE_SIZE;
  /** Status chosen in the table's filter pills; see activeStatusFilter for the one applied. */
  public statusFilter = signal<MemberImportStatusFilter>('all');
  /** Index of the first table row shown, so a filter change can return to page 1. */
  public tableFirst = signal(0);
  /** Local file selection and preview; replaced by the run's projection once an import starts. */
  private readonly previewPhase = signal<'select' | 'preview'>('select');
  private readonly previewRows = signal<MemberImportRow[]>([]);
  private readonly closing = signal(false);
  /** Keep the final projection until the closing view is destroyed, after the service run is dismissed. */
  private readonly closingRun = signal<MemberImportRun | undefined>(undefined);

  /** This subject's retained run for the pinned group; wizard collection never starts or shows one. */
  private readonly run: Signal<MemberImportRun | undefined> = this.initRun();
  public readonly phase: Signal<MemberImportDialogPhase> = this.initPhase();
  public readonly rows: Signal<MemberImportRow[]> = computed(() => this.run()?.rows ?? this.previewRows());
  /** Set when auth/not-found, the pause cap, an excessive server cooldown or Stop import ends the run. */
  public readonly stopReason = computed(() => this.run()?.stopReason ?? null);
  public readonly batchTotal = computed(() => this.run()?.batchTotal ?? 0);
  public readonly batchSettled = computed(() => this.run()?.batchSettled ?? 0);
  /** Epoch ms when a paused run resumes automatically; null while not paused. */
  public readonly resumeAt = computed(() => this.run()?.resumeAt ?? null);
  /** Length of the current pause, rounded up to whole seconds, for the paused notice. */
  public readonly resumeInSeconds = computed(() => this.run()?.resumeInSeconds ?? 0);
  /** Automatic pauses taken by the current run (at most MEMBER_IMPORT_MAX_PAUSES). */
  public readonly pauseCount = computed(() => this.run()?.pauseCount ?? 0);
  /** Minimum server deadline, retained even if automatic recovery or a pause is stopped. */
  public readonly retryNotBefore = computed(() => this.run()?.retryNotBefore ?? 0);
  /** Distinguishes the manager's Stop action from fatal errors and automatic recovery limits. */
  private readonly manualStopRequested = computed(() => !!this.run()?.manualStopRequested);

  public readonly busy = computed(() => this.closing() || this.reading() || this.phase() === 'importing');
  public readonly readyCount = computed(() => this.countRows('ready'));
  public readonly invalidCount = computed(() => this.countRows('invalid'));
  public readonly skippedCount = computed(() => this.countRows('skipped'));
  public readonly addedCount = computed(() => this.countRows('added'));
  public readonly failedCount = computed(() => this.countRows('failed'));
  public readonly unknownCount = computed(() => this.countRows('unknown'));
  public readonly waitingCount = computed(() => this.countRows('waiting'));
  public readonly notSubmittedCount = computed(() => this.countRows('not_submitted'));
  public readonly retryableCount = computed(() => this.rows().filter(isMemberImportRowRetryable).length);
  public readonly paused = computed(() => this.resumeAt() !== null);
  /** The manager requested a stop outside a pause; the in-flight batch settles before the run ends. */
  public readonly stopping = computed(() => this.phase() === 'importing' && !this.paused() && this.manualStopRequested());
  public readonly conflictCount = computed(() => this.rows().filter((row) => row.conflict).length);
  public readonly cleanupWarningCount = computed(() => this.rows().filter((row) => row.cleanupWarning).length);
  public readonly canImport = computed(
    () => !this.closing() && this.phase() === 'preview' && this.readyCount() > 0 && this.importService.viewerSubject() === this.viewerSubject
  );
  public readonly canRetry = computed(() => !this.closing() && this.phase() === 'results' && this.retryableCount() > 0);
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
  public readonly submitLabel: Signal<string> = this.initSubmitLabel();
  public readonly rowViews: Signal<MemberImportRowView[]> = this.initRowViews();
  /** The selected status, or `all` once no row has it (e.g. the last invalid row was removed or Ready rows were sent). */
  public readonly activeStatusFilter: Signal<MemberImportStatusFilter> = this.initActiveStatusFilter();
  public readonly statusFilterOptions: Signal<FilterPillOption[]> = this.initStatusFilterOptions();
  public readonly filteredRowViews: Signal<MemberImportRowView[]> = this.initFilteredRowViews();
  public readonly statusMessage: Signal<string> = this.initStatusMessage();

  public constructor() {
    this.initStatusFilterReset();
    this.initTablePageBounds();
    this.initRunNotification();
    this.initRunTransitions();
    this.initSubjectChange();
    // Until the dependent hide/reopen issue (#5731), a torn-down view schedules no later chunk or retry.
    this.destroyRef.onDestroy(() => {
      if (this.run()?.status === 'importing') {
        this.importService.stop(this.committeeUid);
      }
    });
  }

  public downloadTemplate(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    downloadCsv(MEMBER_IMPORT_TEMPLATE_FILENAME, [getMemberImportTemplateHeaders(this.rules)]);
  }

  /** Invalid rows with their original values and problems, to fix and import again. */
  public downloadInvalidRows(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    downloadCsv(MEMBER_IMPORT_INVALID_ROWS_FILENAME, buildMemberImportInvalidRowsCsv(this.rows(), this.rules));
  }

  public onStatusFilterChange(filter: string): void {
    this.statusFilter.set(filter as MemberImportStatusFilter);
    this.tableFirst.set(0);
  }

  public onTablePage(event: TablePageEvent): void {
    this.tableFirst.set(event.first);
  }

  public onFileSelect(event: FileSelectEvent): void {
    const file = event.files?.[0];
    if (!file || !this.canChooseFile() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    this.fileName.set(file.name);
    this.previewRows.set([]);
    this.fileNotices.set([]);
    this.previewPhase.set('select');
    this.statusFilter.set('all');
    this.tableFirst.set(0);

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
      .then((buffer) => {
        const { text, encoding } = decodeMemberImportFile(buffer);
        if (encoding === 'windows-1252') {
          this.fileNotices.set([
            "This file wasn't saved as UTF-8, so it was read as Windows (Western European) text. Check that names with accents look right before adding.",
          ]);
        }
        this.applyFileText(text);
      })
      .catch(() => this.fileErrors.set(['The file could not be read. Choose it again.']))
      .finally(() => this.reading.set(false));
  }

  public removeRow(rowNumber: number): void {
    if (this.closing() || this.phase() !== 'preview') {
      return;
    }
    // Removing the retained occurrence releases the next duplicate, keeping original source row numbers.
    this.previewRows.update((rows) =>
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
      this.closing.set(true);
      this.form.controls.send_notification.disable();
      this.dialogRef.close(members);
      return;
    }
    const started = this.importService.start({
      committeeUid: this.committeeUid,
      committeeName: this.committeeName,
      rules: this.rules,
      fileName: this.fileName(),
      rows: this.rows(),
      skipNotification: !this.form.controls.send_notification.value,
      pendingInviteUidByEmail: this.pendingInviteUidByEmail,
      baselineMemberCount: (this.data.existingMembers ?? []).length,
    });
    if (started) {
      this.form.controls.send_notification.disable();
    }
  }

  public retryFailed(): void {
    if (!this.canRetry() || Date.now() < this.retryNotBefore()) {
      return;
    }
    if (this.importService.retry(this.committeeUid, { skipNotification: !this.form.controls.send_notification.value })) {
      this.form.controls.send_notification.disable();
    }
  }

  /**
   * Ends the run after the in-flight batch settles, or ends a pause immediately, without losing
   * unknown outcomes; genuinely unsent rows remain Not yet submitted.
   */
  public stopImport(): void {
    if (this.phase() !== 'importing' || this.stopReason()) {
      return;
    }
    this.importService.stop(this.committeeUid);
  }

  public close(): void {
    if (this.busy()) {
      return;
    }
    this.closing.set(true);
    this.form.controls.send_notification.disable();
    if (this.collectOnly) {
      this.dialogRef.close();
      return;
    }
    const run = this.run();
    const result: MemberImportDialogResult = {
      added: this.addedCount(),
      conflicts: this.conflictCount(),
      ...(this.rows().some((row) => row.uncertain) ? { uncertain: true } : {}),
      ...(run ? { baselineMemberCount: run.baselineMemberCount } : {}),
    };
    this.closingRun.set(run);
    this.previewRows.set([]);
    this.previewPhase.set('select');
    this.dialogRef.close(result);
    // The result above is captured; the settled run no longer blocks the next import into this group.
    this.importService.dismiss(this.committeeUid);
  }

  private initPendingInvites(invites: CommitteeInvite[]): Record<string, string> {
    const byEmail: Record<string, string> = {};
    for (const invite of invites) {
      const email = (invite.invitee_email ?? '').trim().toLowerCase();
      if (email && invite.uid && (invite.status ?? '').toLowerCase() === 'pending') {
        byEmail[email] = invite.uid;
      }
    }
    return byEmail;
  }

  private initRun(): Signal<MemberImportRun | undefined> {
    return computed(() => {
      if (this.collectOnly || this.importService.viewerSubject() !== this.viewerSubject) return undefined;
      return this.closingRun() ?? this.importService.getRun(this.committeeUid);
    });
  }

  private initPhase(): Signal<MemberImportDialogPhase> {
    return computed(() => {
      const run = this.run();
      if (!run) {
        return this.previewPhase();
      }
      return run.status === 'importing' ? 'importing' : 'results';
    });
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

  private initSubmitLabel(): Signal<string> {
    return computed(() => {
      const verb = this.collectOnly ? 'Import' : 'Add';
      const ready = this.readyCount();
      const skip = this.invalidCount() > 0 ? ` (skip ${this.invalidCount()} invalid)` : '';
      return `${verb} ${ready} ${ready === 1 ? 'member' : 'members'}${skip}`;
    });
  }

  private initActiveStatusFilter(): Signal<MemberImportStatusFilter> {
    return computed(() => {
      const filter = this.statusFilter();
      return filter === 'all' || this.rows().some((row) => row.status === filter) ? filter : 'all';
    });
  }

  /** `All` plus one pill per status present, in lifecycle order, each labelled with its row count. */
  private initStatusFilterOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const statuses = Object.keys(MEMBER_IMPORT_STATUS_DISPLAY) as MemberImportRowStatus[];
      const options = statuses.flatMap((status): FilterPillOption[] => {
        const count = this.countRows(status);
        if (count === 0) {
          return [];
        }
        const { label, severity } = MEMBER_IMPORT_STATUS_DISPLAY[status];
        return [{ id: status, label: `${label} (${count})`, color: this.statusFilterColor(severity) }];
      });
      return [{ id: 'all', label: `All (${this.rows().length})` }, ...options];
    });
  }

  private initFilteredRowViews(): Signal<MemberImportRowView[]> {
    return computed(() => {
      const filter = this.activeStatusFilter();
      return filter === 'all' ? this.rowViews() : this.rowViews().filter((view) => view.row.status === filter);
    });
  }

  /** Keep All selected after a disappearing status triggers the fallback. */
  private initStatusFilterReset(): void {
    toObservable(this.activeStatusFilter)
      .pipe(takeUntilDestroyed())
      .subscribe((filter) => {
        if (filter === 'all' && this.statusFilter() !== 'all') this.statusFilter.set('all');
      });
  }

  /** Synchronize the lock from snapshots, even if a fast attempt never emits an importing phase. */
  private initRunNotification(): void {
    const run = this.run();
    if (run) {
      this.form.controls.send_notification.setValue(!run.skipNotification);
    }
    if (run?.status === 'importing') {
      this.form.controls.send_notification.disable();
    }
    toObservable(this.run)
      .pipe(takeUntilDestroyed())
      .subscribe((current) => {
        if (this.closing() || current?.status === 'importing') {
          this.form.controls.send_notification.disable();
        } else {
          this.form.controls.send_notification.enable();
        }
      });
  }

  /** Move focus only on a phase transition, independently of notification-control synchronization. */
  private initRunTransitions(): void {
    toObservable(this.phase)
      .pipe(pairwise(), takeUntilDestroyed())
      .subscribe(([previous, current]) => {
        if (current === 'results' && previous !== 'results') {
          this.focusResultSummary();
        }
      });
  }

  /**
   * Like the vote summary dialog, closes without a result when the observed subject changes: the service has
   * already discarded the previous subject's run, and its file preview must not be shown or resubmitted.
   */
  private initSubjectChange(): void {
    toObservable(this.importService.viewerSubject)
      .pipe(takeUntilDestroyed())
      .subscribe((subject) => {
        if (subject === this.viewerSubject) return;
        this.closingRun.set(undefined);
        this.previewRows.set([]);
        this.previewPhase.set('select');
        this.fileName.set(null);
        this.dialogRef.close();
      });
  }

  /** Preserve valid pages, but keep live status-filter results within the current page bounds. */
  private initTablePageBounds(): void {
    toObservable(this.filteredRowViews)
      .pipe(takeUntilDestroyed())
      .subscribe((rows) => {
        const lastPageFirst = Math.max(0, Math.ceil(rows.length / this.tablePageSize) - 1) * this.tablePageSize;
        if (this.tableFirst() > lastPageFirst) this.tableFirst.set(lastPageFirst);
      });
  }

  private initStatusMessage(): Signal<string> {
    return computed(() => {
      switch (this.phase()) {
        case 'preview': {
          const notices = this.fileNotices().length > 0 ? ` ${this.fileNotices().join(' ')}` : '';
          return `${this.readyCount()} ready, ${this.invalidCount()} invalid, ${this.skippedCount()} skipped.${notices}`;
        }
        case 'importing':
          if (this.stopping()) {
            return `Stopping after the current batch: ${this.batchSettled()} of ${this.batchTotal()} processed.`;
          }
          return `Importing members: ${this.batchSettled()} of ${this.batchTotal()} processed.`;
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

  /** Problem statuses read red and added rows green; the rest keep the default pill style. */
  private statusFilterColor(severity: MemberImportRowView['statusSeverity']): FilterPillColor | undefined {
    if (severity === 'danger') {
      return 'red';
    }
    if (severity === 'success') {
      return 'green';
    }
    return undefined;
  }

  private applyFileText(text: string): void {
    const parsed = parseMemberImportCsv(text, this.rules);
    if (parsed.errors.length > 0) {
      this.fileErrors.set(parsed.errors);
      return;
    }
    if (parsed.ignoredColumns.length > 0) {
      this.fileNotices.update((notices) => [...notices, `Ignored columns: ${parsed.ignoredColumns.join(', ')}. The import doesn't use them.`]);
    }
    this.previewRows.set(prepareMemberImportRows(parsed.records, this.rules, this.existingMemberEmails));
    this.previewPhase.set('preview');
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
