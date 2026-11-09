// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  SecurityContext,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_PROGRAM_REVIEW_DECISIONS,
  MENTORSHIP_UPSTREAM_PROGRAM_STATUS_BADGE_CLASSES,
  MENTORSHIP_UPSTREAM_PROGRAM_STATUS_DOT_CLASSES,
  MENTORSHIP_UPSTREAM_PROGRAM_STATUS_LABELS,
  mentorshipCiiBadgeImageUrl,
  mentorshipCiiProjectUrl,
} from '@lfx-one/shared/constants';
import {
  MentorshipProgramReview,
  MentorshipProgramReviewDecision,
  MentorshipProgramReviewLink,
  MentorshipProgramReviewNotice,
  MentorshipProgramReviewOutcome,
  MentorshipProgramReviewState,
  MentorshipProgramReviewStep,
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
 * Review page for a program awaiting approval: `/mentorship/program-review/<program id>`.
 *
 * The review email links here, both from its program preview link (no `?decision=`) and from its
 * approve and reject buttons (`?decision=approve|reject`). The page shows the program as its public
 * page would, and records a decision only when the reviewer clicks Approve or confirms Reject, so a
 * mail scanner prefetching the link changes nothing. `?decision=reject` opens the page on the reject
 * step. Who may see the program and decide is enforced upstream: approvers hold `auditor` on every
 * program, a signed-in user without `viewer` on it sees the 403 state, and a decision from anyone
 * outside the approver team is refused with a 403.
 */
@Component({
  selector: 'lfx-mentorship-program-review',
  imports: [ButtonComponent, EmptyStateComponent, RouteLoadingComponent],
  templateUrl: './program-review.component.html',
})
export class ProgramReviewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly mentorshipService = inject(MentorshipService);

  protected readonly backRoute = ['/mentorship/admin'];

  /** Focus targets when the reject step opens and closes, so keyboard and screen-reader users keep their place. */
  private readonly rejectHeading = viewChild<ElementRef<HTMLElement>>('rejectHeading');
  private readonly rejectButton = viewChild<string, ElementRef<HTMLElement>>('rejectButton', { read: ElementRef });

  /** The view a submitted decision settled on. Cleared when the link changes, so the loaded view shows again. */
  private readonly submission = signal<MentorshipProgramReviewView | null>(null);
  /**
   * The in-flight decision POST, or the status refresh after a conflict. A link change does not cancel
   * it, because a decision may already have reached upstream: the new link loads once it settles, so
   * that view shows the program's real status.
   */
  private submitRequest: Observable<MentorshipProgramReviewOutcome> | null = null;

  protected readonly link: Signal<MentorshipProgramReviewLink> = this.initLink();
  private readonly loaded: Signal<MentorshipProgramReviewView> = this.initLoaded();
  protected readonly view = computed<MentorshipProgramReviewView>(() => this.submission() ?? this.loaded());
  protected readonly state = computed<MentorshipProgramReviewState>(() => this.view().state);
  protected readonly program = computed<MentorshipProgramReview | null>(() => this.view().program);
  /** The review card's step; a new link resets it, and `?decision=reject` starts on the reject step. */
  protected readonly step = linkedSignal<MentorshipProgramReviewStep>(() => (this.link().decision === 'reject' ? 'rejecting' : 'choosing'));
  /** The decision being submitted, so only its button shows the spinner. */
  protected readonly submitting = signal<MentorshipProgramReviewDecision | null>(null);
  /** A status refresh after a conflict whose first reload failed is in flight. */
  protected readonly refreshing = signal(false);
  protected readonly notice = signal<MentorshipProgramReviewNotice | null>(null);
  // Upstream owns the status set, so a status added there before these maps shows its raw value with neutral styling.
  protected readonly statusLabel = computed(() => {
    const status = this.program()?.status;
    return status ? (MENTORSHIP_UPSTREAM_PROGRAM_STATUS_LABELS[status] ?? status) : '';
  });
  protected readonly statusBadgeClass = computed(() => {
    const status = this.program()?.status;
    return (status && MENTORSHIP_UPSTREAM_PROGRAM_STATUS_BADGE_CLASSES[status]) || MENTORSHIP_UPSTREAM_PROGRAM_STATUS_BADGE_CLASSES.hidden;
  });
  protected readonly statusDotClass = computed(() => {
    const status = this.program()?.status;
    return (status && MENTORSHIP_UPSTREAM_PROGRAM_STATUS_DOT_CLASSES[status]) || MENTORSHIP_UPSTREAM_PROGRAM_STATUS_DOT_CLASSES.hidden;
  });
  protected readonly initial = computed(() => (this.program()?.name.trim().charAt(0) ?? '').toUpperCase());
  protected readonly descriptionHtml: Signal<string> = this.initDescriptionHtml();
  protected readonly repoLabel: Signal<string> = this.initRepoLabel();
  protected readonly ciiBadgeImageUrl = computed(() => {
    const id = this.program()?.ciiProjectId;
    return id ? mentorshipCiiBadgeImageUrl(id) : '';
  });
  protected readonly ciiProjectUrl = computed(() => {
    const id = this.program()?.ciiProjectId;
    return id ? mentorshipCiiProjectUrl(id) : '';
  });

  protected onStartReject(): void {
    this.notice.set(null);
    this.step.set('rejecting');
    this.focusAfterRender(() => this.rejectHeading()?.nativeElement);
  }

  protected onCancelReject(): void {
    this.notice.set(null);
    this.step.set('choosing');
    this.focusAfterRender(() => this.rejectButton()?.nativeElement.querySelector<HTMLElement>('button'));
  }

  protected onDecide(decision: MentorshipProgramReviewDecision): void {
    const program = this.program();
    if (!program || program.status !== 'pending' || this.submitting() || this.notice() === 'stale') return;

    this.notice.set(null);
    this.submitting.set(decision);
    this.track(
      this.mentorshipService.submitProgramDecision(program.id, decision).pipe(
        map((result): MentorshipProgramReviewOutcome => ({ view: { state: 'ready', program: { ...program, status: result.status } }, notice: null })),
        catchError((error: unknown) => this.outcomeForFailedDecision(error, program))
      )
    );
  }

  /** Retries reading the status another reviewer recorded, after the first read following a 409 failed. */
  protected onRefreshStatus(): void {
    const program = this.program();
    if (!program || this.refreshing()) return;

    this.refreshing.set(true);
    this.track(this.reloadAfterConflict(program));
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
        tap(() => {
          this.submission.set(null);
          this.notice.set(null);
        }),
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

  /** The description is rich-editor HTML, so it is sanitized before `[innerHTML]`. */
  private initDescriptionHtml(): Signal<string> {
    return computed(() => this.sanitizer.sanitize(SecurityContext.HTML, this.program()?.description ?? '') ?? '');
  }

  /** The repository URL without its scheme or trailing slash, as the link text. */
  private initRepoLabel(): Signal<string> {
    return computed(() => (this.program()?.repoUrl ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
  }

  private loadView({ programId }: MentorshipProgramReviewLink): Observable<MentorshipProgramReviewView> {
    // Upstream checks access on the program UUID, so a slug is a bad link.
    if (!isUuid(programId)) {
      return of<MentorshipProgramReviewView>({ state: 'invalid-link', program: null });
    }
    return this.mentorshipService.getProgramReview(programId).pipe(
      map((program): MentorshipProgramReviewView => ({ state: 'ready', program })),
      catchError((error: unknown) => of<MentorshipProgramReviewView>({ state: this.stateForError(error), program: null }))
    );
  }

  /** Moves focus once the next render has put the target in the DOM; `afterNextRender` runs only in the browser. */
  private focusAfterRender(target: () => HTMLElement | null | undefined): void {
    afterNextRender(() => target()?.focus(), { injector: this.injector });
  }

  /** Runs a decision or a status refresh, so a link change waits for it and its outcome lands only on its own link. */
  private track(outcome$: Observable<MentorshipProgramReviewOutcome>): void {
    const link = this.link();
    const request = outcome$.pipe(takeUntilDestroyed(this.destroyRef), shareReplay({ bufferSize: 1, refCount: false }));
    this.submitRequest = request;
    request.subscribe((outcome) => this.settleSubmit(request, link, outcome));
  }

  /**
   * A 409 means another reviewer decided first, so the program is read again to show the status
   * they recorded. Access and link errors take over the page; anything else keeps the program on
   * screen with a note, so the reviewer can try again.
   */
  private outcomeForFailedDecision(error: unknown, program: MentorshipProgramReview): Observable<MentorshipProgramReviewOutcome> {
    const state = this.stateForError(error);
    if (this.httpStatus(error) === 409) {
      return this.reloadAfterConflict(program);
    }
    if (state === 'error') {
      return of<MentorshipProgramReviewOutcome>({ view: { state: 'ready', program }, notice: 'failed' });
    }
    return of<MentorshipProgramReviewOutcome>({ view: { state, program: null }, notice: null });
  }

  /**
   * Reads the status another reviewer recorded. Access and link errors still take over the page; any
   * other failure keeps the program on screen with the `stale` note, which hides the decision buttons
   * (the program is no longer pending upstream) and offers a refresh.
   */
  private reloadAfterConflict(program: MentorshipProgramReview): Observable<MentorshipProgramReviewOutcome> {
    return this.mentorshipService.getProgramReview(program.id).pipe(
      map((reloaded): MentorshipProgramReviewOutcome => ({ view: { state: 'ready', program: reloaded }, notice: 'conflict' })),
      catchError((error: unknown) => {
        const state = this.stateForError(error);
        return of<MentorshipProgramReviewOutcome>(
          state === 'error' ? { view: { state: 'ready', program }, notice: 'stale' } : { view: { state, program: null }, notice: null }
        );
      })
    );
  }

  /** Completes once an in-flight decision settles, whatever its outcome, or at once when there is none. */
  private submitSettled(): Observable<never> {
    return this.submitRequest
      ? this.submitRequest.pipe(
          ignoreElements(),
          catchError(() => EMPTY)
        )
      : EMPTY;
  }

  /** Shows a decision's outcome only on the link it was made from; after a link change the reload shows it instead. */
  private settleSubmit(request: Observable<MentorshipProgramReviewOutcome>, link: MentorshipProgramReviewLink, outcome: MentorshipProgramReviewOutcome): void {
    if (this.submitRequest === request) {
      this.submitRequest = null;
    }
    this.submitting.set(null);
    this.refreshing.set(false);
    if (this.link() === link) {
      this.submission.set(outcome.view);
      this.notice.set(outcome.notice);
    }
  }

  private stateForError(error: unknown): MentorshipProgramReviewState {
    switch (this.httpStatus(error)) {
      case 400:
        return 'invalid-link';
      case 403:
        return 'forbidden';
      case 404:
        return 'not-found';
      default:
        return 'error';
    }
  }

  private httpStatus(error: unknown): number {
    return error instanceof HttpErrorResponse ? error.status : 0;
  }

  private toDecision(value: string | null): MentorshipProgramReviewDecision | null {
    return (MENTORSHIP_PROGRAM_REVIEW_DECISIONS as readonly (string | null)[]).includes(value) ? (value as MentorshipProgramReviewDecision) : null;
  }
}
