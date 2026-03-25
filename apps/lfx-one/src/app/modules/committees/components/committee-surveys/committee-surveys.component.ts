// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, input, model, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee, Survey } from '@lfx-one/shared/interfaces';
import { SurveysTableComponent } from '@app/modules/surveys/components/surveys-table/surveys-table.component';
import { SurveyResultsDrawerComponent } from '@app/modules/surveys/components/survey-results-drawer/survey-results-drawer.component';
import { SurveyService } from '@services/survey.service';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-surveys',
  imports: [ButtonComponent, CardComponent, SurveysTableComponent, SurveyResultsDrawerComponent],
  templateUrl: './committee-surveys.component.html',
  styleUrl: './committee-surveys.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeSurveysComponent {
  private readonly surveyService = inject(SurveyService);
  private readonly messageService = inject(MessageService);

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
        tap(() => this.loading.set(true)),
        switchMap((c) =>
          this.surveyService.getSurveysByCommittee(c.uid, undefined, 'last_modified_at.desc').pipe(
            catchError((error) => {
              console.error('Failed to load committee surveys:', error);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load surveys. Please try again.',
              });
              return of([]);
            }),
            finalize(() => this.loading.set(false))
          )
        )
      ),
      { initialValue: [] }
    );
  }
}
