// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { WEEKLY_BRIEF_MAX_POLL_ATTEMPTS, WEEKLY_BRIEF_POLL_INTERVAL_MS } from '@lfx-one/shared/constants';
import { Committee, WeeklyBrief, WeeklyBriefCurrentResponse, WeeklyBriefThrottle } from '@lfx-one/shared/interfaces';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, switchMap, take, takeWhile, tap, timer } from 'rxjs';

@Component({
  selector: 'lfx-weekly-brief-card',
  imports: [CardComponent, ButtonComponent, SkeletonModule, ReactiveFormsModule, TextareaComponent],
  templateUrl: './weekly-brief-card.component.html',
  styleUrl: './weekly-brief-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyBriefCardComponent {
  // Injections
  private readonly weeklyBriefService = inject(WeeklyBriefService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);

  // Reactive form for the editor textarea — `lfx-textarea` requires a FormGroup + control name.
  public readonly editForm = new FormGroup({
    briefText: new FormControl('', { nonNullable: true }),
  });

  // UI state signals
  public readonly fetchLoading = signal(true);
  public readonly fetchError = signal(false);
  public readonly generating = signal(false);
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

  // Derived signals
  public readonly brief: Signal<WeeklyBrief | null> = computed(() => this.briefResponse()?.brief ?? null);
  public readonly throttle: Signal<WeeklyBriefThrottle | null> = computed(() => this.briefResponse()?.throttle ?? null);

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
    const currentBrief = this.brief();
    // GenerateWeeklyBriefRequest only accepts `force` (LFXV2-2175 review: there is no
    // client-supplied revision — conflict detection is entirely server-side, via 409
    // edited_brief_exists). force: true is what both re-requests a brief that already
    // exists (Regenerate) and counts against the separate regenerations throttle.
    const body = currentBrief ? { force: true } : {};
    this.weeklyBriefService
      .generateWeeklyBrief(committeeUid, body)
      .pipe(take(1))
      .subscribe({
        // Upstream's generate call is a 202 accepted, not a completed brief — the
        // actual generation runs out-of-band. Poll GET /current until it lands on a
        // terminal state instead of treating the 202 itself as done.
        next: () => this.pollUntilTerminal(committeeUid),
        error: (err: HttpErrorResponse) => {
          this.generating.set(false);
          let detail: string;
          switch (err?.status) {
            case 429:
              detail = currentBrief ? 'Weekly regeneration limit reached. Try again next week.' : 'Weekly generation limit reached. Try again next week.';
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
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editMode.set(false);
          this.refresh$.next();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          const detail = err?.status === 409 ? 'Someone else updated this brief. Reload to see the latest version.' : 'Failed to save brief. Please try again.';
          this.messageService.add({ severity: 'error', summary: 'Save failed', detail });
        },
      });
  }

  public async onCopyAndShare(): Promise<void> {
    const text = this.brief()?.brief_text ?? '';
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
    const committeeUid$ = toObservable(this.committee).pipe(
      filter((c): c is Committee => !!c?.uid),
      map((c) => c.uid),
      // A refresh (e.g. joining/leaving, a description save) re-emits a new Committee
      // object with the same uid — skip the redundant brief round-trip when the id
      // itself hasn't changed (matches committee-view.component.ts's initUpcomingMeetings).
      distinctUntilChanged()
    );
    combineLatest([committeeUid$, this.refresh$])
      .pipe(
        switchMap(([uid]) => {
          this.fetchLoading.set(true);
          this.fetchError.set(false);
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
      .subscribe((response) => this.briefResponse.set(response));
  }

  // Polls GET /current after a generate/regenerate call is accepted (202) until the
  // brief reaches a terminal state (generated/edited/approved/error), or the attempt
  // cap trips. A transient poll failure doesn't abandon the poll — only the cap does.
  private pollUntilTerminal(committeeUid: string): void {
    timer(0, WEEKLY_BRIEF_POLL_INTERVAL_MS)
      .pipe(
        take(WEEKLY_BRIEF_MAX_POLL_ATTEMPTS),
        switchMap(() =>
          this.weeklyBriefService.getWeeklyBrief(committeeUid).pipe(
            catchError((err: unknown) => {
              console.error('[weekly-brief-card] poll tick failed, will retry', err);
              return of(null as WeeklyBriefCurrentResponse | null);
            })
          )
        ),
        // Drop failed ticks entirely rather than feeding `null` into takeWhile below —
        // a transient poll failure must not look like a terminal state and stop the poll.
        filter((response): response is WeeklyBriefCurrentResponse => response !== null),
        tap((response) => this.briefResponse.set(response)),
        takeWhile((response) => response.brief?.state === 'generating', true),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        complete: () => {
          this.generating.set(false);
          if (this.brief()?.state === 'generating') {
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
