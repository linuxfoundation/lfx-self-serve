// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { DashboardQuickLink } from '@lfx-one/shared/interfaces';
import { MeetingCreateMenuComponent } from '@app/modules/meetings/meeting-composer/meeting-create-menu.component';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-dashboard-quicklinks',
  imports: [MeetingCreateMenuComponent, RouterLink],
  templateUrl: './dashboard-quicklinks.component.html',
})
export class DashboardQuicklinksComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly projectContextService = inject(ProjectContextService);

  private readonly createMeetingMenu = viewChild<MeetingCreateMenuComponent>('createMeetingMenu');

  /**
   * Whether meetings v2 is the create surface for this user.
   * @description Read as a signal so the row settles on its own once LaunchDarkly resolves, and
   * defaulted to `false` so a slow or unreachable provider leaves the pre-v2 link in place rather
   * than a dropdown into a composer this user isn't targeted for. See `MEETING_V2_ENABLED_FLAG`.
   */
  protected readonly meetingsV2Enabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, false);

  /**
   * Whether the create dropdown is showing, for the trigger's `aria-expanded`.
   * @description Goes through the view query rather than the template's own reference because the
   * menu is only in the tree while the flag is on, and a reference declared inside a control-flow
   * block isn't in scope for the button outside it.
   */
  protected readonly createMenuOpen = computed(() => this.createMeetingMenu()?.isOpen() ?? false);

  /**
   * Project the dropdown creates against.
   * @description `undefined` rather than `''` for "no context": the composer treats an explicit
   * `projectUid` as taking precedence over the ambient one, so a falsy value would pin it to nothing.
   */
  protected readonly activeProjectUid = computed(() => this.projectContextService.activeContextUid() || undefined);

  /**
   * Every quick link this section can offer, before the per-link permission filter.
   * @description A computed rather than a static array because the meetings v2 flag switches what
   * the "Create meeting" row *does*. The template already renders either shape — a `command` link as
   * a button, a `route` link as an anchor — so the gate is a data-level choice and no markup has to
   * know which one it got.
   */
  protected readonly links: Signal<DashboardQuickLink[]> = this.initLinks();

  /**
   * The links the current user can actually use.
   * @description Filtered per link rather than gated as a block, so a meeting coordinator who is not
   * a project writer still sees "Create meeting" and nothing else. The whole section hides only when
   * this is empty — an empty "Quick links" heading is worse than no heading.
   */
  protected readonly visibleLinks = computed(() => this.links().filter((link) => link.visible?.() ?? true));

  private initLinks(): Signal<DashboardQuickLink[]> {
    return computed(() => [
      this.meetingCreateLink(),
      {
        label: 'Create group',
        icon: 'fa-light fa-users',
        route: ['/groups', 'create'],
        visible: () => this.projectContextService.canWrite(),
        testId: 'create-group',
      },
      {
        label: 'Create mailing list',
        icon: 'fa-light fa-envelope',
        route: ['/mailing-lists', 'create'],
        visible: () => this.projectContextService.canWrite(),
        testId: 'create-mailing-list',
      },
    ]);
  }

  /**
   * The "Create meeting" row, on whichever side of the meetings v2 flag this user is on.
   * @description With v2 on, it opens the same Create Meeting dropdown the meetings dashboard's
   * button opens, over the dashboard rather than routing to `/meetings/create` — that URL redirects
   * to the meetings list, so going through it would push the dashboard the organizer is reading out
   * from under them. The dropdown rather than the quick dialog directly, because creating a meeting
   * always starts by choosing a type or Advanced, and this link is one create entry point among
   * several, so it shouldn't be the one that quietly picks both on the organizer's behalf.
   *
   * With v2 off, it is the plain `/meetings/create` link this row carried before the composer
   * existed — that route still renders the pre-v2 wizard, so the row behaves exactly as it does on
   * `main`.
   *
   * Permission is the same on both sides: meeting-authoring permission, not writer permission, since
   * a meeting coordinator who isn't a project writer can create meetings and gating this on
   * `canWrite` hid the link from them.
   */
  private meetingCreateLink(): DashboardQuickLink {
    const shared = {
      label: 'Create meeting',
      icon: 'fa-light fa-calendar',
      visible: () => this.projectContextService.canWriteMeetings(),
      testId: 'create-meeting',
    };

    if (!this.meetingsV2Enabled()) {
      return { ...shared, route: ['/meetings', 'create'] };
    }

    return { ...shared, command: (event: Event) => this.createMeetingMenu()?.toggle(event), hasPopup: 'menu' };
  }
}
