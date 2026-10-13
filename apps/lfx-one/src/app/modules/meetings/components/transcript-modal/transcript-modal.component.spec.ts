// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TranscriptModalComponent } from './transcript-modal.component';

/** #3528: the modal reads the text on the public route only when the V2 page asks it to. */
describe('TranscriptModalComponent transcript source', () => {
  let meetingService: { getPastMeetingTranscriptContent: ReturnType<typeof vi.fn>; getPublicPastMeetingTranscriptContent: ReturnType<typeof vi.fn> };

  const open = (data: Record<string, string>): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TranscriptModalComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: MeetingService, useValue: meetingService },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    TestBed.createComponent(TranscriptModalComponent).detectChanges();
  };

  beforeEach(() => {
    meetingService = {
      getPastMeetingTranscriptContent: vi.fn(() => of({ content: '' })),
      getPublicPastMeetingTranscriptContent: vi.fn(() => of({ content: '' })),
    };
  });

  it('reads the signed-in route by the composite id, as V1 opens it', () => {
    open({ pastMeetingUid: 'meeting-1-1700000000000', meetingTitle: 'Weekly Sync' });

    expect(meetingService.getPastMeetingTranscriptContent).toHaveBeenCalledWith('meeting-1-1700000000000');
    expect(meetingService.getPublicPastMeetingTranscriptContent).not.toHaveBeenCalled();
  });

  it("reads the public route by the past meeting's uid for a viewer with no session", () => {
    open({ publicPastMeetingId: 'pm-1', meetingTitle: 'Weekly Sync' });

    expect(meetingService.getPublicPastMeetingTranscriptContent).toHaveBeenCalledWith('pm-1');
    expect(meetingService.getPastMeetingTranscriptContent).not.toHaveBeenCalled();
  });
});
