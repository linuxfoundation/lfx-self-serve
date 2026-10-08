// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { SelectComponent } from '@components/select/select.component';
import { MentorshipMenteeTaskView } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeTaskView } from '@lfx-one/shared/utils';
import { MenteeTaskStatusService } from '@modules/mentorship/services/mentee-task-status.service';
import { MentorshipTaskFileService } from '@modules/mentorship/services/mentorship-task-file.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeTaskRowComponent } from './mentee-task-row.component';

describe('MenteeTaskRowComponent', () => {
  let fixture: ComponentFixture<MenteeTaskRowComponent>;
  let component: MenteeTaskRowComponent;
  let changeStatus: ReturnType<typeof vi.fn>;
  let inFlight: Subject<boolean>;
  let upload: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let download: ReturnType<typeof vi.fn>;
  let fileInFlight: Subject<boolean>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const buildRow = async (task: MentorshipMenteeTaskView): Promise<FormGroup<Record<string, FormControl<string>>>> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeTaskRowComponent],
      providers: [
        { provide: MentorshipTaskFileService, useValue: { upload, remove, download } },
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

  const inProgressTask = (submitFile: 'required' | null = null, hasFile = false): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({ id: 'row_progress', title: 'Progress task', description: 'Under way', status: 'in_progress', submitFile, hasFile });

  const pendingTask = (): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({
      id: 'row_pending',
      title: 'Pending task',
      description: 'Not started',
      status: 'pending',
      submitFile: null,
      hasFile: false,
    });

  const uploadedTask = (status: 'submitted' | 'complete' = 'submitted'): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView({
      id: 'row_uploaded',
      title: 'Uploaded task',
      description: 'Already submitted',
      status,
      submitFile: 'required',
      hasFile: true,
      submittedDate: '2026-09-12T00:00:00Z',
    });

  // Fixed clocks either side of the fixtures' due date (Sep 30, 2026), so a fixture never turns past due with the calendar.
  // The row judges `pastDue` against its own clock, so each test also pins `Date` (to `beforeDue` unless it says otherwise).
  const beforeDue = Date.parse('2026-09-15T00:00:00Z');
  const afterDue = Date.parse('2026-10-01T00:00:00Z');

  const uploadNeededTask = (nowMs: number = beforeDue): MentorshipMenteeTaskView =>
    buildMentorshipMenteeTaskView(
      {
        id: 'row_upload',
        title: 'Upload task',
        description: 'Needs a file',
        status: 'pending',
        submitFile: 'required',
        hasFile: false,
        dueDate: '2026-09-30T00:00:00Z',
      },
      nowMs
    );

  /** Picks a file in the row's hidden input, as the browser does after Upload or Replace opens it. */
  const pickFile = (taskId: string, file: File): void => {
    const input = byTestId(`mentee-tasks-file-input-${taskId}`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(beforeDue);
    inFlight = new Subject<boolean>();
    changeStatus = vi.fn().mockReturnValue(inFlight.asObservable());
    fileInFlight = new Subject<boolean>();
    upload = vi.fn().mockReturnValue(fileInFlight.asObservable());
    remove = vi.fn().mockReturnValue(fileInFlight.asObservable());
    download = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
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
        buildMentorshipMenteeTaskView(
          {
            id: 'row_due',
            title: 'Due task',
            description: 'Under way',
            status,
            submitFile: null,
            hasFile: false,
            dueDate: '2026-09-30T00:00:00Z',
            submittedDate,
          },
          beforeDue
        );
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

  describe('file actions', () => {
    const pdf = (): File => new File(['%PDF-1.7'], 'answer.pdf', { type: 'application/pdf' });

    it('opens the picker from Upload and uploads the picked file, showing the spinner while in flight', async () => {
      await buildRow(uploadNeededTask());
      const input = byTestId('mentee-tasks-file-input-row_upload') as HTMLInputElement;
      const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);

      byTestId('mentee-tasks-upload-row_upload')?.click();
      expect(click).toHaveBeenCalled();

      const file = pdf();
      pickFile('row_upload', file);
      fixture.detectChanges();
      expect(upload).toHaveBeenCalledWith('row_upload', file);
      expect(byTestId('mentee-tasks-file-saving-row_upload')).toBeTruthy();
      expect((byTestId('mentee-tasks-upload-row_upload') as HTMLButtonElement).disabled).toBe(true);

      fileInFlight.next(true);
      fileInFlight.complete();
      fixture.detectChanges();
      expect(byTestId('mentee-tasks-file-saving-row_upload')).toBeNull();
    });

    it('ignores a second pick while an upload is in flight', async () => {
      await buildRow(uploadNeededTask());
      pickFile('row_upload', pdf());
      pickFile('row_upload', pdf());

      expect(upload).toHaveBeenCalledTimes(1);
    });

    it('offers Download, Replace and Remove for a stored file before the task is submitted', async () => {
      await buildRow(inProgressTask('required', true));

      expect(byTestId('mentee-tasks-download-file-row_progress')?.getAttribute('aria-label')).toBe('Download submission for Progress task');
      expect(byTestId('mentee-tasks-replace-file-row_progress')).toBeTruthy();
      expect(byTestId('mentee-tasks-remove-file-row_progress')).toBeTruthy();
      expect(byTestId('mentee-tasks-upload-row_progress')).toBeNull();
    });

    it('offers Replace but not Remove once the task is submitted', async () => {
      await buildRow(uploadedTask());

      expect(byTestId('mentee-tasks-download-file-row_uploaded')).toBeTruthy();
      expect(byTestId('mentee-tasks-replace-file-row_uploaded')).toBeTruthy();
      expect(byTestId('mentee-tasks-remove-file-row_uploaded')).toBeNull();
    });

    it('offers only Download once the reviewer completes the task', async () => {
      await buildRow(uploadedTask('complete'));

      expect(byTestId('mentee-tasks-download-file-row_uploaded')).toBeTruthy();
      expect(byTestId('mentee-tasks-replace-file-row_uploaded')).toBeNull();
      expect(byTestId('mentee-tasks-remove-file-row_uploaded')).toBeNull();
    });

    it('downloads and removes through the file service', async () => {
      await buildRow(inProgressTask('required', true));

      byTestId('mentee-tasks-download-file-row_progress')?.click();
      byTestId('mentee-tasks-remove-file-row_progress')?.click();

      expect(download).toHaveBeenCalledWith('row_progress');
      expect(remove).toHaveBeenCalledWith('row_progress');
    });

    it('does not cancel an upload when the row is destroyed mid-flight', async () => {
      await buildRow(uploadNeededTask());
      pickFile('row_upload', pdf());

      fixture.destroy();

      expect(fileInFlight.observed).toBe(true);
    });
  });

  describe('past due', () => {
    const pastDueInProgress = (nowMs: number = afterDue): MentorshipMenteeTaskView =>
      buildMentorshipMenteeTaskView(
        {
          id: 'row_late',
          title: 'Late task',
          description: 'Under way',
          status: 'in_progress',
          submitFile: null,
          hasFile: false,
          dueDate: '2026-09-30T00:00:00Z',
        },
        nowMs
      );

    // Fakes the timers along with `Date`; rxjs `timer` schedules through setInterval, so that pair is faked too.
    const fakeClock = (nowMs: number): void => {
      // Re-faking without restoring first keeps the outer Date-only fake, so the timers would stay real.
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(nowMs);
    };

    beforeEach(() => {
      vi.setSystemTime(afterDue);
    });

    it('disables Submitted and shows the past-due hint', async () => {
      await buildRow(pastDueInProgress());

      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: true });
      const hint = byTestId('mentee-tasks-status-hint-row_late');
      expect(hint?.classList.contains('sr-only')).toBe(false);
      expect(hint?.textContent).toContain('due date has passed');
    });

    it('lets a past-due pending task still be started', async () => {
      await buildRow(uploadNeededTask(afterDue));

      expect(optionState()).toEqual({ pending: false, in_progress: false, submitted: true });
    });

    it('disables Upload and describes it by the hint', async () => {
      await buildRow(uploadNeededTask(afterDue));
      const uploadBtn = element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-upload-row_upload"]');

      expect(uploadBtn?.disabled).toBe(true);
      expect(uploadBtn?.getAttribute('aria-describedby')).toBe('mentee-task-status-hint-row_upload');
    });

    it('keeps Download but closes Replace and Remove on a stored file', async () => {
      await buildRow({ ...inProgressTask('required', true), dueDate: '2026-09-30T00:00:00Z' });

      expect(byTestId('mentee-tasks-download-file-row_progress')).toBeTruthy();
      expect(byTestId('mentee-tasks-replace-file-row_progress')).toBeNull();
      expect(byTestId('mentee-tasks-remove-file-row_progress')).toBeNull();
    });

    it('keeps Upload enabled before the due date has ended', async () => {
      vi.setSystemTime(beforeDue);
      await buildRow(uploadNeededTask());
      const uploadBtn = element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-upload-row_upload"]');

      expect(uploadBtn?.disabled).toBe(false);
      expect(uploadBtn?.getAttribute('aria-describedby')).toBeNull();
    });

    it('locks Submitted and Upload when the due date closes while the row is open', async () => {
      const lastSecond = Date.parse('2026-09-30T23:59:59Z');
      fakeClock(lastSecond);
      // Built before the cutoff, like a cached view: its own `pastDue` stays false.
      await buildRow(pastDueInProgress(lastSecond));
      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: false });

      vi.advanceTimersByTime(1000);
      fixture.detectChanges();

      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: true });
      expect(byTestId('mentee-tasks-status-hint-row_late')?.textContent).toContain('due date has passed');
    });

    it('re-reads the clock when a refresh moves the due date of an open row earlier', async () => {
      fakeClock(beforeDue);
      await buildRow(pastDueInProgress(beforeDue));
      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: false });

      // Time passes with no cutoff reached, then a refresh brings a due date that has already ended.
      vi.setSystemTime(Date.parse('2026-09-25T12:00:00Z'));
      fixture.componentRef.setInput('task', { ...pastDueInProgress(beforeDue), dueDate: '2026-09-20T00:00:00Z' });
      fixture.detectChanges();

      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: true });
    });

    it('re-arms the cutoff from the current clock when a refresh changes the due date', async () => {
      fakeClock(beforeDue);
      await buildRow(pastDueInProgress(beforeDue));

      // One second before the new due date's cutoff; a timer armed from the build time would not fire for weeks.
      vi.setSystemTime(Date.parse('2026-10-05T23:59:59Z'));
      fixture.componentRef.setInput('task', { ...pastDueInProgress(beforeDue), dueDate: '2026-10-05T00:00:00Z' });
      fixture.detectChanges();
      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: false });

      vi.advanceTimersByTime(1000);
      fixture.detectChanges();

      expect(optionState()).toEqual({ pending: true, in_progress: false, submitted: true });
    });

    it('judges a view built before the cutoff against the current clock', async () => {
      await buildRow(uploadNeededTask(beforeDue));
      const uploadBtn = element().querySelector<HTMLButtonElement>('[data-testid="mentee-tasks-upload-row_upload"]');

      expect(uploadBtn?.disabled).toBe(true);
    });
  });

  it('renders the upload button when an upload is required', async () => {
    await buildRow(uploadNeededTask());
    expect(element().querySelector('[data-testid="mentee-tasks-upload-row_upload"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-download-file-row_upload"]')).toBeNull();
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
