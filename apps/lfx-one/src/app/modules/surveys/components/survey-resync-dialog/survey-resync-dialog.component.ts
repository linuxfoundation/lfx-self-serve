// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { SurveyResyncDialogData, SurveyResyncRecipient } from '@lfx-one/shared/interfaces';
import { SurveyService } from '@services/survey.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { concat, finalize, forkJoin, map, toArray } from 'rxjs';

/**
 * Resyncs an open survey's recipient list (#4340): previews the committee members who joined
 * after launch, then sends them the survey. Only adds recipients; never removes any.
 */
@Component({
  selector: 'lfx-survey-resync-dialog',
  imports: [ButtonComponent, EmptyStateComponent, SkeletonModule],
  templateUrl: './survey-resync-dialog.component.html',
})
export class SurveyResyncDialogComponent {
  // === Services ===
  private readonly config = inject<DynamicDialogConfig<SurveyResyncDialogData>>(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly surveyService = inject(SurveyService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // === Constants ===
  private readonly surveyUid: string = this.config.data!.survey.uid;
  private readonly committeeUids: string[] = this.config.data!.committeeUids;
  protected readonly skeletonRows = [0, 1, 2];

  // === Writable Signals ===
  protected readonly recipients = signal<SurveyResyncRecipient[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly sending = signal(false);
  /** Committees whose preview found someone missing; only these are resynced. */
  private readonly committeesToSend = signal<string[]>([]);

  public constructor() {
    lockDynamicDialogWhile(this.sending);
    this.loadPreview();
  }

  // === Protected Methods ===
  protected recipientName(recipient: SurveyResyncRecipient): string {
    return recipient.name || `${recipient.first_name ?? ''} ${recipient.last_name ?? ''}`.trim() || recipient.email;
  }

  protected retry(): void {
    this.loadPreview();
  }

  protected send(): void {
    if (this.recipients().length === 0 || this.sending()) return;

    this.sending.set(true);
    // One committee at a time: the server authorizes each committee on its own.
    concat(...this.committeesToSend().map((committeeUid) => this.surveyService.resyncRecipients(this.surveyUid, committeeUid)))
      .pipe(
        // An initiated write must finish even if navigation destroys this dialog.
        toArray(),
        finalize(() => this.sending.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Recipients resynced',
            // Upstream recomputes who is missing at send time and returns no count, so don't claim one.
            detail: 'Survey sent to the committee members who were missing it.',
          });
          if (!this.destroyRef.destroyed) this.ref.close(true);
        },
        error: (error: unknown) => {
          this.messageService.add({ severity: 'error', summary: "Couldn't resync recipients", detail: this.errorMessage(error, 'send') });
        },
      });
  }

  protected cancel(): void {
    if (this.sending()) return;
    this.ref.close(false);
  }

  // === Private Helpers ===
  private loadPreview(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin(
      this.committeeUids.map((committeeUid) =>
        this.surveyService.getResyncPreview(this.surveyUid, committeeUid).pipe(map((preview) => ({ committeeUid, recipients: preview.affected_recipients })))
      )
    )
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (previews) => {
          // A person on two of this project's committees is listed once.
          const byUser = new Map(previews.flatMap((p) => p.recipients).map((r) => [r.user_id, r]));
          this.recipients.set([...byUser.values()]);
          this.committeesToSend.set(previews.filter((p) => p.recipients.length > 0).map((p) => p.committeeUid));
        },
        error: (error: unknown) => {
          this.recipients.set([]);
          this.committeesToSend.set([]);
          this.loadError.set(this.errorMessage(error, 'load'));
        },
      });
  }

  private errorMessage(error: unknown, stage: 'load' | 'send'): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 403) return "You don't have permission to resync this survey's recipients.";
    if (status === 429) return 'Too many requests just now. Please try again in a minute.';
    return stage === 'load'
      ? "We couldn't check the committee for new members. Please try again."
      : "We couldn't confirm the resync. Check the Responses tab before trying again.";
  }
}
