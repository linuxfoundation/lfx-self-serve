// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { afterNextRender, Component, computed, inject, Signal, signal } from '@angular/core';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { Meeting, MeetingTimeState, MeetingTimeWindow, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { formatDisplayTimeInTimezone, formatFutureRelativeTime, getLongTimezoneName, getUserTimezone, toZonedDateCarrier } from '@lfx-one/shared/utils';
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
   * Start and end of the page's selected occurrence (`?occurrence=` first, else current or next; the
   * state service re-selects it on each clock tick), else of the meeting itself.
   */
  protected readonly window: Signal<MeetingTimeWindow | null> = this.initWindow();
  protected readonly timeState: Signal<MeetingTimeState | null> = this.state.timeState;
  /** True inside the join window before the scheduled start: the pill's "Starting soon". */
  protected readonly startingSoon = computed(() => this.state.meetingStatus() === 'starting-soon');
  /** The occurrence's calendar day in the viewer's zone, as a local-noon carrier for DatePipe. */
  protected readonly zonedDay: Signal<Date | null> = this.initZonedDay();
  protected readonly timeRange: Signal<string> = this.initTimeRange();
  protected readonly timezoneName: Signal<string> = this.initTimezoneName();
  /** Before the meeting, the relative start ("Starts in 3 days."); it ticks, so it is not announced. */
  protected readonly relativeStart: Signal<string> = this.initRelativeStart();
  /**
   * The phase sentence, the only text in the banner's live region: it changes when the phase does
   * (before → starting soon → in progress → ended, or on to the next occurrence), so each change is
   * announced, while the ticking relative start beside it is not.
   */
  protected readonly phaseMessage: Signal<string> = this.initPhaseMessage();
  /** Icon and text colour per phase, all V2 tokens. */
  protected readonly phaseStyles: Record<MeetingTimeState, { icon: string; text: string }> = {
    before: { icon: 'fa-light fa-clock mt-[2px] text-[var(--md-text-muted)]', text: 'text-[var(--md-text-body)]' },
    live: { icon: 'fa-solid fa-circle mt-[4px] text-[8px] text-[var(--md-status-live)]', text: 'font-semibold text-[var(--md-status-live)]' },
    ended: { icon: 'fa-light fa-clock-rotate-left mt-[2px] text-[var(--md-text-muted)]', text: 'text-[var(--md-text-body)]' },
  };

  public constructor() {
    afterNextRender(() => this.userTimezone.set(getUserTimezone()));
  }

  private initWindow(): Signal<MeetingTimeWindow | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) {
        return null;
      }
      const occurrence = this.state.selectedOccurrence();
      const start = new Date(occurrence?.start_time ?? meeting.start_time);
      if (Number.isNaN(start.getTime())) {
        return null;
      }
      const durationMinutes = occurrence?.duration ?? meeting.duration ?? 0;
      return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
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
      if (!window || !timezone) {
        return '';
      }
      // A range that crosses a DST change names both offsets, so the end is not mislabelled.
      const startName = getLongTimezoneName(window.start, timezone);
      const endName = getLongTimezoneName(window.end, timezone);
      return startName === endName ? startName : `${startName} – ${endName}`;
    });
  }

  private initRelativeStart(): Signal<string> {
    return computed(() => {
      const window = this.window();
      // Read so the relative start moves on with the clock.
      this.state.now();
      return window && this.timeState() === 'before' ? `Starts ${formatFutureRelativeTime(window.start)}.` : '';
    });
  }

  private initPhaseMessage(): Signal<string> {
    return computed(() => {
      const meeting = this.meeting();
      switch (this.timeState()) {
        case 'ended':
          return 'This meeting has ended.';
        case 'live':
          return this.startingSoon() ? 'The meeting is starting soon. You can join now.' : 'The meeting is in progress.';
        case 'before': {
          // The issue's (and v1's) early-join copy.
          const earlyJoinMinutes = meeting?.early_join_time_minutes ?? DEFAULT_EARLY_JOIN_TIME;
          return `You may only join up to ${earlyJoinMinutes} minutes before the start time.`;
        }
        default:
          return '';
      }
    });
  }
}
