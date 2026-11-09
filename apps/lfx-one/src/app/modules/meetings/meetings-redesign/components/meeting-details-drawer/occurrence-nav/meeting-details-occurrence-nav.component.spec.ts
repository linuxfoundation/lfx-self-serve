// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingOccurrence, PastMeeting, PastOccurrenceSummary, PublicMeetingOccurrencesResponse } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsOccurrenceNavComponent } from './meeting-details-occurrence-nav.component';

const date = (day: number): MeetingOccurrence => ({
  occurrence_id: String(Date.UTC(2026, 10, day, 17) / 1000),
  start_time: new Date(Date.UTC(2026, 10, day, 17)).toISOString(),
  duration: 30,
});
const WEEKLY = { type: RecurrenceType.WEEKLY, repeat_interval: 1 };
const pastDate = (day: number): PastOccurrenceSummary => ({
  meeting_and_occurrence_id: `synthetic-meeting-${Date.UTC(2026, 10, day, 17)}`,
  scheduled_start_time: new Date(Date.UTC(2026, 10, day, 17)).toISOString(),
});

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'synthetic-meeting',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Synthetic Project',
    project_slug: 'synthetic-project',
    start_time: date(12).start_time,
    duration: 30,
    timezone: 'UTC',
    title: 'Synthetic sync',
    description: '',
    recurrence: WEEKLY,
    committees: [],
    meeting_type: 'Technical',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: 'pw',
    invited: true,
    occurrences: [date(12), { ...date(19), status: 'cancel' }, date(26)],
    ...overrides,
  };
}

function buildRow(meeting: Meeting, start: string): MeetingHomeRow {
  return { key: meeting.id, meeting, occurrence: null, title: meeting.title, occurrenceId: null, startTime: start, durationMinutes: 30 };
}

describe('MeetingDetailsOccurrenceNavComponent', () => {
  let meeting: WritableSignal<Meeting>;
  let row: WritableSignal<MeetingHomeRow>;
  let occurrence: WritableSignal<MeetingOccurrence | null>;
  let series: PublicMeetingOccurrencesResponse;
  let getPublicMeetingOccurrences: ReturnType<typeof vi.fn>;

  const render = async (): Promise<ComponentFixture<MeetingDetailsOccurrenceNavComponent>> => {
    const fixture = TestBed.createComponent(MeetingDetailsOccurrenceNavComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<unknown>, testId: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);
  const click = async (fixture: ComponentFixture<unknown>, testId: string): Promise<void> => {
    (query(fixture, testId)?.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    meeting = signal(buildMeeting());
    occurrence = signal<MeetingOccurrence | null>(date(12));
    series = { past: [pastDate(5)], future: [] };
    getPublicMeetingOccurrences = vi.fn(() => of(series));
    row = signal({ ...buildRow(meeting(), date(12).start_time), occurrenceId: date(12).occurrence_id });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingDetailsContext,
          useValue: {
            row,
            meeting,
            occurrence,
            shownRow: computed(() => ({ ...row(), startTime: occurrence()?.start_time ?? row().startTime })),
            state: signal('far'),
            now: signal(new Date('2026-11-10T12:00:00Z')),
          },
        },
        { provide: MeetingService, useValue: { getPublicMeetingOccurrences } },
      ],
    });
  });

  it('counts the shown date among the past and upcoming dates that run, skipping the cancelled one', async () => {
    const fixture = await render();

    expect(getPublicMeetingOccurrences).toHaveBeenCalledWith('synthetic-meeting', 'pw');
    expect(query(fixture, 'meeting-details-occurrence-menu-button')?.textContent?.trim()).toBe('Occurrence 2 of 3');
  });

  it('steps to the next and previous dates, and stops at the ends', async () => {
    const fixture = await render();

    await click(fixture, 'meeting-details-occurrence-next');
    expect(occurrence()?.start_time).toBe(date(26).start_time);
    expect(query(fixture, 'meeting-details-occurrence-next')?.querySelector('button')?.disabled).toBe(true);

    await click(fixture, 'meeting-details-occurrence-prev');
    await click(fixture, 'meeting-details-occurrence-prev');
    expect(occurrence()?.start_time).toBe(new Date(Date.UTC(2026, 10, 5, 17)).toISOString());
    expect(query(fixture, 'meeting-details-occurrence-prev')?.querySelector('button')?.disabled).toBe(true);
  });

  it('lists upcoming dates with the next and the cancelled one marked, and past dates on the other tab', async () => {
    const fixture = await render();
    await click(fixture, 'meeting-details-occurrence-menu-button');

    const options = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="meeting-details-occurrence-option"]'));
    expect(options().map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringMatching(/Thu, November 12, 2026.*Next$/),
      expect.stringMatching(/Thu, November 19, 2026.*Cancelled$/),
      expect.stringMatching(/Thu, November 26, 2026/),
    ]);
    options()[1].click();
    expect(occurrence()?.start_time).toBe(date(12).start_time);

    (document.querySelector('[data-testid="meeting-details-occurrence-menu"] input[value="past"]') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(options().map((option) => option.textContent)).toEqual([expect.stringContaining('November 5, 2026')]);
    options()[0].click();
    expect(occurrence()?.start_time).toBe(new Date(Date.UTC(2026, 10, 5, 17)).toISOString());
  });

  it('stays hidden for a one-time meeting with a single date', async () => {
    meeting.set(buildMeeting({ recurrence: null, occurrences: [] }));
    series = { past: [], future: [] };
    const fixture = await render();

    expect(query(fixture, 'meeting-details-occurrence-nav')).toBeNull();
  });

  it('keeps a past row among past dates, since an upcoming date needs the live meeting', async () => {
    const past: PastMeeting = {
      ...buildMeeting({ id: `synthetic-meeting-${Date.UTC(2026, 10, 12, 17)}`, recurrence: null, occurrences: [] }),
      scheduled_start_time: date(12).start_time,
      scheduled_end_time: date(12).start_time,
      meeting_id: 'synthetic-meeting',
      occurrence_id: date(12).occurrence_id,
      meeting_and_occurrence_id: `synthetic-meeting-${Date.UTC(2026, 10, 12, 17)}`,
      platform_meeting_id: '',
      sessions: [],
    };
    meeting.set(past);
    row.set(buildRow(past, date(12).start_time));
    occurrence.set(null);
    series = { past: [pastDate(5), pastDate(12)], future: [date(26)] };
    const fixture = await render();

    expect(query(fixture, 'meeting-details-occurrence-menu-button')?.textContent?.trim()).toBe('Occurrence 2 of 2');
    expect(query(fixture, 'meeting-details-occurrence-next')?.querySelector('button')?.disabled).toBe(true);
  });
});
