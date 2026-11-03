// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  VOTE_SUMMARY_NOT_ENDED,
  VOTE_SUMMARY_OUTCOME_DISPLAY,
  VOTE_SUMMARY_OUTCOME_ORDER,
  VOTE_SUMMARY_PRECHECK_FAILED,
  VOTE_SUMMARY_SEND_FAILED,
} from '@lfx-one/shared/constants';
import {
  SendVoteSummaryResponse,
  Vote,
  VoteSummaryDialogPhase,
  VoteSummaryPreviewResponse,
  VoteSummaryResultGroup,
  VoteSummarySendNotice,
} from '@lfx-one/shared/interfaces';
import { buildVoteSummarySendNotice } from '@lfx-one/shared/utils';
import { VoteService } from '@services/vote.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { isBffTransportFailure } from '@shared/utils/upstream-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize, take } from 'rxjs';

/**
 * Lets a vote manager review who an ended vote's results summary will reach, send it, and see each
 * voter's outcome (#4830). The list is read-only; the results view stays open until dismissed and
 * offers no resend, since an unconfirmed send may already have been delivered.
 */
@Component({
  selector: 'lfx-vote-summary-dialog',
  imports: [ButtonComponent, EmptyStateComponent, SkeletonModule, TagComponent],
  templateUrl: './vote-summary-dialog.component.html',
})
export class VoteSummaryDialogComponent {
  private readonly config = inject<DynamicDialogConfig<{ vote: Vote }>>(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly voteService = inject(VoteService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

  protected readonly vote: Vote = this.config.data!.vote;

  protected readonly skeletonRows = [0, 1, 2];

  private readonly resultSummary = viewChild<ElementRef<HTMLElement>>('resultSummary');

  protected readonly phase = signal<VoteSummaryDialogPhase>('review');
  protected readonly preview = signal<VoteSummaryPreviewResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly result = signal<SendVoteSummaryResponse | null>(null);

  protected readonly sending = computed(() => this.phase() === 'sending');
  protected readonly voterCount = computed(() => {
    const preview = this.preview();
    return preview ? preview.ready.length + preview.missing_email.length : 0;
  });
  protected readonly canSend = computed(() => !this.loading() && !this.loadError() && (this.preview()?.ready.length ?? 0) > 0);
  protected readonly resultNotice: Signal<VoteSummarySendNotice | null> = this.initResultNotice();
  protected readonly resultGroups: Signal<VoteSummaryResultGroup[]> = this.initResultGroups();

  public constructor() {
    lockDynamicDialogWhile(this.sending);
    this.loadPreview();
  }

  protected retry(): void {
    this.loadPreview();
  }

  protected onSend(): void {
    if (!this.canSend()) return;
    this.phase.set('confirm');
  }

  protected onBack(): void {
    if (this.sending()) return;
    this.phase.set('review');
  }

  protected cancel(): void {
    // Closing mid-send would drop the outcome while the emails still go out.
    if (this.sending()) return;
    this.ref.close(false);
  }

  protected onConfirmSend(): void {
    if (this.phase() !== 'confirm') return;

    this.phase.set('sending');
    this.voteService
      .sendVoteSummary(this.vote.uid)
      // An initiated write must finish even if navigation destroys this dialog.
      .pipe(take(1))
      .subscribe({
        next: (result) => this.showResults(result),
        error: (error: unknown) => this.onSendFailed(error),
      });
  }

  protected close(): void {
    this.ref.close(true);
  }

  private initResultNotice(): Signal<VoteSummarySendNotice | null> {
    return computed(() => {
      const result = this.result();
      if (!result) return null;

      // API send counters count unique email addresses; the dialog describes each voter shown below.
      return buildVoteSummarySendNotice({
        ...result,
        recipient_count: result.recipients.filter((recipient) => recipient.outcome === 'sent').length,
        failed_count: result.recipients.filter((recipient) => recipient.outcome === 'failed').length,
        skipped_count: result.recipients.filter((recipient) => recipient.outcome === 'skipped').length,
        uncertain_count: result.recipients.filter((recipient) => recipient.outcome === 'uncertain').length,
      });
    });
  }

  private initResultGroups(): Signal<VoteSummaryResultGroup[]> {
    return computed(() => {
      const recipients = this.result()?.recipients ?? [];
      return VOTE_SUMMARY_OUTCOME_ORDER.map((outcome) => ({
        outcome,
        display: VOTE_SUMMARY_OUTCOME_DISPLAY[outcome],
        recipients: recipients.filter((recipient) => recipient.outcome === outcome),
      })).filter((group) => group.recipients.length > 0);
    });
  }

  private loadPreview(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.voteService
      .getVoteSummaryPreview(this.vote.uid)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (preview) => this.preview.set(preview),
        error: (error: unknown) => {
          this.preview.set(null);
          this.loadError.set(this.loadErrorMessage(error));
        },
      });
  }

