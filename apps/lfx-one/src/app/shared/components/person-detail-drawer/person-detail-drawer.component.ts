// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, PLATFORM_ID, signal, type Signal } from '@angular/core';
import { ORG_CODE_METRIC_UNIT, ORG_COMMITS_DEFINITION, PERSON_DRAWER_COPIED_RESET_MS } from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeCommitteeMembership,
  PersonDrawerContext,
  PersonDrawerCopiedAddress,
  PersonDrawerEmail,
  PersonDrawerTab,
} from '@lfx-one/shared/interfaces';
import { isMailtoSafeEmail } from '@lfx-one/shared/utils';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { DrawerModule } from 'primeng/drawer';
import { TooltipModule } from 'primeng/tooltip';

/** Shared Org Lens person-detail drawer — opened via PersonDetailDrawerService (LFXV2-2195). */
@Component({
  selector: 'lfx-person-detail-drawer',
  imports: [DatePipe, DecimalPipe, DrawerModule, TooltipModule],
  templateUrl: './person-detail-drawer.component.html',
})
export class PersonDetailDrawerComponent implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly drawer = inject(PersonDetailDrawerService);

  protected readonly tabs: readonly { id: PersonDrawerTab; label: string }[] = [
    { id: 'events', label: 'Events' },
    { id: 'training', label: 'Training' },
    { id: 'code', label: 'Code Contributions' },
    { id: 'governance', label: 'Governance' },
  ];

  protected readonly commitsDefinition = ORG_COMMITS_DEFINITION;
  protected readonly commitUnit = ORG_CODE_METRIC_UNIT.commits;
  protected readonly governanceSeats: Signal<OrgAllEmployeeCommitteeMembership[]> = computed(() => this.initGovernanceSeats());
  protected readonly codeTotals: Signal<{ commits: number; projects: number }> = computed(() => this.initCodeTotals());
  protected readonly companyEmails: Signal<PersonDrawerEmail[]> = computed(() => this.initCompanyEmails());
  private readonly copied = signal<PersonDrawerCopiedAddress | null>(null);
  /**
   * The address just copied, so only its own button shows the confirmation. Cleared on a timer, and
   * scoped to the person and org it was copied under: switching either drops the confirmation at once
   * rather than leaving it to announce the previous person's address under the new one.
   */
  protected readonly copiedEmail: Signal<string | null> = computed(() => this.initCopiedEmail());

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
    const copied: PersonDrawerCopiedAddress = { context: this.drawer.activeContext() as PersonDrawerContext, orgUid: this.drawer.orgUid(), email };
    try {
      await navigator.clipboard.writeText(email);
    } catch (error) {
      // A denied or unavailable clipboard is not worth an error state — the address is selectable in the link.
      console.error('Failed to copy email:', error);
      return;
    }
    // `copiedEmail` already hides a confirmation whose person or org no longer matches, so this is not
    // what makes the stale case correct — it just avoids storing a superseded context and arming a timer
    // for it when the write settles after the drawer has moved on.
    if (!this.isCurrent(copied)) return;
    this.copied.set(copied);
    window.setTimeout(() => {
      if (this.copied() === copied) {
        this.copied.set(null);
      }
    }, PERSON_DRAWER_COPIED_RESET_MS);
  }

  private initCopiedEmail(): string | null {
    const copied = this.copied();
    return copied && this.isCurrent(copied) ? copied.email : null;
  }

  private isCurrent(copied: PersonDrawerCopiedAddress): boolean {
    return copied.context === this.drawer.activeContext() && copied.orgUid === this.drawer.orgUid();
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

  /** The total comes from the server: the per-project counts overlap on mirrored commits, so summing them would double count. */
  private initCodeTotals(): { commits: number; projects: number } {
    const detail = this.drawer.detail();
    if (!detail) {
      return { commits: 0, projects: 0 };
    }
    return { commits: detail.totalCommits, projects: detail.code.length };
  }

  // Addresses arrive on their own request, so they render independently of the activity fetch's loading or error state.
  private initCompanyEmails(): PersonDrawerEmail[] {
    const primary = this.drawer.primaryCompanyEmail();
    return this.drawer.companyEmails().map((email) => ({
      email,
      isPrimary: email === primary,
      href: isMailtoSafeEmail(email) ? `mailto:${email}` : null,
    }));
  }
}
