// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { MentorshipProgramDecisionResult, MentorshipProgramReview, MentorshipUpstreamProgramStatus } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProgramReviewComponent } from './program-review.component';

describe('ProgramReviewComponent', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const review = (status: MentorshipUpstreamProgramStatus = 'pending', overrides: Partial<MentorshipProgramReview> = {}): MentorshipProgramReview => ({
    id: programId,
    name: 'Test Program',
    status,
    projectName: 'Test Foundation',
    description: '<p>Learn the codebase.</p>',
    logoUrl: 'https://logo.example/test.png',
    repoUrl: 'https://github.com/test-org/test-repo/',
    codeOfConductUrl: 'https://test-org.example/coc',
    ciiProjectId: '1234',
    skills: ['go', 'kubernetes'],
    hasDetails: true,
    ...overrides,
  });
  const result = (status: MentorshipUpstreamProgramStatus): MentorshipProgramDecisionResult => ({ id: programId, name: 'Test Program', status });

  let fixture: ComponentFixture<ProgramReviewComponent>;
  let getProgramReview: ReturnType<typeof vi.fn>;
  let submitProgramDecision: ReturnType<typeof vi.fn>;

  const build = (
    options: {
      id?: string;
      decision?: string | null;
      load?: Observable<MentorshipProgramReview>;
      submit?: Observable<MentorshipProgramDecisionResult>;
      paramMap?: Observable<ParamMap>;
      queryParamMap?: Observable<ParamMap>;
    } = {}
  ): void => {
    const {
      id = programId,
      decision = null,
      load = of(review()),
      submit = of(result('published')),
      paramMap = of(convertToParamMap({ programId: id })),
      queryParamMap = of(convertToParamMap(decision === null ? {} : { decision })),
    } = options;
    getProgramReview = vi.fn(() => load);
    submitProgramDecision = vi.fn(() => submit);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramReviewComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MentorshipService, useValue: { getProgramReview, submitProgramDecision } },
        { provide: ActivatedRoute, useValue: { paramMap, queryParamMap } },
      ],
    });

    fixture = TestBed.createComponent(ProgramReviewComponent);
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): HTMLElement | null => element().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string): void => {
    byTestId(id)?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
  };
  const httpError = (status: number): Observable<never> => throwError(() => new HttpErrorResponse({ status }));

  it('shows the program and records nothing when the link is opened', () => {
    build();

    expect(getProgramReview).toHaveBeenCalledWith(programId);
    expect(submitProgramDecision).not.toHaveBeenCalled();
    expect(byTestId('mentorship-program-review-title')?.textContent).toContain('Test Program');
    expect(byTestId('mentorship-program-review-status')?.textContent).toContain('Pending review');
    expect(byTestId('mentorship-program-review-project')?.textContent).toContain('Test Foundation');
    expect(byTestId('mentorship-program-review-logo')?.getAttribute('src')).toBe('https://logo.example/test.png');
    expect(byTestId('mentorship-program-review-skills-count')?.textContent).toContain('2 skills');
    expect(byTestId('mentorship-program-review-choice')).not.toBeNull();
  });

  it('renders the description as sanitized HTML', () => {
    build({ load: of(review('pending', { description: '<p>Learn the codebase.</p><script>alert(1)</script>' })) });

    const description = byTestId('mentorship-program-review-description');
    expect(description?.querySelector('p')?.textContent).toBe('Learn the codebase.');
    expect(description?.querySelector('script')).toBeNull();
  });

  it('links the repository, Code of Conduct and CII project', () => {
    build();

    const repo = byTestId('mentorship-program-review-repo')?.querySelector('a');
    expect(repo?.getAttribute('href')).toBe('https://github.com/test-org/test-repo/');
    expect(repo?.textContent).toContain('github.com/test-org/test-repo');
    expect(byTestId('mentorship-program-review-coc')?.querySelector('a')?.getAttribute('href')).toBe('https://test-org.example/coc');
    const cii = byTestId('mentorship-program-review-cii');
    expect(cii?.querySelector('a')?.getAttribute('href')).toBe('https://www.bestpractices.dev/projects/1234');
    expect(cii?.querySelector('img')?.getAttribute('src')).toBe('https://www.bestpractices.dev/projects/1234/badge');
    expect(cii?.textContent).toContain('Project ID 1234');
  });

  it('falls back to the initial and "Not provided" when optional fields are missing', () => {
    build({
      load: of(
        review('pending', { projectName: null, description: null, logoUrl: null, repoUrl: null, codeOfConductUrl: null, ciiProjectId: null, skills: [] })
      ),
    });

    expect(byTestId('mentorship-program-review-logo')).toBeNull();
    expect(byTestId('mentorship-program-review-logo-initial')?.textContent?.trim()).toBe('T');
    expect(byTestId('mentorship-program-review-project')).toBeNull();
    expect(byTestId('mentorship-program-review-description-empty')).not.toBeNull();
    expect(byTestId('mentorship-program-review-skills-count')?.textContent).toContain('0 skills');
    for (const id of ['repo', 'coc', 'cii']) {
      expect(byTestId(`mentorship-program-review-${id}`)?.textContent).toContain('Not provided');
    }
  });

  it('leaves out the details of a program the catalog does not serve', () => {
    build({ load: of(review('rejected', { hasDetails: false, description: null, skills: [] })) });

    expect(byTestId('mentorship-program-review-details')).toBeNull();
    expect(byTestId('mentorship-program-review-title')?.textContent).toContain('Test Program');
    expect(byTestId('mentorship-program-review-rejected')).not.toBeNull();
  });

  it('records an approval on Approve and shows the outcome', () => {
    build();

    click('mentorship-program-review-approve');

    expect(submitProgramDecision).toHaveBeenCalledWith(programId, 'approve');
    expect(byTestId('mentorship-program-review-approved')?.textContent).toContain('Program approved');
    expect(byTestId('mentorship-program-review-status')?.textContent).toContain('Approved');
    expect(byTestId('mentorship-program-review-choice')).toBeNull();
  });

  it('asks for confirmation before rejecting, and Cancel returns to the choice', () => {
    build();

    click('mentorship-program-review-reject');
    expect(submitProgramDecision).not.toHaveBeenCalled();
    expect(byTestId('mentorship-program-review-reject-step')).not.toBeNull();

    click('mentorship-program-review-reject-cancel');
    expect(byTestId('mentorship-program-review-choice')).not.toBeNull();
  });

  it('moves focus to the reject step when it opens, and back to Reject on Cancel', () => {
    build();

    click('mentorship-program-review-reject');
    TestBed.tick();
    expect(document.activeElement).toBe(byTestId('mentorship-program-review-reject-heading'));

    click('mentorship-program-review-reject-cancel');
    TestBed.tick();
    expect(document.activeElement).toBe(byTestId('mentorship-program-review-reject')?.querySelector('button'));
  });

  it('records a rejection on Reject program and shows the outcome', () => {
    build({ submit: of(result('rejected')) });

    click('mentorship-program-review-reject');
    click('mentorship-program-review-reject-confirm');

    expect(submitProgramDecision).toHaveBeenCalledWith(programId, 'reject');
    expect(byTestId('mentorship-program-review-rejected')?.textContent).toContain('Program rejected');
    expect(byTestId('mentorship-program-review-status')?.textContent).toContain('Rejected');
  });

  it('opens a reject link on the reject step without recording anything', () => {
    build({ decision: 'reject' });

    expect(submitProgramDecision).not.toHaveBeenCalled();
    expect(byTestId('mentorship-program-review-reject-step')).not.toBeNull();
  });

  it.each([['approve'], ['publish']])('opens a link with decision=%s on the choice', (decision) => {
    build({ decision });

    expect(byTestId('mentorship-program-review-choice')).not.toBeNull();
  });

  it('submits once while the decision is in flight', () => {
    const pending = new Subject<MentorshipProgramDecisionResult>();
    build({ submit: pending });

    // Call the handler directly: the buttons are disabled while submitting, so a second click would never reach the guard.
    const component = fixture.componentInstance as unknown as { onDecide(decision: 'approve' | 'reject'): void };
    component.onDecide('approve');
    component.onDecide('approve');
    fixture.detectChanges();

    expect(submitProgramDecision).toHaveBeenCalledTimes(1);
    expect(byTestId('mentorship-program-review-approve')?.getAttribute('data-loading')).toBe('true');
  });

  it('treats a link with a slug as invalid without calling the API', () => {
    build({ id: 'mp_gridflow_fall26' });

    expect(getProgramReview).not.toHaveBeenCalled();
    expect(byTestId('mentorship-program-review-invalid-link')).not.toBeNull();
  });

  it('shows a program that was already decided, without the decision buttons', () => {
    build({ load: of(review('published')) });

    expect(byTestId('mentorship-program-review-choice')).toBeNull();
    expect(byTestId('mentorship-program-review-approved')).not.toBeNull();
  });

  it('shows the raw status when upstream sends one the label map does not know', () => {
    build({ load: of(review('paused' as MentorshipUpstreamProgramStatus)) });

    expect(byTestId('mentorship-program-review-status')?.textContent).toContain('paused');
    expect(byTestId('mentorship-program-review-not-pending')?.textContent).toContain('Current status: paused');
  });

  it.each([
    [400, 'mentorship-program-review-invalid-link'],
    [403, 'mentorship-program-review-forbidden'],
    [404, 'mentorship-program-review-not-found'],
    [500, 'mentorship-program-review-error'],
  ])('maps a %i on load to its own state', (status, testId) => {
    build({ load: httpError(status) });

    expect(byTestId(testId)).not.toBeNull();
  });

  it.each([
    [400, 'mentorship-program-review-invalid-link'],
    [403, 'mentorship-program-review-forbidden'],
    [404, 'mentorship-program-review-not-found'],
  ])('maps a %i on a decision to its own state', (status, testId) => {
    build({ submit: httpError(status) });

    click('mentorship-program-review-approve');

    expect(byTestId(testId)).not.toBeNull();
  });

  it('reloads the program after a 409 and says another reviewer decided first', () => {
    build({ submit: httpError(409) });
    getProgramReview.mockReturnValue(of(review('rejected')));

    click('mentorship-program-review-approve');

    expect(getProgramReview).toHaveBeenCalledTimes(2);
    expect(byTestId('mentorship-program-review-conflict')?.textContent).toContain('Another reviewer decided this program before you.');
    expect(byTestId('mentorship-program-review-rejected')).not.toBeNull();
  });

  it('keeps the program after a 409 whose status read fails, and Refresh status reads it again', () => {
    build({ submit: httpError(409) });
    getProgramReview.mockReturnValue(httpError(503));

    click('mentorship-program-review-approve');

    expect(byTestId('mentorship-program-review-stale')?.textContent).toContain("its latest status couldn't be loaded");
    expect(byTestId('mentorship-program-review-title')?.textContent).toContain('Test Program');
    expect(byTestId('mentorship-program-review-choice')).toBeNull();
    expect(byTestId('mentorship-program-review-reject-step')).toBeNull();

    getProgramReview.mockReturnValue(of(review('rejected', { hasDetails: false })));
    click('mentorship-program-review-refresh');

    expect(getProgramReview).toHaveBeenCalledTimes(3);
    expect(byTestId('mentorship-program-review-stale')).toBeNull();
    expect(byTestId('mentorship-program-review-conflict')).not.toBeNull();
    expect(byTestId('mentorship-program-review-rejected')).not.toBeNull();
  });

  it('lets an access error on the status read after a 409 take over the page', () => {
    build({ submit: httpError(409) });
    getProgramReview.mockReturnValue(httpError(403));

    click('mentorship-program-review-approve');

    expect(byTestId('mentorship-program-review-forbidden')).not.toBeNull();
  });

  it('keeps the program on screen after a failed decision, and trying again submits again', () => {
    build({ submit: httpError(502) });

    click('mentorship-program-review-approve');

    expect(byTestId('mentorship-program-review-failed')?.textContent).toContain('The decision was not recorded');
    expect(byTestId('mentorship-program-review-choice')).not.toBeNull();

    submitProgramDecision.mockReturnValueOnce(of(result('published')));
    click('mentorship-program-review-approve');

    expect(submitProgramDecision).toHaveBeenCalledTimes(2);
    expect(byTestId('mentorship-program-review-failed')).toBeNull();
    expect(byTestId('mentorship-program-review-approved')).not.toBeNull();
  });

  it('loads a new link only after an in-flight decision settles, without showing its result', () => {
    const otherId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const params = new BehaviorSubject(convertToParamMap({ programId }));
    const pending = new Subject<MentorshipProgramDecisionResult>();
    build({ paramMap: params, submit: pending });

    click('mentorship-program-review-approve');
    params.next(convertToParamMap({ programId: otherId }));
    fixture.detectChanges();

    // The POST keeps running (its write may already be upstream) and the new link waits for it.
    expect(pending.observed).toBe(true);
    expect(getProgramReview).toHaveBeenCalledTimes(1);
    expect(byTestId('mentorship-program-review-loading')).not.toBeNull();

    pending.next(result('published'));
    pending.complete();
    fixture.detectChanges();

    expect(getProgramReview).toHaveBeenLastCalledWith(otherId);
    expect(byTestId('mentorship-program-review-approved')).toBeNull();
    expect(byTestId('mentorship-program-review-choice')).not.toBeNull();
  });

  it('shows the recorded status when the decision changes while a decision is in flight', () => {
    const query = new BehaviorSubject(convertToParamMap({ decision: 'approve' }));
    const pending = new Subject<MentorshipProgramDecisionResult>();
    build({ queryParamMap: query, submit: pending });
    getProgramReview.mockReturnValue(of(review('published')));

    click('mentorship-program-review-approve');
    query.next(convertToParamMap({ decision: 'reject' }));
    pending.next(result('published'));
    pending.complete();
    fixture.detectChanges();

    expect(getProgramReview).toHaveBeenCalledTimes(2);
    expect(byTestId('mentorship-program-review-approved')).not.toBeNull();
  });
});
