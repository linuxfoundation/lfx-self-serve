// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipNoteRequest, MentorshipProgramMentee, MentorshipTaskDialogAssignee, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
import { MentorMenteesTabComponent } from './mentor-mentees-tab.component';

describe('MentorMenteesTabComponent', () => {
  const mentee = (overrides: Partial<MentorshipProgramMentee> = {}): MentorshipProgramMentee => ({
    id: 'mnt_1',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    status: 'accepted',
    termName: 'Fall 2026',
    tasksSubmitted: 2,
    tasksTotal: 3,
    tasks: [
      {
        id: 'tsk_1',
        name: 'Resume',
        description: 'Upload the most recent version of your resume.',
        status: 'completed',
        prerequisite: false,
        createdOn: '2026-07-01',
        updatedOn: '2026-08-15',
        hasSubmission: true,
      },
      {
        id: 'tsk_2',
        name: 'Midterm Report',
        description: 'Summarize progress on your mentorship project goals.',
        status: 'completed',
        prerequisite: false,
        createdOn: '2026-08-01',
        updatedOn: '2026-09-01',
      },
      {
        id: 'tsk_3',
        name: 'PR Demo Recording',
        description: 'Record a short demo of your latest pull request.',
        status: 'pending',
        prerequisite: true,
        createdOn: '2026-08-15',
        updatedOn: '2026-08-15',
      },
    ],
    ...overrides,
  });

  let fixture: ComponentFixture<MentorMenteesTabComponent>;
  let openCreate: ReturnType<typeof vi.fn>;
  let openCreateGroup: ReturnType<typeof vi.fn>;
  let openEdit: ReturnType<typeof vi.fn>;

  const setup = (
    mentees: MentorshipProgramMentee[] = [mentee(), mentee({ id: 'mnt_2', name: 'Priya Shah', status: 'graduated', tasks: [], tasksTotal: 0 })]
  ): void => {
    openCreate = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);
    openCreateGroup = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);
    openEdit = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorMenteesTabComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: MentorshipTaskDialogService, useValue: { openCreate, openCreateGroup, openEdit } }],
    });

    fixture = TestBed.createComponent(MentorMenteesTabComponent);
    fixture.componentRef.setInput('mentees', mentees);
    fixture.detectChanges();
  };

  beforeEach(() => {
    setup();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const headerLabels = (): string[] => Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
  const rowIds = (): string[] =>
    Array.from(element().querySelectorAll<HTMLElement>('[data-testid^="mentorship-mentor-mentee-row-"]')).map((row) =>
      (row.getAttribute('data-testid') ?? '').replace('mentorship-mentor-mentee-row-', '')
    );

  it('renders the header card, group-create action, and mentee columns', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-mentees-heading"]')?.textContent?.trim()).toBe('Current Mentees');
    expect(element().querySelector('[data-testid="mentorship-mentor-mentees-create-group-task"]')).not.toBeNull();
    expect(headerLabels()).toEqual(['Mentee', 'Term', 'Progress', 'Status', 'Task']);
    expect(element().querySelector('table')?.getAttribute('aria-label')).toBe('Current mentees');
  });

  it('lists only accepted and graduated mentees with progress percent from completed tasks', () => {
    setup([
      mentee(),
      mentee({ id: 'mnt_2', name: 'Priya Shah', status: 'graduated', tasks: [], tasksTotal: 0 }),
      mentee({ id: 'mnt_pending', name: 'Ifeoma Adeyemi', status: 'pending' }),
      mentee({ id: 'mnt_declined', name: 'Bob Wilson', status: 'declined' }),
    ]);

    expect(rowIds()).toEqual(['mnt_1', 'mnt_2']);
    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-progress-mnt_1"]')?.getAttribute('aria-valuenow')).toBe('100');
    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-row-mnt_1"]')?.textContent).toContain('100%');
    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-row-mnt_1"]')?.textContent).toContain('Fall 2026');
    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-row-mnt_1"]')?.textContent).toContain('Accepted');
    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-row-mnt_2"]')?.textContent).toContain('Graduated');
  });

  it('renders a dash instead of a measured 0% bar when the mentee has no task list', () => {
    const progress = element().querySelector('[data-testid="mentorship-mentor-mentee-progress-mnt_2"]');
    const label = element().querySelector('[data-testid="mentorship-mentor-mentee-row-mnt_2"]')?.querySelector('[aria-label="No tasks assigned"]');

    expect(progress?.getAttribute('role')).toBeNull();
    expect(progress?.getAttribute('aria-valuenow')).toBeNull();
    expect(progress?.getAttribute('aria-hidden')).toBe('true');
    expect(label?.textContent?.trim()).toBe('—');
  });

  it('asks the parent to open the note rather than owning the dialog itself', () => {
    const requests: MentorshipNoteRequest[] = [];
    fixture.componentInstance.noteRequested.subscribe((request) => requests.push(request));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-mentee-note-mnt_2"]')?.click();

    expect(requests).toEqual([{ personId: 'mnt_2', personName: 'Priya Shah' }]);
  });

  it('expands assigned tasks when View Tasks is clicked and hides prerequisite tasks by default', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-tasks-expanded-mnt_1"]')).toBeNull();

    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-mentee-view-tasks-mnt_1"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-mentee-tasks-expanded-mnt_1"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')?.textContent).toContain('Resume');
    expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_3"]')).toBeNull();
  });

  it("opens the task-form dialog with just the row's mentee when the plus control is clicked", () => {
    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-mentee-create-task-mnt_2"]')?.querySelector<HTMLButtonElement>('button')?.click();

    expect(openCreate).toHaveBeenCalledTimes(1);
    const arg = openCreate.mock.calls[0][0] as MentorshipTaskDialogAssignee;
    expect(arg.id).toBe('mnt_2');
    expect(arg.name).toBe('Priya Shah');
  });

  it('opens group create with every listed mentee preselected', () => {
    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-mentees-create-group-task"]')?.querySelector<HTMLButtonElement>('button')?.click();

    expect(openCreateGroup).toHaveBeenCalledTimes(1);
    const assignees = openCreateGroup.mock.calls[0][0] as MentorshipTaskDialogAssignee[];
    expect(assignees.map((person) => person.id)).toEqual(['mnt_1', 'mnt_2']);
  });

  it('routes a created group task to the coming-soon toast until the write endpoint lands', () => {
    openCreateGroup.mockReturnValue(
      of({
        taskId: undefined,
        name: 'Submit ingestion benchmark report',
        description: 'Upload the benchmark output.',
        requiresFileSubmission: false,
        assignedMenteeIds: ['mnt_1', 'mnt_2'],
      } satisfies MentorshipTaskFormValue)
    );
    const messageService = TestBed.inject(MessageService);
    const addSpy = vi.spyOn(messageService, 'add');

    fixture.componentInstance['onCreateGroupTask']();

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect((addSpy.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Create group task "Submit ingestion benchmark report" for 2 mentees');
  });

  it('singularizes the group-task toast when only one mentee is assigned', () => {
    setup([mentee()]);
    openCreateGroup.mockReturnValue(
      of({
        taskId: undefined,
        name: 'Submit ingestion benchmark report',
        description: 'Upload the benchmark output.',
        requiresFileSubmission: false,
        assignedMenteeIds: ['mnt_1'],
      } satisfies MentorshipTaskFormValue)
    );
    const messageService = TestBed.inject(MessageService);
    const addSpy = vi.spyOn(messageService, 'add');

    fixture.componentInstance['onCreateGroupTask']();

    expect((addSpy.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Create group task "Submit ingestion benchmark report" for 1 mentee');
  });

  it('shows the empty state when no current mentees are present', () => {
    setup([]);

    expect(element().querySelector('[data-testid="mentorship-mentor-mentees-empty"]')?.textContent?.trim()).toBe('No current mentees.');
  });
});
