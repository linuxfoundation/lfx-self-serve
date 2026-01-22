// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, LowerCasePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { COMMITTEE_LABEL, VOTE_ELIGIBLE_PARTICIPANTS, VOTE_LABEL, VOTE_RESPONSE_TYPES } from '@lfx-one/shared/constants';
import { CommitteeReference, VoteReviewQuestion } from '@lfx-one/shared/interfaces';
import { filter, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-vote-review',
  imports: [ReactiveFormsModule, ButtonComponent, DatePipe, LowerCasePipe],
  templateUrl: './vote-review.component.html',
})
export class VoteReviewComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly isEditMode = input<boolean>(false);

  // Outputs
  public readonly editStep = output<number>();

  // Constants
  public readonly committeeLabel = COMMITTEE_LABEL;
  public readonly voteLabel = VOTE_LABEL;
  public readonly eligibleParticipantsOptions = [...VOTE_ELIGIBLE_PARTICIPANTS];
  public readonly responseTypeOptions = [...VOTE_RESPONSE_TYPES];

  // Form value derived from form input
  public readonly formValue: Signal<Record<string, unknown>> = this.initFormValue();

  // Computed signals for review data
  public readonly title: Signal<string> = this.initTitle();
  public readonly description: Signal<string> = this.initDescription();
  public readonly committee: Signal<CommitteeReference | null> = this.initCommittee();
  public readonly eligibleParticipants: Signal<string> = this.initEligibleParticipants();
  public readonly eligibleParticipantsLabel: Signal<string> = this.initEligibleParticipantsLabel();
  public readonly closeDate: Signal<Date | null> = this.initCloseDate();
  public readonly questions: Signal<VoteReviewQuestion[]> = this.initQuestions();

  // Public methods
  public onEditStep(step: number): void {
    this.editStep.emit(step);
  }

  public getResponseTypeLabel(value: string): string {
    const option = this.responseTypeOptions.find((opt) => opt.value === value);
    return option ? option.label : value;
  }

  // Private initializer functions
  private initFormValue(): Signal<Record<string, unknown>> {
    return toSignal(
      toObservable(this.form).pipe(
        filter((form): form is FormGroup => !!form),
        switchMap((form) => form.valueChanges)
      ),
      { initialValue: {} }
    );
  }

  private initTitle(): Signal<string> {
    return computed(() => {
      this.formValue();
      return this.form().get('title')?.value || '';
    });
  }

  private initDescription(): Signal<string> {
    return computed(() => {
      this.formValue();
      return this.form().get('description')?.value || '';
    });
  }

  private initCommittee(): Signal<CommitteeReference | null> {
    return computed(() => {
      this.formValue();
      return this.form().get('committee')?.value || null;
    });
  }

  private initEligibleParticipants(): Signal<string> {
    return computed(() => {
      this.formValue();
      return this.form().get('eligible_participants')?.value || '';
    });
  }

  private initEligibleParticipantsLabel(): Signal<string> {
    return computed(() => {
      const value = this.eligibleParticipants();
      const option = this.eligibleParticipantsOptions.find((opt) => opt.value === value);
      return option ? option.label : value;
    });
  }

  private initCloseDate(): Signal<Date | null> {
    return computed(() => {
      this.formValue();
      return this.form().get('close_date')?.value || null;
    });
  }

  private initQuestions(): Signal<VoteReviewQuestion[]> {
    return computed(() => {
      this.formValue();
      const questionsArray = this.form().get('questions') as FormArray<FormGroup>;
      if (!questionsArray) {
        return [];
      }

      return questionsArray.controls.map((questionGroup, index) => {
        const options = (questionGroup.get('options') as FormArray).controls.map((control) => control.value as string).filter((opt) => opt.trim() !== '');

        return {
          index: index + 1,
          question: questionGroup.get('question')?.value || '',
          responseType: questionGroup.get('response_type')?.value || 'single',
          options,
        };
      });
    });
  }
}
