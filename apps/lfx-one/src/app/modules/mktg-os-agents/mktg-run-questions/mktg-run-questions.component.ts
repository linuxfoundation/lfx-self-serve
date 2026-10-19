// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, effect, input, output, Signal, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { FOUNDATION_MESSAGE_ANSWER_MAX_CHARS, MKTG_ANSWER_NOT_SUBSTANTIVE_ERROR, MKTG_ANSWER_TOO_LONG_ERROR } from '@lfx-one/shared/constants';
import { MktgRunAnswer, MktgRunQuestion, MktgRunQuestionChip } from '@lfx-one/shared/interfaces';
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

// The agent's questions, one at a time: a short chip per question across the
// top, then a card with the question, why the agent asks, where its
// suggestion comes from, and one box already holding the suggested answer to
// keep or edit. The last question's button sends every answer back on the
// same run. No skip and no TBD: every answer has to say something.
@Component({
  selector: 'lfx-mktg-run-questions',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './mktg-run-questions.component.html',
})
export class MktgRunQuestionsComponent {
  // === Inputs ===
  /** The questions the agent asked, in its priority order. */
  public readonly questions = input.required<MktgRunQuestion[]>();
  /** The project the document is for. */
  public readonly projectName = input.required<string>();
  /** Answers given in an earlier try (the send failed), by key — they come back as they were. */
  public readonly previousAnswers = input<Record<string, string>>({});
  /** True while the answers are being sent. */
  public readonly busy = input(false);

  // === Outputs ===
  /** Every question's answer, sent together from the last question. */
  public readonly answered = output<MktgRunAnswer[]>();

  // === Forms ===
  /** One box per question, holding the suggested answer until the requester changes it. */
  protected readonly answersForm = new FormGroup<Record<string, AbstractControl<string>>>({});

  // === Signals ===
  /** The question on screen. */
  protected readonly index = signal(0);
  /** Questions the requester has moved past at least once — their chips show as answered. */
  private readonly visited = signal<Record<string, boolean>>({});
  /** True once Continue was pressed on an answer that says nothing — the message then shows. */
  protected readonly showError = signal(false);

  // === Computed ===
  private readonly values = toSignal(this.answersForm.valueChanges.pipe(map(() => this.answersForm.getRawValue())), {
    initialValue: {} as Record<string, string>,
  });
  protected readonly total = computed(() => this.questions().length);
  protected readonly current: Signal<QuestionView | null> = this.initCurrent();
  protected readonly isLast = computed(() => this.index() === this.total() - 1);
  /** What is wrong with the answer on screen, or nothing. */
  protected readonly currentError = computed(() => {
    const current = this.current();
    if (!current) {
      return MKTG_ANSWER_NOT_SUBSTANTIVE_ERROR;
    }
    return this.answerError(this.values()[current.key] ?? this.answersForm.controls[current.key]?.value ?? '');
  });
  protected readonly currentValid = computed(() => this.currentError() === '');
  protected readonly chips: Signal<MktgRunQuestionChip[]> = this.initChips();

  // Literal class names so Tailwind's content scan generates them.
  protected readonly chipClass: Record<MktgRunQuestionChip['state'], string> = {
    current: 'border-blue-300 bg-blue-50 text-blue-700',
    answered: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
    open: 'border-gray-100 bg-white text-gray-400 hover:bg-gray-50',
  };

  public constructor() {
    // A new set of questions starts over: one box per question, holding the
    // suggestion (or the earlier try's answer).
    effect(() => {
      const questions = this.questions();
      const previous = this.previousAnswers();
      untracked(() => this.reset(questions, previous));
    });
  }

  // === Protected methods ===
  /** Continue to the next question, or, on the last one, send every answer. */
  protected onNext(): void {
    const current = this.current();
    if (!current || this.busy()) {
      return;
    }
    if (!this.currentValid()) {
      this.showError.set(true);
      return;
    }
    this.visited.update((visited) => ({ ...visited, [current.key]: true }));
    if (!this.isLast()) {
      this.goTo(this.index() + 1);
      return;
    }
    // Every answer has to stand before they go: an earlier one may have been emptied after a jump back.
    const firstFailing = this.questions().findIndex((question) => this.answerError(this.answersForm.controls[question.key]?.value ?? '') !== '');
    if (firstFailing >= 0) {
      this.goTo(firstFailing);
      this.showError.set(true);
      return;
    }
    this.answered.emit(
      this.questions().map((question) => {
        const text = (this.answersForm.controls[question.key]?.value ?? '').trim();
        return { key: question.key, text, origin: foundationMessageAnswerOrigin(text, question.suggestedAnswer) };
      })
    );
  }

  protected onBack(): void {
    if (this.index() > 0) {
      this.goTo(this.index() - 1);
    }
  }

  /** A chip jumps to its question. */
  protected onJump(index: number): void {
    this.goTo(index);
  }

  // === Private initializers ===
  private initCurrent(): Signal<QuestionView | null> {
    return computed(() => {
      const question = this.questions()[this.index()];
      if (!question) {
        return null;
      }
      return {
        ...question,
        index: this.index(),
        hasSuggestion: question.suggestedAnswer.trim().length > 0,
        basisChips: question.basis.map((entry) => ({
          text: entry.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
          href: /^https?:\/\/\S+$/.test(entry) ? entry : null,
        })),
        controlId: `mktg-run-question-${question.key}`,
      };
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

  // === Private helpers ===
  /**
   * Why an answer would be refused — the two rules the BFF applies to the
   * answers turn (`validateFoundationMessageAnswers`), on the trimmed text
   * that is sent — or '' when it stands.
   */
  private answerError(text: string): string {
    if (!isFoundationMessageAnswerSubstantive(text)) {
      return MKTG_ANSWER_NOT_SUBSTANTIVE_ERROR;
    }
    if (text.trim().length > FOUNDATION_MESSAGE_ANSWER_MAX_CHARS) {
      return MKTG_ANSWER_TOO_LONG_ERROR;
    }
    return '';
  }

  private reset(questions: MktgRunQuestion[], previous: Record<string, string>): void {
    for (const key of Object.keys(this.answersForm.controls)) {
      this.answersForm.removeControl(key);
    }
    for (const question of questions) {
      this.answersForm.addControl(question.key, new FormControl(previous[question.key] ?? question.suggestedAnswer, { nonNullable: true }));
    }
    this.visited.set({});
    this.index.set(0);
    this.showError.set(false);
  }

  private goTo(index: number): void {
    this.index.set(Math.max(0, Math.min(index, this.total() - 1)));
    this.showError.set(false);
  }
}
