// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { UserService } from '@services/user.service';
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
  const impersonating = signal(false);

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
    impersonating.set(false);

    await TestBed.configureTestingModule({
      imports: [VoteBallotInlineComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { submitMyResponse } },
        { provide: UserService, useValue: { impersonating } },
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

  it('explains read-only Admin Mode and refuses direct submission without side effects', async () => {
    impersonating.set(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="dashboard-pending-actions-vote-readonly"]')?.textContent).toContain('Ballots are read-only');
    expect(fixture.nativeElement.querySelector('[data-testid="dashboard-pending-actions-vote-submit"]')).toBeNull();
    component.abstainControl.setValue(true);
    component['onSubmit']();
    expect(submitMyResponse).not.toHaveBeenCalled();
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

/**
 * #4148: the inline ballot follows the cast drawer's phone rules — stacked choices, 44px rows,
 * full-width footer actions with Submit ahead of Cancel. The BreakpointObserver is mocked since
 * jsdom has no matchMedia.
 */
describe('VoteBallotInlineComponent — mobile layout (#4148)', () => {
  let fixture: ComponentFixture<VoteBallotInlineComponent>;

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
  } as Vote;

  async function render(matches: boolean, vote: Vote = VOTE): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [VoteBallotInlineComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches, breakpoints: {} }), isMatched: () => matches } },
        { provide: VoteService, useValue: { submitMyResponse: vi.fn(() => of(undefined)) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteBallotInlineComponent);
    fixture.componentRef.setInput('vote', vote);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('gives choice rows and footer buttons 44px targets on phones only', async () => {
    await render(true);
    expect(q('dashboard-pending-actions-vote-choice-c1')?.querySelector('[class*="min-h-[44px]"]')).toBeTruthy();
    expect(q('dashboard-pending-actions-vote-abstain-label')?.className).toContain('min-h-[44px]');
    expect(q('dashboard-pending-actions-vote-submit')?.querySelector('button')?.className).toContain('min-h-[44px]');
    expect(q('dashboard-pending-actions-vote-cancel')?.querySelector('button')?.className).toContain('min-h-[44px]');
    expect(q('dashboard-pending-actions-vote-submit')?.querySelector('button')?.className).toContain('p-button-fluid');
    expect(q('dashboard-pending-actions-vote-cancel')?.querySelector('button')?.className).toContain('p-button-fluid');

    await render(false);
    expect(q('dashboard-pending-actions-vote-choice-c1')?.querySelector('[class*="min-h-[44px]"]')).toBeNull();
    expect(q('dashboard-pending-actions-vote-submit')?.querySelector('button')?.className).not.toContain('min-h-[44px]');
    expect(q('dashboard-pending-actions-vote-submit')?.querySelector('button')?.className).not.toContain('p-button-fluid');
  });

  it('stacks choices vertically and puts Submit ahead of Cancel below sm', async () => {
    await render(true);
    const footer = q('dashboard-pending-actions-vote-footer') as HTMLElement;
    expect(footer.className).toContain('flex-col');
    expect(footer.className).toContain('sm:flex-row');
    // Submit precedes Cancel in the DOM (focus order matches the phone layout); no CSS order is used.
    const submit = q('dashboard-pending-actions-vote-submit')!;
    const cancel = q('dashboard-pending-actions-vote-cancel')!;
    expect(submit.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.className).not.toContain('order-');
    expect(cancel.className).not.toContain('order-');
    expect(submit.parentElement?.className).toContain('sm:flex-row-reverse');
    const choices = q('dashboard-pending-actions-vote-choice-c1')?.parentElement as HTMLElement;
    expect(choices.className).toContain('flex-col');
    expect(choices.className).toContain('sm:flex-row');
  });

  it('renders multiple-choice checkbox rows as 44px labels on phones', async () => {
    await render(true, { ...VOTE, poll_questions: [{ ...VOTE.poll_questions![0], type: 'multiple_choice' }] } as Vote);
    expect(q('dashboard-pending-actions-vote-choice-c1')?.className).toContain('min-h-[44px]');
  });

  it('selects a choice when its label is clicked, not only the radio circle (phone rows)', async () => {
    await render(true);
    const labels = (): HTMLLabelElement[] =>
      Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="dashboard-pending-actions-vote-choice-"] label'));

    expect(labels()).toHaveLength(2);
    // The label is stretched over the 44px row (::after inset-0 on a relative row), so it is the tap target.
    expect(labels()[1].className).toContain('after:inset-0');
    expect(labels()[1].parentElement?.className).toContain('relative');

    labels()[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.form.get('q1')?.value).toBe('c2');
    const radios = Array.from(fixture.nativeElement.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);

    labels()[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.form.get('q1')?.value).toBe('c1');
  });

  it('toggles a multiple-choice option when its label is clicked on phones', async () => {
    await render(true, { ...VOTE, poll_questions: [{ ...VOTE.poll_questions![0], type: 'multiple_choice' }] } as Vote);
    const label = fixture.nativeElement.querySelector('[data-testid="dashboard-pending-actions-vote-choice-c2"]') as HTMLLabelElement;

    label.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['c2']);
  });
});
