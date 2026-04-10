// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { SURVEY_LABEL } from '@lfx-one/shared';
import { ProjectContext, Survey } from '@lfx-one/shared/interfaces';
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
  protected readonly selectedListSurvey: Signal<Survey | null> = this.initSelectedListSurvey();

  protected onViewResults(surveyId: string): void {
    this.selectedSurveyId.set(surveyId);
    this.resultsDrawerVisible.set(true);
  }

  protected onRowClick(survey: Survey): void {
    this.onViewResults(survey.uid);
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
    return computed(() => this.projectContextService.activeContext());
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

  private initSelectedListSurvey(): Signal<Survey | null> {
    return computed(() => {
      const surveyId = this.selectedSurveyId();
      if (!surveyId) return null;
      return this.surveys().find((s) => s.uid === surveyId) ?? null;
    });
  }
}
