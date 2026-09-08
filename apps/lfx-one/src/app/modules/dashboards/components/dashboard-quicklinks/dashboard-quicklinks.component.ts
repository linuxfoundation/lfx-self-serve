// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardQuickLink } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@modules/meetings/meeting-composer/meeting-composer.service';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-dashboard-quicklinks',
  imports: [RouterLink],
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
      command: () => this.composer.open({ mode: 'create', variant: 'quick' }),
      testId: 'create-meeting',
    },
    { label: 'Create group', icon: 'fa-light fa-users', route: ['/groups', 'create'], testId: 'create-group' },
    { label: 'Create mailing list', icon: 'fa-light fa-envelope', route: ['/mailing-lists', 'create'], testId: 'create-mailing-list' },
  ];

  protected readonly canWrite = this.projectContextService.canWrite;
}
