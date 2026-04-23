// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMBINED_SURVEY_STATUS_LABELS, MY_ACTIVITY_FILTER_LABELS } from '@lfx-one/shared';
import { CombinedSurveyStatus } from '@lfx-one/shared/constants';
import { UserSurvey } from '@lfx-one/shared/interfaces';
import { getCombinedSurveyStatus } from '@lfx-one/shared/utils';
import { CanTakeSurveyPipe } from '@pipes/can-take-survey.pipe';
import { CombinedSurveyStatusLabelPipe } from '@pipes/combined-survey-status-label.pipe';
import { CombinedSurveyStatusSeverityPipe } from '@pipes/combined-survey-status-severity.pipe';
import { IsDueWithinMonthPipe } from '@pipes/is-due-within-month.pipe';
import { RelativeDueDatePipe } from '@pipes/relative-due-date.pipe';
import { SurveyActionTextPipe } from '@pipes/survey-action-text.pipe';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-surveys-table',
  imports: [
    CardComponent,
    TableComponent,
    TagComponent,
    ButtonComponent,
    DatePipe,
    ReactiveFormsModule,
    InputTextComponent,
    SelectComponent,
    CombinedSurveyStatusLabelPipe,
    CombinedSurveyStatusSeverityPipe,
    CanTakeSurveyPipe,
    SurveyActionTextPipe,
    RelativeDueDatePipe,
    IsDueWithinMonthPipe,
  ],
  templateUrl: './surveys-table.component.html',
})
export class SurveysTableComponent {
  // === Inputs ===
  public readonly surveys = input.required<UserSurvey[]>();

  // === Outputs ===
  public readonly surveyClick = output<UserSurvey>();

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    status: new FormControl<CombinedSurveyStatus | null>(null),
    committee: new FormControl<string | null>(null),
  });

  // === Computed Signals ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly statusFilter: Signal<CombinedSurveyStatus | null> = this.initStatusFilter();
  private readonly committeeFilter: Signal<string | null> = this.initCommitteeFilter();
  protected readonly statusOptions: Signal<{ label: string; value: CombinedSurveyStatus | null }[]> = this.initStatusOptions();
  protected readonly committeeOptions: Signal<{ label: string; value: string | null }[]> = this.initCommitteeOptions();
  protected readonly filteredSurveys: Signal<UserSurvey[]> = this.initFilteredSurveys();

  // === Protected Methods ===
  protected onRowSelect(event: { data: UserSurvey }): void {
    this.onSurveyClick(event.data);
  }

  protected onSurveyClick(survey: UserSurvey): void {
    this.surveyClick.emit(survey);
  }

  // === Private Initializers ===
  private initSearchTerm(): Signal<string> {
    return toSignal(
      this.searchForm.controls.search.valueChanges.pipe(
        startWith(this.searchForm.controls.search.value),
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => value ?? '')
      ),
      { initialValue: '' }
    );
  }

  private initStatusFilter(): Signal<CombinedSurveyStatus | null> {
    const control = this.searchForm.controls.status;
    return toSignal(control.valueChanges.pipe(distinctUntilChanged()), { initialValue: control.value });
  }

  private initCommitteeFilter(): Signal<string | null> {
    const control = this.searchForm.controls.committee;
    return toSignal(control.valueChanges.pipe(distinctUntilChanged()), { initialValue: control.value });
  }

  private initStatusOptions(): Signal<{ label: string; value: CombinedSurveyStatus | null }[]> {
    return computed(() => {
      const surveysData = this.surveys();
      const statusCounts = new Map<CombinedSurveyStatus, number>();

      surveysData.forEach((survey) => {
        const combinedStatus = getCombinedSurveyStatus(survey);
        statusCounts.set(combinedStatus, (statusCounts.get(combinedStatus) || 0) + 1);
      });

      const options: { label: string; value: CombinedSurveyStatus | null }[] = [{ label: MY_ACTIVITY_FILTER_LABELS.allStatus, value: null }];

      const statusOrder: CombinedSurveyStatus[] = ['open', 'submitted', 'closed'];
      statusOrder.forEach((status) => {
        const count = statusCounts.get(status) || 0;
        if (count > 0) {
          options.push({
            label: `${COMBINED_SURVEY_STATUS_LABELS[status]} (${count})`,
            value: status,
          });
        }
      });

      return options;
    });
  }

  private initCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const surveysData = this.surveys();
      const committeeCounts = new Map<string, number>();

      surveysData.forEach((survey) => {
        survey.committees.forEach((committee) => {
          const name = committee.name || committee.uid;
          committeeCounts.set(name, (committeeCounts.get(name) || 0) + 1);
        });
      });

      const uniqueCommittees = Array.from(committeeCounts.keys()).sort((a, b) => a.localeCompare(b));

      const options: { label: string; value: string | null }[] = [{ label: MY_ACTIVITY_FILTER_LABELS.allCommittees, value: null }];

      uniqueCommittees.forEach((committee) => {
        const count = committeeCounts.get(committee) || 0;
        options.push({
          label: `${committee} (${count})`,
          value: committee,
        });
      });

      return options;
    });
  }

  private initFilteredSurveys(): Signal<UserSurvey[]> {
    return computed(() => {
      let filtered = this.surveys();

      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter(
          (survey) =>
            survey.survey_title.toLowerCase().includes(searchTerm) || survey.committees.some((c) => (c.name || c.uid).toLowerCase().includes(searchTerm))
        );
      }

      const status = this.statusFilter();
      if (status) {
        filtered = filtered.filter((survey) => getCombinedSurveyStatus(survey) === status);
      }

      const committee = this.committeeFilter();
      if (committee) {
        filtered = filtered.filter((survey) => survey.committees.some((c) => (c.name || c.uid) === committee));
      }

      return this.sortSurveys(filtered);
    });
  }

  // === Private Helpers ===
  private sortSurveys(surveys: UserSurvey[]): UserSurvey[] {
    const statusPriority: Record<CombinedSurveyStatus, number> = { open: 1, submitted: 2, closed: 3 };

    // Precompute per-row sort keys so the comparator doesn't recompute the
    // combined status (and `new Date()`) on every comparison.
    const decorated = surveys.map((survey) => {
      const parsedCutoff = new Date(survey.survey_cutoff_date).getTime();

      return {
        survey,
        priority: statusPriority[getCombinedSurveyStatus(survey)],
        // Sort is ascending (soonest cutoff first), so push invalid/missing
        // cutoffs to the end with a large finite value to keep ordering deterministic
        // (Infinity sentinels would make `a - b` return NaN when both sides are invalid).
        cutoff: Number.isNaN(parsedCutoff) ? Number.MAX_SAFE_INTEGER : parsedCutoff,
      };
    });

    return decorated
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.cutoff - b.cutoff;
      })
      .map((entry) => entry.survey);
  }
}
