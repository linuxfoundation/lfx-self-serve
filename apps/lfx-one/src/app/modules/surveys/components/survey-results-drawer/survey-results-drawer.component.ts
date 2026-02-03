// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, effect, input, model, output, signal, Signal } from '@angular/core';
import { NpsGaugeComponent } from '@components/nps-gauge/nps-gauge.component';
import { SurveyStatus } from '@lfx-one/shared';
import { NpsBreakdown, SurveyParticipationStats, SurveyResultsDetail } from '@lfx-one/shared/interfaces';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { SurveyStatusLabelPipe } from '@pipes/survey-status-label.pipe';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

@Component({
  selector: 'lfx-survey-results-drawer',
  imports: [DrawerModule, DatePipe, SurveyStatusLabelPipe, SkeletonModule, NpsGaugeComponent],
  templateUrl: './survey-results-drawer.component.html',
  styleUrl: './survey-results-drawer.component.scss',
})
export class SurveyResultsDrawerComponent {
  // === Inputs ===
  public readonly survey = input<SurveyResultsDetail | null>(null);
  public readonly hasPMOAccess = input<boolean>(false);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly duplicate = output<string>();
  public readonly closeSurvey = output<string>();

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(false);
  protected readonly showAdminMenu = signal<boolean>(false);

  // === Computed Signals ===
  protected readonly isSurveyClosed: Signal<boolean> = this.initIsSurveyClosed();
  protected readonly isNpsSurvey: Signal<boolean> = this.initIsNpsSurvey();
  protected readonly participationStats: Signal<SurveyParticipationStats> = this.initParticipationStats();
  protected readonly npsScore: Signal<number> = this.initNpsScore();
  protected readonly npsBreakdown: Signal<NpsBreakdown | null> = this.initNpsBreakdown();
  protected readonly groupName: Signal<string> = this.initGroupName();
  protected readonly hasComments: Signal<boolean> = this.initHasComments();
  protected readonly commentsCount: Signal<number> = this.initCommentsCount();

  // === Constructor ===
  public constructor() {
    // Simulate loading when survey changes
    effect(() => {
      const s = this.survey();
      if (s && this.visible()) {
        this.loading.set(true);
        // Simulate API fetch delay
        setTimeout(() => this.loading.set(false), 500);
      }
    });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.showAdminMenu.set(false);
    this.visible.set(false);
  }

  protected toggleAdminMenu(): void {
    this.showAdminMenu.update((v) => !v);
  }

  protected closeAdminMenu(): void {
    this.showAdminMenu.set(false);
  }

  protected onDuplicate(): void {
    const s = this.survey();
    if (s?.id) {
      this.duplicate.emit(s.id);
      this.closeAdminMenu();
    }
  }

  protected onCloseSurvey(): void {
    const s = this.survey();
    if (s?.id) {
      this.closeSurvey.emit(s.id);
      this.closeAdminMenu();
    }
  }

  protected getBreakdownPercentage(count: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((count / total) * 100);
  }

  // === Private Initializers ===
  private initIsSurveyClosed(): Signal<boolean> {
    return computed(() => {
      const s = this.survey();
      if (!s) return false;
      const displayStatus = getSurveyDisplayStatus(s);
      return displayStatus === SurveyStatus.CLOSED;
    });
  }

  private initIsNpsSurvey(): Signal<boolean> {
    return computed(() => {
      const s = this.survey();
      return s?.is_nps_survey ?? false;
    });
  }

  private initParticipationStats(): Signal<SurveyParticipationStats> {
    return computed(() => {
      const s = this.survey();
      if (!s) {
        return { eligibleParticipants: 0, totalResponses: 0, participationRate: 0 };
      }

      const eligibleParticipants = s.total_recipients || 0;
      const totalResponses = s.total_responses || 0;
      const participationRate = eligibleParticipants > 0 ? Math.round((totalResponses / eligibleParticipants) * 100) : 0;

      return { eligibleParticipants, totalResponses, participationRate };
    });
  }

  private initNpsScore(): Signal<number> {
    return computed(() => {
      const s = this.survey();
      if (!s?.is_nps_survey) return 0;

      // Use provided nps_score if available, otherwise calculate from breakdown
      if (s.nps_score !== undefined) {
        return s.nps_score;
      }

      // Calculate from committees if available
      if (s.committees?.length > 0) {
        const totalResponses = s.committees.reduce((sum, c) => sum + c.total_responses, 0);
        if (totalResponses > 0) {
          const weightedNps = s.committees.reduce((sum, c) => sum + c.nps_value * c.total_responses, 0);
          return Math.round(weightedNps / totalResponses);
        }
      }

      return 0;
    });
  }

  private initNpsBreakdown(): Signal<NpsBreakdown | null> {
    return computed(() => {
      const s = this.survey();
      if (!s?.is_nps_survey) return null;

      // Use provided breakdown if available
      if (s.nps_breakdown) {
        return s.nps_breakdown;
      }

      // Calculate from committees if available
      if (s.committees?.length > 0) {
        const breakdown: NpsBreakdown = {
          promoters: s.committees.reduce((sum, c) => sum + c.num_promoters, 0),
          passives: s.committees.reduce((sum, c) => sum + c.num_passives, 0),
          detractors: s.committees.reduce((sum, c) => sum + c.num_detractors, 0),
          nonResponses: Math.max(0, s.total_recipients - s.total_responses),
        };
        return breakdown;
      }

      return null;
    });
  }

  private initGroupName(): Signal<string> {
    return computed(() => {
      const s = this.survey();
      return s?.committees?.[0]?.committee_name || 'Unknown';
    });
  }

  private initHasComments(): Signal<boolean> {
    return computed(() => {
      const s = this.survey();
      return (s?.additional_comments?.length ?? 0) > 0;
    });
  }

  private initCommentsCount(): Signal<number> {
    return computed(() => {
      const s = this.survey();
      return s?.additional_comments?.length ?? 0;
    });
  }
}
