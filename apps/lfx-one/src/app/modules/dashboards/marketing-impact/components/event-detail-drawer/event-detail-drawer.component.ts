// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { DrawerModule } from 'primeng/drawer';
import { Skeleton } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';

import type { EventDetailResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DrawerModule, Skeleton],
  templateUrl: './event-detail-drawer.component.html',
})
export class EventDetailDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  /** Event id to load when the drawer opens. */
  public readonly eventId = input<string | null>(null);
  /** Foundation the event belongs to; required by the server to scope the read. */
  public readonly foundationSlug = input<string | undefined>();

  // === WritableSignals ===
  /**
   * Set by the detail stream rather than derived from `detail() === null`. The request can end in
   * an error, so a derived flag would leave the skeleton up forever instead of falling through.
   */
  protected readonly loading = signal(false);
  /**
   * Distinguishes "we could not load this" from "this event has no detail" — both leave `detail()`
   * null, but only one of them should tell the user something went wrong.
   */
  protected readonly failed = signal(false);

  // === Computed Signals ===
  protected readonly detail: Signal<EventDetailResponse | null> = this.initDetail();

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

  /**
   * Everything the template renders as text, formatted once per detail change. The template used
   * to call formatting helpers directly, which re-ran locale/currency formatting on every
   * change-detection pass; per the frontend checklist templates read computed values instead.
   */
  protected readonly view = computed(() => {
    const d = this.detail();
    if (!d) return null;
    return {
      dateLabel: this.formatDate(d.startDate),
      vsLastYearLabel: this.formatVsLastYear(d.vsLastYear),
      registrationsActual: formatNumber(d.registrations.actual),
      registrationsGoal: formatNumber(d.registrations.goal),
      sponsorshipActual: formatCurrency(d.sponsorshipRevenue.actual),
      sponsorshipGoal: formatCurrency(d.sponsorshipRevenue.goal),
      tiers: d.sponsorshipTiers.map((tier) => ({
        tier: tier.tier,
        label: tier.tier || 'Other',
        sponsorCount: tier.sponsorCount,
        revenue: formatCurrency(tier.revenue),
      })),
    };
  });

  // === Private Helpers ===
  /** Registration pace vs last year as a signed percent string, or null when no baseline. */
  private formatVsLastYear(vsLastYear: number | null): string | null {
    if (vsLastYear === null) return null;
    const pct = Math.round((vsLastYear - 1) * 100);
    if (pct > 0) return `+${pct}% vs last year`;
    if (pct < 0) return `${pct}% vs last year`;
    return 'On par with last year';
  }

  private formatDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    // Range-check before Date.UTC: it rolls out-of-range parts over silently (month=13 becomes
    // January of the next year), rendering a confidently wrong date instead of the raw value.
    if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return iso;
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  // === Private Initializers ===
  private initDetail(): Signal<EventDetailResponse | null> {
    // Lazy-load on open, and reload when the selected event changes. Both are triggers: the
    // drawer stays open while the user clicks a different roster row, so watching `visible`
    // alone would leave the previous event's numbers on screen under the new event's name.
    return toSignal(
      combineLatest([toObservable(this.visible), toObservable(this.eventId), toObservable(this.foundationSlug)]).pipe(
        // The parent sets eventId and visible in two separate writes, so one open produces two
        // emissions; dedupe the triple so that lands as a single fetch rather than a duplicate.
        distinctUntilChanged(([prevOpen, prevId, prevSlug], [open, id, slug]) => prevOpen === open && prevId === id && prevSlug === slug),
        switchMap(([open, id, slug]) => {
          if (!open || !id || !slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          this.failed.set(false);
          // finalize, not a tap on the value — the stream can end in an error, and that still
          // has to clear the skeleton. The error is caught here rather than in the service so a
          // failure renders "couldn't load" instead of the "no detail" empty state.
          return this.analyticsService.getEventDetail(id, slug).pipe(
            catchError((error: unknown) => {
              console.error('[analytics] event-detail failed', { eventId: id, foundationSlug: slug, error });
              this.failed.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
