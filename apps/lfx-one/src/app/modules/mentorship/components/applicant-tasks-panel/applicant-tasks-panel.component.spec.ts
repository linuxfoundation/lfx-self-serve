// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipApplicantTask, MentorshipApplicantTaskRow, MentorshipApplicantTaskStatus, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { mentorshipApplicantTaskRows } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from '../../services/mentorship-task-dialog.service';
import { MentorshipTaskUpdateService } from '../../services/mentorship-task-update.service';
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
    // Prerequisite → no Edit button. `hidePrerequisite` is off by default, so this row renders.
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
  let update: ReturnType<typeof vi.fn<(taskId: string, body: unknown, toastOnSuccess: boolean) => Observable<MentorshipApplicantTask | null>>>;
  let taskSaved: ReturnType<typeof vi.fn>;
  /** The service's in-flight ids, as a signal like the real one, so a save from a collapsed panel can settle mid-test. */
  let updatingIds: WritableSignal<ReadonlySet<string>>;

  const build = (): void => {
    openEdit = vi.fn().mockReturnValue(of(undefined));
    update = vi.fn(() => of(null));
    taskSaved = vi.fn();
    updatingIds = signal<ReadonlySet<string>>(new Set());

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ApplicantTasksPanelComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: MentorshipTaskDialogService, useValue: { openCreate: vi.fn(), openEdit } },
        { provide: MentorshipTaskUpdateService, useValue: { update, isUpdating: (taskId: string) => updatingIds().has(taskId) } },
      ],
    });

    fixture = TestBed.createComponent(ApplicantTasksPanelComponent);
    fixture.componentRef.setInput('applicantId', 'app_1');
    fixture.componentRef.setInput('applicantName', 'Ifeoma Adeyemi');
    fixture.componentRef.setInput('tasks', tasks);
    fixture.componentRef.setInput('taskSaved', taskSaved);
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
    // The prerequisite row renders by default (hide-prerequisite is off), but emits no Edit button.
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

  describe('saving', () => {
    const savedTask: MentorshipApplicantTask = {
      id: 'tsk_editable',
      name: 'Midterm Report (revised)',
      description: 'Summarize progress on your mentorship project goals.',
      status: 'pending',
      prerequisite: false,
      createdOn: '2026-07-01',
      updatedOn: '2026-10-06',
      dueOn: '2026-10-15',
      requiresFileSubmission: true,
    };
    const editValue = (overrides: Partial<MentorshipTaskFormValue> = {}): MentorshipTaskFormValue => ({
      taskId: 'tsk_editable',
      name: 'Midterm Report',
      description: 'Summarize progress on your mentorship project goals.',
      dueOn: '2026-10-15',
      requiresFileSubmission: true,
      assignedMenteeIds: [],
      status: 'pending',
      ...overrides,
    });

    /** The panel's protected status handler and cached status forms, which the lfx-select drives in the browser. */
    const internals = () =>
      fixture.componentInstance as unknown as {
        onStatusChange: (task: MentorshipApplicantTaskRow, event: { value: MentorshipApplicantTaskStatus }) => void;
        statusFormCache: Map<
          string,
          { controls: { status: { value: MentorshipApplicantTaskStatus; setValue: (value: MentorshipApplicantTaskStatus) => void } } }
        >;
      };
    const taskRow = (id: string): MentorshipApplicantTaskRow => tasks.find((task) => task.id === id) as MentorshipApplicantTaskRow;
    const changeStatus = (value: MentorshipApplicantTaskStatus): void => {
      const control = internals().statusFormCache.get('tsk_editable')?.controls.status;
      control?.setValue(value);
      internals().onStatusChange(taskRow('tsk_editable'), { value });
    };
    const statusForm = (): FormGroup => internals().statusFormCache.get('tsk_editable') as unknown as FormGroup;
    const editButton = (): HTMLButtonElement =>
      element().querySelector('[data-testid="mentorship-applicant-task-edit-tsk_editable"] button') as HTMLButtonElement;

    it('saves only what the edit dialog changed and hands the saved task back', () => {
      openEdit.mockReturnValue(of(editValue({ name: 'Midterm Report (revised)' })));
      update.mockReturnValue(of(savedTask));

      clickEdit('tsk_editable');

      expect(update).toHaveBeenCalledWith('tsk_editable', { name: 'Midterm Report (revised)' }, true);
      expect(taskSaved).toHaveBeenCalledWith('app_1', savedTask);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('sends nothing when the dialog saved no change', () => {
      openEdit.mockReturnValue(of(editValue()));

      clickEdit('tsk_editable');

      expect(update).not.toHaveBeenCalled();
      expect(taskSaved).not.toHaveBeenCalled();
    });

    it('saves a status change on its own, with no success toast, and hands the saved task back', () => {
      update.mockReturnValue(of({ ...savedTask, status: 'completed' }));

      changeStatus('completed');

      expect(update).toHaveBeenCalledWith('tsk_editable', { status: 'completed' }, false);
      expect(taskSaved).toHaveBeenCalledWith('app_1', { ...savedTask, status: 'completed' });
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('puts the select back on the task status when the save fails', () => {
      update.mockReturnValue(of(null));
      fixture.detectChanges();

      changeStatus('completed');

      expect(internals().statusFormCache.get('tsk_editable')?.controls.status.value).toBe('pending');
      expect(taskSaved).not.toHaveBeenCalled();
    });

    it('disables Edit while a save is in flight and frees it when the save lands', () => {
      const response = new Subject<MentorshipApplicantTask | null>();
      update.mockReturnValue(response);

      changeStatus('completed');
      fixture.detectChanges();
      expect(editButton().disabled).toBe(true);

      response.next({ ...savedTask, status: 'completed' });
      response.complete();
      fixture.detectChanges();
      expect(editButton().disabled).toBe(false);
    });

    it('re-enables Edit when a save started by a collapsed panel settles, even when it failed', () => {
      updatingIds.set(new Set(['tsk_editable']));
      fixture.detectChanges();
      expect(editButton().disabled).toBe(true);

      updatingIds.set(new Set());
      fixture.detectChanges();
      expect(editButton().disabled).toBe(false);
    });

    it('disables the select while a save is in flight and frees it when the save lands', () => {
      const response = new Subject<MentorshipApplicantTask | null>();
      update.mockReturnValue(response);

      changeStatus('completed');
      fixture.detectChanges();
      expect(statusForm().disabled).toBe(true);

      response.next({ ...savedTask, status: 'completed' });
      response.complete();
      fixture.detectChanges();
      expect(statusForm().disabled).toBe(false);
    });

    it('disables the select of a rebuilt panel while a save started by a collapsed panel is in flight', () => {
      updatingIds.set(new Set(['tsk_editable']));
      fixture.detectChanges();
      expect(statusForm().disabled).toBe(true);

      updatingIds.set(new Set());
      fixture.detectChanges();
      expect(statusForm().disabled).toBe(false);
    });

    it('sends no second change for a task that is still saving', () => {
      const response = new Subject<MentorshipApplicantTask | null>();
      update.mockReturnValue(response);

      changeStatus('completed');
      changeStatus('in-progress');

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('opens no edit dialog for a task that is still saving', () => {
      update.mockReturnValue(new Subject<MentorshipApplicantTask | null>());

      changeStatus('completed');
      clickEdit('tsk_editable');

      expect(openEdit).not.toHaveBeenCalled();
    });
  });
});
