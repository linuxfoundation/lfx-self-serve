// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { YOUTUBE_MAX_MEETING_TITLE_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RescheduleOccurrenceDialogComponent } from './reschedule-occurrence-dialog.component';

const MEETING = {
  id: 'meeting-1',
  title: 'Weekly sync',
  description: 'Status round',
  timezone: 'UTC',
  recurrence: { type: 2, repeat_interval: 1 },
} as unknown as Meeting;
const OCCURRENCE = { occurrence_id: '1893492000', start_time: '2030-01-01T10:00:00.000Z', duration: 30 } as MeetingOccurrence;

/**
 * Covers the single-occurrence edit dialog.
 * @description Upstream keys an occurrence by its start instant and takes no timezone on the
 * occurrence write, so the dialog reads the new time in the series' own zone. It always sends
 * `start_time` + `duration` (upstream requires both) and adds `title` / `description` only when
 * they changed. An untouched form must not be submittable: it would be a no-op write that still
 * detaches the occurrence from the series pattern upstream.
 */
describe('RescheduleOccurrenceDialogComponent', () => {
  let updateOccurrence: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let occurrence: MeetingOccurrence;
  let meeting: Meeting;
  let config: { data: { meeting: Meeting; occurrence: MeetingOccurrence }; closable?: boolean };

  async function mount(): Promise<RescheduleOccurrenceDialogComponent> {
    config = { data: { meeting, occurrence }, closable: true };
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: config },
        { provide: MeetingService, useValue: { updateOccurrence } },
      ],
    });
    TestBed.overrideComponent(RescheduleOccurrenceDialogComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(RescheduleOccurrenceDialogComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    updateOccurrence = vi.fn().mockReturnValue(of(undefined));
    close = vi.fn();
    occurrence = OCCURRENCE;
    meeting = MEETING;
  });

  describe('in a zone with daylight saving', () => {
    // 2030-01-15 10:00 AM Eastern Standard Time.
    const JANUARY = { occurrence_id: '1894719600', start_time: '2030-01-15T15:00:00.000Z', duration: 30 } as MeetingOccurrence;

    beforeEach(() => {
      meeting = { ...MEETING, timezone: 'America/New_York' } as Meeting;
      occurrence = JANUARY;
    });

    it('prefills the series-zone wall clock on a date carrier pinned to that calendar day', async () => {
      const component = await mount();
      const startDate: Date = component.form.get('startDate')?.value;

      expect([startDate.getFullYear(), startDate.getMonth(), startDate.getDate()]).toEqual([2030, 0, 15]);
      expect(component.form.get('startTime')?.value).toBe('10:00 AM');
    });

    it('relabels the zone when the proposed date crosses into daylight time', async () => {
      const component = await mount();
      expect(component.timezoneLabel()).toBe('Eastern Standard Time');

      component.form.patchValue({ startDate: new Date(2030, 6, 15, 12) });

      expect(component.timezoneLabel()).toBe('Eastern Daylight Time');
    });

    it('refuses a wall time that the spring-forward gap skips', async () => {
      const component = await mount();

      // 2030-03-10 is the US spring-forward day; 2:30 AM never happens in New York.
      component.form.patchValue({ startDate: new Date(2030, 2, 10, 12), startTime: '2:30 AM' });
      component.form.get('startTime')?.markAsTouched();

      expect(component.form.errors?.['nonexistentWallTime']).toBe(true);
      expect(component.showNonexistentTimeError()).toBe(true);
      expect(component.canSave()).toBe(false);
    });

    it('accepts the first real time after the gap', async () => {
      const component = await mount();

      component.form.patchValue({ startDate: new Date(2030, 2, 10, 12), startTime: '3:30 AM' });

      expect(component.form.errors?.['nonexistentWallTime']).toBeUndefined();
      expect(component.canSave()).toBe(true);
    });
  });

  it('prefills the current slot in the series timezone and refuses to save it unchanged', async () => {
    const component = await mount();

    expect(component.form.get('startTime')?.value).toBe('10:00 AM');
    expect(component.form.get('duration')?.value).toBe(30);
    expect(component.newStartTime()).toBe(OCCURRENCE.start_time);
    expect(component.isUnchanged()).toBe(true);
    expect(component.canSave()).toBe(false);

    component.onConfirm();
    expect(updateOccurrence).not.toHaveBeenCalled();
  });

  it('sends only the new start and duration, then closes with the new start', async () => {
    const component = await mount();

    component.form.patchValue({ startTime: '2:30 PM', duration: 45 });

    expect(component.canSave()).toBe(true);
    component.onConfirm();

    expect(updateOccurrence).toHaveBeenCalledWith('meeting-1', '1893492000', { start_time: '2030-01-01T14:30:00.000Z', duration: 45 });
    expect(close).toHaveBeenCalledWith({ confirmed: true, start_time: '2030-01-01T14:30:00.000Z' });
  });

  it('treats a duration-only change as a change', async () => {
    const component = await mount();

    component.form.patchValue({ duration: 60 });

    expect(component.isUnchanged()).toBe(false);
    expect(component.canSave()).toBe(true);
  });

  it('blocks a start in the past', async () => {
    const component = await mount();

    component.form.patchValue({ startDate: new Date('2020-01-01T00:00:00.000Z') });

    expect(component.form.errors?.['futureDateTime']).toBeTruthy();
    expect(component.canSave()).toBe(false);
  });

  it.each([0, 4, 481])('blocks a duration of %s minutes', async (duration) => {
    const component = await mount();

    component.form.patchValue({ duration });

    expect(component.canSave()).toBe(false);
  });

  it('keeps the dialog open and surfaces the upstream reason on a rejected time', async () => {
    updateOccurrence.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'occurrence overlaps another' } })));
    const component = await mount();

    component.form.patchValue({ duration: 60 });
    component.onConfirm();

    expect(close).not.toHaveBeenCalled();
    expect(component.errorMessage()).toBe('occurrence overlaps another');
    expect(component.isSaving()).toBe(false);
  });

  it('explains a missing permission rather than echoing the status', async () => {
    updateOccurrence.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const component = await mount();

    component.form.patchValue({ duration: 60 });
    component.onConfirm();

    expect(component.errorMessage()).toBe('You do not have permission to edit this occurrence.');
  });

  describe('title and agenda', () => {
    it('prefills the series title and agenda when the occurrence has no override', async () => {
      const component = await mount();

      expect(component.form.get('title')?.value).toBe('Weekly sync');
      expect(component.form.get('description')?.value).toBe('Status round');
    });

    it('prefills the occurrence override over the series values', async () => {
      occurrence = { ...OCCURRENCE, title: 'Planning', description: 'Q3 roadmap' };
      const component = await mount();

      expect(component.form.get('title')?.value).toBe('Planning');
      expect(component.form.get('description')?.value).toBe('Q3 roadmap');
    });

    it('sends a changed title and agenda alongside the unchanged time', async () => {
      const component = await mount();

      component.form.patchValue({ title: '  Demo day ', description: 'Show and tell' });

      expect(component.canSave()).toBe(true);
      component.onConfirm();

      expect(updateOccurrence).toHaveBeenCalledWith('meeting-1', '1893492000', {
        start_time: OCCURRENCE.start_time,
        duration: 30,
        title: 'Demo day',
        description: 'Show and tell',
      });
    });

    it('treats whitespace-only edits to the title as no change', async () => {
      const component = await mount();

      component.form.patchValue({ title: 'Weekly sync  ' });

      expect(component.isUnchanged()).toBe(true);
      expect(component.canSave()).toBe(false);
    });

    it('refuses a blank title', async () => {
      const component = await mount();

      component.form.patchValue({ title: '   ' });
      component.form.get('title')?.markAsTouched();

      expect(component.showTitleError()).toBe(true);
      expect(component.canSave()).toBe(false);
    });

    // Upstream drops an empty agenda, so the write would succeed without clearing anything.
    it('refuses to clear an agenda that has content', async () => {
      const component = await mount();

      component.form.patchValue({ description: '' });
      component.form.get('description')?.markAsTouched();

      expect(component.showAgendaError()).toBe(true);
      expect(component.canSave()).toBe(false);
    });

    it('leaves an empty agenda optional and out of the payload', async () => {
      meeting = { ...MEETING, description: '' } as Meeting;
      const component = await mount();

      component.form.patchValue({ duration: 45 });
      component.onConfirm();

      expect(updateOccurrence).toHaveBeenCalledWith('meeting-1', '1893492000', { start_time: OCCURRENCE.start_time, duration: 45 });
    });

    it('applies the YouTube title cap only when uploads are enabled', async () => {
      meeting = { ...MEETING, youtube_upload_enabled: true } as Meeting;
      const component = await mount();

      component.form.patchValue({ title: 'x'.repeat(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1) });

      expect(component.titleMaxLength).toBe(YOUTUBE_MAX_MEETING_TITLE_LENGTH);
      expect(component.canSave()).toBe(false);
    });
  });

  it('locks the header close button while the save is in flight', async () => {
    const response = new Subject<void>();
    updateOccurrence.mockReturnValue(response);
    const component = await mount();

    component.form.patchValue({ duration: 60 });
    component.onConfirm();
    TestBed.tick();
    expect(config.closable).toBe(false);

    response.error(new HttpErrorResponse({ status: 500 }));
    TestBed.tick();
    expect(config.closable).toBe(true);
  });

  it('shows the duration error up front when the existing occurrence is longer than the form allows', async () => {
    occurrence = { ...OCCURRENCE, duration: 600 };
    const component = await mount();

    expect(component.showDurationError()).toBe(true);
    expect(component.canSave()).toBe(false);
  });

  it('shows the title error up front when the prefilled title is over the YouTube cap', async () => {
    meeting = { ...MEETING, youtube_upload_enabled: true, title: 'x'.repeat(YOUTUBE_MAX_MEETING_TITLE_LENGTH + 1) } as Meeting;
    const component = await mount();

    expect(component.showTitleError()).toBe(true);
    expect(component.canSave()).toBe(false);
  });

  it('closes unconfirmed on cancel without writing', async () => {
    const component = await mount();

    component.onCancel();

    expect(close).toHaveBeenCalledWith({ confirmed: false });
    expect(updateOccurrence).not.toHaveBeenCalled();
  });
});
