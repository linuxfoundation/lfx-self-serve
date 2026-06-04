// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { SkeletonModule } from 'primeng/skeleton';

import { OrgOverviewFoundationsAndProjectsComponent } from '../components/org-overview-foundations-and-projects/org-overview-foundations-and-projects.component';
import { OrgOverviewInvolvementComponent } from '../components/org-overview-involvement/org-overview-involvement.component';

@Component({
  selector: 'lfx-org-overview',
  imports: [TagComponent, SkeletonModule, OrgOverviewInvolvementComponent, OrgOverviewFoundationsAndProjectsComponent],
  templateUrl: './org-overview.component.html',
})
export class OrgOverviewComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);

  protected readonly selectedAccount = this.accountContextService.selectedAccount;

  protected readonly companyName: Signal<string> = computed(() => this.selectedAccount().accountName || 'Your Organization');

  protected readonly tierLabel: Signal<string | null> = computed(() => this.selectedAccount().membershipTier || null);

  /** Spec 022 — page is "settled" once BOTH dependencies have responded at least once. Prevents FOEC race. */
  protected readonly loaded: Signal<boolean> = computed(() => this.orgNavigationService.loaded() && this.orgRoleGrantsService.loaded());

  /** Spec 022 — true ONLY after the data has settled and the user genuinely has no selectable org. Drives the empty-state render. */
  protected readonly isEmpty: Signal<boolean> = computed(
    () => this.loaded() && this.orgNavigationService.items().length === 0 && !this.selectedAccount().uid && !this.selectedAccount().accountId
  );
}
