// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT, MOCK_MENTORSHIP_MENTEE_TASKS } from '@lfx-one/shared/constants';
import { MentorshipMenteeOverviewApplicant, MentorshipMenteePhase, MentorshipMenteeTasksResponse } from '@lfx-one/shared/interfaces';
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

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (
    phase: MentorshipMenteePhase,
    overviewData: MentorshipMenteeOverviewApplicant = MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
    tasksData: MentorshipMenteeTasksResponse = MOCK_MENTORSHIP_MENTEE_TASKS
  ): Promise<void> => {
    getMenteeOverview = vi.fn().mockReturnValue(of(overviewData));
    getMenteeTasks = vi.fn().mockReturnValue(of(tasksData));
    comingSoonNotify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicationTasksComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview, getMenteeTasks } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicationTasksComponent);
    component = fixture.componentInstance;
    component.phase.set(phase);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Applicant phase ------------------------------------------------------

  it('renders application cards with prerequisite tasks', async () => {
    await bootstrap('applicant');
    const cards = element().querySelectorAll('[data-testid="mentee-tasks-application-card"]');
    expect(cards.length).toBe(3);
    const text = element().textContent ?? '';
    expect(text).toContain('Apicurio Registry');
    expect(text).toContain('PREREQUISITE TASKS');
  });

  it('renders task rows inside each application card', async () => {
    await bootstrap('applicant');
    const taskRows = element().querySelectorAll('[data-testid="mentee-tasks-task-row"]');
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
    const uploadBtns = element().querySelectorAll('[data-testid="mentee-tasks-upload"]');
    expect(uploadBtns.length).toBeGreaterThan(0);
  });

  it('shows view/download icons for uploaded files', async () => {
    await bootstrap('applicant');
    const viewBtns = element().querySelectorAll('[data-testid="mentee-tasks-view-file"]');
    expect(viewBtns.length).toBeGreaterThan(0);
  });

  it('fires Coming Soon toast on status change', async () => {
    await bootstrap('applicant');
    component['onStatusChange']('task_1');
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });

  it('fires Coming Soon toast on upload', async () => {
    await bootstrap('applicant');
    component['onUpload']('task_1');
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });

  it('shows error state when overview API fails', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(throwError(() => new Error('Network error')));
    getMenteeTasks = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_TASKS));
    comingSoonNotify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicationTasksComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview, getMenteeTasks } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicationTasksComponent);
    component = fixture.componentInstance;
    component.phase.set('applicant');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['applicantError']()).toBeTruthy();
  });

  // ---- Accepted phase -------------------------------------------------------

  it('renders task list with filter chips', async () => {
    await bootstrap('accepted');
    const chips = element().querySelectorAll('[data-testid="mentee-tasks-filter-chips"] button');
    expect(chips.length).toBe(4);
    expect(chips[0].textContent?.trim()).toBe('All');
  });

  it('shows submitted summary count', async () => {
    await bootstrap('accepted');
    const summary = element().querySelector('[data-testid="mentee-tasks-submitted-summary"]');
    expect(summary?.textContent).toContain('of');
    expect(summary?.textContent).toContain('submitted');
  });

  it('renders task rows for accepted phase', async () => {
    await bootstrap('accepted');
    const taskRows = element().querySelectorAll('[data-testid="mentee-tasks-task-row"]');
    expect(taskRows.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('filters tasks when a filter chip is clicked', async () => {
    await bootstrap('accepted');

    component['onFilterChange']('submitted');
    fixture.detectChanges();

    const taskRows = element().querySelectorAll('[data-testid="mentee-tasks-task-row"]');
    expect(taskRows.length).toBeLessThan(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('shows all tasks when "All" filter is selected', async () => {
    await bootstrap('accepted');

    component['onFilterChange']('submitted');
    fixture.detectChanges();
    component['onFilterChange'](null);
    fixture.detectChanges();

    const taskRows = element().querySelectorAll('[data-testid="mentee-tasks-task-row"]');
    expect(taskRows.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('fires Coming Soon toast on status change in accepted phase', async () => {
    await bootstrap('accepted');
    component['onStatusChange']('mt_1');
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });

  it('shows upload button for accepted tasks needing upload', async () => {
    await bootstrap('accepted');
    const uploadBtns = element().querySelectorAll('[data-testid="mentee-tasks-upload"]');
    expect(uploadBtns.length).toBeGreaterThan(0);
  });

  // ---- Empty phase ----------------------------------------------------------

  it('renders empty state for empty phase', async () => {
    await bootstrap('empty' as MentorshipMenteePhase);
    const emptyState = element().querySelector('[data-testid="mentee-tasks-empty"]');
    expect(emptyState).toBeTruthy();
  });
});
