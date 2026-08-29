// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FullCalendarComponent } from '@app/shared/components/fullcalendar/fullcalendar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HeaderComponent } from '@components/header/header.component';
import { SelectComponent } from '@components/select/select.component';
import { EventClickArg, EventInput } from '@fullcalendar/core';
import { BEHAVIORAL_CLASS_CONFIG } from '@lfx-one/shared/constants';
import {
  CalendarLegendItem,
  GroupBehavioralClass,
  MeetingCalendarClickProps,
  PublicCalendarCommittee,
  PublicCalendarCommitteeContext,
  PublicGroupSummary,
  PublicProjectMeetingsResponse,
} from '@lfx-one/shared/interfaces';
import {
  getGroupBehavioralClass,
  isUuid,
  publicMeetingToCalendarEvents,
  resolveMeetingCalendarClickRoute,
  resolvePublicCalendarLegend,
} from '@lfx-one/shared/utils';
import { GroupService } from '@services/group.service';
import { MeetingService } from '@services/meeting.service';
import { SelectChangeEvent } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-public-project-calendar',
  imports: [FullCalendarComponent, EmptyStateComponent, HeaderComponent, SelectComponent, SkeletonModule],
  templateUrl: './public-project-calendar.component.html',
})
export class PublicProjectCalendarComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly groupService = inject(GroupService);

  protected readonly committeeForm = new FormGroup({
    committee: new FormControl<string | null>(null),
  });

  protected readonly loading = signal(true);
  protected readonly fetchError = signal(false);

  private readonly calendarData: Signal<PublicProjectMeetingsResponse | null> = this.initCalendarData();
  private readonly groups: Signal<PublicGroupSummary[]> = this.initGroups();

  protected readonly initialView: Signal<string> = this.initInitialView();
  protected readonly activeCommitteeUid: Signal<string | null> = this.initActiveCommitteeUid();

  protected readonly projectName: Signal<string> = computed(() => this.calendarData()?.project?.name ?? '');
  protected readonly total: Signal<number> = computed(() => this.calendarData()?.total ?? 0);

  private readonly committeesByUid: Signal<Record<string, PublicCalendarCommittee>> = this.initCommitteesByUid();

  private readonly committeeContext: Signal<PublicCalendarCommitteeContext> = computed(() => ({
    activeCommitteeUid: this.activeCommitteeUid() ?? undefined,
    committeesByUid: this.committeesByUid(),
  }));

  /**
   * Every group in the project's public directory, not only those with meetings in the current feed —
   * narrowing to groups that happen to appear would empty the dropdown as soon as a filter is applied.
   */
  protected readonly committeeOptions: Signal<{ label: string; value: string | null }[]> = computed(() => [
    { label: 'All groups', value: null },
    ...this.groups()
      .map((group) => ({ label: group.name, value: group.uid }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);

  protected readonly activeCommittee: Signal<PublicCalendarCommittee | undefined> = computed(() => {
    const uid = this.activeCommitteeUid();
    if (!uid) {
      return undefined;
    }
    return this.committeesByUid()[uid];
  });

  protected readonly unknownCommittee: Signal<boolean> = this.initUnknownCommittee();

  // publicMeetingToCalendarEvents (not meetingToCalendarEvents) — the public mapper never places a
  // meeting password in extendedProps, so a click can't forward one into the join URL, history, or referrer.
  protected readonly calendarEvents: Signal<EventInput[]> = computed(() => {
    const context = this.committeeContext();
    return (this.calendarData()?.meetings ?? []).flatMap((meeting) => publicMeetingToCalendarEvents(meeting, context) as EventInput[]);
  });

  protected readonly legendItems: Signal<CalendarLegendItem[]> = this.initLegendItems();

  public constructor() {
    // The URL stays authoritative for the dropdown so deep links and browser back/forward are reflected.
    // Per frontend-checklist §5 this is a toObservable/RxJS subscription rather than an effect().
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const uid = params.get('committee');
      const control = this.committeeForm.controls.committee;
      if (control.value !== uid) {
        control.setValue(uid, { emitEvent: false });
      }
    });
  }

  /** Handles FullCalendar event click — navigates to the public meeting join page. Cancelled occurrences are inert. */
  protected onCalendarEventClick(arg: EventClickArg): void {
    const route = resolveMeetingCalendarClickRoute(arg.event.extendedProps as MeetingCalendarClickProps, arg.event.start);
    if (!route) {
      return;
    }
    void this.router.navigate(route.path, route.queryParams ? { queryParams: route.queryParams } : undefined);
  }

  protected onCommitteeChange(event: SelectChangeEvent): void {
    this.applyCommitteeFilter((event.value as string | null) ?? null);
  }

  protected clearCommitteeFilter(): void {
    this.applyCommitteeFilter(null);
  }

  // Private initializer functions

  /**
   * Publicly listed groups keyed by UID — the only source of committee names and colors on this page.
   * The meetings feed publishes committee UIDs without names, so a committee missing from the directory
   * stays anonymous rather than having a non-public name rendered.
   */
  private initCommitteesByUid(): Signal<Record<string, PublicCalendarCommittee>> {
    return computed(() =>
      this.groups().reduce<Record<string, PublicCalendarCommittee>>((byUid, group) => {
        byUid[group.uid] = { uid: group.uid, name: group.name, behavioralClass: this.toBehavioralClass(group) };
        return byUid;
      }, {})
    );
  }

  /**
   * The colors on screen and what each one means — see `resolvePublicCalendarLegend`.
   *
   * Suppressed below two entries: one color distinguishes nothing, so there is no key to explain, and a
   * lone "No group" swatch (an unfiltered calendar with no group directory) is pure noise.
   */
  private initLegendItems(): Signal<CalendarLegendItem[]> {
    return computed(() => {
      const legend = resolvePublicCalendarLegend(this.calendarEvents());
      return legend.length > 1 ? legend : [];
    });
  }

  /**
   * True when `?committee=` cannot name a group anyone could reach — a stale bookmark or a hand-edited
   * URL. Distinguished from "no meetings" so the reader is told the filter is the problem.
   *
   * A malformed value is decided without waiting for the directory: nothing that isn't a UUID can ever
   * match, and the request is skipped for it. A well-formed value needs a loaded directory before it can
   * be called unknown — an empty `groups()` means not-yet-loaded or a failed fetch, neither of which
   * proves the UID is bad.
   */
  private initUnknownCommittee(): Signal<boolean> {
    return computed(() => {
      const uid = this.activeCommitteeUid();
      if (!uid) {
        return false;
      }
      if (!isUuid(uid)) {
        return true;
      }
      return this.groups().length > 0 && !this.activeCommittee();
    });
  }

  private initInitialView(): Signal<string> {
    return toSignal(this.route.queryParamMap.pipe(map((params) => (params.get('view') === 'week' ? 'timeGridWeek' : 'dayGridMonth'))), {
      initialValue: 'dayGridMonth',
    });
  }

  private initActiveCommitteeUid(): Signal<string | null> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((params) => params.get('committee')),
        distinctUntilChanged()
      ),
      { initialValue: null }
    );
  }

  private initGroups(): Signal<PublicGroupSummary[]> {
    return toSignal(
      this.route.paramMap.pipe(
        map((params) => params.get('projectSlug') ?? ''),
        // The directory is not scoped by the committee filter, so only a project change warrants a refetch.
        distinctUntilChanged(),
        switchMap((slug) =>
          this.groupService.getPublicProjectGroups(slug).pipe(
            map((response) => response.groups ?? []),
            // A directory failure costs the filter, labels, and legend but not the calendar itself, so
            // degrade to an unlabelled calendar instead of surfacing the page-level error state. Logged
            // because the degrade is otherwise invisible: the page still renders and nothing tells an
            // operator the filter silently vanished.
            catchError((error) => {
              console.error(`Failed to load the public group directory for project ${slug}:`, error);
              return of<PublicGroupSummary[]>([]);
            })
          )
        )
      ),
      { initialValue: [] as PublicGroupSummary[] }
    );
  }

  private initCalendarData(): Signal<PublicProjectMeetingsResponse | null> {
    return toSignal(
      combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
        map(([params, queryParams]) => ({ slug: params.get('projectSlug') ?? '', committeeUid: queryParams.get('committee') ?? undefined })),
        // Only slug and committee affect the request — without this, switching ?view=month|week would
        // re-enter switchMap, refetching the feed and flashing the skeleton on a pure view toggle.
        distinctUntilChanged((a, b) => a.slug === b.slug && a.committeeUid === b.committeeUid),
        switchMap(({ slug, committeeUid }) => {
          this.loading.set(true);
          this.fetchError.set(false);

          // The server rejects a non-UUID `committee` with a 400, which would surface as the generic
          // "Unable to load calendar" error rather than the "group not found" state this actually is.
          // Skip the round trip and let `unknownCommittee` render.
          if (committeeUid && !isUuid(committeeUid)) {
            this.loading.set(false);
            return of(null);
          }

          return this.meetingService.getPublicProjectMeetings(slug, committeeUid).pipe(
            map((response) => {
              this.loading.set(false);
              return response;
            }),
            // Not logged here: MeetingService.getPublicProjectMeetings already logs the failure before
            // rethrowing, unlike GroupService, which has no handler of its own.
            catchError(() => {
              this.loading.set(false);
              this.fetchError.set(true);
              return of(null);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  // Private helper methods

  /** Writes the filter to the URL rather than to local state, keeping the view shareable and bookmarkable. */
  private applyCommitteeFilter(committeeUid: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      // A null value drops the key, so clearing the filter yields a clean URL rather than `?committee=`.
      queryParams: { committee: committeeUid || null },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Prefers the server-computed `behavioral_class` so the calendar's colors cannot drift from the badges
   * the public group directory renders for the same groups. Falls back to deriving from `category` only
   * when the field is missing or carries a class this build does not know.
   */
  private toBehavioralClass(group: PublicGroupSummary): GroupBehavioralClass {
    if (group.behavioral_class && group.behavioral_class in BEHAVIORAL_CLASS_CONFIG) {
      return group.behavioral_class as GroupBehavioralClass;
    }
    return getGroupBehavioralClass(group.category);
  }
}
