// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardQuickLink } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@modules/meetings/meeting-composer/meeting-composer.service';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-dashboard-quicklinks',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './dashboard-quicklinks.component.html',
})
export class DashboardQuicklinksComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly composer = inject(MeetingComposerService);

  public readonly layout = input<'header' | 'sidebar'>('header');

  protected readonly links: DashboardQuickLink[] = [
    {
      label: 'Create meeting',
      icon: 'fa-light fa-calendar',
      // Opens the composer over the dashboard rather than routing to `/meetings/create`, which
      // exists only to keep that URL deep-linkable and immediately redirects to the meetings list.
      // Going through it would push the dashboard the organizer is reading out from under them.
      // `variant: 'quick'` with no `meetingType`, matching the deep link and the dashboard's
      // "Create meeting" dropdown — a single link has nowhere to offer the drawer/type choice.
      //
      // `projectUid` is passed explicitly because the composer documents it as taking precedence
      // over the ambient project context, which resolves asynchronously — without it a composer
      // opened straight after a context switch can open against the previous project.
      command: () =>
        this.composer.open({
          mode: 'create',
          variant: 'quick',
          projectUid: this.projectContextService.activeContextUid() || undefined,
        }),
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
