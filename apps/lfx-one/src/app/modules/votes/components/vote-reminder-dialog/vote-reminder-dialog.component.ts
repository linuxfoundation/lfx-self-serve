// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { VOTE_REMINDER_INACTIVE, VOTE_REMINDER_PRECHECK_FAILED, VOTE_REMINDER_SELECTION_STALE } from '@lfx-one/shared/constants';
import { VoteReminderRecipient, VoteTableRow } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { isBffTransportFailure } from '@shared/utils/upstream-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize, take } from 'rxjs';

/**
 * Lets a vote manager remind the eligible voters who have not voted on an active vote yet (#3769).
 * Every recipient starts selected; Send reminds exactly the selected ones.
 */
@Component({
  selector: 'lfx-vote-reminder-dialog',
  imports: [ButtonComponent, CheckboxComponent, EmptyStateComponent, ReactiveFormsModule, SkeletonModule],
  templateUrl: './vote-reminder-dialog.component.html',
})
export class VoteReminderDialogComponent {
  private readonly config = inject<DynamicDialogConfig<{ vote: VoteTableRow }>>(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly voteService = inject(VoteService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly voteUid: string = this.config.data!.vote.uid;

  protected readonly skeletonRows = [0, 1, 2];

  protected checkboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});
  protected readonly selectAllForm = new FormGroup({ all: new FormControl(false, { nonNullable: true }) });

  protected readonly recipients = signal<VoteReminderRecipient[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly inactive = signal(false);
  protected readonly sending = signal(false);
  protected readonly selectedUids = signal<Set<string>>(new Set());

  protected readonly selectedCount = computed(() => this.selectedUids().size);
  protected readonly allSelected = computed(() => this.recipients().length > 0 && this.selectedCount() === this.recipients().length);

  public constructor() {
    lockDynamicDialogWhile(this.sending);
    this.loadRecipients();
  }

  protected toggleRecipient(uid: string): void {
    // While sending, re-assert the selection so a checkbox the user just clicked snaps back.
    if (this.sending()) {
      this.setSelection(this.selectedUids());
      return;
    }
    const current = new Set(this.selectedUids());
    if (current.has(uid)) {
      current.delete(uid);
    } else {
      current.add(uid);
    }
    this.setSelection(current);
  }

  protected toggleSelectAll(): void {
    if (this.sending()) {
      this.setSelection(this.selectedUids());
      return;
    }
    this.setSelection(this.allSelected() ? new Set() : new Set(this.recipients().map((r) => r.uid)));
  }

  protected retry(): void {
    this.loadRecipients();
  }

  protected send(): void {
    const recipientIds = [...this.selectedUids()];
    if (recipientIds.length === 0 || this.sending()) return;

    this.sending.set(true);
    this.voteService
      .sendReminders(this.voteUid, recipientIds)
      .pipe(
        // An initiated write must finish even if navigation destroys this dialog.
        take(1),
        finalize(() => this.sending.set(false))
      )
      .subscribe({
        next: (result) => {
          const count = result.recipient_count;
          const noun = count === 1 ? 'voter' : 'voters';
          this.messageService.add({ severity: 'success', summary: 'Reminder sent', detail: `Reminder sent to ${count} ${noun}.` });
          if (!this.destroyRef.destroyed) this.ref.close(true);
        },
        error: (error: unknown) => {
          const detail = this.sendErrorMessage(error);
          this.messageService.add({
            severity: 'error',
            summary: this.isUnconfirmedSend(error) ? 'Outcome unconfirmed' : "Couldn't send reminder",
            detail,
          });
          if (this.isReminderConflict(error, VOTE_REMINDER_INACTIVE) || this.isReminderConflict(error, VOTE_REMINDER_SELECTION_STALE)) {
            this.recipients.set([]);
            this.setSelection(new Set());
            this.inactive.set(this.isReminderConflict(error, VOTE_REMINDER_INACTIVE));
            if (!this.inactive()) this.loadError.set(detail);
          }
        },
      });
  }

  protected cancel(): void {
    // Closing mid-send would drop the outcome toast while the emails still go out.
    if (this.sending()) return;
    this.ref.close(false);
  }

  private loadRecipients(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.inactive.set(false);
    this.voteService
      .getReminderRecipients(this.voteUid)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (recipients) => {
          const controls: Record<string, FormControl<boolean>> = {};
          for (const recipient of recipients) {
            controls[recipient.uid] = new FormControl(true, { nonNullable: true });
          }
          this.checkboxForm = new FormGroup(controls);
          this.recipients.set(recipients);
          this.setSelection(new Set(recipients.map((r) => r.uid)));
        },
        error: (error: unknown) => {
          this.recipients.set([]);
          this.setSelection(new Set());
          this.inactive.set(this.isReminderConflict(error, VOTE_REMINDER_INACTIVE));
          if (!this.inactive()) this.loadError.set(this.loadErrorMessage(error));
        },
      });
  }

  /** The selection set is the source of truth; checkbox controls only mirror it. */
  private setSelection(selection: Set<string>): void {
    this.selectedUids.set(selection);
    for (const [uid, control] of Object.entries(this.checkboxForm.controls)) {
      control.setValue(selection.has(uid), { emitEvent: false });
    }
    this.selectAllForm.controls.all.setValue(this.allSelected(), { emitEvent: false });
  }

  private loadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return "You don't have permission to send reminders for this vote.";
    }
    return "We couldn't load the voter list. Please try again.";
  }

  private isReminderConflict(error: unknown, code: string): boolean {
    return error instanceof HttpErrorResponse && error.status === 409 && error.error?.code === code;
  }

  private isPreSendFailure(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.error?.code === VOTE_REMINDER_PRECHECK_FAILED;
  }

  private isUnconfirmedSend(error: unknown): boolean {
    if (this.isPreSendFailure(error)) return false;
    if (!(error instanceof HttpErrorResponse) || isBffTransportFailure(error)) return true;
    return (
      ![400, 403, 429].includes(error.status) &&
      !this.isReminderConflict(error, VOTE_REMINDER_INACTIVE) &&
      !this.isReminderConflict(error, VOTE_REMINDER_SELECTION_STALE)
    );
  }

  private sendErrorMessage(error: unknown): string {
    if (this.isPreSendFailure(error)) {
      return "We couldn't verify access or the voter list. No reminders were sent. Please try again.";
    }
    if (this.isReminderConflict(error, VOTE_REMINDER_INACTIVE)) return 'This vote is no longer active. Reminders cannot be sent.';
    if (this.isReminderConflict(error, VOTE_REMINDER_SELECTION_STALE)) {
      return 'Some selected voters are no longer eligible. No reminders were sent. Reload the voter list and select recipients again.';
    }
    if (this.isUnconfirmedSend(error)) {
      return "We couldn't confirm whether reminders were sent. Retrying may send duplicate emails.";
    }
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    switch (status) {
      case 400:
        return 'This vote is no longer active, or some recipients are no longer eligible. Refresh and try again.';
      case 403:
        return "You don't have permission to send reminders for this vote.";
      case 429:
        return 'Too many reminders were sent just now. Please try again in a minute.';
      default:
        return "We couldn't confirm whether reminders were sent. Retrying may send duplicate emails.";
    }
  }
}
