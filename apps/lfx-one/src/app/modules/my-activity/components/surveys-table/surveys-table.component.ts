// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMBINED_SURVEY_STATUS_LABELS, MY_ACTIVITY_FILTER_LABELS } from '@lfx-one/shared';
import { UserSurvey } from '@lfx-one/shared/interfaces';
import { CombinedSurveyStatus, getCombinedSurveyStatus } from '@lfx-one/shared/utils';
import { CanTakeSurveyPipe } from '@pipes/can-take-survey.pipe';
import { CombinedSurveyStatusLabelPipe } from '@pipes/combined-survey-status-label.pipe';
import { CombinedSurveyStatusSeverityPipe } from '@pipes/combined-survey-status-severity.pipe';
import { IsDueWithinMonthPipe } from '@pipes/is-due-within-month.pipe';
import { RelativeDueDatePipe } from '@pipes/relative-due-date.pipe';
import { SurveyActionTextPipe } from '@pipes/survey-action-text.pipe';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, distinctUntilChanged, startWith } from 'rxjs';

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
    TooltipModule,
  ],
  templateUrl: './surveys-table.component.html',
})
export class SurveysTableComponent {
  public surveys = input.required<UserSurvey[]>();

  public searchForm: FormGroup;
  private readonly searchTerm: Signal<string>;
  private readonly statusFilter = signal<CombinedSurveyStatus | null>(null);
  private readonly committeeFilter = signal<string | null>(null);

  protected readonly statusOptions: Signal<{ label: string; value: CombinedSurveyStatus | null }[]>;
  protected readonly committeeOptions: Signal<{ label: string; value: string | null }[]>;
  protected readonly filteredSurveys: Signal<UserSurvey[]>;

  public constructor() {
    this.searchForm = new FormGroup({
      search: new FormControl<string>(''),
      status: new FormControl<CombinedSurveyStatus | null>(null),
      committee: new FormControl<string | null>(null),
    });

    this.searchTerm = toSignal(this.searchForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), {
      initialValue: '',
    });

    this.statusOptions = computed(() => this.initializeStatusOptions());
    this.committeeOptions = computed(() => this.initializeCommitteeOptions());
    this.filteredSurveys = computed(() => this.filterSurveys());
  }

  protected onStatusChange(value: CombinedSurveyStatus | null): void {
    this.statusFilter.set(value);
  }

  protected onCommitteeChange(value: string | null): void {
    this.committeeFilter.set(value);
  }

  private initializeStatusOptions(): { label: string; value: CombinedSurveyStatus | null }[] {
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
  }

  private initializeCommitteeOptions(): { label: string; value: string | null }[] {
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
  }

  private filterSurveys(): UserSurvey[] {
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
  }

  private sortSurveys(surveys: UserSurvey[]): UserSurvey[] {
    const statusPriority: Record<CombinedSurveyStatus, number> = { open: 1, submitted: 2, closed: 3 };

    return [...surveys].sort((a, b) => {
      const statusA = getCombinedSurveyStatus(a);
      const statusB = getCombinedSurveyStatus(b);

      if (statusA !== statusB) {
        return statusPriority[statusA] - statusPriority[statusB];
      }

      const dateA = new Date(a.survey_cutoff_date).getTime();
      const dateB = new Date(b.survey_cutoff_date).getTime();
      return dateA - dateB;
    });
  }
}
