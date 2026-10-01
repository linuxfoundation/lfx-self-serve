// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_PROGRAM_REVIEW_DECISION_DONE_LABELS,
  MENTORSHIP_PROGRAM_REVIEW_DECISION_LABELS,
  MENTORSHIP_PROGRAM_REVIEW_DECISIONS,
  MENTORSHIP_UPSTREAM_PROGRAM_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import {
  ButtonSeverity,
  MentorshipProgramReview,
  MentorshipProgramReviewConfirmation,
  MentorshipProgramReviewDecision,
  MentorshipProgramReviewLink,
  MentorshipProgramReviewState,
  MentorshipProgramReviewView,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import {
  catchError,
  combineLatest,
  concat,
  defer,
  distinctUntilChanged,
  EMPTY,
  ignoreElements,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

/**
 * Landing page for the approve/reject links in the program-review email:
 * `/mentorship/program-review/<program id>?decision=approve|reject`.
 *
 * Opening the link never records a decision. Mail scanners fetch links before the
 * recipient does, so the page loads the program, asks for confirmation, and only POSTs
 * on Confirm. Who may decide is enforced upstream (the mentorship approver team), so a
 * signed-in user who is not an approver sees the 403 state rather than a hidden page.
 */
@Component({
  selector: 'lfx-mentorship-program-review',
  imports: [ButtonComponent, CardComponent, EmptyStateComponent, RouteLoadingComponent],
  templateUrl: './program-review.component.html',
})
export class ProgramReviewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mentorshipService = inject(MentorshipService);

  protected readonly decisionLabels = MENTORSHIP_PROGRAM_REVIEW_DECISION_LABELS;
  protected readonly backRoute = ['/mentorship/admin'];

  /** Outcome of Confirm. Cleared when the link changes, so the loaded view shows again. */
  private readonly submission = signal<MentorshipProgramReviewView | null>(null);
  /**
   * The in-flight Confirm POST. A link change does not cancel it, because the write may already have
   * reached upstream: the new link loads once it settles, so that view shows the program's real status.
   */
  private submitRequest: Observable<MentorshipProgramReview> | null = null;

  protected readonly link: Signal<MentorshipProgramReviewLink> = this.initLink();
  private readonly loaded: Signal<MentorshipProgramReviewView> = this.initLoaded();
  protected readonly view = computed<MentorshipProgramReviewView>(() => this.submission() ?? this.loaded());
  protected readonly state = computed<MentorshipProgramReviewState>(() => this.view().state);
  protected readonly program = computed<MentorshipProgramReview | null>(() => this.view().program);
  protected readonly decision = computed<MentorshipProgramReviewDecision | null>(() => this.link().decision);
  protected readonly submitting = computed(() => this.state() === 'submitting');
  protected readonly confirming: Signal<MentorshipProgramReviewConfirmation | null> = this.initConfirming();
  protected readonly confirmSeverity = computed<ButtonSeverity>(() => (this.decision() === 'reject' ? 'danger' : 'primary'));
  protected readonly doneLabel = computed(() => {
    const decision = this.decision();
    return decision ? MENTORSHIP_PROGRAM_REVIEW_DECISION_DONE_LABELS[decision] : 'reviewed';
  });
  protected readonly alreadyDecidedMessage: Signal<string> = this.initAlreadyDecidedMessage();

  protected onConfirm(): void {
    const confirmation = this.confirming();
    if (!confirmation || this.submitting()) return;

    const { program, decision } = confirmation;
    const link = this.link();
    const request = this.mentorshipService
      .submitProgramDecision(program.id, decision)
      .pipe(takeUntilDestroyed(this.destroyRef), shareReplay({ bufferSize: 1, refCount: false }));
    this.submitRequest = request;
    this.submission.set({ state: 'submitting', program });
    request.subscribe({
      next: (updated) => this.settleSubmit(request, link, { state: 'success', program: updated }),
      error: (error: unknown) => this.settleSubmit(request, link, { state: this.stateForError(error), program }),
    });
  }

  /** After a failed Confirm, go back to the confirm card rather than reloading the page. */
  protected onRetry(): void {
    this.submission.set(null);
  }

  private initLink(): Signal<MentorshipProgramReviewLink> {
    return toSignal(
      combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
        map(([params, query]) => ({ programId: params.get('programId') ?? '', decision: this.toDecision(query.get('decision')) })),
        distinctUntilChanged((a, b) => a.programId === b.programId && a.decision === b.decision)
      ),
      { initialValue: { programId: '', decision: null } }
    );
  }

  private initLoaded(): Signal<MentorshipProgramReviewView> {
    return toSignal(
      toObservable(this.link).pipe(
        tap(() => this.submission.set(null)),
        switchMap((link) =>
          concat(
            this.submitSettled(),
            defer(() => this.loadView(link))
          ).pipe(startWith<MentorshipProgramReviewView>({ state: 'loading', program: null }))
        )
      ),
      { initialValue: { state: 'loading', program: null } }
    );
  }

  private initConfirming(): Signal<MentorshipProgramReviewConfirmation | null> {
    return computed(() => {
      const state = this.state();
      const program = this.program();
      const decision = this.decision();
      if ((state !== 'confirm' && state !== 'submitting') || !program || !decision) {
        return null;
      }
      return { program, decision };
    });
  }

  private initAlreadyDecidedMessage(): Signal<string> {
    return computed(() => {
      const program = this.program();
      if (!program) {
        return 'It is no longer awaiting a decision.';
      }
      // A 409 on Confirm keeps the program as loaded (still `pending`), so its status says nothing new.
      if (program.status === 'pending') {
        return 'Another reviewer decided this program before you confirmed.';
      }
      // Upstream owns the status set, so a status added there before this map shows its raw value.
      const statusLabel = MENTORSHIP_UPSTREAM_PROGRAM_STATUS_LABELS[program.status] ?? program.status;
      return `${program.name} — current status: ${statusLabel}.`;
    });
  }

  private loadView({ programId, decision }: MentorshipProgramReviewLink): Observable<MentorshipProgramReviewView> {
    // Upstream checks access on the program UUID, so a slug or a missing decision is a bad link.
    if (!decision || !isUuid(programId)) {
      return of<MentorshipProgramReviewView>({ state: 'invalid-link', program: null });
    }
    return this.mentorshipService.getProgramReview(programId).pipe(
      map((program): MentorshipProgramReviewView => ({ state: program.status === 'pending' ? 'confirm' : 'already-decided', program })),
      catchError((error: unknown) => of<MentorshipProgramReviewView>({ state: this.stateForError(error), program: null }))
    );
  }

  /** Completes once an in-flight Confirm settles, whatever its outcome, or at once when there is none. */
  private submitSettled(): Observable<never> {
    return this.submitRequest
      ? this.submitRequest.pipe(
          ignoreElements(),
          catchError(() => EMPTY)
        )
      : EMPTY;
  }

  /** Shows a Confirm outcome only on the link it was made from; after a link change the reload shows it instead. */
  private settleSubmit(request: Observable<MentorshipProgramReview>, link: MentorshipProgramReviewLink, view: MentorshipProgramReviewView): void {
    if (this.submitRequest === request) {
      this.submitRequest = null;
    }
    if (this.link() === link) {
      this.submission.set(view);
    }
  }

  private stateForError(error: unknown): MentorshipProgramReviewState {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    switch (status) {
      case 400:
        return 'invalid-link';
      case 403:
        return 'forbidden';
      case 404:
        return 'not-found';
      case 409:
        return 'already-decided';
      default:
        return 'error';
    }
  }

  private toDecision(value: string | null): MentorshipProgramReviewDecision | null {
    return (MENTORSHIP_PROGRAM_REVIEW_DECISIONS as readonly (string | null)[]).includes(value) ? (value as MentorshipProgramReviewDecision) : null;
  }
}
