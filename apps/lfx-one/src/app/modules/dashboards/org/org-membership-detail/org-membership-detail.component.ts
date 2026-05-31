// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import type {
  AddKeyContactRequest,
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
import { fragmentToTab, KEY_CONTACT_ROLE_CATALOG } from '@lfx-one/shared/constants';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { catchError, combineLatest, filter, firstValueFrom, map, of, switchMap, take, tap } from 'rxjs';

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
  private readonly roleGrants = inject(OrgRoleGrantsService);
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

  private readonly orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid));
  // Reactive paramMap stream; re-emits on every :foundationSlug navigation including same-component reuse.
  private readonly foundationSlug$ = this.route.paramMap.pipe(map((params) => params.get('foundationSlug')));
  private readonly retryTrigger$ = toObservable(this.retryTrigger);

  private readonly detail$ = combineLatest([
    this.orgUid$.pipe(filter((id): id is string => !!id)),
    this.foundationSlug$.pipe(filter((slug): slug is string => !!slug)),
    this.retryTrigger$,
  ]).pipe(
    tap(() => {
      this.fetchLoading.set(true);
      this.fetchError.set(false);
    }),
    switchMap(([orgUid, foundationSlug]) =>
      this.membershipsService.getMembershipDetail(orgUid, foundationSlug).pipe(
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

  // Spec 024 (FR-027/028): writer-only edit gating (UX). The selected org's uid keys the role-grants
  // writer set. When the uid is unknown we stay permissive — the backend still enforces (Constitution I).
  protected readonly canEdit = computed(() => {
    const uid = this.accountContext.selectedAccount()?.uid;
    if (!uid) return true;
    return this.roleGrants.writerSet().has(uid);
  });

  protected readonly editDisabledTooltip = 'Only admins can edit. To view a list of admins, visit the Access page.';

  // Spec 024 (FR-013): per-role tooltip from the catalog.
  private readonly roleTooltipByType = new Map(KEY_CONTACT_ROLE_CATALOG.map((c) => [c.contactType, c.tooltip]));

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

  protected roleTooltip(contactType: OrgMembershipKeyContact['contactType']): string {
    return this.roleTooltipByType.get(contactType) ?? '';
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
    if (!this.canEdit()) return; // backend also enforces (Constitution I); this is the UX guard.
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
        // Spec 024 (uuid-only): the modal uses this to load the org-wide employee list via the lens
        // endpoint, which is keyed by the org uuid.
        orgUid: this.accountContext.selectedAccount().uid ?? '',
        // Spec 024: the modal stays open and calls this during the pessimistic write. The parent owns
        // the write + table reconcile + toasts so the table is already updated when the modal closes.
        submit: (intent) => this.performWrite(intent),
      } satisfies EditKeyContactDialogData,
    }) as DynamicDialogRef;

    // The write is dispatched via the `submit` callback above; nothing to do on close.
    ref.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => undefined);
  }

  // Spec 024 (FR-017a/020/021): pessimistic persistence. The modal holds open during the write; we call
  // the SSR write proxy and reflect the change only after the backend confirms, reconciling the affected
  // role row from the response. Resolves on success (table already updated + success toast); rejects with
  // Error(message) so the modal shows it inline and stays open for retry.
  private performWrite(intent: Exclude<EditKeyContactDialogResult, null>): Promise<void> {
    if (intent.kind === 'replace') return this.onReplaceSubmit(intent.event);
    if (intent.kind === 'add') return this.onAddSubmit(intent.event);
    return this.onRemoveSubmit(intent.event);
  }

  private onReplaceSubmit(event: EditKeyContactSubmitEvent): Promise<void> {
    const orgUid = this.accountContext.selectedAccount().uid;
    const foundationId = this.foundation()?.foundationId;
    const contactUid = event.editingPersonId;
    if (!orgUid || !foundationId || !contactUid) return Promise.reject(new Error('Could not save changes. Please try again.'));

    return firstValueFrom(this.membershipsService.replaceKeyContact(orgUid, foundationId, contactUid, this.toWriteBody(event)))
      .then((res) => {
        this.reconcileRow(res.contact);
        this.messageService.add({ key: 'key-contact-toast-success-updated', severity: 'success', summary: 'Key contact updated', life: 3000 });
      })
      .catch((err) => {
        throw new Error(this.cleanErrorMessage(err));
      });
  }

  private onAddSubmit(event: EditKeyContactSubmitEvent): Promise<void> {
    const orgUid = this.accountContext.selectedAccount().uid;
    const foundationId = this.foundation()?.foundationId;
    if (!orgUid || !foundationId) return Promise.reject(new Error('Could not save changes. Please try again.'));

    return firstValueFrom(this.membershipsService.addKeyContact(orgUid, foundationId, this.toWriteBody(event)))
      .then((res) => {
        this.reconcileRow(res.contact);
        this.messageService.add({ key: 'key-contact-toast-success-added', severity: 'success', summary: 'Key contact added', life: 3000 });
      })
      .catch((err) => {
        throw new Error(this.cleanErrorMessage(err));
      });
  }

  private onRemoveSubmit(event: EditKeyContactRemoveEvent): Promise<void> {
    const orgUid = this.accountContext.selectedAccount().uid;
    const foundationId = this.foundation()?.foundationId;
    if (!orgUid || !foundationId) return Promise.reject(new Error('Could not save changes. Please try again.'));

    const row = this.keyContacts().find((r) => r.contactType === event.contactType);
    const removedPerson = row?.people.find((p) => p.personId === event.personId);

    return firstValueFrom(this.membershipsService.removeKeyContact(orgUid, foundationId, event.personId))
      .then((res) => {
        this.reconcileRow(res.contact);
        this.showRemoveToast(event, removedPerson ?? null);
      })
      .catch((err) => {
        throw new Error(this.cleanErrorMessage(err));
      });
  }

  private toWriteBody(event: EditKeyContactSubmitEvent): AddKeyContactRequest {
    return {
      contactType: event.contactType,
      email: event.person.email,
      firstName: event.person.firstName,
      lastName: event.person.lastName,
      jobTitle: event.person.jobTitle,
    };
  }

  private reconcileRow(contact: OrgMembershipKeyContact): void {
    this.keyContacts.update((rows) => rows.map((r) => (r.contactType === contact.contactType ? contact : r)));
  }

  private cleanErrorMessage(err: unknown): string {
    return (err as { error?: { error?: { message?: string } } })?.error?.error?.message ?? 'Could not save changes. Please try again.';
  }

  private showRemoveToast(event: EditKeyContactRemoveEvent, removedPerson: OrgMembershipKeyContactPerson | null): void {
    this.messageService.clear('key-contact-toast-remove');
    this.messageService.add({
      key: 'key-contact-toast-remove',
      severity: 'success',
      summary: 'Key contact removed',
      ...(removedPerson ? { detail: `${removedPerson.fullName} is no longer a ${event.contactTypeLabel}.` } : {}),
      life: 4000,
    });
  }

  private initPageState(): OrgMembershipDetailPageState {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    const data = this.detailData();
    if (!data) return 'loading';
    if (!data.foundation) return 'notFound';
    // Spec 024: a present membership always yields the full 9-role catalog (empty roles render inline),
    // so the card-level 'empty' state is unreachable here; 'notFound' covers no-membership.
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
