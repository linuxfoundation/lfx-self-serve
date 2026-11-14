// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDeleteDialogData, MeetingOccurrence, MeetingRsvpSummary } from '@lfx-one/shared/interfaces';
import { formatMeetingWhen, formatMeetingWhenFull } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDeleteModalComponent } from './meeting-delete-modal.component';

const OCCURRENCE = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30, title: 'Synthetic date' } as MeetingOccurrence;
const ONE_OFF = { id: 'synthetic-meeting', title: 'Synthetic sync', recurrence: null, registrant_count: 3 } as unknown as Meeting;
const SERIES = { ...ONE_OFF, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as unknown as Meeting;

const RSVP_SUMMARY: MeetingRsvpSummary = { invited: 1, yes: 0, maybe: 0, no: 0, no_response: 1 };

const buildData = (meeting: Meeting, occurrence: MeetingOccurrence | null = null, rowOccurrence: MeetingOccurrence | null = null): MeetingDeleteDialogData => ({
  row: { key: 'row', meeting, occurrence: rowOccurrence, title: meeting.title, occurrenceId: null, startTime: '2050-01-01T09:00:00.000Z', durationMinutes: 30 },
  occurrence,
});

describe('MeetingDeleteModalComponent', () => {
  let fixture: ComponentFixture<MeetingDeleteModalComponent>;
  let close: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let deleteMeeting: ReturnType<typeof vi.fn>;
  let cancelOccurrence: ReturnType<typeof vi.fn>;

  const render = async (data: MeetingDeleteDialogData): Promise<void> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
        { provide: MeetingService, useValue: { deleteMeeting, cancelOccurrence } },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
    fixture = TestBed.createComponent(MeetingDeleteModalComponent);
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const type = async (value: string): Promise<void> => {
    const textarea = query('meetings-home-delete-reason')?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const confirm = async (): Promise<void> => {
    query('meetings-home-delete-confirm')?.querySelector('button')?.click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    close = vi.fn();
    toastShow = vi.fn();
    deleteMeeting = vi.fn().mockReturnValue(of(undefined));
    cancelOccurrence = vi.fn().mockReturnValue(of(undefined));
  });

  describe('delete', () => {
    it('shows the meeting context block with the guest count, deletes it and closes', async () => {
      await render(buildData(ONE_OFF));

      expect(query('meeting-dialog-context-title')?.textContent).toContain('Synthetic sync');
      expect(query('meeting-dialog-context-when')?.textContent).toContain(formatMeetingWhen('2050-01-01T09:00:00.000Z', 30));
      expect(query('meetings-home-delete-guests')?.textContent?.trim()).toBe('Guests: 3 guests');
      expect(query('meetings-home-delete-note')?.textContent).toContain('This will permanently delete this meeting.');
      await confirm();

      expect(deleteMeeting).toHaveBeenCalledWith('synthetic-meeting', undefined);
      expect(close).toHaveBeenCalledWith(true);
    });

    it("counts the guests from the row's invited total when the feed has no registrant counts", async () => {
      await render(buildData({ ...ONE_OFF, registrant_count: undefined, rsvp_summary: RSVP_SUMMARY } as Meeting));

      expect(query('meetings-home-delete-guests')?.textContent?.trim()).toBe('Guests: 1 guest');
    });

    it("counts a series row's guests from its date's invited total", async () => {
      await render(buildData({ ...SERIES, registrant_count: undefined } as Meeting, null, { ...OCCURRENCE, rsvp_summary: { ...RSVP_SUMMARY, invited: 4 } }));

      expect(query('meetings-home-delete-guests')?.textContent?.trim()).toBe('Guests: 4 guests');
    });

    it('hides the guests line rather than show 0 when no count is known', async () => {
      await render(buildData({ ...ONE_OFF, registrant_count: undefined } as Meeting));

      expect(query('meetings-home-delete-guests')).toBeNull();
    });

    it('deletes the whole series of a recurring meeting', async () => {
      const data = buildData(SERIES);
      await render(data);

      expect(query('meeting-dialog-context-when')?.textContent?.trim()).toBe(formatMeetingWhenFull(data.row));
      expect(query('meetings-home-delete-note')?.textContent).toContain('all meetings in this series');
      await confirm();

      expect(deleteMeeting).toHaveBeenCalledWith('synthetic-meeting', 'series');
    });

    it.each([
      [404, 'Meeting not found. It may have already been deleted.'],
      [403, 'You do not have permission to delete this meeting.'],
      [500, 'Server error occurred. Please try again later.'],
      [0, 'Network error. Please check your connection and try again.'],
      [502, 'Failed to delete meeting. Please try again.'],
    ])('stays open for a retry after a %s', async (status, description) => {
      deleteMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      await render(buildData(ONE_OFF));
      await confirm();

      expect(toastShow).toHaveBeenCalledWith({ variant: 'error', position: 'bottom-center', message: 'Delete Failed', description });
      expect(close).not.toHaveBeenCalled();
      expect(fixture.componentInstance.busy()).toBe(false);
    });
  });

  describe('cancel occurrence', () => {
    it('shows the picked date in the context block without a guests line, sends the trimmed reason and closes', async () => {
      await render(buildData(SERIES, OCCURRENCE));

      expect(query('meeting-dialog-context-title')?.textContent).toContain('Synthetic date');
      expect(query('meeting-dialog-context-when')?.textContent).toContain(formatMeetingWhen(OCCURRENCE.start_time, 30));
      expect(query('meetings-home-delete-guests')).toBeNull();
      expect(query('meetings-home-delete-reason')?.textContent).toContain('Included in the cancellation email sent to guests.');
      expect(query('meetings-home-delete-note')?.textContent).toContain('This is not how you unregister yourself from an occurrence.');
      await type('  Holiday  ');
      await confirm();

      expect(cancelOccurrence).toHaveBeenCalledWith('synthetic-meeting', OCCURRENCE.occurrence_id, 'Holiday');
      expect(close).toHaveBeenCalledWith(true);
    });

    it('reads Canceling... while the cancel runs', async () => {
      cancelOccurrence.mockReturnValue(new Subject<void>());
      await render(buildData(SERIES, OCCURRENCE));
      await confirm();

      expect(query('meetings-home-delete-confirm')?.textContent).toContain('Canceling...');
    });

    it("times a picked date by its own duration, else the series', not the clicked row's", async () => {
      await render(buildData({ ...SERIES, duration: 60 } as Meeting, { ...OCCURRENCE, duration: 0 }));

      expect(query('meeting-dialog-context-when')?.textContent).toContain(formatMeetingWhen(OCCURRENCE.start_time, 60));
    });

    it('shows only a divider from the details drawer', async () => {
      await render({ ...buildData(SERIES, OCCURRENCE), origin: 'drawer' });

      expect(query('meeting-dialog-context-divider')).not.toBeNull();
      expect(query('meeting-dialog-context-block')).toBeNull();
    });

    it('blocks a reason over the limit, counting code points of the trimmed text', async () => {
      await render(buildData(SERIES, OCCURRENCE));
      await type(`${'a'.repeat(3998)}😀😀  `);
      expect(query('meetings-home-delete-reason')?.textContent).not.toContain('Reason must be');
      await type('a'.repeat(4001));

      expect(query('meetings-home-delete-reason')?.textContent).toContain('Reason must be 4000 characters or fewer.');
      expect(query('meetings-home-delete-confirm')?.querySelector('button')?.disabled).toBe(true);
    });

    it('sends no reason when it is left empty', async () => {
      await render(buildData(SERIES, OCCURRENCE));
      await confirm();

      expect(cancelOccurrence).toHaveBeenCalledWith('synthetic-meeting', OCCURRENCE.occurrence_id, undefined);
    });

    it.each([
      [400, { error: 'occurrence already cancelled' }, 'This occurrence has already been cancelled — please refresh the page.'],
      [404, null, 'Meeting occurrence not found.'],
      [403, null, 'You do not have permission to cancel this occurrence.'],
      [500, null, 'Server error occurred while canceling occurrence.'],
      [0, null, 'Network error. Please check your connection.'],
    ])('stays open for a retry after a %s', async (status, error, description) => {
      cancelOccurrence.mockReturnValue(throwError(() => new HttpErrorResponse({ status, error })));
      await render(buildData(SERIES, OCCURRENCE));
      await confirm();

      expect(toastShow).toHaveBeenCalledWith({ variant: 'error', position: 'bottom-center', message: 'Error', description });
      expect(close).not.toHaveBeenCalled();
    });
  });
});
