// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, PLATFORM_ID, signal, type Signal } from '@angular/core';
import { ORG_LENS_PRIVATE_RELEASE_FLAG } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeCommitteeMembership, PersonDrawerTab } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { DrawerModule } from 'primeng/drawer';

const COPIED_RESET_MS = 2000;

/** One rendered address line in the drawer header. */
interface PersonDrawerEmail {
  email: string;
  isPrimary: boolean;
  /** Supplied by the opener rather than looked up — the person may have other addresses we cannot see. */
  isContextFallback: boolean;
}

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
  protected readonly companyEmails: Signal<PersonDrawerEmail[]> = computed(() => this.initCompanyEmails());
  /** The address just copied, so only its own button shows the confirmation. Cleared on a timer. */
  protected readonly copiedEmail = signal<string | null>(null);

  // Failed, not-available and none-on-record are distinct states: "no company address" is a claim
  // about a named person and must never be shown when there was no identity to look them up with.
  protected readonly companyEmailsFailed: Signal<boolean> = computed(() => this.drawer.emailError());
  protected readonly companyEmailsNotAvailable: Signal<boolean> = computed(() => this.drawer.identityUnavailable());
  protected readonly companyEmailsNoneOnRecord: Signal<boolean> = computed(() => this.drawer.companyEmailsResolved() && this.companyEmails().length === 0);

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

  protected async onCopyEmail(email: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      await navigator.clipboard.writeText(email);
    } catch (error) {
      // A denied or unavailable clipboard is not worth an error state — the address is selectable in the link.
      console.error('Failed to copy email:', error);
      return;
    }
    this.copiedEmail.set(email);
    window.setTimeout(() => {
      if (this.copiedEmail() === email) {
        this.copiedEmail.set(null);
      }
    }, COPIED_RESET_MS);
  }

  private initGovernanceSeats(): OrgAllEmployeeCommitteeMembership[] {
    const supplied = this.drawer.activeContext()?.governanceSeats;
    if (supplied) {
      return supplied;
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

  /**
   * Addresses arrive on their own request, so they render independently of the activity fetch's loading or
   * error state. Openers with no warehouse identity (Board/Committee groups) have nothing to look up, so the
   * address the opener already holds stands in for the list — it is one known address, not a complete set.
   */
  private initCompanyEmails(): PersonDrawerEmail[] {
    if (!this.companyEmailFeatureEnabled()) {
      return [];
    }
    const primary = this.drawer.primaryCompanyEmail();
    const fetched = this.drawer.companyEmails();
    if (fetched.length) {
      return fetched.map((email) => ({ email, isPrimary: email === primary, isContextFallback: false }));
    }
    if (!this.drawer.identityUnavailable()) {
      return [];
    }
    const contextEmail = (this.drawer.activeContext()?.email ?? '').trim().toLowerCase();
    return contextEmail.includes('@') ? [{ email: contextEmail, isPrimary: false, isContextFallback: true }] : [];
  }
}
