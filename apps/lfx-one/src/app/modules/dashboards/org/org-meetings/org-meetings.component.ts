// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import {
  DEFAULT_ORG_MEETINGS_TAB_ID,
  DEMO_PAST_MEETINGS,
  DEMO_PENDING_RSVP_MEETINGS,
  DEMO_UPCOMING_MEETINGS,
  ORG_MEETINGS_KPI_RECURRING_COUNT,
  ORG_MEETINGS_KPI_RECURRING_PROJECTS,
  ORG_MEETINGS_KPI_UPCOMING_COUNT,
  ORG_MEETINGS_PROJECT_OPTIONS,
  ORG_MEETINGS_TABS,
  ORG_MEETINGS_TYPE_OPTIONS,
  VALID_ORG_MEETINGS_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  FilterOption,
  FilterPillOption,
  OrgMeeting,
  OrgMeetingRsvpChangeEvent,
  OrgMeetingsTabId,
  OrgPastMeeting,
  OrgPendingRsvpMeeting,
  StatCardItem,
} from '@lfx-one/shared/interfaces';

import { OrgUpcomingMeetingsComponent } from './components/org-upcoming-meetings/org-upcoming-meetings.component';
import { OrgPastMeetingsComponent } from './components/org-past-meetings/org-past-meetings.component';
import { OrgPendingRsvpMeetingsComponent } from './components/org-pending-rsvp-meetings/org-pending-rsvp-meetings.component';

@Component({
  selector: 'lfx-org-meetings',
  imports: [
    ReactiveFormsModule,
    CardComponent,
    InputTextComponent,
    SelectComponent,
    OrgUpcomingMeetingsComponent,
    OrgPastMeetingsComponent,
    OrgPendingRsvpMeetingsComponent,
  ],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {
  // === Private injections ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // === Template constants ===
  protected readonly tabs = ORG_MEETINGS_TABS;
  protected readonly projectOptions: FilterOption[] = ORG_MEETINGS_PROJECT_OPTIONS;
  protected readonly typeOptions: FilterOption[] = ORG_MEETINGS_TYPE_OPTIONS;

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    project: new FormControl<string | null>(null),
    type: new FormControl<string | null>(null),
  });

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly upcomingMeetings = signal<readonly OrgMeeting[]>(DEMO_UPCOMING_MEETINGS);
  protected readonly pastMeetings = signal<readonly OrgPastMeeting[]>(DEMO_PAST_MEETINGS);
  protected readonly pendingMeetings = signal<readonly OrgPendingRsvpMeeting[]>(DEMO_PENDING_RSVP_MEETINGS);

  // === Computed signals ===
  protected readonly activeTab: Signal<OrgMeetingsTabId> = this.initActiveTab();
  protected readonly tabPillOptions: Signal<FilterPillOption[]> = this.initTabPillOptions();
  protected readonly kpiCards: Signal<StatCardItem[]> = this.initKpiCards();
  protected readonly filterSearch: Signal<string> = this.initFilterSearch();
  protected readonly filterProject: Signal<string | null> = this.initFilterProject();
  protected readonly filterType: Signal<string | null> = this.initFilterType();
  protected readonly filteredUpcoming: Signal<readonly OrgMeeting[]> = this.initFilteredUpcoming();
  protected readonly filteredPast: Signal<readonly OrgPastMeeting[]> = this.initFilteredPast();
  protected readonly filteredPending: Signal<readonly OrgPendingRsvpMeeting[]> = this.initFilteredPending();

  // === Public methods ===
  protected switchTab(tabId: string): void {
    const id = tabId as OrgMeetingsTabId;
    if (id === this.activeTab()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: id === DEFAULT_ORG_MEETINGS_TAB_ID ? null : id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onRsvp(event: OrgMeetingRsvpChangeEvent): void {
    if (event.status === 'yes' || event.status === 'no') {
      this.pendingMeetings.update((meetings) => meetings.filter((m) => m.id !== event.meetingId));
    }
    // 'maybe' keeps the row (still pending)
  }

  // === Private initializers ===
  private initActiveTab(): Signal<OrgMeetingsTabId> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((params) => {
          const tab = params.get('tab') as OrgMeetingsTabId | null;
          return tab && VALID_ORG_MEETINGS_TAB_IDS.has(tab) ? tab : DEFAULT_ORG_MEETINGS_TAB_ID;
        }),
      ),
      { initialValue: DEFAULT_ORG_MEETINGS_TAB_ID },
    );
  }

  private initTabPillOptions(): Signal<FilterPillOption[]> {
    return computed<FilterPillOption[]>(() =>
      ORG_MEETINGS_TABS.map((tab) => {
        const countMap: Record<OrgMeetingsTabId, number> = {
          upcoming: this.upcomingMeetings().length,
          past: this.pastMeetings().length,
          pending: this.pendingMeetings().length,
        };
        return { id: tab.id, label: `${tab.label} (${countMap[tab.id]})` };
      }),
    );
  }

  private initKpiCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => [
      {
        value: String(ORG_MEETINGS_KPI_UPCOMING_COUNT),
        label: 'Upcoming Meetings',
        icon: 'fa-light fa-calendar',
        iconContainerClass: 'bg-blue-100 text-blue-600',
      },
      {
        value: String(ORG_MEETINGS_KPI_RECURRING_COUNT),
        label: `Recurring Series · Across ${ORG_MEETINGS_KPI_RECURRING_PROJECTS} projects`,
        icon: 'fa-light fa-rotate',
        iconContainerClass: 'bg-violet-100 text-violet-600',
      },
    ]);
  }

  private initFilterSearch(): Signal<string> {
    return toSignal(this.filterForm.controls.search.valueChanges, { initialValue: '' });
  }

  private initFilterProject(): Signal<string | null> {
    return toSignal(this.filterForm.controls.project.valueChanges, { initialValue: null });
  }

  private initFilterType(): Signal<string | null> {
    return toSignal(this.filterForm.controls.type.valueChanges, { initialValue: null });
  }

  private initFilteredUpcoming(): Signal<readonly OrgMeeting[]> {
    return computed(() => {
      const search = this.filterSearch().toLowerCase();
      const project = this.filterProject();
      const type = this.filterType();
      return this.upcomingMeetings().filter((m) => {
        const matchesSearch = !search || m.title.toLowerCase().includes(search) || (m.agenda ?? '').toLowerCase().includes(search);
        const matchesProject = !project || m.project === project;
        const matchesType = !type || m.type === type;
        return matchesSearch && matchesProject && matchesType;
      });
    });
  }

  private initFilteredPast(): Signal<readonly OrgPastMeeting[]> {
    return computed(() => {
      const search = this.filterSearch().toLowerCase();
      const project = this.filterProject();
      const type = this.filterType();
      return this.pastMeetings().filter((m) => {
        const matchesSearch = !search || m.title.toLowerCase().includes(search) || (m.agenda ?? '').toLowerCase().includes(search);
        const matchesProject = !project || m.project === project;
        const matchesType = !type || m.type === type;
        return matchesSearch && matchesProject && matchesType;
      });
    });
  }

  private initFilteredPending(): Signal<readonly OrgPendingRsvpMeeting[]> {
    return computed(() => {
      const search = this.filterSearch().toLowerCase();
      const project = this.filterProject();
      const type = this.filterType();
      return this.pendingMeetings().filter((m) => {
        const matchesSearch = !search || m.title.toLowerCase().includes(search) || (m.agenda ?? '').toLowerCase().includes(search);
        const matchesProject = !project || m.project === project;
        const matchesType = !type || m.type === type;
        return matchesSearch && matchesProject && matchesType;
      });
    });
  }
}
