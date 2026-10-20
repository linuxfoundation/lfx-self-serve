// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Meeting,
  MeetingOccurrenceStripItem,
  MeetingOccurrenceStripPages,
  MeetingRecurrence,
  MeetingTimelineOccurrence,
  PastOccurrenceSummary,
  PublicMeetingOccurrencesResponse,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingOccurrenceStripComponent } from './occurrence-strip.component';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const SERIES = '99152950841';

// The strip reads its series from the paged occurrences endpoint and moves the page through the state
// service; the URL contract and the password rules of that move are the state service's, tested there.
describe('MeetingOccurrenceStripComponent', () => {
  let fixture: ComponentFixture<MeetingOccurrenceStripComponent>;
  let selectedStartMs: WritableSignal<number | null>;
  let password: WritableSignal<string | null>;
  let navigateToOccurrence: ReturnType<typeof vi.fn>;
  let getPage: ReturnType<typeof vi.fn>;
  // A weekly series around now, at a fixed hour.
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
  const reply = (response: PublicMeetingOccurrencesResponse | HttpErrorResponse): Observable<PublicMeetingOccurrencesResponse> =>
    response instanceof HttpErrorResponse ? throwError(() => response) : of(response);

  interface RenderOptions {
    selected?: number | null;
    recurrence?: MeetingRecurrence | null;
    pastPage?: boolean;
    pages?: (PublicMeetingOccurrencesResponse | HttpErrorResponse | Observable<PublicMeetingOccurrencesResponse>)[];
  }

  async function render(first: PublicMeetingOccurrencesResponse | HttpErrorResponse, options: RenderOptions = {}): Promise<void> {
    selectedStartMs = signal(options.selected === undefined ? at(1) : options.selected);
    password = signal('pw');
    navigateToOccurrence = vi.fn();
    getPage = vi.fn();
    for (const response of [first, ...(options.pages ?? [])]) {
      getPage.mockReturnValueOnce(response instanceof Observable ? response : reply(response));
    }

    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceStripComponent],
      providers: [
        { provide: MeetingService, useValue: { getPublicMeetingOccurrencesPage: getPage } },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting: signal({ id: SERIES, duration: 30, recurrence: options.recurrence === undefined ? { type: 2 } : options.recurrence } as Meeting),
            now: signal(new Date()),
            seriesUid: signal(SERIES),
            matchesRoute: signal(true),
            loadedViaPastMeetingId: signal(!!options.pastPage),
            password,
            selectedOccurrenceStartMs: selectedStartMs,
            navigateToOccurrence,
            occurrenceStripPages: signal(null),
            occurrenceStripFocusMs: signal(null),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingOccurrenceStripComponent);
    fixture.detectChanges();
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) {
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
    const loaded = async (): Promise<void> => render(page({ cancelled_occurrences: [] }), { selected: at(-1) });

    it('reads the window around now from the paged endpoint, with the password', async () => {
      await loaded();
      expect(getPage).toHaveBeenCalledWith(SERIES, 'pw', { pageSize: 12 });
    });

    it('shows one chip per occurrence, past and upcoming, with the state attributes', async () => {
      await loaded();
      expect(fixture.nativeElement.querySelectorAll('[data-testid^="occurrence-chip-"]')).toHaveLength(4);
      expect(chip(-1)?.getAttribute('data-selected')).toBe('true');
      expect(chip(-1)?.getAttribute('aria-current')).toBe('date');
      expect(chip(1)?.getAttribute('data-nextup')).toBe('true');
      expect(chip(1)?.getAttribute('data-selected')).toBe('false');
      expect(chip(1)?.getAttribute('aria-current')).toBeNull();
      expect(chip(1)?.getAttribute('aria-label')).toContain('next meeting');
      expect(chip(2)?.getAttribute('data-cancelled')).toBe('false');
    });

    it('moves the page to a chip, and offers a jump to the next meeting from another one', async () => {
      await loaded();
      chip(2)?.click();
      expect(navigatedTo()).toBe(at(2));

      expect(query('[data-testid="occurrence-strip-jump-next"]')?.textContent).toContain('Jump to next meeting');
      button('occurrence-strip-jump-next')?.click();
      expect(navigatedTo()).toBe(at(1));
    });

    it('says the position once the whole series is loaded', async () => {
      await loaded();
      expect(query('[data-testid="occurrence-strip-position"]')?.textContent?.trim()).toBe('Occurrence 2 of 4');
    });

    it('steps to the neighbouring occurrence with Previous and Next', async () => {
      await loaded();
      button('occurrence-strip-prev')?.click();
      expect(navigatedTo()).toBe(at(-2));
      button('occurrence-strip-next')?.click();
      expect(navigatedTo()).toBe(at(1));
    });

    it('holds one tab stop, on the selected chip, moved by the arrow keys and handed back on a move', async () => {
      await loaded();
      expect(chip(-1)?.getAttribute('tabindex')).toBe('0');
      expect(chip(1)?.getAttribute('tabindex')).toBe('-1');

      chip(-1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      fixture.detectChanges();
      expect(chip(1)?.getAttribute('tabindex')).toBe('0');
      expect(chip(-1)?.getAttribute('tabindex')).toBe('-1');

      chip(1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      fixture.detectChanges();
      expect(chip(2)?.getAttribute('tabindex')).toBe('0');

      // A move through Previous returns the tab stop to the page's selection.
      button('occurrence-strip-prev')?.click();
      selectedStartMs.set(at(-2));
      fixture.detectChanges();
      expect(chip(-2)?.getAttribute('tabindex')).toBe('0');
      expect(chip(2)?.getAttribute('tabindex')).toBe('-1');
    });
  });

  it('shows a cancelled occurrence, struck through, and never moves the page to it', async () => {
    await render(page({ future: [future(1, { status: 'cancel' }), future(2)] }), { selected: at(2) });

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

  it('never shows a cancelled occurrence as selected, even when the page is that occurrence', async () => {
    await render(page({ cancelled_occurrences: [String(at(-1) / 1000)] }), { selected: at(-1), pastPage: true });

    expect(chip(-1)?.getAttribute('data-cancelled')).toBe('true');
    expect(chip(-1)?.getAttribute('data-selected')).toBe('false');
    expect(chip(-1)?.getAttribute('aria-current')).toBeNull();
  });

  it('hides itself when the endpoint refuses the series, or fails', async () => {
    await render(new HttpErrorResponse({ status: 403 }));
    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();

    TestBed.resetTestingModule();
    await render(new HttpErrorResponse({ status: 500 }));
    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
  });

  it('hides itself for a series with a single occurrence', async () => {
    await render(page({ past: [], future: [future(1)] }));

    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
  });

  it('holds the placeholder while loading only for a meeting known to recur', async () => {
    await renderPending(new Subject(), { type: 2 } as MeetingRecurrence);
    expect(query('[data-testid="occurrence-strip-loading"]')).not.toBeNull();

    TestBed.resetTestingModule();
    await renderPending(new Subject(), null);
    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
  });

  it("reads with the page password on a past occurrence's page too", async () => {
    await render(page(), { pastPage: true, selected: at(-1) });

    expect(getPage).toHaveBeenCalledWith(SERIES, 'pw', { pageSize: 12 });
  });

  it('claims no position, and no past end, when the past history could not be read', async () => {
    await render(page({ past: [], future: [future(1), future(2)], past_incomplete: true }));

    expect(query('[data-testid="occurrence-strip-section"]')).not.toBeNull();
    expect(query('[data-testid="occurrence-strip-position"]')).toBeNull();
  });

  it('leaves out the position while more of the series is unread, and pages in at a loaded end', async () => {
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)) }), {
      selected: at(-1),
      pages: [page({ past: [past(-2)], future: [], past_has_more: false })],
    });
    expect(query('[data-testid="occurrence-strip-position"]')).toBeNull();

    button('occurrence-strip-prev')?.click();
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'pw', { pageSize: 12, direction: 'past', cursor: String(at(-1)) });
    expect(navigatedTo()).toBe(at(-2));
    expect(chip(-2)).not.toBeNull();
  });

  it('pages back in the largest pages toward a selected occurrence older than the window', async () => {
    await render(page({ past: [past(-2), past(-1)], past_has_more: true, past_cursor: String(at(-2)) }), {
      selected: at(-5),
      pastPage: true,
      pages: [
        page({ past: [past(-4), past(-3)], future: [], past_has_more: true, past_cursor: String(at(-4)) }),
        page({ past: [past(-6), past(-5)], future: [], past_has_more: false }),
      ],
    });

    expect(getPage).toHaveBeenCalledTimes(3);
    expect(getPage).toHaveBeenNthCalledWith(2, SERIES, 'pw', { pageSize: 50, direction: 'past', cursor: String(at(-2)) });
    expect(chip(-5)?.getAttribute('data-selected')).toBe('true');
  });

  it('keeps chasing past an old cancellation that lies beyond the pages read', async () => {
    await render(page({ past: [past(-2), past(-1)], past_has_more: true, past_cursor: String(at(-2)), cancelled_occurrences: [String(at(-10) / 1000)] }), {
      selected: at(-5),
      pastPage: true,
      pages: [page({ past: [past(-6), past(-5), past(-4), past(-3)], future: [], past_has_more: false })],
    });

    expect(getPage).toHaveBeenCalledTimes(2);
    expect(chip(-5)?.getAttribute('data-selected')).toBe('true');
  });

  it('shows nothing while the page loads another route, even with the series held', async () => {
    const onRoute = signal(false);
    getPage = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceStripComponent],
      providers: [
        { provide: MeetingService, useValue: { getPublicMeetingOccurrencesPage: getPage } },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting: signal({ id: SERIES, duration: 30, recurrence: { type: 2 } } as Meeting),
            now: signal(new Date()),
            seriesUid: signal(SERIES),
            matchesRoute: onRoute,
            loadedViaPastMeetingId: signal(false),
            password: signal('pw'),
            selectedOccurrenceStartMs: signal(at(1)),
            navigateToOccurrence: vi.fn(),
            occurrenceStripPages: signal<MeetingOccurrenceStripPages | null>({
              key: `${SERIES}:pw`,
              past: [past(-1)],
              future: [future(1), future(2)],
              cancelled: [],
              pastHasMore: false,
              futureHasMore: false,
              pastIncomplete: false,
            }),
            occurrenceStripFocusMs: signal(null),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingOccurrenceStripComponent);
    fixture.detectChanges();
    await settle();
    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
    expect(getPage).not.toHaveBeenCalled();

    onRoute.set(true);
    fixture.detectChanges();
    await settle();
    expect(chip(1)).not.toBeNull();
    // Resumed from the held pages, not read again.
    expect(getPage).not.toHaveBeenCalled();
  });

  it('chases a past date by the past page alone, even when the live list still carries an older ended one', async () => {
    await render(page({ past: [past(-3), past(-2)], future: [future(-10), future(1)], past_has_more: true, past_cursor: String(at(-3)) }), {
      selected: at(-5),
      pastPage: true,
      pages: [page({ past: [past(-6), past(-5), past(-4)], future: [], past_has_more: false })],
    });

    expect(getPage).toHaveBeenCalledTimes(2);
    expect(chip(-5)?.getAttribute('data-selected')).toBe('true');
  });

  it('reads the unread past weeks before stepping back past an older ended live entry', async () => {
    await render(page({ past: [past(-2), past(-1)], future: [future(-10), future(1)], past_has_more: true, past_cursor: String(at(-2)) }), {
      selected: at(-2),
      pastPage: true,
      pages: [page({ past: [past(-4), past(-3)], future: [], past_has_more: true, past_cursor: String(at(-4)) })],
    });

    button('occurrence-strip-prev')?.click();
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'pw', { pageSize: 12, direction: 'past', cursor: String(at(-2)) });
    expect(navigatedTo()).toBe(at(-3));
  });

  it('reads the unread past weeks before stepping forward from an older ended live entry', async () => {
    await render(page({ past: [past(-3), past(-2)], future: [future(-10), future(1)], past_has_more: true, past_cursor: String(at(-3)) }), {
      selected: at(-10),
      pages: [page({ past: [past(-12), past(-11), past(-9), past(-8)], future: [], past_has_more: true, past_cursor: String(at(-12)) })],
    });
    // The selection is among the loaded chips: no chase on load.
    expect(getPage).toHaveBeenCalledTimes(1);

    button('occurrence-strip-next')?.click();
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'pw', { pageSize: 12, direction: 'past', cursor: String(at(-3)) });
    expect(navigatedTo()).toBe(at(-9));
  });

  it('keeps reading forward until an occurrence still to come is loaded', async () => {
    await render(page({ past: [past(-2), past(-1)], future: [future(-1, { status: 'cancel' })], future_has_more: true, future_cursor: String(at(-1)) }), {
      selected: at(-1),
      pastPage: true,
      pages: [page({ past: [], future: [future(2)], future_has_more: false })],
    });

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'pw', { pageSize: 12, direction: 'future', cursor: String(at(-1)) });
    expect(chip(2)?.getAttribute('data-nextup')).toBe('true');
    expect(query('[data-testid="occurrence-strip-jump-next"]')).not.toBeNull();
  });

  it("reads the past page holding an ended chip's record before opening it, then opens it by that record", async () => {
    await render(page({ past: [past(-2), past(-1)], future: [future(-10), future(1)], past_has_more: true, past_cursor: String(at(-2)) }), {
      selected: at(-1),
      pages: [page({ past: [past(-11), past(-10), past(-9)], future: [], past_has_more: true, past_cursor: String(at(-11)) })],
    });

    chip(-10)?.click();
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'pw', { pageSize: 50, direction: 'past', cursor: String(at(-2)) });
    expect(navigateToOccurrence.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ startMs: at(-10), pastResourceId: `${SERIES}-${at(-10)}` }));
  });

  describe('opening an ended chip whose record may be unread', () => {
    const window = page({ past: [past(-2), past(-1)], future: [future(-10), future(-3), future(1)], past_has_more: true, past_cursor: String(at(-2)) });
    const lastMove = (): MeetingOccurrenceStripItem | undefined => navigateToOccurrence.mock.calls.at(-1)?.[0];

    it('opens it by ?occurrence= when the read fails, rather than dropping the click', async () => {
      await render(window, { selected: at(-1), pages: [new HttpErrorResponse({ status: 500 })] });

      chip(-10)?.click();
      await settle();

      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-10) }));
      expect(lastMove()?.pastResourceId).toBeUndefined();
    });

    it('hides the strip and opens nothing when the read is refused', async () => {
      await render(window, { selected: at(-1), pages: [new HttpErrorResponse({ status: 403 })] });

      chip(-10)?.click();
      await settle();

      expect(navigateToOccurrence).not.toHaveBeenCalled();
      expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
    });

    it('drops the move when the page moves elsewhere while the read is in flight', async () => {
      const older = new Subject<PublicMeetingOccurrencesResponse>();
      await render(window, { selected: at(-1), pages: [older] });

      chip(-10)?.click();
      await settle();
      selectedStartMs.set(at(1));
      fixture.detectChanges();
      older.next(page({ past: [past(-10)], future: [], past_has_more: false }));
      older.complete();
      await settle();

      expect(navigateToOccurrence).not.toHaveBeenCalled();
    });

    it('lets the last click win when two overlap', async () => {
      const older = new Subject<PublicMeetingOccurrencesResponse>();
      await render(window, { selected: at(-1), pages: [older] });

      chip(-10)?.click();
      await settle();
      // A second ended chip while the first read is still in flight: that read's slot is busy, so this
      // one opens at once by what is known, and the first, now superseded, never navigates.
      chip(-3)?.click();
      await settle();
      older.next(page({ past: [past(-10)], future: [], past_has_more: false }));
      older.complete();
      await settle();

      expect(navigateToOccurrence).toHaveBeenCalledTimes(1);
      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-3) }));
    });

    it('ignores a repeat click on the chip being opened, keeping its record read', async () => {
      const older = new Subject<PublicMeetingOccurrencesResponse>();
      await render(window, { selected: at(-1), pages: [older] });

      chip(-10)?.click();
      await settle();
      chip(-10)?.click();
      await settle();
      older.next(page({ past: [past(-10)], future: [], past_has_more: false }));
      older.complete();
      await settle();

      expect(navigateToOccurrence).toHaveBeenCalledTimes(1);
      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-10), pastResourceId: `${SERIES}-${at(-10)}` }));
    });

    it('opens a chip clicked again after the page moved while its read was pending', async () => {
      const older = new Subject<PublicMeetingOccurrencesResponse>();
      await render(window, { selected: at(-1), pages: [older] });

      chip(-10)?.click();
      await settle();
      // Back to another occurrence of the series (same run), then the same chip again.
      selectedStartMs.set(at(1));
      fixture.detectChanges();
      chip(-10)?.click();
      await settle();
      older.next(page({ past: [past(-10)], future: [], past_has_more: false }));
      older.complete();
      await settle();

      // The new click lands once (the read slot was busy, so by what is known); the first move, whose
      // page moved, does not.
      expect(navigateToOccurrence).toHaveBeenCalledTimes(1);
      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-10) }));
    });

    it("opens a chip clicked again in a new run while the old run's read is still pending", async () => {
      const older = new Subject<PublicMeetingOccurrencesResponse>();
      await render(window, { selected: at(-1), pages: [older] });

      chip(-10)?.click();
      await settle();
      // The password changes: a new run reads its window (no more past pages this time), and the same
      // chip is clicked there before the old run's read settles.
      getPage.mockReturnValueOnce(of(page({ past: [past(-11), past(-10), past(-2), past(-1)], future: [future(-10), future(1)], past_has_more: false })));
      password.set('other');
      fixture.detectChanges();
      await settle();
      chip(-10)?.click();
      await settle();
      older.next(page({ past: [past(-10)], future: [], past_has_more: false }));
      older.complete();
      await settle();

      expect(navigateToOccurrence).toHaveBeenCalledTimes(1);
      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-10), pastResourceId: `${SERIES}-${at(-10)}` }));
    });

    it("keeps the click when its read only brings the page's own occurrence into the strip", async () => {
      // The page shows week -12, outside the first window, and the chase toward it failed: no chip is
      // selected. The click's read then brings week -12 in, though the page itself has not moved.
      await render(window, {
        selected: at(-12),
        pages: [new HttpErrorResponse({ status: 500 }), page({ past: [past(-12), past(-11), past(-10)], future: [], past_has_more: false })],
      });
      expect(fixture.nativeElement.querySelector('[data-selected="true"]')).toBeNull();
      chip(-10)?.click();
      await settle();

      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-10), pastResourceId: `${SERIES}-${at(-10)}` }));
    });

    it('stops after the page limit and opens it by ?occurrence=', async () => {
      const more = (week: number) => page({ past: [past(week)], future: [], past_has_more: true, past_cursor: String(at(week)) });
      // Each page stays newer than the chip, so its record is never reached within the limit.
      await render(window, { selected: at(-1), pages: [more(-4), more(-5), more(-6), more(-7), more(-8), more(-9)] });

      chip(-10)?.click();
      await settle();

      expect(getPage).toHaveBeenCalledTimes(6);
      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-10) }));
      expect(lastMove()?.pastResourceId).toBeUndefined();
    });

    it('reads nothing for an ended chip newer than the oldest record read', async () => {
      await render(page({ past: [past(-4), past(-1)], future: [future(-2), future(1)], past_has_more: true, past_cursor: String(at(-4)) }), {
        selected: at(-1),
      });

      chip(-2)?.click();
      await settle();

      expect(getPage).toHaveBeenCalledTimes(1);
      expect(lastMove()).toEqual(expect.objectContaining({ startMs: at(-2) }));
    });
  });

  it('opens an ended chip by ?occurrence= when the past side holds no record for it', async () => {
    await render(page({ past: [past(-2), past(-1)], future: [future(-10), future(1)], past_has_more: false }), { selected: at(-1) });

    chip(-10)?.click();
    await settle();

    expect(getPage).toHaveBeenCalledTimes(1);
    expect(navigateToOccurrence.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ startMs: at(-10), isPast: true }));
    expect(navigateToOccurrence.mock.calls.at(-1)?.[0].pastResourceId).toBeUndefined();
  });

  it("applies a later page's cancellations to chips already shown", async () => {
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)), cancelled_occurrences: [] }), {
      selected: at(-1),
      pages: [page({ past: [past(-2)], future: [], past_has_more: false, cancelled_occurrences: [String(at(2) / 1000)] })],
    });
    expect(chip(2)?.getAttribute('data-cancelled')).toBe('false');

    button('occurrence-strip-prev')?.click();
    await settle();

    expect(chip(2)?.getAttribute('data-cancelled')).toBe('true');
  });

  it('hides itself when a later page is refused, but keeps its chips when one merely fails', async () => {
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)) }), {
      selected: at(-1),
      pages: [new HttpErrorResponse({ status: 500 })],
    });
    button('occurrence-strip-prev')?.click();
    await settle();
    expect(chip(1)).not.toBeNull();
    expect(navigateToOccurrence).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)) }), {
      selected: at(-1),
      pages: [new HttpErrorResponse({ status: 403 })],
    });
    button('occurrence-strip-prev')?.click();
    await settle();
    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
  });

  it('hides itself when a page read while chasing is refused', async () => {
    await render(page({ past: [past(-2), past(-1)], past_has_more: true, past_cursor: String(at(-2)) }), {
      selected: at(-8),
      pastPage: true,
      pages: [new HttpErrorResponse({ status: 403 })],
    });

    expect(query('[data-testid="occurrence-strip-section"]')).toBeNull();
  });

  it('drops a Previous step whose page arrives after the page moved elsewhere', async () => {
    const older = new Subject<PublicMeetingOccurrencesResponse>();
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)) }), { selected: at(-1), pages: [older] });

    button('occurrence-strip-prev')?.click();
    await settle();
    // The viewer picks another chip before the older page arrives.
    selectedStartMs.set(at(2));
    fixture.detectChanges();
    older.next(page({ past: [past(-2)], future: [], past_has_more: false }));
    older.complete();
    await settle();

    expect(navigateToOccurrence).not.toHaveBeenCalled();
  });

  it('stops chasing after the page limit, still showing what it has', async () => {
    const more = (week: number) => page({ past: [past(week)], future: [], past_has_more: true, past_cursor: String(at(week)) });
    await render(page({ past: [past(-1)], past_has_more: true, past_cursor: String(at(-1)) }), {
      selected: at(-100),
      pastPage: true,
      pages: [more(-2), more(-3), more(-4), more(-5), more(-6), more(-7)],
    });

    expect(getPage).toHaveBeenCalledTimes(6);
    expect(query('[data-testid="occurrence-strip-section"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('drops a read the strip has moved on from, whatever order the replies arrive in', async () => {
    const stale = new Subject<PublicMeetingOccurrencesResponse>();
    const fresh = new Subject<PublicMeetingOccurrencesResponse>();
    await renderPending(stale, { type: 2 } as MeetingRecurrence, [fresh]);

    // The password changes while the first window is still being read: a new run reads it again.
    password.set('other');
    fixture.detectChanges();
    await settle();
    fresh.next(page({ past: [past(-3)], future: [future(3), future(4)] }));
    fresh.complete();
    await settle();
    // The superseded read now fails, then would succeed: it must neither hide the strip nor replace
    // the newer chips.
    stale.error(new HttpErrorResponse({ status: 500 }));
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(SERIES, 'other', { pageSize: 12 });
    expect(query('[data-testid="occurrence-strip-section"]')).not.toBeNull();
    expect(chip(3)).not.toBeNull();
    expect(chip(-1)).toBeNull();
  });

  it('resumes from the pages the state service holds, and takes focus back after a move that rebuilt it', async () => {
    const held = signal<MeetingOccurrenceStripPages | null>({
      key: `${SERIES}:pw`,
      past: [past(-2), past(-1)],
      future: [future(1), future(2)],
      cancelled: [],
      pastHasMore: false,
      futureHasMore: false,
      pastIncomplete: false,
    });
    const focusMs = signal<number | null>(at(-1));
    getPage = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceStripComponent],
      providers: [
        { provide: MeetingService, useValue: { getPublicMeetingOccurrencesPage: getPage } },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting: signal({ id: SERIES, duration: 30, recurrence: null } as Meeting),
            now: signal(new Date()),
            seriesUid: signal(SERIES),
            matchesRoute: signal(true),
            loadedViaPastMeetingId: signal(true),
            password: signal('pw'),
            selectedOccurrenceStartMs: signal(at(-1)),
            navigateToOccurrence: vi.fn(),
            occurrenceStripPages: held,
            occurrenceStripFocusMs: focusMs,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingOccurrenceStripComponent);
    document.body.appendChild(fixture.nativeElement);
    (document.activeElement as HTMLElement | null)?.blur();
    fixture.detectChanges();
    await settle();

    expect(getPage).not.toHaveBeenCalled();
    expect(chip(-1)?.getAttribute('data-selected')).toBe('true');
    expect(document.activeElement).toBe(chip(-1));
    expect(focusMs()).toBeNull();
    fixture.nativeElement.remove();
  });

  /** Renders with the first read (and any later ones) left to the test to settle. */
  async function renderPending(
    first: Subject<PublicMeetingOccurrencesResponse>,
    recurrence: MeetingRecurrence | null,
    later: Subject<PublicMeetingOccurrencesResponse>[] = []
  ): Promise<void> {
    selectedStartMs = signal(at(1));
    password = signal('pw');
    navigateToOccurrence = vi.fn();
    getPage = vi.fn();
    [first, ...later].forEach((subject) => getPage.mockReturnValueOnce(subject));
    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceStripComponent],
      providers: [
        { provide: MeetingService, useValue: { getPublicMeetingOccurrencesPage: getPage } },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting: signal({ id: SERIES, duration: 30, recurrence } as Meeting),
            now: signal(new Date()),
            seriesUid: signal(SERIES),
            matchesRoute: signal(true),
            loadedViaPastMeetingId: signal(recurrence === null),
            password,
            selectedOccurrenceStartMs: selectedStartMs,
            navigateToOccurrence,
            occurrenceStripPages: signal(null),
            occurrenceStripFocusMs: signal(null),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingOccurrenceStripComponent);
    fixture.detectChanges();
    await settle();
  }
});
