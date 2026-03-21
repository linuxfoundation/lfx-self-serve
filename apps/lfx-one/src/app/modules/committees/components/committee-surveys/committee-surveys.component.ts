// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { Committee, Survey } from '@lfx-one/shared/interfaces';
import { SurveysTableComponent } from '@app/modules/surveys/components/surveys-table/surveys-table.component';
import { SurveyResultsDrawerComponent } from '@app/modules/surveys/components/survey-results-drawer/survey-results-drawer.component';
import { SurveyService } from '@services/survey.service';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-surveys',
  imports: [CardComponent, RouteLoadingComponent, SurveysTableComponent, SurveyResultsDrawerComponent],
  templateUrl: './committee-surveys.component.html',
  styleUrl: './committee-surveys.component.scss',
})
export class CommitteeSurveysComponent {
  private readonly surveyService = inject(SurveyService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // State
  public loading = signal<boolean>(true);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedSurveyId = signal<string | null>(null);
  public selectedSurvey = signal<Survey | null>(null);

  // Data
  public surveys: Signal<Survey[]> = this.initSurveys();

  public viewSurveyResults(surveyUid: string): void {
    const survey = this.surveys().find((s) => s.uid === surveyUid) || null;
    this.selectedSurveyId.set(surveyUid);
    this.selectedSurvey.set(survey);
    this.resultsDrawerVisible.set(true);
  }

  // Private initializer functions
  private initSurveys(): Signal<Survey[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) =>
          this.surveyService.getSurveysByCommittee(c.uid, undefined, 'last_modified_at.desc').pipe(
            tap(() => this.loading.set(false)),
            catchError((error) => {
              console.error('Failed to load committee surveys:', error);
              this.loading.set(false);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }
}