  private showResults(result: SendVoteSummaryResponse): void {
    // The write may finish after navigation has destroyed the dialog.
    if (this.destroyRef.destroyed) return;
    this.result.set(result);
    this.phase.set('results');
    if (!isPlatformBrowser(this.platformId)) return;
    afterNextRender(() => this.resultSummary()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * Reports a failed summary send (#4689, #4830). Only a clear rejection or a pre-send failure is a
   * toast that returns to the review; a confirmed total failure shows its per-voter results, and a
   * transport failure, timeout, gateway error or unknown 5xx can leave summaries already delivered,
   * so it shows every emailable voter as unconfirmed instead of saying nothing was sent.
   */
  private onSendFailed(error: unknown): void {
    const code = error instanceof HttpErrorResponse ? (error.error?.code as string | undefined) : undefined;

    if (error instanceof HttpErrorResponse && error.status === 409 && code === VOTE_SUMMARY_NOT_ENDED) {
      this.rejectSend('This vote has not closed yet.');
      return;
    }

    if (error instanceof HttpErrorResponse && code === VOTE_SUMMARY_PRECHECK_FAILED) {
      let detail = 'Nothing was sent. Please try again.';
      if (error.status === 401) {
        detail = 'Nothing was sent. Sign in again before sending a summary.';
      } else if (error.status === 404) {
        detail = 'Nothing was sent. This vote is no longer available.';
      }
      this.rejectSend(detail);
      return;
    }

    if (error instanceof HttpErrorResponse && error.status === 502 && code === VOTE_SUMMARY_SEND_FAILED && !isBffTransportFailure(error)) {
      const details = error.error?.details as SendVoteSummaryResponse | undefined;
      // Only a complete, confirmed-unsent BFF result is shown as is. Legacy or invalid details stay unconfirmed below.
      if (
        details &&
        details.recipient_count === 0 &&
        details.uncertain_count === 0 &&
        details.failed_count > 0 &&
        [details.failed_count, details.skipped_count].every((count) => Number.isInteger(count) && count >= 0) &&
        Array.isArray(details.recipients)
      ) {
        this.showResults(details);
        return;
      }
    }

    const rejected = error instanceof HttpErrorResponse && !isBffTransportFailure(error) && [400, 401, 403, 429].includes(error.status);
    if (rejected) {
      this.rejectSend('No summaries were sent. Please try again.');
      return;
    }

    this.showResults(this.buildUnconfirmedResult());
  }

  private rejectSend(detail: string): void {
    this.messageService.add({ severity: 'error', summary: "Couldn't send summary", detail });
    this.phase.set('review');
  }

  /** With no per-voter outcome from the server, every emailable voter from the preview is unconfirmed. */
  private buildUnconfirmedResult(): SendVoteSummaryResponse {
    const preview = this.preview();
    const ready = preview?.ready ?? [];
    const missing = preview?.missing_email ?? [];
    return {
      recipient_count: 0,
      failed_count: 0,
      skipped_count: missing.length,
      uncertain_count: preview?.unique_email_count ?? 0,
      recipients: [
        ...ready.map((recipient) => ({ ...recipient, outcome: 'uncertain' as const })),
        ...missing.map((recipient) => ({ ...recipient, outcome: 'skipped' as const })),
      ],
    };
  }

  private loadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return "You don't have permission to send this vote's summary.";
    }
    if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.code === VOTE_SUMMARY_NOT_ENDED) {
      return 'This vote has not closed yet.';
    }
    return "Couldn't load recipients.";
  }
}
