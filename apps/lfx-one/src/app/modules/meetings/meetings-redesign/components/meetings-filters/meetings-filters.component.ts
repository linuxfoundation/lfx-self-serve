// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, Signal, signal, viewChild } from '@angular/core';
import { MEETING_TYPE_OPTIONS, MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_RSVP_FILTER_OPTIONS, PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import { FilterOption, MeetingDashboardView, MeetingHomeRow, MeetingsHomeFilters, UiFocusable } from '@lfx-one/shared/interfaces';
import { countAppliedMeetingFilters, getMeetingGroupTypes, getMeetingHomeRowType } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuSeparatorComponent } from '@shared/uikit/menu/menu-separator.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectSlotDirective } from '@shared/uikit/select/select-slot.directive';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';

import { MeetingsHomeFeed } from '../../services/meetings-home-feed';

/**
 * Filters button of the meetings home page, with the applied-filter count, and its popover.
 * @description The popover edits a draft: nothing applies until Apply, and closing it any other way discards the draft. Upcoming has Foundation,
 * Project, Meeting type, RSVP and two switches; Past has Foundation, Project and Meeting type. Foundation and Project options come from the tab's
 * unfiltered rows; Meeting type lists every selectable type. Project has a search field.
 * Foundation shows for board personas and Project for project personas, each only with an option; a foundation narrows Project to its children.
 * Without the Foundation field, Project lists foundations too. A project or foundation's list hides Foundation, Project, RSVP and the switches,
 * and instead has Project (foundations only), Group, Group type and Meeting type, all from the rows.
 */
