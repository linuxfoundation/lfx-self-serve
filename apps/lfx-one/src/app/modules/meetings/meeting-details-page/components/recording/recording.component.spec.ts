// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingViewerRole, PastMeetingRecording, PastMeetingSummary, PastMeetingTranscript, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingSummaryModalComponent } from '../../../components/meeting-summary-modal/meeting-summary-modal.component';
import { TranscriptModalComponent } from '../../../components/transcript-modal/transcript-modal.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingRecordingComponent } from './recording.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const PAST_ID = 'meeting-1-1700000000000';

const recording = (sessions: { share_url: string; total_size: number }[]): PastMeetingRecording =>
  ({
    uid: 'rec-1',
    past_meeting_id: PAST_ID,
    sessions: sessions.map((s, i) => ({ ...s, start_time: '', uuid: `s${i}` })),
    recording_files: [],
  }) as unknown as PastMeetingRecording;

const summaryRecord = (overrides: { approved?: boolean; requires_approval?: boolean; content?: string; edited_content?: string } = {}): PastMeetingSummary =>
  ({
    uid: 'sum-1',
    approved: overrides.approved ?? true,
    requires_approval: overrides.requires_approval ?? true,
    summary_data: {
      title: 'Weekly Sync summary',
      content: overrides.content ?? '- Agreed the roadmap\n- Shipped the beta',
      edited_content: overrides.edited_content ?? '',
    },
  }) as unknown as PastMeetingSummary;

const transcript = (withFile: boolean): PastMeetingTranscript =>
  ({ recording_files: withFile ? [{ file_type: 'TRANSCRIPT', download_url: 'https://storage.example/t.vtt' }] : [] }) as unknown as PastMeetingTranscript;

