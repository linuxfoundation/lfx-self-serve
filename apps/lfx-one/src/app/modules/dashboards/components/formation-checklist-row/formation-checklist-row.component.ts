// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import type { FormationItem, FormationItemStatus, FormationRowStatusChange } from '@lfx-one/shared/interfaces';
import {
  FORMATION_GATED_ROW_ACTIONS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
  FORMATION_LINK_ROW_ACTIONS,
} from '@lfx-one/shared/constants';
import { formationItemHasAction, isRelativeInAppPath, isValidUrl } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';

/** Status-menu label/icon per target — one lookup instead of a nested ternary chain. */
const STATUS_MENU_ITEM_DISPLAY: Readonly<Record<FormationItemStatus, { label: string; icon: string }>> = {
  not_started: { label: 'Back to not started', icon: 'fa-light fa-rotate-left' },
  in_progress: { label: 'Mark in progress', icon: 'fa-light fa-spinner' },
  blocked: { label: 'Mark blocked…', icon: 'fa-light fa-hand' },
  done: { label: 'Mark done', icon: 'fa-light fa-check' },
  skipped: { label: 'Skip with reason', icon: 'fa-light fa-forward' },
};

@Component({
  selector: 'lfx-formation-checklist-row',
  imports: [TagComponent, ButtonComponent, MenuComponent, NgTemplateOutlet],
  templateUrl: './formation-checklist-row.component.html',
  styleUrl: './formation-checklist-row.component.scss',
})
export class FormationChecklistRowComponent {
  private readonly userService = inject(UserService);

  public readonly item = input.required<FormationItem>();
  /**
   * True while *any* mutation for this item is in flight — a row action (provisionable/request), a
   * status-menu transition, or a drawer write (Save) started while this item was open in the
   * drawer. Drives the gated action button's `[loading]`, which also blocks re-entry — see
   * `ButtonComponent.handleClick`. Deliberately broad rather than row-action-only: this button must
   * stay non-actionable for the duration of any write against the same item, not just its own.
   */
  public readonly submitting = input<boolean>(false);
  /**
   * GH-2328: true when the parent formation's upstream `lifecycle` isn't `'live'` — suppressed at
   * the row, not just the section, since a section-only banner leaves every row's status menu,
   * overflow menu, and gated action button reachable underneath it. `buildStatusMenuItems()` and
   * `buildOverflowMenuItems()` short-circuit to `[]` and the gated action button is dropped
   * entirely; the external-link/"View details" affordance stays — read-only means no mutations,
   * not no navigation.
   */
  public readonly readOnly = input<boolean>(false);

  public readonly openDrawer = output<FormationItem>();
  /** Fired for the `provisionable`/`request` action kinds only — `manual` opens the drawer instead; the orchestrator owns the actual service call. */
  public readonly actionTriggered = output<FormationItem>();
  /** Status-menu transitions that need no reason (`in_progress`/`done`) — the two real graph targets upstream never requires a `reason` for. */
  public readonly statusChanged = output<FormationRowStatusChange>();
  /** Status-menu "Mark blocked…" / "Skip with reason" / "Back to not started" — each opens `ReasonPromptDialogComponent` first; upstream requires a `reason` for all three. */
  public readonly reasonedStatusRequested = output<{ item: FormationItem; status: FormationItemStatus }>();

  /** Drives `aria-expanded` on the status-chip trigger — set purely via `<lfx-menu>`'s `onShow`/`onHide`, never in the click handler. */
  protected readonly statusMenuOpen = signal<boolean>(false);
  /** Drives `aria-expanded` on the overflow trigger — set purely via `<lfx-menu>`'s `onShow`/`onHide`, never in the click handler. */
  protected readonly overflowMenuOpen = signal<boolean>(false);

  /** `#gatedAction`/`#linkOrDetailsAction` template contexts, keyed by action kind — typed at the definition site (see `FORMATION_GATED_ROW_ACTIONS`/`FORMATION_LINK_ROW_ACTIONS`), not inline in the template where `*ngTemplateOutlet` context is untyped. */
  protected readonly gatedActions = FORMATION_GATED_ROW_ACTIONS;
  protected readonly linkActions = FORMATION_LINK_ROW_ACTIONS;

