// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Meeting,
  MeetingOccurrenceStripItem,
  MeetingTimelineOccurrence,
  PastOccurrenceSummary,
  PublicMeetingOccurrencesResponse,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingOccurrenceStripComponent } from './occurrence-strip.component';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const SERIES = '99152950841';

// The strip reads its series from the paged occurrences endpoint and moves the page through the state
// service; the URL contract and the password rules of that move are the state service's, tested there.
describe('MeetingOccurrenceStripComponent', () => {
  let fixture: ComponentFixture<MeetingOccurrenceStripComponent>;
  let selectedStartMs: WritableSignal<number | null>;
  let navigateToOccurrence: ReturnType<typeof vi.fn>;
  let getPage: ReturnType<typeof vi.fn>;
  // A weekly series: two weeks back, now, and two weeks on, at a fixed hour.
  const base = Math.floor(Date.now() / WEEK) * WEEK + 9 * 60 * 60 * 1000;
  const at = (week: number): number => base + week * WEEK;

  const past = (week: number): PastOccurrenceSummary => ({
    meeting_and_occurrence_id: `${SERIES}-${at(week)}`,
    scheduled_start_time: new Date(at(week)).toISOString(),
  });
  const future = (week: number, extra: Partial<MeetingTimelineOccurrence> = {}): MeetingTimelineOccurrence => ({
    occurrence_id: String(at(week) / 1000),
    start_time: new Date(at(week)).toISOString(),
    duration: 30,
    ...extra,
  });
  const page = (overrides: Partial<PublicMeetingOccurrencesResponse> = {}): PublicMeetingOccurrencesResponse => ({
    past: [past(-2), past(-1)],
    future: [future(1), future(2)],
    past_has_more: false,
    future_has_more: false,
    ...overrides,
  });

  async function render(first: PublicMeetingOccurrencesResponse | HttpErrorResponse, selected: number | null = at(1)): Promise<void> {
    selectedStartMs = signal(selected);
    navigateToOccurrence = vi.fn();
    getPage = vi.fn().mockReturnValue(first instanceof HttpErrorResponse ? throwError(() => first) : of(first));

    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceStripComponent],
      providers: [
        { provide: MeetingService, useValue: { getPublicMeetingOccurrencesPage: getPage } },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting: signal({ id: SERIES, duration: 30 } as Meeting),
            now: signal(new Date()),
            seriesUid: signal(SERIES),
            matchesRoute: signal(true),
            loadedViaPastMeetingId: signal(false),
            password: signal('pw'),
            selectedOccurrenceStartMs: selectedStartMs,
            navigateToOccurrence,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingOccurrenceStripComponent);
    fixture.detectChanges();
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      await Promise.resolve();
      fixture.detectChanges();
    }
  }

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const chip = (week: number): HTMLElement | null => query(`[data-testid="occurrence-chip-${at(week) / 1000}"]`);
  const button = (testId: string): HTMLButtonElement | null => query(`[data-testid="${testId}"] button`) as HTMLButtonElement | null;
  const navigatedTo = (): number | undefined => (navigateToOccurrence.mock.calls.at(-1)?.[0] as MeetingOccurrenceStripItem | undefined)?.startMs;

  afterEach(() => vi.restoreAllMocks());

  describe('with a loaded series', () => {
    beforeEach(async () => render(page({ cancelled_occurrences: [] }), at(-1)));

    it('reads the window around now from the paged endpoint, with the password', () => {
      expect(getPage).toHaveBeenCalledWith(SERIES, 'pw', { pageSize: 12 });
    });

    it('shows one chip per occurrence, past and upcoming, with the state attributes', () => {
      expect(fixture.nativeElement.querySelectorAll('[data-testid^="occurrence-chip-"]')).toHaveLength(4);
      expect(chip(-1)?.getAttribute('data-selected')).toBe('true');
      expect(chip(-1)?.getAttribute('aria-current')).toBe('date');
      expect(chip(1)?.getAttribute('data-nextup')).toBe('true');
      expect(chip(1)?.getAttribute('data-selected')).toBe('false');
      expect(chip(1)?.getAttribute('aria-current')).toBeNull();
      expect(chip(2)?.getAttribute('data-cancelled')).toBe('false');
    });

    it('moves the page to a chip, and offers a jump to the next meeting from another one', () => {
      chip(2)?.click();
      expect(navigatedTo()).toBe(at(2));

      expect(query('[data-testid="occurrence-strip-jump-next"]')?.textContent).toContain('Jump to next meeting');
      button('occurrence-strip-jump-next')?.click();
      expect(navigatedTo()).toBe(at(1));
    });

    it('says the position once the whole series is loaded', () => {
      expect(query('[data-testid="occurrence-strip-position"]')?.textContent?.trim()).toBe('Occurrence 2 of 4');
    });

    it('steps to the neighbouring occurrence with Previous and Next', () => {
      button('occurrence-strip-prev')?.click();
      expect(navigatedTo()).toBe(at(-2));
      button('occurrence-strip-next')?.click();
      expect(navigatedTo()).toBe(at(1));
    });

    it('holds one tab stop, on the selected chip, moved by the arrow keys', () => {
      expect(chip(-1)?.getAttribute('tabindex')).toBe('0');
      expect(chip(1)?.getAttribute('tabindex')).toBe('-1');

      chip(-1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      fixture.detectChanges();
      expect(chip(1)?.getAttribute('tabindex')).toBe('0');
      expect(chip(-1)?.getAttribute('tabindex')).toBe('-1');

      chip(1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      fixture.detectChanges();
      expect(chip(2)?.getAttribute('tabindex')).toBe('0');
    });
  });

  it('shows a cancelled occurrence, struck through, and never moves the page to it', async () => {
    await render(page({ future: [future(1, { status: 'cancel' }), future(2)] }), at(2));

    expect(chip(1)?.getAttribute('data-cancelled')).toBe('true');
    expect(chip(1)?.getAttribute('aria-disabled')).toBe('true');
    expect(chip(1)?.getAttribute('aria-label')).toContain('cancelled');
    expect(chip(2)?.getAttribute('data-nextup')).toBe('true');

    chip(1)?.click();
    expect(navigateToOccurrence).not.toHaveBeenCalled();
    // Previous skips the cancelled one.
    button('occurrence-strip-prev')?.click();
    expect(navigatedTo()).toBe(at(-1));
  });

  it('hides itself silently when the endpoint refuses the series', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render(new HttpErrorResponse({ status: 403 }));

    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('hides itself for a series with a single occurrence', async () => {
    await render(page({ past: [], future: [future(1)] }));

    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
  });

  it('leaves out the position while more of the series is unread, and pages in at a loaded end', async () => {
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)) }), at(-1));
    expect(query('[data-testid="occurrence-strip-position"]')).toBeNull();

    getPage.mockReturnValue(of(page({ past: [past(-2)], future: [], past_has_more: false })));
    button('occurrence-strip-prev')?.click();
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'pw', { pageSize: 12, direction: 'past', cursor: String(at(-1)) });
    expect(navigatedTo()).toBe(at(-2));
    expect(chip(-2)).not.toBeNull();
  });

  it('pages back toward a selected occurrence older than the first window, so it shows selected', async () => {
    selectedStartMs = signal(at(-5));
    navigateToOccurrence = vi.fn();
    getPage = vi
      .fn()
      .mockReturnValueOnce(of(page({ past: [past(-2), past(-1)], past_has_more: true, past_cursor: String(at(-2)) })))
      .mockReturnValueOnce(of(page({ past: [past(-4), past(-3)], future: [], past_has_more: true, past_cursor: String(at(-4)) })))
      .mockReturnValueOnce(of(page({ past: [past(-6), past(-5)], future: [], past_has_more: false })));

    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceStripComponent],
      providers: [
        { provide: MeetingService, useValue: { getPublicMeetingOccurrencesPage: getPage } },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting: signal({ id: SERIES, duration: 30 } as Meeting),
            now: signal(new Date()),
            seriesUid: signal(SERIES),
            matchesRoute: signal(true),
            loadedViaPastMeetingId: signal(true),
            password: signal(null),
            selectedOccurrenceStartMs: selectedStartMs,
            navigateToOccurrence,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingOccurrenceStripComponent);
    fixture.detectChanges();
    await settle();

    expect(getPage).toHaveBeenCalledTimes(3);
    expect(getPage).toHaveBeenNthCalledWith(1, SERIES, null, { pageSize: 12 });
    expect(chip(-5)?.getAttribute('data-selected')).toBe('true');
  });
});
