// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { VOTE_SUMMARY_SEND_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { VoteSummaryPreviewResponse, VoteSummarySendAttempt } from '@lfx-one/shared/interfaces';
import { take, timeout } from 'rxjs';

import { UserService } from './user.service';
import { VoteService } from './vote.service';

/** Keeps initiated sends alive and inspectable after route/dialog destruction, never on disk (#4830). */
@Injectable({ providedIn: 'root' })
export class VoteSummarySendService {
  private readonly voteService = inject(VoteService);
  private readonly userService = inject(UserService);
  private readonly attempts = signal(new Map<string, VoteSummarySendAttempt>());
  private owner: string | null = null;

  public readonly viewerSubject = computed(() => this.userService.user()?.sub ?? null);

  public constructor() {
    toObservable(this.viewerSubject)
      .pipe(takeUntilDestroyed())
      .subscribe((owner) => this.synchronizeOwner(owner));
  }

  /** A different observed subject cannot read the previous subject's identities, even before the cleanup subscription runs. */
  public getAttempt(voteUid: string): VoteSummarySendAttempt | undefined {
    const attempts = this.attempts();
    if (!this.viewerSubject() || this.owner !== this.viewerSubject()) return undefined;
    return attempts.get(voteUid);
  }

  /** Starts at most one undisposed attempt per vote; the service, not a dialog, owns the subscription. */
  public send(voteUid: string, preview: VoteSummaryPreviewResponse): boolean {
    const owner = this.viewerSubject();
    if (!owner) return false;
    this.synchronizeOwner(owner);
    if (this.getAttempt(voteUid)) return false;

    const pending: VoteSummarySendAttempt = { preview, status: 'sending' };
    this.attempts.update((attempts) => new Map(attempts).set(voteUid, pending));
    this.voteService
      .sendVoteSummary(voteUid)
      // Stop waiting, never retry: the server may continue sending after the client deadline.
      .pipe(timeout({ first: VOTE_SUMMARY_SEND_TIMEOUT_MS }), take(1))
      .subscribe({
        next: (response) => this.settle(voteUid, owner, pending, { preview, status: 'success', response }),
        error: (error: unknown) => this.settle(voteUid, owner, pending, { preview, status: 'error', error }),
      });
    return true;
  }

  /** Only a settled attempt can be dismissed. An in-flight operation must not become a second Send action. */
  public dismiss(voteUid: string): void {
    const attempt = this.getAttempt(voteUid);
    if (!attempt || attempt.status === 'sending') return;
    this.attempts.update((attempts) => {
      const next = new Map(attempts);
      next.delete(voteUid);
      return next;
    });
  }

  private synchronizeOwner(owner: string | null): void {
    if (this.owner === owner) return;
    this.owner = owner;
    this.attempts.set(new Map());
  }

  private settle(voteUid: string, owner: string, pending: VoteSummarySendAttempt, result: VoteSummarySendAttempt): void {
    // A late response after logout/impersonation must neither retain PII nor overwrite another user's attempt.
    if (this.viewerSubject() !== owner || this.owner !== owner || this.attempts().get(voteUid) !== pending) return;
    this.attempts.update((attempts) => new Map(attempts).set(voteUid, result));
  }
}
