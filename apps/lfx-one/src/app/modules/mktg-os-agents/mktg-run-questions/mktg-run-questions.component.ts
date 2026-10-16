// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, effect, ElementRef, input, output, Signal, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MKTG_ANSWER_NOT_SUBSTANTIVE_ERROR } from '@lfx-one/shared/constants';
import {
  MktgRunAnswer,
  MktgRunAnswerOrigin,
  MktgRunQuestion,
  MktgRunQuestionChip,
  MktgRunQuestionChoice,
  MktgRunQuestionReviewRow,
} from '@lfx-one/shared/interfaces';
import { foundationMessageAnswerOrigin, isFoundationMessageAnswerSubstantive, mktgRunQuestionShortLabel } from '@lfx-one/shared/utils';
import { map } from 'rxjs';

/** One basis entry: a link when it is one, plain text otherwise. */
interface BasisChip {
  text: string;
  href: string | null;
}

/** The current question as the template binds it. */
interface QuestionView extends MktgRunQuestion {
  index: number;
  hasSuggestion: boolean;
  basisChips: BasisChip[];
  controlId: string;
}

// The agent's questions, one at a time (the way Claude Code asks): a row of
// short chips across the top, one card per question with two numbered
// options — the agent's suggested answer, or the requester's own words —
// then a short review of every answer before they go back to the agent.
// No skip and no TBD: every answer has to say something.
@Component({
  selector: 'lfx-mktg-run-questions',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './mktg-run-questions.component.html',
})
export class MktgRunQuestionsComponent {
  // === Inputs ===
  /** The questions the agent asked, in its priority order. */
  public readonly questions = input.required<MktgRunQuestion[]>();
  /** The document the answers are for ("Messaging Document"). */
  public readonly documentName = input.required<string>();
  /** The project the document is for. */
  public readonly projectName = input.required<string>();
  /** Answers given in an earlier try (the send failed), by key — they come back as they were. */
  public readonly previousAnswers = input<Record<string, string>>({});
  /** True while the answers are being sent. */
  public readonly busy = input(false);

  // === Outputs ===
  /** Every question's answer, sent together from the review. */
  public readonly answered = output<MktgRunAnswer[]>();

  // === View children ===
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  // === Forms ===
  /** The requester's own words per question — what "Write my own" edits. */
  protected readonly ownForm = new FormGroup<Record<string, AbstractControl<string>>>({});

  // === Signals ===
  /** The question on screen; `questions().length` is the review. */
  protected readonly index = signal(0);
  /** Which option each question is answered with. */
  protected readonly choices = signal<Record<string, MktgRunQuestionChoice>>({});
  /** Questions the requester has moved past at least once — their chips show as answered. */
  private readonly visited = signal<Record<string, boolean>>({});
  /** True once Continue was pressed on an answer that says nothing — the message then shows. */
  protected readonly showError = signal(false);

  // === Computed ===
  private readonly ownValues = toSignal(this.ownForm.valueChanges.pipe(map(() => this.ownForm.getRawValue())), { initialValue: {} as Record<string, string> });
  protected readonly total = computed(() => this.questions().length);
  protected readonly onReview = computed(() => this.index() >= this.total());
  protected readonly current: Signal<QuestionView | null> = this.initCurrent();
  protected readonly currentChoice = computed(() => {
    const current = this.current();
    return current ? (this.choices()[current.key] ?? (current.hasSuggestion ? 'suggested' : 'own')) : 'own';
  });
  protected readonly currentValid = computed(() => {
    const current = this.current();
    return !!current && isFoundationMessageAnswerSubstantive(this.answerFor(current));
  });
  protected readonly chips: Signal<MktgRunQuestionChip[]> = this.initChips();
  protected readonly reviewRows: Signal<MktgRunQuestionReviewRow[]> = this.initReviewRows();
  protected readonly allValid = computed(() => this.reviewRows().every((row) => isFoundationMessageAnswerSubstantive(row.answer)));
  protected readonly notSubstantiveError = MKTG_ANSWER_NOT_SUBSTANTIVE_ERROR;

  private readonly originLabels: Record<MktgRunAnswerOrigin, string> = {
    accepted: 'Suggested answer',
    edited: 'Suggested answer, edited',
    requester: 'Your answer',
  };
  // Literal class names so Tailwind's content scan generates them.
  private readonly chipClasses: Record<MktgRunQuestionChip['state'], string> = {
    current: 'border-blue-300 bg-blue-50 text-blue-700',
    answered: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
    open: 'border-gray-100 bg-white text-gray-400 hover:bg-gray-50',
  };
  protected readonly chipClass = this.chipClasses;

  public constructor() {
    // A new set of questions starts over: one control per question, holding the
    // suggestion (or the earlier try's answer) as the text "Write my own" edits.
    effect(() => {
      const questions = this.questions();
      const previous = this.previousAnswers();
      untracked(() => this.reset(questions, previous));
    });
  }

