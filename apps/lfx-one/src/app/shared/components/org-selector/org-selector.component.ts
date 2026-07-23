// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, model, PLATFORM_ID, Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Account, DisplayOrgItem, OrgItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService, OrgRolePersona } from '@services/org-role-grants.service';
import { OnRenderDirective } from '@shared/directives/on-render.directive';
import { AutoFocus } from 'primeng/autofocus';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';
import { distinctUntilChanged, filter } from 'rxjs';

@Component({
  selector: 'lfx-org-selector',
  imports: [NgClass, ReactiveFormsModule, PopoverModule, InputTextModule, AutoFocus, TooltipModule, OnRenderDirective],
  templateUrl: './org-selector.component.html',
  styleUrl: './org-selector.component.scss',
})
export class OrgSelectorComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  /** Captured at construction so the afterNextRender callback below has an explicit DestroyRef + Injector — both `takeUntilDestroyed()` and `toObservable()` call inject() internally and would otherwise throw NG0203 outside the injection context. */
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly popoverRef = viewChild<Popover>('popover');
  private readonly triggerRef = viewChild<ElementRef<HTMLElement>>('selectorTrigger');

  public readonly isPanelOpen = model<boolean>(false);
  /** When false the trigger is hidden by the sidebar gate — skip list bootstrap so zero-grants users don't hit /api/nav/org-items. */
  public readonly enabled = input<boolean>(true);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });

  protected readonly panelStyleClass = 'org-selector-panel';

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
    return this.resolvePersona(
      uid,
      this.orgRoleGrantsService.writerSet(),
      this.orgRoleGrantsService.auditorSet(),
      this.orgRoleGrantsService.inheritedWriterSet(),
      this.orgRoleGrantsService.inheritedAuditorSet()
    );
  });
  protected readonly selectedRoleLabel: Signal<string> = computed(() => this.personaToLabel(this.selectedRolePersona()));
  protected readonly selectedRoleIcon: Signal<string> = computed(() => this.personaToIcon(this.selectedRolePersona()));
  protected readonly selectedRoleTooltip: Signal<string> = computed(() => {
    const uid = this.selectedAccountUid();
    const persona = this.selectedRolePersona();
    if (!uid || !persona) return '';
    const parentName = this.orgRoleGrantsService.parentNameByUid().get(uid) ?? '';
    return this.personaToTooltip(persona, parentName);
  });

  protected readonly displayedItems: Signal<DisplayOrgItem[]> = computed(() => {
    const selectedUid = this.selectedAccountUid();
    const writerSet = this.orgRoleGrantsService.writerSet();
    const auditorSet = this.orgRoleGrantsService.auditorSet();
    const inheritedWriterSet = this.orgRoleGrantsService.inheritedWriterSet();
    const inheritedAuditorSet = this.orgRoleGrantsService.inheritedAuditorSet();
    const parentNameByUid = this.orgRoleGrantsService.parentNameByUid();
    return this.items().map((item) => {
      // LFXV2-2750 — foundation-auditor rows are resolved per-search and carry their role source on the row
      // itself (they're absent from the cached grants sets), so the row wins when present.
      const persona = item.roleSource ?? this.resolvePersona(item.uid, writerSet, auditorSet, inheritedWriterSet, inheritedAuditorSet);
      // Prefer the BFF-attached `parentName` on the item (D-006 in-memory join) — fall back to the
      // signal map only if the server response somehow omitted it on a row known to be inherited.
      const parentName = item.parentName ?? parentNameByUid.get(item.uid) ?? '';
      return {
        item,
        isSelected: !!selectedUid && selectedUid === item.uid,
        roleLabel: this.personaToLabel(persona),
        roleIcon: this.personaToIcon(persona),
        roleTooltip: this.personaToTooltip(persona, parentName),
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
      // Spec 002: selection is keyed by `uid`, which now carries the org account id (SFID) — persisted to
      // the cookie + sent to all /api/orgs/:orgUid/lens/* routes. `accountId` carries the same value for
      // display/analytics; the canonical fetch + Snowflake enrichment populate display fields.
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
    this.alignPanelTop();
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

  /**
   * Align the panel's top edge with the selector trigger. Only applies at lg+, where the SCSS sets
   * `position: fixed` (viewport-relative). Below that PrimeNG uses absolute (document-relative)
   * positioning, so a viewport-relative top would mis-place the panel on scroll.
   */
  private alignPanelTop(): void {
    if (!isPlatformBrowser(this.platformId) || !window.matchMedia('(min-width: 1024px)').matches) {
      return;
    }
    const trigger = this.triggerRef()?.nativeElement;
    const container = this.popoverRef()?.container as HTMLElement | null | undefined;
    if (trigger && container) {
      container.style.top = `${Math.round(trigger.getBoundingClientRect().top)}px`;
    }
  }

  private bootstrapOrgList(): void {
    const restoredUid = this.accountContextService.selectedAccount().uid ?? this.accountContextService.getStoredUid();
    this.orgNavigationService.resetAndReload(restoredUid);
  }

  /** Spec 022 — direct sources take precedence over inherited so the Edit Profile gate (FR-011a) stays direct-only. Defense-in-depth alongside the BFF's disjointness merge. */
  private resolvePersona(
    uid: string,
    writerSet: Set<string>,
    auditorSet: Set<string>,
    inheritedWriterSet: Set<string>,
    inheritedAuditorSet: Set<string>
  ): OrgRolePersona | null {
    if (writerSet.has(uid)) return 'direct-writer';
    if (auditorSet.has(uid)) return 'direct-auditor';
    if (inheritedWriterSet.has(uid)) return 'inherited-writer';
    if (inheritedAuditorSet.has(uid)) return 'inherited-auditor';
    return null;
  }

  /** Product-naming label per persona: direct → "Org Admin Editor / Viewer". Inherited rows are always view-only (FGA: writer never cascades), so both inherited variants use the "Viewer (inherited)" label to avoid implying edit capability (Clarifications Q2). */
  private personaToLabel(persona: OrgRolePersona | null): string {
    switch (persona) {
      case 'direct-writer':
        return 'Org Admin Editor';
      case 'direct-auditor':
        return 'Org Admin Viewer';
      // inherited-writer can't occur (FGA prevents writer cascade); kept for type exhaustiveness and
      // labeled as Viewer so the badge never implies edit access if the variant ever surfaces.
      case 'inherited-writer':
      case 'inherited-auditor':
        return 'Org Admin Viewer (inherited)';
      // LFXV2-2750 — view-only member org surfaced via a foundation-level auditor grant.
      case 'foundation-auditor':
        return 'Foundation Auditor';
      default:
        return '';
    }
  }

  /** Direct writer → pen (edit); every viewer variant (direct/inherited auditor, foundation auditor, and the impossible inherited-writer) → eye. View-only rows never get the edit icon. */
  private personaToIcon(persona: OrgRolePersona | null): string {
    if (persona === 'direct-writer') return 'fa-light fa-pen-to-square';
    if (persona === 'direct-auditor' || persona === 'inherited-auditor' || persona === 'inherited-writer' || persona === 'foundation-auditor')
      return 'fa-light fa-eye';
    return '';
  }

  /** Inherited-only tooltip text. Empty string for direct rows so PrimeNG hides the tooltip. Per FGA model, only auditor cascades — writer never cascades to children. */
  private personaToTooltip(persona: OrgRolePersona | null, parentName: string): string {
    // LFXV2-2750 — foundation-auditor rows carry no parent org; disclose the view-only foundation source instead.
    if (persona === 'foundation-auditor') {
      return 'View-only access via foundation membership';
    }
    if (!parentName) return '';
    if (persona === 'inherited-auditor') {
      return `View-only access inherited from ${parentName}`;
    }
    // inherited-writer is kept as a dead branch for type exhaustiveness; FGA model prevents it.
    if (persona === 'inherited-writer') {
      return `View-only access inherited from ${parentName}`;
    }
    return '';
  }
}
