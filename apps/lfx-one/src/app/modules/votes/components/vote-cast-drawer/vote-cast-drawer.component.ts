// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, model, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { VoteDescriptionPipe } from '../../pipes/vote-description.pipe';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { PollType } from '@lfx-one/shared';
import {
  INVITATION_NOT_FOUND,
  VOTE_COMMENT_RESPONSE_MAX_LENGTH,
  VOTE_IMPERSONATION_PRIVATE_NOTICE,
  VOTE_IMPERSONATION_READ_ONLY_NOTICE,
} from '@lfx-one/shared/constants';
import { CommentResponseFormData, MyVoteBallot, PollCommentPrompt, PollQuestion, UserChoice, Vote, VoteAnswerInput } from '@lfx-one/shared/interfaces';
import {
  buildBallotCommentPrompts,
  buildCommentResponses,
  buildVoteBallotQuestions,
  getCommentPromptsData,
  getUserTimezone,
  isRankedPollType,
  mapMyBallotToCastForm,
  reconcileCommentFormControls,
} from '@lfx-one/shared/utils';
import { CodePointLengthPipe } from '@pipes/code-point-length.pipe';
import { LinkifyHtmlPipe } from '@pipes/linkify-html.pipe';
import { LongTimezonePipe } from '@pipes/long-timezone.pipe';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { VoteDeadlinePipe } from '@pipes/vote-deadline.pipe';
import { VoteService } from '@services/vote.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, distinctUntilChanged, EMPTY, filter, finalize, map, of, startWith, Subject, switchMap, takeUntil, tap } from 'rxjs';

import { ExternalLinksDirective } from '@shared/directives/external-links.directive';

