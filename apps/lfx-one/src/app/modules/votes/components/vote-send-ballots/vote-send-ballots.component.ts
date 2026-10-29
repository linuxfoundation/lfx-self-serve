// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { VOTE_SEND_BALLOTS_COOLDOWN_MS } from '@lfx-one/shared/constants';
import { VoteService } from '@services/vote.service';
import { isBffTransportFailure } from '@shared/utils/upstream-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { finalize } from 'rxjs';

/**
 * "Send ballots now" (#4363): emails each member who hasn't voted a personal, login-free ballot link. Writer-only and
 * only while the vote is active; the parent decides visibility, the BFF re-checks `vote#writer` and re-resolves the
 * recipients. After a send the button stays disabled for VOTE_SEND_BALLOTS_COOLDOWN_MS so a second click can't re-mail
 * every non-responder.
 */
@Component({
  selector: 'lfx-vote-send-ballots',
  imports: [ButtonComponent, ConfirmDialogModule, DatePipe],
  providers: [ConfirmationService],
  templateUrl: './vote-send-ballots.component.html',
})
export class VoteSendBallotsComponent {
  private readonly voteService = inject(VoteService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly doc = inject(DOCUMENT);

  public readonly voteUid = input.required<string>();
  /** True while the confirmation is up, so a parent that handles Esc can leave it to the dialog. */
  public readonly confirmOpenChange = output<boolean>();

  protected readonly checking = signal<boolean>(false);
  protected readonly sending = signal<boolean>(false);
  protected readonly cooling = signal<boolean>(false);
  protected readonly sent = signal<{ count: number; at: Date } | null>(null);
  protected readonly busy = computed(() => this.checking() || this.sending());

  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private returnFocusTo: HTMLElement | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.clearCooldownTimer());
  }

  /** Counts the members who haven't voted, then asks for confirmation naming that count before anything is sent. */
  protected onClick(): void {
    if (this.busy() || this.cooling()) return;

    // The uid is captured now: if the parent switches to another vote while a request or the dialog is pending, the
    // answer is dropped so a send can never go to a different vote than the one clicked.
    const uid = this.voteUid();
    this.checking.set(true);
    this.voteService
      .getReminderRecipients(uid)
      .pipe(finalize(() => this.checking.set(false)))
      .subscribe({
        next: (recipients) => {
          if (uid !== this.voteUid()) return;
          const count = recipients.length;
          if (count === 0) {
            this.messageService.add({ severity: 'info', summary: 'Nobody to email', detail: 'Everyone eligible has already voted.' });
            return;
          }
          this.confirm(uid, count);
        },
        error: () => this.loadFailed(),
      });
  }

  /** Runs after Send, Cancel, Esc or the close button: hands focus back to the button that opened the dialog. */
  protected onConfirmHidden(): void {
    this.confirmOpenChange.emit(false);
    // A tick later, so the dialog has released focus and the button is enabled again where it will be.
    setTimeout(() => {
      this.returnFocusTo?.focus();
      this.returnFocusTo = null;
    });
  }

  private confirm(uid: string, count: number): void {
    const active = this.doc.activeElement;
    this.returnFocusTo = active instanceof HTMLElement ? active : null;
    this.confirmOpenChange.emit(true);
    this.confirmationService.confirm({
      message: `Email a personal ballot link to the ${count} ${count === 1 ? "member who hasn't" : "members who haven't"} voted?`,
      header: 'Send ballots now',
      acceptLabel: 'Send',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-info p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        if (uid === this.voteUid()) this.send(uid);
      },
    });
  }

  private send(uid: string): void {
    this.sending.set(true);
    this.voteService
      .sendBallots(uid)
      .pipe(finalize(() => this.sending.set(false)))
      .subscribe({
        next: ({ sent, skipped }) => {
          this.sent.set({ count: sent, at: new Date() });
          this.startCooldown();
          if (skipped > 0) {
            this.messageService.add({
              severity: 'warn',
              summary: 'Some ballots were not sent',
              detail: `${skipped} ${skipped === 1 ? 'member was' : 'members were'} skipped.`,
            });
          }
        },
        error: (error: unknown) => this.sendFailed(error),
      });
  }

  /** Reading the non-voter list sends nothing, so retrying is safe. */
  private loadFailed(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Unable to send ballots',
      detail: "We couldn't load the members who haven't voted. Nothing was sent. Please try again.",
      life: 5000,
    });
  }

  /** A timeout or 5xx can leave the emails already queued, so only a clear rejection invites an immediate retry. */
  private sendFailed(error: unknown): void {
    const rejected = error instanceof HttpErrorResponse && [400, 403, 409, 429].includes(error.status) && !isBffTransportFailure(error);
    this.messageService.add({
      severity: rejected ? 'error' : 'warn',
      summary: rejected ? 'Unable to send ballots' : 'Ballot delivery unconfirmed',
      detail: rejected
        ? 'The ballots were not sent. Please try again.'
        : "We couldn't confirm whether ballots were sent. Check with the members before retrying, since retrying may send duplicate emails.",
      life: 8000,
    });
  }

  private startCooldown(): void {
    this.cooling.set(true);
    this.clearCooldownTimer();
    if (!isPlatformBrowser(this.platformId)) return;
    this.cooldownTimer = setTimeout(() => this.cooling.set(false), VOTE_SEND_BALLOTS_COOLDOWN_MS);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
  }
}
