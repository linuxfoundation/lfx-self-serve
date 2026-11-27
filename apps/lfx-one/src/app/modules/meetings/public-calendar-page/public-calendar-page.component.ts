// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import {
  MeetingCalendarGridEntry,
  MeetingCalendarView,
  PublicCalendarFeedState,
  PublicCalendarItem,
  PublicCalendarMeetingModalData,
  PublicGroupSummary,
} from '@lfx-one/shared/interfaces';
import { isUuid, toPublicCalendarItems } from '@lfx-one/shared/utils';
import { GroupService } from '@services/group.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectValueDirective } from '@shared/uikit/select/select-value.directive';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { catchError, combineLatest, distinctUntilChanged, finalize, map, of, startWith, switchMap } from 'rxjs';

import { MeetingPageFooterComponent } from '../meeting-page/footer/meeting-page-footer.component';
import { MeetingPageTopBarComponent } from '../meeting-page/top-bar/meeting-page-top-bar.component';
import { MeetingsCalendarGridComponent } from '../meetings-redesign/components/meetings-calendar-grid/meetings-calendar-grid.component';
import { PublicCalendarMeetingModalComponent } from './meeting-modal/public-calendar-meeting-modal.component';

/**
 * Redesigned `/projects/:projectSlug/calendar`, matched by `publicCalendarRedesignGuard`: a project's public meetings on a
 * month or week grid, filtered to one group by `?committee=<uid>`, with the week view in `?view=week`.
 * @description The feed loads once, unfiltered, and the group filter applies on the client, so it only lists groups with
 * public meetings and never empties itself. Cancelled occurrences stay off the grid. The grid renders in the browser only,
 * since its days and times follow the viewer's time zone; phones get the month view only. A chip opens the meeting modal
 * through `?meeting=<entry key>`.
 */
