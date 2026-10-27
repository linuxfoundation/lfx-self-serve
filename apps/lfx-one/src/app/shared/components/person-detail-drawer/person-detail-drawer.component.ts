// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, PLATFORM_ID, signal, type Signal } from '@angular/core';
import type { OrgAllEmployeeCommitteeMembership, PersonDrawerContext, PersonDrawerTab } from '@lfx-one/shared/interfaces';
import { isMailtoSafeEmail } from '@lfx-one/shared/utils';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { DrawerModule } from 'primeng/drawer';

const COPIED_RESET_MS = 2000;

/** One rendered address line in the drawer header. */
interface PersonDrawerEmail {
  email: string;
  isPrimary: boolean;
  /**
   * Precomputed `mailto:` target, or `null` when the address carries URI delimiters that would turn one
   * recipient into several (or into a header field). Such an address still renders — as plain text, and
   * still copyable — rather than as a link that mails the wrong person.
   */
  href: string | null;
}

/** Which person, at which org, a copy confirmation belongs to. */
interface CopiedAddress {
  context: PersonDrawerContext;
  orgUid: string | null | undefined;
  email: string;
}

/** Shared Org Lens person-detail drawer — opened via PersonDetailDrawerService (LFXV2-2195). */
@Component({
  selector: 'lfx-person-detail-drawer',
  imports: [DatePipe, DecimalPipe, DrawerModule],
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

  protected readonly governanceSeats: Signal<OrgAllEmployeeCommitteeMembership[]> = computed(() => this.initGovernanceSeats());
  protected readonly codeTotals: Signal<{ commits: number; projects: number }> = computed(() => this.initCodeTotals());
  protected readonly companyEmails: Signal<PersonDrawerEmail[]> = computed(() => this.initCompanyEmails());
  private readonly copied = signal<CopiedAddress | null>(null);
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
    const copied: CopiedAddress = { context: this.drawer.activeContext() as PersonDrawerContext, orgUid: this.drawer.orgUid(), email };
    try {
      await navigator.clipboard.writeText(email);
    } catch (error) {
      // A denied or unavailable clipboard is not worth an error state — the address is selectable in the link.
      console.error('Failed to copy email:', error);
      return;
    }
    // The write is async: by the time it settles the drawer may be showing someone else, and that
    // person must not inherit this confirmation.
    if (!this.isCurrent(copied)) return;
    this.copied.set(copied);
    window.setTimeout(() => {
      if (this.copied() === copied) {
        this.copied.set(null);
      }
    }, COPIED_RESET_MS);
  }

  private initCopiedEmail(): string | null {
    const copied = this.copied();
    return copied && this.isCurrent(copied) ? copied.email : null;
  }

  private isCurrent(copied: CopiedAddress): boolean {
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
