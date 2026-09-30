// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { SelectComponent } from '@components/select/select.component';
import { MentorshipMenteeTaskView } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeTaskView } from '@lfx-one/shared/utils';
import { MenteeTaskStatusService } from '@modules/mentorship/services/mentee-task-status.service';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeTaskRowComponent } from './mentee-task-row.component';

describe('MenteeTaskRowComponent', () => {
  let fixture: ComponentFixture<MenteeTaskRowComponent>;
  let component: MenteeTaskRowComponent;
  let notify: ReturnType<typeof vi.fn>;
  let changeStatus: ReturnType<typeof vi.fn>;
  let inFlight: Subject<boolean>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const buildRow = async (task: MentorshipMenteeTaskView): Promise<FormGroup<Record<string, FormControl<string>>>> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeTaskRowComponent],
      providers: [
        { provide: MentorshipComingSoonService, useValue: { notify } },
        { provide: MenteeTaskStatusService, useValue: { changeStatus } },
      ],
    });
    await TestBed.compileComponents();

    const form = new FormGroup<Record<string, FormControl<string>>>({
      [task.id]: new FormControl(task.status, { nonNullable: true }),
    });
    fixture = TestBed.createComponent(MenteeTaskRowComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
    return form;
  };

  const select = (): SelectComponent => fixture.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent;

  const byTestId = (id: string): HTMLElement | null => element().querySelector<HTMLElement>(`[data-testid="${id}"]`);

  const optionState = (): Record<string, boolean> =>
    Object.fromEntries(
      select()
        .options()
        .map((option: { value: string; disabled: boolean }) => [option.value, option.disabled])
    );

  const inProgressTask = (submitFile: string | null = null): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({ id: 'row_progress', title: 'Progress task', description: 'Under way', status: 'in_progress', submitFile });

  const pendingTask = (): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({ id: 'row_pending', title: 'Pending task', description: 'Not started', status: 'pending', submitFile: null });

  const uploadedTask = (): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({
      id: 'row_uploaded',
      title: 'Uploaded task',
      description: 'Already submitted',
      status: 'submitted',
      submitFile: 'https://files.example.com/a.pdf',
      fileUrl: 'https://files.example.com/a.pdf',
      submittedDate: '2026-09-12T00:00:00Z',
    });

  const uploadNeededTask = (): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({
      id: 'row_upload',
      title: 'Upload task',
      description: 'Needs a file',
      status: 'pending',
      submitFile: 'required',
      dueDate: '2026-09-30T00:00:00Z',
    });

  beforeEach(() => {
    notify = vi.fn();
    inFlight = new Subject<boolean>();
    changeStatus = vi.fn().mockReturnValue(inFlight.asObservable());
  });

  describe('status change', () => {
    it('saves a pending to in progress move, blocks the select and shows the spinner while in flight', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');

      component['onStatusChange']();
      fixture.detectChanges();

      expect(changeStatus).toHaveBeenCalledWith('row_pending', 'in_progress');
      expect(byTestId('mentee-tasks-status-saving-row_pending')).toBeTruthy();
      expect(byTestId('mentee-tasks-status-cell-row_pending')?.getAttribute('aria-busy')).toBe('true');
      expect(select().readonly()).toBe(true);
      expect(notify).not.toHaveBeenCalled();
    });

    it('keeps the new status and offers the next move once the save succeeds', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();

      inFlight.next(true);
      inFlight.complete();
      fixture.detectChanges();

      expect(form.controls[task.id].value).toBe('in_progress');
      expect(byTestId('mentee-tasks-status-saving-row_pending')).toBeNull();
      expect(select().readonly()).toBe(false);
      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: false });
    });

    it('shows the saved status icon and pill before the refresh lands', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();

      inFlight.next(true);
      inFlight.complete();
      fixture.detectChanges();

      const row = byTestId('mentee-tasks-task-row-row_pending');
      expect(row?.querySelector('.fa-clock')).toBeTruthy();
      expect(row?.querySelector('.fa-circle')).toBeNull();
      expect(select().styleClass()).toBe(`mentee-task-status-dropdown ${inProgressTask().statusClass}`);
    });

    it('hides the due date of a task just submitted until the refresh brings its submission date', async () => {
      const dueTask = (status: 'in_progress' | 'submitted', submittedDate?: string): MentorshipMenteeTaskView =>
        buildMentorshipMenteeTaskView({
          id: 'row_due',
          title: 'Due task',
          description: 'Under way',
          status,
          submitFile: null,
          dueDate: '2026-09-30T00:00:00Z',
          submittedDate,
        });
      const task = dueTask('in_progress');
      const form = await buildRow(task);
      expect(byTestId('mentee-tasks-date-row_due')?.textContent).toContain('Due Sep 30, 2026');

      form.controls[task.id].setValue('submitted');
      component['onStatusChange']();
      inFlight.next(true);
      inFlight.complete();
      fixture.detectChanges();

      expect(byTestId('mentee-tasks-task-row-row_due')?.querySelector('.fa-circle-check')).toBeTruthy();
      expect(byTestId('mentee-tasks-date-row_due')?.textContent?.trim()).toBe('');

      // The refresh brings the server-authored submission date.
      fixture.componentRef.setInput('task', dueTask('submitted', '2026-09-12T00:00:00Z'));
      fixture.detectChanges();
      expect(byTestId('mentee-tasks-date-row_due')?.textContent).toContain('Submitted on Sep 12, 2026');
    });

    it('drops the confirmed status once the refresh lands, so a later reset to the old status is read as it is', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();
      inFlight.next(true);
      inFlight.complete();
      fixture.detectChanges();

      // The refresh delivers the saved status: the override is spent.
      fixture.componentRef.setInput('task', { ...task, status: 'in_progress' });
      fixture.detectChanges();
      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: false });

      // A reviewer reopens the task and a later refresh brings it back as pending.
      fixture.componentRef.setInput('task', task);
      form.controls[task.id].setValue('pending', { emitEvent: false });
      fixture.detectChanges();
      expect(optionState()).toEqual({ pending: false, in_progress: false, submitted: true });

      // Starting it again must send a request, not be reverted as "unchanged".
      changeStatus.mockClear();
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();
      expect(changeStatus).toHaveBeenCalledWith('row_pending', 'in_progress');
    });

    it('keeps showing a chained change saved before the first refresh lands', async () => {
      const second = new Subject<boolean>();
      changeStatus.mockReturnValueOnce(inFlight.asObservable()).mockReturnValueOnce(second.asObservable());
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();
      inFlight.next(true);
      inFlight.complete();

      form.controls[task.id].setValue('submitted');
      component['onStatusChange']();
      second.next(true);
      second.complete();
      fixture.detectChanges();

      // The task input is still pending, yet the row and the control both read Submitted.
      expect(changeStatus).toHaveBeenLastCalledWith('row_pending', 'submitted');
      expect(form.controls[task.id].value).toBe('submitted');
      expect(select().styleClass()).toBe(`mentee-task-status-dropdown ${uploadedTask().statusClass}`);
      expect(optionState()).toEqual({ pending: true, in_progress: true, submitted: true });
    });

    it('keeps showing a chained change when the first refresh lands while it is in flight', async () => {
      const second = new Subject<boolean>();
      changeStatus.mockReturnValueOnce(inFlight.asObservable()).mockReturnValueOnce(second.asObservable());
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();
      inFlight.next(true);
      inFlight.complete();

      form.controls[task.id].setValue('submitted');
      component['onStatusChange']();
      fixture.componentRef.setInput('task', { ...task, status: 'in_progress' });
      fixture.detectChanges();
      second.next(true);
      second.complete();
      fixture.detectChanges();

      expect(form.controls[task.id].value).toBe('submitted');
      expect(select().styleClass()).toBe(`mentee-task-status-dropdown ${uploadedTask().statusClass}`);
      expect(optionState()).toEqual({ pending: true, in_progress: true, submitted: true });
    });

    it('reverts a failed change to the status a mid-flight refresh brought in', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();

      fixture.componentRef.setInput('task', { ...task, status: 'in_progress' });
      fixture.detectChanges();
      inFlight.next(false);
      inFlight.complete();
      fixture.detectChanges();

      expect(form.controls[task.id].value).toBe('in_progress');
    });

    it('reverts the control to the saved status when the save fails', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();

      inFlight.next(false);
      inFlight.complete();
      fixture.detectChanges();

      expect(form.controls[task.id].value).toBe('pending');
      expect(byTestId('mentee-tasks-status-saving-row_pending')).toBeNull();
      expect(select().readonly()).toBe(false);
      expect(optionState()).toEqual({ pending: false, in_progress: false, submitted: true });
    });

    it('ignores a second change while a save is in flight and leaves the optimistic value', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();

      form.controls[task.id].setValue('submitted');
      component['onStatusChange']();

      expect(changeStatus).toHaveBeenCalledTimes(1);
      expect(form.controls[task.id].value).toBe('submitted');
    });

    it('sends nothing and reverts when the value is unchanged or not one a mentee may request', async () => {
      const task = inProgressTask();
      const form = await buildRow(task);

      component['onStatusChange']();
      form.controls[task.id].setValue('pending');
      component['onStatusChange']();

      expect(changeStatus).not.toHaveBeenCalled();
      expect(form.controls[task.id].value).toBe('in_progress');
    });

    it('does not cancel the save when the row is destroyed mid-flight', async () => {
      const task = pendingTask();
      const form = await buildRow(task);
      form.controls[task.id].setValue('in_progress');
      component['onStatusChange']();

      fixture.destroy();

      expect(inFlight.observed).toBe(true);
      expect(() => inFlight.next(true)).not.toThrow();
    });
  });

  describe('status options and hints', () => {
    it('disables Submitted on a pending row and explains it with an sr-only hint', async () => {
      await buildRow(pendingTask());

      expect(optionState()).toEqual({ pending: false, in_progress: false, submitted: true });
      const hint = byTestId('mentee-tasks-status-hint-row_pending');
      expect(hint?.textContent).toContain('Start the task');
      expect(hint?.classList.contains('sr-only')).toBe(true);
    });

    it('shows the file-required hint and disables Submitted while a required file is missing', async () => {
      await buildRow(inProgressTask('required'));

      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: true });
      const hint = byTestId('mentee-tasks-status-hint-row_progress');
      expect(hint?.classList.contains('sr-only')).toBe(false);
      expect(hint?.textContent).toContain('needs a file');
    });

    it('allows Submitted on an in-progress row that needs no file, with no hint', async () => {
      await buildRow(inProgressTask());

      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: false });
      expect(byTestId('mentee-tasks-status-hint-row_progress')).toBeNull();
    });

    it('locks a submitted row read-only with every option disabled', async () => {
      await buildRow(uploadedTask());

      expect(select().readonly()).toBe(true);
      expect(optionState()).toEqual({ pending: true, in_progress: true, submitted: true });
      expect(byTestId('mentee-tasks-status-hint-row_uploaded')?.classList.contains('sr-only')).toBe(true);
    });

    it('labels the select by its sr-only name and the hint', async () => {
      await buildRow(inProgressTask('required'));

      expect(element().querySelector('#mentee-task-status-label-row_progress')?.textContent).toContain('Status of Progress task');
      expect(element().querySelector('#mentee-task-status-hint-row_progress')).toBeTruthy();
      expect(select().ariaLabelledBy()).toBe('mentee-task-status-label-row_progress mentee-task-status-hint-row_progress');
      // The wrapper input is only half the wiring: the rendered combobox must carry it too.
      const combobox = element().querySelector('[role="combobox"]');
      expect(combobox?.getAttribute('aria-labelledby')).toBe('mentee-task-status-label-row_progress mentee-task-status-hint-row_progress');
    });

    it('labels the select by its name alone when there is no hint', async () => {
      await buildRow(inProgressTask());

      expect(select().ariaLabelledBy()).toBe('mentee-task-status-label-row_progress');
    });
  });

  it('fires the Coming Soon toast on upload', async () => {
    await buildRow(uploadNeededTask());
    const uploadBtn = element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-upload-row_upload"]');
    expect(uploadBtn).toBeTruthy();
    uploadBtn?.click();
    expect(notify).toHaveBeenCalledWith('Upload submission for Upload task');
  });

  it('renders view/download buttons with aria-labels for an uploaded file', async () => {
    await buildRow(uploadedTask());
    const viewBtn = element().querySelector('[data-testid="mentee-tasks-view-file-row_uploaded"]');
    const downloadBtn = element().querySelector('[data-testid="mentee-tasks-download-file-row_uploaded"]');
    expect(viewBtn?.getAttribute('aria-label')).toBe('View submission for Uploaded task');
    expect(downloadBtn?.getAttribute('aria-label')).toBe('Download submission for Uploaded task');
  });

  it('fires the Coming Soon toast on view and download', async () => {
    await buildRow(uploadedTask());
    element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-view-file-row_uploaded"]')?.click();
    element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-download-file-row_uploaded"]')?.click();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith('View submission for Uploaded task');
    expect(notify).toHaveBeenCalledWith('Download submission for Uploaded task');
  });

  it('renders the upload button when an upload is required', async () => {
    await buildRow(uploadNeededTask());
    expect(element().querySelector('[data-testid="mentee-tasks-upload-row_upload"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-view-file-row_upload"]')).toBeNull();
  });

  it('pins submitted and due dates to UTC even under a non-UTC timezone', async () => {
    // America/Los_Angeles is UTC-7/8, so a UTC-midnight instant is the *previous* calendar day
    // locally. With `DatePipe … : 'UTC'` the row must still show the UTC day; dropping the arg
    // would surface Sep 11 / Sep 29 here — this is what makes the test fail if 'UTC' regresses.
    // Pattern mirrors packages/shared/src/utils/vote.utils.spec.ts.
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      await buildRow(uploadedTask()); // submittedDate 2026-09-12T00:00:00Z
      const submittedText = element().textContent ?? '';
      expect(submittedText).toContain('Submitted on Sep 12, 2026');
      expect(submittedText).not.toContain('Sep 11, 2026');

      await buildRow(uploadNeededTask()); // dueDate 2026-09-30T00:00:00Z
      const dueText = element().textContent ?? '';
      expect(dueText).toContain('Due Sep 30, 2026');
      expect(dueText).not.toContain('Sep 29, 2026');
    } finally {
      // `process.env.TZ = previousTz` alone would coerce an originally-unset TZ into "undefined".
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });
});
