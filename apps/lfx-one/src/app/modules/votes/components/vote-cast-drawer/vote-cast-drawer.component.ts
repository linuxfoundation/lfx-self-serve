// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollType } from '@lfx-one/shared';
import { INVITATION_NOT_FOUND } from '@lfx-one/shared/constants';
import { PollQuestion, UserChoice, Vote, VoteAnswerInput } from '@lfx-one/shared/interfaces';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, finalize, of, shareReplay, startWith, Subject, switchMap, takeUntil } from 'rxjs';

@Component({
  selector: 'lfx-vote-cast-drawer',
  imports: [
    DrawerModule,
    SkeletonModule,
    CheckboxModule,
    DragDropModule,
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
  // Tracks the poll_type the form was last built for; if it changes (e.g., list vote omitted poll_type and detail fetch supplied a ranked one), rebuildForm wipes controls so they get the right shape.
  private lastBuiltPollType: PollType | null = null;

  // === Shared Observables ===
  private readonly voteId$ = toObservable(this.voteId).pipe(shareReplay({ bufferSize: 1, refCount: true }));
  // Emits on drawer dismissal (close button OR ESC OR overlay click — all flip visible to false).
  private readonly cancelSubmit$ = new Subject<void>();

  // === Derived Signals (from API) ===
  protected readonly vote: Signal<Vote | null> = this.initVote();
  protected readonly abstain: Signal<boolean> = toSignal(this.abstainControl.valueChanges, { initialValue: this.abstainControl.value });

  // === Computed Signals ===
  // Missing poll_type defaults to GENERIC (parity with vote-results-drawer.initIsGenericPoll) so the plurality branch renders when upstream omits the field.
  protected readonly isGenericPoll: Signal<boolean> = computed(() => {
    const v = this.vote();
    if (!v) return false;
    return (v.poll_type ?? PollType.GENERIC) === PollType.GENERIC;
  });
  protected readonly isRankedPoll: Signal<boolean> = this.initIsRankedPoll();
  protected readonly questions: Signal<PollQuestion[]> = computed(() => this.vote()?.poll_questions ?? []);
  protected readonly allowAbstain: Signal<boolean> = computed(() => !!this.vote()?.allow_abstain);
  protected readonly submitDisabled: Signal<boolean> = this.initSubmitDisabled();
  // Map<question_id, ordered choices> — recomputed when questions or formVersion changes; replaces a per-render method call in @for.
  protected readonly rankedOrderByQuestion: Signal<Map<string, UserChoice[]>> = this.initRankedOrderByQuestion();

  public constructor() {
    // Rebuild the form when the loaded vote's questions change.
    toObservable(this.questions)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((questions) => this.rebuildForm(questions));

    // User input (checkbox/radio toggle, etc.) emits statusChanges; bump formVersion so the submitDisabled computed re-evaluates form.valid.
    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.bumpFormVersion());

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

  /** Reorder via CDK drag-and-drop — bumpFormVersion() drives submitDisabled re-evaluation since rebuildForm/setValue here suppress statusChanges. */
  protected onRankedDrop(questionId: string, event: CdkDragDrop<string[]>): void {
    const control = this.form.get(questionId);
    if (!control) return;
    const current = [...((control.value as string[] | null) ?? [])];
    moveItemInArray(current, event.previousIndex, event.currentIndex);
    control.setValue(current);
    this.bumpFormVersion();
  }

  /** Keyboard / arrow-button reorder fallback for the drag list. */
  protected moveRank(questionId: string, fromIndex: number, toIndex: number): void {
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
    if (!vote || this.submitting()) return;

    const isAbstain = this.abstain();
    const userVoteContent = isAbstain ? undefined : this.buildAnswers(vote.poll_questions ?? []);

    this.submitting.set(true);

    this.voteService
      .submitMyResponse(vote.uid, { abstain: isAbstain, userVoteContent })
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

  private initIsRankedPoll(): Signal<boolean> {
    return computed(() => {
      const t = this.vote()?.poll_type;
      return !!t && t !== PollType.GENERIC;
    });
  }

  private initSubmitDisabled(): Signal<boolean> {
    return computed(() => {
      this.formVersion(); // re-evaluate when controls are added/removed/disabled via { emitEvent: false }
      if (this.submitting()) return true;
      if (this.abstain()) return false;
      return !this.form.valid;
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
        if (!order?.length) {
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

  // === Private Helpers ===
  /** Reconciles the form against the current vote's questions; ranked polls seed declared order so the form is valid on load. */
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
      if (this.form.contains(question.question_id)) continue;
      if (pollIsRanked) {
        const seeded = question.choices.map((c) => c.choice_id);
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
