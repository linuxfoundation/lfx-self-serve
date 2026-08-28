// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FullCalendarComponent } from '@app/shared/components/fullcalendar/fullcalendar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HeaderComponent } from '@components/header/header.component';
import { EventClickArg, EventInput } from '@fullcalendar/core';
import { MeetingCalendarClickProps, PublicProjectMeetingsResponse } from '@lfx-one/shared/interfaces';
import { publicMeetingToCalendarEvents, resolveMeetingCalendarClickRoute } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-public-project-calendar',
  imports: [FullCalendarComponent, EmptyStateComponent, HeaderComponent, SkeletonModule],
  templateUrl: './public-project-calendar.component.html',
})
export class PublicProjectCalendarComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);

  protected readonly loading = signal(true);
  protected readonly fetchError = signal(false);

  private readonly calendarData: Signal<PublicProjectMeetingsResponse | null> = this.initCalendarData();

  protected readonly initialView: Signal<string> = this.initInitialView();

  protected readonly projectName: Signal<string> = computed(() => this.calendarData()?.project?.name ?? '');
  protected readonly total: Signal<number> = computed(() => this.calendarData()?.total ?? 0);

  // publicMeetingToCalendarEvents (not meetingToCalendarEvents) — the public mapper never places a
  // meeting password in extendedProps, so a click can't forward one into the join URL, history, or referrer.
  protected readonly calendarEvents: Signal<EventInput[]> = computed(() =>
    (this.calendarData()?.meetings ?? []).flatMap((m) => publicMeetingToCalendarEvents(m) as EventInput[])
  );

  /** Handles FullCalendar event click — navigates to the public meeting join page. Cancelled occurrences are inert. */
  protected onCalendarEventClick(arg: EventClickArg): void {
    const route = resolveMeetingCalendarClickRoute(arg.event.extendedProps as MeetingCalendarClickProps, arg.event.start);
    if (!route) {
      return;
    }
    void this.router.navigate(route.path, route.queryParams ? { queryParams: route.queryParams } : undefined);
  }

  // Private initializer functions

  private initInitialView(): Signal<string> {
    return toSignal(this.route.queryParamMap.pipe(map((params) => (params.get('view') === 'week' ? 'timeGridWeek' : 'dayGridMonth'))), {
      initialValue: 'dayGridMonth',
    });
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
          return this.meetingService.getPublicProjectMeetings(slug, committeeUid).pipe(
            map((response) => {
              this.loading.set(false);
              return response;
            }),
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
}
