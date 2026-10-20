// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
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
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let now: WritableSignal<Date>;
  let reload: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  const build = (extra: Partial<Meeting> = {}): Meeting =>
    ({ id: 'meeting-1', start_time: new Date(Date.now() + 30 * 60_000).toISOString(), duration: 60, ...extra }) as Meeting;

  async function setup(platform: 'browser' | 'server' = 'browser', initial: Meeting = build({ host_key: KEY, can_view_host_key: true })): Promise<void> {
    TestBed.resetTestingModule();
    meeting = signal<Meeting | undefined>(initial);
    timeState = signal<MeetingTimeState | null>('before');
    loadedViaPastMeetingId = signal(false);
    selectedOccurrence = signal<MeetingOccurrence | null>(null);
    now = signal(new Date());
    reload = vi.fn();
    copy = vi.fn().mockReturnValue(true);
    add = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MeetingJoinDetailsComponent],
      providers: [
        { provide: MeetingDetailsStateService, useValue: { meeting, timeState, loadedViaPastMeetingId, selectedOccurrence, now, reload } },
        { provide: Clipboard, useValue: { copy } },
        { provide: MessageService, useValue: { add } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingJoinDetailsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => setup());

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
    expect(query('join-details-host-key-value')?.getAttribute('aria-live')).toBe('polite');
    expect(query('join-details-host-key')?.textContent).not.toContain(KEY);
    expect(query('join-details-host-key-copy')).toBeNull();
    // No row for a field the payload does not carry (FR-043).
    expect(fixture.nativeElement.textContent).not.toMatch(/Meeting ID|Passcode|Dial-in/);
  });

  it('reveals the key and copies it with a toast', async () => {
    query('join-details-host-key-toggle')?.click();
    await update();

    expect(query('join-details-host-key-toggle')?.getAttribute('aria-pressed')).toBe('true');
    // The toggle keeps one name; the key shows (and is read out) in its own live region.
    expect(query('join-details-host-key-toggle')?.getAttribute('aria-label')).toBe('Show host key');
    expect(query('join-details-host-key-value')?.getAttribute('aria-atomic')).toBe('true');
    expect(query('join-details-host-key-value')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`Host key ${KEY}`);

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
    ['once its window has closed on a page left open', () => now.set(new Date(Date.now() + 3 * HOUR))],
  ])('renders nothing %s', async (_case, arrange) => {
    arrange();
    await update();

    expect(query('join-details-section')).toBeNull();
  });

  describe('for an organizer before the host-key window', () => {
    const later = (): Meeting => build({ organizer: true, start_time: new Date(Date.now() + 5 * HOUR).toISOString() });
    /** The window opens 70 minutes before the start: 3h50m from now. */
    const opensAt = (): number => Date.now() + 5 * HOUR - 70 * 60_000;

    beforeEach(async () => {
      meeting.set(later());
      await update();
    });

    it('says when the key becomes available', () => {
      expect(query('join-details-host-key-pending')?.textContent?.trim()).toBe('Available 70 minutes before the meeting starts');
      expect(query('join-details-host-key-toggle')).toBeNull();
    });

    it('reads the meeting when the window opens, and once more if the key has still not come', async () => {
      expect(reload).not.toHaveBeenCalled();

      now.set(new Date(opensAt() + 10_000));
      await update();
      expect(reload).toHaveBeenCalledTimes(1);
      // Still waiting while it reads: the row stays.
      expect(query('join-details-host-key-pending')).not.toBeNull();

      now.set(new Date(opensAt() + 40_000));
      await update();
      expect(reload).toHaveBeenCalledTimes(1);

      now.set(new Date(opensAt() + 100_000));
      await update();
      expect(reload).toHaveBeenCalledTimes(2);

      // After the second read the section stops waiting.
      now.set(new Date(opensAt() + 200_000));
      await update();
      expect(reload).toHaveBeenCalledTimes(2);
      expect(query('join-details-section')).toBeNull();
    });

    it('reads on waking inside the window, then retries 90s after that read (a sleeping laptop)', async () => {
      now.set(new Date(opensAt() + 10 * 60_000));
      await update();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(query('join-details-host-key-pending')).not.toBeNull();

      now.set(new Date(opensAt() + 10 * 60_000 + 95_000));
      await update();
      expect(reload).toHaveBeenCalledTimes(2);
    });

    it('shows the key once a read returns it, and reads no more', async () => {
      now.set(new Date(opensAt() + 10_000));
      await update();
      meeting.set({ ...later(), host_key: KEY, can_view_host_key: true });
      await update();
      now.set(new Date(opensAt() + 100_000));
      await update();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(query('join-details-host-key-toggle')).not.toBeNull();
    });
  });

  it("needs a fresh read for a later occurrence's window: a page left open never reuses the earlier key", async () => {
    // The payload's key was served for today's occurrence; the page now shows next week's, inside its window.
    const nextWeek = Date.now() + 7 * 24 * HOUR;
    meeting.set(build({ organizer: true, host_key: KEY, can_view_host_key: true }));
    selectedOccurrence.set({ occurrence_id: '2', start_time: new Date(nextWeek).toISOString(), duration: 60 });
    await update();
    expect(query('join-details-host-key-pending')).not.toBeNull();

    now.set(new Date(nextWeek - 60 * 60_000));
    await update();

    expect(query('join-details-host-key-toggle')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the key through a live occurrence that inherits the series' duration", async () => {
    // Started 50 minutes ago, 90 minutes long by the series: the window lasts until 80 minutes from now.
    const start = new Date(Date.now() - 50 * 60_000).toISOString();
    meeting.set(build({ host_key: KEY, can_view_host_key: true, start_time: start, duration: 90 }));
    selectedOccurrence.set({ occurrence_id: '1', start_time: start, duration: 0 });
    await update();

    expect(query('join-details-host-key-toggle')).not.toBeNull();
  });

  it('reads when the window opens on an occurrence the page switched to while both windows were closed', async () => {
    const week = 7 * 24 * HOUR;
    meeting.set(build({ organizer: true, start_time: new Date(Date.now() + 5 * HOUR).toISOString() }));
    selectedOccurrence.set({ occurrence_id: '1', start_time: new Date(Date.now() + 5 * HOUR).toISOString(), duration: 60 });
    await update();
    const later = Date.now() + 5 * HOUR + week;
    selectedOccurrence.set({ occurrence_id: '2', start_time: new Date(later).toISOString(), duration: 60 });
    await update();

    now.set(new Date(later - 60 * 60_000));
    await update();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows a key the server returned to a browser whose clock runs a few minutes behind', async () => {
    // The server, by its clock, is inside the window; the browser is 5 minutes before it opens.
    meeting.set(build({ host_key: KEY, can_view_host_key: true, start_time: new Date(Date.now() + 75 * 60_000).toISOString() }));
    await update();

    expect(query('join-details-host-key-toggle')).not.toBeNull();
  });

  it("times the window from the page's selected occurrence, not the series' next one", async () => {
    // Today's occurrence is inside its window and the server returned its key; the page shows next week's.
    meeting.set(build({ organizer: true, host_key: KEY, can_view_host_key: true }));
    selectedOccurrence.set({ occurrence_id: '2', start_time: new Date(Date.now() + 7 * 24 * HOUR).toISOString(), duration: 60 });
    await update();

    expect(query('join-details-host-key-toggle')).toBeNull();
    expect(query('join-details-host-key-pending')).not.toBeNull();
  });

  it('reads nothing for a page opened inside the window without a key: its own read had the answer', async () => {
    await setup('browser', build({ organizer: true }));
    now.set(new Date(Date.now() + 5 * 60_000));
    await update();

    expect(reload).not.toHaveBeenCalled();
  });

  it('never reads on the server', async () => {
    await setup('server', build({ organizer: true, start_time: new Date(Date.now() + 5 * HOUR).toISOString() }));
    now.set(new Date(Date.now() + 4 * HOUR));
    await update();

    expect(reload).not.toHaveBeenCalled();
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
