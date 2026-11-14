// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { MEETING_PAGE_CANCELLED_COPY, MEETING_PAGE_LEGACY_STATE } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeRow, MeetingPageCancelledLink, MeetingPageView, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import {
  getMeetingDetailsState,
  getMeetingPageCancelledLink,
  isPastMeetingCalendarRow,
  toCancelledSeriesHomeRow,
  toPastMeetingHomeRow,
  toUpcomingMeetingHomeRow,
} from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { distinctUntilChanged, filter, map } from 'rxjs';

import { MeetingPageDataService } from '../services/meeting-page-data.service';
import { MeetingPageDetailsComponent, MeetingPageRowHost } from './details/meeting-page-details.component';
import { MeetingPageFooterComponent } from './footer/meeting-page-footer.component';
import { MeetingPageTopBarComponent } from './top-bar/meeting-page-top-bar.component';

/**
 * The redesigned `/meetings/:id` page, matched by `meetingPageRedesignGuard`: the meeting details for a signed-in viewer
 * with full access, with loading and error states. Not-found goes to `/meetings/not-found` like the legacy page.
 * @description Fallback rule: a meeting the signed-in viewer fully sees renders here, upcoming, live or ended; a viewer
 * without full access (such as a password-only guest) and a series with no date left re-navigate the same URL to the
 * legacy page, on the server too, so hydration keeps the page it rendered. A link to a cancelled date shows the date the
 * page falls back to under a note; a series whose every date is cancelled shows its series fields under a note while its
 * start is still ahead of the join window.
 */
@Component({
  selector: 'lfx-meeting-page',
  imports: [
    ImpersonationBannerComponent,
    MeetingPageDetailsComponent,
    MeetingPageFooterComponent,
    MeetingPageTopBarComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiNoteComponent,
    UiSkeletonComponent,
  ],
  providers: [MeetingPageDataService, { provide: MeetingPageRowHost, useExisting: MeetingPageComponent }],
  templateUrl: './meeting-page.component.html',
})
export class MeetingPageComponent implements MeetingPageRowHost {
  private readonly pageData = inject(MeetingPageDataService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly userService = inject(UserService);

  protected readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.pageData.load();
  /** The cancelled date or series the link names, if any. */
  private readonly cancelledLink: Signal<MeetingPageCancelledLink | null> = this.initCancelledLink();
  /** The row the details show; null until the meeting loaded and this page serves it. */
  public readonly row: Signal<MeetingHomeRow | null> = this.initRow();
  protected readonly view: Signal<MeetingPageView> = this.initView();
  /** The cancelled note above the details; null when the link names no cancelled date. */
  protected readonly cancelledNote: Signal<string | null> = this.initCancelledNote();
  /** Banner offset and the details' sticky offset: the 72px top bar (56px on phones), plus the 36px banner while impersonating. */
  protected readonly pageOffsets: Signal<string> = computed(() =>
    this.userService.impersonating()
      ? 'pt-[36px] [--mp-offset:36px] [--md-head:108px] max-sm:[--md-head:92px]'
      : '[--mp-offset:0px] [--md-head:72px] max-sm:[--md-head:56px]'
  );
  /** Loaded as a past date, which greys the top bar's date tile. */
  protected readonly past: Signal<boolean> = this.pageData.loadedViaPastMeetingId;
  /** One key while a row shows: the row's, and the reload count, so the details are re-created only when either changes. */
  protected readonly detailsKey: Signal<string[]> = computed(() => {
    const row = this.row();
    return row ? [`${row.key}:${this.pageData.reloadsDone()}`] : [];
  });

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
      const loaded = this.meeting();
      if (!loaded || !this.pageData.meetingMatchesRoute()) return null;
      // The public payload carries its project apart; the details read the flattened fields.
      const { project } = loaded;
      const meeting = {
        ...loaded,
        project_name: loaded.project_name || project?.name,
        project_slug: loaded.project_slug || project?.slug,
        project_logo_url: loaded.project_logo_url || project?.logo_url,
        project_uid: loaded.project_uid || project?.uid,
      };
      if (this.pageData.loadedViaPastMeetingId()) {
        return this.pageData.pastMeetingFullAccess() && isPastMeetingCalendarRow(meeting) ? toPastMeetingHomeRow(meeting) : null;
      }
      if (!this.pageData.liveMeetingFullAccess()) return null;
      if (this.cancelledLink()?.kind === 'series') return this.cancelledSeriesRow(meeting);
      return toUpcomingMeetingHomeRow(meeting, this.pageData.resolveOccurrence(meeting));
    });
  }

  private initCancelledLink(): Signal<MeetingPageCancelledLink | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting || this.pageData.loadedViaPastMeetingId()) return null;
      const requested = Number(this.route.snapshot.queryParamMap.get('occurrence'));
      return getMeetingPageCancelledLink(meeting, Number.isFinite(requested) && requested > 0 ? requested : null);
    });
  }

  private initCancelledNote(): Signal<string | null> {
    return computed(() => {
      const link = this.cancelledLink();
      if (!link || !this.row()) return null;
      if (!link.cancelledStart) return MEETING_PAGE_CANCELLED_COPY.series;
      const date = new Date(link.cancelledStart).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      return MEETING_PAGE_CANCELLED_COPY.occurrence.replace('{date}', date);
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

  /** Every date cancelled: the series fields while the start is still ahead of the join window, so it never reads as ended. */
  private cancelledSeriesRow(meeting: Meeting): MeetingHomeRow | null {
    const series = toCancelledSeriesHomeRow(meeting);
    if (!series) return null;
    const state = getMeetingDetailsState(series.startTime, series.durationMinutes, new Date(this.pageData.clock()), {
      earlyJoinMinutes: meeting.early_join_time_minutes,
    });
    return state === 'far' ? series : null;
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
