// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeRecordingDialogComponent } from '../components/meetings-home-recording-dialog/meetings-home-recording-dialog.component';
import { MeetingsHomeSummaryDialogComponent } from '../components/meetings-home-summary-dialog/meetings-home-summary-dialog.component';
import { MeetingsHomeDialogsService } from './meetings-home-dialogs.service';

const ROW = { key: 'synthetic-meeting-occ', meeting: {} as Meeting, title: 'Synthetic sync' } as MeetingHomeRow;

describe('MeetingsHomeDialogsService', () => {
  let open: ReturnType<typeof vi.fn>;
  let service: MeetingsHomeDialogsService;

  beforeEach(() => {
    open = vi.fn().mockReturnValue({});
    TestBed.configureTestingModule({ providers: [{ provide: UiModalService, useValue: { open } }] });
    service = TestBed.inject(MeetingsHomeDialogsService);
  });

  it('opens each dialog with its data', () => {
    const summary = { uid: 's-1' } as PastMeetingSummary;
    const onChange = vi.fn();

    service.openSummary(ROW, summary, onChange);
    service.openRecording(ROW, 'https://zoom.example/rec');

    expect(open).toHaveBeenCalledWith(MeetingsHomeSummaryDialogComponent, { data: { row: ROW, summary, onChange } });
    expect(open).toHaveBeenCalledWith(MeetingsHomeRecordingDialogComponent, { data: { row: ROW, shareUrl: 'https://zoom.example/rec' } });
  });
});
