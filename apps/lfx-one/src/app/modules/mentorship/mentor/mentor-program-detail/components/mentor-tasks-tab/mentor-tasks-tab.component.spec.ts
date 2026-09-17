// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  const setup = (mentees: MentorshipProgramMentee[] = [mentee()]): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorTasksTabComponent],
      providers: [provideNoopAnimations(), MessageService],
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
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_awaiting"]')?.textContent).toContain('Hana Suzuki');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_awaiting"]')?.textContent).toContain('submitted');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_awaiting"]')?.textContent).toContain('Backpressure design note');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_awaiting"]')?.textContent).toContain('Fall 2026');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_approved"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_hidden"]')).toBeNull();
  });

  it('shows approved (completed) tasks when the Approved pill is pressed', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-tasks-status-pill-completed"]')?.click();
    fixture.detectChanges();

    const approved = element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_approved"]')?.textContent;
    expect(approved).toContain('Hana Suzuki');
    expect(approved).toContain('completed');
    expect(approved).toContain('Resume');
    expect(approved).not.toContain('submitted');
    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_awaiting"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-approve-tsk_approved"]')).toBeNull();
  });

  it('lists submitted and completed tasks on All, and hides Open Submission when there is no file', () => {
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
        ],
      }),
    ]);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-tasks-status-pill-all"]')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-task-card-tsk_awaiting"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-open-submission-tsk_awaiting"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-task-approve-tsk_awaiting"]')).not.toBeNull();
  });

  it('routes approve, request-changes, and open-submission to the coming-soon toast', () => {
    const messageService = TestBed.inject(MessageService);
    const addSpy = vi.spyOn(messageService, 'add');

    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-task-approve-tsk_awaiting"]')?.querySelector<HTMLButtonElement>('button')?.click();
    element()
      .querySelector<HTMLElement>('[data-testid="mentorship-mentor-task-request-changes-tsk_awaiting"]')
      ?.querySelector<HTMLButtonElement>('button')
      ?.click();
    element()
      .querySelector<HTMLElement>('[data-testid="mentorship-mentor-task-open-submission-tsk_awaiting"]')
      ?.querySelector<HTMLButtonElement>('button')
      ?.click();

    expect(addSpy).toHaveBeenCalledTimes(3);
    const summaries = addSpy.mock.calls.map((call) => (call[0] as ToastMessageOptions).summary);
    expect(summaries).toEqual([
      'Approve "Backpressure design note" for Hana Suzuki',
      'Request changes on "Backpressure design note" for Hana Suzuki',
      'Open submission for "Backpressure design note" from Hana Suzuki',
    ]);
  });

  it('shows the empty state when no tasks match the filter', () => {
    setup([mentee({ tasks: [] })]);

    expect(element().querySelector('[data-testid="mentorship-mentor-tasks-empty"]')?.textContent?.trim()).toBe('No tasks awaiting review.');
  });
});
