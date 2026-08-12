// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { VOTE_COMMENT_RESPONSE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteBallotInlineComponent } from './vote-ballot-inline.component';

/**
 * Covers the comment-prompt surface added by LFXV2-2562: prompt rendering, the code-point length
 * cap (the emoji/UTF-16 regression — a non-BMP character must count once in both the validator and
 * the counter), and that comments still submit while abstaining. VoteService and MessageService
 * are mocked; the form wiring under test is the component's real FormGroups.
 */
describe('VoteBallotInlineComponent — comment prompts (LFXV2-2562)', () => {
  let fixture: ComponentFixture<VoteBallotInlineComponent>;
  let component: VoteBallotInlineComponent;
  let submitMyResponse: ReturnType<typeof vi.fn>;

  const VOTE: Vote = {
    uid: 'vote-1',
    name: 'Test vote',
    status: PollStatus.ACTIVE,
    project_uid: 'project-1',
    end_time: '2099-01-01T00:00:00Z',
    allow_abstain: true,
    poll_questions: [
      {
        question_id: 'q1',
        prompt: 'Approve the budget?',
        type: 'single_choice',
        choices: [
          { choice_id: 'c1', choice_text: 'Yes' },
          { choice_id: 'c2', choice_text: 'No' },
        ],
      },
    ],
    poll_comment_prompts: [{ prompt_id: 'p1', prompt: 'Any comments?' }],
  } as Vote;

  beforeEach(async () => {
    submitMyResponse = vi.fn(() => of(undefined));

    await TestBed.configureTestingModule({
      imports: [VoteBallotInlineComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { submitMyResponse } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VoteBallotInlineComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('vote', VOTE);
    await fixture.whenStable();
  });

  function commentControl(): FormControl<string> {
    const control = component.commentForm.get('p1') as FormControl<string> | null;
    if (!control) throw new Error('comment control for prompt p1 was not created');
    return control;
  }

  /** Clicks the rendered submit button (onSubmit is protected; the DOM is the honest entry point). */
  function clickSubmit(): void {
    const submit = fixture.nativeElement.querySelector('[data-testid="dashboard-pending-actions-vote-submit"] button') as HTMLButtonElement | null;
    if (!submit) throw new Error('submit button not rendered');
    submit.click();
  }

  it('creates a comment control per prompt and renders the prompt label', () => {
    expect(commentControl().value).toBe('');
    expect(fixture.nativeElement.querySelector('[data-test="dashboard-pending-actions-vote-comment-textarea-p1"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Any comments?');
  });

  it('enforces the response cap by code points, not UTF-16 units', () => {
    const control = commentControl();

    // 4,999 ASCII + 2 emoji = 5,001 code points (5,003 UTF-16 units) — over the 5,000 cap
    control.setValue('a'.repeat(VOTE_COMMENT_RESPONSE_MAX_LENGTH - 1) + '😀😀');
    expect(control.invalid).toBe(true);

    // Exactly 5,000 code points including non-BMP chars — valid (a UTF-16-unit count would reject it)
    control.setValue('a'.repeat(VOTE_COMMENT_RESPONSE_MAX_LENGTH - 2) + '😀😀');
    expect(control.valid).toBe(true);
  });

  it('counts emoji once in the character counter', () => {
    commentControl().setValue('😀😀');
    fixture.detectChanges();

    const counter = fixture.nativeElement.querySelector('[data-testid="dashboard-pending-actions-vote-comment-counter-p1"]');
    expect(counter.textContent.trim()).toBe(`2/${VOTE_COMMENT_RESPONSE_MAX_LENGTH}`);
  });

  it('blocks submit while a comment is over the cap', () => {
    commentControl().setValue('a'.repeat(VOTE_COMMENT_RESPONSE_MAX_LENGTH + 1));
    fixture.detectChanges();

    const submit = fixture.nativeElement.querySelector('[data-testid="dashboard-pending-actions-vote-submit"] button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('submits trimmed comments even when abstaining', async () => {
    component.abstainControl.setValue(true);
    commentControl().setValue('  looks good to me  ');
    await fixture.whenStable();

    clickSubmit();

    expect(submitMyResponse).toHaveBeenCalledWith('vote-1', {
      abstain: true,
      userVoteContent: undefined,
      commentResponses: [{ prompt_id: 'p1', comment_text: 'looks good to me' }],
    });
  });

  it('omits empty comments from the submission', async () => {
    component.abstainControl.setValue(true);
    commentControl().setValue('   ');
    await fixture.whenStable();

    clickSubmit();

    expect(submitMyResponse).toHaveBeenCalledWith('vote-1', {
      abstain: true,
      userVoteContent: undefined,
      commentResponses: undefined,
    });
  });
});
