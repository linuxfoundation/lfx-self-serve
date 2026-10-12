// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, PastMeetingRecording, PastMeetingTranscript, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const transcript = (withFile: boolean): PastMeetingTranscript =>
  ({ recording_files: withFile ? [{ file_type: 'TRANSCRIPT', download_url: 'https://storage.example/t.vtt' }] : [] }) as unknown as PastMeetingTranscript;

describe('MeetingRecordingComponent', () => {
  let fixture: ComponentFixture<MeetingRecordingComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let authenticated: WritableSignal<boolean>;
  let meetingService: { getPastMeetingRecording: ReturnType<typeof vi.fn>; getPastMeetingTranscript: ReturnType<typeof vi.fn> };
  let dialogService: { open: ReturnType<typeof vi.fn> };

  const setup = async (rec: () => Observable<PastMeetingRecording>, tx: () => Observable<PastMeetingTranscript>): Promise<void> => {
    meetingService.getPastMeetingRecording.mockImplementation(rec);
    meetingService.getPastMeetingTranscript.mockImplementation(tx);
    await TestBed.configureTestingModule({
      imports: [MeetingRecordingComponent],
      providers: [
        {
          provide: MeetingDetailsStateService,
          useValue: { meeting, matchesRoute: signal(true), loadedViaPastMeetingId, signInHref: signal('/login?returnTo=x') },
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
    meetingService = { getPastMeetingRecording: vi.fn(), getPastMeetingTranscript: vi.fn() };
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
    expect(query('tools-recording-poster')?.getAttribute('href')).toBe('https://zoom.example/large');
    expect(query('tools-recording-poster')?.getAttribute('target')).toBe('_blank');
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
  it('tells "no recording" apart from "no access", for each artifact', async () => {
    await setup(
      () => throwError(() => new HttpErrorResponse({ status: 404 })),
      () => throwError(() => new HttpErrorResponse({ status: 403 }))
    );

    expect(query('tools-recording-unavailable')?.getAttribute('data-reason')).toBe('none');
    expect(query('tools-recording-link')).toBeNull();
    expect(query('tools-recording-poster')).toBeNull();
    expect(query('tools-transcript-unavailable')?.getAttribute('data-reason')).toBe('no-access');
    expect(query('tools-transcript-btn')).toBeNull();
  });

  it('reads a recording without sessions, and a transcript without a transcript file, as none', async () => {
    await setup(
      () => of(recording([])),
      () => of(transcript(false))
    );

    expect(query('tools-recording-unavailable')?.getAttribute('data-reason')).toBe('none');
    expect(query('tools-transcript-unavailable')?.getAttribute('data-reason')).toBe('none');
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
