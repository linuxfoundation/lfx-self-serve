// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingHomeRow, PastMeeting, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDialogsService } from '../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';
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
const SHARE_URL = 'https://zoom.example/rec';
const summary = (overrides: Partial<PastMeetingSummary> = {}): PastMeetingSummary =>
  ({ uid: 'synthetic-summary', approved: true, requires_approval: true, summary_data: { content: 'Notes' }, ...overrides }) as PastMeetingSummary;

describe('MeetingHomeArtifactsComponent', () => {
  let fixture: ComponentFixture<MeetingHomeArtifactsComponent>;
  let getPastMeetingSummary: ReturnType<typeof vi.fn>;
  let openRecording: ReturnType<typeof vi.fn>;
  let copyRecordingLink: ReturnType<typeof vi.fn>;
  let openSummary: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let lastMeeting: WritableSignal<MeetingHomeRow | null>;
  let applySummaryChange: ReturnType<typeof vi.fn>;
  let lastMeetingSummary: WritableSignal<PastMeetingSummary | null | undefined>;
  let approvedSummaries: WritableSignal<ReadonlyMap<string, string>>;

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
    getPastMeetingSummary = vi.fn(() => of(summary()));
    openRecording = vi.fn();
    copyRecordingLink = vi.fn();
    openSummary = vi.fn();
    toastShow = vi.fn();
    lastMeeting = signal(null);
    lastMeetingSummary = signal(undefined);
    approvedSummaries = signal(new Map());
    // Records approvals as the store does; the store spec covers the Last card side.
    applySummaryChange = vi.fn((key: string, change: PastMeetingSummary) => {
      if (change.approved || !change.requires_approval) approvedSummaries.update((approved) => new Map(approved).set(key, change.uid));
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { getPastMeetingSummary } },
        { provide: MeetingsHomeDialogsService, useValue: { openRecording, copyRecordingLink, openSummary } },
        { provide: UiToastService, useValue: { show: toastShow } },
        {
          provide: MeetingsHomeStore,
          useValue: {
            lastMeeting,
            lastMeetingSummary,
            approvedSummaries,
            applySummaryChange,
          },
        },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('renders nothing when the feed has no recording link or summary, or the lookup failed', async () => {
    await render(row({ has_recording: false, has_ai_summary: undefined }));

    expect(query('meetings-home-row-artifacts')).toBeNull();
  });

  it('shows only the available artifact', async () => {
    await render(row({ has_recording: true, recording_share_url: SHARE_URL, has_ai_summary: false }));

    expect(query('ui-split-button-main')?.textContent?.trim()).toBe('Recording');
    expect(query('meetings-home-row-summary')).toBeNull();
  });

  it('keeps Recording and AI Summary labelled and 28px at every width', async () => {
    await render(row({ has_recording: true, recording_share_url: SHARE_URL, has_ai_summary: true }));

    expect(query('meetings-home-row-recording')?.textContent?.trim()).toBe('Recording');
    expect(query('meetings-home-row-summary')?.textContent?.trim()).toBe('AI Summary');
    expect(query('ui-split-button-main')?.querySelector('button')?.className).toContain('h-ui-xsmall');
    expect(query('meetings-home-row-summary')?.querySelector('button')?.className).toContain('h-ui-xsmall');
    expect(fixture.nativeElement.querySelector('[data-testid$="-icon"]')).toBeNull();
  });

  it('opens the recording link from the Recording button without fetching it', async () => {
    await render(row({ has_recording: true, recording_share_url: SHARE_URL }));

    await click('ui-split-button-main');

    expect(openRecording.mock.calls).toEqual([[SHARE_URL]]);
  });

  it('copies the recording link from the split half', async () => {
    await render(row({ has_recording: true, recording_share_url: SHARE_URL }));

    const copy = query('ui-split-button-secondary') as HTMLButtonElement;
    copy.click();
    await fixture.whenStable();

    expect(copy.getAttribute('aria-label')).toBe('Copy recording link');
    expect(copyRecordingLink).toHaveBeenCalledWith(SHARE_URL);
    expect(openRecording).not.toHaveBeenCalled();
  });

  it('fetches the summary on click and opens its dialog', async () => {
    const value = row({ has_ai_summary: true });
    await render(value);

    await click('meetings-home-row-summary');

    expect(getPastMeetingSummary).toHaveBeenCalledWith('synthetic-past-key');
    expect(openSummary).toHaveBeenCalledWith(value, summary(), expect.any(Function));
    expect(applySummaryChange).not.toHaveBeenCalled();
  });

  it('offers an organizer "Review summary" until the summary is approved from its dialog', async () => {
    await render(row({ has_ai_summary: true, ai_summary_awaiting_approval: true, ai_summary_uid: 'synthetic-summary' }));
    const button = (): HTMLButtonElement | null | undefined => query('meetings-home-row-summary')?.querySelector('button');

    expect(button()?.textContent?.trim()).toBe('Review summary');
    expect(button()?.className).toContain('text-ui-accent-500');
    expect(button()?.querySelector('i')).toBeNull();

    await click('meetings-home-row-summary');
    const onChange = openSummary.mock.calls[0][2] as (change: PastMeetingSummary) => void;
    onChange(summary());
    await fixture.whenStable();

    expect(button()?.textContent?.trim()).toBe('AI Summary');
    expect(button()?.querySelector('i.fa-sparkles')).not.toBeNull();

    // A row hidden and shown again is a new component over the same, not yet re-indexed feed.
    fixture.destroy();
    await render(row({ has_ai_summary: true, ai_summary_awaiting_approval: true, ai_summary_uid: 'synthetic-summary' }));
    expect(button()?.textContent?.trim()).toBe('AI Summary');

    // A refreshed feed that selects a newer pending summary asks for review again.
    fixture.destroy();
    await render(row({ has_ai_summary: true, ai_summary_awaiting_approval: true, ai_summary_uid: 'newer-summary' }));
    expect(button()?.textContent?.trim()).toBe('Review summary');
  });

  it('keeps "Review summary" after an edit that leaves the summary pending', async () => {
    await render(row({ has_ai_summary: true, ai_summary_awaiting_approval: true, ai_summary_uid: 'synthetic-summary' }));

    await click('meetings-home-row-summary');
    const onChange = openSummary.mock.calls[0][2] as (change: PastMeetingSummary) => void;
    onChange(summary({ approved: false }));
    await fixture.whenStable();

    expect(approvedSummaries().size).toBe(0);
    expect(query('meetings-home-row-summary')?.textContent?.trim()).toBe('Review summary');
  });

  it('follows the Last meeting card when the row is the last meeting', async () => {
    const value = row({ has_ai_summary: true, ai_summary_awaiting_approval: true });
    lastMeeting.set(value);
    await render(value);

    lastMeetingSummary.set(summary());
    await fixture.whenStable();

    expect(query('meetings-home-row-summary')?.textContent?.trim()).toBe('AI Summary');
  });

  it('keeps the Last meeting card in step with a summary edited from its row', async () => {
    const value = row({ has_ai_summary: true });
    lastMeeting.set(value);
    await render(value);

    await click('meetings-home-row-summary');
    const onChange = openSummary.mock.calls[0][2] as (change: PastMeetingSummary) => void;
    onChange(summary({ summary_data: { content: 'Edited' } } as Partial<PastMeetingSummary>));

    expect(applySummaryChange).toHaveBeenCalledWith(value.key, expect.objectContaining({ summary_data: { content: 'Edited' } }));
  });

  it('keeps a summary awaiting approval from an invitee', async () => {
    getPastMeetingSummary.mockReturnValue(of(summary({ approved: false })));
    await render(row({ has_ai_summary: true }));

    await click('meetings-home-row-summary');

    expect(openSummary).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: 'AI Summary unavailable', description: "This summary isn't available yet." })
    );
  });

  it('shows an error toast when the summary is missing or fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getPastMeetingSummary
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })))
      .mockReturnValueOnce(throwError(() => new Error('boom')));
    await render(row({ has_ai_summary: true }));

    await click('meetings-home-row-summary');
    await click('meetings-home-row-summary');

    expect(openSummary).not.toHaveBeenCalled();
    expect(toastShow.mock.calls.map(([config]) => config.description)).toEqual([
      "This summary isn't available yet.",
      "We couldn't load this summary. Please try again.",
    ]);
    expect(console.error).toHaveBeenCalledOnce();
  });
});
