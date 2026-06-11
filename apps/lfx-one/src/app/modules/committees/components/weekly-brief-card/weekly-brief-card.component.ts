// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { Committee, WeeklyBrief, WeeklyBriefCurrentResponse, WeeklyBriefThrottle } from '@lfx-one/shared/interfaces';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, filter, finalize, of, switchMap, take } from 'rxjs';

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

  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);

  // UI state signals
  public readonly fetchLoading = signal(true);
  public readonly fetchError = signal(false);
  public readonly generating = signal(false);
  public readonly saving = signal(false);
  public readonly editMode = signal(false);

  // Reactive form for the editor textarea — `lfx-textarea` requires a FormGroup + control name.
  public readonly editForm = new FormGroup({
    briefText: new FormControl('', { nonNullable: true }),
  });

  // Refresh trigger — declared above briefResponse so the toSignal call sees it.
  // Logically part of the private helpers band (section 11).
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  private readonly briefResponse: Signal<WeeklyBriefCurrentResponse | null> = this.initBriefResponse();

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

  // Public actions
  public onGenerate(): void {
    if (this.generating()) return;
    const committeeUid = this.committee()?.uid;
    if (!committeeUid) return;
    this.generating.set(true);
    const currentBrief = this.brief();
    const body = currentBrief ? { revision: currentBrief.revision } : {};
    this.weeklyBriefService
      .generateWeeklyBrief(committeeUid, body)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.generating.set(false);
          this.refresh$.next();
        },
        error: (err: HttpErrorResponse) => {
          this.generating.set(false);
          let detail: string;
          switch (err?.status) {
            case 429:
              detail = 'Weekly generation limit reached. Try again next week.';
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

  // Private initializers
  private initBriefResponse(): Signal<WeeklyBriefCurrentResponse | null> {
    const committee$ = toObservable(this.committee);
    return toSignal(
      combineLatest([committee$, this.refresh$]).pipe(
        filter(([c]) => !!c?.uid),
        switchMap(([c]) => {
          this.fetchLoading.set(true);
          this.fetchError.set(false);
          return this.weeklyBriefService.getWeeklyBrief(c.uid).pipe(
            catchError(() => {
              // A failed read (e.g. upstream 503) must not look like "no brief
              // yet" — flag it so the template can show a distinct, retryable
              // unavailable state instead of the empty-state Generate prompt.
              this.fetchError.set(true);
              return of(null as WeeklyBriefCurrentResponse | null);
            }),
            finalize(() => this.fetchLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
