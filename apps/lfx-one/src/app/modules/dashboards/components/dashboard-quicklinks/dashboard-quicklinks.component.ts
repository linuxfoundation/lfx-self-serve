// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardQuickLink } from '@lfx-one/shared/interfaces';
import { MeetingCreateMenuComponent } from '@app/modules/meetings/meeting-composer/meeting-create-menu.component';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-dashboard-quicklinks',
  imports: [MeetingCreateMenuComponent, RouterLink],
  templateUrl: './dashboard-quicklinks.component.html',
})
export class DashboardQuicklinksComponent {
  private readonly projectContextService = inject(ProjectContextService);

  private readonly createMeetingMenu = viewChild<MeetingCreateMenuComponent>('createMeetingMenu');

  /**
   * Whether the create dropdown is showing, for the trigger's `aria-expanded`.
   * @description Goes through the same view query the "Create meeting" link's `command` toggles, so
   * the trigger's state and the menu it opens always come from one instance.
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
   * @description The template renders either shape — a `command` link as a button, a `route` link
   * as an anchor — so no markup has to know which kind of link it got.
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
   * The "Create meeting" row.
   * @description Opens the same Create Meeting dropdown the meetings dashboard's button opens, over the dashboard rather than routing to `/meetings/create` — that URL redirects
   * to the meetings list, so going through it would push the dashboard the organizer is reading out
   * from under them. The dropdown rather than the quick dialog directly, because creating a meeting
   * always starts by choosing a type or Advanced, and this link is one create entry point among
   * several, so it shouldn't be the one that quietly picks both on the organizer's behalf.
   *
   * Gated on meeting-authoring permission, not writer permission, since
   * a meeting coordinator who isn't a project writer can create meetings and gating this on
   * `canWrite` hid the link from them.
   */
  private meetingCreateLink(): DashboardQuickLink {
    return {
      label: 'Create meeting',
      icon: 'fa-light fa-calendar',
      visible: () => this.projectContextService.canWriteMeetings(),
      testId: 'create-meeting',
      command: (event: Event) => this.createMeetingMenu()?.toggle(event),
      hasPopup: 'menu',
    };
  }
}
