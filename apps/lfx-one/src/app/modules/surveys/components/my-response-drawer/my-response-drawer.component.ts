// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { SurveyStatus } from '@lfx-one/shared/enums';
import { MySurveyResponse, Survey } from '@lfx-one/shared/interfaces';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { SurveyService } from '@services/survey.service';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-my-response-drawer',
  imports: [DrawerModule, DatePipe, SkeletonModule],
  templateUrl: './my-response-drawer.component.html',
  styleUrl: './my-response-drawer.component.scss',
})
export class MyResponseDrawerComponent {
  private readonly surveyService = inject(SurveyService);

  public readonly surveyId = input<string | null>(null);
  public readonly survey = input<Survey | null>(null);
  public readonly visible = model<boolean>(false);

  protected readonly loading = signal<boolean>(false);
  protected readonly response: Signal<MySurveyResponse | null> = this.initResponse();

  // Prefer the survey's is_nps_survey flag, but fall back to inspecting the response
  // payload. Stub survey rows (rendered when the upstream /surveys/{uid} detail fetch
  // fails) default is_nps_survey to false even for genuinely NPS surveys; without this
  // fallback the drawer would mis-render the NPS score as a "no answers" state.
  protected readonly isNps: Signal<boolean> = computed(() => this.survey()?.is_nps_survey === true || this.response()?.nps_value != null);
  protected readonly hasQuestionAnswers: Signal<boolean> = computed(() => (this.response()?.survey_monkey_question_answers?.length ?? 0) > 0);
  protected readonly canUpdate: Signal<boolean> = computed(() => {
    // While the survey is still accepting responses the user may change their answer.
    // Use displayStatus (not raw survey_status) so a survey whose cutoff date has
    // passed is treated as closed even when the upstream survey_status is still
    // 'OPEN'/'SENT'. The personalized survey_link is also required.
    const s = this.survey();
    if (!s) return false;
    if (getSurveyDisplayStatus(s) !== SurveyStatus.OPEN) return false;
    return !!this.response()?.survey_link;
  });

  // True when the drawer is opened for an open-but-unresponded survey. The empty-state
  // copy needs to differ from the closed-survey case ("haven't responded yet" vs
  // "didn't respond before the survey closed").
  protected readonly isOpenUnresponded: Signal<boolean> = computed(() => {
    const s = this.survey();
    return !!s && getSurveyDisplayStatus(s) === SurveyStatus.OPEN;
  });

  // The personalized SurveyMonkey link on the parent Survey (Me-lens-only).
  // Surfaced through a computed so the empty-state template can offer a "Take Survey"
  // CTA when applicable without re-evaluating the access pattern inline.
  protected readonly surveyLink: Signal<string | undefined> = computed(() => this.survey()?.survey_link);

  protected onClose(): void {
    this.visible.set(false);
  }

  private initResponse(): Signal<MySurveyResponse | null> {
    return toSignal(
      toObservable(this.surveyId).pipe(
        switchMap((id) => {
          if (!id) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.surveyService.getMyResponse(id).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: null }
    );
  }
}