describe('MeetingRecordingComponent', () => {
  let fixture: ComponentFixture<MeetingRecordingComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let authenticated: WritableSignal<boolean>;
  let viewerRole: WritableSignal<MeetingViewerRole | null>;
  let meetingService: {
    getPastMeetingRecording: ReturnType<typeof vi.fn>;
    getPastMeetingTranscript: ReturnType<typeof vi.fn>;
    getPastMeetingSummary: ReturnType<typeof vi.fn>;
  };
  let dialogService: { open: ReturnType<typeof vi.fn> };

  const setup = async (rec: () => Observable<PastMeetingRecording>, tx: () => Observable<PastMeetingTranscript>): Promise<void> => {
    meetingService.getPastMeetingRecording.mockImplementation(rec);
    meetingService.getPastMeetingTranscript.mockImplementation(tx);
    await TestBed.configureTestingModule({
      imports: [MeetingRecordingComponent],
      providers: [
        {
          provide: MeetingDetailsStateService,
          useValue: { meeting, matchesRoute: signal(true), loadedViaPastMeetingId, viewerRole, signInHref: signal('/login?returnTo=x') },
        },
        { provide: MeetingService, useValue: meetingService },
        { provide: UserService, useValue: { authenticated } },
        { provide: DialogService, useValue: dialogService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingRecordingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    meeting = signal<LoadedMeeting | undefined>({
      id: 'meeting-1',
      meeting_and_occurrence_id: PAST_ID,
      title: 'Weekly Sync',
      project: {},
    } as unknown as LoadedMeeting);
    loadedViaPastMeetingId = signal(true);
    authenticated = signal(true);
    viewerRole = signal<MeetingViewerRole | null>('registrant');
    meetingService = {
      getPastMeetingRecording: vi.fn(),
      getPastMeetingTranscript: vi.fn(),
      // Default: no summary (the BFF answers 404 for an empty result).
      getPastMeetingSummary: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    };
    dialogService = { open: vi.fn() };
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it("links Watch recording to the largest session's share URL, read for the occurrence", async () => {
    await setup(
      () =>
        of(
          recording([
            { share_url: 'https://zoom.example/small', total_size: 10 },
            { share_url: 'https://zoom.example/large', total_size: 99 },
          ])
        ),
      () => of(transcript(true))
    );

    expect(meetingService.getPastMeetingRecording).toHaveBeenCalledWith(PAST_ID);
    expect(query('tools-recording-link')?.querySelector('a')?.getAttribute('href')).toBe('https://zoom.example/large');
    // The still is decorative: not a link, not focusable.
    expect(query('tools-recording-poster')?.tagName).toBe('DIV');
    expect(query('tools-recording-poster')?.getAttribute('aria-hidden')).toBe('true');
  });

  // E4-02: the BFF measures the linked session; the still shows it, and no length when it could not.
  it("shows the recording's length on the still, and none when it was not measured", async () => {
    const measured = { ...recording([{ share_url: 'https://zoom.example/r', total_size: 1 }]), duration_seconds: 58 * 60 + 24 };
    await setup(
      () => of(measured),
      () => of(transcript(false))
    );

    expect(query('tools-recording-duration')?.textContent?.trim()).toBe('58:24');
    expect(query('tools-recording-link')?.querySelector('a')?.getAttribute('aria-label')).toBe('Watch recording, 58 minutes 24 seconds (opens in a new tab)');
  });

  it('shows no length when the BFF could not measure it', async () => {
    await setup(
      () => of({ ...recording([{ share_url: 'https://zoom.example/r', total_size: 1 }]), duration_seconds: null }),
      () => of(transcript(false))
    );

    expect(query('tools-recording-duration')).toBeNull();
  });

  it("opens V1's transcript modal for the occurrence", async () => {
    await setup(
      () => of(recording([])),
      () => of(transcript(true))
    );

    query('tools-transcript-btn')?.querySelector('button')?.click();

    expect(dialogService.open).toHaveBeenCalledWith(
      TranscriptModalComponent,
      expect.objectContaining({ header: 'Transcript', data: { pastMeetingUid: PAST_ID, meetingTitle: 'Weekly Sync' } })
    );
  });

  // V1's three-state distinction must survive: no artifact is not the same as no access.
  it.each([
    [404, 403, 'none', 'no-access'],
    [403, 404, 'no-access', 'none'],
  ])(
    'tells "none" apart from "no access" for each artifact (recording %s, transcript %s)',
    async (recordingStatus, transcriptStatus, recordingReason, transcriptReason) => {
      await setup(
        () => throwError(() => new HttpErrorResponse({ status: recordingStatus })),
        () => throwError(() => new HttpErrorResponse({ status: transcriptStatus }))
      );

      expect(query('tools-recording-unavailable')?.getAttribute('data-reason')).toBe(recordingReason);
      expect(query('tools-recording-link')).toBeNull();
      expect(query('tools-recording-poster')).toBeNull();
      expect(query('tools-transcript-unavailable')?.getAttribute('data-reason')).toBe(transcriptReason);
      expect(query('tools-transcript-btn')).toBeNull();
    }
  );

  // The artifact routes sit behind the auth middleware: a 401 is an expired session, not a refusal.
  it.each([
    ['recording', 'transcript'],
    ['transcript', 'recording'],
  ])('asks a viewer whose session has expired to sign in (401 on the %s)', async (expired) => {
    const unauthorized = () => throwError(() => new HttpErrorResponse({ status: 401 }));
    await setup(expired === 'recording' ? unauthorized : () => of(recording([])), expired === 'transcript' ? unauthorized : () => of(transcript(true)));

    expect(query('tools-sign-in-link')).not.toBeNull();
    expect(query('tools-recording-unavailable')).toBeNull();
  });

  it('reads the new meeting when the page moves to another one, never showing the last one', async () => {
    await setup(
      () => of(recording([{ share_url: 'https://zoom.example/one', total_size: 1 }])),
      () => of(transcript(true))
    );
    expect(query('tools-recording-link')?.querySelector('a')?.getAttribute('href')).toBe('https://zoom.example/one');

    meetingService.getPastMeetingRecording.mockImplementation(() => of(recording([{ share_url: 'https://zoom.example/two', total_size: 1 }])));
    meeting.set({ id: 'meeting-2', meeting_and_occurrence_id: 'meeting-2-1700000000000', title: 'Other', project: {} } as unknown as LoadedMeeting);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(meetingService.getPastMeetingRecording).toHaveBeenLastCalledWith('meeting-2-1700000000000');
    expect(query('tools-recording-link')?.querySelector('a')?.getAttribute('href')).toBe('https://zoom.example/two');
  });

  it('reads a recording without sessions, and a transcript without a transcript file, as none', async () => {
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-recording-unavailable')?.getAttribute('data-reason')).toBe('none');
    expect(query('tools-transcript-unavailable')?.getAttribute('data-reason')).toBe('none');
  });

  // E4-03: the summary inline, from its markdown, with the full text in V1's modal.
  it('renders an approved summary inline and opens the full text in the summary modal', async () => {
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord()));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-content')?.querySelectorAll('li').length).toBe(2);
    expect(query('tools-summary-btn')?.getAttribute('data-approval')).toBe('approved');
    expect(query('tools-summary-pending')).toBeNull();

    query('tools-summary-btn')?.querySelector('button')?.click();
    expect(dialogService.open).toHaveBeenCalledWith(
      MeetingSummaryModalComponent,
      expect.objectContaining({ header: 'Weekly Sync summary', data: { summary: expect.objectContaining({ uid: 'sum-1' }) } })
    );
  });

  it('prefers the organizer-edited text', async () => {
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord({ edited_content: '- Edited point' })));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-content')?.textContent).toContain('Edited point');
    expect(query('tools-summary-content')?.textContent).not.toContain('Agreed the roadmap');
  });

  it('marks a summary that never required approval not-required, with no pending pill', async () => {
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord({ approved: false, requires_approval: false })));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-btn')?.getAttribute('data-approval')).toBe('not-required');
    expect(query('tools-summary-pending')).toBeNull();
  });

  // The user's decision (E4-03): an unapproved summary is the organizer's to review, not everyone's to read.
  it('shows an unapproved summary to organizers only, marked Pending review', async () => {
    viewerRole.set('organizer');
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord({ approved: false, requires_approval: true })));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-pending')?.textContent?.trim()).toBe('Pending review');
    expect(query('tools-summary-btn')?.getAttribute('data-approval')).toBe('pending');
  });

  it('tells anyone else an unapproved summary is awaiting review, without its text', async () => {
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord({ approved: false, requires_approval: true })));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-unavailable')?.getAttribute('data-reason')).toBe('awaiting-review');
    expect(query('tools-summary-content')).toBeNull();
    expect(query('tools-summary-btn')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Agreed the roadmap');
  });

  it('surfaces no affordance for a summary record without content', async () => {
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord({ content: '  ', edited_content: '' })));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-unavailable')?.getAttribute('data-reason')).toBe('none');
    expect(query('tools-summary-btn')).toBeNull();
  });

  it('reads a pending record without content as none for a non-organizer too', async () => {
    meetingService.getPastMeetingSummary.mockReturnValue(of(summaryRecord({ approved: false, requires_approval: true, content: '', edited_content: '' })));
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-summary-unavailable')?.getAttribute('data-reason')).toBe('none');
  });

  it('names every artifact that failed to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    meetingService.getPastMeetingSummary.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await setup(
      () => throwError(() => new HttpErrorResponse({ status: 500 })),
      () => throwError(() => new HttpErrorResponse({ status: 500 }))
    );

    expect(query('tools-error')?.textContent).toContain("We couldn't load the recording, transcript and AI summary.");
    expect(query('tools-summary-unavailable')?.getAttribute('data-reason')).toBe('error');
  });

  it('shows an error with a retry that reads the artifacts again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    await setup(
      () =>
        ++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(recording([{ share_url: 'https://zoom.example/r', total_size: 1 }])),
      () => of(transcript(true))
    );
    expect(query('tools-error')?.textContent).toContain("We couldn't load the recording.");

    query('tools-retry')?.querySelector('button')?.click();
    fixture.detectChanges();

    expect(query('tools-error')).toBeNull();
    expect(query('tools-recording-link')).not.toBeNull();
  });

  it('asks an anonymous viewer to sign in, without reading anything', async () => {
    authenticated.set(false);
    await setup(
      () => of(recording([])),
      () => of(transcript(true))
    );

    expect(query('tools-sign-in-link')?.getAttribute('href')).toBe('/login?returnTo=x');
    expect(query('tools-sign-in-link')?.getAttribute('data-dd-privacy')).toBe('mask');
    expect(meetingService.getPastMeetingRecording).not.toHaveBeenCalled();
  });

  it('says the artifacts are on their way for an ended meeting opened by its series id', async () => {
    loadedViaPastMeetingId.set(false);
    await setup(
      () => of(recording([])),
      () => of(transcript(true))
    );

    expect(query('tools-pending')?.textContent).toContain('appear here once they are ready');
    expect(meetingService.getPastMeetingRecording).not.toHaveBeenCalled();
  });

  it('never links a recording URL that is not safe to open', async () => {
    await setup(
      () => of(recording([{ share_url: 'javascript:alert(1)', total_size: 1 }])),
      () => of(transcript(false))
    );

    expect(query('tools-recording-link')).toBeNull();
    expect(query('tools-recording-unavailable')?.getAttribute('data-reason')).toBe('none');
  });
});
