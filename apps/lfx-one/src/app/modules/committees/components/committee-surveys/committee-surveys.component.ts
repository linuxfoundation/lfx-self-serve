// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee, Survey } from '@lfx-one/shared/interfaces';
import { buildCommitteeCreateQueryParams } from '@lfx-one/shared/utils';
import { SurveysTableComponent } from '@app/modules/surveys/components/surveys-table/surveys-table.component';
import { SurveyResultsDrawerComponent } from '@app/modules/surveys/components/survey-results-drawer/survey-results-drawer.component';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { SurveyService } from '@services/survey.service';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, of, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-surveys',
  imports: [ButtonComponent, CardComponent, SurveysTableComponent, SurveyResultsDrawerComponent],
  templateUrl: './committee-surveys.component.html',
  styleUrl: './committee-surveys.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeSurveysComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly lensService = inject(LensService);
  private readonly surveyService = inject(SurveyService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

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
  public createSurveyQueryParams: Signal<Record<string, string>> = this.initCreateSurveyQueryParams();

  /** Checks committee write permission fresh before navigating to the create-survey route.
   * Redirects to the lens-appropriate overview with _notice=surveys if permission has been
   * revoked since the page loaded — consistent with the writerGuard denial flow. */
  public onCreateSurvey(): void {
    const committee = this.committee();
    const overviewPath = this.lensService.activeLens() === 'foundation' ? '/foundation/overview' : '/project/overview';
    const denyParams: Record<string, string> = { _notice: 'surveys' };
    if (committee.project_slug) denyParams['project'] = committee.project_slug;
    const deny = () => void this.router.navigate([overviewPath], { queryParams: denyParams });

    this.committeeService
      .getCommittee(committee.uid)
      .pipe(take(1))
      .subscribe({
        next: (fresh) => {
          if (fresh?.writer !== true) {
            deny();
            return;
          }
          void this.router.navigate(['/surveys', 'create'], { queryParams: this.createSurveyQueryParams() });
        },
        error: () => deny(),
      });
  }

  public viewSurveyResults(survey: Survey): void {
    this.selectedSurveyId.set(survey.uid);
    this.selectedSurvey.set(survey);
    this.resultsDrawerVisible.set(true);
  }

  // Private initializer functions
  private initCreateSurveyQueryParams(): Signal<Record<string, string>> {
    return computed(() => buildCommitteeCreateQueryParams(this.committee()));
  }

  private initSurveys(): Signal<Survey[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        tap(() => this.loading.set(true)),
        switchMap((c) =>
          this.surveyService.getSurveysByCommittee(c.uid, 'last_modified_at.desc').pipe(
            catchError(() => {
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
