// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, PLATFORM_ID, type Signal } from '@angular/core';
import { ORG_LENS_PRIVATE_RELEASE_FLAG } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeCommitteeMembership, PersonDrawerTab } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { DrawerModule } from 'primeng/drawer';

/** Shared Org Lens person-detail drawer — opened via PersonDetailDrawerService (LFXV2-2195). */
@Component({
  selector: 'lfx-person-detail-drawer',
  imports: [DatePipe, DecimalPipe, DrawerModule],
  templateUrl: './person-detail-drawer.component.html',
})
export class PersonDetailDrawerComponent implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly featureFlagService = inject(FeatureFlagService);
  protected readonly drawer = inject(PersonDetailDrawerService);

  protected readonly tabs: readonly { id: PersonDrawerTab; label: string }[] = [
    { id: 'events', label: 'Events' },
    { id: 'training', label: 'Training' },
    { id: 'code', label: 'Code Contributions' },
    { id: 'governance', label: 'Governance' },
  ];

  protected readonly companyEmailFeatureEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_PRIVATE_RELEASE_FLAG, false);
  protected readonly governanceSeats: Signal<OrgAllEmployeeCommitteeMembership[]> = computed(() => this.initGovernanceSeats());
  protected readonly codeTotals: Signal<{ commits: number; projects: number }> = computed(() => this.initCodeTotals());
  protected readonly companyEmails: Signal<string[]> = computed(() => this.initCompanyEmails());

  /**
   * The address section resolves to exactly one of four outcomes, and an administrator has to be able
   * to tell them apart — this panel exists for troubleshooting identity problems, so an ambiguous
   * empty state sends them down the wrong path.
   *
   * `none` and `notAvailable` are the pair that matters most: "this person holds no company address"
   * is a factual claim about a named individual, and we must not make it on a surface that simply
   * had no identity to look them up with.
   */
  protected readonly companyEmailsFailed: Signal<boolean> = computed(() => this.drawer.emailError());
  protected readonly companyEmailsNotAvailable: Signal<boolean> = computed(() => this.drawer.identityUnavailable());
  protected readonly companyEmailsNoneOnRecord: Signal<boolean> = computed(
    () =>
      !this.drawer.loading() &&
      !this.drawer.emailError() &&
      !this.drawer.identityUnavailable() &&
      // A failed person-detail fetch also yields an empty list. Claiming "none on record" there would
      // state something false about a named individual on the strength of a request that never
      // succeeded, so the detail error has to suppress this state too.
      !this.drawer.error() &&
      this.companyEmails().length === 0
  );

  public ngOnDestroy(): void {
    this.drawer.close();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.drawer.close();
    }
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const current = this.tabs.findIndex((t) => t.id === this.drawer.activeTab());
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.drawer.setTab(this.tabs[next].id);
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById(`person-detail-drawer-tab-${this.tabs[next].id}`)?.focus();
    }
  }

  private initGovernanceSeats(): OrgAllEmployeeCommitteeMembership[] {
    const supplied = this.drawer.activeContext()?.governanceSeats;
    if (supplied) {
      return supplied;
    }
    // detail() (toSignal) keeps the previous person's value while a new fetch is in flight, so
    // return [] when loading/errored — otherwise the template skips its skeleton and shows stale seats.
    if (this.drawer.loading() || this.drawer.error()) {
      return [];
    }
    const detail = this.drawer.detail();
    if (!detail) {
      return [];
    }
    return [...detail.boardSeats, ...detail.committeeSeats];
  }

  private initCodeTotals(): { commits: number; projects: number } {
    const detail = this.drawer.detail();
    if (!detail) {
      return { commits: 0, projects: 0 };
    }
    return {
      commits: detail.code.reduce((sum, row) => sum + row.totalCommits, 0),
      projects: detail.code.length,
    };
  }

  private initCompanyEmails(): string[] {
    if (!this.companyEmailFeatureEnabled() || this.drawer.loading() || this.drawer.error()) {
      return [];
    }
    return this.drawer.companyEmails();
  }
}
