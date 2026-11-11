// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, MeetingTranscriptDialogData, PastMeetingTranscriptContent } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingTranscriptDialogComponent } from './meeting-transcript-dialog.component';

const ROW = {
  key: 'synthetic-past-meeting',
  meeting: { id: 'synthetic-meeting', title: 'Synthetic sync', project_name: 'Synthetic Project' } as Meeting,
  occurrence: null,
  title: 'Synthetic sync',
  occurrenceId: null,
  startTime: new Date(2026, 9, 1, 9, 0).toISOString(),
  durationMinutes: 30,
} as MeetingHomeRow;
const VTT = [
  'WEBVTT',
  '',
  '1',
  '00:00:05.120 --> 00:00:09.000',
  'Alpha Tester: Hello everyone.',
  '',
  '2',
  '00:01:02.000 --> 00:01:04.000',
  'No speaker here.',
].join('\n');

describe('MeetingTranscriptDialogComponent', () => {
  let getContent: ReturnType<typeof vi.fn>;

  const render = async (
    content$: Observable<PastMeetingTranscriptContent>,
    data: Partial<MeetingTranscriptDialogData> = {}
  ): Promise<ComponentFixture<MeetingTranscriptDialogComponent>> => {
    getContent = vi.fn().mockReturnValue(content$);
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: { row: ROW, pastMeetingId: 'synthetic-past-meeting', ...data } },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close: vi.fn() } },
        { provide: MeetingService, useValue: { getPastMeetingTranscriptContent: getContent } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingTranscriptDialogComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingTranscriptDialogComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const queryAll = (fixture: ComponentFixture<MeetingTranscriptDialogComponent>, testId: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));

  beforeEach(() => {
    TestBed.resetTestingModule();
    // jsdom has no ResizeObserver; the modal's scroll fades observe the body.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the past meeting transcript and shows one message per cue', async () => {
    const fixture = await render(of({ content: VTT }));

    expect(getContent).toHaveBeenCalledWith('synthetic-past-meeting');
    expect(query(fixture, 'ui-modal-title')?.textContent?.trim()).toBe('Transcript');
    expect(queryAll(fixture, 'meeting-transcript-dialog-cue')).toHaveLength(2);
    expect(queryAll(fixture, 'meeting-transcript-dialog-speaker').map((el) => el.textContent?.trim())).toEqual(['Alpha Tester']);
    expect(queryAll(fixture, 'meeting-transcript-dialog-time').map((el) => el.textContent?.trim())).toEqual(['00:00:05', '00:01:02']);
    expect(queryAll(fixture, 'meeting-transcript-dialog-text').map((el) => el.textContent?.trim())).toEqual(['Hello everyone.', 'No speaker here.']);
    expect(query(fixture, 'ui-avatar')?.textContent?.trim()).toBe('AT');
    expect(query(fixture, 'ui-modal-actions')?.children).toHaveLength(0);
  });

  it('shows the loading line until the transcript arrives', async () => {
    const content$ = new Subject<PastMeetingTranscriptContent>();
    const fixture = await render(content$);

    expect(query(fixture, 'meeting-transcript-dialog-loading')?.textContent).toContain('Loading transcript…');
    expect(query(fixture, 'ui-spinner')).not.toBeNull();

    content$.next({ content: VTT });
    await fixture.whenStable();
    expect(query(fixture, 'meeting-transcript-dialog-loading')).toBeNull();
  });

  it('shows the empty line only for a blank transcript', async () => {
    const fixture = await render(of({ content: '' }));

    expect(query(fixture, 'meeting-transcript-dialog-empty')?.textContent?.trim()).toBe('No transcript content available.');
    expect(query(fixture, 'meeting-transcript-dialog-error')).toBeNull();
  });

  it('shows an error with Retry for a failed load, and Retry fetches again', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await render(throwError(() => new Error('synthetic failure')));

    expect(query(fixture, 'meeting-transcript-dialog-error')?.textContent).toContain("Couldn't load the transcript");
    expect(query(fixture, 'meeting-transcript-dialog-empty')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith('Failed to load the meeting transcript:', expect.any(Error));
    consoleError.mockRestore();

    getContent.mockReturnValue(of({ content: VTT }));
    query(fixture, 'meeting-transcript-dialog-retry')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(getContent).toHaveBeenCalledTimes(2);
    expect(query(fixture, 'meeting-transcript-dialog-error')).toBeNull();
    expect(queryAll(fixture, 'meeting-transcript-dialog-cue')).toHaveLength(2);
  });

  it('hides the meeting context block when opened from the drawer', async () => {
    const fixture = await render(of({ content: VTT }), { origin: 'drawer' });

    expect(query(fixture, 'meeting-dialog-context-block')).toBeNull();
    expect(query(fixture, 'meeting-dialog-context-divider')).not.toBeNull();
  });

  it('shows the meeting context block when opened from the page', async () => {
    const fixture = await render(of({ content: VTT }));

    expect(query(fixture, 'meeting-dialog-context-title')?.textContent?.trim()).toBe('Synthetic sync');
  });
});
