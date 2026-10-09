// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipMentorTaskReviewRequest, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskFileService } from '../../../../services/mentorship-task-file.service';
import { MentorTasksTabComponent } from './mentor-tasks-tab.component';

describe('MentorTasksTabComponent', () => {
  const mentee = (overrides: Partial<MentorshipProgramMentee> = {}): MentorshipProgramMentee => ({
    id: 'mnt_1',
    name: 'Hana Suzuki',
    email: 'hana.suzuki@example.com',
    status: 'accepted',
    termName: 'Fall 2026',
    tasks: [
      {
        id: 'tsk_awaiting',
        name: 'Backpressure design note',
        description: 'Wrote up two options for the buffer strategy.',
        status: 'submitted',
        prerequisite: false,
        createdOn: '2026-09-10',
        updatedOn: '2026-09-17T09:00:00.000Z',
        hasSubmission: true,
      },
      {
        id: 'tsk_approved',
        name: 'Resume',
        description: 'Upload the most recent version of your resume.',
        status: 'completed',
        prerequisite: false,
        createdOn: '2026-07-01',
        updatedOn: '2026-08-15',
        hasSubmission: true,
      },
      {
        id: 'tsk_hidden',
        name: 'Blog Post Draft',
        description: 'Share a draft blog post.',
        status: 'in-progress',
        prerequisite: false,
        createdOn: '2026-08-20',
        updatedOn: '2026-09-10',
      },
    ],
    ...overrides,
  });

  let fixture: ComponentFixture<MentorTasksTabComponent>;
  let download: ReturnType<typeof vi.fn>;

  const setup = (mentees: MentorshipProgramMentee[] = [mentee()]): void => {
    download = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorTasksTabComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: MentorshipTaskFileService, useValue: { download } }],
    });

    fixture = TestBed.createComponent(MentorTasksTabComponent);
    fixture.componentRef.setInput('mentees', mentees);
    fixture.detectChanges();
  };

  beforeEach(() => {
    setup();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  it('defaults to Awaiting Review and lists only submitted tasks', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-tasks-status-pill-submitted"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_awaiting"]')?.textContent).toContain('Hana Suzuki');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_awaiting"]')?.textContent).toContain('submitted');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_awaiting"]')?.textContent).toContain('Backpressure design note');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_awaiting"]')?.textContent).toContain('Fall 2026');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_approved"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_hidden"]')).toBeNull();
  });

  it('shows approved (completed) tasks when the Approved pill is pressed', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-tasks-status-pill-completed"]')?.click();
    fixture.detectChanges();

    const approved = element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_approved"]')?.textContent;
    expect(approved).toContain('Hana Suzuki');
    expect(approved).toContain('completed');
    expect(approved).toContain('Resume');
    expect(approved).not.toContain('submitted');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_awaiting"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-approve-mnt_1__tsk_approved"]')).toBeNull();
  });

  it('lists submitted and completed tasks on All, and hides Download Submission when there is no file', () => {
    setup([
      mentee({
        tasks: [
          {
            id: 'tsk_awaiting',
            name: 'Backpressure design note',
            description: 'Wrote up two options.',
            status: 'submitted',
            prerequisite: false,
            createdOn: '2026-09-10',
            updatedOn: '2026-09-17T09:00:00.000Z',
          },
          {
            id: 'tsk_done',
            name: 'Resume',
            description: 'Upload resume.',
            status: 'completed',
            prerequisite: false,
            createdOn: '2026-07-01',
            updatedOn: '2026-08-15',
            hasSubmission: true,
          },
          {
            id: 'tsk_wip',
            name: 'Blog Post Draft',
            description: 'In progress — should be excluded.',
            status: 'in-progress',
            prerequisite: false,
            createdOn: '2026-08-20',
            updatedOn: '2026-09-10',
          },
        ],
      }),
    ]);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-tasks-status-pill-all"]')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_awaiting"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_done"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-mnt_1__tsk_wip"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-open-submission-mnt_1__tsk_awaiting"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-approve-mnt_1__tsk_awaiting"]')).not.toBeNull();
  });

  const button = (testId: string): HTMLButtonElement | null =>
    element().querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.querySelector<HTMLButtonElement>('button') ?? null;

  it('asks the page to approve, or to request changes on, the upstream task, without a toast', () => {
    const addSpy = vi.spyOn(TestBed.inject(MessageService), 'add');
    const requests: MentorshipMentorTaskReviewRequest[] = [];
    fixture.componentInstance.reviewRequested.subscribe((request) => requests.push(request));

    button('mentorship-mentor-task-approve-mnt_1__tsk_awaiting')?.click();
    button('mentorship-mentor-task-request-changes-mnt_1__tsk_awaiting')?.click();

    // The row id is unique across mentees; the request carries the upstream task id.
    expect(requests).toEqual([
      { taskId: 'tsk_awaiting', status: 'complete' },
      { taskId: 'tsk_awaiting', status: 'incomplete' },
    ]);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('disables both review buttons, and emits nothing, while the page is reviewing the task', () => {
    const requests: MentorshipMentorTaskReviewRequest[] = [];
    fixture.componentInstance.reviewRequested.subscribe((request) => requests.push(request));
    fixture.componentRef.setInput('reviewingTaskIds', ['tsk_awaiting']);
    fixture.detectChanges();

    expect(button('mentorship-mentor-task-approve-mnt_1__tsk_awaiting')?.disabled).toBe(true);
    expect(button('mentorship-mentor-task-request-changes-mnt_1__tsk_awaiting')?.disabled).toBe(true);
    button('mentorship-mentor-task-approve-mnt_1__tsk_awaiting')?.click();
    expect(requests).toEqual([]);

    fixture.componentRef.setInput('reviewingTaskIds', []);
    fixture.detectChanges();

    expect(button('mentorship-mentor-task-approve-mnt_1__tsk_awaiting')?.disabled).toBe(false);
  });

  it('downloads the submission by its upstream task id', () => {
    button('mentorship-mentor-task-open-submission-mnt_1__tsk_awaiting')?.click();

    expect(download).toHaveBeenCalledWith('tsk_awaiting');
  });

  it('shows the empty state when no tasks match the filter', () => {
    setup([mentee({ tasks: [] })]);

    expect(element().querySelector('[data-testid="mentorship-mentor-tasks-empty"]')?.textContent?.trim()).toBe('No tasks awaiting review.');
  });
});
