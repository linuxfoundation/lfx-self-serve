// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX, MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplication, MentorshipMenteeApplicationsResponse } from '@lfx-one/shared/interfaces';
import { MenteeApplicationWithdrawService } from '@modules/mentorship/services/mentee-application-withdraw.service';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { ConfirmationService } from 'primeng/api';
import { menteeServiceTestDouble, menteeTestApplication, menteeTestTask } from '@shared/testing/mentorship-mentee-test-data';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeOverviewComponent } from './mentee-overview.component';

describe('MenteeOverviewComponent', () => {
  let fixture: ComponentFixture<MenteeOverviewComponent>;
  let menteeService: ReturnType<typeof menteeServiceTestDouble>;
  let confirmWithdraw: ReturnType<typeof vi.fn>;
  let withdrawingId: ReturnType<typeof signal<string | null>>;
  let navigate: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): Element | null => element().querySelector(`[data-testid="${id}"]`);
  const allByTestId = (id: string): Element[] => Array.from(element().querySelectorAll(`[data-testid="${id}"]`));
  const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const bootstrap = async (
    options: { applications?: MentorshipMenteeApplication[]; fail?: boolean; pending?: Subject<MentorshipMenteeApplicationsResponse> } = {}
  ): Promise<void> => {
    menteeService = menteeServiceTestDouble(options.applications ?? []);
    if (options.fail) {
      menteeService.getMenteeApplications.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    }
    if (options.pending) {
      menteeService.getMenteeApplications.mockReturnValue(options.pending.asObservable());
    }
    confirmWithdraw = vi.fn();
    withdrawingId = signal<string | null>(null);
    navigate = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeOverviewComponent],
      providers: [
        { provide: MentorshipMenteeService, useValue: menteeService },
        { provide: Router, useValue: { navigate } },
      ],
    });
    // The withdraw flow is provided on the component, so its stand-in goes there too.
    TestBed.overrideComponent(MenteeOverviewComponent, {
      set: {
        providers: [
          ConfirmationService,
          { provide: MenteeApplicationWithdrawService, useValue: { confirmWithdraw, withdrawingId: withdrawingId.asReadonly() } },
        ],
      },
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeOverviewComponent);
    await settle();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Loading / error ------------------------------------------------------

  it('shows the loading state until the applications read resolves', async () => {
    const pending = new Subject<MentorshipMenteeApplicationsResponse>();
    await bootstrap({ pending });
    expect(element().querySelector('lfx-route-loading')).toBeTruthy();
    expect(byTestId('mentee-overview-empty')).toBeNull();

    pending.next({ data: [], total: 0 });
    pending.complete();
    await settle();
    expect(element().querySelector('lfx-route-loading')).toBeNull();
    expect(byTestId('mentee-overview-empty')).toBeTruthy();
  });

  it('shows the error state with a Retry button when the read fails', async () => {
    await bootstrap({ fail: true });
    const error = byTestId('mentee-overview-error');
    expect(error).toBeTruthy();
    expect(text(error)).toContain(MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR);
    expect(byTestId('mentee-overview-applicant')).toBeNull();
  });

  it('clears the cache and re-reads the applications on Retry', async () => {
    await bootstrap({ fail: true });
    menteeService.getMenteeApplications.mockReturnValue(of({ data: [menteeTestApplication()], total: 1 }));

    const retryBtn = Array.from(element().querySelectorAll('button')).find((btn) => btn.textContent?.trim() === 'Retry');
    expect(retryBtn).toBeTruthy();
    retryBtn!.click();
    await settle();

    expect(menteeService.clearMenteeCaches).toHaveBeenCalledTimes(1);
    expect(menteeService.getMenteeApplications).toHaveBeenCalledTimes(2);
    expect(byTestId('mentee-overview-error')).toBeNull();
    expect(byTestId('mentee-overview-applicant')).toBeTruthy();
  });

  // ---- Empty ----------------------------------------------------------------

  it('renders the empty state with a Find a Program link when there are no applications', async () => {
    await bootstrap();
    const empty = byTestId('mentee-overview-empty');
    expect(empty).toBeTruthy();
    expect(text(empty)).toContain("You haven't applied to a program yet");
    expect(text(byTestId('mentee-overview-find-program'))).toContain('Find a Program');
    expect(byTestId('mentee-overview-applicant')).toBeNull();
  });

  // ---- Applicant layout -----------------------------------------------------

  it('renders the applicant layout with a singular banner for one pending application', async () => {
    await bootstrap({ applications: [menteeTestApplication()] });
    expect(byTestId('mentee-overview-applicant')).toBeTruthy();
    expect(text(byTestId('mentee-overview-banner-title'))).toBe('1 application under review');
    expect(text(element())).not.toContain(MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX.trim());
  });

  it('pluralises the banner and counts only pending applications', async () => {
    await bootstrap({
      applications: [menteeTestApplication(), menteeTestApplication({ id: 'app-2' }), menteeTestApplication({ id: 'app-3', upstreamStatus: 'accepted' })],
    });
    expect(text(byTestId('mentee-overview-banner-title'))).toBe('2 applications under review');
  });

  it('appends the limit notice once the mentee holds three pending applications', async () => {
    await bootstrap({
      applications: [menteeTestApplication(), menteeTestApplication({ id: 'app-2' }), menteeTestApplication({ id: 'app-3' })],
    });
    expect(text(byTestId('mentee-overview-banner-title'))).toBe('3 applications under review');
    expect(text(element())).toContain(MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX.trim());
  });

  it('renders the applicant layout without the review banner for an accepted-only mentee', async () => {
    await bootstrap({ applications: [menteeTestApplication({ upstreamStatus: 'accepted' })] });
    expect(byTestId('mentee-overview-applicant')).toBeTruthy();
    expect(allByTestId('mentee-application-card')).toHaveLength(1);
    expect(byTestId('mentee-overview-banner')).toBeNull();
  });

  it('hides the review banner when every application is past', async () => {
    await bootstrap({ applications: [menteeTestApplication({ upstreamStatus: 'declined' })] });
    expect(byTestId('mentee-overview-applicant')).toBeTruthy();
    expect(byTestId('mentee-overview-banner')).toBeNull();
  });

  // ---- Application cards ----------------------------------------------------

  it('shows the program logo in the card avatar when the program has one', async () => {
    await bootstrap({ applications: [menteeTestApplication({ programLogoUrl: 'https://example.com/logo.png' })] });
    const avatar = byTestId('mentee-application-card-avatar');
    expect(avatar?.querySelector('img')?.getAttribute('src')).toBe('https://example.com/logo.png');
    expect(avatar?.querySelector('.p-avatar-label')).toBeNull();
  });

  it("falls back to the program's initial in the card avatar when the program has no logo", async () => {
    await bootstrap({ applications: [menteeTestApplication()] });
    const avatar = byTestId('mentee-application-card-avatar');
    expect(avatar?.querySelector('img')).toBeNull();
    expect(text(avatar?.querySelector('.p-avatar-label'))).toBe('P');
  });

  it('orders the cards active, then graduated, then awaiting review, then in progress', async () => {
    await bootstrap({
      applications: [
        menteeTestApplication({ id: 'in-progress', programName: 'In Progress Program', tasks: [menteeTestTask()] }),
        menteeTestApplication({ id: 'graduated', programName: 'Graduated Program', upstreamStatus: 'graduated' }),
        menteeTestApplication({ id: 'awaiting', programName: 'Awaiting Program', tasks: [menteeTestTask({ status: 'submitted' })] }),
        menteeTestApplication({ id: 'active', programName: 'Active Program', upstreamStatus: 'accepted' }),
      ],
    });
    const cards = allByTestId('mentee-application-card');
    expect(cards.map((card) => text(card.querySelector('p.font-semibold')))).toEqual([
      'Active Program',
      'Graduated Program',
      'Awaiting Program',
      'In Progress Program',
    ]);
    expect(allByTestId('mentee-application-card-status').map((badge) => text(badge))).toEqual(['Active', 'Graduated', 'Awaiting Review', 'In Progress']);
  });

  it('treats a pending application with no tasks as awaiting review', async () => {
    await bootstrap({ applications: [menteeTestApplication({ tasks: [] })] });
    expect(text(byTestId('mentee-application-card-status'))).toBe('Awaiting Review');
  });

  it('shows a graduated application as a Graduated card without Withdraw', async () => {
    await bootstrap({ applications: [menteeTestApplication({ id: 'graduated', upstreamStatus: 'graduated' })] });
    expect(allByTestId('mentee-application-card')).toHaveLength(1);
    expect(text(byTestId('mentee-application-card-status'))).toBe('Graduated');
    expect(byTestId('mentee-overview-withdraw-graduated')).toBeNull();
    expect(byTestId('mentee-overview-past-applications')).toBeNull();
  });

  it('leaves declined, withdrawn and on-hold applications out of the cards', async () => {
    await bootstrap({
      applications: [
        menteeTestApplication({ id: 'declined', upstreamStatus: 'declined' }),
        menteeTestApplication({ id: 'withdrawn', upstreamStatus: 'withdrawn' }),
        menteeTestApplication({ id: 'hold', upstreamStatus: 'hold' }),
      ],
    });
    expect(allByTestId('mentee-application-card')).toHaveLength(0);
  });

  it('shows the project and term, falling back to the term alone without a project', async () => {
    await bootstrap({
      applications: [menteeTestApplication(), menteeTestApplication({ id: 'app-2', projectName: undefined, term: { id: 'term-2', name: 'Spring 2027' } })],
    });
    const cards = allByTestId('mentee-application-card');
    expect(text(cards[0])).toContain('Project One · Fall 2026');
    expect(text(cards[1])).toContain('Spring 2027');
    expect(text(cards[1])).not.toContain('·  Spring 2027');
    expect(text(cards[1])).not.toContain('Project One');
  });

  it('shows the last updated and decision expected dates', async () => {
    await bootstrap({ applications: [menteeTestApplication()] });
    const card = text(byTestId('mentee-application-card'));
    expect(card).toContain('Last updated Jun 2, 2026');
    expect(card).toContain('Decision expected Aug 1, 2026');
  });

  it('hides the decision expected date when the term has none', async () => {
    await bootstrap({ applications: [menteeTestApplication({ decisionExpectedDate: undefined })] });
    expect(text(byTestId('mentee-application-card'))).not.toContain('Decision expected');
  });

  it('hides the decision expected date once the application is accepted', async () => {
    await bootstrap({ applications: [menteeTestApplication({ upstreamStatus: 'accepted' })] });
    const card = text(byTestId('mentee-application-card'));
    expect(card).toContain('Last updated');
    expect(card).not.toContain('Decision expected');
  });

  it('labels pending progress as prerequisite tasks and counts only prerequisites', async () => {
    await bootstrap({
      applications: [
        menteeTestApplication({
          tasks: [
            menteeTestTask({ status: 'submitted' }),
            menteeTestTask({ id: 'task-2' }),
            menteeTestTask({ id: 'task-3', category: 'non_prerequisite', status: 'complete' }),
          ],
        }),
      ],
    });
    const card = text(byTestId('mentee-application-card'));
    expect(card).toContain('Prerequisite Tasks');
    expect(card).toContain('1 of 2');
  });

  it('labels accepted progress as tasks and counts only non-prerequisite tasks', async () => {
    await bootstrap({
      applications: [
        menteeTestApplication({
          upstreamStatus: 'accepted',
          tasks: [
            menteeTestTask({ status: 'complete' }),
            menteeTestTask({ id: 'task-2', category: 'non_prerequisite', status: 'complete' }),
            menteeTestTask({ id: 'task-3', category: 'non_prerequisite' }),
            menteeTestTask({ id: 'task-4', category: 'non_prerequisite' }),
          ],
        }),
      ],
    });
    const card = text(byTestId('mentee-application-card'));
    expect(card).not.toContain('Prerequisite Tasks');
    expect(card).toContain('Tasks');
    expect(card).toContain('1 of 3');
  });

  // ---- Card actions ---------------------------------------------------------

  it('navigates to the My Tasks tab on View Tasks', async () => {
    await bootstrap({ applications: [menteeTestApplication()] });
    (byTestId('mentee-overview-view-tasks') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/tasks']);
  });

  it('asks to confirm the withdraw of the card application', async () => {
    await bootstrap({ applications: [menteeTestApplication({ id: 'app-pending' })] });
    (byTestId('mentee-overview-withdraw-app-pending') as HTMLButtonElement).click();
    expect(confirmWithdraw).toHaveBeenCalledWith('app-pending');
  });

  it('disables every Withdraw button while a withdraw is in flight', async () => {
    await bootstrap({ applications: [menteeTestApplication({ id: 'first' }), menteeTestApplication({ id: 'second' })] });
    withdrawingId.set('first');
    await settle();

    const first = byTestId('mentee-overview-withdraw-first') as HTMLButtonElement;
    const second = byTestId('mentee-overview-withdraw-second') as HTMLButtonElement;
    expect(first.disabled).toBe(true);
    expect(second.disabled).toBe(true);
    expect(first.getAttribute('aria-busy')).toBe('true');
    expect(second.getAttribute('aria-busy')).toBe('false');
  });

  it('offers Withdraw only on pending cards, not on the active one', async () => {
    await bootstrap({ applications: [menteeTestApplication({ id: 'accepted', upstreamStatus: 'accepted' }), menteeTestApplication()] });
    const [activeCard, pendingCard] = allByTestId('mentee-application-card');
    expect(activeCard.querySelector('button[data-testid^="mentee-overview-withdraw-"]')).toBeNull();
    expect(pendingCard.querySelector('button[data-testid^="mentee-overview-withdraw-"]')).toBeTruthy();
  });

  // ---- Past applications ----------------------------------------------------

  it('hides the past applications table when there are none', async () => {
    await bootstrap({ applications: [menteeTestApplication()] });
    expect(byTestId('mentee-overview-past-applications')).toBeNull();
  });

  it('lists past applications with their outcomes, including On Hold', async () => {
    await bootstrap({
      applications: [
        menteeTestApplication({ id: 'declined', programName: 'Declined Program', upstreamStatus: 'declined' }),
        menteeTestApplication({ id: 'withdrawn', programName: 'Withdrawn Program', upstreamStatus: 'withdrawn' }),
        menteeTestApplication({ id: 'hold', programName: 'Held Program', upstreamStatus: 'hold', projectName: undefined }),
      ],
    });
    const past = text(byTestId('mentee-overview-past-applications'));
    expect(past).toContain('Declined Program');
    expect(past).toContain('Not selected');
    expect(past).toContain('Withdrawn');
    expect(past).toContain('Held Program');
    expect(past).toContain('On Hold');
    expect(past).toContain('Jun 1, 2026');
  });

  it('shows the submitted day in UTC so a late-evening submission keeps its calendar day', async () => {
    await bootstrap({ applications: [menteeTestApplication({ upstreamStatus: 'declined', createdOn: '2026-01-10T23:30:00Z' })] });
    expect(text(byTestId('mentee-overview-past-applications'))).toContain('Jan 10, 2026');
  });
});
