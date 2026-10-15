// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES, MEETING_OCCURRENCE_STRIP_PAGE_SIZE, MEETING_OCCURRENCES_PAGE_MAX_LIMIT } from '@lfx-one/shared/constants';
import {
  MeetingOccurrenceDirection,
  MeetingOccurrenceStripChip,
  MeetingOccurrenceStripItem,
  MeetingOccurrenceStripPages,
  MeetingOccurrenceStripRequest,
  MeetingOccurrenceStripTimeline,
  PublicMeetingOccurrencesResponse,
} from '@lfx-one/shared/interfaces';
import { buildOccurrenceStripItems, compositeIdToStartMs, getUserTimezone } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { SkeletonModule } from 'primeng/skeleton';
import { firstValueFrom } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 occurrence strip, first in the content column of a meeting in a series (E6-03, #3586, FR-044,
 * FR-047), the prototype's Sidebar layout: a row of date chips with Previous / Next, and "Jump to next
 * meeting" when the page shows another occurrence than the next one.
 * @description Progressive enhancement: the server renders at most its loading placeholder, and the
 * series is read from the paged occurrences endpoint (E6-02) once the browser has the page, so SSR and
 * hydration agree. The placeholder holds the strip's height only for a meeting known to recur
 * (`recurrence` set); a past occurrence's page, whose payload can omit it, shows nothing until a series
 * loads, so a one-off past meeting never collapses a reserved space. A refusal (the endpoint's 400 /
 * 403) of any page, or any failure of the first, hides the strip, as V1's does; so does a series with a
 * single occurrence. A later page that fails otherwise leaves the chips already shown. It
 * starts from the window around now and pages further, toward the page's occurrence when that lies
 * outside it (up to `MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES` of the largest size), and when Previous /
 * Next reach a loaded end. Each read belongs to one run: a newer series or password supersedes it, and
 * nothing it returns is applied after that.
 *
 * Selecting a chip moves the page through {@link MeetingDetailsStateService.navigateToOccurrence},
 * which keeps the URL contract and the password rules. A move within the route (`?occurrence=`) keeps
 * the strip as it is. A move to a past occurrence changes the route id, and the page shows its skeleton
 * until that lookup settles (it never shows one meeting's content under another's URL), so the strip
 * is created again: it resumes from the pages the state service holds instead of reading them again,
 * and puts focus back on the selected chip when the move left none.
 * Cancelled occurrences are shown, struck through, and cannot be selected (the page never selects one);
 * their full state is E6-05's (#3588). The chips scroll sideways rather than the prototype's fixed
 * nine-chip window, which is unreadable on a phone. "Occurrence N of M" appears only once the whole
 * series is known, since a page carries no total; the browse-all dialog it opens is E6-04's (#3587).
 */
