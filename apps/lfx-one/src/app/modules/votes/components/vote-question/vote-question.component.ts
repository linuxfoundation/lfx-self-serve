// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { CodePointLengthPipe } from '@pipes/code-point-length.pipe';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { VOTE_COMMENT_PROMPT_MAX_COUNT, VOTE_COMMENT_PROMPT_MAX_LENGTH, VOTE_LABEL, VOTE_RESPONSE_TYPES } from '@lfx-one/shared/constants';
import { CommentPromptFormData, QuestionFormData } from '@lfx-one/shared/interfaces';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'lfx-vote-question',
  imports: [ReactiveFormsModule, TextareaComponent, SelectComponent, ButtonComponent, InputTextModule, CodePointLengthPipe],
  templateUrl: './vote-question.component.html',
})
export class VoteQuestionComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);
  public readonly createQuestionFormGroup = input.required<() => FormGroup>();
  public readonly createCommentPromptFormGroup = input.required<() => FormGroup>();

  // Constants
  public readonly voteLabel = VOTE_LABEL;
  public readonly responseTypeOptions = [...VOTE_RESPONSE_TYPES];
  public readonly commentPromptMaxLength = VOTE_COMMENT_PROMPT_MAX_LENGTH;
  public readonly commentPromptMaxCount = VOTE_COMMENT_PROMPT_MAX_COUNT;

  // Computed signals for form arrays
  public readonly questionsArray: Signal<FormArray<FormGroup>> = this.initQuestionsArray();
  public readonly questionsData: Signal<QuestionFormData[]> = this.initQuestionsData();
  public readonly commentPromptsArray: Signal<FormArray<FormGroup>> = this.initCommentPromptsArray();
  public readonly commentPromptsData: Signal<CommentPromptFormData[]> = this.initCommentPromptsData();

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

  /**
   * Add a new comment prompt to the comment prompts array
   */
  public addCommentPrompt(): void {
    if (this.commentPromptsArray().length >= this.commentPromptMaxCount) {
      return;
    }
    const newCommentPromptGroup = this.createCommentPromptFormGroup()();
    this.commentPromptsArray().push(newCommentPromptGroup);
  }

  /**
   * Remove a comment prompt from the comment prompts array
   */
  public removeCommentPrompt(promptIndex: number): void {
    this.commentPromptsArray().removeAt(promptIndex);
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

  private initCommentPromptsArray(): Signal<FormArray<FormGroup>> {
    return computed(() => {
      // Access formValue to trigger reactivity when comment prompts are added/removed
      this.formValue()();
      return this.form().get('commentPrompts') as FormArray<FormGroup>;
    });
  }

  private initCommentPromptsData(): Signal<CommentPromptFormData[]> {
    return computed(() => {
      // Access formValue to trigger reactivity
      this.formValue()();
      const commentPromptsArr = this.form().get('commentPrompts') as FormArray<FormGroup>;
      return commentPromptsArr.controls.map((group) => ({
        group,
        promptControl: group.get('prompt') as AbstractControl,
      }));
    });
  }
}
