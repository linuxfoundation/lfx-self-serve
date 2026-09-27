// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DashboardMeetingCardComponent } from './dashboard-meeting-card.component';

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    created_at: '',
    modified_at: '',
    project_uid: '',
    start_time: '2024-01-04T15:00:00Z',
    duration: 60,
    timezone: 'UTC',
    title: 'LFX Extended Leadership',
    description: '',
    recurrence: null,
    committees: [],
    meeting_type: null,
    visibility: null,
    restricted: null,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: null,
    invited: false,
    occurrences: [],
    ...overrides,
  };
}

describe('DashboardMeetingCardComponent', () => {
  let fixture: ComponentFixture<DashboardMeetingCardComponent>;

  let getPastMeetingRecording: ReturnType<typeof vi.fn>;

  const render = async (meeting: Meeting, options?: { occurrence?: MeetingOccurrence | null; pastMeeting?: boolean }): Promise<void> => {
    getPastMeetingRecording = vi.fn(() => of(null));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DashboardMeetingCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: UserService, useValue: { user: signal(null), authenticated: signal(false) } },
        {
          provide: MeetingService,
          useValue: { getPublicMeetingJoinUrl: vi.fn(() => of(null)), getPastMeetingRecording },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardMeetingCardComponent);
    fixture.componentRef.setInput('meeting', meeting);
    if (options?.occurrence !== undefined) {
      fixture.componentRef.setInput('occurrence', options.occurrence);
    }
    if (options?.pastMeeting !== undefined) {
      fixture.componentRef.setInput('pastMeeting', options.pastMeeting);
    }
    fixture.detectChanges();
  };

  it('shows the next occurrence instead of the recurring series origin', async () => {
    await render(
      buildMeeting({
        start_time: '2024-01-04T15:00:00Z',
        next_occurrence_start_time: '2026-10-01T15:00:00Z',
      })
    );

    expect(fixture.componentInstance.meetingStartTime()).toBe('2026-10-01T15:00:00Z');
  });

  it('prefers an explicit occurrence over next_occurrence_start_time', async () => {
    await render(buildMeeting({ next_occurrence_start_time: '2026-10-01T15:00:00Z' }), {
      occurrence: { occurrence_id: 'occ-1', start_time: '2026-10-08T15:00:00Z', duration: 45 },
    });

    expect(fixture.componentInstance.meetingStartTime()).toBe('2026-10-08T15:00:00Z');
  });

  it('keeps a past card on its own start time', async () => {
    await render(buildMeeting({ start_time: '2026-09-01T15:00:00Z', next_occurrence_start_time: '2026-10-01T15:00:00Z' }), {
      pastMeeting: true,
    });

    expect(fixture.componentInstance.meetingStartTime()).toBe('2026-09-01T15:00:00Z');
  });

  it('opens the join window for the next occurrence, not the series origin', async () => {
    const nextStart = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await render(
      buildMeeting({
        start_time: '2024-01-04T15:00:00Z',
        duration: 60,
        next_occurrence_start_time: nextStart,
      })
    );

    expect(fixture.componentInstance.canJoinMeeting()).toBe(true);
  });

  it('does not load a recording for a future occurrence whose series origin is past', async () => {
    const nextStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await render(
      buildMeeting({
        start_time: '2024-01-04T15:00:00Z',
        duration: 60,
        recording_enabled: true,
        next_occurrence_start_time: nextStart,
      })
    );

    expect(getPastMeetingRecording).not.toHaveBeenCalled();
    expect(fixture.componentInstance.recordingShareUrl()).toBeNull();
  });
});
