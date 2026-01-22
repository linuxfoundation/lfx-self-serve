// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { VOTE_LABEL, VOTE_RESPONSE_TYPES } from '@lfx-one/shared/constants';
import { QuestionFormData } from '@lfx-one/shared/interfaces';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'lfx-vote-question',
  imports: [ReactiveFormsModule, TextareaComponent, SelectComponent, ButtonComponent, InputTextModule],
  templateUrl: './vote-question.component.html',
})
export class VoteQuestionComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);
  public readonly createQuestionFormGroup = input.required<() => FormGroup>();

  // Constants
  public readonly voteLabel = VOTE_LABEL;
  public readonly responseTypeOptions = [...VOTE_RESPONSE_TYPES];

  // Computed signals for form arrays
  public readonly questionsArray: Signal<FormArray<FormGroup>> = this.initQuestionsArray();
  public readonly questionsData: Signal<QuestionFormData[]> = this.initQuestionsData();

  /**
   * Add a new question to the questions array
   */
  public addQuestion(): void {
    const newQuestionGroup = this.createQuestionFormGroup()();
    this.questionsArray().push(newQuestionGroup);
  }

  /**
   * Remove a question from the questions array
   */
  public removeQuestion(questionIndex: number): void {
    if (this.questionsArray().length > 1) {
      this.questionsArray().removeAt(questionIndex);
    }
  }

  /**
   * Add a new option to a specific question's options array
   */
  public addOption(questionIndex: number): void {
    const optionsArray = this.questionsArray().at(questionIndex).get('options') as FormArray<FormControl<string>>;
    optionsArray.push(new FormControl('', { validators: [trimmedRequired()], nonNullable: true }) as FormControl<string>);
  }

  /**
   * Remove an option from a specific question's options array
   */
  public removeOption(questionIndex: number, optionIndex: number): void {
    const optionsArray = this.questionsArray().at(questionIndex).get('options') as FormArray<FormControl<string>>;
    if (optionsArray.length > 2) {
      optionsArray.removeAt(optionIndex);
    }
  }

  // Private initializer functions
  private initQuestionsArray(): Signal<FormArray<FormGroup>> {
    return computed(() => {
      // Access formValue to trigger reactivity when questions are added/removed
      this.formValue()();
      return this.form().get('questions') as FormArray<FormGroup>;
    });
  }

  private initQuestionsData(): Signal<QuestionFormData[]> {
    return computed(() => {
      // Access formValue to trigger reactivity
      this.formValue()();
      const questionsArr = this.form().get('questions') as FormArray<FormGroup>;
      return questionsArr.controls.map((group) => ({
        group,
        questionControl: group.get('question') as AbstractControl,
        responseTypeControl: group.get('response_type') as AbstractControl,
        optionsControls: (group.get('options') as FormArray).controls,
      }));
    });
  }
}
