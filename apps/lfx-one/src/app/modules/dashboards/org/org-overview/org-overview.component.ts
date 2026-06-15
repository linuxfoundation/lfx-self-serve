// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
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
  private readonly personaService = inject(PersonaService);

  protected readonly selectedAccount = this.accountContextService.selectedAccount;

  protected readonly companyName: Signal<string> = computed(() => this.selectedAccount().accountName || 'Your Organization');

  protected readonly tierLabel: Signal<string | null> = computed(() => this.selectedAccount().membershipTier || null);

  /** Spec 022 — page is "settled" once BOTH dependencies have responded at least once. Prevents FOEC race. */
  protected readonly loaded: Signal<boolean> = computed(() => this.orgNavigationService.loaded() && this.orgRoleGrantsService.loaded());

  /** Spec 022 — true ONLY after the data has settled and the user genuinely has no selectable org. Drives the empty-state render. */
  protected readonly isEmpty: Signal<boolean> = computed(
    () => this.loaded() && this.orgNavigationService.items().length === 0 && !this.selectedAccount().uid && !this.selectedAccount().accountId
  );

  /**
   * True once role grants settle and the caller has no org access. Mirrors the sidebar org-selector
   * visibility gate EXACTLY — direct writer/auditor grants or a persona-seeded account. Inherited-only
   * grants intentionally do NOT count: the selector gate is direct-only, so an inherited-only user never
   * triggers the selector's list fetch. If inherited grants were treated as access here, that user would
   * stay on the loading skeleton forever instead of getting the definitive not-available state.
   *
   * Also waits on personas settling. For users whose org seeds arrive only via the async personas
   * response (empty `auth.organizations` at SSR), role grants can settle empty before personas seed
   * `availableAccounts`; gating on `personaLoaded()` prevents a one-tick flash of the not-available
   * message. Personas always settle, so this never re-introduces an indefinite skeleton.
   */
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () =>
      this.orgRoleGrantsService.loaded() &&
      this.personaService.personaLoaded() &&
      this.orgRoleGrantsService.writerSet().size === 0 &&
      this.orgRoleGrantsService.auditorSet().size === 0 &&
      this.accountContextService.availableAccounts().length === 0
  );
}
