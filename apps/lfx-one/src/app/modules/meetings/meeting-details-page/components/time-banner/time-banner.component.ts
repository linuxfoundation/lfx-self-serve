// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { afterNextRender, Component, computed, inject, Signal, signal } from '@angular/core';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { Meeting, MeetingOccurrence, MeetingTimeState, MeetingTimeWindow, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import {
  formatDisplayTimeInTimezone,
  formatFutureRelativeTime,
  getCurrentOrNextOccurrence,
  getLongTimezoneName,
  getUserTimezone,
  resolveTimeState,
  toZonedDateCarrier,
} from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The meeting's date, time and phase, at the top of the V2 rail card (E1-06, #1774, FR-012).
 * @description Replaces V1's three alert banners with one block whose `data-state` is the time state:
 * the occurrence's date, start-end time and timezone in the viewer's own zone (the prototype's rail
 * card), then one line for the phase — the relative start and the early-join rule before, "in
 * progress" during the join window, "ended" after. It moves on with the state service's clock, so a
 * page left open crosses from before to live to ended without a reload.
 *
 * The viewer's timezone is read after the first render, so the server render and hydration agree;
 * until then the date and time are a skeleton, as V1's date badge is.
 */
@Component({
  selector: 'lfx-meeting-time-banner',
  imports: [DatePipe, SkeletonModule],
  templateUrl: './time-banner.component.html',
})
export class MeetingTimeBannerComponent {
  private readonly state = inject(MeetingDetailsStateService);

  /** Null on the server and until the first browser render; the date and time wait for it. */
  protected readonly userTimezone = signal<string | null>(null);

  protected readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.state.meeting;
  /**
   * The occurrence the page is about: the current or next one. Re-selected on every clock tick, so on
   * a recurring series left open the date and the phase line move to the next occurrence together.
   */
  private readonly occurrence: Signal<MeetingOccurrence | null> = this.initOccurrence();
  /** Start and end of that occurrence, else of the meeting itself. */
  protected readonly window: Signal<MeetingTimeWindow | null> = this.initWindow();
  protected readonly timeState: Signal<MeetingTimeState | null> = this.initTimeState();
  /** The occurrence's calendar day in the viewer's zone, as a local-noon carrier for DatePipe. */
  protected readonly zonedDay: Signal<Date | null> = this.initZonedDay();
  protected readonly timeRange: Signal<string> = this.initTimeRange();
  protected readonly timezoneName: Signal<string> = this.initTimezoneName();
  /** The before-state line: the relative start, then the early-join rule (`early_join_time_minutes ?? DEFAULT_EARLY_JOIN_TIME`). */
  protected readonly beforeMessage: Signal<string> = this.initBeforeMessage();

  public constructor() {
    afterNextRender(() => this.userTimezone.set(getUserTimezone()));
  }

  private initOccurrence(): Signal<MeetingOccurrence | null> {
    return computed(() => {
      // `getCurrentOrNextOccurrence` reads the wall clock; reading `now` makes this re-select per tick.
      this.state.now();
      const meeting = this.meeting();
      return meeting ? getCurrentOrNextOccurrence(meeting) : null;
    });
  }

  private initWindow(): Signal<MeetingTimeWindow | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) {
        return null;
      }
      const occurrence = this.occurrence();
      const start = new Date(occurrence?.start_time ?? meeting.start_time);
      if (Number.isNaN(start.getTime())) {
        return null;
      }
      const durationMinutes = occurrence?.duration ?? meeting.duration ?? 0;
      return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
    });
  }

  private initTimeState(): Signal<MeetingTimeState | null> {
    return computed(() => {
      const meeting = this.meeting();
      return meeting ? resolveTimeState(meeting, this.occurrence(), this.state.now()) : null;
    });
  }

  private initZonedDay(): Signal<Date | null> {
    return computed(() => {
      const window = this.window();
      const timezone = this.userTimezone();
      return window && timezone ? toZonedDateCarrier(window.start, timezone) : null;
    });
  }

  private initTimeRange(): Signal<string> {
    return computed(() => {
      const window = this.window();
      const timezone = this.userTimezone();
      return window && timezone ? `${formatDisplayTimeInTimezone(window.start, timezone)} – ${formatDisplayTimeInTimezone(window.end, timezone)}` : '';
    });
  }

  private initTimezoneName(): Signal<string> {
    return computed(() => {
      const window = this.window();
      const timezone = this.userTimezone();
      return window && timezone ? getLongTimezoneName(window.start, timezone) : '';
    });
  }

  private initBeforeMessage(): Signal<string> {
    return computed(() => {
      const window = this.window();
      const meeting = this.meeting();
      // Read so the relative start moves on with the clock.
      this.state.now();
      if (!window || !meeting) {
        return '';
      }
      const earlyJoinMinutes = meeting.early_join_time_minutes ?? DEFAULT_EARLY_JOIN_TIME;
      // The issue's (and v1's) early-join copy, after the relative start.
      return `Starts ${formatFutureRelativeTime(window.start)}. You may only join up to ${earlyJoinMinutes} minutes before the start time.`;
    });
  }
}
