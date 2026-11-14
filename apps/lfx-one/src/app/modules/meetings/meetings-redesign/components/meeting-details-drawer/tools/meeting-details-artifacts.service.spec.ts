// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, computed, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingDetailsState, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { hasMeetingFullAccess } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsArtifactsService } from './meeting-details-artifacts.service';

const MEETING = { id: 'synthetic-meeting', visibility: 'private', restricted: false, invited: true, organizer: false } as unknown as Meeting;

describe('MeetingDetailsArtifactsService', () => {
  let meeting: WritableSignal<Meeting>;
  let state: WritableSignal<MeetingDetailsState>;
  let meetingService: Record<string, ReturnType<typeof vi.fn>>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  const create = async (overrides: Partial<Meeting> = {}, dateState: MeetingDetailsState = 'ended'): Promise<MeetingDetailsArtifactsService> => {
    meeting.set({ ...MEETING, ...overrides });
    state.set(dateState);
    const service = TestBed.inject(MeetingDetailsArtifactsService);
    await TestBed.inject(ApplicationRef).whenStable();
    return service;
  };

  beforeEach(() => {
    meeting = signal(MEETING);
    state = signal<MeetingDetailsState>('ended');
    meetingService = {
      getPastMeetingRecording: vi.fn().mockReturnValue(of({ sessions: [{ total_size: 1, share_url: 'https://zoom.example/rec' }] })),
      getPastMeetingTranscript: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 }))),
      getPastMeetingSummary: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 }))),
    };
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const row = computed(() => ({ key: meeting().id, meeting: meeting() }) as MeetingHomeRow);
    const context = {
      row,
      meeting,
      state,
      organizer: computed(() => meeting().organizer === true),
      fullAccess: computed(() => hasMeetingFullAccess(meeting(), { organizer: meeting().organizer === true, member: !!meeting().invited })),
      signedIn: signal(true),
      signedInAccess: computed(() => hasMeetingFullAccess(meeting(), { organizer: meeting().organizer === true, member: !!meeting().invited })),
      pastMeetingId: computed(() => (state() === 'ended' ? 'synthetic-meeting-1762362000000' : null)),
    };
    TestBed.configureTestingModule({
      providers: [MeetingDetailsArtifactsService, { provide: MeetingDetailsContext, useValue: context }, { provide: MeetingService, useValue: meetingService }],
    });
  });

  afterEach(() => consoleError.mockRestore());

  it('loads the ended date’s artifacts and treats a failed lookup as none, logging only a failure other than 404', async () => {
    const service = await create();

    expect(service.artifacts()).toEqual({ recordingUrl: 'https://zoom.example/rec', transcriptUrl: null, summary: null });
    expect(service.flags()).toEqual({ recording: true, transcript: false, summary: false });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Failed to load the past meeting summary:', expect.any(HttpErrorResponse));
  });

  it('counts a blank summary as none', async () => {
    meetingService['getPastMeetingSummary'].mockReturnValue(of({ uid: 's-1', summary_data: { content: '  ', edited_content: '' } }));
    const service = await create();

    expect(service.summaryContent()).toBeNull();
    expect(service.flags()?.summary).toBe(false);
  });

  it('loads nothing before the end', async () => {
    const service = await create({}, 'far');

    expect(service.flags()).toBeNull();
    expect(service.artifacts()).toBeNull();
    expect(meetingService['getPastMeetingSummary']).not.toHaveBeenCalled();
  });

  it('badges from the past feed while loading', async () => {
    meetingService['getPastMeetingSummary'].mockReturnValue(NEVER);
    const service = await create({ scheduled_start_time: '2026-11-01T18:00:00Z', has_recording: true, has_ai_summary: true } as Partial<Meeting>);

    expect(service.artifacts()).toBeUndefined();
    expect(service.flags()).toEqual({ recording: true, transcript: false, summary: true });
  });

  it('loads nothing for a viewer without access', async () => {
    const service = await create({ invited: false });

    expect(service.artifacts()).toBeNull();
    expect(meetingService['getPastMeetingSummary']).not.toHaveBeenCalled();
  });
});
