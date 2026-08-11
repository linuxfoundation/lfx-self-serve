// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { DrawerModule } from 'primeng/drawer';
import { finalize, of, skip, switchMap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EventChannelAttribution, EventChannelGroup, EventChannelType, EventDetailResponse, EventPaidCampaign } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DrawerModule, ButtonComponent, CardComponent, TagComponent, ChartComponent],
  templateUrl: './event-detail-drawer.component.html',
})
export class EventDetailDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  /** Event id to load when the drawer opens. */
  public readonly eventId = input<string | null>(null);
  /**
   * Which story the drawer tells:
   * - 'b2c' — registrations + the marketing campaigns that drove them (default)
   * - 'b2b' — sponsorship revenue + sponsors by tier
   * - 'all' — everything (legacy combined view)
   */
  public readonly focus = input<'b2c' | 'b2b' | 'all'>('all');

  // === Computed: section visibility from focus ===
  protected readonly showRegistrations = computed(() => this.focus() !== 'b2b');
  protected readonly showSponsorship = computed(() => this.focus() !== 'b2c');

  // === Attribution tree (collapsible: Channel Type → Channel) ===
  /** Which channel-type groups are expanded. Empty = all collapsed. */
  protected readonly expandedTypes = signal<Set<EventChannelType>>(new Set());
  /**
   * The event's channel attribution grouped into Paid / Social / Email / Web buckets,
   * each with rolled-up sessions + revenue, ranked by impact (sessions desc). The child
   * channels are the raw attribution labels beneath each type.
   */
  protected readonly channelTree: Signal<EventChannelGroup[]> = computed(() => this.buildChannelTree());

  /** Paid-ad campaigns for this event (per platform), shown when the Paid type is expanded. */
  protected readonly paidCampaigns = computed(() => this.detail()?.paidCampaigns ?? []);
  /** Email campaigns for this event, shown when the Email type is expanded. */
  protected readonly emailCampaigns = computed(() => this.detail()?.emailCampaigns ?? []);

  // === Paid performance breakdown (per-platform cards) ===

  /** Totals across every paid platform — the summary strip above the per-channel cards. */
  protected readonly paidTotals = computed(() => {
    const campaigns = this.paidCampaigns();
    const spend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    const conversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
    const clicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const impressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
    return {
      spend,
      conversions,
      clicks,
      impressions,
      cpa: conversions > 0 ? spend / conversions : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    };
  });

  /**
   * Per-platform cards, richest first. `sharePercent` is each platform's slice of total paid spend,
   * so the cards read as a budget allocation as well as a performance list.
   */
  protected readonly paidChannels = computed(() => {
    const campaigns = this.paidCampaigns();
    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    return [...campaigns]
      .sort((a, b) => b.spend - a.spend)
      .map((c) => ({
        ...c,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null,
        sharePercent: totalSpend > 0 ? Math.round((c.spend / totalSpend) * 100) : 0,
        // Efficiency read against this event's own blended CPA — not an absolute benchmark.
        tone: this.paidTone(c.cpa, totalSpend, campaigns),
      }));
  });

  /** True when any paid spend is recorded for this event. */
  protected readonly hasPaid = computed(() => this.paidCampaigns().length > 0);

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

  // Whether we have a daily curve to plot (needs the drilldown prediction data).
  protected readonly hasPacingChart = computed(() => (this.detail()?.pacing.points.length ?? 0) > 0);

  // Registration-pacing line chart: current-year + last-year + predicted, over days-to-event.
  protected readonly pacingChartData: Signal<ChartData<'line'>> = computed(() => this.buildPacingChart());

  protected readonly pacingChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: lfxColors.gray[500],
          font: { size: 11 },
          // Hide the low/high band series from the legend — the shaded area is self-explanatory.
          filter: (item) => item.text !== 'Predicted high' && item.text !== 'Predicted low',
        },
      },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        // Days to event count DOWN to zero; reverse so the event (0) sits on the right.
        reverse: true,
        title: { display: true, text: 'Days to event', color: lfxColors.gray[400], font: { size: 10 } },
        grid: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 }, maxTicksLimit: 8 },
      },
      y: {
        beginAtZero: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 } },
      },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.3, borderWidth: 2 } },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  /** Toggle a channel-type group open/closed in the attribution tree. */
  protected toggleType(type: EventChannelType): void {
    const next = new Set(this.expandedTypes());
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    this.expandedTypes.set(next);
  }

  protected isTypeExpanded(type: EventChannelType): boolean {
    return this.expandedTypes().has(type);
  }

  /** Sub-heading under the event name that names the story this drawer tells. */
  protected focusLabel(): string | null {
    switch (this.focus()) {
      case 'b2c':
        return 'Registrations & marketing campaigns';
      case 'b2b':
        return 'Sponsorship & partnerships';
      default:
        return null;
    }
  }

  // === Protected Helpers (template) ===
  protected num(value: number): string {
    return formatNumber(value);
  }

  /** lfx-tag severity for the registration-pace rating. */
  protected paceSeverity(): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (this.detail()?.compScore) {
      case 'high':
        return 'success';
      case 'medium':
        return 'warn';
      case 'low':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  protected money(value: number): string {
    return formatCurrency(value);
  }

  /** Compact money for dense card stats — keeps $1.2K/$11.9M from wrapping the tile. */
  protected moneyCompact(value: number): string {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value)}`;
  }

  /** Percentage to one decimal, or an em dash when it can't be computed. */
  protected pct(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(2)}%`;
  }

  /**
   * Brand icon per ad platform. Falls back to a generic bullhorn so an unmapped
   * platform still renders a sensible row rather than an empty gutter.
   */
  protected platformIcon(platform: string): string {
    const p = platform.toLowerCase();
    if (p.includes('google')) return 'fa-brands fa-google';
    if (p.includes('linkedin')) return 'fa-brands fa-linkedin';
    if (p.includes('reddit')) return 'fa-brands fa-reddit-alien';
    if (p.includes('twitter') || p.includes('x ads')) return 'fa-brands fa-x-twitter';
    if (p.includes('meta') || p.includes('facebook')) return 'fa-brands fa-meta';
    if (p.includes('microsoft') || p.includes('bing')) return 'fa-brands fa-microsoft';
    return 'fa-solid fa-bullhorn';
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

  /** Full venue + city + country line for the header; '' when nothing is known. */
  protected locationLabel(): string {
    const d = this.detail();
    if (!d) return '';
    return [d.location, d.city, d.country].filter((part) => part && part.length).join(', ');
  }

  /** Human label for the comparison pace rating. */
  protected paceRatingLabel(): string {
    switch (this.detail()?.compScore) {
      case 'high':
        return 'Pacing ahead';
      case 'medium':
        return 'On pace';
      case 'low':
        return 'Pacing behind';
      default:
        return 'No pace signal';
    }
  }

  /** "N registrations behind goal" when there is a real, unmet goal; otherwise null. */
  protected behindGoalLabel(): string | null {
    const d = this.detail();
    if (!d || d.registrations.goal <= 0) return null;
    const gap = d.registrations.goal - d.registrations.actual;
    if (gap <= 0) return 'Registration goal met';
    return `${formatNumber(gap)} registrations behind goal`;
  }

  // === Private Helpers ===

  /**
   * Efficiency tone for a platform, judged against this event's own blended CPA rather than an
   * absolute benchmark — CPAs vary far too much by geo and channel for a fixed threshold to mean
   * anything. Within 20% of blended reads neutral; materially cheaper is good, pricier is warn.
   */
  private paidTone(cpa: number | null, totalSpend: number, campaigns: readonly EventPaidCampaign[]): 'good' | 'warn' | 'none' {
    if (cpa === null) return 'none';
    const totalConv = campaigns.reduce((sum, c) => sum + c.conversions, 0);
    if (totalConv <= 0 || totalSpend <= 0) return 'none';
    const blended = totalSpend / totalConv;
    if (cpa <= blended * 0.8) return 'good';
    if (cpa >= blended * 1.2) return 'warn';
    return 'none';
  }

  private buildPacingChart(): ChartData<'line'> {
    const points = this.detail()?.pacing.points ?? [];
    const labels = points.map((point) => point.daysToEvent);
    return {
      labels,
      datasets: [
        // Prediction band (low..high) drawn first so the lines sit on top. The 'high' line
        // fills down to the 'low' line, shading the confidence range in a faint violet.
        {
          label: 'Predicted high',
          data: points.map((point) => point.predictedHigh),
          borderColor: 'transparent',
          backgroundColor: 'rgba(139, 92, 246, 0.08)',
          pointRadius: 0,
          fill: '+1',
        },
        {
          label: 'Predicted low',
          data: points.map((point) => point.predictedLow),
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Current year',
          data: points.map((point) => point.current),
          borderColor: lfxColors.blue[500],
          backgroundColor: 'transparent',
          spanGaps: false,
        },
        {
          label: 'Last year',
          data: points.map((point) => point.priorYear),
          borderColor: lfxColors.gray[400],
          backgroundColor: 'transparent',
          borderDash: [4, 4],
        },
        {
          label: 'Predicted',
          data: points.map((point) => point.predictedAvg),
          borderColor: lfxColors.violet[500],
          backgroundColor: 'transparent',
          borderDash: [6, 4],
        },
      ],
    };
  }

  /** Map a raw attribution channel label to one of the 4 channel types. */
  private channelTypeOf(label: string): EventChannelType {
    const l = label.toLowerCase();
    if (l.includes('email') || l.includes('hubspot') || l.includes('newsletter')) return 'Email';
    if (l.includes('social') || l.includes('linkedin') || l.includes('reddit') || l.includes('meta') || l.includes('twitter') || l.includes('youtube'))
      return 'Social';
    if (l.includes('paid') || l.includes('cpc') || l.includes('ads')) return 'Paid';
    // Organic search, direct, referral, internal/banner, other → Web.
    return 'Web';
  }

  /** Group d.channels into Paid/Social/Email/Web buckets, ranked by sessions (impact). */
  private buildChannelTree(): EventChannelGroup[] {
    const channels = this.detail()?.channels ?? [];
    const total = channels.reduce((sum, c) => sum + c.sessions, 0);
    const order: EventChannelType[] = ['Paid', 'Social', 'Email', 'Web'];
    const byType = new Map<EventChannelType, EventChannelAttribution[]>();

    for (const c of channels) {
      const type = this.channelTypeOf(c.channel);
      const list = byType.get(type) ?? [];
      list.push(c);
      byType.set(type, list);
    }

    // Always emit all four channel types so the structure is visible even when an event has no
    // tracked attribution yet (types with no data render at zero, not hidden).
    const groups: EventChannelGroup[] = order.map((type) => {
      const list = byType.get(type) ?? [];
      const sessions = list.reduce((sum, c) => sum + c.sessions, 0);
      const revenue = list.reduce((sum, c) => sum + c.revenue, 0);
      return {
        type,
        sessions,
        revenue,
        sharePercent: total > 0 ? Math.round((sessions / total) * 1000) / 10 : 0,
        channels: [...list].sort((a, b) => b.sessions - a.sessions),
      };
    });
    // Rank the type buckets by impact (sessions desc) so the biggest driver is on top.
    return groups.sort((a, b) => b.sessions - a.sessions);
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
