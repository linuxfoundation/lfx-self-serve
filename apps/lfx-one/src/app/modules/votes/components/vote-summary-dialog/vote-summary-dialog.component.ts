// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
import { VoteSummarySendService } from '@services/vote-summary-send.service';
import { VoteService } from '@services/vote.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { isBffTransportFailure } from '@shared/utils/upstream-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize } from 'rxjs';

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
  private readonly summarySendService = inject(VoteSummarySendService);
  private readonly viewerSubject = this.summarySendService.viewerSubject();
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

  protected readonly vote: Vote = this.config.data!.vote;

  protected readonly skeletonRows = [0, 1, 2];

  private readonly resultSummary = viewChild<ElementRef<HTMLElement>>('resultSummary');
  private readonly confirmText = viewChild<ElementRef<HTMLElement>>('confirmText');
  private readonly reviewSendButton = viewChild<ButtonComponent, ElementRef<HTMLElement>>('reviewSendButton', { read: ElementRef });
  private readonly reviewCancelButton = viewChild<ButtonComponent, ElementRef<HTMLElement>>('reviewCancelButton', { read: ElementRef });
  private readonly retryButton = viewChild<ButtonComponent, ElementRef<HTMLElement>>('retryButton', { read: ElementRef });
  private readonly hideButton = viewChild<ButtonComponent, ElementRef<HTMLElement>>('hideButton', { read: ElementRef });

  protected readonly phase = signal<VoteSummaryDialogPhase>('review');
  protected readonly preview = signal<VoteSummaryPreviewResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly result = signal<SendVoteSummaryResponse | null>(null);
  protected readonly previewBased = signal(false);

  protected readonly sending = computed(() => this.phase() === 'sending');
  protected readonly voterCount = computed(() => {
    const preview = this.preview();
    return preview ? preview.ready.length + preview.missing_email.length : 0;
  });
  protected readonly canSend = computed(() => !this.loading() && !this.loadError() && (this.preview()?.ready.length ?? 0) > 0);
  protected readonly resultNotice: Signal<VoteSummarySendNotice | null> = this.initResultNotice();
  protected readonly resultGroups: Signal<VoteSummaryResultGroup[]> = this.initResultGroups();
  private readonly attempt = computed(() => this.summarySendService.getAttempt(this.vote.uid));

  public constructor() {
    lockDynamicDialogWhile(this.sending);
    // Host Close (including the header X) is explicit dismissal; route destruction is not.
    this.ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      // Hiding must retain results even if the response settled before the sending view updated.
      if (!this.sending() && this.viewerSubject === this.summarySendService.viewerSubject()) this.summarySendService.dismiss(this.vote.uid);
    });
    if (!this.attempt()) this.loadPreview();
    toObservable(this.summarySendService.viewerSubject)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((subject) => {
        if (this.viewerSubject === subject) return;
        this.preview.set(null);
        this.result.set(null);
        this.ref.close(false);
      });
    toObservable(this.attempt)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((attempt) => {
        if (!attempt || this.viewerSubject !== this.summarySendService.viewerSubject()) return;
        this.preview.set(attempt.preview);
        this.loading.set(false);
        if (attempt.status === 'sending') {
          this.phase.set('sending');
          this.focusAfterRender(() => {
            if (this.summarySendService.getAttempt(this.vote.uid)?.status !== 'sending') return undefined;
            return this.hideButton()?.nativeElement.querySelector<HTMLButtonElement>('button') ?? undefined;
          });
        } else if (attempt.status === 'success') this.showResults(attempt.response);
        else this.onSendFailed(attempt.error);
      });
  }

  protected retry(): void {
    this.focusAfterRender(() => this.reviewCancelButton()?.nativeElement.querySelector<HTMLButtonElement>('button') ?? undefined);
    this.loadPreview(true);
  }

  protected onSend(): void {
    if (!this.canSend()) return;
    this.phase.set('confirm');
    this.focusAfterRender(() => this.confirmText()?.nativeElement);
  }

  protected onBack(): void {
    if (this.sending()) return;
    this.phase.set('review');
    this.focusAfterRender(() => this.reviewSendButton()?.nativeElement.querySelector<HTMLButtonElement>('button') ?? undefined);
  }

  protected cancel(): void {
    // Cancel is a pre-send action, not cancellation of an initiated email request.
    if (this.sending()) return;
    this.ref.close(false);
  }

  protected hideWhileSending(): void {
    if (!this.sending()) return;
    // The host close event cannot dismiss a pending service-owned attempt.
    this.ref.close(false);
  }

  protected onConfirmSend(): void {
    const preview = this.preview();
    if (this.phase() !== 'confirm' || !preview) return;
    this.phase.set('sending');
    if (!this.summarySendService.send(this.vote.uid, preview) && !this.summarySendService.getAttempt(this.vote.uid)) {
      this.rejectSend('Nothing was sent. Sign in again before sending a summary.');
    }
  }

  protected close(): void {
    this.summarySendService.dismiss(this.vote.uid);
    this.ref.close(true);
  }

  private initResultNotice(): Signal<VoteSummarySendNotice | null> {
    return computed(() => {
      const result = this.result();
      if (!result) return null;
      if (this.previewBased()) {
        const preview = this.preview();
        return {
          severity: 'warn',
          summary: 'Summary delivery unconfirmed',
          detail:
            `Earlier review: ${preview?.ready.length ?? 0} unconfirmed voter(s) with email addresses; ` +
            `${preview?.missing_email.length ?? 0} voter(s) had no email address. These are review counts, not confirmed send outcomes. ` +
            'Actual send-time recipients may differ or include voters not listed here. Emails may already have been delivered; retrying may send duplicate summaries.',
        };
      }

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
        display:
          this.previewBased() && outcome === 'skipped'
            ? {
                ...VOTE_SUMMARY_OUTCOME_DISPLAY.skipped,
                label: 'No email at review',
                description: 'These voters had no email address in the earlier review. Their send-time address and outcome are unknown.',
              }
            : VOTE_SUMMARY_OUTCOME_DISPLAY[outcome],
        recipients: recipients.filter((recipient) => recipient.outcome === outcome),
      })).filter((group) => group.recipients.length > 0);
    });
  }

  private loadPreview(restoreFocus = false): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.voteService
      .getVoteSummaryPreview(this.vote.uid)
      .pipe(
        finalize(() => {
          this.loading.set(false);
          if (restoreFocus) this.focusReviewAction();
        }),
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

  private showResults(result: SendVoteSummaryResponse | undefined, previewBased = false): void {
    if (this.destroyRef.destroyed) return;
    // Old pods can still return aggregate-only success responses during a rolling deployment.
    const hasRecipients = result && Array.isArray(result.recipients);
    this.previewBased.set(previewBased || !hasRecipients);
    this.result.set(hasRecipients ? result : this.buildUnconfirmedResult());
    this.phase.set('results');
    this.focusAfterRender(() => this.resultSummary()?.nativeElement);
  }

  private focusReviewAction(): void {
    this.focusAfterRender(() => {
      let target = this.reviewCancelButton();
      if (this.loadError()) target = this.retryButton();
      else if (this.canSend()) target = this.reviewSendButton();
      return target?.nativeElement.querySelector<HTMLButtonElement>('button') ?? undefined;
    });
  }

  private focusAfterRender(target: () => HTMLElement | undefined): void {
    if (this.destroyRef.destroyed || !isPlatformBrowser(this.platformId)) return;
    afterNextRender(() => target()?.focus(), { injector: this.injector });
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

    this.showResults(this.buildUnconfirmedResult(), true);
  }

  private rejectSend(detail: string): void {
    this.messageService.add({ severity: 'error', summary: "Couldn't send summary", detail });
    this.phase.set('review');
    this.summarySendService.dismiss(this.vote.uid);
    this.focusReviewAction();
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
