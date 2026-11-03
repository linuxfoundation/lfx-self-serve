// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import {
  MeetingHomeRow,
  MeetingHomeRowLink,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingRsvp,
  MeetingVisibilityInfo,
  RsvpCounts,
  UiAvatarItem,
} from '@lfx-one/shared/interfaces';
import {
  buildAttendeePreviewFromRsvps,
  calculateRsvpCounts,
  formatMeetingTimeRange,
  getMeetingHomeRowLink,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingStartsInLabel,
  getMeetingVisibilityBadges,
} from '@lfx-one/shared/utils';
import { UiAvatarGroupComponent } from '@shared/uikit/avatar/avatar-group.component';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/**
 * Next meeting card of the meetings home page: the soonest upcoming date with its attendees, Join and a countdown.
 * @description Clicking the card opens the meeting; the project eyebrow opens the project. Shows an empty card without a date.
 * The page store loads the responses and the join link, so the folded and the rail copies share one request each.
 * Project the card's actions menu with the `next-meeting-card-menu` attribute.
 */
@Component({
  selector: 'lfx-next-meeting-card',
  imports: [
    DatePipe,
    UiAvatarComponent,
    UiAvatarGroupComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    UiTooltipDirective,
  ],
  templateUrl: './next-meeting-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class NextMeetingCardComponent {
  private readonly router = inject(Router);

  /** The soonest upcoming date; null shows the empty card. */
  public readonly row = input.required<MeetingHomeRow | null>();
  /** The upcoming feed is still loading; shows a skeleton card. */
  public readonly loading = input(false);
  /** Page clock, so the countdown follows the time. */
  public readonly now = input.required<Date>();
  /** Responses on the meeting; empty when the roster is hidden from the viewer, null while loading. */
  public readonly rsvps = input<MeetingRsvp[] | null>(null);
  /** The date is inside its join window and the viewer may join it. */
  public readonly joinable = input(false);
  /** Join link built for the viewer; null falls back to the meeting page. */
  public readonly joinUrl = input<string | null>(null);

  protected readonly link: Signal<MeetingHomeRowLink | null> = this.fromRow((row) => getMeetingHomeRowLink(row, 'upcoming'));
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = this.fromRow((row) => getMeetingVisibilityBadges(row.meeting), []);
  protected readonly project: Signal<MeetingHomeRowProject | null> = this.fromRow((row) => getMeetingHomeRowProject(row.meeting));
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = this.fromRow((row) => getMeetingHomeRowType(row.meeting));
  protected readonly groups: Signal<string> = this.initGroups();
  protected readonly when: Signal<string> = this.initWhen();
  protected readonly recurrenceTooltip: Signal<string | null> = this.fromRow((row) => getMeetingRecurrenceTooltip(row.meeting, row.occurrence));
  protected readonly startsIn: Signal<string | null> = this.fromRow((row) => getMeetingStartsInLabel(row.startTime, this.now()));
  /** Counts for this date; null hides the attendee row (roster hidden, no responses yet, or still loading). */
  protected readonly rsvpCounts: Signal<RsvpCounts | null> = this.initRsvpCounts();
  /** People who answered going or maybe for this date, going first. */
  protected readonly attendingPeople: Signal<UiAvatarItem[]> = this.initAttendingPeople();
  protected readonly visibilityBg: Record<MeetingVisibilityKind, string> = {
    [MeetingVisibilityKind.PUBLIC]: 'bg-emerald-500',
    [MeetingVisibilityKind.PRIVATE]: 'bg-gray-900',
    [MeetingVisibilityKind.RESTRICTED]: 'bg-red-600',
  };

  protected open(): void {
    const link = this.link();
    // Releasing a text selection inside the card is not a click on it.
    if (!link || window.getSelection()?.toString()) return;
    window.open(link.url, '_blank', 'noopener,noreferrer');
  }

  /** Keeps a link click from also opening the card; a plain same-tab click navigates in-app. */
  protected onLinkClick(event: MouseEvent, url: string, newTab: boolean): void {
    event.stopPropagation();
    if (newTab || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  /** Opens the join link built for the viewer, or the meeting page's join flow when it is not available. */
  protected join(): void {
    const meeting = this.row()?.meeting;
    if (!meeting || !this.joinable()) return;

    const url = this.joinUrl();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void this.router.navigate(['/meetings', meeting.id], { queryParams: meeting.password ? { password: meeting.password } : {} });
  }

  private initGroups(): Signal<string> {
    return this.fromRow(
      (row) =>
        (row.meeting.committees ?? [])
          .map((committee) => committee.name?.trim())
          .filter((name): name is string => !!name)
          .join(', '),
      ''
    );
  }

  private initWhen(): Signal<string> {
    return this.fromRow(
      (row) => `${formatDate(row.startTime, 'EEE', 'en-US')}, ${formatMeetingTimeRange(row.startTime, row.durationMinutes)} · ${row.durationMinutes}m`,
      ''
    );
  }

  private initRsvpCounts(): Signal<RsvpCounts | null> {
    return computed(() => {
      const row = this.row();
      const rsvps = this.rsvps();
      if (!row || !rsvps?.length) return null;
      const occurrence = row.occurrenceId ? { occurrence_id: row.occurrenceId, start_time: row.startTime, duration: row.durationMinutes } : null;
      return calculateRsvpCounts(occurrence, rsvps);
    });
  }

  private initAttendingPeople(): Signal<UiAvatarItem[]> {
    return computed(() => {
      const row = this.row();
      const counts = this.rsvpCounts();
      if (!row || !counts) return [];
      // The preview lists accepted, then maybe, then the rest, so its head is the people going or maybe.
      return buildAttendeePreviewFromRsvps(this.rsvps() ?? [], row.occurrenceId)
        .slice(0, counts.accepted + counts.maybe)
        .map((person) => ({ name: person.name, src: person.avatarUrl ?? undefined }));
    });
  }

  /** A computed of the row, with `empty` when there is none. */
  private fromRow<T>(build: (row: MeetingHomeRow) => T): Signal<T | null>;
  private fromRow<T>(build: (row: MeetingHomeRow) => T, empty: T): Signal<T>;
  private fromRow<T>(build: (row: MeetingHomeRow) => T, empty: T | null = null): Signal<T | null> {
    return computed(() => {
      const row = this.row();
      return row ? build(row) : empty;
    });
  }
}
