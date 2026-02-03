// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { SURVEY_LABEL } from '@lfx-one/shared';
import { ProjectContext, Survey, SurveyResultsDetail } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { SurveyService } from '@services/survey.service';
import { BehaviorSubject, catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import { SurveyResultsDrawerComponent } from '../components/survey-results-drawer/survey-results-drawer.component';
import { SurveysTableComponent } from '../components/surveys-table/surveys-table.component';

@Component({
  selector: 'lfx-surveys-dashboard',
  imports: [LowerCasePipe, CardComponent, ButtonComponent, SurveysTableComponent, RouterLink, SurveyResultsDrawerComponent],
  templateUrl: './surveys-dashboard.component.html',
  styleUrl: './surveys-dashboard.component.scss',
})
export class SurveysDashboardComponent {
  // === Services ===
  private readonly surveyService = inject(SurveyService);
  private readonly projectContextService = inject(ProjectContextService);

  // === Constants ===
  protected readonly surveyLabel = SURVEY_LABEL.singular;
  protected readonly surveyLabelPlural = SURVEY_LABEL.plural;

  // === Refresh Subject ===
  protected readonly refresh$ = new BehaviorSubject<void>(undefined);

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly hasPMOAccess = signal<boolean>(true);
  protected readonly resultsDrawerVisible = signal<boolean>(false);
  protected readonly selectedSurveyId = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly project: Signal<ProjectContext | null> = this.initProject();
  protected readonly surveys: Signal<Survey[]> = this.initSurveys();
  protected readonly selectedSurvey: Signal<SurveyResultsDetail | null> = this.initSelectedSurvey();

  protected onViewResults(surveyId: string): void {
    this.selectedSurveyId.set(surveyId);
    this.resultsDrawerVisible.set(true);
  }

  protected onRowClick(survey: Survey): void {
    this.onViewResults(survey.id);
  }

  protected refreshSurveys(): void {
    this.loading.set(true);
    this.refresh$.next();
  }

  protected onDuplicateSurvey(surveyId: string): void {
    // TODO: Implement survey duplication when API is available
    console.warn('Survey duplication not yet implemented for:', surveyId);
    this.resultsDrawerVisible.set(false);
  }

  protected onCloseSurvey(surveyId: string): void {
    // TODO: Implement survey close when API is available
    console.warn('Survey close not yet implemented for:', surveyId);
    this.resultsDrawerVisible.set(false);
  }

  // === Private Initializers ===
  private initProject(): Signal<ProjectContext | null> {
    return computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  }

  private initSurveys(): Signal<Survey[]> {
    const project$ = toObservable(this.project);

    return toSignal(
      combineLatest([project$, this.refresh$]).pipe(
        switchMap(([project]) => {
          if (!project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          this.loading.set(true);
          return this.surveyService.getSurveysByProject(project.uid, 100).pipe(
            catchError((error) => {
              console.error('Failed to load surveys:', error);
              return of([]);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initSelectedSurvey(): Signal<SurveyResultsDetail | null> {
    return computed(() => {
      const surveyId = this.selectedSurveyId();
      if (!surveyId) return null;

      const survey = this.surveys().find((s) => s.id === surveyId);
      if (!survey) return null;

      // Convert Survey to SurveyResultsDetail with mock NPS data and comments
      const surveyDetail: SurveyResultsDetail = {
        ...survey,
        // Calculate NPS score from committees if available
        nps_score: this.calculateNpsScore(survey),
        // Calculate NPS breakdown from committees
        nps_breakdown: this.calculateNpsBreakdown(survey),
        // Mock comments for demonstration
        additional_comments: this.getMockComments(survey),
      };

      return surveyDetail;
    });
  }

  // === Private Helpers ===
  private calculateNpsScore(survey: Survey): number | undefined {
    if (!survey.is_nps_survey || !survey.committees?.length) return undefined;

    const totalResponses = survey.committees.reduce((sum, c) => sum + c.total_responses, 0);
    if (totalResponses === 0) return 0;

    const weightedNps = survey.committees.reduce((sum, c) => sum + c.nps_value * c.total_responses, 0);
    return Math.round(weightedNps / totalResponses);
  }

  private calculateNpsBreakdown(survey: Survey): { promoters: number; passives: number; detractors: number; nonResponses: number } | undefined {
    if (!survey.is_nps_survey || !survey.committees?.length) return undefined;

    return {
      promoters: survey.committees.reduce((sum, c) => sum + c.num_promoters, 0),
      passives: survey.committees.reduce((sum, c) => sum + c.num_passives, 0),
      detractors: survey.committees.reduce((sum, c) => sum + c.num_detractors, 0),
      nonResponses: Math.max(0, survey.total_recipients - survey.total_responses),
    };
  }

  private getMockComments(survey: Survey): { id: string; comment: string; submitted_at: string }[] {
    // Return mock comments for demonstration purposes
    // In production, this would come from an API call
    if (survey.total_responses === 0) return [];

    return [
      {
        id: '1',
        comment: 'The project has been incredibly valuable for our organization. The community support is excellent.',
        submitted_at: new Date().toISOString(),
      },
      {
        id: '2',
        comment: 'Documentation could be improved, but overall the project meets our needs well.',
        submitted_at: new Date().toISOString(),
      },
      {
        id: '3',
        comment: 'Great initiative! Looking forward to seeing continued development and new features.',
        submitted_at: new Date().toISOString(),
      },
    ];
  }
}