@Component({
  selector: 'lfx-meeting-occurrence-strip',
  imports: [ButtonComponent, SkeletonModule],
  templateUrl: './occurrence-strip.component.html',
})
export class MeetingOccurrenceStripComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** The prototype's 32px round Previous / Next. */
  protected readonly roundButtonClass =
    '!h-[32px] !w-[32px] !min-w-0 !rounded-[var(--md-radius-circle)] !border !border-[var(--md-border)] !bg-[var(--md-surface-card)] !p-0 !text-[var(--md-text-body)] shadow-[var(--md-shadow-raise)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)] disabled:!opacity-40';
  /** The prototype's 12.5px text action ("Jump to next meeting"), on one line. */
  protected readonly textButtonClass =
    '!h-auto !whitespace-nowrap !border-0 !bg-transparent !p-0 !text-[12.5px] !font-semibold !text-[var(--md-accent-ink)] hover:!underline focus-visible:!shadow-[var(--md-shadow-focus)]';

  /** `loading` until the first page settles; `hidden` for a refusal, a failure, or a single occurrence. */
  protected readonly status = signal<'loading' | 'ready' | 'hidden'>('loading');
  /** The loaded pages, held by the state service so a strip created again by a move resumes from them. */
  private readonly loaded = this.state.occurrenceStripPages;
  /** The chip holding the strip's one tab stop after an arrow key; the selected one otherwise. */
  private readonly focusStartMs = signal<number | null>(null);
  /** The run whose page is being read, so Previous / Next at a loaded end do not read it twice. */
  private readonly pagingRun = signal<number | null>(null);
  /** Bumped by each new request: a read whose run is no longer this one is dropped. */
  private runId = 0;

  // One formatter per field, in the viewer's zone; the strip only renders its chips on the browser.
  private readonly timezone = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';
  private readonly weekdayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: this.timezone });
  private readonly dayFormat = new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: this.timezone });
  private readonly monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: this.timezone });
  private readonly shortDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: this.timezone });
  private readonly longDateFormat = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: this.timezone,
  });

  /**
   * Whether the page shows the meeting its route names. While another one loads, the page lays out
   * its skeleton with the previous meeting's columns: the strip shows nothing there, so held pages
   * never paint the previous series under the new URL.
   */
  protected readonly onRoute = this.state.matchesRoute;
  /** The loading placeholder holds the strip's height only for a meeting known to recur. */
  protected readonly reservesSpace = computed(() => !!this.state.meeting()?.recurrence);
  protected readonly timeline: Signal<MeetingOccurrenceStripTimeline | null> = this.initTimeline();
  protected readonly items = computed(() => this.timeline()?.items ?? []);
  /** The page's occurrence among the chips; never a cancelled one, which stays visible but is never selected. */
  protected readonly selected = computed(() => this.items().find((item) => !item.cancelled && item.startMs === this.state.selectedOccurrenceStartMs()) ?? null);
  /** The first occurrence that has not ended and is not cancelled: the prototype's next-up dot. */
  protected readonly nextUp = computed(() => this.items().find((item) => !item.isPast && !item.cancelled) ?? null);
  protected readonly showJumpToNext = computed(() => !!this.nextUp() && this.nextUp()?.startMs !== this.selected()?.startMs);
  protected readonly jumpLabel = computed(() => {
    const nextUp = this.nextUp();
    return nextUp ? `Jump to next meeting · ${this.shortDateFormat.format(new Date(nextUp.startMs))}` : '';
  });
  /** "Occurrence N of M", only when the whole series is known. */
  protected readonly position: Signal<{ index: number; total: number } | null> = this.initPosition();
  protected readonly canGoPrevious = computed(() => this.canStep(this.adjacent(-1)));
  protected readonly canGoNext = computed(() => this.canStep(this.adjacent(1)));
  protected readonly chips: Signal<MeetingOccurrenceStripChip[]> = this.initChips();

  private readonly tabStopMs: Signal<number | null> = this.initTabStopMs();
  /** What re-centres the strip: another selected occurrence, or another number of loaded chips. */
  private readonly centerKey = computed(() => ({ startMs: this.selected()?.startMs ?? null, count: this.items().length }), {
    equal: (a, b) => a.startMs === b.startMs && a.count === b.count,
  });
  private readonly request: Signal<MeetingOccurrenceStripRequest | null> = this.initRequest();

  public constructor() {
    toObservable(this.request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((request) => void this.loadWindow(request));

    // Keep the selected chip in view as the page moves between occurrences or more pages arrive, and
    // only then: not on the clock's tick, which would pull back a strip the viewer has scrolled.
    afterRenderEffect(() => {
      const scroller = this.scroller()?.nativeElement;
      const { startMs } = this.centerKey();
      if (!scroller || startMs === null) {
        return;
      }
      const chip = scroller.querySelector<HTMLElement>(`[data-start-ms="${startMs}"]`);
      if (chip) {
        // Measured against the scroller itself: `offsetLeft` would be relative to an ancestor outside it.
        const offset = chip.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
        scroller.scrollLeft = offset - scroller.clientWidth / 2 + chip.clientWidth / 2;
      }
    });

    // A destroyed strip's reads are superseded like any other, so none of them acts after it.
    this.destroyRef.onDestroy(() => this.runId++);

    // After the strip moved the page: a strip created again by that move takes focus back to the
    // chip, when the move left none (the old strip's control went with its view). A move that kept
    // the strip kept its focus too, so the request is only cleared.
    afterRenderEffect(() => {
      const focusMs = this.state.occurrenceStripFocusMs();
      const { startMs } = this.centerKey();
      const scroller = this.scroller()?.nativeElement;
      // Only on the loaded page: the skeleton the page shows meanwhile lays out the columns too, and a
      // strip there is discarded with it.
      if (focusMs === null || focusMs !== startMs || !scroller || !this.state.matchesRoute()) {
        return;
      }
      const active = scroller.ownerDocument.activeElement;
      if (!active || active === scroller.ownerDocument.body) {
        scroller.querySelector<HTMLElement>(`[data-start-ms="${startMs}"]`)?.focus();
      }
      this.state.occurrenceStripFocusMs.set(null);
    });
  }

  protected select(item: MeetingOccurrenceStripItem): void {
    if (!item.cancelled && item.startMs !== this.selected()?.startMs) {
      this.moveTo(item);
    }
  }

  protected jumpToNext(): void {
    const nextUp = this.nextUp();
    if (nextUp) {
      this.moveTo(nextUp);
    }
  }

  protected async step(direction: -1 | 1): Promise<void> {
    // Read whatever side is unread between the selection and its neighbour first (a bounded number of
    // pages). The step is dropped if a read fails, or if meanwhile the run moved on (a new series or
    // password, or the strip went away) or the page moved elsewhere.
    const run = this.runId;
    const from = this.selected()?.startMs;
    for (let read = 0; read <= MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES; read++) {
      const { item, readFirst } = this.adjacent(direction);
      if (item) {
        this.moveTo(item);
        return;
      }
      if (!readFirst || read === MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES) {
        return;
      }
      const paged = await this.loadMore(run, readFirst, MEETING_OCCURRENCE_STRIP_PAGE_SIZE);
      if (!paged || run !== this.runId || from === undefined || this.selected()?.startMs !== from) {
        return;
      }
    }
  }

  /** Roving focus within the strip: Left / Right step, Home / End go to the loaded ends. */
  protected onChipKeydown(event: KeyboardEvent, item: MeetingOccurrenceStripItem): void {
    const items = this.items();
    const index = items.findIndex((candidate) => candidate.startMs === item.startMs);
    const targets: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 };
    const targetIndex = targets[event.key];
    if (targetIndex === undefined || !items[targetIndex]) {
      return;
    }
    event.preventDefault();
    const target = items[targetIndex];
    this.focusStartMs.set(target.startMs);
    this.scroller()?.nativeElement.querySelector<HTMLElement>(`[data-start-ms="${target.startMs}"]`)?.focus();
  }

  /** Moves the page, and hands the tab stop back to the selection, wherever the viewer moved it. */
  private moveTo(item: MeetingOccurrenceStripItem): void {
    this.focusStartMs.set(null);
    this.state.navigateToOccurrence(item);
  }

  /**
   * The next selectable occurrence in a direction, or which side must be read before it is known. The
   * two sides page independently (the past backwards, the live list forwards, and the live list can
   * still carry ended occurrences), so chips adjacent among those loaded need not be adjacent in the
   * series: when the stretch between the selection and the nearest candidate reaches into a side's
   * unread range (older than its oldest past record, or later than its latest upcoming one, while it has
   * more), that side is read first. Cancelled occurrences are skipped.
   */
  private adjacent(direction: -1 | 1): { item: MeetingOccurrenceStripItem | null; readFirst: MeetingOccurrenceDirection | null } {
    const items = this.items();
    const selected = this.selected();
    const loaded = this.loaded();
    if (!selected || !loaded) {
      return { item: null, readFirst: null };
    }
    for (let index = items.indexOf(selected) + direction; index >= 0 && index < items.length; index += direction) {
      const candidate = items[index];
      if (candidate.cancelled) {
        continue;
      }
      const unread = this.unreadSide(loaded, selected.startMs, candidate.startMs);
      return unread ? { item: null, readFirst: unread } : { item: candidate, readFirst: null };
    }
    // Past the loaded end in this direction: that side's further pages.
    const beyond: MeetingOccurrenceDirection = direction < 0 ? 'past' : 'future';
    const hasMore = direction < 0 ? loaded.pastHasMore : loaded.futureHasMore;
    return { item: null, readFirst: hasMore ? beyond : null };
  }

  private canStep({ item, readFirst }: { item: MeetingOccurrenceStripItem | null; readFirst: MeetingOccurrenceDirection | null }): boolean {
    return !!item || !!readFirst;
  }

  /** Which side, if any, has unread occurrences between two starts. */
  private unreadSide(loaded: MeetingOccurrenceStripPages, a: number, b: number): MeetingOccurrenceDirection | null {
    const { oldestPast, latestFuture } = this.readEdges(loaded);
    if (loaded.pastHasMore && (oldestPast === undefined || Math.min(a, b) < oldestPast)) {
      return 'past';
    }
    if (loaded.futureHasMore && (latestFuture === undefined || Math.max(a, b) > latestFuture)) {
      return 'future';
    }
    return null;
  }

  /** Each side's read end: the oldest past record and the latest upcoming occurrence the pages hold. */
  private readEdges(loaded: MeetingOccurrenceStripPages): { oldestPast?: number; latestFuture?: number } {
    const pastStarts = loaded.past.map((record) => compositeIdToStartMs(record.meeting_and_occurrence_id)).filter((ms): ms is number => ms !== null);
    const futureStarts = loaded.future.map((occurrence) => new Date(occurrence.start_time).getTime()).filter((ms) => Number.isFinite(ms));
    return {
      oldestPast: pastStarts.length > 0 ? Math.min(...pastStarts) : undefined,
      latestFuture: futureStarts.length > 0 ? Math.max(...futureStarts) : undefined,
    };
  }

  /**
   * A chip's colours: the prototype's selected (accent), past (muted text: the prototype's `--faint` is
   * the glyph-only token, under AA for text) and upcoming (body text) chips, hover on the unselected,
   * and a cancelled one muted and not hovered (E6-05 gives it its full state).
   */
  private chipClass(item: MeetingOccurrenceStripItem, selected: boolean): string {
    if (selected) {
      return 'border-[var(--md-accent)] bg-[var(--md-accent-bg)] text-[var(--md-accent-ink)]';
    }
    if (item.cancelled) {
      return 'cursor-default border-[var(--md-border)] bg-[var(--md-surface-card)] text-[var(--md-text-muted)]';
    }
    const text = item.isPast ? 'text-[var(--md-text-muted)]' : 'text-[var(--md-text-body)]';
    return `border-[var(--md-border)] bg-[var(--md-surface-card)] ${text} hover:bg-[var(--md-surface-hover)]`;
  }

  /**
   * One run per request: the window around now, then pages of the largest size toward the page's
   * occurrence while it lies beyond the loaded ends (a bounded number), so it shows selected. Hidden on
   * any failure of the first page. Every write checks the run is still the current one.
   */
  private async loadWindow(request: MeetingOccurrenceStripRequest | null): Promise<void> {
    const run = ++this.runId;
    const key = request ? `${request.seriesUid}:${request.password ?? ''}` : null;
    this.focusStartMs.set(null);
    this.pagingRun.set(null);
    this.status.set('loading');
    if (!request || !key) {
      return;
    }

    // Pages this series was already read into (by a strip a move replaced) are resumed, not read again.
    if (this.loaded()?.key !== key) {
      this.loaded.set(null);
      let page: PublicMeetingOccurrencesResponse;
      try {
        page = await firstValueFrom(
          this.meetingService.getPublicMeetingOccurrencesPage(request.seriesUid, request.password, { pageSize: MEETING_OCCURRENCE_STRIP_PAGE_SIZE })
        );
      } catch {
        // The service has logged anything but a refusal, which hides the strip silently, as V1's.
        if (run === this.runId) {
          this.status.set('hidden');
        }
        return;
      }
      if (run !== this.runId) {
        return;
      }
      this.loaded.set({
        key,
        past: page.past ?? [],
        future: page.future ?? [],
        cancelled: page.cancelled_occurrences ?? [],
        pastHasMore: !!page.past_has_more,
        futureHasMore: !!page.future_has_more,
        pastCursor: page.past_cursor,
        futureCursor: page.future_cursor,
        pastIncomplete: !!page.past_incomplete,
      });
    }

    for (let chased = 0; chased < MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES; chased++) {
      const target = this.state.selectedOccurrenceStartMs();
      const timeline = this.timeline();
      const loaded = this.loaded();
      if (target === null || !timeline || !loaded || timeline.items.some((item) => item.startMs === target)) {
        break;
      }
      const direction = this.chaseDirection(target, loaded);
      if (!direction || !(await this.loadMore(run, direction, MEETING_OCCURRENCES_PAGE_MAX_LIMIT))) {
        break;
      }
    }

    // The live list pages without leaving out ended or cancelled entries: keep reading forward (a bounded
    // number) while none still to come is loaded, so the next-up dot and Jump to next can appear.
    for (let read = 0; read < MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES && run === this.runId && !this.nextUp(); read++) {
      if (!this.loaded()?.futureHasMore || !(await this.loadMore(run, 'future', MEETING_OCCURRENCE_STRIP_PAGE_SIZE))) {
        break;
      }
    }

    if (run === this.runId) {
      const timeline = this.timeline();
      this.status.set((timeline?.items.length ?? 0) > 1 || timeline?.pastHasMore || timeline?.futureHasMore ? 'ready' : 'hidden');
    }
  }

  /**
   * Which side to read toward the target, each side judged by its own pages' end: the oldest past record
   * read for going back, the latest upcoming occurrence read for going forward. Not the chips' ends,
   * which include cancelled ids from the whole, unpaged `cancelled_occurrences` list, and not one range
   * across both sides, since the live list can still carry ended occurrences older than the past page.
   */
  private chaseDirection(target: number, loaded: MeetingOccurrenceStripPages): MeetingOccurrenceDirection | null {
    const { oldestPast: oldest, latestFuture: latest } = this.readEdges(loaded);
    if (loaded.pastHasMore && (oldest === undefined || target < oldest)) {
      return 'past';
    }
    if (loaded.futureHasMore && (latest === undefined || target > latest)) {
      return 'future';
    }
    return null;
  }

  /**
   * Reads the next page on one side for a run and merges it into what is loaded when it arrives;
   * false when there is none, it failed, another read is in flight, or the run was superseded.
   */
  private async loadMore(run: number, direction: MeetingOccurrenceDirection, pageSize: number): Promise<boolean> {
    const loaded = this.loaded();
    const request = this.request();
    const cursor = direction === 'past' ? loaded?.pastCursor : loaded?.futureCursor;
    if (run !== this.runId || !loaded || !request || !cursor || this.pagingRun() === run) {
      return false;
    }
    this.pagingRun.set(run);
    try {
      const page = await firstValueFrom(
        this.meetingService.getPublicMeetingOccurrencesPage(request.seriesUid, request.password, { pageSize, direction, cursor })
      );
      // Merged only into the same series' pages, and only for a live, current run: the pages are the
      // state service's, shared with a strip a move created in this one's place.
      const current = this.loaded();
      if (run !== this.runId || !current || current.key !== loaded.key) {
        return false;
      }
      this.loaded.set(
        direction === 'past'
          ? {
              ...current,
              past: [...(page.past ?? []), ...current.past],
              pastHasMore: !!page.past_has_more,
              pastCursor: page.past_cursor,
              pastIncomplete: current.pastIncomplete || !!page.past_incomplete,
              // Every page carries the series' current cancellations: a later one is the newer list.
              cancelled: page.cancelled_occurrences ?? current.cancelled,
            }
          : {
              ...current,
              future: [...current.future, ...(page.future ?? [])],
              futureHasMore: !!page.future_has_more,
              futureCursor: page.future_cursor,
              cancelled: page.cancelled_occurrences ?? current.cancelled,
            }
      );
      return true;
    } catch (error) {
      // A refusal now means the series is no longer this viewer's to see: hidden, and its pages dropped,
      // as a refused first page. Any other failure (logged by the service) keeps the chips it has: a
      // working strip is not thrown away because one further page did not arrive.
      if (run === this.runId && error instanceof HttpErrorResponse && (error.status === 400 || error.status === 403)) {
        this.runId++;
        this.loaded.set(null);
        this.status.set('hidden');
      }
      return false;
    } finally {
      if (this.pagingRun() === run) {
        this.pagingRun.set(null);
      }
    }
  }

  private initTimeline(): Signal<MeetingOccurrenceStripTimeline | null> {
    return computed(() => {
      const loaded = this.loaded();
      const meeting = this.state.meeting();
      if (!loaded || !meeting) {
        return null;
      }
      const items = buildOccurrenceStripItems(
        [],
        { past: loaded.past, future: loaded.future, cancelled_occurrences: loaded.cancelled },
        meeting.duration ?? 0,
        this.state.now()
      );
      return {
        items,
        pastHasMore: loaded.pastHasMore,
        futureHasMore: loaded.futureHasMore,
        pastCursor: loaded.pastCursor,
        futureCursor: loaded.futureCursor,
      };
    });
  }

  private initPosition(): Signal<{ index: number; total: number } | null> {
    return computed(() => {
      const timeline = this.timeline();
      const selected = this.selected();
      // An unread past history is unknown, not empty: no total can be claimed then either.
      if (!timeline || !selected || timeline.pastHasMore || timeline.futureHasMore || this.loaded()?.pastIncomplete) {
        return null;
      }
      return { index: timeline.items.indexOf(selected) + 1, total: timeline.items.length };
    });
  }

  private initTabStopMs(): Signal<number | null> {
    return computed(() => {
      const items = this.items();
      const focus = this.focusStartMs();
      if (focus !== null && items.some((item) => item.startMs === focus)) {
        return focus;
      }
      return (this.selected() ?? this.nextUp() ?? items[0])?.startMs ?? null;
    });
  }

  private initChips(): Signal<MeetingOccurrenceStripChip[]> {
    return computed(() => {
      const selectedMs = this.selected()?.startMs;
      const nextUpMs = this.nextUp()?.startMs;
      const tabStopMs = this.tabStopMs();
      return this.items().map((item) => {
        const date = new Date(item.startMs);
        const selected = item.startMs === selectedMs;
        const nextUp = item.startMs === nextUpMs;
        const notes = [item.cancelled ? 'cancelled' : null, nextUp ? 'next meeting' : null].filter((note): note is string => !!note);
        return {
          item,
          weekday: this.weekdayFormat.format(date).toUpperCase(),
          day: this.dayFormat.format(date),
          month: this.monthFormat.format(date),
          label: [this.longDateFormat.format(date), ...notes].join(', '),
          cssClass: this.chipClass(item, selected),
          selected,
          nextUp,
          tabIndex: item.startMs === tabStopMs ? 0 : -1,
        };
      });
    });
  }

  /**
   * The series and password the strip reads, browser only, once the page shows its route. Keyed on the
   * series and password: a move within the route keeps the strip as it is, and one that rebuilds it
   * resumes from the held pages. The password is the page's (the series endpoint takes it from the
   * header on any page).
   */
  private initRequest(): Signal<MeetingOccurrenceStripRequest | null> {
    return computed(
      () => {
        const seriesUid = this.state.seriesUid();
        // Nothing while the page loads another route: `seriesUid` still names the previous meeting's
        // series then, and the page's stale-content guard covers the strip too.
        if (!isPlatformBrowser(this.platformId) || !seriesUid || !this.state.matchesRoute()) {
          return null;
        }
        return { seriesUid, password: this.state.password() };
      },
      { equal: (a, b) => a?.seriesUid === b?.seriesUid && a?.password === b?.password }
    );
  }
}
