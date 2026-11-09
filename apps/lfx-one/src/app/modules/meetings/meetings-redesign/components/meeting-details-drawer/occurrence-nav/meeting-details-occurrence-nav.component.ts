// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  MeetingDetailsOccurrenceOption,
  MeetingDetailsOccurrenceOptions,
  OccurrenceNavItem,
  PublicMeetingOccurrencesResponse,
} from '@lfx-one/shared/interfaces';
import {
  buildOccurrenceNavTimeline,
  formatMeetingDetailsTime,
  getActiveOccurrences,
  getMeetingDetailsOccurrenceIndex,
  getMeetingDetailsOccurrenceOptions,
  getMeetingSeriesUid,
  isMeetingOccurrenceCancelled,
  isPastMeetingCalendarRow,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { distinctUntilChanged, filter, map, switchMap } from 'rxjs';

import { MeetingDetailsContext } from '../meeting-details.context';

/**
 * Occurrence navigator of the meeting details drawer: previous and next dates, and a menu of upcoming and past dates.
 * @description The timeline merges the meeting's live dates with the series' past and future ones, as the meeting page does.
 * Shown for a recurring meeting, or when the series has more than one date. Picking a date writes `MeetingDetailsContext.occurrence`.
 */
@Component({
  selector: 'lfx-meeting-details-occurrence-nav',
  imports: [DatePipe, UiBadgeComponent, UiButtonComponent, UiSwitchComponent, UiSwitchOptionComponent],
  templateUrl: './meeting-details-occurrence-nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class MeetingDetailsOccurrenceNavComponent {
  private readonly context = inject(MeetingDetailsContext);
  private readonly meetingService = inject(MeetingService);

  /** The menu tab picked; null follows the shown date. */
  protected readonly menuTab = signal<'upcoming' | 'past' | null>(null);
  protected readonly timeline: Signal<OccurrenceNavItem[]> = this.initTimeline();
  protected readonly index: Signal<number> = computed(() => getMeetingDetailsOccurrenceIndex(this.timeline(), this.context.shownRow().startTime));
  protected readonly visible: Signal<boolean> = computed(
    () => this.timeline().length > 0 && (!!this.context.meeting().recurrence || this.timeline().length >= 2)
  );
  protected readonly options: Signal<MeetingDetailsOccurrenceOptions> = this.initOptions();
  protected readonly shownTab: Signal<'upcoming' | 'past'> = computed(() => this.menuTab() ?? (this.context.state() === 'ended' ? 'past' : 'upcoming'));
  protected readonly items: Signal<MeetingDetailsOccurrenceOption[]> = computed(() => this.options()[this.shownTab()]);
  protected readonly shownStartMs: Signal<number> = computed(() => Date.parse(this.context.shownRow().startTime));

  protected step(delta: -1 | 1): void {
    const target = this.timeline()[this.index() + delta];
    if (target) this.context.occurrence.set(target);
  }

  protected pick(option: MeetingDetailsOccurrenceOption, close: () => void): void {
    if (option.cancelled) return;
    this.context.occurrence.set(option.occurrence);
    close();
  }

  protected selectTab(value: string | null): void {
    this.menuTab.set(value === 'past' ? 'past' : 'upcoming');
  }

  protected timeOf(option: MeetingDetailsOccurrenceOption): string {
    return formatMeetingDetailsTime(option.occurrence.start_time, option.occurrence.duration || this.context.meeting().duration);
  }

  protected isShown(option: MeetingDetailsOccurrenceOption): boolean {
    return Date.parse(option.occurrence.start_time) === this.shownStartMs();
  }

  private initTimeline(): Signal<OccurrenceNavItem[]> {
    const empty: PublicMeetingOccurrencesResponse = { past: [], future: [] };
    // A past record has no rule, so its series is fetched too: the timeline shows whether there is anywhere to go.
    const series = toSignal(
      toObservable(this.context.meeting).pipe(
        filter((meeting) => !!meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id),
        map((meeting) => ({ id: getMeetingSeriesUid(meeting), password: meeting.password ?? null })),
        distinctUntilChanged((a, b) => a.id === b.id && a.password === b.password),
        switchMap(({ id, password }) => this.meetingService.getPublicMeetingOccurrences(id, password))
      ),
      { initialValue: empty }
    );
    return computed(() => {
      const meeting = this.context.meeting();
      // A past row moves among past dates only: an upcoming date needs the live meeting, which the meeting page loads.
      if (isPastMeetingCalendarRow(this.context.row().meeting)) return buildOccurrenceNavTimeline([], { ...series(), future: [] }, meeting.duration);
      return buildOccurrenceNavTimeline(getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences), series(), meeting.duration);
    });
  }

  private initOptions(): Signal<MeetingDetailsOccurrenceOptions> {
    return computed(() => {
      const meeting = this.context.meeting();
      const cancelled = (meeting.occurrences ?? []).filter((occurrence) => isMeetingOccurrenceCancelled(occurrence, meeting.cancelled_occurrences));
      return getMeetingDetailsOccurrenceOptions(this.timeline(), cancelled, this.context.now(), meeting.duration);
    });
  }
}
