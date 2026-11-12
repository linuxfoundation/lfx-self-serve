// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, Injector, makeStateKey, PLATFORM_ID, Signal, signal, TransferState } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  canJoinMeeting,
  getActiveOccurrences,
  getCurrentOrNextOccurrence,
  Meeting,
  MEETING_CLOCK_TICK_MS,
  MeetingJoinPageState,
  MeetingOccurrence,
  PublicMeetingProject,
  PublicMeetingResponse,
  PublicPastMeetingResponse,
} from '@lfx-one/shared';
import { isPastMeetingCompositeId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { PlausibleService } from '@services/plausible.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, catchError, combineLatest, debounceTime, EMPTY, filter, map, Observable, Subscription, switchMap, take, tap } from 'rxjs';

/**
 * Loads the public meeting behind `/meetings/:id` for a meeting page, the way the legacy join page always has.
 * @description Provided per page. Owns the SSR seed and TransferState, the password (URL or router state), the
 * `{id}-{ms}` past id and the upcoming-then-past fallback, not-found and error routing, `?occurrence=` and the page clock.
 * `load()` must run in the page's constructor, so its streams are bound to the page.
 */
@Injectable()
export class MeetingPageDataService {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  // Persists the SSR-resolved meeting so the client's first paint matches the server DOM instead
  // of tearing it down at hydration (GH-2041) — see `MeetingJoinPageState` for why the meeting
  // alone isn't enough. Same pattern as `PublicProfilePageComponent`.
  private readonly stateKey = makeStateKey<MeetingJoinPageState>('meetingJoinState');

  private readonly projectState = signal<PublicMeetingProject | null>(null);
  private readonly passwordState = signal<string | null>(null);
  private readonly urlPasswordState = signal<string | null>(null);
  private readonly loadedViaPastMeetingIdState = signal(false);
  private readonly pastMeetingFullAccessState = signal(false);
  private readonly liveMeetingFullAccessState = signal(false);
  private readonly liveMeetingCanJoinState = signal(false);
  private readonly meetingLoadFailedState = signal(false);
  // Route `id` param the fetch pipeline is currently attempting (or last attempted) — set
  // synchronously as soon as a new attempt starts, so it updates immediately on navigation, before
  // that attempt's response (success or failure) settles.
  private readonly meetingRouteId = signal<string | null>(null);
  // Route `id` param the currently-held meeting actually resolved successfully for. Only updated on a successful fetch.
  private readonly meetingResolvedRouteId = signal<string | null>(null);
  private readonly clockState = signal<number>(Date.now());
  private readonly refreshTrigger$ = new BehaviorSubject<void>(undefined);
  private reloadsRequested = 0;
  private readonly reloadsDoneState = signal(0);
  private joinWindowChecked = false;
  private joinWindowOpenAtLoadState = false;
  private joinOnLoadClaimed = false;
  private pendingPageview: Subscription | null = null;

  public readonly project: Signal<PublicMeetingProject | null> = this.projectState.asReadonly();
  /** The meeting password, from `?password=` or else the router state the composer's toast link carries. */
  public readonly password: Signal<string | null> = this.passwordState.asReadonly();
  /**
   * The password only when it is already in this page's own address bar.
   * @description Narrower than `password` on purpose: it answers "is this secret already
   * exposed here?", which is the only thing that makes writing it into another link harmless.
   */
  public readonly urlPassword: Signal<string | null> = this.urlPasswordState.asReadonly();
  /** True when the meeting was loaded as a past meeting, from a `{id}-{ms}` id or the upcoming lookup's 404 fallback. */
  public readonly loadedViaPastMeetingId: Signal<boolean> = this.loadedViaPastMeetingIdState.asReadonly();
  public readonly pastMeetingFullAccess: Signal<boolean> = this.pastMeetingFullAccessState.asReadonly();
  // False whenever a private meeting was only reached via its shared password link (anonymous or guest).
  public readonly liveMeetingFullAccess: Signal<boolean> = this.liveMeetingFullAccessState.asReadonly();
  // The server's join-window result, for viewers whose response has no start time to check against.
  public readonly liveMeetingCanJoin: Signal<boolean> = this.liveMeetingCanJoinState.asReadonly();
  // A fetch settled with an error that doesn't navigate away (5xx, network); 404/403/400 go to not-found.
  public readonly meetingLoadFailed: Signal<boolean> = this.meetingLoadFailedState.asReadonly();
  public readonly routeId: Signal<string | null> = this.meetingRouteId.asReadonly();
  // False right after navigating to a different `/meetings/:id` until that route's fetch settles.
  // `toSignal` retains the meeting's last emission across both a failing `catchError`'s `EMPTY` and
  // an in-flight new-route fetch, so without this the page would keep rendering the PREVIOUS
  // meeting (incl. its `host_key`/join links) under the new URL (copilot review on #2046).
  public readonly meetingMatchesRoute: Signal<boolean> = computed(() => this.meetingRouteId() === this.meetingResolvedRouteId());
  /** Wall clock for time-gated UI; ticks only after `startClock()`, which is browser-only. */
  public readonly clock: Signal<number> = this.clockState.asReadonly();
  /** Reloads asked for by `refresh()` or `reloadOnNextLoad()` that have since loaded; a page re-creates what it shows on it. */
  public readonly reloadsDone: Signal<number> = this.reloadsDoneState.asReadonly();
  /** Emits now and on every `refresh()`, for streams that reload with the meeting. */
  public readonly refreshes$: Observable<void> = this.refreshTrigger$.asObservable();

  /** True only when the join window was already open when the meeting first loaded, the one case Zoom may open by itself. */
  public get joinWindowOpenAtLoad(): boolean {
    return this.joinWindowOpenAtLoadState;
  }

  /**
   * Whether Zoom may open by itself now, at most once per page: the join window was open at load, and the URL has
   * neither `?zoom_redirect=false` nor `?action=`.
   */
  public claimJoinOnLoad(): boolean {
    const params = this.activatedRoute.snapshot.queryParamMap;
    const allowed =
      this.joinWindowOpenAtLoadState && !this.joinOnLoadClaimed && params.get('zoom_redirect')?.toLowerCase() !== 'false' && !params.has('action');
    if (allowed) this.joinOnLoadClaimed = true;
    return allowed;
  }

  /**
   * Seeds from TransferState and starts loading the meeting for the current route.
   * @param onRouteChange runs as soon as the route id changes, before the new meeting loads.
   */
  public load(onRouteChange?: () => void): Signal<Meeting & { project: PublicMeetingProject }> {
    // Seed the client's first paint from the SSR-serialized state (matches the server's resolved
    // branch, no blank flash on hydration — GH-2041). Null on the server and on client
    // navigations with no prior SSR state.
    const seed = this.transferState.get(this.stateKey, null);
    // Consume the SSR state exactly once so a later page (e.g. a different `/meetings/:id`) can't paint the previous meeting's state.
    if (isPlatformBrowser(this.platformId) && seed) {
      this.transferState.remove(this.stateKey);
    }
    if (seed) {
      this.loadedViaPastMeetingIdState.set(seed.loadedViaPastMeetingId);
      this.pastMeetingFullAccessState.set(seed.pastMeetingFullAccess);
      this.liveMeetingFullAccessState.set(seed.liveMeetingFullAccess ?? false);
      this.liveMeetingCanJoinState.set(seed.liveMeetingCanJoin ?? false);
      if (seed.meetingLoadFailed) {
        this.meetingLoadFailedState.set(true);
        // Seed the route id too, or the first hydration emission reads as a navigation and clears the failure (#2046).
        this.meetingRouteId.set(this.activatedRoute.snapshot.paramMap.get('id'));
      } else if (seed.meeting) {
        this.projectState.set(seed.meeting.project);
        const seededRouteId = this.activatedRoute.snapshot.paramMap.get('id');
        this.meetingRouteId.set(seededRouteId);
        this.meetingResolvedRouteId.set(seededRouteId);
      }
    }

    // Set synchronously from the route snapshot, before anything reads the password for a request.
    this.applyPassword(this.activatedRoute.snapshot.queryParamMap);

    return this.initMeeting(seed, onRouteChange);
  }

  /** Refetches the meeting for the current route. */
  public refresh(): void {
    this.reloadOnNextLoad();
    this.refreshTrigger$.next();
  }

  /** Counts the next load, such as one a navigation starts, as a reload in `reloadsDone`. */
  public reloadOnNextLoad(): void {
    this.reloadsRequested++;
  }

  /** The `?occurrence=` (start ms) date when it is an active one, else the current or next date. */
  public resolveOccurrence(meeting: Meeting): MeetingOccurrence | null {
    const requestedOccurrence = this.activatedRoute.snapshot.queryParamMap.get('occurrence');
    if (requestedOccurrence && meeting?.occurrences?.length) {
      const requestedTime = parseInt(requestedOccurrence, 10);
      const active = getActiveOccurrences(meeting.occurrences, meeting.cancelled_occurrences);
      const match = active.find((o: MeetingOccurrence) => new Date(o.start_time).getTime() === requestedTime);
      if (match) return match;
    }
    return getCurrentOrNextOccurrence(meeting);
  }

  /**
   * Sends the page's pageview, which this route defers, with its foundation and project once both are known.
   * @description `trackPage()` drops calls made before the Plausible script runs, so the one emission waits for it.
   */
  public trackPageview(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const plausibleService = this.injector.get(PlausibleService);
    // The parent (foundation) arrives in the same payload as the project (LFXV2-3266).
    const pageviewContext$ = toObservable(this.project, { injector: this.injector }).pipe(
      filter((p): p is PublicMeetingProject => !!p?.slug),
      map((project) => ({ project, parent: project.parent })),
      take(1)
    );
    const analyticsReady$ = toObservable(plausibleService.ready, { injector: this.injector }).pipe(filter(Boolean));
    // A newer pageview replaces one still waiting for Plausible, so a meeting left early is never counted.
    this.pendingPageview?.unsubscribe();
    this.pendingPageview = combineLatest([pageviewContext$, analyticsReady$])
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(([{ project, parent }]) => {
        const isTopLevel = !project.parent_uid;
        plausibleService.trackPage(
          PlausibleService.buildPageviewContext({
            foundationSlug: isTopLevel ? project.slug : parent?.slug,
            foundationName: isTopLevel ? project.name : parent?.name,
            projectSlug: isTopLevel ? undefined : project.slug,
            projectName: isTopLevel ? undefined : project.name,
          })
        );
      });
  }

  // Ticks the wall-clock signal. Also on tab focus/visibility: mobile browsers freeze timers in the background, so the
  // join state must catch up the moment the viewer returns. Cleaned up with the page; never started on the server.
  public startClock(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const tick = (): void => this.clockState.set(Date.now());
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    const intervalId = setInterval(tick, MEETING_CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', tick);
    this.destroyRef.onDestroy(() => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', tick);
    });
  }

  private initMeeting(seed: MeetingJoinPageState | null, onRouteChange?: () => void): Signal<Meeting & { project: PublicMeetingProject }> {
    const meeting$ = combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap, this.refreshTrigger$]).pipe(
      // Update `meetingRouteId` ahead of `debounceTime`, so `meetingMatchesRoute` flips to false the
      // instant a route change is observed (copilot review on #2046).
      tap(([params]) => {
        const meetingId = params.get('id');
        const previousRouteId = this.meetingRouteId();
        this.meetingRouteId.set(meetingId);
        // Only a real navigation to a different meeting clears a stale failure, not a same-route re-emission (#2046).
        if (meetingId !== previousRouteId) {
          this.meetingLoadFailedState.set(false);
          onRouteChange?.();
        }
      }),
      debounceTime(0), // Coalesce rapid SSR hydration emissions so the fallback chain isn't canceled
      switchMap(([params, queryParams]) => {
        const meetingId = params.get('id');
        this.applyPassword(queryParams);

        // A signed-out visitor is sent to login by the browser; fetching here would bounce a private meeting to not-found first.
        if (isPlatformServer(this.platformId) && queryParams.get('action') === 'leave' && !this.userService.authenticated()) {
          return EMPTY;
        }

        if (!meetingId) {
          this.router.navigate(['/meetings/not-found']);
          return EMPTY;
        }

        // A `{id}-{ms}` id is a past occurrence; a plain id tries upcoming first and falls back to past on 404.
        return isPastMeetingCompositeId(meetingId) ? this.loadPast(meetingId) : this.loadUpcomingOrPast(meetingId);
      }),
      map((res) => ({ ...res.meeting, project: res.project })),
      tap((res) => {
        this.projectState.set(res.project);
        // Only a settled success clears a prior failure; clearing eagerly would flash a seeded error view back to the skeleton.
        this.meetingLoadFailedState.set(false);
        this.meetingResolvedRouteId.set(this.meetingRouteId());
        this.reloadsDoneState.set(this.reloadsRequested);
        this.recordJoinWindowAtLoad(res as Meeting);
        // Persist the resolved state during SSR so the client can hydrate to the same branch.
        // Angular defers serialization until this tracked HTTP call settles.
        if (isPlatformServer(this.platformId)) {
          this.transferState.set(this.stateKey, { ...this.accessState(), meeting: res, meetingLoadFailed: false });
        }
      })
    );

    // `toSignal`'s `initialValue` overload needs a `T`, so branch on the seed. A seed carrying the error branch
    // (`meeting: null`) has no initial value; `meetingLoadFailed`, seeded above, already renders the matching view.
    return (seed?.meeting ? toSignal(meeting$, { initialValue: seed.meeting }) : toSignal(meeting$)) as Signal<Meeting & { project: PublicMeetingProject }>;
  }

  private loadPast(meetingId: string): Observable<{ meeting: Meeting; project: PublicMeetingProject }> {
    this.loadedViaPastMeetingIdState.set(true);
    return this.meetingService.getPublicPastMeeting(meetingId).pipe(
      tap((res: PublicPastMeetingResponse) => this.pastMeetingFullAccessState.set(res.full_access)),
      // Preserve the legacy join-page view model without claiming a complete PastMeeting at the HTTP boundary.
      map((res: PublicPastMeetingResponse) => ({ meeting: res.meeting as Meeting, project: res.project })),
      catchError((error) => this.handleTerminalError(error, [404, 403, 400]))
    );
  }

  private loadUpcomingOrPast(meetingId: string): Observable<{ meeting: Meeting; project: PublicMeetingProject }> {
    // Flags reset to "upcoming" only once that lookup succeeds, so a seeded past id re-entering here on hydration keeps its past streams.
    return this.meetingService.getPublicMeeting(meetingId, this.password()).pipe(
      tap((res: PublicMeetingResponse) => {
        this.loadedViaPastMeetingIdState.set(false);
        this.pastMeetingFullAccessState.set(false);
        this.liveMeetingFullAccessState.set(res.full_access);
        this.liveMeetingCanJoinState.set(res.can_join);
      }),
      // Preserve the legacy join-page view model without claiming a complete Meeting at the HTTP boundary.
      map((res: PublicMeetingResponse) => ({ meeting: res.meeting as Meeting, project: res.project })),
      catchError((error) => {
        if (error.status === 404) {
          return this.meetingService.getPublicPastMeeting(meetingId).pipe(
            tap((res: PublicPastMeetingResponse) => {
              this.loadedViaPastMeetingIdState.set(true);
              this.pastMeetingFullAccessState.set(res.full_access);
            }),
            map((res: PublicPastMeetingResponse) => ({ meeting: res.meeting as Meeting, project: res.project })),
            catchError((fallbackError) => this.handleTerminalError(fallbackError, [404, 403, 400]))
          );
        }
        return this.handleTerminalError(error, [403, 400]);
      })
    );
  }

  private handleTerminalError(error: { status?: number }, notFoundStatuses: number[]): Observable<never> {
    console.error('Failed to load the public meeting:', error);
    if (notFoundStatuses.includes(error.status ?? 0)) {
      this.router.navigate(['/meetings/not-found']);
    } else {
      this.setMeetingLoadFailed();
    }
    return EMPTY;
  }

  // Persists the error branch during SSR so the client hydrates to the same error view (GH-2041 follow-up).
  private setMeetingLoadFailed(): void {
    this.meetingLoadFailedState.set(true);
    if (isPlatformServer(this.platformId)) {
      this.transferState.set(this.stateKey, { ...this.accessState(), meeting: null, meetingLoadFailed: true });
    }
  }

  private accessState(): Pick<MeetingJoinPageState, 'loadedViaPastMeetingId' | 'pastMeetingFullAccess' | 'liveMeetingFullAccess' | 'liveMeetingCanJoin'> {
    return {
      loadedViaPastMeetingId: this.loadedViaPastMeetingIdState(),
      pastMeetingFullAccess: this.pastMeetingFullAccessState(),
      liveMeetingFullAccess: this.liveMeetingFullAccessState(),
      liveMeetingCanJoin: this.liveMeetingCanJoinState(),
    };
  }

  // Prefers the `?password=` query param, falling back to the router navigation state that the composer's post-create
  // toast link carries (which keeps the secret out of the address bar). Only the param form may be written into links.
  private applyPassword(queryParams: ParamMap): void {
    const fromQuery = queryParams.get('password');
    this.urlPasswordState.set(fromQuery);
    this.passwordState.set(fromQuery || this.statePassword());
  }

  // `history` is browser-only; on the server the query param is the only source a page has.
  private statePassword(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const stated = (history.state as { password?: unknown } | null)?.password;
    return typeof stated === 'string' && stated ? stated : null;
  }

  // Remembers, once, whether the join window was already open when the meeting first loaded.
  private recordJoinWindowAtLoad(meeting: Meeting): void {
    if (this.joinWindowChecked) {
      return;
    }
    this.joinWindowChecked = true;
    if (this.loadedViaPastMeetingIdState()) {
      return;
    }
    this.joinWindowOpenAtLoadState = this.liveMeetingFullAccessState()
      ? canJoinMeeting(meeting, this.resolveOccurrence(meeting))
      : this.liveMeetingCanJoinState();
  }
}
