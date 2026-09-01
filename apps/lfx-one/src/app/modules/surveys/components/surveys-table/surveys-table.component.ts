// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { SURVEY_LABEL, SURVEY_TYPE_LABELS, SurveyStatus } from '@lfx-one/shared';
import { FilterPillOption, Survey, SurveyTableRow } from '@lfx-one/shared/interfaces';
import { getEntityCommands, getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { DueDateLabelColorPipe } from '@pipes/due-date-label-color.pipe';
import { DueDateLabelPipe } from '@pipes/due-date-label.pipe';
import { ScheduledSendAriaLabelPipe, ScheduledSendTooltipPipe } from '@pipes/scheduled-send-tooltip.pipe';
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
    CardTabsBarComponent,
    TableComponent,
    TagComponent,
    ButtonComponent,
    DatePipe,
    ReactiveFormsModule,
    InputTextComponent,
    SelectComponent,
    SurveyStatusLabelPipe,
    SurveyStatusSeverityPipe,
    DueDateLabelPipe,
    DueDateLabelColorPipe,
    ScheduledSendTooltipPipe,
    ScheduledSendAriaLabelPipe,
    TooltipModule,
    ConfirmDialogModule,
    EmptyStateComponent,
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
  protected readonly statusTabOptions: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'closed', label: 'Closed' },
  ];

  // === Inputs ===
  public readonly surveys = input.required<Survey[]>();
  public readonly hasPMOAccess = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly projectOptions = input<{ label: string; value: string | null }[]>([]);
  public readonly showFoundationFilter = input<boolean>(false);
  public readonly showProjectFilter = input<boolean>(false);
  public readonly isMeLens = input<boolean>(false);
  // Viewed-committee override (committee tab): rows stamp committees[0] by default, but a
  // committee writer's guard fallback must probe the committee they're actually viewing (GH-1569).
  public readonly committeeUid = input<string>('');

  // === Outputs ===
  public readonly viewResults = output<Survey>();
  public readonly refresh = output<void>();
  public readonly rowClick = output<Survey>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();

  // === Forms ===
  public searchForm = new FormGroup({
    search: new FormControl<string>(''),
    group: new FormControl<string | null>(null),
    surveyType: new FormControl<string | null>(null),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  protected readonly isDeleting = signal(false);
  protected readonly statusTab = signal<string>('all');

  // === Computed Signals ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly groupFilter: Signal<string | null> = this.initGroupFilter();
  private readonly typeFilter: Signal<string | null> = this.initTypeFilter();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly typeOptions: Signal<{ label: string; value: string | null }[]> = this.initTypeOptions();
  protected readonly filteredSurveys: Signal<SurveyTableRow[]> = this.initFilteredSurveys();
  protected readonly isFiltered = computed(
    () => this.searchTerm() !== '' || this.statusTab() !== 'all' || this.groupFilter() !== null || this.typeFilter() !== null
  );

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.filteredSurveys().length > 10 ? [10, 25, 50] : undefined));

  // === Protected Methods ===
  protected onFoundationFilterChange(value: string | null): void {
    this.foundationFilterChange.emit(value);
    // Reset project filter when foundation changes
    this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
    this.projectFilterChange.emit(null);
  }

  protected onStatusTabChange(tab: string): void {
    this.statusTab.set(tab);
  }

  protected onRowSelect(event: { data: Survey }): void {
    this.rowClick.emit(event.data);
  }

  protected onViewResults(survey: Survey): void {
    this.viewResults.emit(survey);
  }

  protected resetFilters(): void {
    this.searchForm.reset({ search: '', group: null, surveyType: null, foundationFilter: null, projectFilter: null });
    this.statusTab.set('all');
    this.foundationFilterChange.emit(null);
    this.projectFilterChange.emit(null);
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
    const control = this.searchForm.controls.search;
    return toSignal(
      control.valueChanges.pipe(
        startWith(control.value),
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => value ?? '')
      ),
      { initialValue: control.value ?? '' }
    );
  }

  private initGroupFilter(): Signal<string | null> {
    return this.toFormControlSignal(this.searchForm.controls.group);
  }

  private initTypeFilter(): Signal<string | null> {
    return this.toFormControlSignal(this.searchForm.controls.surveyType);
  }

  private toFormControlSignal<T>(control: AbstractControl<T>): Signal<T> {
    return toSignal(control.valueChanges.pipe(distinctUntilChanged()), { initialValue: control.value });
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

  private initFilteredSurveys(): Signal<SurveyTableRow[]> {
    return computed(() => {
      // Precompute displayStatus once per row so the template, filter, and sort
      // all agree on cutoff/case-normalized status (matches what the badge pipe shows).
      // Also stamp the per-row edit link: canonical commands derive from the SURVEY's owning
      // tier (is_foundation), not the viewer's active lens; unenriched rows (undefined tier)
      // fall back to the flat path, which lensRedirectGuard prefixes (GH-1569).
      let filtered = this.surveys().map((survey) => ({
        ...survey,
        displayStatus: getSurveyDisplayStatus(survey),
        editCommands: getEntityCommands('surveys', survey.uid, survey.is_foundation, 'edit') ?? ['/surveys', survey.uid, 'edit'],
        editQueryParams: this.buildEditQueryParams(survey),
      }));

      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter((survey) => survey.survey_title.toLowerCase().includes(searchTerm));
      }

      const statusTab = this.statusTab();
      if (statusTab !== 'all') {
        if (statusTab === 'open') {
          filtered = filtered.filter((survey) => survey.displayStatus === SurveyStatus.OPEN);
        } else if (statusTab === 'closed') {
          filtered = filtered.filter((survey) => survey.displayStatus === SurveyStatus.CLOSED);
        }
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
  // Mirrors meeting-card's per-row params: the row's own project slug + committee scope, so the
  // edit page opens in the survey's project context even from a context-less list (GH-1569).
  private buildEditQueryParams(survey: Survey): Record<string, string> {
    const params: Record<string, string> = {};
    if (survey.project_slug) params['project'] = survey.project_slug;
    const committeeUid = this.committeeUid() || survey.committees?.[0]?.committee_uid;
    if (committeeUid) params['committee_uid'] = committeeUid;
    return params;
  }

  private sortSurveys<T extends SurveyTableRow>(surveys: T[]): T[] {
    const statusPriority: Record<string, number> = {
      [SurveyStatus.OPEN]: 1,
      [SurveyStatus.DRAFT]: 2,
      [SurveyStatus.SCHEDULED]: 3,
      [SurveyStatus.CLOSED]: 4,
    };

    return [...surveys].sort((a, b) => {
      if (a.displayStatus !== b.displayStatus) {
        return (statusPriority[a.displayStatus] ?? 5) - (statusPriority[b.displayStatus] ?? 5);
      }

      const dateA = a.survey_cutoff_date ? new Date(a.survey_cutoff_date).getTime() : Infinity;
      const dateB = b.survey_cutoff_date ? new Date(b.survey_cutoff_date).getTime() : Infinity;
      return dateA - dateB;
    });
  }
}
