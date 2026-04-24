// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { formatCurrency, formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type {
  EmailCtrResponse,
  FunnelAggregates,
  FunnelTierMetrics,
  MarketingAttributionChannel,
  MarketingAttributionProject,
  MarketingAttributionResponse,
  MarketingKeyInsight,
  MarketingRecommendedAction,
  PaidCampaignPerformance,
  SocialReachResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-email-ctr-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, SkeletonModule, TagComponent, TitleCasePipe],
  templateUrl: './email-ctr-drawer.component.html',
})
export class EmailCtrDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);

  public readonly visible = model<boolean>(false);
  protected readonly drawerLoading = signal(false);

  protected readonly drawerData: Signal<EmailCtrResponse> = this.initDrawerData();
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly expandedTypes = signal<Set<string>>(new Set());

  protected readonly emailTotalSends: Signal<string> = computed(() => {
    const types = this.drawerData().emailTypeBreakdown ?? [];
    return formatNumber(types.reduce((sum, t) => sum + t.totalSends, 0));
  });
  protected readonly emailTotalOpens: Signal<string> = computed(() => {
    const types = this.drawerData().emailTypeBreakdown ?? [];
    return formatNumber(types.reduce((sum, t) => sum + t.totalOpens, 0));
  });
  protected readonly emailTotalClicks: Signal<string> = computed(() => {
    const types = this.drawerData().emailTypeBreakdown ?? [];
    return formatNumber(types.reduce((sum, t) => sum + t.totalClicks, 0));
  });
  protected readonly emailOpenRate: Signal<number> = computed(() => {
    const types = this.drawerData().emailTypeBreakdown ?? [];
    const sends = types.reduce((sum, t) => sum + t.totalSends, 0);
    const opens = types.reduce((sum, t) => sum + t.totalOpens, 0);
    return sends > 0 ? Math.round(((opens * 100.0) / sends) * 10) / 10 : 0;
  });
  /** Clicks÷sends — follows HubSpot's CTR convention (not clicks÷opens). */
  protected readonly emailAvgCtr: Signal<number> = computed(() => {
    const types = this.drawerData().emailTypeBreakdown ?? [];
    const sends = types.reduce((sum, t) => sum + t.totalSends, 0);
    const clicks = types.reduce((sum, t) => sum + t.totalClicks, 0);
    return sends > 0 ? Math.round(((clicks * 100.0) / sends) * 10) / 10 : 0;
  });

  protected readonly paidData: Signal<SocialReachResponse> = this.initPaidData();
  private readonly paidDataResolved = signal(false);
  protected readonly formattedTotalSpend: Signal<string> = computed(() => formatCurrency(this.paidData().totalSpend));
  protected readonly formattedTotalRevenue: Signal<string> = computed(() => formatCurrency(this.paidData().totalRevenue));
  protected readonly paidTotalConversions: Signal<string> = computed(() => {
    const projects = this.paidData().projectBreakdown ?? [];
    return formatNumber(projects.reduce((sum, p) => sum + p.conversions, 0));
  });
  protected readonly paidTotalSessions: Signal<string> = computed(() => {
    const projects = this.paidData().projectBreakdown ?? [];
    return formatNumber(projects.reduce((sum, p) => sum + p.sessions, 0));
  });
  protected readonly expandedProjects = signal<Set<string>>(new Set());

  protected readonly funnelAggregates: Signal<FunnelAggregates> = computed(() => {
    const projects = this.paidData().projectBreakdown ?? [];
    const campaigns: PaidCampaignPerformance[] = projects.flatMap((p) => p.campaigns);

    const aggregate = (stages: string[]): FunnelTierMetrics => {
      const matched = campaigns.filter((c) => stages.includes(c.funnelStage));
      return {
        count: matched.length,
        spend: matched.reduce((s, c) => s + c.spend, 0),
        revenue: matched.reduce((s, c) => s + c.revenue, 0),
        impressions: matched.reduce((s, c) => s + c.impressions, 0),
        clicks: matched.reduce((s, c) => s + c.clicks, 0),
        sessions: matched.reduce((s, c) => s + c.sessions, 0),
        conversions: matched.reduce((s, c) => s + c.conversions, 0),
      };
    };

    // Fold 'Unknown' into ToFU — unmapped campaigns are typically awareness-level,
    // and excluding them would cause funnel totals to disagree with paidData().totalReach.
    const tofu = aggregate(['ToFU', 'ToFU2', 'Unknown']);
    const mofu = aggregate(['MoFU']);
    const bofu = aggregate(['BoFU']);

    return { tofu, mofu, bofu };
  });

  protected readonly attributionData: Signal<MarketingAttributionResponse> = this.initAttributionData();
  private readonly attributionDataResolved = signal(false);
  protected readonly expandedChannels = signal<Set<string>>(new Set());
  protected readonly attributionProjectsByChannel: Signal<Map<string, MarketingAttributionProject[]>> = computed(() => {
    const grouped = new Map<string, MarketingAttributionProject[]>();
    for (const p of this.attributionData().projects) {
      const list = grouped.get(p.channel) ?? [];
      list.push(p);
      grouped.set(p.channel, list);
    }
    return grouped;
  });
  protected readonly attributionTotals: Signal<{
    sessions: number;
    linearRevenue: number;
    firstTouchRevenue: number;
    lastTouchRevenue: number;
    timeDecayRevenue: number;
  }> = computed(() => {
    const channels = this.attributionData().channels;
    return {
      sessions: channels.reduce((s, c) => s + c.sessions, 0),
      linearRevenue: channels.reduce((s, c) => s + c.linearRevenue, 0),
      firstTouchRevenue: channels.reduce((s, c) => s + c.firstTouchRevenue, 0),
      lastTouchRevenue: channels.reduce((s, c) => s + c.lastTouchRevenue, 0),
      timeDecayRevenue: channels.reduce((s, c) => s + c.timeDecayRevenue, 0),
    };
  });

  protected readonly formatCurrency = formatCurrency;

  protected onClose(): void {
    this.visible.set(false);
  }

  protected toggleType(emailType: string): void {
    const current = this.expandedTypes();
    const next = new Set(current);
    if (next.has(emailType)) {
      next.delete(emailType);
    } else {
      next.add(emailType);
    }
    this.expandedTypes.set(next);
  }

  protected formatCompact(value: number): string {
    if (value >= 999_950) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }

  protected getPerformanceSeverity(performance: string): 'danger' | 'warn' | 'success' | 'secondary' {
    if (performance === 'LOW OPENS' || performance === 'LOW CLICKS' || performance === 'POOR' || performance === 'NO REVENUE') return 'danger';
    if (performance === 'GOOD') return 'warn';
    if (performance === 'EXCELLENT' || performance === 'STRONG') return 'success';
    return 'secondary';
  }

  protected toggleProject(projectName: string): void {
    const current = this.expandedProjects();
    const next = new Set(current);
    if (next.has(projectName)) {
      next.delete(projectName);
    } else {
      next.add(projectName);
    }
    this.expandedProjects.set(next);
  }

  protected formatFunnelLabel(stage: string): string {
    const labels: Record<string, string> = { BoFU: 'BOTTOM', MoFU: 'MIDDLE', ToFU: 'TOP', ToFU2: 'TOP', Unknown: '' };
    return labels[stage] ?? stage;
  }

  protected toggleChannel(channel: string): void {
    const current = this.expandedChannels();
    const next = new Set(current);
    if (next.has(channel)) {
      next.delete(channel);
    } else {
      next.add(channel);
    }
    this.expandedChannels.set(next);
  }

  protected revPerSession(channel: MarketingAttributionChannel): string {
    return channel.sessions > 0 ? `$${(channel.linearRevenue / channel.sessions).toFixed(2)}` : '—';
  }

  private initDrawerData(): Signal<EmailCtrResponse> {
    const defaultValue: EmailCtrResponse = {
      currentCtr: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      campaignGroups: [],
      monthlySends: [],
      monthlyOpens: [],
    };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || 'tlf'));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.drawerLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getEmailCtr(foundationSlug).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load email CTR details.',
              });
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      // Gate on all three data sources having resolved — avoid misleading
      // "Maintain current momentum" while paid/attribution are still in-flight.
      if (this.drawerLoading() || !this.paidDataResolved() || !this.attributionDataResolved()) {
        return [];
      }

      const email = this.drawerData();
      const paid = this.paidData();
      const attribution = this.attributionData();

      // Collect best action per section (attribution, paid, email) — max 3 total
      const attrActions: MarketingRecommendedAction[] = [];
      const paidActions: MarketingRecommendedAction[] = [];
      const emailActions: MarketingRecommendedAction[] = [];

      // --- Attribution ---
      const marketingChannelNames = new Set(['Email', 'Paid Performance', 'Internal & Banner']);
      const marketingChannels = attribution.channels.filter((c) => marketingChannelNames.has(c.channel));
      if (marketingChannels.length > 0) {
        const emailChannel = marketingChannels.find((c) => c.channel === 'Email');
        const bannerChannel = marketingChannels.find((c) => c.channel === 'Internal & Banner');
        const zeroCostUnused: string[] = [];
        if (emailChannel && emailChannel.sessions === 0) zeroCostUnused.push('Email');
        if (bannerChannel && bannerChannel.sessions === 0) zeroCostUnused.push('Internal & Banner');

        if (zeroCostUnused.length > 0) {
          attrActions.push({
            title: `Leverage ${zeroCostUnused.join(' and ')} for more reach`,
            description: `${zeroCostUnused.join(' and ')} ${zeroCostUnused.length > 1 ? 'are' : 'is'} not driving sessions — activate these zero-cost channels to complement paid`,
            priority: 'medium',
            actionType: 'growth',
          });
        }

        if (attrActions.length === 0) {
          const totalMktSessions = marketingChannels.reduce((s, c) => s + c.sessions, 0);
          const lowChannels = marketingChannels.filter((c) => totalMktSessions > 0 && (c.sessions / totalMktSessions) * 100 < 10 && c.sessions > 0);
          if (lowChannels.length > 0) {
            attrActions.push({
              title: `Scale up ${lowChannels.map((c) => c.channel).join(' and ')}`,
              description: `These channels are active but contributing less than 10% of marketing sessions — increase activity to boost reach`,
              priority: 'medium',
              actionType: 'growth',
            });
          }
        }
      }

      // --- Paid (funnel-aware, impressions-based) — pick highest-priority ---
      const funnel = this.funnelAggregates();

      if (funnel.tofu.count > 0 && funnel.tofu.impressions === 0 && funnel.tofu.spend > 0) {
        paidActions.push({
          title: 'Awareness campaigns generating no impressions',
          description: `${funnel.tofu.count} awareness campaign${funnel.tofu.count > 1 ? 's' : ''} with ${formatCurrency(funnel.tofu.spend)} spend but zero impressions — review ad targeting`,
          priority: 'high',
          actionType: 'optimize',
        });
      }

      if (paidActions.length === 0 && funnel.mofu.count > 0 && funnel.mofu.spend > 0) {
        const ctr = funnel.mofu.impressions > 0 ? (funnel.mofu.clicks / funnel.mofu.impressions) * 100 : 0;
        if (ctr > 0 && ctr < 1) {
          paidActions.push({
            title: 'Low click-through on engagement campaigns',
            description: `Engagement CTR at ${ctr.toFixed(2)}% — test new ad creative or refine audience targeting`,
            priority: 'medium',
            actionType: 'optimize',
          });
        }
      }

      if (paidActions.length === 0 && paid.monthlyData.length >= 3) {
        const recent3 = paid.monthlyData.slice(-3);
        if (recent3[0] > recent3[1] && recent3[1] > recent3[2]) {
          paidActions.push({
            title: 'Investigate declining paid impressions',
            description: 'Impressions dropped for 3 consecutive months — review budget pacing and bid strategy',
            priority: 'medium',
            actionType: 'investigate',
          });
        }
      }

      if (paidActions.length === 0 && funnel.bofu.count > 0 && funnel.bofu.spend > 0 && funnel.bofu.conversions === 0) {
        paidActions.push({
          title: 'Conversion campaigns spending without converting',
          description: `${funnel.bofu.count} conversion campaign${funnel.bofu.count > 1 ? 's are' : ' is'} active with no recorded conversions — review landing page and conversion tracking`,
          priority: 'high',
          actionType: 'optimize',
        });
      }

      // --- Email — pick highest-priority ---
      if (email.changePercentage < 0) {
        emailActions.push({
          title: 'Test new call-to-action formats',
          description: `Email CTR dropped ${Math.abs(email.changePercentage).toFixed(1)}% — experiment with button placement and copy`,
          priority: email.changePercentage < -10 ? 'high' : 'medium',
          actionType: 'optimize',
        });
      }

      if (emailActions.length === 0 && email.monthlySends.length >= 2 && email.monthlyOpens.length >= 2) {
        const latestOpenRate =
          email.monthlySends[email.monthlySends.length - 1] > 0
            ? (email.monthlyOpens[email.monthlyOpens.length - 1] / email.monthlySends[email.monthlySends.length - 1]) * 100
            : 0;
        const prevOpenRate =
          email.monthlySends[email.monthlySends.length - 2] > 0
            ? (email.monthlyOpens[email.monthlyOpens.length - 2] / email.monthlySends[email.monthlySends.length - 2]) * 100
            : 0;
        if (latestOpenRate < prevOpenRate) {
          emailActions.push({
            title: 'Optimize email subject lines',
            description: `Open rate declined from ${prevOpenRate.toFixed(1)}% to ${latestOpenRate.toFixed(1)}% — A/B test subject lines`,
            priority: latestOpenRate < prevOpenRate * 0.9 ? 'high' : 'medium',
            actionType: 'content',
          });
        }
      }

      if (emailActions.length === 0 && (email.emailTypeBreakdown?.length ?? 0) >= 2) {
        const types = email.emailTypeBreakdown!;
        const bestCtr = [...types].sort((a, b) => b.ctr - a.ctr)[0];
        const worstCtr = [...types].sort((a, b) => a.ctr - b.ctr)[0];
        if (bestCtr.ctr > worstCtr.ctr * 2 && worstCtr.totalSends > 100) {
          emailActions.push({
            title: `Revamp ${worstCtr.emailType.toLowerCase()} email strategy`,
            description: `${worstCtr.emailType} emails average ${worstCtr.ctr.toFixed(1)}% CTR vs ${bestCtr.ctr.toFixed(1)}% for ${bestCtr.emailType} — apply winning patterns`,
            priority: 'medium',
            actionType: 'content',
          });
        }
      }

      // Combine — 1 per section, max 3
      const actions = [...attrActions.slice(0, 1), ...paidActions.slice(0, 1), ...emailActions.slice(0, 1)];

      if (actions.length === 0) {
        actions.push({
          title: 'Maintain current momentum',
          description: 'All channels performing well — continue current strategy and monitor for shifts',
          priority: 'low',
          actionType: 'growth',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      // Gate on all three data sources — same rationale as initRecommendedActions.
      if (this.drawerLoading() || !this.paidDataResolved() || !this.attributionDataResolved()) {
        return [];
      }

      const email = this.drawerData();
      const paid = this.paidData();
      const attribution = this.attributionData();

      // Collect best insight per section (attribution, paid, email) — max 3 total
      const attrInsights: MarketingKeyInsight[] = [];
      const paidInsights: MarketingKeyInsight[] = [];
      const emailInsights: MarketingKeyInsight[] = [];

      // --- Attribution — pick 1 best ---
      if (attribution.channels.length > 0) {
        const totalSessions = attribution.channels.reduce((s, c) => s + c.sessions, 0);
        const totalLinearRevenue = attribution.channels.reduce((s, c) => s + c.linearRevenue, 0);

        if (totalLinearRevenue > 0 && totalSessions > 0) {
          const revPerSession = totalLinearRevenue / totalSessions;
          attrInsights.push({
            text: `${formatNumber(totalSessions)} total sessions driving ${EmailCtrDrawerComponent.formatRevenue(totalLinearRevenue)} attributed revenue ($${revPerSession.toFixed(2)}/session)`,
            type: 'driver',
          });
        } else if (totalLinearRevenue > 0) {
          attrInsights.push({
            text: `${EmailCtrDrawerComponent.formatRevenue(totalLinearRevenue)} attributed revenue across channels`,
            type: 'driver',
          });
        } else if (totalSessions > 0) {
          attrInsights.push({ text: `${formatNumber(totalSessions)} total sessions across ${attribution.channels.length} channels`, type: 'info' });
        }
      }

      // --- Paid (funnel-aware, impressions-based) — pick 1 best ---
      const funnel = this.funnelAggregates();
      const totalPaidImpressions = funnel.tofu.impressions + funnel.mofu.impressions + funnel.bofu.impressions;

      if (totalPaidImpressions > 0) {
        paidInsights.push({
          text: `Paid campaigns: ${formatNumber(totalPaidImpressions)} impressions across ${funnel.tofu.count + funnel.mofu.count + funnel.bofu.count} campaigns (${formatCurrency(funnel.tofu.spend + funnel.mofu.spend + funnel.bofu.spend)} spend)`,
          type: totalPaidImpressions > 10_000 ? 'driver' : 'info',
        });
      }

      if (paidInsights.length === 0 && funnel.tofu.count > 0) {
        if (funnel.tofu.impressions > 0) {
          paidInsights.push({
            text: `Awareness: ${formatNumber(funnel.tofu.impressions)} impressions across ${funnel.tofu.count} campaign${funnel.tofu.count > 1 ? 's' : ''} (${formatCurrency(funnel.tofu.spend)} spend)`,
            type: funnel.tofu.impressions > 10_000 ? 'driver' : 'info',
          });
        } else if (funnel.tofu.spend > 0) {
          paidInsights.push({
            text: `Awareness: ${funnel.tofu.count} campaign${funnel.tofu.count > 1 ? 's' : ''} active but no impressions recorded`,
            type: 'warning',
          });
        }
      }

      if (paidInsights.length === 0 && funnel.mofu.count > 0) {
        const ctr = funnel.mofu.impressions > 0 ? (funnel.mofu.clicks / funnel.mofu.impressions) * 100 : 0;
        if (funnel.mofu.clicks > 0) {
          paidInsights.push({
            text: `Engagement: ${formatNumber(funnel.mofu.clicks)} clicks at ${ctr.toFixed(1)}% CTR across ${funnel.mofu.count} campaign${funnel.mofu.count > 1 ? 's' : ''}`,
            type: ctr >= 2 ? 'driver' : 'info',
          });
        }
      }

      if (paidInsights.length === 0 && funnel.bofu.count > 0) {
        paidInsights.push({
          text: `Conversion: ${formatNumber(funnel.bofu.conversions)} conversion${funnel.bofu.conversions !== 1 ? 's' : ''} across ${funnel.bofu.count} campaign${funnel.bofu.count > 1 ? 's' : ''} (${formatCurrency(funnel.bofu.spend)} spend)`,
          type: funnel.bofu.conversions > 0 ? 'driver' : 'warning',
        });
      }

      if (paidInsights.length === 0 && paid.totalReach > 0 && paid.monthlyData.length >= 2) {
        const prev = paid.monthlyData[paid.monthlyData.length - 2];
        const curr = paid.monthlyData[paid.monthlyData.length - 1];
        if (prev > 0) {
          const paidMom = ((curr - prev) / prev) * 100;
          if (paidMom > 20) {
            paidInsights.push({ text: `Paid impressions surged ${paidMom.toFixed(0)}% MoM — ${formatNumber(curr)} last month`, type: 'driver' });
          } else if (paidMom < -20) {
            paidInsights.push({ text: `Paid impressions dropped ${Math.abs(paidMom).toFixed(0)}% MoM`, type: 'warning' });
          }
        }
      }

      // --- Email — pick 1 best ---
      if (email.currentCtr > 0 || email.monthlyData.length > 0) {
        if (email.changePercentage > 10) {
          emailInsights.push({ text: `Email CTR grew ${email.changePercentage.toFixed(1)}% vs 6-month avg — strong improvement`, type: 'driver' });
        } else if (email.changePercentage < -10) {
          emailInsights.push({ text: `Email CTR dropped ${Math.abs(email.changePercentage).toFixed(1)}% vs 6-month avg`, type: 'warning' });
        } else if (email.changePercentage !== 0) {
          emailInsights.push({
            text: `Email CTR ${email.changePercentage > 0 ? 'up' : 'down'} ${Math.abs(email.changePercentage).toFixed(1)}% vs 6-month avg`,
            type: email.changePercentage > 0 ? 'info' : 'warning',
          });
        }
      }

      if (emailInsights.length === 0 && (email.emailTypeBreakdown?.length ?? 0) > 0) {
        const types = email.emailTypeBreakdown!;
        const excellent = types.filter((t) => t.performance === 'EXCELLENT' || t.performance === 'STRONG');
        if (excellent.length > 0) {
          const names = excellent.map((t) => t.emailType.toLowerCase()).join(', ');
          emailInsights.push({ text: `${names} emails are performing well across opens and clicks`, type: 'driver' });
        } else {
          const lowOpens = types.filter((t) => t.performance === 'LOW OPENS');
          if (lowOpens.length > 0) {
            const names = lowOpens.map((t) => t.emailType.toLowerCase()).join(', ');
            emailInsights.push({ text: `${names} emails have low open rates — review subject lines and send times`, type: 'warning' });
          }
        }
      }

      // Combine — 1 per section, max 3
      return [...attrInsights.slice(0, 1), ...paidInsights.slice(0, 1), ...emailInsights.slice(0, 1)];
    });
  }

  private initPaidData(): Signal<SocialReachResponse> {
    const defaultValue: SocialReachResponse = {
      totalReach: 0,
      roas: 0,
      totalSpend: 0,
      totalRevenue: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      monthlyRoas: [],
      channelGroups: [],
    };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || 'tlf'));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.paidDataResolved.set(false)),
        switchMap((foundationSlug) =>
          this.analyticsService.getSocialReach(foundationSlug).pipe(
            tap(() => this.paidDataResolved.set(true)),
            catchError(() => {
              this.paidDataResolved.set(true);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initAttributionData(): Signal<MarketingAttributionResponse> {
    const defaultValue: MarketingAttributionResponse = { channels: [], projects: [] };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || 'tlf'));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.attributionDataResolved.set(false)),
        switchMap((foundationSlug) =>
          this.analyticsService.getMarketingAttribution(foundationSlug).pipe(
            tap(() => this.attributionDataResolved.set(true)),
            catchError(() => {
              this.attributionDataResolved.set(true);
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private static formatRevenue(value: number): string {
    if (value <= 0) return '—';
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toLocaleString()}`;
  }
}
