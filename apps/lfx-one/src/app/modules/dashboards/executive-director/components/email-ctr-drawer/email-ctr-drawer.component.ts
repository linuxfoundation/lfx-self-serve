// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type { EmailCtrResponse, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

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

  // True once all three data sources have resolved (not still loading)
  private readonly dataResolved: Signal<boolean> = computed(() => !this.drawerLoading());

  protected readonly hasNoData: Signal<boolean> = this.initHasNoData();

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
    // Locale pinned for SSR: an unpinned toLocaleString renders different separators
    // server-side vs client-side and trips hydration text mismatches.
    return value.toLocaleString('en-US');
  }

  protected getPerformanceSeverity(performance: string): 'danger' | 'warn' | 'success' | 'secondary' {
    if (performance === 'LOW OPENS' || performance === 'LOW CLICKS' || performance === 'POOR' || performance === 'NO REVENUE') return 'danger';
    if (performance === 'GOOD') return 'warn';
    if (performance === 'EXCELLENT' || performance === 'STRONG') return 'success';
    return 'secondary';
  }

  private initHasNoData(): Signal<boolean> {
    return computed(() => {
      if (!this.dataResolved()) {
        return false;
      }
      const email = this.drawerData();
      return !(email.currentCtr > 0 || email.monthlySends.some((s) => s > 0));
    });
  }

  private initDrawerData(): Signal<EmailCtrResponse> {
    const defaultValue: EmailCtrResponse = {
      currentCtr: 0,
      changePercentage: 0,
      momChangePercentage: null,
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
          this.analyticsService.getEmailCtr(foundationSlug, undefined, 'last-6').pipe(
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
      if (!this.dataResolved()) {
        return [];
      }

      const email = this.drawerData();
      const emailActions: MarketingRecommendedAction[] = [];

      // --- Email — pick highest-priority ---
      // Use the true MoM figure: with a trailing (last-6) period, changePercentage
      // compares the window's blended CTR against its own monthly average and sits
      // near zero by construction.
      const emailCtrMom = email.momChangePercentage;
      if (emailCtrMom !== null && emailCtrMom < 0) {
        emailActions.push({
          title: 'Test new call-to-action formats',
          description: `Email CTR dropped ${Math.abs(emailCtrMom).toFixed(1)}% MoM — experiment with button placement and copy`,
          priority: emailCtrMom < -10 ? 'high' : 'medium',
          actionType: 'optimize',
        });
      }

      // Open-rate comparison requires sends in BOTH months: the series is
      // calendar zero-filled, and a no-send month has no open rate — treating
      // it as 0% fabricates an "Open rate declined" action.
      if (
        emailActions.length === 0 &&
        email.monthlySends.length >= 2 &&
        email.monthlyOpens.length >= 2 &&
        email.monthlySends[email.monthlySends.length - 1] > 0 &&
        email.monthlySends[email.monthlySends.length - 2] > 0
      ) {
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

      // Email-only. Paid recommendations live in the Paid Media drawer, which
      // derives its own from getSocialReach. The multi-touch attribution table
      // moved to the Attribution drawer without recommendations — that drawer
      // still advises from its revenueImpact input, so nothing currently reads
      // the marketing-attribution channels. Tracked as a follow-up rather than
      // rebuilt here, since it is a new feature rather than a relocation.
      const actions = [...emailActions.slice(0, 3)];

      if (actions.length === 0 && !this.hasNoData()) {
        actions.push({
          title: 'Maintain current momentum',
          description: 'Email performance is healthy — continue current strategy and monitor for shifts',
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
      if (!this.dataResolved()) {
        return [];
      }

      const email = this.drawerData();
      const emailInsights: MarketingKeyInsight[] = [];

      // --- Email — pick 1 best ---
      // momChangePercentage is the true MoM (unaffected by the trailing window);
      // changePercentage under last-6 is the blended-vs-average figure and is
      // structurally near zero.
      const emailCtrMomInsight = email.momChangePercentage;
      if ((email.currentCtr > 0 || email.monthlyData.length > 0) && emailCtrMomInsight !== null) {
        if (emailCtrMomInsight > 10) {
          emailInsights.push({ text: `Email CTR grew ${emailCtrMomInsight.toFixed(1)}% MoM — strong improvement`, type: 'driver' });
        } else if (emailCtrMomInsight < -10) {
          emailInsights.push({ text: `Email CTR dropped ${Math.abs(emailCtrMomInsight).toFixed(1)}% MoM`, type: 'warning' });
        } else if (emailCtrMomInsight !== 0) {
          emailInsights.push({
            text: `Email CTR ${emailCtrMomInsight > 0 ? 'up' : 'down'} ${Math.abs(emailCtrMomInsight).toFixed(1)}% MoM`,
            type: emailCtrMomInsight > 0 ? 'info' : 'warning',
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

      // Email-only — see the note on initRecommendedActions.
      return [...emailInsights.slice(0, 3)];
    });
  }
}