  // === Protected methods ===
  protected onChoose(choice: MktgRunQuestionChoice): void {
    const current = this.current();
    if (!current || (choice === 'suggested' && !current.hasSuggestion)) {
      return;
    }
    this.choices.update((choices) => ({ ...choices, [current.key]: choice }));
    this.showError.set(false);
    if (choice === 'own') {
      // Give the requester the box to type in straight away.
      setTimeout(() => this.card()?.nativeElement.querySelector('textarea')?.focus());
    }
  }

  protected onNext(): void {
    const current = this.current();
    if (!current) {
      return;
    }
    if (!this.currentValid()) {
      this.showError.set(true);
      return;
    }
    this.visited.update((visited) => ({ ...visited, [current.key]: true }));
    this.goTo(this.index() + 1);
  }

  protected onBack(): void {
    if (this.index() > 0) {
      this.goTo(this.index() - 1);
    }
  }

  /** A chip (or a review row's Edit) jumps to that question. */
  protected onJump(index: number): void {
    this.goTo(index);
  }

  protected onSend(): void {
    if (!this.allValid() || this.busy()) {
      return;
    }
    this.answered.emit(
      this.questions().map((question) => {
        const text = this.answerFor(this.view(question, 0)).trim();
        return { key: question.key, text, origin: foundationMessageAnswerOrigin(text, question.suggestedAnswer) };
      })
    );
  }

  /** Claude Code's keys: 1 and 2 pick an option, Enter continues, Esc goes back. Typing in the box is left alone. */
  protected onKeydown(event: KeyboardEvent): void {
    const inTextarea = event.target instanceof HTMLTextAreaElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onBack();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      // Enter in the box continues too; Shift+Enter is a new line.
      event.preventDefault();
      this.onNext();
      return;
    }
    if (!inTextarea && (event.key === '1' || event.key === '2')) {
      event.preventDefault();
      this.onChoose(event.key === '1' ? 'suggested' : 'own');
    }
  }

  // === Private initializers ===
  private initCurrent(): Signal<QuestionView | null> {
    return computed(() => {
      const question = this.questions()[this.index()];
      return question ? this.view(question, this.index()) : null;
    });
  }

  private initChips(): Signal<MktgRunQuestionChip[]> {
    return computed(() => {
      const visited = this.visited();
      return this.questions().map((question, index) => {
        let state: MktgRunQuestionChip['state'] = visited[question.key] ? 'answered' : 'open';
        if (index === this.index()) {
          state = 'current';
        }
        return { key: question.key, label: mktgRunQuestionShortLabel(question.key, question.label), index, state };
      });
    });
  }

  private initReviewRows(): Signal<MktgRunQuestionReviewRow[]> {
    return computed(() => {
      this.choices();
      this.ownValues();
      return this.questions().map((question, index) => {
        const answer = this.answerFor(this.view(question, index)).trim();
        return {
          key: question.key,
          index,
          label: question.label,
          question: question.question,
          answer,
          originLabel: this.originLabels[foundationMessageAnswerOrigin(answer, question.suggestedAnswer)],
        };
      });
    });
  }

  // === Private helpers ===
  private reset(questions: MktgRunQuestion[], previous: Record<string, string>): void {
    for (const key of Object.keys(this.ownForm.controls)) {
      this.ownForm.removeControl(key);
    }
    const choices: Record<string, MktgRunQuestionChoice> = {};
    for (const question of questions) {
      const earlier = previous[question.key];
      this.ownForm.addControl(question.key, new FormControl(earlier ?? question.suggestedAnswer, { nonNullable: true }));
      choices[question.key] =
        question.suggestedAnswer.trim() && (earlier === undefined || earlier.trim() === question.suggestedAnswer.trim()) ? 'suggested' : 'own';
    }
    this.choices.set(choices);
    this.visited.set({});
    this.index.set(0);
    this.showError.set(false);
  }

  private goTo(index: number): void {
    this.index.set(Math.max(0, Math.min(index, this.total())));
    this.showError.set(false);
    // Keep the keys working on the new card without a click.
    setTimeout(() => this.card()?.nativeElement.focus());
  }

  private view(question: MktgRunQuestion, index: number): QuestionView {
    return {
      ...question,
      index,
      hasSuggestion: question.suggestedAnswer.trim().length > 0,
      basisChips: question.basis.map((entry) => ({ text: this.basisText(entry), href: /^https?:\/\/\S+$/.test(entry) ? entry : null })),
      controlId: `mktg-run-question-${question.key}`,
    };
  }

  /** The answer a question currently holds: the suggestion, or what is in its box. */
  private answerFor(question: QuestionView): string {
    this.ownValues();
    const choice = this.choices()[question.key] ?? (question.hasSuggestion ? 'suggested' : 'own');
    return choice === 'suggested' ? question.suggestedAnswer : (this.ownForm.controls[question.key]?.value ?? '');
  }

  /** A link shown short: its host and path, without the scheme. */
  private basisText(entry: string): string {
    return entry.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }
}
