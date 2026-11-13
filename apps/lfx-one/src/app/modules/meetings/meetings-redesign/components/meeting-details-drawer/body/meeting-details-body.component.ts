// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, Signal, signal, viewChild } from '@angular/core';
import { environment } from '@environments/environment';
import { MEETING_DETAILS_VISIBILITY_TONES } from '@lfx-one/shared/constants';
import {
  MeetingCommittee,
  MeetingDetailsFeature,
  MeetingDetailsOrganizer,
  MeetingDetailsTab,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingVisibilityInfo,
  UiTabItem,
} from '@lfx-one/shared/interfaces';
import {
  getMeetingDetailsFeatures,
  getMeetingDetailsOrganizers,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingScheduledZoneLabel,
  getMeetingShareUrl,
  getMeetingVisibilityBadges,
  getUserTimezone,
  isPastMeetingCalendarRow,
} from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingDetailsAgendaComponent } from '../agenda/meeting-details-agenda.component';
import { MeetingDetailsGuestsComponent } from '../guests/meeting-details-guests.component';
import { MeetingDetailsHeaderComponent } from '../header/meeting-details-header.component';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsOccurrenceNavComponent } from '../occurrence-nav/meeting-details-occurrence-nav.component';
import { MeetingDetailsProjectLinkComponent } from '../project-link/meeting-details-project-link.component';
import { MeetingDetailsScheduleComponent } from '../schedule/meeting-details-schedule.component';
import { MeetingDetailsArtifactsService } from '../tools/meeting-details-artifacts.service';
import { MeetingDetailsOwnActionsComponent } from '../tools/own-actions/meeting-details-own-actions.component';
import { MeetingDetailsToolsComponent } from '../tools/meeting-details-tools.component';

/**
 * The meeting details: a sticky header, the title block, tabs for the agenda and the guests, and a sticky right column for
 * the schedule and tools. Each section mounts into its slot and reads `MeetingDetailsContext`.
 * @description Host-agnostic: the host provides `MeetingDetailsContext`, `MeetingDetailsArtifactsService`, a `MeetingDetailsSource`,
 * `MeetingsHomeEditService` and `MeetingsHomeDeleteService`. Outside a drawer the header drops Close and stops sticking.
 */
@Component({
  selector: 'lfx-meeting-details-body',
  imports: [
    MeetingDetailsAgendaComponent,
    MeetingDetailsGuestsComponent,
    MeetingDetailsHeaderComponent,
    MeetingDetailsOccurrenceNavComponent,
    MeetingDetailsOwnActionsComponent,
    MeetingDetailsProjectLinkComponent,
    MeetingDetailsScheduleComponent,
    MeetingDetailsToolsComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiTabsComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-details-body.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class MeetingDetailsBodyComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);
  private readonly titleElement = viewChild<ElementRef<HTMLElement>>('titleElement');
  private readonly artifacts = inject(MeetingDetailsArtifactsService);
  protected readonly ownActions = viewChild(MeetingDetailsOwnActionsComponent);
  protected readonly context = inject(MeetingDetailsContext);
  /** Outside a drawer the details are a page: an h1, and the page's top bar takes the compact title. */
  protected readonly page = !inject(UiDrawerContext, { optional: true });

  /** The big title has scrolled under the sticky header. */
  protected readonly compact = signal(false);
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.context.meeting()));
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = computed(() => getMeetingVisibilityBadges(this.context.meeting()));
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = computed(() => getMeetingHomeRowType(this.context.meeting()));
  /** One badge per committee, opening its group page in a new tab. */
  protected readonly groups: Signal<MeetingCommittee[]> = computed(() =>
    (this.context.meeting().committees ?? []).filter(
      (committee, index, all) => !!committee.uid && !!committee.name?.trim() && all.findIndex((other) => other.uid === committee.uid) === index
    )
  );
  protected readonly features: Signal<MeetingDetailsFeature[]> = computed(() => getMeetingDetailsFeatures(this.context.meeting(), this.artifacts.flags()));
  protected readonly organizers: Signal<MeetingDetailsOrganizer[]> = this.initOrganizers();
  protected readonly scheduledZone: Signal<string | null> = computed(() =>
    getMeetingScheduledZoneLabel(this.context.meeting().timezone, this.context.shownRow().startTime, getUserTimezone())
  );
  /** Agenda whenever the guests are hidden from the viewer. */
  protected readonly activeTab: Signal<MeetingDetailsTab> = computed(() => (this.context.canViewGuests() ? this.context.tab() : 'agenda'));
  protected readonly tabs: Signal<UiTabItem[]> = computed(() => [
    { value: 'agenda', label: 'Agenda & Materials', icon: 'fa-light fa-paperclip' },
    {
      value: 'guests',
      label: this.context.state() === 'ended' ? 'Participants' : 'Guests',
      icon: 'fa-light fa-people-group',
      count: this.context.guestCount() ?? undefined,
    },
  ]);
  /** The header and tabs fades, except over a guests list, which brings its own sticky toolbar. */
  protected readonly showFades: Signal<boolean> = computed(() => this.activeTab() !== 'guests' || !this.context.guestCount());
  protected readonly visibilityTones = MEETING_DETAILS_VISIBILITY_TONES;

  public constructor() {
    afterNextRender(() => this.observeTitle());
  }

  /** Opens the group's page in a new tab, as the meeting page does. */
  protected openGroup(uid: string): void {
    window.open(`/groups/${encodeURIComponent(uid)}`, '_blank', 'noopener,noreferrer');
  }

  protected selectTab(value: string): void {
    this.context.tab.set(value === 'guests' ? 'guests' : 'agenda');
  }

  private initOrganizers(): Signal<MeetingDetailsOrganizer[]> {
    return computed(() => {
      const meeting = this.context.meeting();
      const row = this.context.shownRow();
      const pastId = this.context.pastMeetingId();
      // Hosts come from the guest list, so their emails show only to viewers who may see it.
      const hosts = this.context.canViewGuests() ? this.context.hosts() : [];
      return getMeetingDetailsOrganizers(meeting, hosts, this.userService.viewerUsername(), {
        meetingTitle: row.title,
        meetingDate: new Date(row.startTime).toLocaleDateString('en-US', { dateStyle: 'medium' }),
        detailUrl: getMeetingShareUrl(environment.urls.home, pastId ?? (isPastMeetingCalendarRow(meeting) ? meeting.meeting_id : meeting.id)),
      });
    });
  }

  /** Shows the compact title once the big one has scrolled above the sticky header. */
  private observeTitle(): void {
    const title = this.titleElement()?.nativeElement;
    if (!title || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => this.compact.set(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)),
      // The host's cdkScrollable scroller, such as the drawer body, else the viewport; 68px is the sticky header.
      { root: title.closest('[cdkscrollable]'), rootMargin: '-68px 0px 0px 0px' }
    );
    observer.observe(title);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
