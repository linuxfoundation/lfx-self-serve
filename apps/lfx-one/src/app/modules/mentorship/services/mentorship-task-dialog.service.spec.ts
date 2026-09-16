// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MENTORSHIP_TASK_CREATE_DIALOG_HEADER, MENTORSHIP_TASK_EDIT_DIALOG_HEADER } from '@lfx-one/shared/constants';
import { MentorshipApplicantTask, MentorshipTaskDialogAssignee, MentorshipTaskFormDialogData, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from './mentorship-task-dialog.service';

describe('MentorshipTaskDialogService', () => {
  const primary: MentorshipTaskDialogAssignee = { id: 'mnt_1', name: 'Hana Suzuki', email: 'hana@example.org' };
  const extras: MentorshipTaskDialogAssignee[] = [
    { id: 'mnt_2', name: 'Dana Okafor', email: 'dana@example.org' },
    { id: 'mnt_3', name: 'Ravi Menon', email: 'ravi@example.org' },
  ];

  const task: MentorshipApplicantTask = {
    id: 'tsk_1',
    name: 'Midterm Report',
    description: 'Summarize progress',
    status: 'in-progress',
    prerequisite: false,
    createdOn: '2026-07-01',
    updatedOn: '2026-08-15',
    dueOn: '2026-10-15',
    requiresFileSubmission: true,
  };

  let service: MentorshipTaskDialogService;
  let open: ReturnType<typeof vi.fn>;
  let openCallData: (MentorshipTaskFormDialogData | undefined)[];
  let openCallConfig: unknown[];

  beforeEach(() => {
    openCallData = [];
    openCallConfig = [];
    open = vi.fn().mockImplementation((_component: unknown, config: { data?: MentorshipTaskFormDialogData }) => {
      openCallData.push(config?.data);
      openCallConfig.push(config);
      // Default: return a stub `DynamicDialogRef` whose `onClose` resolves with the value the caller sets on `.close`.
      const onClose$ = new Subject<MentorshipTaskFormValue | undefined>();
      return {
        onClose: onClose$.asObservable(),
        close: (value?: MentorshipTaskFormValue) => onClose$.next(value),
      } as Partial<DynamicDialogRef>;
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [MentorshipTaskDialogService, { provide: DialogService, useValue: { open } }],
    });
    service = TestBed.inject(MentorshipTaskDialogService);
  });

  describe('openCreate', () => {
    it('opens the dialog with the create header, the single mentee, and that mentee preselected', () => {
      service.openCreate(primary);

      expect(open).toHaveBeenCalledTimes(1);
      const config = openCallConfig[0] as { header: string; width: string; modal: boolean; closable: boolean; dismissableMask: boolean };
      expect(config.header).toBe(MENTORSHIP_TASK_CREATE_DIALOG_HEADER);
      // Config is shared across both entry points so widths / behaviour can't drift.
      expect(config.width).toBe('40rem');
      expect(config.modal).toBe(true);
      expect(config.closable).toBe(true);
      expect(config.dismissableMask).toBe(true);

      const data = openCallData[0]!;
      expect(data.mode).toBe('create');
      expect(data.mentees).toEqual([primary]);
      expect(data.preselectedMenteeIds).toEqual(['mnt_1']);
      expect(data.task).toBeUndefined();
    });

    it('spreads extra mentees into the multi-select flow while keeping only the primary preselected', () => {
      service.openCreate(primary, extras);

      const data = openCallData[0]!;
      expect(data.mentees.map((m) => m.id)).toEqual(['mnt_1', 'mnt_2', 'mnt_3']);
      // The multi-select flow keeps only the trigger mentee preselected; users check
      // the rest via the assignee list.
      expect(data.preselectedMenteeIds).toEqual(['mnt_1']);
    });

    it('forwards the dialog result through the returned observable', () => {
      const emitted: (MentorshipTaskFormValue | undefined)[] = [];
      service.openCreate(primary).subscribe((value) => emitted.push(value));

      // Trigger the fake DialogService close — the stub in `beforeEach` wires its
      // `close(value)` handle to the observable returned to the caller.
      const ref = open.mock.results[0].value as { close: (value?: MentorshipTaskFormValue) => void };
      const submitted: MentorshipTaskFormValue = {
        taskId: undefined,
        name: 'New task',
        description: 'Details',
        requiresFileSubmission: false,
        assignedMenteeIds: ['mnt_1'],
      };
      ref.close(submitted);

      expect(emitted).toEqual([submitted]);
    });
  });

  describe('openEdit', () => {
    it('opens with the edit header, seeds the form from the task, and hides the assignee list', () => {
      service.openEdit(task);

      const config = openCallConfig[0] as { header: string };
      expect(config.header).toBe(MENTORSHIP_TASK_EDIT_DIALOG_HEADER);

      const data = openCallData[0]!;
      expect(data.mode).toBe('edit');
      expect(data.mentees).toEqual([]);
      expect(data.preselectedMenteeIds).toEqual([]);
      // The edit seed carries every field the dialog needs — including `status`, which
      // is the whole reason the Edit Task dialog exists on the panel.
      expect(data.task).toEqual({
        id: 'tsk_1',
        name: 'Midterm Report',
        description: 'Summarize progress',
        dueOn: '2026-10-15',
        requiresFileSubmission: true,
        status: 'in-progress',
      });
    });

    it("coerces a falsy `requiresFileSubmission` to boolean `false` so the dialog's checkbox seeds correctly", () => {
      service.openEdit({ ...task, requiresFileSubmission: undefined });
      expect(openCallData[0]!.task!.requiresFileSubmission).toBe(false);
    });
  });

  describe('when DialogService.open returns null (a dialog of the same component is already mounted)', () => {
    it('collapses to an EMPTY observable so callers can subscribe unconditionally', () => {
      open.mockReturnValueOnce(null);
      const events: string[] = [];

      service.openCreate(primary).subscribe({
        next: () => events.push('next'),
        complete: () => events.push('complete'),
      });

      // `EMPTY` completes synchronously without emitting a value.
      expect(events).toEqual(['complete']);
    });
  });
});
