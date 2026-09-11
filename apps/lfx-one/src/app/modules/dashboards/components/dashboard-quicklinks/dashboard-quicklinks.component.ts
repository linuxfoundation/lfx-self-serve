// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, viewChild } from '@angular/core';
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
   * Project the dropdown creates against.
   * @description `undefined` rather than `''` for "no context": the composer treats an explicit
   * `projectUid` as taking precedence over the ambient one, so a falsy value would pin it to nothing.
   */
  protected readonly activeProjectUid = computed(() => this.projectContextService.activeContextUid() || undefined);

  protected readonly links: DashboardQuickLink[] = [
    {
      label: 'Create meeting',
      icon: 'fa-light fa-calendar',
      // Opens the same Create Meeting dropdown the meetings dashboard's button opens, over the
      // dashboard rather than routing to `/meetings/create` — that URL exists only to stay
      // deep-linkable and immediately redirects to the meetings list, so going through it would push
      // the dashboard the organizer is reading out from under them.
      //
      // The dropdown rather than the quick dialog directly: creating a meeting always starts by
      // choosing a type or Advanced, and this link is one create entry point among several, so it
      // shouldn't be the one that quietly picks both on the organizer's behalf.
      command: (event: Event) => this.createMeetingMenu()?.toggle(event),
      hasPopup: 'menu',
      // Meeting-authoring permission, not writer permission: a meeting coordinator who isn't a
      // project writer can create meetings, and gating this on `canWrite` hid the link from them.
      visible: () => this.projectContextService.canWriteMeetings(),
      testId: 'create-meeting',
    },
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
  ];

  /**
   * The links the current user can actually use.
   * @description Filtered per link rather than gated as a block, so a meeting coordinator who is not
   * a project writer still sees "Create meeting" and nothing else. The whole section hides only when
   * this is empty — an empty "Quick links" heading is worse than no heading.
   */
  protected readonly visibleLinks = computed(() => this.links.filter((link) => link.visible?.() ?? true));
}
