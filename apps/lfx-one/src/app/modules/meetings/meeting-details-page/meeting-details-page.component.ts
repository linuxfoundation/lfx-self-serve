// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { HeaderComponent } from '@components/header/header.component';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';

import { MeetingDetailsStateService } from './meeting-details-state.service';

/**
 * The meeting details v2 page (epic #1765), rendered by {@link MeetingDetailsGateComponent} only
 * for a signed-in viewer targeted by `MEETING_V2_ENABLED_FLAG`. The pre-v2 page lives in
 * `meeting-join-v1/` and is what everyone else sees.
 *
 * This is the E1-01 shell (#1770): the three top-level branches (error, page, skeleton) and the
 * prototype's two-column layout, a content column and a sticky action rail, collapsing to one
 * column at 920px and below. Each Phase 1 section replaces one of the shell's placeholders and
 * reads the meeting from {@link MeetingDetailsStateService}, which this component provides so the
 * whole tree shares one lookup. Layout and conventions: `specs/011-meeting-details-redesign/v2-scaffold.md`.
 */
@Component({
  selector: 'lfx-meeting-details-page',
  imports: [NgClass, NgTemplateOutlet, ButtonComponent, HeaderComponent, ImpersonationBannerComponent, SkeletonModule],
  providers: [MeetingDetailsStateService],
  templateUrl: './meeting-details-page.component.html',
  styleUrl: './meeting-details-page.component.scss',
})
export class MeetingDetailsPageComponent {
  protected readonly state = inject(MeetingDetailsStateService);
  protected readonly userService = inject(UserService);
}
