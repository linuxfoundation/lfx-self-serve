// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingDetailsComponent } from './meeting-details.component';

/**
 * Covers minDate()'s past-date allowance (GH-4944). meeting-manage.component.ts now hydrates
 * Start date from the next upcoming occurrence rather than the series origin when one exists
 * (see getUpcomingMeetingStartTime()), which is the primary fix for an ongoing series. This
 * covers the remaining case: once a series has no future occurrence left, its own start_time is
 * used as-is, and minDate must still keep that value selectable rather than greyed out, mirroring
 * editModeDateTimeValidator()'s existing past-date allowance at the form level.
 */
describe('MeetingDetailsComponent — minDate past-date allowance', () => {
  let fixture: ComponentFixture<MeetingDetailsComponent>;

  // Matches the control names meeting-manage.component.ts's createMeetingFormGroup() builds,
  // since that is the only real caller of this component and the component reaches into most of
  // these controls. Leaves out that form's own validators (including futureDateTimeValidator()) --
  // irrelevant here, since these tests only exercise minDate(), not form validity.
  const buildForm = (startDate: Date | null): FormGroup =>
    new FormGroup({
      meeting_type: new FormControl(''),
      visibility: new FormControl('private'),
      restricted: new FormControl(true),
      title: new FormControl(''),
      description: new FormControl(''),
      aiPrompt: new FormControl(''),
      startDate: new FormControl(startDate),
      startTime: new FormControl(''),
      duration: new FormControl(30),
      customDuration: new FormControl(''),
      timezone: new FormControl('UTC'),
      early_join_time_minutes: new FormControl(10),
      ownerUsername: new FormControl<string | null>(null),
      ownerName: new FormControl<string | null>(null),
      ownerEmail: new FormControl<string | null>(null),
      isRecurring: new FormControl(false),
      recurrenceType: new FormControl('none'),
      patternTypeUI: new FormControl('weekly'),
      recurrence: new FormGroup({
        type: new FormControl(null),
        repeat_interval: new FormControl(1),
        weekly_days: new FormControl(null),
        monthly_day: new FormControl(null),
        monthly_week: new FormControl(null),
        monthly_week_day: new FormControl(null),
        end_date_time: new FormControl(null),
        end_times: new FormControl(null),
        monthlyTypeUI: new FormControl('dayOfMonth'),
        endTypeUI: new FormControl('never'),
      }),
      platform: new FormControl('Zoom'),
      recording_enabled: new FormControl(false),
      transcript_enabled: new FormControl({ value: false, disabled: true }),
      youtube_upload_enabled: new FormControl({ value: false, disabled: true }),
      show_meeting_attendees: new FormControl(false),
      zoom_ai_enabled: new FormControl(false),
      require_ai_summary_approval: new FormControl(false),
      artifact_visibility: new FormControl('organizers'),
      cancel_on_committee_removal: new FormControl('inherit'),
      auto_email_reminder_enabled: new FormControl(false),
      reminderHours: new FormControl({ value: 24, disabled: true }),
      reminderMinutes: new FormControl({ value: 0, disabled: true }),
      attachments: new FormControl([]),
      important_links: new FormArray([]),
      committees: new FormControl([]),
    });

  const createComponent = async (startDate: Date | null, originalStartDate: Date | null): Promise<void> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContext: () => null } },
        { provide: MessageService, useValue: { add: () => {} } },
        { provide: HttpClient, useValue: { get: () => of(null), post: () => of(null), patch: () => of(null), put: () => of(null), delete: () => of(null) } },
      ],
    });

    fixture = TestBed.createComponent(MeetingDetailsComponent);
    fixture.componentRef.setInput('form', buildForm(startDate));
    fixture.componentRef.setInput('originalStartDate', originalStartDate);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('defaults minDate to yesterday when there is no original start date (create mode)', async () => {
    await createComponent(null, null);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    expect(fixture.componentInstance.minDate().getTime()).toBe(yesterday.getTime());
  });

  it('keeps minDate at yesterday when the meeting being edited starts in the future', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await createComponent(future, future);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    expect(fixture.componentInstance.minDate().getTime()).toBe(yesterday.getTime());
  });

  it('lowers minDate to the edited meeting’s own start date when its series already started in the past', async () => {
    const pastSeriesStart = new Date(2026, 6, 15); // July 15, 2026 — matches the reporter's case
    await createComponent(pastSeriesStart, pastSeriesStart);

    const minDate = fixture.componentInstance.minDate();
    expect(minDate.getFullYear()).toBe(2026);
    expect(minDate.getMonth()).toBe(6);
    expect(minDate.getDate()).toBe(15);
  });
});
