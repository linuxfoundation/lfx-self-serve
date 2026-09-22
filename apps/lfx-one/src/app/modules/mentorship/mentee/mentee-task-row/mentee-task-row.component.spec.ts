// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MentorshipMenteeTaskView } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeTaskView } from '@lfx-one/shared/utils';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeTaskRowComponent } from './mentee-task-row.component';

describe('MenteeTaskRowComponent', () => {
  let fixture: ComponentFixture<MenteeTaskRowComponent>;
  let component: MenteeTaskRowComponent;
  let notify: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const buildRow = async (task: MentorshipMenteeTaskView): Promise<FormGroup<Record<string, FormControl<string>>>> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeTaskRowComponent],
      providers: [{ provide: MentorshipComingSoonService, useValue: { notify } }],
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
  });

  it('fires the Coming Soon toast and reverts the dropdown on status change', async () => {
    const task = uploadNeededTask();
    const form = await buildRow(task);
    // Simulate the user picking a different value in the dropdown.
    form.controls[task.id].setValue('in_progress');

    component['onStatusChange']();

    expect(notify).toHaveBeenCalledWith('Update status for Upload task');
    expect(form.controls[task.id].value).toBe('pending');
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
