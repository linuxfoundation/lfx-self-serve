// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RescheduleOccurrenceDialogComponent } from './reschedule-occurrence-dialog.component';

const MEETING = { id: 'meeting-1', timezone: 'UTC', recurrence: { type: 2, repeat_interval: 1 } } as unknown as Meeting;
const OCCURRENCE = { occurrence_id: '1893492000', start_time: '2030-01-01T10:00:00.000Z', duration: 30 } as MeetingOccurrence;

/**
 * Covers the single-occurrence reschedule dialog.
 * @description Upstream keys an occurrence by its start instant and takes no timezone on the
 * occurrence write, so the dialog reads the new time in the series' own zone and sends only
 * `start_time` + `duration`. An untouched form must not be submittable: it would be a no-op write
 * that still detaches the occurrence from the series pattern upstream.
 */
describe('RescheduleOccurrenceDialogComponent', () => {
  let updateOccurrence: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let occurrence: MeetingOccurrence;
  let meeting: Meeting;

  async function mount(): Promise<RescheduleOccurrenceDialogComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { meeting, occurrence } } },
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

    expect(component.errorMessage()).toBe('You do not have permission to reschedule this occurrence.');
  });

  it('shows the duration error up front when the existing occurrence is longer than the form allows', async () => {
    occurrence = { ...OCCURRENCE, duration: 600 };
    const component = await mount();

    expect(component.showDurationError()).toBe(true);
    expect(component.canSave()).toBe(false);
  });

  it('closes unconfirmed on cancel without writing', async () => {
    const component = await mount();

    component.onCancel();

    expect(close).toHaveBeenCalledWith({ confirmed: false });
    expect(updateOccurrence).not.toHaveBeenCalled();
  });
});
