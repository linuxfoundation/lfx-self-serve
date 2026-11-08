// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingDetailsState, MeetingHomeRow, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { hasMeetingFullAccess } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDialogsService } from '../../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsArtifactsService } from './meeting-details-artifacts.service';
import { MeetingDetailsToolsComponent } from './meeting-details-tools.component';

const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  visibility: 'private',
  restricted: false,
  invited: true,
  organizer: false,
  recurrence: null,
  occurrences: [],
} as unknown as Meeting;

const SUMMARY = {
  uid: 's-1',
  approved: false,
  requires_approval: true,
  summary_data: { content: 'Notes', edited_content: '' },
} as PastMeetingSummary;

describe('MeetingDetailsToolsComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsToolsComponent>;
  let meeting: WritableSignal<Meeting>;
  let state: WritableSignal<MeetingDetailsState>;
  let pastMeetingId: WritableSignal<string | null>;
  let meetingService: Record<string, ReturnType<typeof vi.fn>>;
  let openSummary: ReturnType<typeof vi.fn>;
  let openRecording: ReturnType<typeof vi.fn>;
  let copyRecordingLink: ReturnType<typeof vi.fn>;
  let applySummaryChange: ReturnType<typeof vi.fn>;
  let windowOpen: ReturnType<typeof vi.fn>;

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
  };
  const render = async (overrides: Partial<Meeting> = {}, dateState: MeetingDetailsState = 'far'): Promise<void> => {
    meeting.set({ ...MEETING, ...overrides });
    state.set(dateState);
    pastMeetingId.set(dateState === 'ended' ? 'synthetic-meeting-1762362000000' : null);
    fixture = TestBed.createComponent(MeetingDetailsToolsComponent);
    await settle();
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => find(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const click = async (testId: string): Promise<void> => {
    ((find(testId)?.querySelector('button') ?? find(testId)) as HTMLElement).click();
    await settle();
  };

  beforeEach(() => {
    meeting = signal(MEETING);
    state = signal<MeetingDetailsState>('far');
    pastMeetingId = signal<string | null>(null);
    meetingService = {
      getPastMeetingRecording: vi.fn().mockReturnValue(of({ sessions: [{ total_size: 1, share_url: 'https://zoom.example/rec' }] })),
      getPastMeetingTranscript: vi.fn().mockReturnValue(of({ recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.example/vtt' }] })),
      getPastMeetingSummary: vi.fn().mockReturnValue(of(SUMMARY)),
    };
    openSummary = vi.fn();
    openRecording = vi.fn();
    copyRecordingLink = vi.fn();
    applySummaryChange = vi.fn();
    windowOpen = vi.fn();
    const row = computed<MeetingHomeRow>(() => ({
      key: meeting().id,
      meeting: meeting(),
      occurrence: null,
      title: meeting().title,
      occurrenceId: null,
      startTime: '2026-11-05T18:00:00Z',
      durationMinutes: 60,
    }));
    const context = {
      row,
      meeting,
      shownRow: row,
      state,
      organizer: computed(() => meeting().organizer === true),
      invited: computed(() => !!meeting().invited),
      fullAccess: computed(() => hasMeetingFullAccess(meeting(), { organizer: meeting().organizer === true, member: !!meeting().invited })),
      pastMeetingId,
    };

    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsArtifactsService,
        { provide: MeetingDetailsContext, useValue: context },
        { provide: MeetingService, useValue: meetingService },
        { provide: MeetingsHomeStore, useValue: { applySummaryChange } },
        { provide: MeetingsHomeDialogsService, useValue: { openSummary, openRecording, copyRecordingLink } },
      ],
    });
    TestBed.inject(DOCUMENT).defaultView!.open = windowOpen as unknown as Window['open'];
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('shows nothing before the date ends', async () => {
    await render();
    expect(find('meeting-details-tools-card')).toBeNull();
    expect(meetingService['getPastMeetingSummary']).not.toHaveBeenCalled();
  });

  describe('ended', () => {
    it('offers the recording, the pending summary to an invitee, and the transcript on the meeting page', async () => {
      await render({}, 'ended');

      expect(find('meeting-details-recording')).not.toBeNull();
      expect(text('meeting-details-summary-pending')).toBe('Pending');
      await click('meeting-details-summary');
      expect(openSummary).toHaveBeenCalledWith(expect.objectContaining({ key: 'synthetic-meeting-1762362000000' }), SUMMARY, expect.any(Function), {
        origin: 'drawer',
        showPending: true,
      });

      await click('meeting-details-transcript');
      expect(windowOpen).toHaveBeenCalledWith(expect.stringContaining('/meetings/synthetic-meeting-1762362000000'), '_blank', 'noopener,noreferrer');
    });

    it('opens and copies the recording link', async () => {
      await render({}, 'ended');

      (find('meeting-details-recording')?.querySelector('[data-testid="ui-split-button-main"] button') as HTMLButtonElement).click();
      (find('meeting-details-recording')?.querySelector(':scope > button') as HTMLButtonElement).click();
      expect(openRecording).toHaveBeenCalledWith('https://zoom.example/rec');
      expect(copyRecordingLink).toHaveBeenCalledWith('https://zoom.example/rec');
    });

    it('marks an approved summary', async () => {
      meetingService['getPastMeetingSummary'].mockReturnValue(of({ ...SUMMARY, approved: true }));
      await render({}, 'ended');

      expect(text('meeting-details-summary-approved')).toBe('Approved');
      expect(find('meeting-details-summary-pending')).toBeNull();
    });

    it('shows the approval made in the summary dialog here and on the list', async () => {
      await render({}, 'ended');
      await click('meeting-details-summary');
      const onChange = openSummary.mock.calls[0][2] as (summary: PastMeetingSummary) => void;
      onChange({ ...SUMMARY, approved: true });
      await settle();

      expect(applySummaryChange).toHaveBeenCalledWith('synthetic-meeting-1762362000000', { ...SUMMARY, approved: true });

      expect(text('meeting-details-summary-approved')).toBe('Approved');
      expect(find('meeting-details-summary-pending')).toBeNull();
    });

    it('greys out what does not exist', async () => {
      meetingService['getPastMeetingRecording'].mockReturnValue(of({ sessions: [] }));
      meetingService['getPastMeetingTranscript'].mockReturnValue(of({ recording_files: [] }));
      meetingService['getPastMeetingSummary'].mockReturnValue(of({ ...SUMMARY, summary_data: { content: ' ', edited_content: '' } }));
      await render({}, 'ended');

      expect((find('meeting-details-recording-unavailable')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect(text('meeting-details-summary-unavailable')).toBe('AI Summary Not Available');
      expect(text('meeting-details-transcript-unavailable')).toBe('Transcript Unavailable');
    });

    it('shows the private notice instead of tools without access', async () => {
      await render({ invited: false }, 'ended');

      expect(find('meeting-details-tools-card')).toBeNull();
      expect(text('meeting-details-private')).toContain('This is a private meeting');
      expect(meetingService['getPastMeetingSummary']).not.toHaveBeenCalled();
    });
  });
});
