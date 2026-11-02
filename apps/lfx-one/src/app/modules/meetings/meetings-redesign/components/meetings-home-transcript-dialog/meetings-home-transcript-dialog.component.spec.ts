// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, PastMeetingTranscriptContent } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeTranscriptDialogComponent } from './meetings-home-transcript-dialog.component';

const ROW: MeetingHomeRow = {
  key: 'synthetic-meeting-occ',
  meeting: { id: 'synthetic-meeting', title: 'Synthetic sync' } as Meeting,
  occurrence: null,
  title: 'Synthetic sync',
  occurrenceId: null,
  startTime: '',
  durationMinutes: 60,
};
const VTT = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nAlex Example: Welcome everyone.\n\n2\n00:00:05.000 --> 00:00:07.000\nNo speaker here';

describe('MeetingsHomeTranscriptDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  const render = async (content$: Observable<PastMeetingTranscriptContent>): Promise<ComponentFixture<MeetingsHomeTranscriptDialogComponent>> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: { row: ROW } },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
        { provide: MeetingService, useValue: { getPastMeetingTranscriptContent: vi.fn().mockReturnValue(content$) } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingsHomeTranscriptDialogComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsHomeTranscriptDialogComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const click = (fixture: ComponentFixture<MeetingsHomeTranscriptDialogComponent>, testId: string): void =>
    (query(fixture, testId)?.querySelector('button') as HTMLButtonElement).click();

  beforeEach(() => {
    TestBed.resetTestingModule();
    close = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows a spinner while the transcript loads', async () => {
    const fixture = await render(new Subject<PastMeetingTranscriptContent>());

    expect(query(fixture, 'meetings-home-dialog-transcript-loading')?.textContent).toContain('Loading transcript');
    expect(query(fixture, 'meetings-home-dialog-transcript-download')).toBeNull();
  });

  it('shows the cues with speaker and time, and closes', async () => {
    const fixture = await render(of({ content: VTT }));

    expect(TestBed.inject(MeetingService).getPastMeetingTranscriptContent).toHaveBeenCalledWith('synthetic-meeting-occ');
    expect(query(fixture, 'ui-modal-subtitle')?.textContent?.trim()).toBe('Synthetic sync');
    const text = query(fixture, 'meetings-home-dialog-transcript-content')?.textContent ?? '';
    expect(text).toContain('Alex Example');
    expect(text).toContain('00:00:01');
    expect(text).toContain('Welcome everyone.');
    expect(text).toContain('No speaker here');

    click(fixture, 'meetings-home-dialog-transcript-close');
    expect(close).toHaveBeenCalled();
  });

  it.each<[string, Observable<PastMeetingTranscriptContent>]>([
    ['empty', of({ content: '' })],
    ['failed', throwError(() => new Error('synthetic'))],
  ])('shows the empty state when the transcript is %s', async (_label, content$) => {
    const fixture = await render(content$);

    expect(query(fixture, 'meetings-home-dialog-transcript-empty')?.textContent?.trim()).toBe('No transcript content available.');
    expect(query(fixture, 'meetings-home-dialog-transcript-download')).toBeNull();
  });

  it('downloads the fetched file', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = await render(of({ content: VTT }));

    click(fixture, 'meetings-home-dialog-transcript-download');
    vi.runAllTimers();

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const anchor = anchorClick.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe('blob:synthetic');
    expect(anchor.download).toContain('transcript.vtt');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    vi.useRealTimers();
  });
});
