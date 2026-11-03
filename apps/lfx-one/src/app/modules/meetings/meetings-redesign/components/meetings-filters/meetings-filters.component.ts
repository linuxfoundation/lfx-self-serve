// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, model, Signal, signal, viewChild } from '@angular/core';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_RSVP_FILTER_OPTIONS } from '@lfx-one/shared/constants';
import { FilterOption, MeetingDashboardView, MeetingHomeRow, MeetingsHomeFilters, UiFocusable } from '@lfx-one/shared/interfaces';
import { countAppliedMeetingFilters } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuSeparatorComponent } from '@shared/uikit/menu/menu-separator.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';

/**
 * Filters button of the meetings home page, with the applied-filter count, and its popover.
 * @description The popover edits a draft: nothing applies until Apply, and closing it any other way discards the draft. Upcoming has Foundation,
 * Project, Meeting type, RSVP and two switches; Past has Foundation, Project and Meeting type. Options come from the tab's unfiltered rows.
 * Foundation shows for board personas and Project for project personas, each only with an option; a foundation narrows Project to its children.
 */
@Component({
  selector: 'lfx-meetings-filters',
  imports: [UiButtonComponent, UiBadgeComponent, UiSelectComponent, UiOptionComponent, UiToggleComponent, UiMenuSeparatorComponent],
  templateUrl: './meetings-filters.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
})
export class MeetingsFiltersComponent implements UiFocusable {
  private readonly personaService = inject(PersonaService);
  private readonly button = viewChild(UiButtonComponent);

  public readonly tab = input.required<MeetingDashboardView>();
  /** The tab's rows before search and filters. */
  public readonly rows = input.required<MeetingHomeRow[]>();

  /** Applied filters; emits only on Apply or Reset Filters. */
  public readonly filters = model.required<MeetingsHomeFilters>();

  protected readonly draft = signal<MeetingsHomeFilters>(MEETINGS_HOME_DEFAULT_FILTERS);
  protected readonly rsvpOptions = MEETINGS_HOME_RSVP_FILTER_OPTIONS;

  protected readonly appliedCount: Signal<number> = computed(() => countAppliedMeetingFilters(this.filters()));
  protected readonly buttonLabel: Signal<string> = computed(() => (this.appliedCount() ? `Filters, ${this.appliedCount()} applied` : ''));
  protected readonly foundationOptions: Signal<FilterOption<string>[]> = this.initFoundationOptions();
  protected readonly projectOptions: Signal<FilterOption<string>[]> = this.initProjectOptions();
  protected readonly showFoundation: Signal<boolean> = computed(() => this.personaService.hasBoardRole() && this.foundationOptions().length > 0);
  protected readonly showProject: Signal<boolean> = computed(() => this.personaService.hasProjectRole() && this.projectOptions().length > 0);
  protected readonly typeOptions: Signal<FilterOption<string>[]> = this.initTypeOptions();
  protected readonly changed: Signal<boolean> = computed(() => !this.sameFilters(this.draft(), this.filters()));
  protected readonly showReset: Signal<boolean> = computed(() => this.appliedCount() > 0 || countAppliedMeetingFilters(this.draft()) > 0);

  public focus(): void {
    this.button()?.focus();
  }

  /** Every open and close of the popover starts from the applied filters, so a closed draft is discarded. */
  protected resetDraft(): void {
    this.draft.set(this.filters());
  }

  /** Clears the drafted project when it is not a child of the new foundation. */
  protected setFoundation(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, foundation: value || null }));
    const project = this.draft().project;
    if (project && !this.projectOptions().some((option) => option.value === project)) {
      this.draft.update((draft) => ({ ...draft, project: null }));
    }
  }

  protected setProject(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, project: value || null }));
  }

  protected setMeetingType(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, meetingType: value || null }));
  }

  protected setRsvp(value: string | null): void {
    const option = this.rsvpOptions.find((item) => item.value === value);
    this.draft.update((draft) => ({ ...draft, rsvp: option?.value ?? 'all' }));
  }

  protected setOrganizedByMe(organizedByMe: boolean): void {
    this.draft.update((draft) => ({ ...draft, organizedByMe }));
  }

  protected setHideDeclined(hideDeclined: boolean): void {
    this.draft.update((draft) => ({ ...draft, hideDeclined }));
  }

  protected apply(close: () => void): void {
    this.filters.set(this.draft());
    close();
  }

  protected reset(close: () => void): void {
    this.filters.set(MEETINGS_HOME_DEFAULT_FILTERS);
    close();
  }

  private initFoundationOptions(): Signal<FilterOption<string>[]> {
    return computed(() => this.entityOptions(this.rows().filter(({ meeting }) => meeting.is_foundation)));
  }

  /** Non-foundation projects, only the drafted foundation's children when one is picked. */
  private initProjectOptions(): Signal<FilterOption<string>[]> {
    return computed(() => {
      const foundation = this.draft().foundation;
      return this.entityOptions(this.rows().filter(({ meeting }) => !meeting.is_foundation && (!foundation || meeting.parent_project_uid === foundation)));
    });
  }

  private entityOptions(rows: MeetingHomeRow[]): FilterOption<string>[] {
    const entities = new Map<string, string>();
    for (const { meeting } of rows) {
      if (meeting.project_uid && !entities.has(meeting.project_uid)) entities.set(meeting.project_uid, meeting.project_name || meeting.project_uid);
    }
    return [...entities].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  private initTypeOptions(): Signal<FilterOption<string>[]> {
    return computed(() =>
      [...new Set(this.rows().flatMap(({ meeting }) => (meeting.meeting_type ? [meeting.meeting_type] : [])))]
        .sort((a, b) => a.localeCompare(b))
        .map((type) => ({ value: type, label: type }))
    );
  }

  private sameFilters(a: MeetingsHomeFilters, b: MeetingsHomeFilters): boolean {
    return (Object.keys(MEETINGS_HOME_DEFAULT_FILTERS) as (keyof MeetingsHomeFilters)[]).every((key) => a[key] === b[key]);
  }
}
