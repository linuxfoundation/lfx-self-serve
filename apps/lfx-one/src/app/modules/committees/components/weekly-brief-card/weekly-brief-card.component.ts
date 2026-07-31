// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  WEEKLY_BRIEF_MAX_POLL_ATTEMPTS,
  WEEKLY_BRIEF_POLL_INTERVAL_MS,
  WEEKLY_BRIEF_TERMINAL_STATES,
  WEEKLY_BRIEF_TEXT_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import { Committee, WeeklyBrief, WeeklyBriefCurrentResponse, WeeklyBriefThrottle } from '@lfx-one/shared/interfaces';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  of,
  skip,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  timeout,
  TimeoutError,
  timer,
} from 'rxjs';

@Component({
  selector: 'lfx-weekly-brief-card',
  imports: [CardComponent, ButtonComponent, SkeletonModule, TextareaComponent],
  templateUrl: './weekly-brief-card.component.html',
  styleUrl: './weekly-brief-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyBriefCardComponent {
  // Injections
  private readonly weeklyBriefService = inject(WeeklyBriefService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);

  // Template-bound constant — mirrors upstream's brief_text bound so the editor can't
  // produce a save the BFF is guaranteed to reject.
  protected readonly briefTextMaxLength = WEEKLY_BRIEF_TEXT_MAX_LENGTH;

  // Reactive form for the editor textarea — `lfx-textarea` requires a FormGroup + control name.
  public readonly editForm = new FormGroup({
    briefText: new FormControl('', { nonNullable: true }),
  });

  // UI state signals
  public readonly fetchLoading = signal(true);
  public readonly fetchError = signal(false);
  public readonly generating = signal(false);
  // True once the poll's attempt cap trips without ever observing a terminal state —
  // the generating branch would otherwise be a permanent dead end with no way out
  // short of a page reload. See pollUntilTerminal.
  public readonly pollTimedOut = signal(false);
  public readonly saving = signal(false);
  public readonly editMode = signal(false);

  // Written by both the initial-load pipeline and the post-generate poll (see
  // initBriefResponseSubscription / pollUntilTerminal) — a plain signal rather than
  // toSignal(), since the poll needs to push updates outside that pipeline's own stream.
  private readonly briefResponse = signal<WeeklyBriefCurrentResponse | null>(null);

  // Refresh trigger consumed by initBriefResponseSubscription — declared here (not
  // further down with the other private helpers) because @typescript-eslint/member-ordering
  // requires all fields, public or private, before the constructor.
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // Shared by initBriefResponseSubscription and pollUntilTerminal — a field initializer
  // runs in this component's injection context automatically, so this needs no explicit
  // Injector. pollUntilTerminal calling toObservable(this.committee) itself would create
  // a fresh, never-cleaned-up effect (Angular releases it only on component destroy) on
  // every single generate/regenerate/load-into-generating call, not just once.
  private readonly committee$ = toObservable(this.committee);

  // Guards against starting a second concurrent poll — pollUntilTerminal is reachable
  // both from onGenerate and from the initial-load pipeline (a page load / navigation
  // landing on an already-`generating` brief).
  private pollActive = false;

  // Derived signals
  public readonly brief: Signal<WeeklyBrief | null> = computed(() => this.briefResponse()?.brief ?? null);
  public readonly throttle: Signal<WeeklyBriefThrottle | null> = computed(() => this.briefResponse()?.throttle ?? null);

  // brief() is truthy even in the `empty` state (a real WeeklyBrief object with
  // state: 'empty'), which would otherwise fall through into the generated-content
  // branch below — rendering Regenerate/Edit/Copy & Share over zero brief text.
  public readonly renderableBrief: Signal<WeeklyBrief | null> = computed(() => {
    const b = this.brief();
    return b && b.state !== 'empty' ? b : null;
  });

  public readonly canGenerate: Signal<boolean> = computed(() => {
    const t = this.throttle();
    return !t || t.generates_used < t.generates_limit;
  });

  public readonly canRegenerate: Signal<boolean> = computed(() => {
    const t = this.throttle();
    return !t || t.regenerations_used < t.regenerations_limit;
  });

  public readonly weekLabel: Signal<string> = computed(() => {
    const b = this.brief();
    if (!b) return '';
    // window_start / window_end are UTC ISO boundaries (Sun 00:00Z → Sat
    // 23:59Z). Format with timeZone: 'UTC' so users in negative offsets
    // don't see the start shift to the prior day.
    const start = new Date(b.window_start);
    const end = new Date(b.window_end);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })}`;
  });

  public constructor() {
    this.initBriefResponseSubscription();
  }

  // Public actions
  public onGenerate(): void {
    if (this.generating()) return;
    const committeeUid = this.committee()?.uid;
    if (!committeeUid) return;
    this.generating.set(true);
    this.pollTimedOut.set(false);
    // renderableBrief, not brief: a real brief object with state: 'empty' renders the
    // empty-state Generate button (gated on canGenerate/generates), but brief() alone is
    // truthy for it — sending force: true would spend a regeneration instead.
    const currentBrief = this.renderableBrief();
    // GenerateWeeklyBriefRequest only accepts `force` (LFXV2-2175 review: there is no
    // client-supplied revision — conflict detection is entirely server-side, via 409
    // edited_brief_exists). force: true is what both re-requests a brief that already
    // exists (Regenerate) and counts against the separate regenerations throttle.
    const body = currentBrief ? { force: true } : {};
    this.weeklyBriefService
      .generateWeeklyBrief(committeeUid, body)
      .pipe(
        // Bounds the pre-poll window: without this, a stalled POST leaves generating()
        // true and pollTimedOut() false indefinitely — the same dead end pollUntilTerminal
        // exists to close, just before the poll itself ever starts.
        timeout(WEEKLY_BRIEF_POLL_INTERVAL_MS * 2),
        take(1),
        // Angular's RouteReuseStrategy can keep this component alive across a committee
        // navigation (same rationale as pollUntilTerminal's identical guard below) — a
        // generate started on committee A whose response arrives after the user has
        // already navigated to committee B must not overwrite B's briefResponse with A's
        // stale data.
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        // The component can be destroyed while this request is still in flight (click
        // Generate, then navigate away) — without this, `next` still runs against a
        // destroyed component: it writes to signals nothing reads anymore and starts a
        // poll (pollUntilTerminal) with nothing left to stop it early via destroy.
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        // Upstream's generate call is a 202 accepted, not a completed brief — the
        // actual generation runs out-of-band. Render the 202 body's `generating` state
        // immediately (it's already in hand — no reason to wait a full poll interval
        // and risk reading back the still-terminal pre-generate brief instead), then
        // poll GET /current until it lands on a terminal state.
        next: (res) => {
          // Upstream marks nothing Required on the 202 envelope — a bare 202 with no
          // brief/throttle must not wipe what's already rendered (most visible on
          // Regenerate, where a real brief is on screen when this fires).
          this.briefResponse.set({ brief: res.brief ?? this.brief(), throttle: res.throttle ?? this.throttle() });
          this.pollUntilTerminal(committeeUid);
        },
        error: (err: HttpErrorResponse | TimeoutError) => {
          if (err instanceof TimeoutError) {
            // The POST itself timed out, but upstream may well have accepted it (202,
            // quota consumed, generation running) — fall into the same poll that handles
            // a normal 202, rather than toasting an error and leaving the card able to
            // spend a second generate/regenerate on what might already be in progress.
            // The poll's own attempt cap (pollTimedOut) bounds this if nothing comes back.
            this.pollUntilTerminal(committeeUid);
            return;
          }
          this.generating.set(false);
          let detail: string;
          switch (err?.status) {
            case 429:
              detail = currentBrief ? 'Weekly regeneration limit reached. Try again next week.' : 'Weekly generation limit reached. Try again next week.';
              // Without this, a stale client-side throttle count can leave canGenerate/
              // canRegenerate enabled after a quota-exhausted response, letting the user
              // re-trigger the same 429 on every click — matches the 409 branch below.
              this.refresh$.next();
              break;
            case 409:
              // Upstream's edited-brief guard: someone else edited the brief
              // for this window. Prompt reload — the user can decide whether
              // to force-regenerate from the refreshed copy.
              detail = 'Someone else edited this brief. Reload to see the latest version before regenerating.';
              this.refresh$.next();
              break;
            default:
              detail = 'Failed to generate brief. Please try again.';
          }
          this.messageService.add({ severity: 'error', summary: 'Generate failed', detail });
        },
      });
  }

  public onEdit(): void {
    this.editMode.set(true);
    this.editForm.controls.briefText.setValue(this.brief()?.brief_text ?? '');
  }

  public onSave(): void {
    const committeeUid = this.committee()?.uid;
    const current = this.brief();
    if (!committeeUid || !current) return;
    const text = this.editForm.controls.briefText.value.trim();
    if (!text) {
      this.messageService.add({ severity: 'warn', summary: 'Empty brief', detail: 'Brief text cannot be empty.' });
      return;
    }
    this.saving.set(true);
    this.weeklyBriefService
      .saveWeeklyBrief(committeeUid, { brief_text: text, revision: current.revision })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editMode.set(false);
          this.refresh$.next();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          let detail: string;
          if (err?.status === 409) {
            detail = 'Someone else updated this brief. Reloaded the latest version — your edit was not saved.';
            // Matches onGenerate's 409 branch: without this, the user is stuck holding a
            // stale revision in edit mode, and every retry re-409s until a full page reload.
            this.editMode.set(false);
            this.refresh$.next();
          } else {
            detail = 'Failed to save brief. Please try again.';
          }
          this.messageService.add({ severity: 'error', summary: 'Save failed', detail });
        },
      });
  }

  public async onCopyAndShare(): Promise<void> {
    const text = this.brief()?.brief_text ?? '';
    // Matches planning-tab.component.ts's copyToClipboard guard: navigator.clipboard is
    // unavailable during SSR and on some browsers/contexts (non-HTTPS, older Safari).
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy not supported',
        detail: 'Clipboard access is unavailable in this browser.',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Brief copied — paste into your mailing list or Slack',
      });
    } catch {
      console.warn('[weekly-brief-card] clipboard write failed');
      this.messageService.add({
        severity: 'error',
        summary: 'Copy failed',
        detail: 'Could not access clipboard.',
      });
    }
  }

  public onCancelEdit(): void {
    this.editMode.set(false);
  }

  public onRetry(): void {
    this.refresh$.next();
  }

  // Private initializer functions
  private initBriefResponseSubscription(): void {
    const committeeUid$ = this.committee$.pipe(
      filter((c): c is Committee => !!c?.uid),
      map((c) => c.uid),
      // A refresh (e.g. joining/leaving, a description save) re-emits a new Committee
      // object with the same uid — skip the redundant brief round-trip when the id
      // itself hasn't changed (matches committee-view.component.ts's initUpcomingMeetings).
      distinctUntilChanged()
    );
    // Committee reuse (RouteReuseStrategy) means this instance survives a navigation
    // between committees — without an explicit reset, a stale `editMode`/`editForm`
    // (edited text from the previous committee, rendered against the new committee's
    // brief) or a leftover `generating` flag from a generate call cut off mid-flight
    // (see the takeUntil guard in onGenerate) would bleed onto the new committee's card.
    committeeUid$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.generating.set(false);
      this.editMode.set(false);
      this.editForm.reset({ briefText: '' });
    });
    combineLatest([committeeUid$, this.refresh$])
      .pipe(
        switchMap(([uid]) => {
          this.fetchLoading.set(true);
          this.fetchError.set(false);
          this.pollTimedOut.set(false);
          return this.weeklyBriefService.getWeeklyBrief(uid).pipe(
            catchError((err: unknown) => {
              // A failed read (e.g. upstream 503) must not look like "no brief
              // yet" — flag it so the template can show a distinct, retryable
              // unavailable state instead of the empty-state Generate prompt.
              console.error('[weekly-brief-card] failed to load current brief', err);
              this.fetchError.set(true);
              return of(null as WeeklyBriefCurrentResponse | null);
            }),
            finalize(() => this.fetchLoading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        this.briefResponse.set(response);
        // Covers a page reload, navigating back to this committee, or a co-chair's
        // generation already in flight — not just this tab's own onGenerate() call.
        // Without this, a card that *loads* into the generating state never polls and
        // is stuck on the spinner with no way to reach a terminal state.
        const uid = this.committee()?.uid;
        if (uid && response?.brief?.state === 'generating') {
          this.pollUntilTerminal(uid);
        }
      });
  }

  // Polls GET /current after a generate/regenerate call is accepted (202) — or after a
  // load lands on an already-in-progress generation — until the brief reaches a
  // terminal state (generated/edited/approved/error), or the attempt cap trips. A
  // transient poll failure doesn't abandon the poll — only the cap does.
  private pollUntilTerminal(committeeUid: string): void {
    if (this.pollActive) return;
    this.pollActive = true;
    this.generating.set(true);
    this.pollTimedOut.set(false);
    let ticks = 0;
    let observedTerminal = false;
    timer(WEEKLY_BRIEF_POLL_INTERVAL_MS, WEEKLY_BRIEF_POLL_INTERVAL_MS)
      .pipe(
        take(WEEKLY_BRIEF_MAX_POLL_ATTEMPTS),
        tap(() => {
          ticks += 1;
        }),
        // exhaustMap, not switchMap: a GET that outlives one interval tick must not be
        // cancelled and restarted on the next tick — that would mean no request ever
        // resolves and the poll dies silently once the attempt cap is hit. Skip a tick
        // instead if the previous one is still in flight. A per-tick timeout bounds the
        // exhaustMap wait itself — otherwise a single hung request would block `complete`
        // (and the attempt cap) indefinitely, since exhaustMap only completes once its
        // last active inner subscription settles.
        exhaustMap(() =>
          this.weeklyBriefService.getWeeklyBrief(committeeUid).pipe(
            timeout(WEEKLY_BRIEF_POLL_INTERVAL_MS),
            catchError((err: unknown) => {
              console.error('[weekly-brief-card] poll tick failed, will retry', err);
              return of(null as WeeklyBriefCurrentResponse | null);
            })
          )
        ),
        // Drop failed ticks entirely rather than feeding `null` into takeWhile below —
        // a transient poll failure must not look like a terminal state and stop the poll.
        filter((response): response is WeeklyBriefCurrentResponse => response !== null),
        tap((response) => {
          this.briefResponse.set(response);
          if (response.brief && WEEKLY_BRIEF_TERMINAL_STATES.has(response.brief.state)) {
            observedTerminal = true;
          }
        }),
        // Keep polling on anything that ISN'T a terminal state — not just 'generating'.
        // A null brief or state: 'empty' on an early tick means the write isn't visible
        // yet, not that generation is done; treating either as terminal here would stop
        // the poll mid-generation and drop the card to "No brief yet" with the quota
        // already spent.
        takeWhile((response) => !response.brief || !WEEKLY_BRIEF_TERMINAL_STATES.has(response.brief.state), true),
        // refresh$ is also reachable while a poll is in flight (onRetry, the 409 branch
        // of onGenerate) — stop polling on a manual refresh so a late poll tick can't
        // overwrite a fresher refresh result. skip(1): refresh$ is a BehaviorSubject and
        // replays its current value on subscribe; only a genuinely new emission should cancel.
        takeUntil(this.refresh$.pipe(skip(1))),
        // Angular's default RouteReuseStrategy can keep this component alive across a
        // committee navigation (committee-view.component.ts only flips its own loading
        // state when there was no prior committee) — stop polling for a uid that's no
        // longer the one on screen, or a late tick would paint the old committee's brief
        // onto the new one's card.
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        takeUntilDestroyed(this.destroyRef),
        // finalize, not just the complete callback below: an error escaping this pipe
        // (e.g. a throw inside the tap/takeWhile predicates above, outside exhaustMap's
        // own catchError) must still release pollActive and clear generating — otherwise
        // it's stuck true for the rest of the component's lifetime with no way to
        // restart polling, the same dead end this method exists to close.
        finalize(() => {
          this.pollActive = false;
          this.generating.set(false);
        })
      )
      .subscribe({
        complete: () => {
          // Only warn when the attempt cap was actually exhausted without ever observing
          // a terminal state — not when the poll stopped because of a manual refresh/409
          // (a fresher read is already on its way) or because the component was destroyed.
          if (!observedTerminal && ticks >= WEEKLY_BRIEF_MAX_POLL_ATTEMPTS) {
            // The generating branch renders on brief()?.state === 'generating' too, so
            // without this flag it would be a dead end with no way out but a page reload.
            this.pollTimedOut.set(true);
            this.messageService.add({
              severity: 'warn',
              summary: 'Still generating',
              detail: 'This is taking longer than expected — check back in a bit, or refresh.',
            });
          }
        },
      });
  }
}
