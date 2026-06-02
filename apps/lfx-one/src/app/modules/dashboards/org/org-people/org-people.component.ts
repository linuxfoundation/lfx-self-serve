// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { DEFAULT_PEOPLE_TAB_ID, PEOPLE_TABS, VALID_PEOPLE_TAB_IDS } from '@lfx-one/shared/constants';
import { AccountContextService } from '@services/account-context.service';

import type { PeopleTabConfig, PeopleTabId } from '@lfx-one/shared/interfaces';

import { AllEmployeesComponent } from './components/all-employees/all-employees.component';
import { KeyContactsComponent } from './components/key-contacts/key-contacts.component';
import { OrgLensAccessComponent } from './components/org-lens-access/org-lens-access.component';

@Component({
  selector: 'lfx-org-people',
  imports: [EmptyStateComponent, AllEmployeesComponent, KeyContactsComponent, OrgLensAccessComponent],
  templateUrl: './org-people.component.html',
})
export class OrgPeopleComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly tabs = PEOPLE_TABS;

  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly activeTab: Signal<PeopleTabId> = computed(() => this.initActiveTab());

  protected readonly activeTabConfig: Signal<PeopleTabConfig> = computed(() => PEOPLE_TABS.find((t) => t.id === this.activeTab()) ?? PEOPLE_TABS[0]);

  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName);

  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);

  protected readonly heading: Signal<string> = computed(() => this.initHeading());

  protected readonly noCompanyEmptyTitle = computed(() => `Select a company via Impersonate to view ${this.activeTabConfig().noun}.`);

  protected switchTab(tabId: PeopleTabId): void {
    if (tabId === this.activeTab()) {
      return;
    }
    // Tab switches are not navigation events worth a browser-history entry.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_PEOPLE_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs.map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (isPlatformBrowser(this.platformId)) {
        (document.getElementById(`org-people-tab-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  private initActiveTab(): PeopleTabId {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_PEOPLE_TAB_IDS.has(raw as PeopleTabId) ? (raw as PeopleTabId) : DEFAULT_PEOPLE_TAB_ID;
  }

  private initHeading(): string {
    const name = this.companyName();
    return name ? `People — ${name}` : 'People';
  }
}
