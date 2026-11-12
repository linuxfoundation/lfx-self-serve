// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { HeaderComponent } from '@components/header/header.component';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { MEETING_PAGE_LEGACY_STATE } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeRow, MeetingPageView, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { isPastMeetingCalendarRow, toPastMeetingHomeRow } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { distinctUntilChanged, filter, map } from 'rxjs';

import { MeetingPageDataService } from '../services/meeting-page-data.service';
import { MeetingPageDetailsComponent, MeetingPageRowHost } from './details/meeting-page-details.component';

/**
 * The redesigned `/meetings/:id` page, matched by `meetingPageRedesignGuard`: the meeting details for a signed-in viewer
 * with full access, with loading and error states. Not-found goes to `/meetings/not-found` like the legacy page.
 * @description Fallback rule: only an ended meeting, opened by a viewer with full access, renders here; anything
 * else re-navigates the same URL to the legacy page, on the server too, so hydration keeps the page it rendered.
 */
@Component({
  selector: 'lfx-meeting-page',
  imports: [HeaderComponent, ImpersonationBannerComponent, MeetingPageDetailsComponent, UiButtonComponent, UiEmptyStateComponent, UiSkeletonComponent],
  providers: [MeetingPageDataService, { provide: MeetingPageRowHost, useExisting: MeetingPageComponent }],
  templateUrl: './meeting-page.component.html',
})
export class MeetingPageComponent implements MeetingPageRowHost {
  private readonly pageData = inject(MeetingPageDataService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly userService = inject(UserService);

  protected readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.pageData.load();
  /** The row the details show; null until the meeting loaded and this page serves it. */
  public readonly row: Signal<MeetingHomeRow | null> = this.initRow();
  protected readonly view: Signal<MeetingPageView> = this.initView();

  public constructor() {
    bindLfxDocumentTitle(computed(() => this.row()?.title ?? ''));
    this.pageData.startClock();
    const view$ = toObservable(this.view).pipe(takeUntilDestroyed(this.destroyRef));
    view$.pipe(filter((view) => view === 'fallback')).subscribe(() => this.fallBack());
    // Once per meeting this page shows, so a visit handed to the legacy page is counted there alone.
    view$
      .pipe(
        filter((view) => view === 'details'),
        map(() => this.pageData.routeId()),
        distinctUntilChanged()
      )
      .subscribe(() => this.pageData.trackPageview());
  }

  protected reload(): void {
    this.pageData.refresh();
  }

  private initRow(): Signal<MeetingHomeRow | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting || !this.pageData.meetingMatchesRoute() || !this.serves() || !isPastMeetingCalendarRow(meeting)) return null;
      // The public payload carries its project apart; the details read the flattened fields.
      const { project } = meeting;
      return toPastMeetingHomeRow({
        ...meeting,
        project_name: meeting.project_name || project?.name,
        project_slug: meeting.project_slug || project?.slug,
        project_logo_url: meeting.project_logo_url || project?.logo_url,
      });
    });
  }

  private initView(): Signal<MeetingPageView> {
    return computed(() => {
      const meeting = this.meeting();
      const matches = this.pageData.meetingMatchesRoute();
      if (this.pageData.meetingLoadFailed() && (!meeting || !matches)) return 'error';
      if (!meeting || !matches) return 'loading';
      return this.row() ? 'details' : 'fallback';
    });
  }

  /** An ended meeting the viewer fully sees; live join stays on the legacy page. */
  private serves(): boolean {
    return this.pageData.loadedViaPastMeetingId() && this.pageData.pastMeetingFullAccess();
  }

  // The guard skips this page for a navigation carrying the legacy state, and records that for hydration on the server.
  // shortcut: the legacy page loads the meeting again, so a fallback costs a second fetch. revisit: when most visits render here.
  private fallBack(): void {
    void this.router.navigateByUrl(this.router.url, {
      skipLocationChange: true,
      onSameUrlNavigation: 'reload',
      state: { [MEETING_PAGE_LEGACY_STATE]: true },
    });
  }
}
