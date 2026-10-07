// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { Committee, Survey } from '@lfx-one/shared/interfaces';
import { buildCommitteeCreateQueryParams } from '@lfx-one/shared/utils';
import { SurveysTableComponent } from '@app/modules/surveys/components/surveys-table/surveys-table.component';
import { SurveyResultsDrawerComponent } from '@app/modules/surveys/components/survey-results-drawer/survey-results-drawer.component';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

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
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

  // Inputs — surveys data is pre-fetched and passed from committee-view so the tab badge count is
  // available before the user first opens this tab.
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public surveys = input<Survey[]>([]);
  public surveysLoading = input<boolean>(true);

  // Outputs
  /** Emitted when a survey action changes the list so the parent can re-fetch the tab badge count. */
  public readonly refresh = output<void>();

  // State
  public creating = signal(false);
  public resultsDrawerVisible = model<boolean>(false);
  public selectedSurveyId = signal<string | null>(null);
  public selectedSurvey = signal<Survey | null>(null);

  // Data
  public createSurveyQueryParams: Signal<Record<string, string>> = this.initCreateSurveyQueryParams();

  public viewSurveyResults(survey: Survey): void {
    this.selectedSurveyId.set(survey.uid);
    this.selectedSurvey.set(survey);
    this.resultsDrawerVisible.set(true);
  }

  protected onCreateSurvey(): void {
    const committee = this.committee();
    const overviewPath = this.lensService.activeLens() === 'foundation' ? '/foundation/overview' : '/project/overview';
    const denyParams: Record<string, string> = { _notice: 'surveys' };
    if (committee.project_slug) denyParams['project'] = committee.project_slug;
    const deny = () => void this.router.navigate([overviewPath], { queryParams: denyParams });

    this.creating.set(true);
    this.committeeService
      .fetchCommittee(committee.uid)
      .pipe(finalize(() => this.creating.set(false)))
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

  // Private initializer functions
  private initCreateSurveyQueryParams(): Signal<Record<string, string>> {
    return computed(() => buildCommitteeCreateQueryParams(this.committee()));
  }
}
