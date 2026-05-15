// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollType } from '@lfx-one/shared';
import { CreateVoteResponseRequest, PollQuestion, Vote, VoteAnswerInput } from '@lfx-one/shared/interfaces';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, finalize, of, shareReplay, startWith, Subject, switchMap, take, takeUntil, throwError } from 'rxjs';

const INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND';

@Component({
  selector: 'lfx-vote-cast-drawer',
  imports: [
    DrawerModule,
    SkeletonModule,
    CheckboxModule,
    ReactiveFormsModule,
    ButtonComponent,
    RadioButtonComponent,
    TagComponent,
    PollStatusLabelPipe,
    PollStatusSeverityPipe,
    DatePipe,
  ],
  templateUrl: './vote-cast-drawer.component.html',
  styleUrl: './vote-cast-drawer.component.scss',
})
export class VoteCastDrawerComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly voteId = input<string | null>(null);
  public readonly listVote = input<Vote | null>(null);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly voteSubmitted = output<string>();

  // === Forms ===
  public readonly form = new FormGroup({});
  public readonly abstainControl = new FormControl<boolean>(false, { nonNullable: true });

  // === Writable Signals ===
  protected readonly loadingVote = signal<boolean>(false);
  protected readonly submitting = signal<boolean>(false);
  // Reactive dependency for submitDisabled — rebuildForm uses { emitEvent: false }, so statusChanges is silent.
  private readonly formVersion = signal<number>(0);

  // === Shared Observables ===
  private readonly voteId$ = toObservable(this.voteId).pipe(shareReplay({ bufferSize: 1, refCount: true }));
  // Emits on drawer dismissal (close button OR ESC OR overlay click — all flip visible to false).
  private readonly cancelSubmit$ = new Subject<void>();

  // === Derived Signals (from API) ===
  protected readonly vote: Signal<Vote | null> = this.initVote();
  protected readonly abstain: Signal<boolean> = toSignal(this.abstainControl.valueChanges, { initialValue: this.abstainControl.value });

  // === Computed Signals ===
  protected readonly isGenericPoll: Signal<boolean> = computed(() => this.vote()?.poll_type === PollType.GENERIC);
  protected readonly questions: Signal<PollQuestion[]> = computed(() => this.vote()?.poll_questions ?? []);
  protected readonly allowAbstain: Signal<boolean> = computed(() => !!this.vote()?.allow_abstain);
  protected readonly submitDisabled: Signal<boolean> = this.initSubmitDisabled();

  public constructor() {
    // Rebuild the form when the loaded vote's questions change.
    toObservable(this.questions)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((questions) => this.rebuildForm(questions));

    // Abstain toggle disables answer controls without losing their values.
    this.abstainControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((isAbstaining) => {
      if (isAbstaining) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
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
        // Reset abstain so reopening starts fresh — letting valueChanges fire keeps form.enable + abstain signal in sync.
        if (this.abstainControl.value) this.abstainControl.setValue(false);
      });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected onSubmit(): void {
    const vote = this.vote();
    if (!vote || this.submitting()) return;

    const isAbstain = this.abstain();
    const userVoteContent = isAbstain ? undefined : this.buildAnswers(vote.poll_questions ?? []);

    this.submitting.set(true);

    // The voting service pre-allocates one vote_response row per invitee — POST /vote_responses MUST reuse that uid.
    this.voteService
      .getMyVoteResponse(vote.uid)
      .pipe(
        take(1),
        switchMap((myResponse) => {
          if (!myResponse?.uid) return throwError(() => new Error(INVITATION_NOT_FOUND));
          const payload: CreateVoteResponseRequest = {
            vote_response_uid: myResponse.uid,
            vote_uid: vote.uid,
            abstain: isAbstain,
            user_vote_content: userVoteContent,
          };
          return this.voteService.createVoteResponse(payload);
        }),
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
  private initVote(): Signal<Vote | null> {
    return toSignal(
      this.voteId$.pipe(
        switchMap((id) => {
          if (!id) {
            this.loadingVote.set(false);
            return of(null);
          }
          this.loadingVote.set(true);
          const listVote = this.listVote();
          return this.voteService.getVote(id).pipe(
            catchError(() => of(listVote)),
            finalize(() => this.loadingVote.set(false)),
            startWith(listVote)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initSubmitDisabled(): Signal<boolean> {
    return computed(() => {
      this.formVersion(); // re-evaluate when controls are added/removed/disabled via { emitEvent: false }
      if (this.submitting()) return true;
      if (this.abstain()) return false;
      return !this.form.valid;
    });
  }

  // === Private Helpers ===
  // Reconciles the form against the current vote's questions; bumps formVersion since we suppress emitEvent.
  private rebuildForm(questions: PollQuestion[]): void {
    const desiredIds = new Set(questions.map((q) => q.question_id));
    for (const existingId of Object.keys(this.form.controls)) {
      if (!desiredIds.has(existingId)) this.form.removeControl(existingId, { emitEvent: false });
    }
    for (const question of questions) {
      if (this.form.contains(question.question_id)) continue;
      if (question.type === 'multiple_choice') {
        this.form.addControl(question.question_id, new FormControl<string[]>([], { nonNullable: true, validators: [Validators.required] }), {
          emitEvent: false,
        });
      } else {
        this.form.addControl(question.question_id, new FormControl<string | null>(null, Validators.required), { emitEvent: false });
      }
    }
    this.bumpFormVersion();
  }

  private bumpFormVersion(): void {
    this.formVersion.update((v) => v + 1);
  }

  private buildAnswers(questions: PollQuestion[]): VoteAnswerInput[] {
    return questions.map((q) => ({
      question_id: q.question_id,
      choice_ids: this.normaliseChoiceIds(this.form.get(q.question_id)?.value),
    }));
  }

  private normaliseChoiceIds(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string' && raw.length > 0) return [raw];
    return [];
  }
}
