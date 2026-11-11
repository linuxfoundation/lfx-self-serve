// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingTranscriptDialogComponent } from '../components/meeting-transcript-dialog/meeting-transcript-dialog.component';
import { MeetingsHomeSummaryDialogComponent } from '../components/meetings-home-summary-dialog/meetings-home-summary-dialog.component';
import { MeetingsHomeDialogsService } from './meetings-home-dialogs.service';

const ROW = { key: 'synthetic-meeting-occ', meeting: {} as Meeting, title: 'Synthetic sync' } as MeetingHomeRow;
const SHARE_URL = 'https://zoom.example/rec';

describe('MeetingsHomeDialogsService', () => {
  let open: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let windowOpen: ReturnType<typeof vi.fn>;
  let service: MeetingsHomeDialogsService;

  beforeEach(() => {
    open = vi.fn().mockReturnValue({});
    copy = vi.fn().mockReturnValue(true);
    toastShow = vi.fn();
    windowOpen = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UiModalService, useValue: { open } },
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show: toastShow } },
        { provide: DOCUMENT, useValue: { defaultView: { open: windowOpen } } },
      ],
    });
    service = TestBed.inject(MeetingsHomeDialogsService);
  });

  it('opens the summary dialog with its data', () => {
    const summary = { uid: 's-1' } as PastMeetingSummary;
    const onChange = vi.fn();

    service.openSummary(ROW, summary, onChange);

    expect(open).toHaveBeenCalledWith(MeetingsHomeSummaryDialogComponent, { data: { row: ROW, summary, onChange } });
  });

  it('passes the drawer origin and pending flag to the summary dialog', () => {
    const summary = {} as PastMeetingSummary;

    service.openSummary(ROW, summary, undefined, { origin: 'drawer', showPending: true });

    expect(open).toHaveBeenCalledWith(MeetingsHomeSummaryDialogComponent, {
      data: { row: ROW, summary, onChange: undefined, origin: 'drawer', showPending: true },
    });
  });

  it('opens the transcript dialog for a past meeting with its origin', () => {
    service.openTranscript('synthetic-past-meeting', ROW, { origin: 'drawer' });

    expect(open).toHaveBeenCalledWith(MeetingTranscriptDialogComponent, {
      data: { row: ROW, pastMeetingId: 'synthetic-past-meeting', origin: 'drawer' },
    });
  });

  it('opens a valid recording link in a new tab and reports an invalid one', () => {
    service.openRecording(SHARE_URL);
    service.openRecording('javascript:alert(1)');

    expect(windowOpen).toHaveBeenCalledOnce();
    expect(windowOpen).toHaveBeenCalledWith(SHARE_URL, '_blank', 'noopener,noreferrer');
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'Failed to open recording' }));
  });

  it('copies the recording link and confirms with a dark toast like the other home toasts', () => {
    service.copyRecordingLink(SHARE_URL);

    expect(copy).toHaveBeenCalledWith(SHARE_URL);
    expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Recording link copied to clipboard' });
  });

  it('shows an error toast when the copy fails', () => {
    copy.mockReturnValue(false);

    service.copyRecordingLink(SHARE_URL);

    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'Failed to copy recording link' }));
  });
});
