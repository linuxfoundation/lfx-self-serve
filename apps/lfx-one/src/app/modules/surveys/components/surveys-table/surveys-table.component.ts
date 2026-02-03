// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { SURVEY_LABEL, SURVEY_STATUS_LABELS, SURVEY_TYPE_LABELS, SurveyStatus } from '@lfx-one/shared';
import { Survey } from '@lfx-one/shared/interfaces';
import { RelativeDueDatePipe } from '@pipes/relative-due-date.pipe';
import { SurveyStatusLabelPipe } from '@pipes/survey-status-label.pipe';
import { SurveyStatusSeverityPipe } from '@pipes/survey-status-severity.pipe';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
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
    SurveyStatusLabelPipe,
    SurveyStatusSeverityPipe,
    RelativeDueDatePipe,
    TooltipModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './surveys-table.component.html',
})
export class SurveysTableComponent {
  // === Injections ===
  private readonly confirmationService = inject(ConfirmationService);

  // === Constants ===
  protected readonly surveyLabel = SURVEY_LABEL;
  protected readonly SurveyStatus = SurveyStatus;

  // === Inputs ===
  public readonly surveys = input.required<Survey[]>();
  public readonly hasPMOAccess = input<boolean>(false);
  public readonly loading = input<boolean>(false);

  // === Outputs ===
  public readonly viewResults = output<string>();
  public readonly refresh = output<void>();
  public readonly rowClick = output<Survey>();

  // === Writable Signals ===
  protected readonly isDeleting = signal(false);

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    status: new FormControl<string | null>(null),
    group: new FormControl<string | null>(null),
    surveyType: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  private readonly statusFilter = signal<string | null>(null);
  private readonly groupFilter = signal<string | null>(null);
  private readonly typeFilter = signal<string | null>(null);

  // === Computed Signals ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  protected readonly statusOptions: Signal<{ label: string; value: string | null }[]> = this.initStatusOptions();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly typeOptions: Signal<{ label: string; value: string | null }[]> = this.initTypeOptions();
  protected readonly filteredSurveys: Signal<Survey[]> = this.initFilteredSurveys();

  // === Protected Methods ===
  protected onStatusChange(value: string | null): void {
    this.statusFilter.set(value);
  }

  protected onGroupChange(value: string | null): void {
    this.groupFilter.set(value);
  }

  protected onTypeChange(value: string | null): void {
    this.typeFilter.set(value);
  }

  protected onRowSelect(event: { data: Survey }): void {
    this.rowClick.emit(event.data);
  }

  protected onViewResults(surveyId: string): void {
    this.viewResults.emit(surveyId);
  }

  protected onDeleteSurvey(survey: Survey): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the ${this.surveyLabel.singular.toLowerCase()} "${survey.survey_title}"? This action cannot be undone.`,
      header: `Delete ${this.surveyLabel.singular}`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        this.refresh.emit();
      },
    });
  }

  protected getSurveyTypeLabel(survey: Survey): string {
    return survey.is_nps_survey ? SURVEY_TYPE_LABELS.nps : SURVEY_TYPE_LABELS.standard;
  }

  protected getGroupName(survey: Survey): string {
    return survey.committees?.[0]?.committee_name || 'Unknown';
  }

  protected getResponseTooltip(survey: Survey): string {
    const total = survey.total_recipients || 0;
    const responses = survey.total_responses || 0;
    const percentage = total > 0 ? Math.round((responses / total) * 100) : 0;
    return `${responses} of ${total} responses (${percentage}%)`;
  }

  // === Private Initializers ===
  private initSearchTerm(): Signal<string> {
    return toSignal(
      this.searchForm.get('search')!.valueChanges.pipe(
        startWith(''),
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => value ?? '')
      ),
      { initialValue: '' }
    );
  }

  private initStatusOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const surveysData = this.surveys();
      const statusCounts = new Map<string, number>();

      surveysData.forEach((survey) => {
        statusCounts.set(survey.survey_status, (statusCounts.get(survey.survey_status) || 0) + 1);
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Statuses', value: null }];

      const statusOrder: string[] = [SurveyStatus.SENT, SurveyStatus.OPEN, SurveyStatus.DRAFT, SurveyStatus.SCHEDULED, SurveyStatus.CLOSED];
      statusOrder.forEach((status) => {
        const count = statusCounts.get(status) || 0;
        const shouldShowStatus = count > 0 || (status === SurveyStatus.DRAFT && this.hasPMOAccess());
        if (shouldShowStatus) {
          const label = SURVEY_STATUS_LABELS[status as SurveyStatus] ?? status;
          options.push({
            label: `${label} (${count})`,
            value: status,
          });
        }
      });

      return options;
    });
  }

  private initGroupOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const surveysData = this.surveys();
      const groupCounts = new Map<string, number>();

      surveysData.forEach((survey) => {
        const name = this.getGroupName(survey);
        groupCounts.set(name, (groupCounts.get(name) || 0) + 1);
      });

      const uniqueGroups = Array.from(groupCounts.keys()).sort((a, b) => a.localeCompare(b));

      const options: { label: string; value: string | null }[] = [{ label: 'All Groups', value: null }];

      uniqueGroups.forEach((group) => {
        const count = groupCounts.get(group) || 0;
        options.push({
          label: `${group} (${count})`,
          value: group,
        });
      });

      return options;
    });
  }

  private initTypeOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const surveysData = this.surveys();
      let npsCount = 0;
      let standardCount = 0;

      surveysData.forEach((survey) => {
        if (survey.is_nps_survey) {
          npsCount++;
        } else {
          standardCount++;
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Types', value: null }];

      if (npsCount > 0) {
        options.push({ label: `${SURVEY_TYPE_LABELS.nps} (${npsCount})`, value: 'nps' });
      }
      if (standardCount > 0) {
        options.push({ label: `${SURVEY_TYPE_LABELS.standard} (${standardCount})`, value: 'standard' });
      }

      return options;
    });
  }

  private initFilteredSurveys(): Signal<Survey[]> {
    return computed(() => {
      let filtered = this.surveys();

      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter((survey) => survey.survey_title.toLowerCase().includes(searchTerm));
      }

      const status = this.statusFilter();
      if (status) {
        filtered = filtered.filter((survey) => survey.survey_status === status);
      }

      const group = this.groupFilter();
      if (group) {
        filtered = filtered.filter((survey) => this.getGroupName(survey) === group);
      }

      const type = this.typeFilter();
      if (type) {
        filtered = filtered.filter((survey) => (type === 'nps' ? survey.is_nps_survey : !survey.is_nps_survey));
      }

      return this.sortSurveys(filtered);
    });
  }

  // === Private Helpers ===
  private sortSurveys(surveys: Survey[]): Survey[] {
    const statusPriority: Record<string, number> = {
      [SurveyStatus.SENT]: 1,
      [SurveyStatus.OPEN]: 1,
      [SurveyStatus.DRAFT]: 2,
      [SurveyStatus.SCHEDULED]: 3,
      [SurveyStatus.CLOSED]: 4,
    };

    return [...surveys].sort((a, b) => {
      const statusA = a.survey_status;
      const statusB = b.survey_status;

      if (statusA !== statusB) {
        return (statusPriority[statusA] ?? 5) - (statusPriority[statusB] ?? 5);
      }

      const dateA = a.survey_cutoff_date ? new Date(a.survey_cutoff_date).getTime() : Infinity;
      const dateB = b.survey_cutoff_date ? new Date(b.survey_cutoff_date).getTime() : Infinity;
      return dateA - dateB;
    });
  }
}
