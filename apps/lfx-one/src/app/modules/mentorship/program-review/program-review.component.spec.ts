// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { MentorshipProgramReview, MentorshipUpstreamProgramStatus } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProgramReviewComponent } from './program-review.component';

describe('ProgramReviewComponent', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const review = (status: MentorshipUpstreamProgramStatus = 'pending'): MentorshipProgramReview => ({ id: programId, name: 'Test Program', status });

  let fixture: ComponentFixture<ProgramReviewComponent>;
  let getProgramReview: ReturnType<typeof vi.fn>;
  let submitProgramDecision: ReturnType<typeof vi.fn>;

  const build = (
    options: { id?: string; decision?: string | null; load?: Observable<MentorshipProgramReview>; submit?: Observable<MentorshipProgramReview> } = {}
  ): void => {
    const { id = programId, decision = 'approve', load = of(review()), submit = of(review('published')) } = options;
    getProgramReview = vi.fn(() => load);
    submitProgramDecision = vi.fn(() => submit);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramReviewComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MentorshipService, useValue: { getProgramReview, submitProgramDecision } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ programId: id })),
            queryParamMap: of(convertToParamMap(decision === null ? {} : { decision })),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(ProgramReviewComponent);
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): HTMLElement | null => element().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const clickConfirm = (): void => {
    byTestId('mentorship-program-review-confirm-button')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
  };
  const httpError = (status: number): Observable<never> => throwError(() => new HttpErrorResponse({ status }));

  it('asks for confirmation and records nothing when the link is opened', () => {
    build();

    expect(getProgramReview).toHaveBeenCalledWith(programId);
    expect(submitProgramDecision).not.toHaveBeenCalled();
    expect(byTestId('mentorship-program-review-title')?.textContent).toContain('Approve this program?');
    expect(byTestId('mentorship-program-review-program-name')?.textContent).toContain('Test Program');
  });

  it('records the decision on Confirm and shows the outcome', () => {
    build();

    clickConfirm();

    expect(submitProgramDecision).toHaveBeenCalledWith(programId, 'approve');
    expect(byTestId('mentorship-program-review-success')?.textContent).toContain('Program approved');
  });

  it('confirms a reject link with a Reject button', () => {
    build({ decision: 'reject', submit: of(review('rejected')) });

    expect(byTestId('mentorship-program-review-title')?.textContent).toContain('Reject this program?');
    clickConfirm();

    expect(submitProgramDecision).toHaveBeenCalledWith(programId, 'reject');
    expect(byTestId('mentorship-program-review-success')?.textContent).toContain('Program rejected');
  });

  it('submits once while the decision is in flight', () => {
    const pending = new Subject<MentorshipProgramReview>();
    build({ submit: pending });

    clickConfirm();
    clickConfirm();

    expect(submitProgramDecision).toHaveBeenCalledTimes(1);
    expect(byTestId('mentorship-program-review-confirm-button')?.getAttribute('data-loading')).toBe('true');
  });

  it.each([
    ['a slug', { id: 'mp_gridflow_fall26' }],
    ['no decision', { decision: null }],
    ['an unknown decision', { decision: 'publish' }],
  ])('treats a link with %s as invalid without calling the API', (_label, options) => {
    build(options);

    expect(getProgramReview).not.toHaveBeenCalled();
    expect(byTestId('mentorship-program-review-invalid-link')).not.toBeNull();
  });

  it('shows the current status when the program was already decided', () => {
    build({ load: of(review('published')) });

    expect(byTestId('mentorship-program-review-confirm')).toBeNull();
    expect(byTestId('mentorship-program-review-already-decided')?.textContent).toContain('current status: Approved');
  });

  it.each([
    [403, 'mentorship-program-review-forbidden'],
    [404, 'mentorship-program-review-not-found'],
    [500, 'mentorship-program-review-error'],
  ])('maps a %i on load to its own state', (status, testId) => {
    build({ load: httpError(status) });

    expect(byTestId(testId)).not.toBeNull();
  });

  it('explains a 409 on Confirm as another reviewer deciding first', () => {
    build({ submit: httpError(409) });

    clickConfirm();

    expect(byTestId('mentorship-program-review-already-decided')?.textContent).toContain('Another reviewer decided this program');
  });

  it('returns to the confirm card when Try again follows a failed Confirm', () => {
    build({ submit: httpError(502) });

    clickConfirm();
    byTestId('mentorship-program-review-error')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();

    expect(byTestId('mentorship-program-review-confirm')).not.toBeNull();
  });
});
