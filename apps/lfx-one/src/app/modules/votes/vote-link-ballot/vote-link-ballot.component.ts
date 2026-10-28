// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
import { PollStatus } from '@lfx-one/shared/enums';
import { VOTE_LINK_NOT_AWAITING_RESPONSE, VOTE_LINK_NOT_RESPONDED, VOTE_LINK_TOKEN_FRAGMENT_PARAM } from '@lfx-one/shared/constants';
import { VoteBallotSubmission, VoteLinkBallot, VoteLinkResponseRequest, VoteLinkState } from '@lfx-one/shared/interfaces';
import { normalizePollStatus } from '@lfx-one/shared/utils';
import { VoteService } from '@services/vote.service';
import { fromEvent, Subject, takeUntil } from 'rxjs';
import { VoteBallotFormComponent } from '../components/vote-ballot-form/vote-ballot-form.component';

/**
 * Login-free ballot page (#4363). The vote link token lives only in this component's `token` signal: it is read once
 * from the URL fragment in the browser, dropped from the address bar with `history.replaceState`, and sent only in
 * request bodies. It is never written to storage, a service, analytics, error reporting or logs. The page shows the
 * vote title, description and questions only: no navbar, no user menu, nothing about the recipient.
 */
@Component({
  selector: 'lfx-vote-link-ballot',
  imports: [ButtonComponent, VoteBallotFormComponent],
  templateUrl: './vote-link-ballot.component.html',
})
export class VoteLinkBallotComponent implements OnInit, OnDestroy {
  private readonly voteService = inject(VoteService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly meta = inject(Meta);

  /** In memory only; never persisted or logged. */
  private readonly token = signal<string | null>(null);
  /** Emits when a new token replaces the current one, cancelling the previous token's requests. */
  private readonly cancel$ = new Subject<void>();

  protected readonly state = signal<VoteLinkState>('loading');
  protected readonly ballot = signal<VoteLinkBallot | null>(null);
  protected readonly submitting = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** True after the voter has chosen to change an existing ballot (shows the form instead of the prompt). */
  protected readonly editing = signal<boolean>(false);
  /** Submit with PUT (the ballot exists) or POST (first submission). */
  protected readonly updateMode = signal<boolean>(false);
  protected readonly abstainedLast = signal<boolean>(false);

  protected readonly showUpdatePrompt = computed(() => this.state() === 'ready' && !!this.ballot()?.ballot.already_voted && !this.editing());

  public ngOnInit(): void {
    // The page is token-mode only; the referrer must never carry this URL anywhere.
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.startFromFragment();

    // Opening another personalized link on this same route is a same-document fragment change, which reuses this
    // component: pick the new token up, drop it from the address bar, and start over rather than keep the last one.
    fromEvent(window, 'hashchange')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.hasFragmentToken()) this.startFromFragment();
      });
  }

  public ngOnDestroy(): void {
    this.meta.removeTag('name="referrer"');
  }

  protected onStartUpdate(): void {
    this.editing.set(true);
  }

  protected onSubmit(submission: VoteBallotSubmission): void {
    const token = this.token();
    if (!token || this.submitting()) return;

    const body: VoteLinkResponseRequest = {
      vote_token: token,
      abstain: submission.abstain,
      ...(submission.userVoteContent ? { user_vote_content: submission.userVoteContent } : {}),
      ...(submission.commentResponses ? { comment_responses: submission.commentResponses } : {}),
    };

    this.submitting.set(true);
    this.send(body, this.updateMode(), true);
  }

  /** Sends the ballot; a state mismatch (POST on an already-voted ballot, or PUT on an unvoted one) flips the verb once and retries. */
  private send(body: VoteLinkResponseRequest, update: boolean, mayRetry: boolean): void {
    this.voteService
      .submitLinkResponse(body, update)
      .pipe(takeUntil(this.cancel$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.abstainedLast.set(body.abstain);
          this.state.set(update ? 'updated' : 'submitted');
        },
        error: (err: unknown) => {
          const message = this.errorText(err);
          if (mayRetry && err instanceof HttpErrorResponse && err.status === 400) {
            if (!update && message.includes(VOTE_LINK_NOT_AWAITING_RESPONSE)) {
              this.updateMode.set(true);
              this.send(body, true, false);
              return;
            }
            if (update && message.includes(VOTE_LINK_NOT_RESPONDED)) {
              this.updateMode.set(false);
              this.send(body, false, false);
              return;
            }
          }
          this.submitting.set(false);
          this.handleError(err, message);
        },
      });
  }

  private loadBallot(token: string): void {
    this.voteService
      .getLinkBallot(token)
      .pipe(takeUntil(this.cancel$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ballot) => {
          this.ballot.set(ballot);
          this.updateMode.set(!!ballot.ballot?.already_voted);
          if (ballot.ballot?.voter_removed) {
            this.state.set('removed');
          } else if (normalizePollStatus(ballot.status) === PollStatus.ENDED) {
            this.state.set('ended');
          } else if (normalizePollStatus(ballot.status) !== PollStatus.ACTIVE) {
            this.state.set('not-open');
          } else {
            this.state.set('ready');
          }
        },
        error: (err: unknown) => this.handleError(err, this.errorText(err)),
      });
  }

  private handleError(err: unknown, message: string): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.state.set('error');
      return;
    }
    if (err.status === 404) {
      this.state.set('invalid');
    } else if (err.status === 400 && message.includes('ended')) {
      this.state.set('ended');
    } else if (err.status === 400 && message.includes('removed')) {
      this.state.set('removed');
    } else if (err.status === 400 && message) {
      // Surface the upstream reason; the form stays so the voter can correct it.
      this.errorMessage.set(message);
      this.state.set(this.state() === 'loading' ? 'error' : 'ready');
    } else {
      this.state.set(this.state() === 'loading' ? 'error' : 'ready');
      this.errorMessage.set('Something went wrong. Please try again.');
    }
  }

  private errorText(err: unknown): string {
    const body = err instanceof HttpErrorResponse ? (err.error as { error?: unknown } | null) : null;
    return typeof body?.error === 'string' ? body.error.toLowerCase() : '';
  }

  /** Consumes the fragment token and (re)starts the page for it, discarding any previous token, ballot and in-flight request. */
  private startFromFragment(): void {
    this.cancel$.next();
    this.ballot.set(null);
    this.editing.set(false);
    this.updateMode.set(false);
    this.submitting.set(false);
    this.errorMessage.set(null);
    this.abstainedLast.set(false);
    this.token.set(null);

    const token = this.consumeFragmentToken();
    if (!token) {
      this.state.set('invalid');
      return;
    }
    this.state.set('loading');
    this.token.set(token);
    this.loadBallot(token);
  }

  private hasFragmentToken(): boolean {
    return new URLSearchParams(window.location.hash.replace(/^#/, '')).has(VOTE_LINK_TOKEN_FRAGMENT_PARAM);
  }

  /**
   * Reads `vote_token` from the URL fragment, then removes the fragment from the address bar and history entry.
   * The router's own `url` still holds the original fragment for the life of the page; nothing may read it unsanitized.
   */
  private consumeFragmentToken(): string | null {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get(VOTE_LINK_TOKEN_FRAGMENT_PARAM);
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    return token || null;
  }
}
