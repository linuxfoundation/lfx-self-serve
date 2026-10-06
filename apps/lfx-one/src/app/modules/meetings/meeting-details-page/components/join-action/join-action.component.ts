// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MeetingJoinUrlState } from '@lfx-one/shared/interfaces';
import { buildJoinUrlWithParams } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, filter, map, Observable, of, startWith, switchMap, take } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The `join` kind of the V2 action slot (E2-01, #1775, FR-027): one Join button with loading,
 * ready and error states, for a signed-in viewer inside the join window.
 * @description It fetches the join URL with the viewer's own email, as V1 does, and opens it in a
 * new tab. It keeps V1's auto-join: the first time the URL resolves, the meeting opens on its own,
 * unless `?zoom_redirect=false` is on the URL. Anonymous visitors never reach this kind; they get
 * `guest-join`.
 *
 * The fetch is browser-only, so the server renders the loading state, which is also what the
 * button shows until the URL resolves. An error offers a retry. A `NOT_REGISTERED_FOR_MEETING`
 * error says the viewer's email is not on the invite list; joining with a different email is the
 * guest form's job (E2-06).
 */
@Component({
  selector: 'lfx-meeting-join-action',
  imports: [ButtonComponent],
  templateUrl: './join-action.component.html',
})
export class MeetingJoinActionComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  /**
   * The prototype's Join button on `lfx-button`: 42px pill, full width, 15px bold on the accent.
   * Arbitrary px values because the app's 14px root would shrink rem-based utilities.
   */
  protected readonly buttonClass =
    '!h-[42px] !w-full !justify-center !gap-[9px] !rounded-full !border-[var(--md-accent)] !bg-[var(--md-accent)] !text-[15px] !font-bold !text-[var(--md-surface-card)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  protected readonly joinState: Signal<MeetingJoinUrlState> = this.initJoinState();
  protected readonly notRegistered = computed(() => this.joinState().code === 'NOT_REGISTERED_FOR_MEETING');

  public constructor() {
    this.initAutoJoin();
  }

  protected retry(): void {
    this.retry$.next();
  }

  private initJoinState(): Signal<MeetingJoinUrlState> {
    const loading: MeetingJoinUrlState = { status: 'loading' };
    if (!isPlatformBrowser(this.platformId)) {
      return computed(() => loading);
    }
    // Keyed on what the request is made of, not on the meeting object: the state service hands out a
    // new object on every lookup emission (a `?occurrence=` change, a refresh), and refetching then
    // would drop a working Join link back to loading, as V1 never does.
    const meetingKey = toObservable(computed(() => ({ id: this.state.meeting()?.id, password: this.state.meeting()?.password ?? null }))).pipe(
      distinctUntilChanged((a, b) => a.id === b.id && a.password === b.password)
    );
    const email = toObservable(computed(() => this.userService.user()?.email)).pipe(distinctUntilChanged());
    return toSignal(
      combineLatest([meetingKey, email, this.retry$]).pipe(
        switchMap(([meeting, viewerEmail]) => {
          // No email, no link: V1 waits on the same condition, so the button stays loading.
          if (!meeting.id || !viewerEmail) {
            return of(loading);
          }
          return this.fetchJoinUrl(meeting.id, meeting.password, viewerEmail).pipe(startWith(loading));
        })
      ),
      { initialValue: loading }
    );
  }

  private fetchJoinUrl(meetingId: string, password: string | null, email: string): Observable<MeetingJoinUrlState> {
    return this.meetingService.getPublicMeetingJoinUrl(meetingId, password, { email }).pipe(
      map((res): MeetingJoinUrlState => {
        // The link is bound to an anchor and passed to window.open, so only http(s) gets that far.
        if (!res.link || !isHttpUrl(res.link)) {
          return { status: 'error', error: 'Failed to load meeting join URL. Please try again.' };
        }
        return { status: 'ready', url: buildJoinUrlWithParams(res.link, this.userService.user()) };
      }),
      catchError((error) =>
        of<MeetingJoinUrlState>({
          status: 'error',
          error: error?.error?.error || 'Failed to load meeting join URL. Please try again.',
          code: error?.error?.code ?? null,
        })
      )
    );
  }

  /**
   * V1's auto-join (FR-027): the first time the URL resolves, open the meeting in a new tab, unless
   * `?zoom_redirect=false` is on the URL. With `noopener`, `window.open` always returns null, so a
   * blocked popup cannot be told from an opened one; V1's "Popup Blocked" branch never ran. One
   * toast covers both, pointing at the Join button.
   */
  private initAutoJoin(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    toObservable(this.joinState)
      .pipe(
        filter((joinState) => joinState.status === 'ready' && !!joinState.url),
        take(1),
        filter(() => this.activatedRoute.snapshot.queryParamMap.get('zoom_redirect')?.toLowerCase() !== 'false'),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((joinState) => {
        window.open(joinState.url, '_blank', 'noopener,noreferrer');
        this.messageService.add({
          severity: 'info',
          summary: 'Opening the meeting',
          detail: 'The meeting is opening in a new tab. If it does not open, your browser may have blocked it: use the "Join now" button.',
          life: 5000,
        });
      });
  }
}

/** Whether a link is an absolute http(s) URL, so no other scheme reaches an anchor or `window.open`. */
function isHttpUrl(link: string): boolean {
  try {
    const { protocol } = new URL(link);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
