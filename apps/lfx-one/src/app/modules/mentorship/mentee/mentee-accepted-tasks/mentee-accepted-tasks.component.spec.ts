// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MOCK_MENTORSHIP_MENTEE_TASKS } from '@lfx-one/shared/constants';
import { MentorshipMenteeTasksResponse } from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeAcceptedTasksComponent } from './mentee-accepted-tasks.component';

describe('MenteeAcceptedTasksComponent', () => {
  let fixture: ComponentFixture<MenteeAcceptedTasksComponent>;
  let component: MenteeAcceptedTasksComponent;
  let getMenteeTasks: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const createComponent = async (): Promise<void> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeAcceptedTasksComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeTasks } },
        { provide: MentorshipComingSoonService, useValue: { notify: vi.fn() } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeAcceptedTasksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const bootstrap = async (): Promise<void> => {
    getMenteeTasks = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_TASKS));
    await createComponent();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders task list with filter chips', async () => {
    await bootstrap();
    const chips = element().querySelectorAll('[data-testid="mentee-tasks-filter-chips"] button');
    expect(chips.length).toBe(4);
    expect(chips[0].textContent?.trim()).toBe('All');
  });

  it('adds aria-pressed on filter chips', async () => {
    await bootstrap();
    const allChip = element().querySelector('[data-testid="mentee-tasks-filter-all"]');
    expect(allChip?.getAttribute('aria-pressed')).toBe('true');
    const submittedChip = element().querySelector('[data-testid="mentee-tasks-filter-submitted"]');
    expect(submittedChip?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows submitted summary count', async () => {
    await bootstrap();
    const summary = element().querySelector('[data-testid="mentee-tasks-submitted-summary"]');
    expect(summary?.textContent).toContain('of');
    expect(summary?.textContent).toContain('submitted');
  });

  it('renders a task row per task', async () => {
    await bootstrap();
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('filters tasks when a filter chip is clicked', async () => {
    await bootstrap();
    component['onFilterChange']('submitted');
    fixture.detectChanges();
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBeLessThan(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('submitted filter includes complete-status tasks', async () => {
    await bootstrap();
    component['onFilterChange']('submitted');
    fixture.detectChanges();
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    const completeTasks = MOCK_MENTORSHIP_MENTEE_TASKS.data.filter((t) => t.status === 'submitted' || t.status === 'complete');
    expect(taskRows.length).toBe(completeTasks.length);
  });

  it('shows all tasks when the "All" filter is selected', async () => {
    await bootstrap();
    component['onFilterChange']('submitted');
    fixture.detectChanges();
    component['onFilterChange'](null);
    fixture.detectChanges();
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBe(MOCK_MENTORSHIP_MENTEE_TASKS.data.length);
  });

  it('shows upload button for tasks needing upload', async () => {
    await bootstrap();
    const uploadBtns = element().querySelectorAll('[data-testid^="mentee-tasks-upload-"]');
    expect(uploadBtns.length).toBeGreaterThan(0);
  });

  it('retries the tasks fetch on retry click', async () => {
    await bootstrap();
    const callsBefore = getMenteeTasks.mock.calls.length;
    component['retry']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getMenteeTasks.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('shows the error empty-state when the tasks fetch fails', async () => {
    getMenteeTasks = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
    await createComponent();
    expect(component['error']()).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted-error"]')).toBeTruthy();
  });

  it('recovers to the task list when a retry succeeds after an error', async () => {
    getMenteeTasks = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValueOnce(of(MOCK_MENTORSHIP_MENTEE_TASKS));
    await createComponent();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted-error"]')).toBeTruthy();

    component['retry']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['error']()).toBeNull();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted"]')).toBeTruthy();
  });

  it('shows the empty-all message (not the filter message) when the mentee has no tasks at all', async () => {
    getMenteeTasks = vi.fn().mockReturnValue(of({ data: [], total: 0 }));
    await createComponent();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted-empty-all"]')).toBeTruthy();
    expect(element().textContent).toContain('No tasks assigned yet.');
    expect(element().textContent).not.toContain('No tasks match the selected filter.');
  });

  it('shows the empty-filter message when tasks exist but none match the active filter', async () => {
    const pendingOnly: MentorshipMenteeTasksResponse = {
      data: [{ id: 'only_pending', title: 'Pending only', description: 'x', status: 'pending', submitFile: null }],
      total: 1,
    };
    getMenteeTasks = vi.fn().mockReturnValue(of(pendingOnly));
    await createComponent();
    component['onFilterChange']('submitted');
    fixture.detectChanges();
    expect(element().querySelector('[data-testid="mentee-tasks-accepted-empty-filter"]')).toBeTruthy();
    expect(element().textContent).toContain('No tasks match the selected filter.');
    expect(element().textContent).not.toContain('No tasks assigned yet.');
  });

  it('filters via real chip clicks, including the in-progress chip', async () => {
    await bootstrap();
    const inProgressChip = element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-filter-in_progress"]');
    expect(inProgressChip).toBeTruthy();
    inProgressChip?.click();
    fixture.detectChanges();

    const rows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    const inProgressCount = MOCK_MENTORSHIP_MENTEE_TASKS.data.filter((t) => t.status === 'in_progress').length;
    expect(rows.length).toBe(inProgressCount);
    expect(inProgressChip?.getAttribute('aria-pressed')).toBe('true');
  });
});
