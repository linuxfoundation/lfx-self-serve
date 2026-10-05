// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingTimeBannerComponent } from './time-banner.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const DAY = 24 * 60 * 60 * 1000;

describe('MeetingTimeBannerComponent', () => {
  let fixture: ComponentFixture<MeetingTimeBannerComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let now: WritableSignal<Date>;
  // Three days and an hour out: the before state whatever day the suite runs, and "in 3 days" even
  // after the relative-time helper rounds the remaining time down.
  const start = Date.now() + 3 * DAY + 60 * 60 * 1000;

  const build = (overrides: Partial<Meeting> = {}): LoadedMeeting =>
    ({
      id: 'meeting-1',
      title: 'Acme Weekly Sync',
      start_time: new Date(start).toISOString(),
      duration: 60,
      occurrences: [],
      cancelled_occurrences: [],
      early_join_time_minutes: 15,
      ...overrides,
      project: { uid: 'p1', name: 'Acme Project', slug: 'acme-project', logo_url: '', parent_uid: '', parent: null },
    }) as unknown as LoadedMeeting;

  beforeEach(async () => {
    meeting = signal<LoadedMeeting | undefined>(build());
    now = signal(new Date());

    await TestBed.configureTestingModule({
      imports: [MeetingTimeBannerComponent],
      providers: [{ provide: MeetingDetailsStateService, useValue: { meeting, now } }],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingTimeBannerComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function tick(at: number): void {
    now.set(new Date(at));
    fixture.detectChanges();
  }

  it('shows the date and time in the viewer timezone once it resolves after the first render', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query('meeting-time-banner-skeleton')).toBeNull();
    expect(query('meeting-time-banner-date')?.textContent?.trim()).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/);
    expect(query('meeting-time-banner-time')?.textContent?.trim()).toMatch(/^\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M$/);
    expect(query('meeting-time-banner-timezone')?.textContent?.trim()).not.toBe('');
  });

  it('shows the relative start and the meeting own early-join rule before the meeting', () => {
    const banner = query('meeting-time-banner');
    expect(banner?.getAttribute('data-state')).toBe('before');
    expect(query('meeting-time-banner-message')?.textContent?.trim()).toBe('Starts in 3 days. You may only join up to 15 minutes before the start time.');
  });

  it('falls back to a 10-minute early-join rule when the meeting sets none', () => {
    meeting.set(build({ early_join_time_minutes: undefined } as Partial<Meeting>));
    fixture.detectChanges();

    expect(query('meeting-time-banner-message')?.textContent).toContain('up to 10 minutes');
  });

  // The page stays open across the meeting: the banner follows the state service's clock.
  it('moves to in progress and then ended as the clock passes the meeting, one message at a time', () => {
    tick(start + 10 * 60 * 1000);
    expect(query('meeting-time-banner')?.getAttribute('data-state')).toBe('live');
    expect(query('meeting-time-banner-message')?.textContent?.trim()).toBe('The meeting is in progress.');

    tick(start + 2 * DAY);
    expect(query('meeting-time-banner')?.getAttribute('data-state')).toBe('ended');
    expect(query('meeting-time-banner-message')?.textContent?.trim()).toBe('This meeting has ended.');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="meeting-time-banner-message"]').length).toBe(1);
  });

  describe('a recurring series left open', () => {
    afterEach(() => vi.useRealTimers());

    // The occurrence selector reads the wall clock, so the test moves it along with the state clock.
    it('moves the date and the phase line to the next occurrence together once one ends', async () => {
      const first = Date.now() + 60 * 60 * 1000;
      const second = first + 7 * DAY;
      meeting.set(
        build({
          start_time: new Date(first).toISOString(),
          recurrence: { type: 2 } as Meeting['recurrence'],
          occurrences: [
            { occurrence_id: '1', start_time: new Date(first).toISOString(), duration: 60 },
            { occurrence_id: '2', start_time: new Date(second).toISOString(), duration: 60 },
          ] as Meeting['occurrences'],
        })
      );
      await fixture.whenStable();
      fixture.detectChanges();
      const firstDay = query('meeting-time-banner-date')?.textContent?.trim();

      // Past the first occurrence's end and its 40-minute buffer.
      const later = first + 2 * 60 * 60 * 1000;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(later);
      tick(later);

      expect(query('meeting-time-banner')?.getAttribute('data-state')).toBe('before');
      expect(query('meeting-time-banner-date')?.textContent?.trim()).not.toBe(firstDay);
      expect(query('meeting-time-banner-message')?.textContent).toContain('Starts in 6 days');
    });
  });

  it('renders nothing before the meeting has loaded', () => {
    meeting.set(undefined);
    fixture.detectChanges();

    expect(query('meeting-time-banner')).toBeNull();
  });
});
