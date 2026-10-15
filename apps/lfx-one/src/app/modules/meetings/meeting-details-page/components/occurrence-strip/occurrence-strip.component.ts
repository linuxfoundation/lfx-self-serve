// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES, MEETING_OCCURRENCE_STRIP_PAGE_SIZE } from '@lfx-one/shared/constants';
import {
  MeetingOccurrenceDirection,
  MeetingOccurrenceStripItem,
  MeetingOccurrenceStripPages,
  MeetingOccurrenceStripRequest,
  MeetingOccurrenceStripTimeline,
  PublicMeetingOccurrencesResponse,
} from '@lfx-one/shared/interfaces';
import { buildOccurrenceStripItems, getUserTimezone } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { SkeletonModule } from 'primeng/skeleton';
import { firstValueFrom, switchMap } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 occurrence strip, first in the content column of a recurring meeting (E6-03, #3586, FR-044,
 * FR-047), the prototype's Sidebar layout: a row of date chips with Previous / Next, and "Jump to next
 * meeting" when the page shows another occurrence than the next one.
 * @description Client-only progressive enhancement: the server renders nothing for it, and it reads
 * the series from the paged occurrences endpoint (E6-02) once the browser has the page, so SSR and
 * hydration agree. A refusal (the endpoint's 403) or any failure hides it, as V1's does; so does a
 * series with a single occurrence. It starts from the window around now and pages further, toward
 * the page's occurrence when that lies outside it, and when Previous / Next reach a loaded end.
 *
 * Selecting a chip moves the page through {@link MeetingDetailsStateService.navigateToOccurrence},
 * which keeps the URL contract and the password rules. Cancelled occurrences are shown, struck
 * through, and cannot be selected (the page never selects one); their full state is E6-05's (#3588).
 * The chips scroll sideways rather than the prototype's fixed nine-chip window, which is unreadable on
 * a phone. "Occurrence N of M" appears only once the whole series is loaded, since a page carries no
 * total; the browse-all dialog that heading opens is E6-04's (#3587).
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

  protected readonly isBrowser = isPlatformBrowser(this.platformId);
  /** The prototype's 32px round Previous / Next. */
  protected readonly roundButtonClass =
    '!h-[32px] !w-[32px] !min-w-0 !rounded-[var(--md-radius-circle)] !border !border-[var(--md-border)] !bg-[var(--md-surface-card)] !p-0 !text-[var(--md-text-body)] shadow-[0_2px_6px_var(--md-shadow-color)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)] disabled:!opacity-40';
  /** The prototype's 12.5px text action ("Jump to next meeting"). */
  protected readonly textButtonClass =
    '!h-auto !border-0 !bg-transparent !p-0 !text-[12.5px] !font-semibold !text-[var(--md-accent-ink)] hover:!underline focus-visible:!shadow-[var(--md-shadow-focus)]';

  /** `loading` until the first page settles; `hidden` for a refusal, a failure, or a single occurrence. */
  protected readonly status = signal<'loading' | 'ready' | 'hidden'>('loading');
  private readonly loaded = signal<MeetingOccurrenceStripPages | null>(null);
  /** The chip that holds the strip's one tab stop, moved by the arrow keys; the selected one by default. */
  private readonly focusStartMs = signal<number | null>(null);
  /** Set while a page is being read, so Previous / Next at a loaded end do not read it twice. */
  private readonly paging = signal(false);
  private readonly timezone = this.isBrowser ? getUserTimezone() : 'UTC';

  protected readonly timeline: Signal<MeetingOccurrenceStripTimeline | null> = computed(() => {
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
  protected readonly items = computed(() => this.timeline()?.items ?? []);
  protected readonly selected = computed(() => this.items().find((item) => item.startMs === this.state.selectedOccurrenceStartMs()) ?? null);
  /** The first occurrence that has not ended and is not cancelled: the prototype's next-up dot. */
  protected readonly nextUp = computed(() => this.items().find((item) => !item.isPast && !item.cancelled) ?? null);
  protected readonly showJumpToNext = computed(() => {
    const nextUp = this.nextUp();
    return !!nextUp && nextUp.startMs !== this.selected()?.startMs;
  });
  /** "Occurrence N of M", only when the whole series is loaded. */
  protected readonly position = computed(() => {
    const timeline = this.timeline();
    const selected = this.selected();
    if (!timeline || !selected || timeline.pastHasMore || timeline.futureHasMore) {
      return null;
    }
    return { index: timeline.items.indexOf(selected) + 1, total: timeline.items.length };
  });
  protected readonly previous = computed(() => this.neighbour(-1));
  protected readonly next = computed(() => this.neighbour(1));
  protected readonly canGoPrevious = computed(() => !!this.previous() || (!!this.selected() && !!this.timeline()?.pastHasMore));
  protected readonly canGoNext = computed(() => !!this.next() || (!!this.selected() && !!this.timeline()?.futureHasMore));
  protected readonly tabStopMs = computed(() => {
    const items = this.items();
    const focus = this.focusStartMs();
    if (focus !== null && items.some((item) => item.startMs === focus)) {
      return focus;
    }
    return (this.selected() ?? this.nextUp() ?? items[0])?.startMs ?? null;
  });

  /** What re-centres the strip: another selected occurrence, or another number of loaded chips. */
  private readonly centerKey = computed(() => ({ startMs: this.selected()?.startMs ?? null, count: this.items().length }), {
    equal: (a, b) => a.startMs === b.startMs && a.count === b.count,
  });

  private readonly request: Signal<MeetingOccurrenceStripRequest | null> = computed(
    () => {
      const seriesUid = this.state.seriesUid();
      if (!this.isBrowser || !seriesUid || !this.state.matchesRoute()) {
        return null;
      }
      // On a past occurrence's page the password belongs to no lookup the strip can make.
      return { seriesUid, password: this.state.loadedViaPastMeetingId() ? null : this.state.password() };
    },
    { equal: (a, b) => a?.seriesUid === b?.seriesUid && a?.password === b?.password }
  );

  public constructor() {
    toObservable(this.request)
      .pipe(
        switchMap(async (request) => {
          this.loaded.set(null);
          this.focusStartMs.set(null);
          if (!request) {
            this.status.set('loading');
            return;
          }
          this.status.set('loading');
          await this.loadWindow(request);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

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
        scroller.scrollLeft = chip.offsetLeft - scroller.clientWidth / 2 + chip.clientWidth / 2;
      }
    });
  }

  protected select(item: MeetingOccurrenceStripItem): void {
    if (!item.cancelled && item.startMs !== this.selected()?.startMs) {
      this.state.navigateToOccurrence(item);
    }
  }

  /** Keeps the tab stop on the chip the viewer focused, by pointer or keyboard. */
  protected onChipFocus(item: MeetingOccurrenceStripItem): void {
    this.focusStartMs.set(item.startMs);
  }

  /**
   * A chip's colours: the prototype's selected (accent), past (muted text: the prototype's `--faint` is
   * the glyph-only token, under AA for text) and upcoming (body text) chips, hover on the unselected,
   * and a cancelled one muted and not hovered (E6-05 gives it its full state).
   */
  protected chipClass(item: MeetingOccurrenceStripItem, isSelected: boolean): string {
    if (isSelected) {
      return 'border-[var(--md-accent)] bg-[var(--md-accent-bg)] text-[var(--md-accent-ink)]';
    }
    if (item.cancelled) {
      return 'cursor-default border-[var(--md-border)] bg-[var(--md-surface-card)] text-[var(--md-text-muted)]';
    }
    const text = item.isPast ? 'text-[var(--md-text-muted)]' : 'text-[var(--md-text-body)]';
    return `border-[var(--md-border)] bg-[var(--md-surface-card)] ${text} hover:bg-[var(--md-surface-hover)]`;
  }

  protected jumpToNext(): void {
    const nextUp = this.nextUp();
    if (nextUp) {
      this.state.navigateToOccurrence(nextUp);
    }
  }

  protected async step(direction: -1 | 1): Promise<void> {
    let target = direction < 0 ? this.previous() : this.next();
    if (!target) {
      await this.loadMore(direction < 0 ? 'past' : 'future');
      target = this.neighbour(direction);
    }
    if (target) {
      this.state.navigateToOccurrence(target);
    }
  }

  /** Roving focus within the strip: Left / Right step, Home / End go to the loaded ends. */
  protected onChipKeydown(event: KeyboardEvent, item: MeetingOccurrenceStripItem): void {
    const items = this.items();
    const index = items.indexOf(item);
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

  protected weekday(item: MeetingOccurrenceStripItem): string {
    return this.format(item, { weekday: 'short' }).toUpperCase();
  }

  protected day(item: MeetingOccurrenceStripItem): string {
    return this.format(item, { day: '2-digit' });
  }

  protected month(item: MeetingOccurrenceStripItem): string {
    return this.format(item, { month: 'short' });
  }

  protected chipLabel(item: MeetingOccurrenceStripItem): string {
    const date = this.format(item, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const notes = [item.cancelled ? 'cancelled' : null, item === this.nextUp() ? 'next meeting' : null].filter(Boolean);
    return [date, ...notes].join(', ');
  }

  protected jumpLabel(): string {
    const nextUp = this.nextUp();
    return nextUp ? `Jump to next meeting · ${this.format(nextUp, { month: 'short', day: 'numeric' })}` : '';
  }

  /** The adjacent selectable occurrence among those loaded, skipping cancelled ones; null at a loaded end. */
  private neighbour(direction: -1 | 1): MeetingOccurrenceStripItem | null {
    const items = this.items();
    const selected = this.selected();
    if (!selected) {
      return null;
    }
    for (let index = items.indexOf(selected) + direction; index >= 0 && index < items.length; index += direction) {
      if (!items[index].cancelled) {
        return items[index];
      }
    }
    return null;
  }

  private format(item: MeetingOccurrenceStripItem, options: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: this.timezone }).format(new Date(item.startMs));
  }

  /**
   * The window around now, then further pages toward the page's occurrence while it lies beyond the
   * loaded ends (a bounded number), so it shows selected. Hidden on any failure of the first page.
   */
  private async loadWindow(request: MeetingOccurrenceStripRequest): Promise<void> {
    const key = `${request.seriesUid}:${request.password ?? ''}`;
    let page: PublicMeetingOccurrencesResponse;
    try {
      page = await firstValueFrom(
        this.meetingService.getPublicMeetingOccurrencesPage(request.seriesUid, request.password, { pageSize: MEETING_OCCURRENCE_STRIP_PAGE_SIZE })
      );
    } catch (error) {
      // A refusal is the endpoint gating the series, not a failure: hidden silently, as V1's strip.
      if (!(error instanceof HttpErrorResponse && (error.status === 400 || error.status === 403))) {
        console.error('Failed to load the meeting occurrences', error);
      }
      this.status.set('hidden');
      return;
    }
    if (this.request()?.seriesUid !== request.seriesUid) {
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
    });

    for (let chased = 0; chased < MEETING_OCCURRENCE_STRIP_MAX_CHASE_PAGES; chased++) {
      const target = this.state.selectedOccurrenceStartMs();
      const items = this.items();
      const timeline = this.timeline();
      if (target === null || !timeline || items.some((item) => item.startMs === target)) {
        break;
      }
      const direction = this.chaseDirection(target, timeline);
      if (!direction || !(await this.loadMore(direction))) {
        break;
      }
    }

    const items = this.items();
    const timeline = this.timeline();
    this.status.set(items.length > 1 || timeline?.pastHasMore || timeline?.futureHasMore ? 'ready' : 'hidden');
  }

  private chaseDirection(target: number, timeline: MeetingOccurrenceStripTimeline): MeetingOccurrenceDirection | null {
    const first = timeline.items[0]?.startMs;
    const last = timeline.items[timeline.items.length - 1]?.startMs;
    if (timeline.pastHasMore && (first === undefined || target < first)) {
      return 'past';
    }
    if (timeline.futureHasMore && (last === undefined || target > last)) {
      return 'future';
    }
    return null;
  }

  /** Reads the next page on one side and merges it in; false when there is none or it failed. */
  private async loadMore(direction: MeetingOccurrenceDirection): Promise<boolean> {
    const loaded = this.loaded();
    const request = this.request();
    const cursor = direction === 'past' ? loaded?.pastCursor : loaded?.futureCursor;
    if (!loaded || !request || !cursor || this.paging()) {
      return false;
    }
    this.paging.set(true);
    try {
      const page = await firstValueFrom(
        this.meetingService.getPublicMeetingOccurrencesPage(request.seriesUid, request.password, {
          pageSize: MEETING_OCCURRENCE_STRIP_PAGE_SIZE,
          direction,
          cursor,
        })
      );
      // The page belongs to the series the strip still shows, or it is dropped.
      if (this.loaded()?.key !== loaded.key) {
        return false;
      }
      this.loaded.set(
        direction === 'past'
          ? { ...loaded, past: [...(page.past ?? []), ...loaded.past], pastHasMore: !!page.past_has_more, pastCursor: page.past_cursor }
          : { ...loaded, future: [...loaded.future, ...(page.future ?? [])], futureHasMore: !!page.future_has_more, futureCursor: page.future_cursor }
      );
      return true;
    } catch (error) {
      console.error('Failed to load more meeting occurrences', error);
      return false;
    } finally {
      this.paging.set(false);
    }
  }
}
