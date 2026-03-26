// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, model, output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NpsGaugeComponent } from '@components/nps-gauge/nps-gauge.component';
import { SurveyStatus } from '@lfx-one/shared';
import { NpsBreakdown, Survey, SurveyComment, SurveyParticipationStats, SurveyResultsDetail } from '@lfx-one/shared/interfaces';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { SurveyStatusLabelPipe } from '@pipes/survey-status-label.pipe';
import { ProjectContextService } from '@services/project-context.service';
import { SurveyService } from '@services/survey.service';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, finalize, of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-survey-results-drawer',
  imports: [DrawerModule, DatePipe, SurveyStatusLabelPipe, SkeletonModule, NpsGaugeComponent],
  templateUrl: './survey-results-drawer.component.html',
  styleUrl: './survey-results-drawer.component.scss',
})
export class SurveyResultsDrawerComponent {
  // === Services ===
  private readonly surveyService = inject(SurveyService);
  private readonly projectContextService = inject(ProjectContextService);

  // === Inputs ===
  public readonly surveyId = input<string | null>(null);
  public readonly listSurvey = input<Survey | null>(null);
  public readonly hasPMOAccess = input<boolean>(false);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly duplicate = output<string>();
  public readonly closeSurvey = output<string>();

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(false);
  protected readonly showAdminMenu = signal<boolean>(false);

  // === Derived Signals (from API) ===
  protected readonly survey: Signal<Survey | null> = this.initSurvey();

  // === Computed Signals ===
  protected readonly isSurveyClosed: Signal<boolean> = this.initIsSurveyClosed();
  protected readonly isNpsSurvey: Signal<boolean> = this.initIsNpsSurvey();
  protected readonly participationStats: Signal<SurveyParticipationStats> = this.initParticipationStats();
  protected readonly npsScore: Signal<number> = this.initNpsScore();
  protected readonly npsBreakdown: Signal<NpsBreakdown | null> = this.initNpsBreakdown();
  protected readonly groupName: Signal<string> = this.initGroupName();
  protected readonly comments: Signal<SurveyComment[]> = this.initComments();
  protected readonly hasComments: Signal<boolean> = computed(() => this.comments().length > 0);
  protected readonly commentsCount: Signal<number> = computed(() => this.comments().length);

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
    if (s?.uid) {
      this.duplicate.emit(s.uid);
      this.closeAdminMenu();
    }
  }

  protected onCloseSurvey(): void {
    const s = this.survey();
    if (s?.uid) {
      this.closeSurvey.emit(s.uid);
      this.closeAdminMenu();
    }
  }

  protected getBreakdownPercentage(count: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((count / total) * 100);
  }

  // === Private Initializers ===
  private initSurvey(): Signal<Survey | null> {
    return toSignal(
      toObservable(this.surveyId).pipe(
        switchMap((id) => {
          if (!id) {
            this.loading.set(false);
            return of(null);
          }

          this.loading.set(true);
          const listData = this.listSurvey();
          const project = this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation();
          const projectId = project?.uid ?? undefined;

          return this.surveyService.getSurvey(id, projectId).pipe(
            catchError(() => of(listData)),
            finalize(() => this.loading.set(false)),
            startWith(listData)
          );
        })
      ),
      { initialValue: null }
    );
  }

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

      // Use top-level nps_value from detail API if available
      if (s.nps_value !== undefined) {
        return s.nps_value;
      }

      // Fall back: calculate from committees
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

      // Use top-level counts from detail API if available
      if (s.num_promoters !== undefined && s.num_passives !== undefined && s.num_detractors !== undefined) {
        return {
          promoters: s.num_promoters,
          passives: s.num_passives,
          detractors: s.num_detractors,
          nonResponses: Math.max(0, (s.total_recipients || 0) - (s.total_responses || 0)),
        };
      }

      // Fall back: calculate from committees
      if (s.committees?.length > 0) {
        return {
          promoters: s.committees.reduce((sum, c) => sum + c.num_promoters, 0),
          passives: s.committees.reduce((sum, c) => sum + c.num_passives, 0),
          detractors: s.committees.reduce((sum, c) => sum + c.num_detractors, 0),
          nonResponses: Math.max(0, s.total_recipients - s.total_responses),
        };
      }

      return null;
    });
  }

  private initGroupName(): Signal<string> {
    return computed(() => {
      const s = this.survey();
      if (!s) return 'Unknown';

      // For multi-committee surveys, use the category label
      if (s.committees?.length > 1 && s.committee_category) {
        return s.committee_category;
      }

      return s.committees?.[0]?.committee_name || s.committee_category || 'Unknown';
    });
  }

  private initComments(): Signal<SurveyComment[]> {
    return computed(() => {
      const s = this.survey() as SurveyResultsDetail | null;
      return s?.additional_comments ?? [];
    });
  }
}
