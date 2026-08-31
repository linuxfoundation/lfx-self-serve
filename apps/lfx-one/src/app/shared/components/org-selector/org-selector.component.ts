// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, model, PLATFORM_ID, Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ORG_CATALOGUE_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import { Account, DisplayOrgItem, OrgItem, OrgSelectorRow } from '@lfx-one/shared/interfaces';
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

  /**
   * Cached reference to the document-level keydown listener installed while the popover is open, so
   * `detachKeyboardHandler` can remove exactly the function it attached (removing an anonymous
   * function bound in `attachKeyboardHandler` would be a no-op).
   */
  private keyDownListener: ((event: KeyboardEvent) => void) | null = null;

  /**
   * Companion keyup listener paired with `keyDownListener`. Native buttons fire their `click`
   * event on `keydown` for Enter but on `keyup` for Space (WHATWG HTML §"keyboard activation"),
   * so a Space focus-restore queued on `keydown` runs BEFORE the button's native click, cancels
   * the pending activation, and leaves the panel open on `body`. The Space branch is handled
   * here — after the native click has already fired — instead.
   */
  private keyUpListener: ((event: KeyboardEvent) => void) | null = null;

  /**
   * True from `onPopoverShow` (non-staff branch) until `focusInitialOption` successfully places
   * focus on a row. When the panel opens before the first item batch arrives (`/api/nav/org-items`
   * is async), the initial microtask in `focusInitialOption` sees an empty listbox and no-ops;
   * a `toObservable(items)` subscription set up in the constructor re-runs the focus placement
   * as soon as rows first render, so ArrowDown lands on the caller's active org rather than the
   * first row.
   */
  private pendingInitialFocus = false;

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
      const persona = this.resolvePersona(item.uid, writerSet, auditorSet, inheritedWriterSet, inheritedAuditorSet);
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

  /** Gates the catalogue-search affordance; only staff can reach beyond their own rows. */
  protected readonly isStaff: Signal<boolean> = this.orgRoleGrantsService.isStaff;

  /**
   * A staff caller's list is legitimately empty until the catalogue is queried, and the catalogue is
   * only queried at `ORG_CATALOGUE_SEARCH_MIN_CHARS`. "No organizations found" there reads as a
   * permissions failure rather than an invitation, so prompt instead; the not-found copy is reserved
   * for a search that genuinely matched nothing.
   */
  protected readonly showSearchPrompt: Signal<boolean> = computed(
    () => this.isStaff() && this.orgNavigationService.searchTerm()().trim().length < ORG_CATALOGUE_SEARCH_MIN_CHARS
  );

  /**
   * An outage and a genuine no-match look identical to a caller with nothing assigned, and blaming the
   * search term for an upstream failure sends them off to retype a term that was fine.
   *
   * Claimed only while a catalogue search is actually running: `upstreamFailed` covers any upstream
   * failure, including a role-grants outage and a request that never carried a username, so keying the
   * copy off the flag alone would blame search for failures search had no part in — telling a non-staff
   * caller that search is unavailable when they have no search input at all, and telling a staff caller
   * the same instead of prompting them to search, which still works.
   */
  protected readonly searchFailed: Signal<boolean> = computed(() => this.orgNavigationService.upstreamFailed() && this.isStaff() && !this.showSearchPrompt());

  /**
   * True once the caller has actually run a catalogue search (FR-007/US2.5: sectioning is specified as
   * a consequence of searching). `isAssigned === false` alone is not sufficient: a staff caller's
   * cookie-restored selection is resolved from the catalogue and pinned to the list on load, with no
   * search having run, and would otherwise carry the same flag and falsely trigger sectioning on an
   * unsearched list.
   */
  private readonly searchActive: Signal<boolean> = computed(
    () => this.isStaff() && this.orgNavigationService.searchTerm()().trim().length >= ORG_CATALOGUE_SEARCH_MIN_CHARS
  );

  /**
   * Rows in BFF order (assigned first, then discovered), with a section heading attached to the first
   * row of each group. Sectioning turns on only during an active search, so a non-staff caller, a
   * staff caller who hasn't searched, and a staff caller whose restored pin alone is discovered all
   * keep today's single flat list. Attaching the heading to a row rather than rendering it from a
   * group count is what guarantees a heading can never appear above an empty group.
   */
  protected readonly displayedRows: Signal<OrgSelectorRow[]> = computed(() => {
    const rows = this.displayedItems();
    const searchActive = this.searchActive();
    const sectioned = searchActive && rows.some((row) => row.item.isAssigned === false);
    if (!sectioned) {
      return rows.map((display) => this.toRow(display, null, searchActive));
    }

    let assignedSeen = false;
    let discoveredSeen = false;
    return rows.map((display) => {
      if (display.item.isAssigned === false) {
        const heading = discoveredSeen ? null : 'All organizations';
        discoveredSeen = true;
        return this.toRow(display, heading, searchActive);
      }
      const heading = assignedSeen ? null : 'Your organizations';
      assignedSeen = true;
      return this.toRow(display, heading, searchActive);
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

      // Deferred initial-focus: `onPopoverShow` calls `focusInitialOption` synchronously, but a
      // panel opened during the async bootstrap sees an empty listbox and the microtask no-ops.
      // Re-run once when the first batch of rows renders while the panel is still open.
      toObservable(this.items, { injector: this.injector })
        .pipe(
          filter((rows) => rows.length > 0 && this.pendingInitialFocus && this.isPanelOpen()),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(() => this.focusInitialOption());
    });

    // Second cleanup path for the document-scoped keyDown listener. PrimeNG's popover teardown
    // doesn't emit `onHide` when the host layout destroys while the panel is open, so relying on
    // `onPopoverHide` alone can leak the closure onto `document` and let it intercept keys on the
    // next screen.
    this.destroyRef.onDestroy(() => this.detachKeyboardHandler());
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
    this.attachKeyboardHandler();
    // Non-staff callers land on the currently-selected option so Arrow keys can immediately navigate;
    // staff callers keep the pAutoFocus search input as their entry point per current UX.
    if (!this.isStaff()) {
      this.pendingInitialFocus = true;
      this.focusInitialOption();
    }
  }

  protected onPopoverHide(): void {
    this.isPanelOpen.set(false);
    this.pendingInitialFocus = false;
    this.searchControl.setValue('', { emitEvent: true });
    this.detachKeyboardHandler();
  }

  protected loadMore(): void {
    this.orgNavigationService.loadNextPage();
  }

  /**
   * Keyboard-navigation contract (WAI-ARIA APG combobox / listbox pattern):
   *   - ArrowDown / ArrowUp: move roving focus among role="option" rows
   *   - Home / End: focus first / last row
   *   - Enter: activate the focused row
   *   - Escape: close the popover and return focus to the combobox trigger
   * Runs only while the panel is open; document-scoped so it also catches events fired on the
   * `appendTo="body"` popover panel (which lives outside the component subtree and would not
   * bubble to a host listener).
   */
  private attachKeyboardHandler(): void {
    if (!isPlatformBrowser(this.platformId) || this.keyDownListener || this.keyUpListener) return;
    this.keyDownListener = (event: KeyboardEvent) => this.handleKeyDown(event);
    this.keyUpListener = (event: KeyboardEvent) => this.handleKeyUp(event);
    document.addEventListener('keydown', this.keyDownListener);
    document.addEventListener('keyup', this.keyUpListener);
  }

  private detachKeyboardHandler(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.keyDownListener) {
      document.removeEventListener('keydown', this.keyDownListener);
      this.keyDownListener = null;
    }
    if (this.keyUpListener) {
      document.removeEventListener('keyup', this.keyUpListener);
      this.keyUpListener = null;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isPanelOpen()) return;
    // Ignore events dispatched outside the popover panel and its trigger. The listener is
    // document-scoped so it can catch events fired on the `appendTo="body"` popover DOM (which
    // lives outside this component's subtree), but that scope also picks up keys pressed on
    // unrelated controls while the panel happens to be open — stealing Arrow/Home/End, and
    // breaking caret/text nav in inputs like the staff search field.
    if (!this.isEventInsidePanel(event)) return;

    // Escape always closes the panel — including from the staff search input.
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeAndRestoreFocus();
      return;
    }

    const options = this.listboxOptions();
    if (options.length === 0) return;

    const targetIsOption = event.target instanceof HTMLElement && event.target.getAttribute('role') === 'option';

    // ArrowDown from the search input (or the trigger, if Shift+Tab reopened focus there while
    // the panel is open) drops focus into the first option — the standard combobox+listbox
    // affordance that lets a caller "step into the list" without touching the mouse.
    if (event.key === 'ArrowDown' && !targetIsOption) {
      event.preventDefault();
      this.moveFocusTo(options, 0);
      return;
    }

    // All other option-nav keys only apply when an option is actually focused. Firing them on
    // the staff search input would break its caret navigation (Home/End) and its native Enter
    // handling, and would yank focus off the input mid-typing.
    if (!targetIsOption) return;

    const activeIndex = options.findIndex((el) => el === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveFocusTo(options, activeIndex >= 0 ? Math.min(activeIndex + 1, options.length - 1) : 0);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.moveFocusTo(options, activeIndex > 0 ? activeIndex - 1 : 0);
        return;
      case 'Home':
        event.preventDefault();
        this.moveFocusTo(options, 0);
        return;
      case 'End':
        event.preventDefault();
        this.moveFocusTo(options, options.length - 1);
        return;
      case 'Enter':
        // Native button behavior fires a click on `keydown` for Enter (WHATWG HTML), which
        // invokes `selectItem` and hides the popover. No `preventDefault` / imperative `.click()`
        // here — that combination double-fires under zone.js. The row is about to leave the DOM,
        // so schedule the focus restore in a microtask: it lands after the click has processed
        // and matches Escape's contract (focus returns to the combobox trigger, WAI-ARIA APG).
        queueMicrotask(() => this.triggerRef()?.nativeElement.focus());
        return;
      default:
        // Space is intentionally NOT handled here — native `<button>` activation for Space fires
        // on `keyup`, so any focus-restore queued on `keydown` would run BEFORE the click and
        // cancel the pending activation. See `handleKeyUp`.
        return;
    }
  }

  /**
   * Space is dispatched to a native `<button>` click on keyup — running the focus restore here
   * (rather than on keydown) guarantees the click has already fired and `selectItem` has
   * completed before focus leaves the row.
   */
  private handleKeyUp(event: KeyboardEvent): void {
    if (!this.isPanelOpen()) return;
    if (!this.isEventInsidePanel(event)) return;
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'option') return;
    queueMicrotask(() => this.triggerRef()?.nativeElement.focus());
  }

  /**
   * True when the event target is inside the popover panel or is the combobox trigger. Keeps
   * modifier variants (e.g. Shift+Home) on unrelated inputs from being hijacked while the panel
   * happens to be open; the trigger is included so a caller who Shift+Tabs back to it can still
   * use ArrowDown to open + move focus into the list.
   */
  private isEventInsidePanel(event: KeyboardEvent): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const target = event.target;
    if (!(target instanceof Node)) return false;
    const container = this.popoverRef()?.container as HTMLElement | null | undefined;
    if (container?.contains(target)) return true;
    const trigger = this.triggerRef()?.nativeElement;
    return !!trigger && trigger.contains(target);
  }

  private listboxOptions(): HTMLElement[] {
    if (!isPlatformBrowser(this.platformId)) return [];
    const container = this.popoverRef()?.container as HTMLElement | null | undefined;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  private moveFocusTo(options: HTMLElement[], index: number): void {
    const target = options[index];
    if (!target) return;
    options.forEach((el, i) => el.setAttribute('tabindex', i === index ? '0' : '-1'));
    target.focus();
  }

  private focusInitialOption(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Defer to the next microtask so the panel DOM is laid out and rows have been rendered.
    queueMicrotask(() => {
      const options = this.listboxOptions();
      if (options.length === 0) return;
      const selectedIdx = options.findIndex((el) => el.getAttribute('aria-selected') === 'true');
      this.moveFocusTo(options, selectedIdx >= 0 ? selectedIdx : 0);
      this.pendingInitialFocus = false;
    });
  }

  private closeAndRestoreFocus(): void {
    this.popoverRef()?.hide();
    this.triggerRef()?.nativeElement.focus();
  }

  /**
   * Chip text is resolved here rather than in the template: only discovered rows carry one, because
   * the caller has no other context for what such an organization is to the LF, whereas an assigned
   * row's membership is already implied by the caller administering it.
   */
  private toRow(display: DisplayOrgItem, heading: string | null, searchActive: boolean): OrgSelectorRow {
    // The chip is search-result context (this org's relationship to LF), not a property of the row
    // that should surface before there is a search to explain it — a restored pin is discovered by
    // the same flag with no search behind it.
    if (display.item.isAssigned !== false || !searchActive) {
      return { display, heading, membershipLabel: null, membershipStatus: null };
    }

    return {
      display,
      heading,
      membershipLabel: display.item.isMember ? 'Member' : 'Non-member',
      membershipStatus: display.item.status ?? null,
    };
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
      default:
        return '';
    }
  }

  /** Direct writer → pen (edit); everyone else (direct/inherited viewer + the impossible inherited-writer) → eye. Inherited rows are view-only, so they never get the edit icon. */
  private personaToIcon(persona: OrgRolePersona | null): string {
    if (persona === 'direct-writer') return 'fa-light fa-pen-to-square';
    if (persona === 'direct-auditor' || persona === 'inherited-auditor' || persona === 'inherited-writer') return 'fa-light fa-eye';
    return '';
  }

  /** Inherited-only tooltip text. Empty string for direct rows so PrimeNG hides the tooltip. Per FGA model, only auditor cascades — writer never cascades to children. */
  private personaToTooltip(persona: OrgRolePersona | null, parentName: string): string {
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
