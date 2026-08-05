// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';

import type { EducationCategoryRow, MarketingKeyInsight, MarketingRecommendedAction, TrainingCertificationSummaryResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-education-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, CurrencyPipe, DecimalPipe, DrawerModule, TagComponent],
  templateUrl: './education-drawer.component.html',
})
export class EducationDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<TrainingCertificationSummaryResponse>(HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY);

  // === Computed Signals ===
  protected readonly totalEnrollments: Signal<number> = computed(() => {
    const e = this.data().enrollment;
    return e.instructorLed + e.eLearning + e.certExams + e.edx;
  });

  // edX is excluded: COURSE_PURCHASES has no edX revenue column, so it contributes
  // enrollments without revenue. Summing a 0 for it would understate revenue per
  // enrollment without signalling why.
  protected readonly totalRevenue: Signal<number> = computed(() => {
    const r = this.data().revenue;
    return r.instructorLed + r.eLearning + r.certExams;
  });

  protected readonly categoryRows: Signal<EducationCategoryRow[]> = this.initCategoryRows();

  protected readonly totalEnrollmentsLabel: Signal<string> = computed(() => formatNumber(this.totalEnrollments()));
  protected readonly totalRevenueLabel: Signal<string> = computed(() => formatCurrency(this.totalRevenue()));

  /**
   * Whether net revenue is a measured figure at all, as opposed to untracked.
   *
   * Gates the revenue stats on the presence of revenue-bearing enrollments rather than
   * on a non-zero total. A foundation with instructor-led/eLearning/cert enrollments has
   * its revenue measured, so a $0 result is real data and must render as $0 — showing a
   * dash there would report a measured zero as "no data". The dash is reserved for the
   * all-edX case, where COURSE_PURCHASES carries no revenue column and the figure is
   * genuinely untracked. This also keeps the stat cards consistent with the format rows,
   * which already distinguish null (untracked) from 0.
   */
  protected readonly hasTrackedRevenue: Signal<boolean> = computed(() => {
    const e = this.data().enrollment;
    return e.instructorLed + e.eLearning + e.certExams > 0;
  });

  /** Revenue per enrollment across revenue-bearing categories only (edX excluded from both sides). */
  protected readonly revenuePerEnrollmentLabel: Signal<string> = computed(() => {
    const e = this.data().enrollment;
    const revenueBearingEnrollments = e.instructorLed + e.eLearning + e.certExams;
    if (revenueBearingEnrollments === 0) return '—';
    return formatCurrency(this.totalRevenue() / revenueBearingEnrollments);
  });

  /**
   * The leading format is a neutral fact, not an achievement — it is reported as a plain
   * statement rather than an insight so it cannot be routed into "Performing Well" while
   * the same format is simultaneously flagged as a concentration risk. Same for the
   * highest-earning format below.
   */
  protected readonly neutralFacts: Signal<string[]> = this.initNeutralFacts();

  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);
  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);
  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);
  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);

  protected onClose(): void {
    this.visible.set(false);
  }

  private initCategoryRows(): Signal<EducationCategoryRow[]> {
    return computed(() => {
      const { enrollment, revenue } = this.data();
      const total = this.totalEnrollments();
      const row = (label: string, enrollments: number, categoryRevenue: number | null): EducationCategoryRow => {
        const enrollmentSharePct = total > 0 ? (enrollments / total) * 100 : 0;
        return {
          label,
          enrollments,
          revenue: categoryRevenue,
          enrollmentSharePct,
          enrollmentShareLabel: `${enrollmentSharePct.toFixed(0)}%`,
        };
      };

      return [
        row('Instructor Led', enrollment.instructorLed, revenue.instructorLed),
        row('eLearning', enrollment.eLearning, revenue.eLearning),
        row('Cert Exams', enrollment.certExams, revenue.certExams),
        // null, not 0 — edX revenue is not tracked upstream rather than being zero.
        row('edX', enrollment.edx, null),
      ];
    });
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const total = this.totalEnrollments();
      const actions: MarketingRecommendedAction[] = [];

      if (total === 0) {
        return actions;
      }

      const rows = this.categoryRows();
      const { enrollment } = this.data();

      // Concentration risk — one format carrying the programme
      const top = [...rows].sort((a, b) => b.enrollments - a.enrollments)[0];
      if (top.enrollments > 0 && top.enrollmentSharePct > 70) {
        actions.push({
          title: 'Diversify education formats',
          description: `${top.label} is ${top.enrollmentSharePct.toFixed(0)}% of ${formatNumber(total)} enrollments — a single format carrying the programme is fragile. Build depth in the next 2 formats`,
          priority: 'high',
          actionType: 'diversify',
        });
      }

      // Certification is the credential that converts learners into members
      const certShare = total > 0 ? (enrollment.certExams / total) * 100 : 0;
      if (enrollment.certExams === 0) {
        actions.push({
          title: 'No certification exam activity',
          description:
            'Certification is the credential learners carry back to employers — zero exam enrollments means the programme is not converting training into credentials',
          priority: 'high',
          actionType: 'conversion',
        });
      } else if (certShare < 10) {
        actions.push({
          title: 'Grow certification attach rate',
          description: `Cert exams are only ${certShare.toFixed(0)}% of enrollments — promote exam pathways from instructor-led and eLearning completions`,
          priority: 'medium',
          actionType: 'conversion',
        });
      }

      // A format with enrollments but no revenue is either free or mispriced.
      // edX is excluded — it has no revenue column at all, so it can never qualify.
      const unmonetized = rows.filter((row) => row.label !== 'edX' && row.enrollments > 0 && (row.revenue ?? 0) === 0);
      if (unmonetized.length > 0) {
        actions.push({
          title: 'Formats running without revenue',
          description: `${unmonetized.map((row) => row.label).join(', ')} ${unmonetized.length === 1 ? 'has' : 'have'} enrollments but no recorded net revenue — confirm whether these are intentionally free or a pricing gap`,
          priority: 'medium',
          actionType: 'revenue',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const total = this.totalEnrollments();
      const insights: MarketingKeyInsight[] = [];

      if (total === 0) {
        return insights;
      }

      const rows = this.categoryRows();

      // Balanced portfolio — the only genuine performing-well signal here. The leading
      // and highest-earning formats are reported as neutral facts instead: splitByPriority
      // routes every non-warning insight into "Performing Well", so emitting them here
      // would praise the same format the concentration-risk action is flagging.
      const activeFormats = rows.filter((row) => row.enrollments > 0);
      if (activeFormats.length >= 3 && activeFormats.every((row) => row.enrollmentSharePct < 50)) {
        insights.push({
          text: `Balanced format mix across ${activeFormats.length} education formats — no single format above 50%`,
          type: 'driver',
        });
      }

      return insights;
    });
  }

  private initNeutralFacts(): Signal<string[]> {
    return computed(() => {
      if (this.totalEnrollments() === 0) {
        return [];
      }

      const rows = this.categoryRows();
      const facts: string[] = [];

      // Leading format
      const top = [...rows].sort((a, b) => b.enrollments - a.enrollments)[0];
      if (top.enrollments > 0) {
        facts.push(`${top.label} leads with ${formatNumber(top.enrollments)} enrollments (${top.enrollmentSharePct.toFixed(0)}% of total)`);
      }

      // Highest-earning format, which is often not the highest-enrolling one
      const revenueRows = rows.filter((row) => (row.revenue ?? 0) > 0);
      if (revenueRows.length > 0) {
        const topRevenue = [...revenueRows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
        facts.push(`${topRevenue.label} generates the most net revenue at ${formatCurrency(topRevenue.revenue ?? 0)}`);
      }

      return facts;
    });
  }
}
