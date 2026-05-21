// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { AccountContextService } from '@services/account-context.service';

interface PeopleTabConfig {
  readonly id: PeopleTabId;
  readonly label: string;
  readonly icon: string;
  /** Empty-state noun used to complete "...to view {noun}." */
  readonly noun: string;
}

export type PeopleTabId = 'all' | 'board' | 'committee' | 'contacts' | 'contributors' | 'events' | 'training';

const PEOPLE_TABS: readonly PeopleTabConfig[] = [
  { id: 'all', label: 'All Employees', icon: 'fa-light fa-users', noun: 'all employees' },
  { id: 'board', label: 'Board', icon: 'fa-light fa-user-tie', noun: 'board members' },
  { id: 'committee', label: 'Committee', icon: 'fa-light fa-users-rectangle', noun: 'committee members' },
  { id: 'contacts', label: 'Key Contacts', icon: 'fa-light fa-address-card', noun: 'key contacts' },
  { id: 'contributors', label: 'Contributors', icon: 'fa-light fa-code', noun: 'contributors' },
  { id: 'events', label: 'Event Attendees', icon: 'fa-light fa-calendar', noun: 'event attendees' },
  { id: 'training', label: 'Trainees', icon: 'fa-light fa-graduation-cap', noun: 'trainees' },
] as const;

const DEFAULT_TAB: PeopleTabId = 'all';
const VALID_TAB_IDS: ReadonlySet<PeopleTabId> = new Set(PEOPLE_TABS.map((t) => t.id));

@Component({
  selector: 'lfx-org-people',
  imports: [EmptyStateComponent],
  templateUrl: './org-people.component.html',
})
export class OrgPeopleComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);

  protected readonly tabs = PEOPLE_TABS;

  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly activeTab: Signal<PeopleTabId> = computed(() => {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_TAB_IDS.has(raw as PeopleTabId) ? (raw as PeopleTabId) : DEFAULT_TAB;
  });

  protected readonly activeTabConfig: Signal<PeopleTabConfig> = computed(() => PEOPLE_TABS.find((t) => t.id === this.activeTab()) ?? PEOPLE_TABS[0]);

  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName);

  protected readonly hasCompany = computed(() => this.accountContext.selectedAccount().accountId !== '');

  protected readonly heading = computed(() => {
    const name = this.companyName();
    return name ? `People — ${name}` : 'People';
  });

  protected readonly noCompanyEmptyTitle = computed(() => `Select a company via Impersonate to view ${this.activeTabConfig().noun}.`);

  protected switchTab(tabId: PeopleTabId): void {
    if (tabId === this.activeTab()) {
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      // Drop the param when it would equal the default so the URL stays
      // `/org/people` rather than `/org/people?tab=all`.
      queryParams: { tab: tabId === DEFAULT_TAB ? null : tabId },
      queryParamsHandling: 'merge',
    });
  }
}