  protected readonly statusLabel = computed(() => FORMATION_ITEM_STATUS_LABELS[this.item().status]);
  protected readonly statusSeverity = computed(() => FORMATION_ITEM_STATUS_SEVERITY[this.item().status]);
  protected readonly statusOutlined = computed(() => this.item().status === 'not_started');
  /**
   * GH-2576: derived from `available_actions` (replacing the deleted `can_complete` boolean) —
   * item-state gating, advisory rather than a caller-permission check (see `formationItemHasAction`'s
   * doc comment: `available_actions` describes the item, not the caller — it says nothing about
   * whether this caller holds the `team:formation` membership `/status` also requires). Drives the
   * gated row button and every status-menu item below; the real access decision is the gateway's, and
   * a caller who fails it gets a plain 403-and-toast (see the drawer/Pending Actions equivalents).
   */
  protected readonly canMarkDone = computed(() => formationItemHasAction(this.item(), 'mark_done'));
  protected readonly canMarkInProgress = computed(() => formationItemHasAction(this.item(), 'mark_in_progress'));
  protected readonly canSkip = computed(() => formationItemHasAction(this.item(), 'skip'));
  protected readonly canBackToNotStarted = computed(() => formationItemHasAction(this.item(), 'back_to_not_started'));
  protected readonly canMarkBlocked = computed(() => formationItemHasAction(this.item(), 'mark_blocked'));
  /**
   * Gates the row's `provisionable`/`request` action button (`#gatedAction`, template). `request` →
   * `mark_blocked` and `provisionable` → `mark_done` are both confirmed exact, not guessed: GH-2576
   * Phase 2 replaced the old two-step submit-then-accept model with the real three-route contract, so
   * `onAction()` in the parent now calls `updateFormationItemStatus` directly to `blocked`/`done` —
   * there's no more intermediate `awaiting_acceptance` status for `available_actions` to disagree
   * about. `mark_blocked`'s `requires_reason: true` is intentionally not read here or sent by
   * `onAction()`; the quick-action button matches its pre-GH-2576 no-reason behavior, and a reason
   * requirement upstream doesn't get would surface as `blocked_reason_required` for the caller to
   * retry through the status menu's reasoned path instead.
   */
  protected readonly canPerformGatedAction = computed(() => (this.item().action === 'request' ? this.canMarkBlocked() : this.canMarkDone()));
  /**
   * `provisionable`/`request` actions call `updateFormationItemStatus` directly to `done`/`blocked`
   * (`onAction()` in the parent) — restricted to `in_progress` as the only source, matching the
   * quick-action button's pre-GH-2576 behavior (a menu offers every other transition instead).
   */
  protected readonly isActionable = computed(() => !this.readOnly() && this.item().status === 'in_progress');
  /** `status_only` items are updated by external tooling only — the chip must not offer a menu the server will reject (see `buildStatusMenuItems`). GH-2328: a non-live formation offers no status menu either. */
  protected readonly isStatusEditable = computed(() => !this.readOnly() && this.item().action !== 'status_only');
  /** GH-1958 acceptance criteria: surface an "Assigned to you" chip when the viewer is this item's owner. */
  protected readonly isAssignedToViewer = computed(() => {
    const owner = this.item().owner;
    const viewerUsername = this.userService.viewerUsername();
    return !!owner && !!viewerUsername && owner.username === viewerUsername;
  });
  protected readonly subItemsSummary = computed(() => {
    const subItems = this.item().sub_items;
    if (subItems.length === 0) return null;
    const done = subItems.filter((subItem) => subItem.status === 'done').length;
    return `${done} of ${subItems.length} sub-items done`;
  });
  /**
   * `action_href` is API-sourced (fixture today, a real upstream response once #1957 lands) — never
   * trust it into `[href]`/`[routerLink]` unvalidated. Split into external/internal so the template
   * can bind each to the right control: an absolute value still needs scheme validation and opens in
   * a new tab, while a relative in-app path routes through `routerLink` in place instead of a raw
   * anchor. `null` on both means no safe destination — the row falls back to "View details".
   */
  protected readonly safeExternalHref = computed(() => {
    const href = this.item().action_href;
    return href && !isRelativeInAppPath(href) && isValidUrl(href) ? href : null;
  });
  protected readonly safeInternalPath = computed(() => {
    const href = this.item().action_href;
    return href && isRelativeInAppPath(href) ? href : null;
  });

  protected statusMenuItems: MenuItem[] = [];
  protected overflowMenuItems: MenuItem[] = [];

  protected onOpenDrawer(): void {
    this.openDrawer.emit(this.item());
  }

  protected onAction(): void {
    this.actionTriggered.emit(this.item());
  }

