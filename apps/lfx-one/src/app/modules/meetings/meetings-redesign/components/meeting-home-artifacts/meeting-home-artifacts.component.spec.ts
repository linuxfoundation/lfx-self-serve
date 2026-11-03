// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingHomeRow, PastMeeting, PastMeetingRecording, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDialogsService } from '../../services/meetings-home-dialogs.service';
import { MeetingHomeArtifactsComponent } from './meeting-home-artifacts.component';

const row = (overrides: Partial<PastMeeting> = {}): MeetingHomeRow => {
  const meeting = { id: 'synthetic-past', title: 'Synthetic sync', organizer: false, ...overrides } as PastMeeting;
  return {
    key: 'synthetic-past-key',
    meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: null,
    startTime: '2026-10-01T15:00:00Z',
    durationMinutes: 60,
  };
};
const summary = (overrides: Partial<PastMeetingSummary> = {}): PastMeetingSummary =>
  ({ uid: 'synthetic-summary', approved: true, requires_approval: true, summary_data: { content: 'Notes' }, ...overrides }) as PastMeetingSummary;

describe('MeetingHomeArtifactsComponent', () => {
  let fixture: ComponentFixture<MeetingHomeArtifactsComponent>;
  let getPastMeetingRecording: ReturnType<typeof vi.fn>;
  let getPastMeetingSummary: ReturnType<typeof vi.fn>;
  let openRecording: ReturnType<typeof vi.fn>;
  let openSummary: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;

  const render = async (value: MeetingHomeRow): Promise<void> => {
    fixture = TestBed.createComponent(MeetingHomeArtifactsComponent);
    fixture.componentRef.setInput('row', value);
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const click = async (testId: string): Promise<void> => {
    query(testId)?.querySelector('button')?.click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    getPastMeetingRecording = vi.fn(() =>
      of({
        sessions: [
          { share_url: 'https://zoom.example/small', total_size: 1 },
          { share_url: 'https://zoom.example/large', total_size: 9 },
        ],
      } as PastMeetingRecording)
    );
    getPastMeetingSummary = vi.fn(() => of(summary()));
    openRecording = vi.fn();
    openSummary = vi.fn();
    toastShow = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { getPastMeetingRecording, getPastMeetingSummary } },
        { provide: MeetingsHomeDialogsService, useValue: { openRecording, openSummary } },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('renders nothing when the feed flags no artifact, or the lookup failed', async () => {
    await render(row({ has_recording: false, has_ai_summary: undefined }));

    expect(query('meetings-home-row-artifacts')).toBeNull();
  });

  it('shows only the flagged artifact', async () => {
    await render(row({ has_recording: true, has_ai_summary: false }));

    expect(query('meetings-home-row-recording')?.textContent?.trim()).toBe('Recording');
    expect(query('meetings-home-row-summary')).toBeNull();
    expect(query('meetings-home-row-summary-icon')).toBeNull();
  });

  it('swaps the labelled buttons for icon-only ones with tooltips at a 900px container', async () => {
    await render(row({ has_recording: true, has_ai_summary: true }));

    expect(query('meetings-home-row-artifacts')?.className).toContain('w-[74px]');
    expect(query('meetings-home-row-artifacts')?.className).toContain('@[901px]:w-[256px]');
    for (const [testId, label] of [
      ['meetings-home-row-recording', 'Recording'],
      ['meetings-home-row-summary', 'AI Summary'],
    ]) {
      expect(query(testId)?.className).toContain('hidden @[901px]:inline-block');
      expect(query(testId)?.textContent?.trim()).toBe(label);
      const icon = query(`${testId}-icon`);
      expect(icon?.className).toContain('@[901px]:hidden');
      expect(icon?.textContent?.trim()).toBe('');
      expect(icon?.querySelector('button')?.getAttribute('aria-label')).toBe(label);
    }
  });

  it('fetches the recording on click and opens its dialog with the largest session', async () => {
    const value = row({ has_recording: true });
    await render(value);

    await click('meetings-home-row-recording-icon');

    expect(getPastMeetingRecording).toHaveBeenCalledWith('synthetic-past-key');
    expect(openRecording).toHaveBeenCalledWith(value, 'https://zoom.example/large');
  });

  it('ignores clicks while the recording loads', async () => {
    const pending$ = new Subject<PastMeetingRecording>();
    getPastMeetingRecording.mockReturnValue(pending$);
    await render(row({ has_recording: true }));

    await click('meetings-home-row-recording');
    await click('meetings-home-row-recording');

    expect(getPastMeetingRecording).toHaveBeenCalledOnce();
  });

  it('fetches the summary on click and opens its dialog', async () => {
    const value = row({ has_ai_summary: true });
    await render(value);

    await click('meetings-home-row-summary');

    expect(getPastMeetingSummary).toHaveBeenCalledWith('synthetic-past-key');
    expect(openSummary).toHaveBeenCalledWith(value, summary());
  });

  it('keeps a summary awaiting approval from an invitee', async () => {
    getPastMeetingSummary.mockReturnValue(of(summary({ approved: false })));
    await render(row({ has_ai_summary: true }));

    await click('meetings-home-row-summary');

    expect(openSummary).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'AI Summary unavailable' }));
  });

  it('shows an error toast when the recording is missing or fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getPastMeetingRecording
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })))
      .mockReturnValueOnce(throwError(() => new Error('boom')));
    await render(row({ has_recording: true }));

    await click('meetings-home-row-recording');
    await click('meetings-home-row-recording');

    expect(openRecording).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledTimes(2);
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Recording unavailable', position: 'bottom-center' }));
    expect(console.error).toHaveBeenCalledOnce();
  });
});
