// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { computed, inject, Injectable, makeStateKey, PLATFORM_ID, Signal, signal, TransferState } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import { Meeting, MeetingDetailsLoadStatus, MeetingJoinPageState, PublicMeetingProject, PublicPastMeetingResponse } from '@lfx-one/shared/interfaces';
import { isPastMeetingCompositeId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { BehaviorSubject, catchError, combineLatest, EMPTY, interval, map, Observable, switchMap, tap, timer } from 'rxjs';

import { MeetingDetailsSeedService } from '../meeting-details-gate/meeting-details-seed.service';

/**
 * Loads the meeting for the V2 details page and decides which top-level branch it shows (E1-01).
 * @description Provided by {@link MeetingDetailsPageComponent}, so every Phase 1 section injects
 * one shared instance instead of fetching again. It composes the same `MeetingService` lookups V1
 * uses and keeps V1's contracts (GH-2041, PR #2046), without importing anything from V1:
 *
 * - **Seed.** On the browser it starts from the snapshot the gate took
 *   ({@link MeetingDetailsSeedService}), including the terminal-error branch, so a seeded page
 *   never flashes the skeleton. On the server it writes the same `MeetingJoinPageState` V1 writes,
 *   for when #2920 lets V2 render there.
 * - **Reachability.** V2 cannot rely on V1 to reject a bad id: on an in-app navigation V1 is torn
 *   down before its lookup settles. A 400 / 403 / 404 goes to `/meetings/not-found`; any other
 *   failure is the `error` branch.
 * - **No stale content.** `matchesRoute` is false from the moment the route id changes until that
 *   id's lookup succeeds, so navigating from one meeting to another shows the skeleton, never the
 *   previous meeting (and its join links) under the new URL.
 */
@Injectable()
export class MeetingDetailsStateService {
  private readonly meetingService = inject(MeetingService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);
  private readonly seedService = inject(MeetingDetailsSeedService, { optional: true });
  private readonly stateKey = makeStateKey<MeetingJoinPageState>(MEETING_JOIN_STATE_KEY);

  /** True when the page was reached through a past-meeting composite id (`meetingId-timestamp`). */
  public readonly loadedViaPastMeetingId = signal(false);
  /** The past endpoint's `full_access`; false for an upcoming meeting. */
  public readonly pastMeetingFullAccess = signal(false);
  /** The meeting password for lookups: `?password=`, or else the composer's navigation state. */
  public readonly password = signal<string | null>(null);
  /**
   * The password only when it is already in this page's own address bar.
   * @description Anything that writes a password into a link (an occurrence or join URL) MUST read
   * this, never `password`: the composer passes its password in navigation state precisely to keep
   * it out of URLs, the history, `Referer` headers and proxy logs.
   */
  public readonly urlPassword = signal<string | null>(null);
  /** True from a retry until that lookup settles, so the error state can show progress. */
  public readonly retrying = signal(false);
  /** Failed lookups in a row for the current route; reset by a success or a route change. */
  public readonly failureCount = signal(0);
  private readonly loadFailed = signal(false);
  // Route id the pipeline is attempting, set as soon as a route change is observed.
  private readonly routeId = signal<string | null>(null);
  // Route id the held `meeting()` value actually resolved for. Only a success moves it.
  private readonly resolvedRouteId = signal<string | null>(null);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  public readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined>;
  /**
   * The current time, ticking every 30 seconds on the browser, so anything derived from the time state
   * (the identity bar's status, E1-05's pill) moves from upcoming to live to ended while the page is
   * open. Fixed on the server, where a timer would keep the render from ever becoming stable.
   */
  public readonly now: Signal<Date> = this.initNow();
  public readonly matchesRoute: Signal<boolean> = computed(() => this.routeId() === this.resolvedRouteId());
  public readonly status: Signal<MeetingDetailsLoadStatus> = this.initStatus();

  public constructor() {
    const routeId = this.activatedRoute.snapshot.paramMap.get('id');
    const seed = isPlatformBrowser(this.platformId) ? (this.seedService?.take(routeId) ?? null) : null;

    if (seed) {
      this.loadedViaPastMeetingId.set(seed.loadedViaPastMeetingId);
      this.pastMeetingFullAccess.set(seed.pastMeetingFullAccess);
      this.routeId.set(routeId);
      if (seed.meetingLoadFailed) {
        this.loadFailed.set(true);
      } else if (seed.meeting) {
        this.resolvedRouteId.set(routeId);
      }
    }

    this.applyPassword(this.activatedRoute.snapshot.queryParamMap);
    this.meeting = this.initMeeting(seed);
  }

  /** Re-runs the lookup for the current route, e.g. from the error state's retry. */
  public refresh(): void {
    this.retrying.set(true);
    this.refresh$.next();
  }

  private initNow(): Signal<Date> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal(new Date()).asReadonly();
    }
    return toSignal(interval(30_000).pipe(map(() => new Date())), { initialValue: new Date() });
  }

  private initStatus(): Signal<MeetingDetailsLoadStatus> {
    return computed(() => {
      const meeting = this.meeting();
      // Checked ahead of `meeting()`: `toSignal` keeps the last good meeting across a later failure,
      // so the error branch must win whenever that meeting is absent or belongs to another route.
      if (this.loadFailed() && (!meeting || !this.matchesRoute())) {
        return 'error';
      }
      return meeting && this.matchesRoute() ? 'ready' : 'loading';
    });
  }

  private initMeeting(seed: MeetingJoinPageState | null): Signal<(Meeting & { project: PublicMeetingProject }) | undefined> {
    const meeting$ = combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap, this.refresh$]).pipe(
      // Before the lookup is scheduled, so `matchesRoute` turns false the instant the route changes.
      tap(([params]) => {
        const meetingId = params.get('id');
        if (meetingId !== this.routeId()) {
          this.loadFailed.set(false);
          this.failureCount.set(0);
        }
        this.routeId.set(meetingId);
      }),
      // The one-tick timer coalesces the paramMap / queryParamMap emissions of one navigation into a
      // single lookup. It sits inside `switchMap`, not before it as a `debounceTime`, so a new
      // emission cancels the previous lookup at once: otherwise the previous meeting's request stays
      // live for that tick, and settling then would mark it as the new route's meeting or send the
      // new route to not-found.
      switchMap(([params, queryParams]) =>
        timer(0).pipe(
          switchMap(() => {
            const meetingId = params.get('id');
            this.applyPassword(queryParams);

            if (!meetingId) {
              this.retrying.set(false);
              void this.router.navigate(['/meetings/not-found']);
              return EMPTY;
            }

            return isPastMeetingCompositeId(meetingId) ? this.fetchPast(meetingId) : this.fetchUpcomingThenPast(meetingId);
          })
        )
      ),
      map((res) => ({ ...res.meeting, project: res.project })),
      tap((meeting) => {
        // For the same route only a settled success clears a terminal error (a route change resets
        // it above), so a seeded error view is not reset before its refetch has succeeded.
        this.loadFailed.set(false);
        this.failureCount.set(0);
        this.retrying.set(false);
        this.resolvedRouteId.set(this.routeId());
        if (isPlatformServer(this.platformId)) {
          this.transferState.set(this.stateKey, {
            meeting,
            loadedViaPastMeetingId: this.loadedViaPastMeetingId(),
            pastMeetingFullAccess: this.pastMeetingFullAccess(),
            meetingLoadFailed: false,
          });
        }
      })
    );

    return seed?.meeting ? toSignal(meeting$, { initialValue: seed.meeting }) : toSignal(meeting$);
  }

  private fetchPast(meetingId: string): Observable<{ meeting: Meeting; project: PublicMeetingProject }> {
    return this.meetingService.getPublicPastMeeting(meetingId).pipe(
      // Set on success, not before the request, so a background refresh of a working page cannot
      // flip it to the past-meeting view while the lookup is still in flight.
      tap((res: PublicPastMeetingResponse) => {
        this.loadedViaPastMeetingId.set(true);
        this.pastMeetingFullAccess.set(res.full_access);
      }),
      map((res: PublicPastMeetingResponse) => ({ meeting: res.meeting, project: res.project })),
      catchError((error) => {
        // `getPublicMeeting` logs its own failures; `getPublicPastMeeting` does not, so this path logs here.
        console.error('Failed to load past meeting details', meetingId, error);
        return this.handleLookupError(error, [400, 403, 404]);
      })
    );
  }

  private fetchUpcomingThenPast(meetingId: string): Observable<{ meeting: Meeting; project: PublicMeetingProject }> {
    return this.meetingService.getPublicMeeting(meetingId, this.password()).pipe(
      tap(() => {
        this.loadedViaPastMeetingId.set(false);
        this.pastMeetingFullAccess.set(false);
      }),
      // An id with no hyphen may still be a past meeting: the upcoming endpoint 404s, the past one answers.
      catchError((error) => (error.status === 404 ? this.fetchPast(meetingId) : this.handleLookupError(error, [400, 403])))
    );
  }

  private handleLookupError(error: { status?: number }, notFoundStatuses: number[]): Observable<never> {
    this.retrying.set(false);
    if (notFoundStatuses.includes(error.status ?? 0)) {
      void this.router.navigate(['/meetings/not-found']);
      return EMPTY;
    }

    this.loadFailed.set(true);
    this.failureCount.update((count) => count + 1);
    if (isPlatformServer(this.platformId)) {
      this.transferState.set(this.stateKey, {
        meeting: null,
        loadedViaPastMeetingId: this.loadedViaPastMeetingId(),
        pastMeetingFullAccess: this.pastMeetingFullAccess(),
        meetingLoadFailed: true,
      });
    }
    return EMPTY;
  }

  // The query param wins when present (it is the shape meeting cards and copied links use). The
  // composer's post-create link passes the password in navigation state instead, to keep it out of
  // the address bar; `history` is browser-only, so the server only ever sees the param.
  private applyPassword(queryParams: ParamMap): void {
    const fromQuery = queryParams.get('password');
    this.urlPassword.set(fromQuery);
    this.password.set(fromQuery || this.statePassword());
  }

  private statePassword(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const stated = (history.state as { password?: unknown } | null)?.password;
    return typeof stated === 'string' && stated ? stated : null;
  }
}
