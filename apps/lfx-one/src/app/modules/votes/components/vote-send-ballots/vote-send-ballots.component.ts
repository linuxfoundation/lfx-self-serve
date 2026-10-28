// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { VOTE_SEND_BALLOTS_COOLDOWN_MS } from '@lfx-one/shared/constants';
import { VoteService } from '@services/vote.service';
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

  public readonly voteUid = input.required<string>();

  protected readonly checking = signal<boolean>(false);
  protected readonly sending = signal<boolean>(false);
  protected readonly cooling = signal<boolean>(false);
  protected readonly sent = signal<{ count: number; at: Date } | null>(null);
  protected readonly busy = computed(() => this.checking() || this.sending());

  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.clearCooldownTimer());
  }

  /** Counts the members who haven't voted, then asks for confirmation naming that count before anything is sent. */
  protected onClick(): void {
    if (this.busy() || this.cooling()) return;

    this.checking.set(true);
    this.voteService
      .getReminderRecipients(this.voteUid())
      .pipe(finalize(() => this.checking.set(false)))
      .subscribe({
        next: (recipients) => {
          const count = recipients.length;
          if (count === 0) {
            this.messageService.add({ severity: 'info', summary: 'Nobody to email', detail: 'Everyone eligible has already voted.' });
            return;
          }
          this.confirm(count);
        },
        error: () => this.failed(),
      });
  }

  private confirm(count: number): void {
    this.confirmationService.confirm({
      message: `Email a personal ballot link to the ${count} ${count === 1 ? 'member' : 'members'} who haven't voted?`,
      header: 'Send ballots now',
      acceptLabel: 'Send',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-info p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.send(),
    });
  }

  private send(): void {
    this.sending.set(true);
    this.voteService
      .sendBallots(this.voteUid())
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
        error: () => this.failed(),
      });
  }

  private failed(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Unable to send ballots',
      detail: 'Something went wrong sending ballot links. Please try again.',
      life: 5000,
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
