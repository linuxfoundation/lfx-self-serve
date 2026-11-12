// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';

import { MeetingPageFooterComponent } from '../footer/meeting-page-footer.component';
import { MeetingPageTopBarComponent } from '../top-bar/meeting-page-top-bar.component';

/**
 * `/meetings/not-found` in the redesigned page's chrome, matched by `meetingPageRedesignGuard`: the same copy as the legacy
 * page, with Go to my meetings and Contact Support.
 */
@Component({
  selector: 'lfx-meeting-page-not-found',
  imports: [
    ImpersonationBannerComponent,
    MeetingPageFooterComponent,
    MeetingPageTopBarComponent,
    OpenIntercomDirective,
    UiButtonComponent,
    UiEmptyStateComponent,
  ],
  templateUrl: './meeting-page-not-found.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingPageNotFoundComponent {
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  protected readonly userService = inject(UserService);

  /** Home > Meetings on the Me lens. */
  protected openMyMeetings(): void {
    this.lensService.setLens('me');
    void this.router.navigate(['/meetings']);
  }
}
