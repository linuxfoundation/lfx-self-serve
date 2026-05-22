// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import type {
  OrgMembershipDetailResponse,
  OrgMembershipKeyContact,
  OrgMembershipKeyContactPerson,
  OrgMembershipDetailPageState,
  MembershipDetailTab,
  EditKeyContactDialogData,
  EditKeyContactDialogResult,
  EditKeyContactRemoveEvent,
  EditKeyContactSubmitEvent,
} from '@lfx-one/shared/interfaces';
import { fragmentToTab } from '@lfx-one/shared/constants';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { catchError, combineLatest, filter, map, of, switchMap, take, tap } from 'rxjs';

import { BoardCommitteeCardComponent } from './components/board-committee-card.component';
import { DocumentationTabComponent } from './components/documentation-tab.component';
import { EditKeyContactModalComponent } from './components/edit-key-contact-modal.component';

@Component({
  selector: 'lfx-org-membership-detail',
  standalone: true,
  imports: [RouterLink, CardComponent, EmptyStateComponent, TooltipModule, ToastModule, BoardCommitteeCardComponent, DocumentationTabComponent],
  providers: [MessageService, DialogService],
  templateUrl: './org-membership-detail.component.html',
})
export class OrgMembershipDetailComponent {
  protected readonly accountContext = inject(AccountContextService);
  private readonly membershipsService = inject(OrgLensMembershipsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  // Two-way sync with URL fragment; switchTab() writes, route.fragment subscription reads back.
  protected readonly activeTab = signal<MembershipDetailTab>(fragmentToTab(this.route.snapshot.fragment));
  protected readonly retryTrigger = signal(0);
  protected readonly fetchLoading = signal(true);
  protected readonly fetchError = signal(false);

  // Local mutable copy of keyContacts so the modal can mutate without triggering a refetch
  protected readonly keyContacts = signal<OrgMembershipKeyContact[]>([]);
  protected readonly foundation = signal<OrgMembershipDetailResponse['foundation']>(null);

  protected readonly tabs = [
    { id: 'key-contacts' as const, label: 'Key Contacts', icon: 'fa-light fa-address-card' },
    { id: 'board' as const, label: 'Board & Committee', icon: 'fa-light fa-users-rectangle' },
    { id: 'docs' as const, label: 'Documentation', icon: 'fa-light fa-file-lines' },
    { id: 'governance' as const, label: 'Governance', icon: 'fa-light fa-layer-group' },
  ];

  private readonly accountId$ = toObservable(computed(() => this.accountContext.selectedAccount()?.accountId));
  // Reactive paramMap stream; re-emits on every :foundationId navigation including same-component reuse.
  private readonly foundationId$ = this.route.paramMap.pipe(map((params) => params.get('foundationId')));
  private readonly retryTrigger$ = toObservable(this.retryTrigger);

  private readonly detail$ = combineLatest([
    this.accountId$.pipe(filter((id): id is string => !!id)),
    this.foundationId$.pipe(filter((id): id is string => !!id)),
    this.retryTrigger$,
  ]).pipe(
    tap(() => {
      this.fetchLoading.set(true);
      this.fetchError.set(false);
    }),
    switchMap(([accountId, foundationId]) =>
      this.membershipsService.getMembershipDetail(accountId, foundationId).pipe(
        catchError(() => {
          this.fetchError.set(true);
          this.fetchLoading.set(false);
          return of(null);
        })
      )
    ),
    tap((response) => {
      this.fetchLoading.set(false);
      if (response) {
        this.foundation.set(response.foundation);
        this.keyContacts.set(response.keyContacts);
      }
    })
  );

  // Subscribe via toSignal so the observable runs (read in template indirectly via pageState/foundation/keyContacts)
  protected readonly detailData = toSignal<OrgMembershipDetailResponse | null>(this.detail$, { initialValue: null });

  protected readonly pageState: Signal<OrgMembershipDetailPageState> = computed(() => this.initPageState());

  protected readonly memberSinceFormatted = computed(() => this.formatDateShort(this.foundation()?.memberSince ?? null));

  public constructor() {
    // React to browser back/forward and externally-changed fragments without
    // triggering a re-fetch. `replaceUrl: true` in switchTab() avoids polluting
    // history when the change originates from a user tab click.
    this.route.fragment.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((fragment) => {
      const next = fragmentToTab(fragment);
      if (next !== this.activeTab()) {
        this.activeTab.set(next);
      }
    });
  }

  protected switchTab(tab: MembershipDetailTab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    // Sync URL fragment. `replaceUrl: true` because tab switches are not navigation
    // events worth a browser-history entry; matches the existing UX precedent for
    // signal-driven tab UIs in this codebase.
    void this.router.navigate([], {
      relativeTo: this.route,
      fragment: tab,
      replaceUrl: true,
      queryParamsHandling: 'preserve',
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
      if (typeof document !== 'undefined') {
        (document.getElementById(`membership-detail-tab-trigger-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  protected onPencilClick(contact: OrgMembershipKeyContact): void {
    const editingPersonId = contact.maxContacts === 1 && contact.people.length === 1 ? contact.people[0].personId : null;

    const ref = this.dialogService.open(EditKeyContactModalComponent, {
      header: 'Edit Key Contact',
      width: '560px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: {
        contact,
        foundationName: this.foundation()?.foundationName ?? '',
        editingPersonId,
      } satisfies EditKeyContactDialogData,
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: EditKeyContactDialogResult) => {
      if (!result) return;
      if (result.kind === 'replace') this.onReplaceSubmit(result.event);
      else if (result.kind === 'add') this.onAddSubmit(result.event);
      else if (result.kind === 'remove') this.onRemoveSubmit(result.event);
    });
  }

  protected onReplaceSubmit(event: EditKeyContactSubmitEvent): void {
    this.keyContacts.update((rows) =>
      rows.map((row) => {
        if (row.contactType !== event.contactType) return row;
        const newPeople = row.people.map((p) => (p.personId === event.editingPersonId ? event.person : p));
        return { ...row, people: newPeople };
      })
    );
    this.messageService.add({
      key: 'key-contact-toast-success-updated',
      severity: 'success',
      summary: 'Key contact updated',
      life: 3000,
    });
  }

  protected onAddSubmit(event: EditKeyContactSubmitEvent): void {
    this.keyContacts.update((rows) =>
      rows.map((row) => {
        if (row.contactType !== event.contactType) return row;
        return { ...row, people: [...row.people, event.person] };
      })
    );
    this.messageService.add({
      key: 'key-contact-toast-success-added',
      severity: 'success',
      summary: 'Key contact added',
      life: 3000,
    });
  }

  protected onRemoveSubmit(event: EditKeyContactRemoveEvent): void {
    let removedPerson: OrgMembershipKeyContactPerson | undefined;
    let originalIndex = -1;
    this.keyContacts.update((rows) =>
      rows.map((row) => {
        if (row.contactType !== event.contactType) return row;
        originalIndex = row.people.findIndex((p) => p.personId === event.personId);
        if (originalIndex === -1) return row;
        removedPerson = row.people[originalIndex];
        return { ...row, people: row.people.filter((p) => p.personId !== event.personId) };
      })
    );

    if (!removedPerson) return;

    // Dismiss any previous undo toast before showing a new one (FR-016g cancellation rule)
    this.messageService.clear('key-contact-toast-remove');

    const personToRestore = removedPerson;
    const contactType = event.contactType;
    const contactTypeLabel = event.contactTypeLabel;
    const insertAtIndex = originalIndex;

    this.messageService.add({
      key: 'key-contact-toast-remove',
      severity: 'success',
      summary: 'Key contact removed',
      detail: `${personToRestore.fullName} is no longer a ${contactTypeLabel}.`,
      life: 5000,
      data: {
        undo: () => {
          this.keyContacts.update((rows) =>
            rows.map((row) => {
              if (row.contactType !== contactType) return row;
              const newPeople = [...row.people];
              newPeople.splice(Math.max(0, Math.min(insertAtIndex, newPeople.length)), 0, personToRestore);
              return { ...row, people: newPeople };
            })
          );
          this.messageService.clear('key-contact-toast-remove');
          this.messageService.add({
            key: 'key-contact-toast-undone',
            severity: 'success',
            summary: 'Removal undone',
            life: 3000,
          });
        },
      },
    });
  }

  private initPageState(): OrgMembershipDetailPageState {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    const data = this.detailData();
    if (!data) return 'loading';
    if (!data.foundation) return 'notFound';
    if (this.keyContacts().length === 0) return 'empty';
    return 'ready';
  }

  private formatDateShort(dateString: string | null): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } catch {
      return dateString;
    }
  }
}