@Component({
  selector: 'lfx-public-calendar-page',
  imports: [
    ImpersonationBannerComponent,
    MeetingPageFooterComponent,
    MeetingPageTopBarComponent,
    MeetingsCalendarGridComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSelectValueDirective,
    UiSkeletonComponent,
  ],
  templateUrl: './public-calendar-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicCalendarPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly groupService = inject(GroupService);
  private readonly modal = inject(UiModalService);
  protected readonly userService = inject(UserService);

  /** A date in the shown month or week. */
  protected readonly focus = signal(new Date());
  protected readonly now = signal(new Date());
  /** The grid follows the viewer's clock and zone, so it waits for the browser. */
  protected readonly browser = signal(false);
  protected readonly phone = signal(false);
  /** The viewer's zone abbreviation, such as "CET"; empty until the browser renders. */
  protected readonly zone = signal('');
  /** Bumped by Retry to load the feed again. */
  private readonly attempt = signal(0);
  /** Cells of the faded month behind the empty state. */
  protected readonly emptyCells = Array.from({ length: 35 }, (_, index) => index);

  private readonly slug: Signal<string> = toSignal(this.route.paramMap.pipe(map((params) => params.get('projectSlug') ?? '')), { initialValue: '' });
  protected readonly committeeUid: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('committee'))), {
    initialValue: null,
  });
  private readonly meetingKey: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('meeting'))), {
    initialValue: null,
  });
  protected readonly view: Signal<MeetingCalendarView> = toSignal(
    this.route.queryParamMap.pipe(map((params): MeetingCalendarView => (params.get('view') === 'week' ? 'week' : 'month'))),
    { initialValue: 'month' }
  );
  protected readonly feed: Signal<PublicCalendarFeedState> = this.initFeed();
  /** The public group directory; null until it loads, empty when it fails. */
  private readonly directory: Signal<PublicGroupSummary[] | null> = this.initDirectory();

  /** The server renders loading too, so hydration starts from the same markup; a selected group also waits for its name. */
  protected readonly loading: Signal<boolean> = computed(
    () => !this.browser() || this.feed().status === 'loading' || (!!this.committeeUid() && this.directory() === null)
  );
  /** Every date in the feed, each once. */
  private readonly items: Signal<PublicCalendarItem[]> = computed(() => toPublicCalendarItems(this.feed().response?.meetings ?? [], this.now()));
  protected readonly projectName: Signal<string> = computed(() => this.feed().response?.project.name ?? '');
  protected readonly logoUrl: Signal<string> = computed(() => this.feed().response?.project.logo_url ?? '');
  protected readonly initials: Signal<string> = computed(() =>
    this.projectName()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('')
  );
  /** Directory groups with at least one public meeting, plus the selected one, A to Z. */
  protected readonly groups: Signal<PublicGroupSummary[]> = this.initGroups();
  protected readonly unknownGroup: Signal<boolean> = this.initUnknownGroup();
  protected readonly entries: Signal<MeetingCalendarGridEntry[]> = this.initEntries();
  /** The meeting date in `?meeting=`, ready to open in the modal once the grid shows. */
  private readonly openMeeting: Signal<PublicCalendarMeetingModalData | null> = this.initOpenMeeting();
  protected readonly calendarView: Signal<MeetingCalendarView> = computed(() => (this.phone() ? 'month' : this.view()));

  public constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const query = window.matchMedia(PHONE_MEDIA_QUERY);
      const onChange = (event: MediaQueryListEvent): void => this.phone.set(event.matches);
      query.addEventListener?.('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener?.('change', onChange));
      this.phone.set(query.matches);
      this.now.set(new Date());
      this.focus.set(new Date());
      this.zone.set(
        new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? ''
      );
      this.browser.set(true);
    });
    // `?meeting=` drives the modal, so a link or the return from sign-in reopens it.
    toObservable(this.openMeeting)
      .pipe(
        distinctUntilChanged((a, b) => a?.entry.key === b?.entry.key),
        switchMap((data) => {
          if (!data) return of(null);
          const ref = this.modal.open<boolean, PublicCalendarMeetingModalData>(PublicCalendarMeetingModalComponent, { data });
          // Leaving the date in the URL, or the page, closes its modal; a modal that went to a meeting page keeps the URL.
          return ref.closed.pipe(
            map((left) => (left ? null : data)),
            finalize(() => ref.close())
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((closed) => {
        // Compares resolved dates: a live occurrence's link may have opened its archived row.
        if (closed && this.openMeeting()?.entry.key === closed.entry.key) this.updateQuery({ meeting: null });
      });
  }

  protected openEntry(entry: MeetingCalendarGridEntry): void {
    this.updateQuery({ meeting: entry.key });
  }

  protected retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  protected setGroup(uid: string | null): void {
    this.updateQuery({ committee: uid || null });
  }

  protected setView(view: MeetingCalendarView): void {
    if (view !== this.view()) this.updateQuery({ view: view === 'week' ? 'week' : null });
  }

  private initFeed(): Signal<PublicCalendarFeedState> {
    return toSignal(
      combineLatest([toObservable(this.slug).pipe(distinctUntilChanged()), toObservable(this.attempt)]).pipe(
        switchMap(([slug]) =>
          this.meetingService.getPublicProjectMeetings(slug).pipe(
            map((response): PublicCalendarFeedState => ({ status: 'ready', response })),
            catchError(() => of<PublicCalendarFeedState>({ status: 'error', response: null })),
            startWith<PublicCalendarFeedState>({ status: 'loading', response: null })
          )
        )
      ),
      { initialValue: { status: 'loading', response: null } }
    );
  }

  private initDirectory(): Signal<PublicGroupSummary[] | null> {
    return toSignal(
      toObservable(this.slug).pipe(
        distinctUntilChanged(),
        switchMap((slug) =>
          this.groupService.getPublicProjectGroups(slug).pipe(
            map((response) => response.groups ?? []),
            // Without the directory the calendar still shows, unfiltered and without group names.
            catchError((error) => {
              console.error(`Failed to load the public group directory for project ${slug}:`, error);
              return of<PublicGroupSummary[]>([]);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initGroups(): Signal<PublicGroupSummary[]> {
    return computed(() => {
      const used = new Set((this.feed().response?.meetings ?? []).flatMap((meeting) => meeting.committee_uids ?? []));
      const selected = this.committeeUid();
      if (selected) used.add(selected);
      // Locale pinned so the server and the browser sort alike.
      return (this.directory() ?? []).filter((group) => used.has(group.uid)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    });
  }

  /** `?committee=` names no group in the directory: a stale or hand-edited link. */
  private initUnknownGroup(): Signal<boolean> {
    return computed(() => {
      const uid = this.committeeUid();
      if (!uid) return false;
      if (!isUuid(uid)) return true;
      const directory = this.directory();
      return !!directory?.length && !directory.some((group) => group.uid === uid);
    });
  }

  private initEntries(): Signal<MeetingCalendarGridEntry[]> {
    return computed(() => {
      const uid = this.committeeUid();
      return this.items()
        .filter((item) => !uid || item.meeting.committee_uids?.includes(uid))
        .map((item) => item.entry);
    });
  }

  private initOpenMeeting(): Signal<PublicCalendarMeetingModalData | null> {
    return computed(() => {
      const key = this.meetingKey();
      // Waits for the group names too: the open modal keeps the data it opened with.
      if (!key || !this.browser() || this.directory() === null) return null;
      // A live date's key, `{series}-{occurrence seconds}`, names its archived row, `{series}-{ms}`, once that replaces it.
      const archived = /^(.+)-(\d{10})$/.exec(key);
      const item = this.items().find(({ entry }) => entry.key === key || (!!archived && entry.key === `${archived[1]}-${archived[2]}000`));
      if (!item) return null;
      const uids = item.meeting.committee_uids ?? [];
      const groups = (this.directory() ?? []).filter((group) => uids.includes(group.uid)).map((group) => group.name);
      return { ...item, groups };
    });
  }

  /** Filters live in the URL, so a filtered calendar can be shared and the back button undoes a change. */
  private updateQuery(queryParams: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