@Component({
  selector: 'lfx-meetings-filters',
  imports: [
    UiButtonComponent,
    UiBadgeComponent,
    UiSelectComponent,
    UiSelectSlotDirective,
    UiOptionComponent,
    UiSearchInputComponent,
    UiToggleComponent,
    UiMenuSeparatorComponent,
  ],
  templateUrl: './meetings-filters.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
})
export class MeetingsFiltersComponent implements UiFocusable {
  private readonly personaService = inject(PersonaService);
  private readonly projectContext = inject(ProjectContextService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly button = viewChild(UiButtonComponent);
  private readonly phone = injectIsMobileViewport(PHONE_MEDIA_QUERY);
  // A project or foundation's list has no cross-project or RSVP filters.
  protected readonly projectScope = inject(MeetingsHomeFeed, { optional: true })?.scope === 'project';

  public readonly tab = input.required<MeetingDashboardView>();
  /** The tab's rows before search and filters. */
  public readonly rows = input.required<MeetingHomeRow[]>();
  /** Category of each group by committee UID; groups without one take a type read from their name. */
  public readonly groupCategories = input<ReadonlyMap<string, string>>(new Map());

  /** Applied filters; emits only on Apply or Reset Filters. */
  public readonly filters = model.required<MeetingsHomeFilters>();

  protected readonly draft = signal<MeetingsHomeFilters>(MEETINGS_HOME_DEFAULT_FILTERS);
  protected readonly rsvpOptions = MEETINGS_HOME_RSVP_FILTER_OPTIONS;
  protected readonly projectQuery = signal('');
  /** 344px, or the full width of the control on phones. */
  protected readonly panelWidth = signal(344);

  protected readonly appliedCount: Signal<number> = computed(() => countAppliedMeetingFilters(this.filters()));
  protected readonly buttonLabel: Signal<string> = computed(() => (this.appliedCount() ? `Filters, ${this.appliedCount()} applied` : ''));
  protected readonly foundationOptions: Signal<FilterOption<string>[]> = this.initFoundationOptions();
  protected readonly showFoundation: Signal<boolean> = computed(
    () => !this.projectScope && this.personaService.hasBoardRole() && this.foundationOptions().length > 0
  );
  protected readonly projectOptions: Signal<FilterOption<string>[]> = this.initProjectOptions();
  protected readonly showProject: Signal<boolean> = computed(
    () => !this.projectScope && this.personaService.hasProjectRole() && this.projectOptions().length > 0
  );
  protected readonly projectMatches: Signal<FilterOption<string>[]> = this.initProjectMatches();
  protected readonly showScopeProject: Signal<boolean> = computed(() => this.projectScope && this.projectContext.isFoundationContext());
  protected readonly scopeProjectOptions: Signal<FilterOption<string>[]> = computed(() => (this.projectScope ? this.entityOptions(this.rows()) : []));
  protected readonly groupOptions: Signal<FilterOption<string>[]> = this.initGroupOptions();
  protected readonly groupTypeOptions: Signal<FilterOption<string>[]> = this.initGroupTypeOptions();
  protected readonly meetingTypeOptions: Signal<FilterOption<string>[]> = this.initMeetingTypeOptions();
  protected readonly changed: Signal<boolean> = computed(() => !this.sameFilters(this.draft(), this.filters()));
  protected readonly showReset: Signal<boolean> = computed(() => this.appliedCount() > 0 || countAppliedMeetingFilters(this.draft()) > 0);

  public focus(): void {
    this.button()?.focus();
  }

  /** Every open and close of the popover starts from the applied filters, so a closed draft is discarded. */
  protected resetDraft(): void {
    this.draft.set(this.filters());
    this.panelWidth.set(this.phone() ? this.host.nativeElement.offsetWidth : 344);
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

  protected setGroup(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, group: value || null }));
  }

  protected setGroupType(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, groupType: value || null }));
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

  /** Non-foundation projects, only the drafted foundation's children when one is picked; foundations too while Foundation is hidden. */
  private initProjectOptions(): Signal<FilterOption<string>[]> {
    return computed(() => {
      const foundation = this.draft().foundation;
      const withFoundations = !this.showFoundation();
      return this.entityOptions(
        this.rows().filter(
          ({ meeting }) => (withFoundations || !meeting.is_foundation) && (!foundation || (meeting.parent_project_uid === foundation && !meeting.is_foundation))
        )
      );
    });
  }

  private initProjectMatches(): Signal<FilterOption<string>[]> {
    return computed(() => {
      const query = this.projectQuery().trim().toLowerCase();
      return query ? this.projectOptions().filter((option) => option.label.toLowerCase().includes(query)) : this.projectOptions();
    });
  }

  private initGroupOptions(): Signal<FilterOption<string>[]> {
    return computed(() => {
      if (!this.projectScope) return [];
      const groups = new Map<string, string>();
      for (const { meeting } of this.rows()) {
        for (const { uid, name } of meeting.committees ?? []) {
          if (uid && name?.trim() && !groups.has(uid)) groups.set(uid, name.trim());
        }
      }
      return this.sortedOptions(groups);
    });
  }

  private initGroupTypeOptions(): Signal<FilterOption<string>[]> {
    return computed(() => {
      if (!this.projectScope) return [];
      const types = new Set(this.rows().flatMap(({ meeting }) => getMeetingGroupTypes(meeting, this.groupCategories())));
      return [...types].sort((a, b) => a.localeCompare(b)).map((type) => ({ value: type, label: type }));
    });
  }

  /** Every selectable type in the Me lens; the types on the rows in a project lens. */
  private initMeetingTypeOptions(): Signal<FilterOption<string>[]> {
    return computed(() => {
      if (!this.projectScope) return MEETING_TYPE_OPTIONS.map(({ label, value }) => ({ label, value }));
      const types = new Map<string, FilterOption<string>>();
      for (const { meeting } of this.rows()) {
        const type = getMeetingHomeRowType(meeting);
        const value = meeting.meeting_type?.trim() ?? '';
        if (type && !types.has(value.toLowerCase())) types.set(value.toLowerCase(), { value, label: type.label });
      }
      return [...types.values()].sort((a, b) => a.label.localeCompare(b.label));
    });
  }

  private sortedOptions(labels: Map<string, string>): FilterOption<string>[] {
    return [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  private entityOptions(rows: MeetingHomeRow[]): FilterOption<string>[] {
    const entities = new Map<string, string>();
    for (const { meeting } of rows) {
      if (meeting.project_uid && !entities.has(meeting.project_uid)) entities.set(meeting.project_uid, meeting.project_name || meeting.project_uid);
    }
    return this.sortedOptions(entities);
  }

  private sameFilters(a: MeetingsHomeFilters, b: MeetingsHomeFilters): boolean {
    return (Object.keys(MEETINGS_HOME_DEFAULT_FILTERS) as (keyof MeetingsHomeFilters)[]).every((key) => a[key] === b[key]);
  }
}
