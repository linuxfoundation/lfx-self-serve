// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { DrawerModule } from 'primeng/drawer';
import { finalize, of, skip, switchMap } from 'rxjs';

import type { EventDetailResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DrawerModule],
  templateUrl: './event-detail-drawer.component.html',
})
export class EventDetailDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  /** Event id to load when the drawer opens. */
  public readonly eventId = input<string | null>(null);

  // === Computed Signals ===
  protected readonly detail: Signal<EventDetailResponse | null> = this.initDetail();
  protected readonly loading = computed(() => this.visible() && this.detail() === null && this.eventId() !== null);

  // Registration progress (0–100) when a real goal exists.
  protected readonly regProgress = computed(() => {
    const d = this.detail();
    if (!d || d.registrations.goal <= 0) return null;
    return Math.min(100, Math.round((d.registrations.actual / d.registrations.goal) * 100));
  });
  // Sponsorship progress (0–100) when a real goal exists.
  protected readonly sponProgress = computed(() => {
    const d = this.detail();
    if (!d || d.sponsorshipRevenue.goal <= 0) return null;
    return Math.min(100, Math.round((d.sponsorshipRevenue.actual / d.sponsorshipRevenue.goal) * 100));
  });

  // === Protected Helpers (template) ===
  protected num(value: number): string {
    return formatNumber(value);
  }

  protected money(value: number): string {
    return formatCurrency(value);
  }

  /** Registration pace vs last year as a signed percent string, or null when no baseline. */
  protected vsLastYearLabel(): string | null {
    const d = this.detail();
    if (!d || d.vsLastYear === null) return null;
    const pct = Math.round((d.vsLastYear - 1) * 100);
    if (pct > 0) return `+${pct}% vs last year`;
    if (pct < 0) return `${pct}% vs last year`;
    return 'On par with last year';
  }

  protected dateLabel(): string {
    const iso = this.detail()?.startDate ?? '';
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  // === Private Initializers ===
  private initDetail(): Signal<EventDetailResponse | null> {
    // Lazy-load on open: react to visibility flipping true (skip the initial value).
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((open) => {
          const id = this.eventId();
          if (!open || !id) return of(null);
          return this.analyticsService.getEventDetail(id).pipe(finalize(() => undefined));
        })
      ),
      { initialValue: null }
    );
  }
}
