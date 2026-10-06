// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence, MeetingStatusKind, MeetingTimeState, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingTimeBannerComponent } from './time-banner.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const DAY = 24 * 60 * 60 * 1000;

// The banner renders the page's shared state; selecting the occurrence and resolving its time state
// and status are the state service's, and tested there.
describe('MeetingTimeBannerComponent', () => {
  let fixture: ComponentFixture<MeetingTimeBannerComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let now: WritableSignal<Date>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let meetingStatus: WritableSignal<MeetingStatusKind | null>;
  // Three days and an hour out: "in 3 days" even after the relative-time helper rounds down.
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
    selectedOccurrence = signal<MeetingOccurrence | null>(null);
    timeState = signal<MeetingTimeState | null>('before');
    meetingStatus = signal<MeetingStatusKind | null>('upcoming');

    await TestBed.configureTestingModule({
      imports: [MeetingTimeBannerComponent],
      providers: [{ provide: MeetingDetailsStateService, useValue: { meeting, now, selectedOccurrence, timeState, meetingStatus } }],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingTimeBannerComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => (query(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function phase(state: MeetingTimeState, status: MeetingStatusKind): void {
    timeState.set(state);
    meetingStatus.set(status);
    fixture.detectChanges();
  }

  it('shows the date and time in the viewer timezone once it resolves after the first render', async () => {
    // The first render matches the server's, which has no viewer timezone: a skeleton, no date. The
    // view's own change detection renders it without running the app's after-render hooks.
    fixture = TestBed.createComponent(MeetingTimeBannerComponent);
    fixture.componentRef.changeDetectorRef.detectChanges();
    expect(query('meeting-time-banner-skeleton')).not.toBeNull();
    expect(query('meeting-time-banner-date')).toBeNull();
    expect(query('meeting-time-banner-time')).toBeNull();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(query('meeting-time-banner-skeleton')).toBeNull();
    expect(query('meeting-time-banner-date')?.textContent?.trim()).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/);
    expect(query('meeting-time-banner-time')?.textContent?.trim()).toMatch(/^\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M$/);
    expect(query('meeting-time-banner-timezone')?.textContent?.trim()).not.toBe('');
  });

  it('names both offsets for a range that crosses a DST change', async () => {
    await fixture.whenStable();
    // 1:30 AM Pacific Daylight Time to 1:30 AM Pacific Standard Time, across the fall-back hour.
    meeting.set(build({ start_time: '2026-11-01T08:30:00Z', duration: 60 }));
    (fixture.componentInstance as unknown as { userTimezone: WritableSignal<string | null> }).userTimezone.set('America/Los_Angeles');
    fixture.detectChanges();

    expect(query('meeting-time-banner-time')?.textContent?.trim()).toBe('1:30 AM – 1:30 AM');
    expect(query('meeting-time-banner-timezone')?.textContent?.trim()).toBe('Pacific Daylight Time – Pacific Standard Time');
  });

  it("dates the banner from the page's selected occurrence", async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const first = query('meeting-time-banner-date')?.textContent?.trim();

    selectedOccurrence.set({ occurrence_id: '2', start_time: new Date(start + 7 * DAY).toISOString(), duration: 60 } as MeetingOccurrence);
    fixture.detectChanges();

    expect(query('meeting-time-banner-date')?.textContent?.trim()).not.toBe(first);
  });

  // The early-join rule is the action slot's now (E2-01); the banner keeps the relative start.
  it('shows only the relative start before the meeting', () => {
    expect(query('meeting-time-banner')?.getAttribute('data-state')).toBe('before');
    expect(text('meeting-time-banner-message')).toBe('Starts in 3 days.');
    expect(query('meeting-time-banner-message')?.textContent).not.toContain('join');
  });

  it.each([
    ['live', 'starting-soon', 'The meeting is starting soon. You can join now.'],
    ['live', 'live', 'The meeting is in progress.'],
    ['ended', 'ended', 'This meeting has ended.'],
  ] as [MeetingTimeState, MeetingStatusKind, string][])('shows one %s message for status %s', (state, status, message) => {
    phase(state, status);

    expect(query('meeting-time-banner')?.getAttribute('data-state')).toBe(state);
    expect(text('meeting-time-banner-message')).toBe(message);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="meeting-time-banner-message"]').length).toBe(1);
  });

  // Screen readers hear each phase change, but not the relative start ticking beside it.
  it('announces the phase sentence from one live region that stays mounted across phases', () => {
    const region = query('meeting-time-banner-phase');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
    expect(region?.textContent).not.toContain('Starts in');
    expect(region?.contains(query('meeting-time-banner-relative'))).toBe(false);

    phase('live', 'live');

    expect(query('meeting-time-banner-phase')).toBe(region);
    expect(region?.textContent?.trim()).toBe('The meeting is in progress.');
    expect(query('meeting-time-banner-relative')).toBeNull();
  });

  it('renders nothing before the meeting has loaded', () => {
    timeState.set(null);
    fixture.detectChanges();

    expect(query('meeting-time-banner')).toBeNull();
  });
});
