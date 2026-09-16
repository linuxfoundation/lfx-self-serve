// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_TASK_DESCRIPTION_MAX, MENTORSHIP_TASK_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipTaskFormDialogData, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskFormDialogComponent } from './task-form-dialog.component';

describe('TaskFormDialogComponent', () => {
  const singleMenteeCreateData: MentorshipTaskFormDialogData = {
    mode: 'create',
    mentees: [{ id: 'mnt_1', name: 'Hana Suzuki', email: 'hana@example.org' }],
    preselectedMenteeIds: ['mnt_1'],
  };

  const multiMenteeCreateData: MentorshipTaskFormDialogData = {
    mode: 'create',
    mentees: [
      { id: 'mnt_1', name: 'Hana Suzuki', email: 'hana@example.org' },
      { id: 'mnt_2', name: 'Dana Okafor', email: 'dana@example.org' },
      { id: 'mnt_3', name: 'Ravi Menon', email: 'ravi@example.org' },
    ],
    preselectedMenteeIds: ['mnt_1'],
  };

  const editData: MentorshipTaskFormDialogData = {
    mode: 'edit',
    mentees: [],
    preselectedMenteeIds: [],
    task: {
      id: 'tsk_1',
      name: 'Midterm Report',
      description: 'Summarize progress',
      dueOn: '2026-10-15',
      requiresFileSubmission: true,
      status: 'in-progress',
    },
  };

  let fixture: ComponentFixture<TaskFormDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const build = (data: MentorshipTaskFormDialogData): void => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TaskFormDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogRef, useValue: { close } }, { provide: DynamicDialogConfig, useValue: { data } }],
    });

    fixture = TestBed.createComponent(TaskFormDialogComponent);
    fixture.detectChanges();
  };

  const submit = (): MentorshipTaskFormValue | undefined => {
    fixture.componentInstance['onSubmit']();
    return close.mock.calls[0]?.[0] as MentorshipTaskFormValue | undefined;
  };

  describe('create mode with a single mentee', () => {
    beforeEach(() => build(singleMenteeCreateData));

    it('opens with an empty form and hides the assignee list', () => {
      const component = fixture.componentInstance;

      expect(component['form'].controls.name.value).toBe('');
      expect(component['form'].controls.description.value).toBe('');
      expect(component['form'].controls.dueDate.value).toBeNull();
      expect(component['form'].controls.requiresFileSubmission.value).toBe(false);
      // Assignee list hidden — the single mentee is pre-selected so submit still carries the id.
      expect(component['showAssigneeList']()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-task-form-assignees"]')).toBeNull();
      // The nested `assigneesForm` seeds one control per mentee; the preselected id is checked.
      expect(component['assigneesForm'].getRawValue()).toEqual({ mnt_1: true });
    });

    it('refuses to close until required fields are filled', () => {
      // Both name and description start empty — submit is a no-op.
      submit();
      expect(close).not.toHaveBeenCalled();
    });

    it('closes with the trimmed form value plus the preselected assignee', () => {
      const component = fixture.componentInstance;
      component['form'].patchValue({
        name: '  Submit ingestion benchmark report  ',
        description: '  Upload the benchmark output for the ingestion pipeline.  ',
        requiresFileSubmission: true,
      });

      // No `status` in create output — the server always seeds new tasks as `pending`.
      expect(submit()).toEqual({
        taskId: undefined,
        name: 'Submit ingestion benchmark report',
        description: 'Upload the benchmark output for the ingestion pipeline.',
        dueOn: undefined,
        requiresFileSubmission: true,
        assignedMenteeIds: ['mnt_1'],
      });
    });

    it('does not render the status section in create mode', () => {
      expect(fixture.componentInstance['isEdit']()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-task-form-status"]')).toBeNull();
    });

    it('emits `dueOn` as a UTC-anchored ISO date when the calendar picks a day', () => {
      const component = fixture.componentInstance;
      component['form'].patchValue({ name: 'Task', description: 'Do it' });
      // The calendar emits a Date. Anchor to UTC so the day survives any host zone.
      component['form'].controls.dueDate.setValue(new Date(Date.UTC(2026, 9, 15)));

      expect(submit()?.dueOn).toBe('2026-10-15');
    });

    it('closes with no value when cancelled', () => {
      const component = fixture.componentInstance;
      component['form'].patchValue({ name: 'Task', description: 'Do it' });
      component['onCancel']();

      expect(close).toHaveBeenCalledWith();
    });

    it('refuses to save fields past their caps', () => {
      const component = fixture.componentInstance;
      component['form'].patchValue({
        name: 'x'.repeat(MENTORSHIP_TASK_NAME_MAX + 1),
        description: 'y'.repeat(MENTORSHIP_TASK_DESCRIPTION_MAX + 1),
      });
      submit();
      expect(close).not.toHaveBeenCalled();
    });
  });

  describe('create mode with multiple mentees', () => {
    beforeEach(() => build(multiMenteeCreateData));

    it('renders the multi-select assignee list with the preselected mentee checked', () => {
      const component = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;

      expect(component['showAssigneeList']()).toBe(true);
      expect(el.querySelector('[data-testid="mentorship-task-form-assignees"]')).not.toBeNull();
      expect(component['assigneesForm'].controls['mnt_1'].value).toBe(true);
      expect(component['assigneesForm'].controls['mnt_2'].value).toBe(false);
      expect(component['assigneesForm'].controls['mnt_3'].value).toBe(false);
    });

    it('reports the running selection count', () => {
      const component = fixture.componentInstance;
      // Users check a row via `lfx-checkbox`; here we flip the underlying FormControl directly.
      component['assigneesForm'].controls['mnt_2'].setValue(true);
      fixture.detectChanges();
      expect(component['assigneeCountLabel']()).toBe('2 of 3 mentees selected');
    });

    it('selects and clears all with the shortcuts', () => {
      const component = fixture.componentInstance;

      component['onSelectAll']();
      fixture.detectChanges();
      expect(component['selectedMenteeCount']()).toBe(3);

      component['onClear']();
      fixture.detectChanges();
      expect(component['selectedMenteeCount']()).toBe(0);
    });

    it('blocks submit when the assignee list is empty', () => {
      const component = fixture.componentInstance;
      component['form'].patchValue({ name: 'Task', description: 'Do it' });
      component['onClear']();
      fixture.detectChanges();

      submit();
      expect(close).not.toHaveBeenCalled();
      expect(component['canSubmit']()).toBe(false);
    });

    it('closes with every checked assignee', () => {
      const component = fixture.componentInstance;
      component['form'].patchValue({ name: 'Task', description: 'Do it' });
      component['assigneesForm'].controls['mnt_3'].setValue(true);
      fixture.detectChanges();

      expect(submit()?.assignedMenteeIds).toEqual(['mnt_1', 'mnt_3']);
    });

    it('renders one lfx-checkbox per assignee (no raw <input type="checkbox">)', () => {
      // Guard against a regression back to the raw-input pattern.
      const el = fixture.nativeElement as HTMLElement;
      const list = el.querySelector('[data-testid="mentorship-task-form-assignees"]')!;
      expect(list.querySelector('input[type="checkbox"][data-testid]')).toBeNull();
      // 3 assignees → 3 lfx-checkbox instances.
      expect(list.querySelectorAll('lfx-checkbox').length).toBe(3);
    });
  });

  describe('edit mode', () => {
    beforeEach(() => build(editData));

    it('seeds the form from the passed task', () => {
      const component = fixture.componentInstance;

      expect(component['form'].controls.name.value).toBe('Midterm Report');
      expect(component['form'].controls.description.value).toBe('Summarize progress');
      expect(component['form'].controls.requiresFileSubmission.value).toBe(true);
      expect(component['form'].controls.dueDate.value?.toISOString()).toBe('2026-10-15T00:00:00.000Z');
      // Status seeds from `task.status`; the section is rendered.
      expect(component['form'].controls.status.value).toBe('in-progress');
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-task-form-status"]')).not.toBeNull();
    });

    it("hides the assignee list — a task's assignee is not editable here", () => {
      expect(fixture.componentInstance['showAssigneeList']()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-task-form-assignees"]')).toBeNull();
    });

    it('closes with `taskId`, an empty assignee list, and the edited status', () => {
      const component = fixture.componentInstance;
      // Simulate the admin flipping the status via the dropdown.
      component['form'].controls.status.setValue('submitted');

      const value = submit();
      expect(value?.taskId).toBe('tsk_1');
      expect(value?.assignedMenteeIds).toEqual([]);
      expect(value?.status).toBe('submitted');
    });

    it('drops a malformed dueOn back to null instead of coercing to today', () => {
      build({ ...editData, task: { ...editData.task!, dueOn: 'not-a-date' } });
      expect(fixture.componentInstance['form'].controls.dueDate.value).toBeNull();
    });
  });
});
