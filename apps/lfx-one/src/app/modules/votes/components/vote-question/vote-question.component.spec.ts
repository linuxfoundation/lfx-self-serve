// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PollType } from '@lfx-one/shared/enums';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VoteQuestionComponent } from './vote-question.component';

describe('VoteQuestionComponent — ranked methods (#2921)', () => {
  let fixture: ComponentFixture<VoteQuestionComponent>;
  let form: FormGroup;

  const element = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  const createQuestionFormGroup = (): FormGroup =>
    new FormGroup({
      question: new FormControl('Who should chair the board?', [trimmedRequired()]),
      response_type: new FormControl<'single' | 'multiple'>('single', [Validators.required]),
      options: new FormArray([new FormControl('Alice', { nonNullable: true }), new FormControl('Bob', { nonNullable: true })], [Validators.minLength(2)]),
    });

  async function render(pollType: PollType): Promise<void> {
    form = new FormGroup({
      poll_type: new FormControl(pollType),
      questions: new FormArray([createQuestionFormGroup()]),
      commentPrompts: new FormArray([]),
    });
    const version = signal(0);
    form.valueChanges.subscribe(() => version.update((value) => value + 1));
    const formValue = computed(() => {
      version();
      return form.getRawValue() as Record<string, unknown>;
    });

    fixture = TestBed.createComponent(VoteQuestionComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('formValue', formValue);
    fixture.componentRef.setInput('createQuestionFormGroup', createQuestionFormGroup);
    fixture.componentRef.setInput('createCommentPromptFormGroup', () => new FormGroup({ prompt: new FormControl('') }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VoteQuestionComponent], providers: [provideNoopAnimations()] });
  });

  afterEach(() => fixture?.destroy());

  it('shows Response Type for a plurality vote', async () => {
    await render(PollType.GENERIC);

    expect(element('vote-response-type-select-0')).not.toBeNull();
    expect(element('vote-ranked-note-0')).toBeNull();
  });

  it('replaces Response Type with the ranking note for Condorcet IRV', async () => {
    await render(PollType.CONDORCET_IRV);

    expect(element('vote-response-type-select-0')).toBeNull();
    expect(element('vote-ranked-note-0')?.textContent?.trim()).toBe('Voters rank these options in order of preference.');
  });

  it('follows a method change made in Step 1', async () => {
    await render(PollType.GENERIC);

    form.get('poll_type')?.setValue(PollType.CONDORCET_IRV);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element('vote-ranked-note-0')).not.toBeNull();
  });

  it('keeps the two-option minimum for ranked questions', async () => {
    await render(PollType.CONDORCET_IRV);

    fixture.componentInstance.removeOption(0, 1);

    const options = fixture.componentInstance.questionsArray().at(0).get('options') as FormArray;
    expect(options.length).toBe(2);
    expect(element('vote-option-remove-0-0')).toBeNull();
  });
});
