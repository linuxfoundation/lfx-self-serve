// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, Injector, input, model, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Account, DisplayOrgItem, OrgItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService, OrgRolePersona } from '@services/org-role-grants.service';
import { UserService } from '@services/user.service';
import { OnRenderDirective } from '@shared/directives/on-render.directive';
import { AutoFocus } from 'primeng/autofocus';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';
import { distinctUntilChanged, filter } from 'rxjs';

@Component({
  selector: 'lfx-org-selector',
  imports: [NgClass, ReactiveFormsModule, PopoverModule, InputTextModule, AutoFocus, OnRenderDirective],
  templateUrl: './org-selector.component.html',
  styleUrl: './org-selector.component.scss',
})
export class OrgSelectorComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly userService = inject(UserService);
  /** Captured at construction so the afterNextRender callback below has an explicit DestroyRef + Injector — both `takeUntilDestroyed()` and `toObservable()` call inject() internally and would otherwise throw NG0203 outside the injection context. */
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  public readonly isPanelOpen = model<boolean>(false);
  /** When false the trigger is hidden by the sidebar gate — skip list bootstrap so zero-grants users don't hit /api/nav/org-items. */
  public readonly enabled = input<boolean>(true);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });

  protected readonly panelStyleClass = computed(() =>
    this.userService.impersonating() ? 'org-selector-panel org-selector-panel--with-banner' : 'org-selector-panel'
  );

  protected readonly selectedAccount: Signal<Account> = this.accountContextService.selectedAccount;
  protected readonly selectedAccountUid: Signal<string | null> = computed(() => this.selectedAccount().uid ?? null);

  protected readonly displayName: Signal<string> = computed(() => this.selectedAccount().accountName || 'Select Organization');
  protected readonly displayLogo: Signal<string> = computed(() => this.selectedAccount().logoUrl ?? '');

  protected readonly items: Signal<OrgItem[]> = this.orgNavigationService.items;
  protected readonly loading: Signal<boolean> = this.orgNavigationService.loading;
  protected readonly hasMore: Signal<boolean> = this.orgNavigationService.hasMore;

  protected readonly selectedRolePersona: Signal<OrgRolePersona | null> = computed(() => {
    const uid = this.selectedAccountUid();
    if (!uid) return null;
    if (this.orgRoleGrantsService.writerSet().has(uid)) return 'writer';
    if (this.orgRoleGrantsService.auditorSet().has(uid)) return 'auditor';
    return null;
  });
  protected readonly selectedRoleLabel: Signal<string> = computed(() => this.personaToLabel(this.selectedRolePersona()));
  protected readonly selectedRoleIcon: Signal<string> = computed(() => this.personaToIcon(this.selectedRolePersona()));

  protected readonly displayedItems: Signal<DisplayOrgItem[]> = computed(() => {
    const selectedUid = this.selectedAccountUid();
    const writerSet = this.orgRoleGrantsService.writerSet();
    const auditorSet = this.orgRoleGrantsService.auditorSet();
    return this.items().map((item) => {
      const persona = this.resolvePersona(item.uid, writerSet, auditorSet);
      return {
        item,
        isSelected: !!selectedUid && selectedUid === item.uid,
        roleLabel: this.personaToLabel(persona),
        roleIcon: this.personaToIcon(persona),
      };
    });
  });

  protected readonly autoLoadTriggerIndex: Signal<number> = computed(() => Math.max(0, this.displayedItems().length - 8));

  public constructor() {
    // Server-side search via OrgNavigationService — drop the legacy in-memory filter.
    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((term) => {
      this.orgNavigationService.setSearchTerm(term ?? '');
    });

    // Browser-only: bootstrap when the sidebar visibility gate turns on. An `effect()` registered
    // inside afterNextRender did not reliably re-run when `enabled` flipped false→true, so the list
    // never fetched mock/live data even though the trigger was visible.
    afterNextRender(() => {
      toObservable(this.enabled, { injector: this.injector })
        .pipe(
          distinctUntilChanged(),
          filter((enabled) => enabled),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(() => this.bootstrapOrgList());
    });
  }

  protected selectItem(item: OrgItem, popover: Popover): void {
    const account: Account = {
      // Salesforce-keyed routes (Snowflake, /api/orgs/:accountId/lens/*) require accountId — fall
      // back to an empty string when null so the type contract holds; downstream guards already
      // tolerate empty accountId (see AccountContextService.isValidAccountId).
      accountId: item.accountId ?? '',
      accountName: item.name,
      // Slug and tier are org-specific — never carry over the previously selected org's values.
      // Snowflake enrichment (refreshFromSnowflake) and canonical-record reconciliation populate
      // them when authoritative data arrives; empty defaults match PLACEHOLDER_ACCOUNT semantics.
      accountSlug: '',
      membershipTier: '',
      logoUrl: item.logoUrl ?? null,
      uid: item.uid,
    };
    this.accountContextService.setAccount(account);
    // Spec 020 US4 — fire-and-forget canonical record reconciliation. setAccount has already
    // applied the optimistic update; the canonical fetch patches the snapshot in-place when it
    // arrives. Failures are logged BFF-side and produce no UI toast (FR-020).
    this.accountContextService.refreshCanonicalRecord(account).catch(() => {
      // Errors are already logged inside refreshCanonicalRecord — swallow here so the
      // floating promise doesn't reach the browser console.
    });
    popover.hide();
  }

  protected togglePanel(event: Event, popover: Popover): void {
    popover.toggle(event);
  }

  protected onPopoverShow(): void {
    this.isPanelOpen.set(true);
    // Safety net when bootstrap raced ahead of the visibility gate (enabled was false on first tick).
    if (this.enabled() && this.items().length === 0 && !this.loading()) {
      this.bootstrapOrgList();
    }
  }

  protected onPopoverHide(): void {
    this.isPanelOpen.set(false);
    this.searchControl.setValue('', { emitEvent: true });
  }

  protected loadMore(): void {
    this.orgNavigationService.loadNextPage();
  }

  private bootstrapOrgList(): void {
    const restoredUid = this.accountContextService.selectedAccount().uid ?? null;
    const restoredAccountId = this.accountContextService.getStoredAccountId();
    this.orgNavigationService.resetAndReload(restoredUid, restoredAccountId);
  }

  private resolvePersona(uid: string, writerSet: Set<string>, auditorSet: Set<string>): OrgRolePersona | null {
    if (writerSet.has(uid)) return 'writer';
    if (auditorSet.has(uid)) return 'auditor';
    return null;
  }

  /** Product-naming label for the role persona: writer → "Org Admin Editor", auditor → "Org Admin Viewer". */
  private personaToLabel(persona: OrgRolePersona | null): string {
    if (persona === 'writer') return 'Org Admin Editor';
    if (persona === 'auditor') return 'Org Admin Viewer';
    return '';
  }

  private personaToIcon(persona: OrgRolePersona | null): string {
    if (persona === 'writer') return 'fa-light fa-pen-to-square';
    if (persona === 'auditor') return 'fa-light fa-eye';
    return '';
  }
}