  protected toggleStatusMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    this.statusMenuItems = this.buildStatusMenuItems();
    menu.toggle(event);
  }

  protected toggleOverflowMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    this.overflowMenuItems = this.buildOverflowMenuItems();
    menu.toggle(event);
  }

  /**
   * `in_progress`/`done` targets carry no reason and fire `statusChanged` directly; `blocked`/
   * `not_started` targets always require one and route through `reasonedStatusRequested` instead,
   * which opens the reason dialog. `skipped` is offered from the overflow menu, not here, matching
   * the pre-GH-2576 layout.
   */
  private buildStatusMenuItems(): MenuItem[] {
    const item = this.item();
    // GH-2328: a non-live formation offers no status transitions at all — every transition below
    // would 409 (checklist_read_only) at the server.
    if (this.readOnly()) return [];
    // status_only items are updated by external tooling only (see formation.service.ts's
    // updateFormationItemStatus rejection for the same rule enforced server-side) — the status menu
    // must not offer a write the server will reject.
    if (item.action === 'status_only') return [];
    const items: MenuItem[] = [];

    // "Mark in progress" — not_started/blocked/done all reverse via the plain `statusChanged` output
    // (no reason required upstream). GH-2576 (Copilot review): gated on `canMarkInProgress()`
    // unconditionally, not just when reversing a gate decision — consistent with every other menu
    // item here, and defends the case `available_actions` comes back `[]` (malformed/non-mutable
    // lifecycle) even though a live, well-formed response always offers this transition today.
    if (item.status === 'not_started' || item.status === 'blocked' || item.status === 'done') {
      items.push({
        label: STATUS_MENU_ITEM_DISPLAY.in_progress.label,
        icon: STATUS_MENU_ITEM_DISPLAY.in_progress.icon,
        disabled: !this.canMarkInProgress(),
        command: () => this.emitStatusChange(item, 'in_progress'),
      });
    }

    // "Mark done" and "Mark blocked…" only from in_progress — the only source either transition is
    // valid from. GH-2576 (Copilot review): both gated consistently with the rest of this menu.
    if (item.status === 'in_progress') {
      items.push({
        label: STATUS_MENU_ITEM_DISPLAY.done.label,
        icon: STATUS_MENU_ITEM_DISPLAY.done.icon,
        disabled: !this.canMarkDone(),
        command: () => this.emitStatusChange(item, 'done'),
      });
      items.push({
        label: STATUS_MENU_ITEM_DISPLAY.blocked.label,
        icon: STATUS_MENU_ITEM_DISPLAY.blocked.icon,
        disabled: !this.canMarkBlocked(),
        command: () => this.reasonedStatusRequested.emit({ item, status: 'blocked' }),
      });
    }

    // Only skipped→not_started is a valid transition — done can only reverse to in_progress (handled
    // above), never all the way back to not_started. GH-2576 (Copilot review): gated on
    // canBackToNotStarted() for consistency with every other item here. Upstream's
    // `back_to_not_started` carries `requires_reason: true`, so — unlike "Mark in progress" above —
    // this routes through `reasonedStatusRequested`, same as "Mark blocked…".
    if (item.status === 'skipped') {
      items.push({
        label: STATUS_MENU_ITEM_DISPLAY.not_started.label,
        icon: STATUS_MENU_ITEM_DISPLAY.not_started.icon,
        disabled: !this.canBackToNotStarted(),
        command: () => this.reasonedStatusRequested.emit({ item, status: 'not_started' }),
      });
    }

    return items;
  }

  private buildOverflowMenuItems(): MenuItem[] {
    const item = this.item();
    // GH-2328: Assign/Set due date/Skip are all mutations — none are offered on a non-live formation.
    if (this.readOnly()) return [];
    const items: MenuItem[] = [
      { label: 'Assign', icon: 'fa-light fa-user', command: () => this.openDrawer.emit(item) },
      { label: 'Set due date', icon: 'fa-light fa-calendar', command: () => this.openDrawer.emit(item) },
    ];
    // status_only items are updated by external tooling only (see formation.service.ts's
    // updateFormationItemStatus rejection for the same rule enforced server-side) — skip isn't a
    // write the server will accept for this action kind. Gated on canSkip() (available_actions,
    // item-state) rather than a hand-maintained transition table, matching the status menu above.
    if (item.action !== 'status_only') {
      items.push(
        { separator: true },
        {
          label: STATUS_MENU_ITEM_DISPLAY.skipped.label,
          icon: STATUS_MENU_ITEM_DISPLAY.skipped.icon,
          disabled: !this.canSkip(),
          command: () => this.reasonedStatusRequested.emit({ item, status: 'skipped' }),
        }
      );
    }
    return items;
  }

  private emitStatusChange(item: FormationItem, status: Extract<FormationItemStatus, 'in_progress' | 'done'>): void {
    this.statusChanged.emit({ item, status });
  }
}
