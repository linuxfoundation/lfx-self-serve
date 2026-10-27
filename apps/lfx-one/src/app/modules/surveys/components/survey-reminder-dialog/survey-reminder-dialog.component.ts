// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { SurveyReminderDialogData, SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { SurveyService } from '@services/survey.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { isBffTransportFailure } from '@shared/utils/upstream-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize, take } from 'rxjs';

/**
 * Lets a survey manager resend the survey email to recipients who have not responded (#4340).
 * Every offered recipient starts selected; Send reminds exactly the selected ones.
 */
@Component({
  selector: 'lfx-survey-reminder-dialog',
  imports: [ButtonComponent, CheckboxComponent, ReactiveFormsModule],
  templateUrl: './survey-reminder-dialog.component.html',
})
export class SurveyReminderDialogComponent {
  // === Services ===
  private readonly config = inject<DynamicDialogConfig<SurveyReminderDialogData>>(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly surveyService = inject(SurveyService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // === Constants ===
  private readonly surveyUid: string = this.config.data!.survey.uid;
  protected readonly recipients: SurveyResponseItem[] = this.config.data!.recipients;

  // === Forms ===
  protected readonly checkboxForm = new FormGroup<Record<string, FormControl<boolean>>>(
    Object.fromEntries(this.recipients.map((r) => [r.id, new FormControl(true, { nonNullable: true })]))
  );
  protected readonly selectAllForm = new FormGroup({ all: new FormControl(true, { nonNullable: true }) });

  // === Writable Signals ===
  protected readonly sending = signal(false);
  protected readonly selectedIds = signal<Set<string>>(new Set(this.recipients.map((r) => r.id)));

  // === Computed Signals ===
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly allSelected = computed(() => this.recipients.length > 0 && this.selectedCount() === this.recipients.length);

  public constructor() {
    lockDynamicDialogWhile(this.sending);
  }

  // === Protected Methods ===
  protected recipientName(item: SurveyResponseItem): string {
    return `${item.first_name ?? ''} ${item.last_name ?? ''}`.trim() || item.email || '—';
  }

  protected toggleRecipient(id: string): void {
    // While sending, re-assert the selection so a checkbox the user just clicked snaps back.
    if (this.sending()) {
      this.setSelection(this.selectedIds());
      return;
    }
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.setSelection(next);
  }

  protected toggleSelectAll(): void {
    if (this.sending()) {
      this.setSelection(this.selectedIds());
      return;
    }
    this.setSelection(this.allSelected() ? new Set() : new Set(this.recipients.map((r) => r.id)));
  }

  protected send(): void {
    const recipientIds = [...this.selectedIds()];
    if (recipientIds.length === 0 || this.sending()) return;

    this.sending.set(true);
    this.surveyService
      .sendSurveyReminders(this.surveyUid, recipientIds)
      .pipe(
        // An initiated write must finish even if navigation destroys this dialog.
        take(1),
        finalize(() => this.sending.set(false))
      )
      .subscribe({
        next: ({ recipient_count: count }) => {
          this.messageService.add({
            severity: 'success',
            summary: 'Reminder sent',
            detail: `Reminder sent to ${count} ${count === 1 ? 'recipient' : 'recipients'}.`,
          });
          if (!this.destroyRef.destroyed) this.ref.close(true);
        },
        error: (error: unknown) => {
          const unconfirmed = this.isUnconfirmedSend(error);
          this.messageService.add({
            severity: 'error',
            summary: unconfirmed ? 'Outcome unconfirmed' : "Couldn't send reminder",
            detail: this.sendErrorMessage(error, unconfirmed),
          });
        },
      });
  }

  protected cancel(): void {
    // Closing mid-send would drop the outcome toast while the emails still go out.
    if (this.sending()) return;
    this.ref.close(false);
  }

  // === Private Helpers ===
  /** The selection set is the source of truth; checkbox controls only mirror it. */
  private setSelection(selection: Set<string>): void {
    this.selectedIds.set(selection);
    for (const [id, control] of Object.entries(this.checkboxForm.controls)) {
      control.setValue(selection.has(id), { emitEvent: false });
    }
    this.selectAllForm.controls.all.setValue(this.allSelected(), { emitEvent: false });
  }

  private isUnconfirmedSend(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) || isBffTransportFailure(error)) return true;
    return ![400, 403, 404, 429].includes(error.status);
  }

  private sendErrorMessage(error: unknown, unconfirmed: boolean): string {
    if (unconfirmed) {
      return "We couldn't confirm whether reminders were sent. Retrying may send duplicate emails.";
    }
    switch ((error as HttpErrorResponse).status) {
      case 403:
        return "You don't have permission to send reminders for this survey.";
      case 429:
        return 'Too many reminders were sent just now. Please try again in a minute.';
      default:
        return 'This survey is no longer open, or some recipients are no longer on it. Refresh and try again.';
    }
  }
}
