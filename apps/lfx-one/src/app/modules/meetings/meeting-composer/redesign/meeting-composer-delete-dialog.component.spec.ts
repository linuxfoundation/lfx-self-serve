// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Meeting, MeetingComposerDeleteDialogData } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerDeleteDialogComponent } from './meeting-composer-delete-dialog.component';

const MEETING = { id: 'meeting-1', title: 'Weekly sync', start_time: '2030-01-08T15:00:00Z', timezone: 'UTC' } as Meeting;

describe('MeetingComposerDeleteDialogComponent', () => {
  let fixture: ComponentFixture<MeetingComposerDeleteDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let deleteMeeting: ReturnType<typeof vi.fn>;

  const render = async (data: MeetingComposerDeleteDialogData = { meeting: MEETING, guestCount: 2 }): Promise<void> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'delete-dialog', close } },
        { provide: MeetingService, useValue: { deleteMeeting } },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
    fixture = TestBed.createComponent(MeetingComposerDeleteDialogComponent);
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const confirm = async (): Promise<void> => {
    query('meeting-composer-delete-confirm')?.querySelector('button')?.click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    close = vi.fn();
    toastShow = vi.fn();
    deleteMeeting = vi.fn();
  });

  it('shows the saved guest count, and leaves the line out when the meeting has none', async () => {
    await render();
    expect(query('meeting-composer-delete-details')?.textContent).toContain('2 guests');

    TestBed.resetTestingModule();
    await render({ meeting: MEETING, guestCount: null });
    expect(query('meeting-composer-delete-details')?.textContent).not.toContain('Guests:');
  });

  it('stays busy while the request runs, then closes with true', async () => {
    const request = new Subject<void>();
    deleteMeeting.mockReturnValue(request);
    await render();

    await confirm();
    expect(fixture.componentInstance.busy()).toBe(true);
    expect(close).not.toHaveBeenCalled();

    request.next();
    request.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.busy()).toBe(false);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('stays open with an error toast when the delete fails', async () => {
    deleteMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await render();

    await confirm();

    expect(close).not.toHaveBeenCalled();
    expect(fixture.componentInstance.busy()).toBe(false);
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: 'Delete Failed', description: 'You do not have permission to delete this meeting.' })
    );
  });
});
