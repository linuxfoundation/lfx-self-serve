// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, inject, Injector, input, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { VOTE_SEND_BALLOTS_COOLDOWN_MS } from '@lfx-one/shared/constants';
import { VoteService } from '@services/vote.service';
import { isBffTransportFailure } from '@shared/utils/upstream-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, EMPTY, finalize, Subject, Subscription, switchMap, takeUntil } from 'rxjs';

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
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  public readonly voteUid = input.required<string>();
  /** True while the parent has another dialog open: a late voter-list answer must not open this one on top of it. */
  public readonly blocked = input<boolean>(false);
  /** The vote's own counts (`num_response_received`, `total_voting_request_invitations`); an empty voter list disables the button only when they confirm completion. */
  public readonly responded = input<number | null | undefined>(null);
  public readonly invited = input<number | null | undefined>(null);

  protected readonly checking = signal<boolean>(false);
  protected readonly sending = signal<boolean>(false);
  protected readonly cooling = signal<boolean>(false);
  protected readonly sent = signal<{ count: number; at: Date } | null>(null);
  /** True from the dialog opening until a tick after it hides, so a parent that handles Esc leaves the keypress to the dialog. */
  public readonly confirming = signal<boolean>(false);
  /** Members who haven't voted, as last read from the voter list; null until the list is known (or when reading it failed). */
  protected readonly remaining = signal<number | null>(null);
  protected readonly everyoneVoted = computed(() => this.remaining() === 0);
  /** The index can lag a freshly opened vote, so an empty list alone proves nothing: the counts must agree. */
  private readonly countsConfirmComplete = computed(() => {
    const invited = this.invited() ?? 0;
    return invited > 0 && (this.responded() ?? 0) >= invited;
  });
  protected readonly busy = computed(() => this.checking() || this.sending());

  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private returnFocusTo: HTMLElement | null = null;
  private pendingRecipients: Subscription | null = null;
  /** Fires when a click starts, dropping a prefetch that is still loading: the click reads the list itself. */
  private readonly prefetchCancel = new Subject<void>();
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmingTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    // Reads the voter list once per vote so the button can say "Everyone has voted" before it is clicked. Reading sends
    // nothing, and a failure or an unconfirmed empty list leaves the button usable: the click reads the list again.
    toObservable(this.voteUid)
      .pipe(
        switchMap((uid) => {
          this.remaining.set(null);
          if (!isPlatformBrowser(this.platformId)) return EMPTY;
          return this.voteService.getReminderRecipients(uid).pipe(
            takeUntil(this.prefetchCancel),
            catchError((error: unknown) => {
              console.error('Failed to read the voter list for the Send ballots state', error);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed()
      )
      // Only while still unknown: a click's own answer is newer than this one and must not be overwritten by it.
      .subscribe((recipients) => {
        if (this.remaining() !== null) return;
        if (recipients.length > 0 || this.countsConfirmComplete()) this.remaining.set(recipients.length);
      });

    this.destroyRef.onDestroy(() => {
      this.clearCooldownTimer();
      if (this.focusTimer) clearTimeout(this.focusTimer);
      if (this.confirmingTimer) clearTimeout(this.confirmingTimer);
    });
  }

  /**
   * Drops a voter-list request that is still loading (the parent opened its own dialog): no answer will open the Send
   * confirmation, and the button is usable again. A Send already past its confirmation is not touched.
   */
  public abandon(): void {
    if (!this.checking()) return;
    this.pendingRecipients?.unsubscribe();
    this.pendingRecipients = null;
    this.returnFocusTo = null;
  }

  /** Counts the members who haven't voted, then asks for confirmation naming that count before anything is sent. */
  protected onClick(): void {
    if (this.busy() || this.cooling() || this.blocked()) return;

    // The uid is captured now: if the parent switches to another vote while a request or the dialog is pending, the
    // answer is dropped so a send can never go to a different vote than the one clicked.
    const uid = this.voteUid();
    this.prefetchCancel.next();
    // Read before the button disables itself for the request: a disabled button gives up focus, so the dialog's opener
    // would no longer be the active element by the time the answer arrives.
    const active = this.doc.activeElement;
    this.returnFocusTo = active instanceof HTMLElement ? active : null;
    this.checking.set(true);
    this.pendingRecipients = this.voteService
      .getReminderRecipients(uid)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.checking.set(false))
      )
      .subscribe({
        next: (recipients) => {
          if (uid !== this.voteUid() || this.blocked()) return;
          const count = recipients.length;
          // An empty answer disables the button only when the counts agree; otherwise the next click reads again.
          if (count > 0 || this.countsConfirmComplete()) this.remaining.set(count);
          // The list was not known to be empty when the button was clicked, so this is the race (or an unknown list).
          if (count === 0) {
            this.messageService.add({ severity: 'info', summary: 'Nobody to email', detail: 'Everyone eligible has already voted.' });
            return;
          }
          this.confirm(uid, count);
        },
        error: () => {
          if (uid === this.voteUid()) this.loadFailed();
        },
      });
  }

  /** Runs after Send, Cancel, Esc or the close button: hands focus back to the button that opened the dialog. */
  protected onConfirmHidden(): void {
    if (this.confirmingTimer) clearTimeout(this.confirmingTimer);
    this.confirmingTimer = setTimeout(() => this.confirming.set(false));
    // A tick later, so the dialog has released focus. After a Send the button is disabled for the request and the
    // cooldown, so the browser keeps focus where it falls; Cancel, Esc and the close button land on the button.
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.returnFocusTo?.focus();
      this.returnFocusTo = null;
    });
  }

  private confirm(uid: string, count: number): void {
    if (this.confirmingTimer) clearTimeout(this.confirmingTimer);
    this.confirming.set(true);
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

  /** Reading the non-voter list sends nothing, so retrying is safe. No dialog opens; the button is usable and focused again. */
  private loadFailed(): void {
    this.messageService.add({ severity: 'error', summary: 'Voter list unavailable', detail: "Couldn't load the voter list. Try again.", life: 5000 });
    // The button was disabled for the request and gave up focus; once it renders enabled again, hand focus back.
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    afterNextRender(() => target?.focus(), { injector: this.injector });
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
