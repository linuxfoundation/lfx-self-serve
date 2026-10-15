// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence, MeetingTimeState } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingJoinDetailsComponent } from './join-details.component';

const HOUR = 60 * 60 * 1000;
const KEY = '123456';

describe('MeetingJoinDetailsComponent', () => {
  let fixture: ComponentFixture<MeetingJoinDetailsComponent>;
  let meeting: WritableSignal<Meeting | undefined>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let cancelledOccurrence: WritableSignal<MeetingOccurrence | null>;
  let now: WritableSignal<Date>;
  let reload: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  const build = (extra: Partial<Meeting> = {}): Meeting =>
    ({ id: 'meeting-1', start_time: new Date(Date.now() + 30 * 60_000).toISOString(), duration: 60, ...extra }) as Meeting;

  beforeEach(async () => {
    meeting = signal<Meeting | undefined>(build({ host_key: KEY, can_view_host_key: true }));
    timeState = signal<MeetingTimeState | null>('before');
    loadedViaPastMeetingId = signal(false);
    cancelledOccurrence = signal<MeetingOccurrence | null>(null);
    now = signal(new Date());
    reload = vi.fn();
    copy = vi.fn().mockReturnValue(true);
    add = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MeetingJoinDetailsComponent],
      providers: [
        { provide: MeetingDetailsStateService, useValue: { meeting, timeState, loadedViaPastMeetingId, cancelledOccurrence, now, reload } },
        { provide: Clipboard, useValue: { copy } },
        { provide: MessageService, useValue: { add } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingJoinDetailsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const update = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('shows the host key the server returned, masked, with only the host key row', () => {
    expect(query('join-details-section')).not.toBeNull();
    expect(query('join-details-host-key-toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(query('join-details-host-key-toggle')?.getAttribute('aria-label')).toBe('Show host key');
    expect(query('join-details-host-key')?.textContent).not.toContain(KEY);
    expect(query('join-details-host-key-copy')).toBeNull();
    // No row for a field the payload does not carry (FR-043).
    expect(fixture.nativeElement.textContent).not.toMatch(/Meeting ID|Passcode|Dial-in/);
  });

  it('reveals the key and copies it with a toast', async () => {
    query('join-details-host-key-toggle')?.click();
    await update();

    expect(query('join-details-host-key-toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(query('join-details-host-key-toggle')?.getAttribute('aria-label')).toBeNull();
    expect(query('join-details-host-key')?.textContent).toContain(KEY);

    (query('join-details-host-key-copy')?.querySelector('button') as HTMLButtonElement).click();
    expect(copy).toHaveBeenCalledWith(KEY);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Host Key Copied' }));
  });

  it('says when the copy fails', async () => {
    copy.mockReturnValue(false);
    query('join-details-host-key-toggle')?.click();
    await update();

    (query('join-details-host-key-copy')?.querySelector('button') as HTMLButtonElement).click();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Copy Failed' }));
  });

  it('masks the key again when another one arrives', async () => {
    query('join-details-host-key-toggle')?.click();
    await update();
    meeting.set(build({ id: 'meeting-2', host_key: '654321', can_view_host_key: true }));
    await update();

    expect(query('join-details-host-key-toggle')?.getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['without a key from the server', () => meeting.set(build())],
    ['when the server says the viewer may not see it', () => meeting.set(build({ host_key: KEY, can_view_host_key: false }))],
    ['on an ended occurrence', () => timeState.set('ended')],
    ['on a past meeting', () => loadedViaPastMeetingId.set(true)],
    ['on a cancelled occurrence', () => cancelledOccurrence.set({ occurrence_id: '1', start_time: '', duration: 60, status: 'cancel' })],
  ])('renders nothing %s', async (_case, arrange) => {
    arrange();
    await update();

    expect(query('join-details-section')).toBeNull();
  });

  describe('for an organizer before the host-key window', () => {
    beforeEach(async () => {
      meeting.set(build({ organizer: true, start_time: new Date(Date.now() + 5 * HOUR).toISOString() }));
      await update();
    });

    it('says when the key becomes available', () => {
      expect(query('join-details-host-key-pending')?.textContent?.trim()).toBe('Available 70 minutes before the meeting starts');
      expect(query('join-details-host-key-toggle')).toBeNull();
    });

    it('reloads the meeting once when the window opens, so the server can return the key', async () => {
      expect(reload).not.toHaveBeenCalled();

      now.set(new Date(Date.now() + 4 * HOUR));
      await update();
      now.set(new Date(Date.now() + 4 * HOUR + 30_000));
      await update();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(query('join-details-host-key-pending')).toBeNull();
    });
  });

  it('says nothing to a viewer who is not an organizer before the window', async () => {
    meeting.set(build({ start_time: new Date(Date.now() + 5 * HOUR).toISOString() }));
    await update();

    expect(query('join-details-section')).toBeNull();
    now.set(new Date(Date.now() + 4 * HOUR));
    await update();
    expect(reload).not.toHaveBeenCalled();
  });
});
