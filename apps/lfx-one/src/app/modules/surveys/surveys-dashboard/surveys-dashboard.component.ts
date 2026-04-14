// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { SURVEY_LABEL } from '@lfx-one/shared';
import { ProjectContext, Survey } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
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
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);

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
  protected readonly mySurveysLoading = signal<boolean>(true);
  protected readonly foundationFilter = signal<string | null>(null);
  protected readonly projectFilter = signal<string | null>(null);

  // === Lens ===
  protected readonly isMeLens: Signal<boolean> = computed(() => this.lensService.activeLens() === 'me');
  public showFoundationFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
  public showProjectFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasProjectRole() && this.projectOptions().length > 1);

  // === Computed / toSignal Signals ===
  protected readonly project: Signal<ProjectContext | null> = this.initProject();
  protected readonly surveys: Signal<Survey[]> = this.initSurveys();
  protected readonly selectedListSurvey: Signal<Survey | null> = this.initSelectedListSurvey();
  protected readonly mySurveys: Signal<Survey[]> = this.initMySurveys();
  protected readonly foundationOptions: Signal<{ label: string; value: string }[]> = this.initializeFoundationOptions();
  protected readonly projectOptions: Signal<{ label: string; value: string }[]> = this.initializeProjectOptions();

  protected onViewResults(surveyId: string): void {
    this.selectedSurveyId.set(surveyId);
    this.resultsDrawerVisible.set(true);
  }

  protected onRowClick(survey: Survey): void {
    this.onViewResults(survey.uid);
  }

  protected onFoundationFilterChange(value: string | null): void {
    this.foundationFilter.set(value);
    this.projectFilter.set(null);
  }

  protected onProjectFilterChange(value: string | null): void {
    this.projectFilter.set(value);
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
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([project$, this.refresh$, lens$]).pipe(
        switchMap(([project, , lens]) => {
          if (lens === 'me' || !project?.uid) {
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
      const source = this.isMeLens() ? this.mySurveys() : this.surveys();
      return source.find((s) => s.uid === surveyId) ?? null;
    });
  }

  private initMySurveys(): Signal<Survey[]> {
    const lens$ = toObservable(this.lensService.activeLens);
    const projectFilter$ = toObservable(this.projectFilter);
    const foundationFilter$ = toObservable(this.foundationFilter);

    return toSignal(
      combineLatest([lens$, this.refresh$, projectFilter$, foundationFilter$]).pipe(
        switchMap(([lens, , projectFilter, foundationFilter]) => {
          if (lens !== 'me') {
            this.mySurveysLoading.set(false);
            return of([] as Survey[]);
          }
          this.mySurveysLoading.set(true);
          return this.surveyService.getMySurveys(projectFilter ?? undefined, foundationFilter ?? undefined).pipe(
            catchError(() => {
              this.mySurveysLoading.set(false);
              return of([] as Survey[]);
            }),
            finalize(() => this.mySurveysLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeFoundationOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      return projects.filter((p) => p.isFoundation).map((p) => ({ label: p.projectName ?? p.projectSlug, value: p.projectUid }));
    });
  }

  private initializeProjectOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      const foundation = this.foundationFilter();

      // Filter to non-foundation projects
      let candidates = projects.filter((p) => !p.isFoundation);

      // If a foundation is selected, show only its children
      if (foundation) {
        candidates = candidates.filter((p) => p.parentProjectUid === foundation);
      }

      return candidates.map((p) => ({ label: p.projectName ?? p.projectSlug, value: p.projectUid }));
    });
  }
}
