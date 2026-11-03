// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeRecordingDialogComponent } from './meetings-home-recording-dialog.component';

const ROW: MeetingHomeRow = {
  key: 'synthetic-meeting-occ',
  meeting: { id: 'synthetic-meeting', title: 'Synthetic sync' } as Meeting,
  occurrence: null,
  title: 'Synthetic sync',
  occurrenceId: null,
  startTime: '',
  durationMinutes: 60,
};
const SHARE_URL = 'https://zoom.example/rec/share/synthetic';

describe('MeetingsHomeRecordingDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let showToast: ReturnType<typeof vi.fn>;

  const render = async (shareUrl = SHARE_URL): Promise<ComponentFixture<MeetingsHomeRecordingDialogComponent>> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: { row: ROW, shareUrl } },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show: showToast } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingsHomeRecordingDialogComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsHomeRecordingDialogComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const click = (fixture: ComponentFixture<MeetingsHomeRecordingDialogComponent>, testId: string): void =>
    (query(fixture, testId)?.querySelector('button') as HTMLButtonElement).click();

  beforeEach(() => {
    TestBed.resetTestingModule();
    close = vi.fn();
    copy = vi.fn().mockReturnValue(true);
    showToast = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the share link under the meeting title, and closes', async () => {
    const fixture = await render();

    expect(query(fixture, 'ui-modal-title')?.textContent?.trim()).toBe('Meeting Recording');
    expect(query(fixture, 'ui-modal-subtitle')?.textContent?.trim()).toBe('Synthetic sync');
    expect(query(fixture, 'meetings-home-dialog-recording-url')?.textContent?.trim()).toBe(SHARE_URL);

    click(fixture, 'meetings-home-dialog-recording-close');
    expect(close).toHaveBeenCalled();
  });

  it.each<[boolean, string]>([
    [true, 'Recording URL copied to clipboard'],
    [false, 'Failed to copy recording URL'],
  ])('copies the link (copied: %s)', async (copied, message) => {
    copy.mockReturnValue(copied);
    const fixture = await render();

    click(fixture, 'meetings-home-dialog-recording-copy');

    expect(copy).toHaveBeenCalledWith(SHARE_URL);
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message }));
  });

  it('opens the recording in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const fixture = await render();

    click(fixture, 'meetings-home-dialog-recording-view');

    expect(open).toHaveBeenCalledWith(SHARE_URL, '_blank', 'noopener,noreferrer');
  });

  it('offers no View Recording for a link that is not http(s)', async () => {
    const fixture = await render('javascript:alert(1)');

    expect(query(fixture, 'meetings-home-dialog-recording-view')).toBeNull();
    expect(query(fixture, 'meetings-home-dialog-recording-copy')).toBeTruthy();
  });
});
