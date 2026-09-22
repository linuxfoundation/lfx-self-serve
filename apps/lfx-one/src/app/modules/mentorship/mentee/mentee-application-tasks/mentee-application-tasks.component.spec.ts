// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY,
  MOCK_MENTORSHIP_MENTEE_TASKS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeOverviewResponse, MentorshipMenteePhase, MentorshipMenteeTasksResponse } from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeApplicationTasksComponent } from './mentee-application-tasks.component';

describe('MenteeApplicationTasksComponent', () => {
  let fixture: ComponentFixture<MenteeApplicationTasksComponent>;
  let component: MenteeApplicationTasksComponent;
  let getMenteeOverview: ReturnType<typeof vi.fn>;
  let getMenteeTasks: ReturnType<typeof vi.fn>;
  let comingSoonNotify: ReturnType<typeof vi.fn>;
  let routerNavigate: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The overview response the component fetches for the applicant phase. */
  const overviewForPhase = (phase: MentorshipMenteePhase): MentorshipMenteeOverviewResponse => {
    if (phase === 'accepted') return MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED;
    if (phase === 'empty') return MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY;
    return MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT;
  };

  const createComponent = async (phase: MentorshipMenteePhase): Promise<void> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicationTasksComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview, getMenteeTasks } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
        { provide: Router, useValue: { navigate: routerNavigate } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicationTasksComponent);
    component = fixture.componentInstance;
    // The shell pushes the resolved phase into the child on activation.
    component.phase.set(phase);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Boot the component in the given phase (as the shell would report it). */
  const bootstrap = async (
    phase: MentorshipMenteePhase,
    overview: MentorshipMenteeOverviewResponse = overviewForPhase(phase),
    tasksData: MentorshipMenteeTasksResponse = MOCK_MENTORSHIP_MENTEE_TASKS
  ): Promise<void> => {
    getMenteeOverview = vi.fn().mockReturnValue(of(overview));
    getMenteeTasks = vi.fn().mockReturnValue(of(tasksData));
    comingSoonNotify = vi.fn();
    routerNavigate = vi.fn().mockResolvedValue(true);
    await createComponent(phase);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Phase resolution -----------------------------------------------------

  it('renders the accepted phase when the shell reports it', async () => {
    await bootstrap('accepted');
    expect(component['resolvedPhase']()).toBe('accepted');
    expect(element().querySelector('[data-testid="mentee-tasks-accepted"]')).toBeTruthy();
  });

  it('renders the applicant phase when the shell reports it', async () => {
    await bootstrap('applicant');
    expect(component['resolvedPhase']()).toBe('applicant');
    expect(element().querySelector('[data-testid="mentee-tasks-applicant"]')).toBeTruthy();
  });

  // ---- Applicant phase ------------------------------------------------------

  it('renders application cards with prerequisite tasks', async () => {
    await bootstrap('applicant');
    const cards = element().querySelectorAll('[data-testid^="mentee-tasks-application-card-"]');
    expect(cards.length).toBe(3);
    const text = element().textContent ?? '';
    expect(text).toContain('Apicurio Registry');
    expect(text).toContain('PREREQUISITE TASKS');
  });

  it('renders task rows inside each application card', async () => {
    await bootstrap('applicant');
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBeGreaterThanOrEqual(3);
  });

  it('renders status badges for application cards', async () => {
    await bootstrap('applicant');
    const text = element().textContent ?? '';
    expect(text).toContain('In Progress');
    expect(text).toContain('Awaiting Review');
  });

  it('shows submitted count per application', async () => {
    await bootstrap('applicant');
    const text = element().textContent ?? '';
    expect(text).toContain('1 of 3 submitted');
    expect(text).toContain('3 of 3 submitted');
  });

  it('shows upload button for tasks needing upload', async () => {
    await bootstrap('applicant');
    const uploadBtns = element().querySelectorAll('[data-testid^="mentee-tasks-upload-"]');
    expect(uploadBtns.length).toBeGreaterThan(0);
  });

  it('shows view/download icons for uploaded files', async () => {
    await bootstrap('applicant');
    const viewBtns = element().querySelectorAll('[data-testid^="mentee-tasks-view-file-"]');
    expect(viewBtns.length).toBeGreaterThan(0);
  });

  it('adds aria-label on icon-only file buttons', async () => {
    await bootstrap('applicant');
    const viewBtn = element().querySelector('[data-testid^="mentee-tasks-view-file-"]');
    expect(viewBtn?.getAttribute('aria-label')).toContain('View submission for');
    const downloadBtn = element().querySelector('[data-testid^="mentee-tasks-download-file-"]');
    expect(downloadBtn?.getAttribute('aria-label')).toContain('Download submission for');
  });

  it('fires Coming Soon toast on status change', async () => {
    await bootstrap('applicant');
    component['onStatusChange']('task_1', 'pending');
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });

  it('fires Coming Soon toast on upload', async () => {
    await bootstrap('applicant');
    component['onUpload']('task_1');
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });

  it('shows error state when the applicant overview API fails', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(throwError(() => new Error('Network error')));
    getMenteeTasks = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_TASKS));
    comingSoonNotify = vi.fn();
    routerNavigate = vi.fn().mockResolvedValue(true);

    await createComponent('applicant');

    expect(component['applicantError']()).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-error"]')).toBeTruthy();
  });

  it('retries the applicant overview fetch on retry click', async () => {
    await bootstrap('applicant');
    const callsBefore = getMenteeOverview.mock.calls.length;
    component['retry']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getMenteeOverview.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ---- Accepted phase -------------------------------------------------------

  it('renders task list with filter chips', async () => {
    await bootstrap('accepted');
    const chips = element().querySelectorAll('[data-testid="mentee-tasks-filter-chips"] button');
    expect(chips.length).toBe(4);
    expect(chips[0].textContent?.trim()).toBe('All');
  });

  it('adds aria-pressed on filter chips', async () => {
    await bootstrap('accepted');
    const allChip = element().querySelector('[data-testid="mentee-tasks-filter-all"]');
    expect(allChip?.getAttribute('aria-pressed')).toBe('true');
    const submittedChip = element().querySelector('[data-testid="mentee-tasks-filter-submitted"]');
    expect(submittedChip?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows submitted summary count', async () => {
    await bootstrap('accepted');
    const summary = element().querySelector('[data-testid="mentee-tasks-submitted-summary"]');
    expect(summary?.textContent).toContain('of');
    expect(summary?.textContent).toContain('submitted');
  });

  it('renders task rows for accepted phase', async () => {
    await bootstrap('accepted');
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('filters tasks when a filter chip is clicked', async () => {
    await bootstrap('accepted');

    component['onFilterChange']('submitted');
    fixture.detectChanges();

    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBeLessThan(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('submitted filter includes complete status tasks', async () => {
    await bootstrap('accepted');

    component['onFilterChange']('submitted');
    fixture.detectChanges();

    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    const completeTasks = MOCK_MENTORSHIP_MENTEE_TASKS.data.filter((t) => t.status === 'submitted' || t.status === 'complete');
    expect(taskRows.length).toBe(completeTasks.length);
  });

  it('shows all tasks when "All" filter is selected', async () => {
    await bootstrap('accepted');

    component['onFilterChange']('submitted');
    fixture.detectChanges();
    component['onFilterChange'](null);
    fixture.detectChanges();

    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('fires Coming Soon toast on status change in accepted phase', async () => {
    await bootstrap('accepted');
    component['onStatusChange']('mt_1', 'pending');
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });

  it('reverts the status dropdown to the original status after a change attempt', async () => {
    await bootstrap('accepted');
    const target = MOCK_MENTORSHIP_MENTEE_TASKS.data[0];
    const form = component['acceptedForm']();
    // Simulate the user picking a different value in the dropdown.
    form.controls[target.id].setValue('in_progress');

    component['onStatusChange'](target.id, target.status);

    const expected = component['normaliseForDropdown'](target.status);
    expect(form.controls[target.id].value).toBe(expected);
  });

  it('shows upload button for accepted tasks needing upload', async () => {
    await bootstrap('accepted');
    const uploadBtns = element().querySelectorAll('[data-testid^="mentee-tasks-upload-"]');
    expect(uploadBtns.length).toBeGreaterThan(0);
  });

  it('retries accepted data on retry click', async () => {
    await bootstrap('accepted');
    const callsBefore = getMenteeTasks.mock.calls.length;
    component['retryAccepted']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getMenteeTasks.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ---- Empty phase ----------------------------------------------------------

  it('redirects to the overview when the phase is empty (no tasks tab exists)', async () => {
    await bootstrap('empty');
    expect(routerNavigate).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
    // No phase content renders while the redirect is in flight.
    expect(element().querySelector('[data-testid="mentee-tasks-applicant"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted"]')).toBeNull();
  });
});
