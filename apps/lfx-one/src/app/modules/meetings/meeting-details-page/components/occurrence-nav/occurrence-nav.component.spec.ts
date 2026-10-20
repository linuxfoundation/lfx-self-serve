// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Meeting, MeetingOccurrence, PublicMeetingOccurrencesResponse } from '@lfx-one/shared/interfaces';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingOccurrenceNavComponent } from './occurrence-nav.component';

// No hyphen, as a real Zoom-style series id: a composite route id then splits into exactly two parts.
const SERIES = '91234567890';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('MeetingOccurrenceNavComponent', () => {
  let fixture: ComponentFixture<MeetingOccurrenceNavComponent>;
  let meeting: WritableSignal<Meeting | undefined>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let password: WritableSignal<string | null>;
  let urlPassword: WritableSignal<string | null>;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  // Whole-second instants, so an occurrence id (Unix seconds) round-trips to its start.
  const base = Math.floor(Date.now() / 1000) * 1000;
  const at = (offsetMs: number): number => base + offsetMs;
  const occurrence = (startMs: number, extra: Partial<MeetingOccurrence> = {}): MeetingOccurrence => ({
    occurrence_id: String(startMs / 1000),
    start_time: new Date(startMs).toISOString(),
    duration: 60,
    ...extra,
  });
  const past = (startMs: number): PublicMeetingOccurrencesResponse['past'][number] => ({
    meeting_and_occurrence_id: `${SERIES}-${startMs}`,
    scheduled_start_time: new Date(startMs).toISOString(),
    scheduled_end_time: new Date(startMs + HOUR).toISOString(),
  });
  const recurring = (occurrences: MeetingOccurrence[], extra: Partial<Meeting> = {}): Meeting =>
    ({
      id: SERIES,
      start_time: occurrences[0]?.start_time ?? new Date(at(DAY)).toISOString(),
      duration: 60,
      recurrence: { type: 2, repeat_interval: 1 },
      occurrences,
      ...extra,
    }) as Meeting;

  async function setup(
    initial: Meeting,
    series: PublicMeetingOccurrencesResponse = { past: [], future: [] },
    options: {
      routeId?: string;
      /** On the server the state service reads no series, so the nav gets the live occurrences only. */
      platform?: 'browser' | 'server';
      selected?: MeetingOccurrence | null;
      viaPast?: boolean;
      password?: string;
      urlPassword?: string;
    } = {}
  ): Promise<void> {
    TestBed.resetTestingModule();
    meeting = signal<Meeting | undefined>(initial);
    selectedOccurrence = signal<MeetingOccurrence | null>(options.selected ?? null);
    loadedViaPastMeetingId = signal(options.viaPast ?? false);
    password = signal<string | null>(options.password ?? null);
    urlPassword = signal<string | null>(options.urlPassword ?? null);
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: options.routeId ?? SERIES }));
    // The state service reads the series (its own spec covers when, and with which password).
    const seriesOccurrences = signal<PublicMeetingOccurrencesResponse>(options.platform === 'server' ? { past: [], future: [] } : series);

    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceNavComponent],
      providers: [
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting,
            selectedOccurrence,
            loadedViaPastMeetingId,
            password,
            urlPassword,
            seriesOccurrences,
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable(), snapshot: { paramMap: paramMap$.value } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingOccurrenceNavComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const href = (testId: string): string | null => query(testId)?.getAttribute('href') ?? null;
  const counter = (): string | undefined => query('occurrence-nav-section-counter')?.textContent?.replace('Occurrence', '').trim();

  const first = occurrence(at(DAY));
  const second = occurrence(at(8 * DAY));
  const third = occurrence(at(15 * DAY));

  describe('on an upcoming occurrence of a recurring meeting', () => {
    it('counts the selected occurrence and links both neighbours by ?occurrence=', async () => {
      await setup(recurring([first, second, third]), { past: [], future: [] }, { selected: second });

      expect(counter()).toBe('2 of 3');
      expect(href('occurrence-nav-section-prev')).toBe(`/meetings/${SERIES}?occurrence=${at(DAY)}`);
      expect(href('occurrence-nav-section-next')).toBe(`/meetings/${SERIES}?occurrence=${at(15 * DAY)}`);
      expect(query('occurrence-nav-section-prev')?.getAttribute('data-enabled')).toBe('true');
    });

    it('greys out Previous on the first occurrence and Next on the last', async () => {
      await setup(recurring([first, second]), { past: [], future: [] }, { selected: first });

      expect(query('occurrence-nav-section-prev')?.tagName).toBe('SPAN');
      expect(query('occurrence-nav-section-prev')?.getAttribute('aria-disabled')).toBe('true');
      expect(query('occurrence-nav-section-prev')?.getAttribute('data-enabled')).toBe('false');
      expect(href('occurrence-nav-section-next')).not.toBeNull();

      selectedOccurrence.set(second);
      fixture.detectChanges();

      expect(href('occurrence-nav-section-prev')).not.toBeNull();
      expect(query('occurrence-nav-section-next')?.getAttribute('data-enabled')).toBe('false');
    });

    it('merges the series timeline: past records by composite id, cancelled future occurrences left out', async () => {
      const earlier = at(-6 * DAY);
      const cancelled = occurrence(at(22 * DAY));
      await setup(
        recurring([first, second]),
        { past: [past(earlier)], future: [first, second, cancelled], cancelled_occurrences: [cancelled.occurrence_id] },
        { selected: first }
      );

      expect(counter()).toBe('2 of 3');
      expect(href('occurrence-nav-section-prev')).toBe(`/meetings/${SERIES}-${earlier}`);
    });

    it('links an ended occurrence with no past record by its {series}-{start ms} id', async () => {
      const ended = occurrence(at(-3 * DAY));
      await setup(recurring([ended, first]), { past: [], future: [] }, { selected: first });

      expect(href('occurrence-nav-section-prev')).toBe(`/meetings/${SERIES}-${at(-3 * DAY)}`);
    });

    it('leaves out the meeting payload’s cancelled occurrences', async () => {
      await setup(recurring([first, second, third], { cancelled_occurrences: [second.occurrence_id] }), { past: [], future: [] }, { selected: first });

      expect(counter()).toBe('1 of 2');
      expect(href('occurrence-nav-section-next')).toBe(`/meetings/${SERIES}?occurrence=${at(15 * DAY)}`);
    });

    it('renders nothing for a recurring meeting with no occurrences', async () => {
      await setup(recurring([]));

      expect(query('occurrence-nav-section')).toBeNull();
    });
  });

  describe('the meeting password', () => {
    it('forwards a password that is already in the page url', async () => {
      await setup(recurring([first, second]), { past: [], future: [] }, { selected: first, password: 'secret', urlPassword: 'secret' });

      expect(href('occurrence-nav-section-next')).toBe(`/meetings/${SERIES}?password=secret&occurrence=${at(8 * DAY)}`);
    });

    it('keeps a password from navigation state out of the hrefs', async () => {
      await setup(recurring([first, second]), { past: [], future: [] }, { selected: first, password: 'secret' });

      expect(href('occurrence-nav-section-next')).toBe(`/meetings/${SERIES}?occurrence=${at(8 * DAY)}`);
    });

    it('masks the passcode-bearing links from Session Replay', async () => {
      await setup(recurring([first, second, third]), { past: [], future: [] }, { selected: second });

      expect(query('occurrence-nav-section-prev')?.getAttribute('data-dd-privacy')).toBe('mask');
      expect(query('occurrence-nav-section-next')?.getAttribute('data-dd-privacy')).toBe('mask');
    });
  });

  describe('on a past occurrence', () => {
    const one = at(-14 * DAY);
    const two = at(-7 * DAY);
    const pastPayload = { id: `${SERIES}-${two}`, meeting_id: SERIES, start_time: new Date(two).toISOString(), duration: 60 } as unknown as Meeting;

    it('finds itself by its composite route id on a series without a recurrence rule', async () => {
      await setup(pastPayload, { past: [past(one), past(two)], future: [first] }, { routeId: `${SERIES}-${two}`, viaPast: true });

      expect(counter()).toBe('2 of 3');
      expect(href('occurrence-nav-section-prev')).toBe(`/meetings/${SERIES}-${one}`);
      expect(href('occurrence-nav-section-next')).toBe(`/meetings/${SERIES}?occurrence=${at(DAY)}`);
    });

    it('falls back to the start in its route id when the timeline has no record for it', async () => {
      const unlisted = at(-10 * DAY);
      await setup(pastPayload, { past: [past(one), past(two)], future: [first] }, { routeId: `${SERIES}-${unlisted}`, viaPast: true });

      // The first occurrence at or after the route's start, not the clock's ("3 of 3").
      expect(counter()).toBe('2 of 3');
      expect(href('occurrence-nav-section-prev')).toBe(`/meetings/${SERIES}-${one}`);
    });

    it('finds a past record opened by its plain id by the payload’s composite id', async () => {
      const plainPayload = {
        ...pastPayload,
        id: `${SERIES}-${one}`,
        meeting_and_occurrence_id: `${SERIES}-${one}`,
        scheduled_start_time: new Date(one).toISOString(),
      } as unknown as Meeting;
      await setup(plainPayload, { past: [past(one), past(two)], future: [first] }, { routeId: SERIES, viaPast: true });

      // Not the clock's position ("3 of 3"): the first record.
      expect(counter()).toBe('1 of 3');
      expect(href('occurrence-nav-section-next')).toBe(`/meetings/${SERIES}-${two}`);
    });

    it('falls back to a plain-id past record’s scheduled start when the timeline has no record for it', async () => {
      const unlisted = at(-10 * DAY);
      const plainPayload = { ...pastPayload, id: `past-record-${unlisted}`, scheduled_start_time: new Date(unlisted).toISOString() } as unknown as Meeting;
      await setup(plainPayload, { past: [past(one), past(two)], future: [first] }, { routeId: SERIES, viaPast: true });

      expect(counter()).toBe('2 of 3');
    });

    it('renders nothing when the series has nowhere else to go', async () => {
      await setup(pastPayload, { past: [past(two)], future: [] }, { routeId: `${SERIES}-${two}`, viaPast: true });

      expect(query('occurrence-nav-section')).toBeNull();
    });
  });

  it('renders nothing for a one-off meeting', async () => {
    await setup({ id: SERIES, start_time: new Date(at(DAY)).toISOString(), duration: 60 } as Meeting);

    expect(query('occurrence-nav-section')).toBeNull();
  });

  it('renders the live occurrences alone on the server, where the series is not read', async () => {
    await setup(recurring([first, second]), { past: [past(at(-6 * DAY))], future: [] }, { selected: first, platform: 'server' });

    expect(counter()).toBe('1 of 2');
  });
});
