// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MentorshipMentorInviteDecision, MentorshipMentorInviteState } from '@lfx-one/shared/interfaces';
import { isMentorshipMentorInviteToken } from '@lfx-one/shared/utils';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { distinctUntilChanged, map, tap } from 'rxjs';

/**
 * Landing page for the link in the mentor invite email: `/mentorship/mentor/invites?token=<token>`.
 *
 * Opening the link never answers the invitation. Mail scanners fetch links before the recipient
 * does, so the page asks first and only POSTs on Accept or Decline. Upstream checks the token is
 * the signed-in user's, so another account sees the forbidden state.
 */
@Component({
  selector: 'lfx-mentorship-mentor-invite',
  imports: [ButtonComponent, CardComponent, EmptyStateComponent],
  templateUrl: './mentor-invite.component.html',
})
export class MentorInviteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorService = inject(MentorshipMentorService);

  protected readonly programsRoute = ['/mentorship/mentor/programs'];

  /** Outcome of Accept or Decline. Cleared when the link changes, so the new invitation is asked about. */
  private readonly submission = signal<MentorshipMentorInviteState | null>(null);
  private readonly decision = signal<MentorshipMentorInviteDecision | null>(null);

  private readonly token: Signal<string> = this.initToken();
  protected readonly state = computed<MentorshipMentorInviteState>(
    () => this.submission() ?? (isMentorshipMentorInviteToken(this.token()) ? 'confirm' : 'invalid-link')
  );
  protected readonly submitting = computed(() => this.state() === 'submitting');
  protected readonly accepting = computed(() => this.submitting() && this.decision() === 'accept');
  protected readonly declining = computed(() => this.submitting() && this.decision() === 'decline');

  protected onRespond(decision: MentorshipMentorInviteDecision): void {
    if (this.state() !== 'confirm') return;

    const token = this.token();
    this.decision.set(decision);
    this.submission.set('submitting');
    // Not tied to the page's lifetime: leaving mid-request must not cancel an answer the user gave.
    this.mentorService.respondToMentorInvite(token, decision).subscribe({
      next: () => this.settle(token, decision === 'accept' ? 'accepted' : 'declined'),
      error: (error: unknown) => this.settle(token, this.stateForError(error)),
    });
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
      case 403:
        return 'forbidden';
      default:
        return 'error';
    }
  }
}