@Component({
  selector: 'lfx-vote-cast-drawer',
  imports: [
    DrawerModule,
    ExternalLinksDirective,
    LinkifyHtmlPipe,
    VoteDescriptionPipe,
    SkeletonModule,
    CheckboxModule,
    DragDropModule,
    TooltipModule,
    ReactiveFormsModule,
    ButtonComponent,
    MessageComponent,
    RadioButtonComponent,
    TagComponent,
    TextareaComponent,
    PollStatusLabelPipe,
    PollStatusSeverityPipe,
    CodePointLengthPipe,
    LongTimezonePipe,
    VoteDeadlinePipe,
  ],
  templateUrl: './vote-cast-drawer.component.html',
  styleUrl: './vote-cast-drawer.component.scss',
})
export class VoteCastDrawerComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly voteId = input<string | null>(null);
  public readonly listVote = input<Vote | null>(null);
  /** Review mode (#4331): shows the voter's submitted ballot without allowing changes. */
  public readonly readOnly = input<boolean>(false);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly voteSubmitted = output<string>();

  // === Forms ===
  public readonly form = new FormGroup({});
  public readonly abstainControl = new FormControl<boolean>(false, { nonNullable: true });
  // Kept separate from `form` so abstain's disable()/enable() toggling of answer controls never touches comments.
  public readonly commentForm = new FormGroup({});

  // === Writable Signals ===
  protected readonly loadingVote = signal<boolean>(false);
  protected readonly submitting = signal<boolean>(false);
  protected readonly loadingBallot = signal<boolean>(false);
  protected readonly ballotError = signal<boolean>(false);
  // Reactive dependency for submitDisabled — rebuildForm uses { emitEvent: false }, so statusChanges is silent.
  private readonly formVersion = signal<number>(0);
  // Tracks the poll_type the form was last built for; if it changes (e.g., list vote omitted poll_type and detail fetch supplied a ranked one), rebuildForm wipes controls so they get the right shape.
  private lastBuiltPollType: PollType | null = null;
  // Key of the recorded ballot last displayed; cleared on close so a reopen reloads it.
  private appliedPrefillKey: string | null = null;

  // === Shared Observables ===
  // Emits on drawer dismissal (close button OR ESC OR overlay click — all flip visible to false).
  private readonly cancelSubmit$ = new Subject<void>();

  // === Derived Signals (from API) ===
  protected readonly vote: Signal<Vote | null> = this.initVote();
  protected readonly myBallot: Signal<MyVoteBallot | null> = this.initMyBallot();
  protected readonly abstain: Signal<boolean> = toSignal(this.abstainControl.valueChanges, { initialValue: this.abstainControl.value });

  // === Computed Signals ===
  protected readonly isRankedPoll: Signal<boolean> = this.initIsRankedPoll();
  protected readonly questions: Signal<PollQuestion[]> = this.initQuestions();
  protected readonly allowAbstain: Signal<boolean> = computed(() => !!this.vote()?.allow_abstain);
  protected readonly submitDisabled: Signal<boolean> = this.initSubmitDisabled();
  protected readonly impersonating = this.userService.impersonating;
  protected readonly ballotPrivacyRestricted = computed(() => this.impersonating() && this.vote()?.pseudo_anonymity !== false);
  protected readonly impersonationNotice = computed(() =>
    this.readOnly() && this.ballotPrivacyRestricted() ? VOTE_IMPERSONATION_PRIVATE_NOTICE : VOTE_IMPERSONATION_READ_ONLY_NOTICE
  );
  protected readonly reviewNotice = 'Your vote has been recorded.';
  protected readonly ballotLoadError = "Couldn't load your submitted ballot. Close this panel and try again.";
  // Footer is hidden (not removed) until a ballot exists — see drawer-pattern.md § Sticky footer.
  protected readonly drawerPt: Signal<Record<string, unknown>> = this.initDrawerPt();
  // Map<question_id, ordered choices> — recomputed when questions or formVersion changes; replaces a per-render method call in @for.
  protected readonly rankedOrderByQuestion: Signal<Map<string, UserChoice[]>> = this.initRankedOrderByQuestion();
  protected readonly unrankedChoicesByQuestion: Signal<Map<string, UserChoice[]>> = this.initUnrankedChoicesByQuestion();
  protected readonly commentResponseMaxLength = VOTE_COMMENT_RESPONSE_MAX_LENGTH;
  protected readonly commentPrompts: Signal<PollCommentPrompt[]> = this.initCommentPrompts();
  protected readonly commentPromptsData: Signal<CommentResponseFormData[]> = this.initCommentPromptsData();

  // Resolved once per browser session — SSR has no `Intl` zone to resolve, so
  // the Due line falls back to UTC there and is replaced on client hydration.
  protected readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  public constructor() {
    // Rebuild the form when the loaded vote's questions change.
    toObservable(this.questions)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((questions) => {
        this.rebuildForm(questions);
        this.applyBallotPrefill();
      });

    // Rebuild the comment form when the loaded vote's comment prompts change.
    toObservable(this.commentPrompts)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((prompts) => {
        reconcileCommentFormControls(this.commentForm, prompts);
        this.bumpFormVersion();
        this.applyBallotPrefill();
      });

    // Review mode: display the form once the voter's recorded ballot loads.
    toObservable(this.myBallot)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyBallotPrefill());

    // A reused drawer must not carry recorded choices or disabled controls into a first ballot.
    toObservable(this.readOnly)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.appliedPrefillKey = null;
        for (const id of Object.keys(this.form.controls)) this.form.removeControl(id, { emitEvent: false });
        this.rebuildForm(this.questions());
        this.applyBallotPrefill();
      });

    // User input (checkbox/radio toggle, etc.) emits statusChanges; bump formVersion so the submitDisabled computed re-evaluates form.valid.
    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.bumpFormVersion());

    // Comment textarea input emits statusChanges (e.g. max-code-points violation); bump formVersion so submitDisabled re-evaluates commentForm.valid.
    this.commentForm.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.bumpFormVersion());

    // Abstain toggle disables answer controls without losing their values.
    this.abstainControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncControls();
      this.bumpFormVersion();
    });

    // Drawer dismissal (close button / ESC / overlay click) — cancel any in-flight submit and reset transient state.
    toObservable(this.visible)
      .pipe(
        filter((v) => !v),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        if (this.submitting()) this.cancelSubmit$.next();
        this.submitting.set(false);
        this.appliedPrefillKey = null;
        // Reset abstain so reopening starts fresh — letting valueChanges fire keeps form.enable + abstain signal in sync.
        if (this.abstainControl.value) this.abstainControl.setValue(false);
        // Clear comment text so reopening the same vote doesn't show stale drafts.
        for (const control of Object.values(this.commentForm.controls) as FormControl<string>[]) {
          control.reset('');
        }
      });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  /** Reorder via CDK drag-and-drop — bumpFormVersion() drives submitDisabled re-evaluation since rebuildForm/setValue here suppress statusChanges. */
  protected onRankedDrop(questionId: string, event: CdkDragDrop<string[]>): void {
    if (this.readOnly() || this.impersonating()) return;
    const control = this.form.get(questionId);
    if (!control) return;
    const current = [...((control.value as string[] | null) ?? [])];
    moveItemInArray(current, event.previousIndex, event.currentIndex);
    control.setValue(current);
    this.bumpFormVersion();
  }

  /** Keyboard / arrow-button reorder fallback for the drag list. */
  protected moveRank(questionId: string, fromIndex: number, toIndex: number): void {
    if (this.readOnly() || this.impersonating()) return;
    const control = this.form.get(questionId);
    if (!control) return;
    const current = [...((control.value as string[] | null) ?? [])];
    if (toIndex < 0 || toIndex >= current.length) return;
    moveItemInArray(current, fromIndex, toIndex);
    control.setValue(current);
    this.bumpFormVersion();
  }

  protected onSubmit(): void {
    const vote = this.vote();
    if (!vote || this.submitting() || this.readOnly() || this.impersonating()) return;

    const isAbstain = this.abstain();
    if (!isAbstain && this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.commentForm.invalid) {
      this.commentForm.markAllAsTouched();
      return;
    }
    const userVoteContent = isAbstain ? undefined : this.buildAnswers(vote.poll_questions ?? []);
    // Comments are independent of abstain — a voter can abstain and still leave a comment.
    const commentResponses = buildCommentResponses(this.commentPromptsData());

    this.submitting.set(true);

    this.voteService
      .submitMyResponse(vote.uid, {
        abstain: isAbstain,
        userVoteContent,
        commentResponses,
      })
      .pipe(
        takeUntil(this.cancelSubmit$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Vote submitted',
            detail: `Your ${isAbstain ? 'abstention' : 'ballot'} has been recorded.`,
            life: 3000,
          });
          this.voteSubmitted.emit(vote.uid);
          this.visible.set(false);
        },
        error: (err: unknown) => {
          const isInvitationMissing = err instanceof Error && !(err instanceof HttpErrorResponse) && err.message === INVITATION_NOT_FOUND;
          this.messageService.add({
            severity: 'error',
            summary: isInvitationMissing ? 'Unable to find your invitation' : 'Unable to submit vote',
            detail: isInvitationMissing
              ? 'We could not find your vote invitation for this ballot. Please refresh and try again.'
              : 'Something went wrong submitting your ballot. Please try again.',
            life: 5000,
          });
        },
      });
  }

  // === Private Initializers ===
  /** Mirrors the former results drawer's initVote() (per @copilot-pull-request-reviewer, GH-3823 review): keying
   *  off voteId alone meant a manager who extended a vote's deadline while this drawer was closed, then
   *  reopened it on the same vote, saw the stale pre-extension deadline — voteId never changed, so the
   *  cached getVote() response was neither re-fetched nor bypassed. Keying off id/visible/listVote together
   *  and bypassing the cache on a deadline change (or a different-vote reselection) keeps a reopened drawer
   *  on the current deadline.
   *  Also mirrors that drawer's last-loaded fallback and skip-loading-flag behavior (per @cursor,
   *  GH-3823 review): a deadline change on the open vote re-runs this stream, and startWith(listVote) alone
   *  would seed it with whatever the caller's list row currently holds — if that row is a stale/partial
   *  summary object (or the list hasn't produced one yet), poll_questions drops out and rebuildForm() wipes
   *  the ballot the voter was filling in. Falling back to the last fetched detail for the same vote (instead
   *  of the raw listVote) and only flipping loadingVote when no fallback exists keeps the ballot intact. */
  private initVote(): Signal<Vote | null> {
    let prevId: string | null = null;
    let prevDeadlineKey: string | null = null;
    let lastVoteId: string | null = null;
    let lastVote: Vote | null = null;

    const selection = computed(() => ({ id: this.voteId(), visible: this.visible(), listVote: this.listVote() }));

    return toSignal(
      toObservable(selection).pipe(
        distinctUntilChanged(
          (prev, curr) =>
            prev.id === curr.id &&
            prev.visible === curr.visible &&
            prev.listVote?.end_time === curr.listVote?.end_time &&
            prev.listVote?.end_time_timezone === curr.listVote?.end_time_timezone
        ),
        switchMap(({ id, visible, listVote }) => {
          if (!id) {
            this.loadingVote.set(false);
            prevId = null;
            prevDeadlineKey = null;
            lastVoteId = null;
            lastVote = null;
            return of(null);
          }
          if (!visible) {
            this.loadingVote.set(false);
            return EMPTY;
          }

          const deadlineKey = `${listVote?.end_time ?? ''}|${listVote?.end_time_timezone ?? ''}`;
          const selectionChanged = prevId !== null && prevId !== id;
          const deadlineChanged = prevId === id && prevDeadlineKey !== null && prevDeadlineKey !== deadlineKey;
          const skipCache = selectionChanged || deadlineChanged;
          prevId = id;
          prevDeadlineKey = deadlineKey;

          // Prefer the last fetched full detail over listVote (per @cursor, GH-3823 review): a deadline
          // change re-runs this stream with the caller's list row already carrying the new end_time, but
          // that row can be a partial summary missing poll_questions. Falling back to listVote only when no
          // full detail has been fetched yet for this vote keeps rebuildForm() from wiping the ballot.
          // When both exist, overlay listVote's deadline fields onto the cached detail (per @greptile-apps
          // and @copilot-pull-request-reviewer, GH-3823 review): listVote is the caller's source of truth for
          // an in-flight deadline extension, so keeping lastVote wholesale would show the voter the
          // pre-extension end_time if the detail refetch below then fails and catchError falls back to this
          // same value.
          const lastDetail = lastVoteId === id ? lastVote : null;
          // #4075: never trust an unconfirmed list-row poll_type for the ranked/single-choice decision
          // while the first detail fetch for this vote is in flight — wait for a confirmed fetch. A
          // missing poll_type already defaults to non-ranked everywhere it's read, so this transient
          // startWith emission can only bias toward the safe single-choice shape. If the fetch then
          // fails outright with no cached detail to fall back to, degrade to the list row's own
          // poll_type (per @dealako, #4076 review) rather than a doubly-unconfirmed guess — matching
          // how every other field (poll_questions, etc.) already behaves in that terminal-failure state.
          const listFallback = listVote ?? null;
          let fallback = lastDetail ?? (listVote ? { ...listVote, poll_type: undefined } : null);
          if (lastDetail && listVote) {
            fallback = { ...lastDetail, end_time: listVote.end_time, end_time_timezone: listVote.end_time_timezone };
          }
          if (!fallback) {
            this.loadingVote.set(true);
          }

          return this.voteService.getVote(id, { skipCache }).pipe(
            tap((v) => {
              lastVoteId = id;
              lastVote = v;
            }),
            catchError(() => of(lastDetail ? fallback : listFallback)),
            finalize(() => this.loadingVote.set(false)),
            startWith(fallback)
          );
        })
      ),
      { initialValue: null }
    );
  }

  /** Loads the recorded ballot only while reviewing; missing content is an error, never an editable form. */
  private initMyBallot(): Signal<MyVoteBallot | null> {
    const selection = computed(() => ({ id: this.voteId(), visible: this.visible(), reviewing: this.readOnly() && !this.ballotPrivacyRestricted() }));

    return toSignal(
      toObservable(selection).pipe(
        distinctUntilChanged((prev, curr) => prev.id === curr.id && prev.visible === curr.visible && prev.reviewing === curr.reviewing),
        switchMap(({ id, visible, reviewing }) => {
          this.ballotError.set(false);
          if (!id || !visible || !reviewing) {
            this.loadingBallot.set(false);
            return of(null);
          }

          this.loadingBallot.set(true);
          return this.voteService.getMyVoteBallot(id).pipe(
            map((ballot) => {
              if (!ballot || ballot.vote_uid !== id) {
                this.ballotError.set(true);
                return null;
              }
              return ballot;
            }),
            catchError(() => {
              this.ballotError.set(true);
              return of(null);
            }),
            finalize(() => this.loadingBallot.set(false)),
            startWith(null)
          );
        })
      ),
      { initialValue: null }
    );
  }

  /** Review preserves saved choices absent from current metadata, without offering them on a first ballot. */
  private initQuestions(): Signal<PollQuestion[]> {
    return computed(() => {
      const vote = this.vote();
      const ballot = this.myBallot();
      if (!vote) return [];
      if (!this.readOnly() || !ballot || ballot.vote_uid !== vote.uid) return vote.poll_questions ?? [];
      return buildVoteBallotQuestions(vote, ballot).map((question) => ({
        question_id: question.questionId,
        prompt: question.prompt,
        type: question.multiple ? 'multiple_choice' : 'single_choice',
        choices: [...question.choices, ...question.rankedChoices, ...question.unrankedChoices].map((choice) => ({
          choice_id: choice.choiceId,
          choice_text: choice.text,
        })),
      }));
    });
  }

  private initDrawerPt(): Signal<Record<string, unknown>> {
    return computed(() => {
      const hasBallot = !this.loadingVote() && this.questions().length > 0;
      const restricted = this.impersonating() && (!this.readOnly() || this.ballotPrivacyRestricted());
      return { footer: { class: hasBallot && !restricted ? 'border-t border-slate-200' : 'hidden' } };
    });
  }

  private initIsRankedPoll(): Signal<boolean> {
    return computed(() => isRankedPollType(this.vote()?.poll_type));
  }

  private initSubmitDisabled(): Signal<boolean> {
    return computed(() => {
      this.formVersion(); // re-evaluate when controls are added/removed/disabled via { emitEvent: false }
      if (this.submitting()) return true;
      if (this.readOnly() || this.impersonating()) return true;
      if (!this.commentForm.valid) return true;
      if (this.abstain()) return false;
      return !this.form.valid;
    });
  }

  private initCommentPrompts(): Signal<PollCommentPrompt[]> {
    return computed(() => {
      const vote = this.vote();
      const ballot = this.myBallot();
      if (!this.readOnly() || !vote || ballot?.vote_uid !== vote.uid) return vote?.poll_comment_prompts ?? [];
      return buildBallotCommentPrompts(vote.poll_comment_prompts, ballot.comment_responses);
    });
  }

  private initCommentPromptsData(): Signal<CommentResponseFormData[]> {
    return computed(() => {
      this.formVersion(); // re-evaluate when comment controls are added/removed
      return getCommentPromptsData(this.commentForm, this.commentPrompts());
    });
  }

  private initRankedOrderByQuestion(): Signal<Map<string, UserChoice[]>> {
    return computed(() => {
      this.formVersion(); // re-evaluate when ranked-order setValue calls bumpFormVersion
      const result = new Map<string, UserChoice[]>();
      if (!this.isRankedPoll()) return result;
      for (const question of this.questions()) {
        // Defensive Array.isArray — if a stale non-array control value lingers (e.g. mid-session vote reshape), fall back to declared order.
        const raw = this.form.get(question.question_id)?.value;
        const order = Array.isArray(raw) ? (raw as string[]) : null;
        if (!order) {
          result.set(question.question_id, question.choices);
          continue;
        }
        const byId = new Map(question.choices.map((c) => [c.choice_id, c]));
        result.set(
          question.question_id,
          order.map((id) => byId.get(id)).filter((c): c is UserChoice => !!c)
        );
      }
      return result;
    });
  }

  private initUnrankedChoicesByQuestion(): Signal<Map<string, UserChoice[]>> {
    return computed(() => {
      const result = new Map<string, UserChoice[]>();
      if (!this.readOnly() || !this.isRankedPoll()) return result;
      const ranked = this.rankedOrderByQuestion();
      for (const question of this.questions()) {
        const selected = new Set((ranked.get(question.question_id) ?? []).map((choice) => choice.choice_id));
        result.set(
          question.question_id,
          question.choices.filter((choice) => !selected.has(choice.choice_id))
        );
      }
      return result;
    });
  }

  // === Private Helpers ===
  /** First ballots seed every rank; review waits for the recorded preferences. */
  private rebuildForm(questions: PollQuestion[]): void {
    const currentPollType = this.vote()?.poll_type ?? PollType.GENERIC;
    const pollIsRanked = this.isRankedPoll();
    // If poll_type flipped between builds (e.g., list vote omitted it → detail fetch supplied a ranked one), wipe all controls so they get re-added with the correct shape.
    if (this.lastBuiltPollType !== null && this.lastBuiltPollType !== currentPollType) {
      for (const existingId of Object.keys(this.form.controls)) {
        this.form.removeControl(existingId, { emitEvent: false });
      }
    }
    this.lastBuiltPollType = currentPollType;
    const desiredIds = new Set(questions.map((q) => q.question_id));
    for (const existingId of Object.keys(this.form.controls)) {
      if (!desiredIds.has(existingId)) this.form.removeControl(existingId, { emitEvent: false });
    }
    for (const question of questions) {
      if (this.form.get(question.question_id)) continue;
      if (pollIsRanked) {
        const seeded = this.readOnly() ? [] : question.choices.map((c) => c.choice_id);
        this.form.addControl(question.question_id, new FormControl<string[]>(seeded, { nonNullable: true, validators: [Validators.required] }), {
          emitEvent: false,
        });
      } else if (question.type === 'multiple_choice') {
        this.form.addControl(question.question_id, new FormControl<string[]>([], { nonNullable: true, validators: [Validators.required] }), {
          emitEvent: false,
        });
      } else {
        this.form.addControl(question.question_id, new FormControl<string | null>(null, Validators.required), { emitEvent: false });
      }
    }
    this.bumpFormVersion();
  }

  /**
   * Displays the recorded ballot in the same controls used for voting (#4331). Reapply after a
   * ballot or control-shape change, keeping all controls locked throughout loading and review.
   */
  private applyBallotPrefill(): void {
    const vote = this.vote();
    const ballot = this.myBallot();
    this.syncControls();
    if (!this.readOnly() || !vote || !ballot || ballot.vote_uid !== vote.uid) return;

    const key = [
      vote.uid,
      ballot.vote_creation_time ?? '',
      this.lastBuiltPollType ?? '',
      Object.keys(this.form.controls).join(','),
      Object.keys(this.commentForm.controls).join(','),
    ].join('|');
    if (key === this.appliedPrefillKey) return;
    this.appliedPrefillKey = key;

    const prefill = mapMyBallotToCastForm({ ...vote, poll_questions: this.questions() }, ballot);
    // An abstention can carry no answers. Never retain choices from an earlier ballot or draft.
    for (const question of this.questions()) {
      const emptyValue = this.isRankedPoll() || question.type === 'multiple_choice' ? [] : null;
      this.form.get(question.question_id)?.setValue(emptyValue, { emitEvent: false });
    }
    for (const [questionId, value] of Object.entries(prefill.answers)) {
      this.form.get(questionId)?.setValue(value, { emitEvent: false });
    }
    // Emitting updates the displayed abstention while syncControls keeps review locked.
    this.abstainControl.setValue(prefill.abstain);
    for (const [promptId, text] of Object.entries(prefill.comments)) {
      this.commentForm.get(promptId)?.setValue(text, { emitEvent: false });
    }
    this.bumpFormVersion();
  }

  private syncControls(): void {
    if (this.readOnly() || this.impersonating() || this.abstainControl.value) this.form.disable({ emitEvent: false });
    else this.form.enable({ emitEvent: false });
    if (this.readOnly() || this.impersonating()) {
      this.commentForm.disable({ emitEvent: false });
      this.abstainControl.disable({ emitEvent: false });
    } else {
      this.commentForm.enable({ emitEvent: false });
      this.abstainControl.enable({ emitEvent: false });
    }
  }

  private bumpFormVersion(): void {
    this.formVersion.update((v) => v + 1);
  }

  private buildAnswers(questions: PollQuestion[]): VoteAnswerInput[] {
    const pollIsRanked = this.isRankedPoll();
    return questions.map((q) => {
      const raw = this.form.get(q.question_id)?.value as string | string[] | null | undefined;
      if (pollIsRanked) {
        const order = Array.isArray(raw) ? raw : [];
        return {
          question_id: q.question_id,
          ranked_choices: order.map((choiceId, idx) => ({ choice_id: choiceId, choice_rank: idx + 1 })),
        };
      }
      return {
        question_id: q.question_id,
        choice_ids: this.normaliseChoiceIds(raw),
      };
    });
  }

  private normaliseChoiceIds(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string' && raw.length > 0) return [raw];
    return [];
  }
}
