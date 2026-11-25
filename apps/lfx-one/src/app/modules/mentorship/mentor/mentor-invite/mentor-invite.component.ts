// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE } from '@lfx-one/shared/constants';
import {
  MentorshipMentorInviteDecision,
  MentorshipMentorInviteRead,
  MentorshipMentorInviteState,
  MentorshipMentorProfileCheck,
} from '@lfx-one/shared/interfaces';
import { isMentorshipMentorInviteToken } from '@lfx-one/shared/utils';
import { MentorshipPublicUrlPipe } from '@pipes/mentorship-public-url.pipe';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { catchError, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';

/**
 * Landing page for the link in the mentor invite email: `/mentorship/mentor/invites?token=<token>`.
 *
 * Opening the link never answers the invitation. Mail scanners fetch links before the recipient
 * does, so the page asks first and only POSTs on Accept or Decline. Upstream checks the token is
 * the signed-in user's, or for an invitation sent by email that the signed-in LF account uses the
 * address, so another account sees the forbidden state. Accept and Decline stay disabled until the
 * browser's read confirms a mentor profile; someone without one is pointed to create it first, then
 * open the link again, and a failed check offers Try again rather than claiming there is no profile. The page names the invited program, and links to its public page, once
 * the browser has read it; until then, or when the read fails, the copy says "the program".
 */
@Component({
  selector: 'lfx-mentorship-mentor-invite',
  imports: [ButtonComponent, CardComponent, EmptyStateComponent, MentorshipPublicUrlPipe, RouterLink],
  templateUrl: './mentor-invite.component.html',
})
export class MentorInviteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly programsRoute = ['/mentorship/mentor/programs'];
  protected readonly profileRoute = ['/mentorship/mentor'];

  /** Outcome of Accept or Decline. Cleared when the link changes, so the new invitation is asked about. */
  private readonly submission = signal<MentorshipMentorInviteState | null>(null);
  private readonly decision = signal<MentorshipMentorInviteDecision | null>(null);

  /** Bumped by the profile check's Try again, so the check runs once more. */
  private readonly profileCheckRun = signal(0);

  private readonly token: Signal<string> = this.initToken();
  /**
   * The signed-in user's mentor profile check: `checking` until the browser's read answers, and on the server, whose read
   * goes out without the session cookie; then `found`, `missing`, or `failed` when the read itself fails.
   */
  protected readonly profileCheck: Signal<MentorshipMentorProfileCheck> = this.initProfileCheck();
  /** Accept and Decline need a confirmed mentor profile. */
  protected readonly canAnswer = computed(() => this.profileCheck() === 'found');
  /** The browser's read of the invitation; never made on the server. */
  private readonly inviteRead: Signal<MentorshipMentorInviteRead> = this.initInviteRead();
  protected readonly programName = computed(() => this.inviteRead().details?.programName ?? '');
  /** The program's id, for the View program link; the link shows only for a UUID. */
  protected readonly programId = computed(() => this.inviteRead().details?.programId ?? '');
  /**
   * An answer in flight or given comes first; then a read that says the link cannot be used, so it is shown before the
   * mentor profile check can disable the answer; then the choice.
   */
  protected readonly state = computed<MentorshipMentorInviteState>(
    () => this.submission() ?? this.inviteRead().failure ?? (isMentorshipMentorInviteToken(this.token()) ? 'confirm' : 'invalid-link')
  );
  protected readonly submitting = computed(() => this.state() === 'submitting');
  protected readonly accepting = computed(() => this.submitting() && this.decision() === 'accept');
  protected readonly declining = computed(() => this.submitting() && this.decision() === 'decline');

  protected onRespond(decision: MentorshipMentorInviteDecision): void {
    if (this.state() !== 'confirm' || !this.canAnswer()) return;

    const token = this.token();
    this.decision.set(decision);
    this.submission.set('submitting');
    // Not tied to the page's lifetime: leaving mid-request must not cancel an answer the user gave.
    this.mentorService.respondToMentorInvite(token, decision).subscribe({
      next: () => this.settle(token, decision === 'accept' ? 'accepted' : 'declined'),
      error: (error: unknown) => this.settle(token, this.stateForError(error)),
    });
  }

  /** After a failed profile check, check again rather than reloading the page. */
  protected onRetryProfileCheck(): void {
    this.profileCheckRun.update((run) => run + 1);
  }

  /** After a failed answer, go back to the choice rather than reloading the page. */
  protected onRetry(): void {
    this.submission.set(null);
  }

  private initToken(): Signal<string> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((query) => query.get('token')?.trim() ?? ''),
        distinctUntilChanged(),
        tap(() => this.submission.set(null))
      ),
      { initialValue: '' }
    );
  }

  private initProfileCheck(): Signal<MentorshipMentorProfileCheck> {
    if (!isPlatformBrowser(this.platformId)) return signal<MentorshipMentorProfileCheck>('checking').asReadonly();
    return toSignal(
      toObservable(this.profileCheckRun).pipe(
        switchMap(() =>
          this.mentorService.checkMentorProfile().pipe(
            map((response): MentorshipMentorProfileCheck => (response.hasProfile ? 'found' : 'missing')),
            catchError(() => of<MentorshipMentorProfileCheck>('failed')),
            startWith<MentorshipMentorProfileCheck>('checking')
          )
        )
      ),
      { initialValue: 'checking' }
    );
  }

  /**
   * Reads the program's id and name for each usable link. Upstream checks the read as it does an answer, so its 400 or
   * 409 (the link can no longer be used) and 403 (another account's invitation) are shown at once; any other failure
   * keeps the generic copy, and Accept or Decline reports it.
   */
  private initInviteRead(): Signal<MentorshipMentorInviteRead> {
    const none: MentorshipMentorInviteRead = { details: null, failure: null };
    if (!isPlatformBrowser(this.platformId)) return signal(none).asReadonly();
    return toSignal(
      toObservable(this.token).pipe(
        switchMap((token) =>
          isMentorshipMentorInviteToken(token)
            ? this.mentorService.getMentorInvite(token).pipe(
                map((details): MentorshipMentorInviteRead => ({ details, failure: null })),
                catchError((error: unknown) => of<MentorshipMentorInviteRead>({ details: null, failure: this.readFailureFor(error) })),
                startWith(none)
              )
            : of(none)
        )
      ),
      { initialValue: none }
    );
  }

  /** The state a failed read shows: only a refusal that an answer would meet too; anything else shows none. */
  private readFailureFor(error: unknown): MentorshipMentorInviteState | null {
    const state = this.stateForError(error);
    return state === 'invalid-link' || state === 'forbidden' ? state : null;
  }

  /** Shows an outcome only on the link it was made from. */
  private settle(token: string, state: MentorshipMentorInviteState): void {
    if (this.token() === token) {
      this.submission.set(state);
    }
  }

  private stateForError(error: unknown): MentorshipMentorInviteState {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    switch (status) {
      // Upstream answers an expired, malformed, or already-answered invitation with a 400, and a
      // concurrent answer with a 409; either way this link can no longer be used.
      case 400:
      case 409:
        return 'invalid-link';
      case 403: {
        // The BFF refuses writes while impersonating with its own 403; upstream's 403 means another account.
        const code = ((error as HttpErrorResponse).error as { code?: string } | null)?.code;
        return code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE ? 'read-only' : 'forbidden';
      }
      default:
        return 'error';
    }
  }
}
