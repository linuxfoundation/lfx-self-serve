// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipApplicantTaskRow, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { mentorshipApplicantTaskRows } from '@lfx-one/shared/utils';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from '../../services/mentorship-task-dialog.service';
import { ApplicantTasksPanelComponent } from './applicant-tasks-panel.component';

describe('ApplicantTasksPanelComponent', () => {
  const tasks: MentorshipApplicantTaskRow[] = mentorshipApplicantTaskRows([
    // Non-prerequisite → shows the Edit button.
    {
      id: 'tsk_editable',
      name: 'Midterm Report',
      description: 'Summarize progress on your mentorship project goals.',
      status: 'pending',
      prerequisite: false,
      createdOn: '2026-07-01',
      updatedOn: '2026-08-15',
      dueOn: '2026-10-15',
      requiresFileSubmission: true,
    },
    // Prerequisite → no Edit button. Also `hidePrerequisite` is on by default so we
    // toggle it off in the specs that need this row.
    {
      id: 'tsk_prereq',
      name: 'Cover Letter',
      description: 'A letter to the program.',
      status: 'submitted',
      prerequisite: true,
      createdOn: '2026-06-01',
      updatedOn: '2026-07-05',
      hasSubmission: true,
    },
  ]);

  let fixture: ComponentFixture<ApplicantTasksPanelComponent>;
  let openEdit: ReturnType<typeof vi.fn>;
  let addSpy: ReturnType<typeof vi.spyOn>;

  const build = (): void => {
    openEdit = vi.fn().mockReturnValue(of(undefined));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ApplicantTasksPanelComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: MentorshipTaskDialogService, useValue: { openCreate: vi.fn(), openEdit } }],
    });

    fixture = TestBed.createComponent(ApplicantTasksPanelComponent);
    fixture.componentRef.setInput('applicantId', 'app_1');
    fixture.componentRef.setInput('applicantName', 'Ifeoma Adeyemi');
    fixture.componentRef.setInput('tasks', tasks);
    fixture.detectChanges();

    const messageService = TestBed.inject(MessageService);
    addSpy = vi.spyOn(messageService, 'add');
  };

  beforeEach(() => build());

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The Edit trigger is now an `lfx-button` wrapper; the DOM click has to reach the inner `<button>`. */
  const clickEdit = (taskId: string): void => {
    element().querySelector<HTMLElement>(`[data-testid="mentorship-applicant-task-edit-${taskId}"]`)?.querySelector<HTMLButtonElement>('button')?.click();
  };

  it('renders the Edit button only on non-prerequisite rows', () => {
    // The prerequisite row is filtered out by default (hide-prerequisite is on),
    // so uncover it first to prove no Edit button is emitted for it.
    fixture.componentInstance['filterForm'].controls.hidePrerequisite.setValue(false);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-applicant-task-edit-tsk_editable"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-applicant-task-edit-tsk_prereq"]')).toBeNull();
  });

  it("opens the task-form dialog with the row's task when Edit is clicked", () => {
    clickEdit('tsk_editable');

    expect(openEdit).toHaveBeenCalledTimes(1);
    expect(openEdit.mock.calls[0][0].id).toBe('tsk_editable');
    expect(openEdit.mock.calls[0][0].name).toBe('Midterm Report');
    expect(openEdit.mock.calls[0][0].status).toBe('pending');
  });

  it('stays silent when the edit dialog is dismissed', () => {
    // Default stub resolves undefined — no toast should fire.
    clickEdit('tsk_editable');

    expect(addSpy).not.toHaveBeenCalled();
  });

  it('routes an accepted edit to the coming-soon toast until the write endpoint lands', () => {
    openEdit.mockReturnValue(
      of({
        taskId: 'tsk_editable',
        name: 'Midterm Report (revised)',
        description: 'Summarize progress',
        requiresFileSubmission: true,
        assignedMenteeIds: [],
      } satisfies MentorshipTaskFormValue)
    );

    clickEdit('tsk_editable');

    expect(addSpy).toHaveBeenCalledTimes(1);
    // `MessageService.add` signature is `add(message: ToastMessageOptions): void` — narrow for `.summary`.
    expect((addSpy.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Update Midterm Report (revised) for Ifeoma Adeyemi');
  });
});
