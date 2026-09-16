// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import type { FormationItem, FormationRowStatusChange } from '@lfx-one/shared/interfaces';
import {
  FORMATION_GATED_ROW_ACTIONS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
  FORMATION_LINK_ROW_ACTIONS,
} from '@lfx-one/shared/constants';
import { formationItemHasAction, isRelativeInAppPath, isValidUrl } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';

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
   * skip, a status-menu transition, a completion/accept, or a drawer write (Mark complete/Save)
   * started while this item was open in the drawer. Drives the gated action button's `[loading]`,
   * which also blocks re-entry — see `ButtonComponent.handleClick`. Deliberately broad rather than
   * row-action-only: this button must stay non-actionable for the duration of any write against the
   * same item, not just its own.
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
  /** Status-menu "Mark in progress" / "Back to not started" — the two plain transitions that carry no extra data. */
  public readonly statusChanged = output<FormationRowStatusChange>();
  /** Status-menu "Mark blocked…" — kept separate since the parent opens `ReasonPromptDialogComponent` for an optional note before calling the same status-update endpoint. */
  public readonly blockRequested = output<FormationItem>();
  /** Status-menu "Mark done" — only offered from `in_progress` (see `buildStatusMenuItems`); calls `completeFormationItem`. */
  public readonly completeRequested = output<FormationItem>();
  /** Status-menu "Accept" — only offered from `awaiting_acceptance`; routes through the dedicated accept endpoint instead of `completeFormationItem`, which rejects an already-`awaiting_acceptance` source. */
  public readonly acceptRequested = output<FormationItem>();
  /** Status-menu "Mark in progress" when reversing off `awaiting_acceptance` — upstream requires a mandatory reason for this specific reversal (reject), unlike the plain `statusChanged` transitions or a `done` reversal (reopen, no reason required). */
  public readonly reopenRequested = output<FormationItem>();
  /** Overflow menu "Skip with reason" — the parent already owns this flow (opens `ReasonPromptDialogComponent`) for the drawer's Skip button; reused verbatim here. */
  public readonly skipRequested = output<FormationItem>();

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
  /** "Mark done" relabels to "Accept" once the item is sitting with the formation team and this caller can close it out. */
  protected readonly completeLabel = computed(() => (this.item().status === 'awaiting_acceptance' && this.canMarkDone() ? 'Accept' : 'Mark done'));
  /**
   * GH-2576: derived from `available_actions` (replacing the deleted `can_complete` boolean) —
   * advisory, not a caller-permission check (see `formationItemHasAction`'s doc comment). Drives
   * the gated row button, the status-menu "Mark done"/"Accept" item, and the drawer's equivalent
   * controls.
   */
  protected readonly canMarkDone = computed(() => formationItemHasAction(this.item(), 'mark_done'));
  protected readonly canMarkInProgress = computed(() => formationItemHasAction(this.item(), 'mark_in_progress'));
  protected readonly canSkip = computed(() => formationItemHasAction(this.item(), 'skip'));
  protected readonly canBackToNotStarted = computed(() => formationItemHasAction(this.item(), 'back_to_not_started'));
  /**
   * Gates the row's `provisionable`/`request` action button (`#gatedAction`, template).
   *
   * `request` → `mark_blocked` is verified on the status edge, not a guess: this button only renders
   * for `in_progress` (`isActionable`), `requestFormationItem` PATCHes `{ status: 'blocked' }`, and
   * upstream's `AllowedItemTransitions[in_progress]` always includes `blocked` — so `mark_blocked` is
   * always the action gating that specific transition. One open mismatch this does NOT resolve:
   * upstream's `mark_blocked` entry carries `requires_reason: true` (mirrored on the decoded
   * `FormationItemAvailableAction`, unread here), but `requestFormationItem` sends no reason — a
   * pre-existing gap in that method's own request body, not something this read-side gating change
   * introduces or fixes.
   *
   * `provisionable` → `mark_done` is the best available match, not confirmed the same way:
   * `completeFormationItem` actually PATCHes `{ status: 'awaiting_acceptance' }` first, a status this
   * ticket's GH-2576 investigation found has no upstream equivalent on the currently deployed service
   * (see the docstring on `FormationService.completeFormationItem`) — so there is no live item in
   * that intermediate state to confirm which `available_actions` entry really gates it. `mark_done`
   * is kept as the closest semantic match pending that reconciliation (Phase 2).
   */
  protected readonly canPerformGatedAction = computed(() => (this.item().action === 'request' ? this.canMarkBlocked() : this.canMarkDone()));
  protected readonly canMarkBlocked = computed(() => formationItemHasAction(this.item(), 'mark_blocked'));
  /**
   * `provisionable`/`request` actions call `completeFormationItem`/`requestFormationItem`
   * (`onAction()` in the parent), and both only accept `in_progress` as their source status
   * (`assertPlainTransitionAllowed` in `formation.service.ts`) — offering the button from any
   * other status 400s at the server. Restrict to the one status the call will actually accept;
   * `not_started`/`blocked` items first need "Mark in progress" from the status menu.
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
   * Every offered item here must match a transition `formation.service.ts` will actually accept —
   * see its `allowedPlainTransitions` graph (not_started↔{in_progress,skipped}, in_progress↔{blocked,
   * awaiting_acceptance}, blocked→in_progress, skipped→not_started) plus the separate done/
   * awaiting_acceptance→in_progress reversal (reopen/reject, gate_writer-gated, reject requires a
   * mandatory reason). Offering a transition outside that graph 400s at the server.
   */
  private buildStatusMenuItems(): MenuItem[] {
    const item = this.item();
    // GH-2328: a non-live formation offers no status transitions at all — every transition below
    // would 400 (or, once upstream lands its own read-only check, be rejected there too).
    if (this.readOnly()) return [];
    // status_only items are updated by external tooling only (see formation.service.ts's
    // completeFormationItem/skipFormationItem/updateFormationItemStatus rejection for the same
    // rule enforced server-side) — the status menu must not offer a write the server will reject.
    if (item.action === 'status_only') return [];
    const items: MenuItem[] = [];

    // "Mark in progress" — not_started/blocked/done reverse via the plain `statusChanged` output (the
    // done case still lands on the server's no-reason-required reopen branch); awaiting_acceptance
    // reverses via `reopenRequested` instead, since that specific reversal (reject) requires a reason
    // the plain output has no way to carry. GH-2576 (Copilot review): gated on `canMarkInProgress()`
    // unconditionally, not just when reversing a gate decision — consistent with every other menu
    // item here, and defends the case `available_actions` comes back `[]` (malformed/non-mutable
    // lifecycle) even though a live, well-formed response always offers this transition today.
    if (item.status === 'not_started' || item.status === 'blocked' || item.status === 'done') {
      items.push({
        label: 'Mark in progress',
        icon: 'fa-light fa-spinner',
        disabled: !this.canMarkInProgress(),
        command: () => this.emitStatusChange('in_progress'),
      });
    } else if (item.status === 'awaiting_acceptance') {
      items.push({
        label: 'Mark in progress',
        icon: 'fa-light fa-spinner',
        disabled: !this.canMarkInProgress(),
        command: () => this.reopenRequested.emit(item),
      });
    }

    // "Mark done" only from in_progress (the only source `completeFormationItem` accepts); "Accept"
    // only from awaiting_acceptance, and it routes through the dedicated accept endpoint instead —
    // completeFormationItem's transition check always rejects a source that's already awaiting_acceptance.
    // GH-2576 (Copilot review): both gated consistently with the rest of this menu, not left unconditional.
    if (item.status === 'in_progress') {
      items.push({
        label: this.completeLabel(),
        icon: 'fa-light fa-check',
        disabled: !this.canMarkDone(),
        command: () => this.completeRequested.emit(item),
      });
      // Only in_progress→blocked is a valid transition.
      items.push({
        label: 'Mark blocked…',
        icon: 'fa-light fa-hand',
        disabled: !this.canMarkBlocked(),
        command: () => this.blockRequested.emit(item),
      });
    } else if (item.status === 'awaiting_acceptance') {
      items.push({
        label: this.completeLabel(),
        icon: 'fa-light fa-check',
        disabled: !this.canMarkDone(),
        command: () => this.acceptRequested.emit(item),
      });
    }

    // Only skipped→not_started is a valid transition — done/awaiting_acceptance can only reverse to
    // in_progress (handled above), never all the way back to not_started. GH-2576 (Copilot review):
    // gated on canBackToNotStarted() for consistency with every other item here. Upstream's
    // `back_to_not_started` also carries `requires_reason: true`, unread by `emitStatusChange`
    // (plain `{ status: 'not_started' }`, no reason) — the same pre-existing gap as `request`'s
    // `mark_blocked` mapping above (`canPerformGatedAction`'s doc comment), not introduced or
    // fixed here.
    if (item.status === 'skipped') {
      items.push({
        label: 'Back to not started',
        icon: 'fa-light fa-rotate-left',
        disabled: !this.canBackToNotStarted(),
        command: () => this.emitStatusChange('not_started'),
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
    // completeFormationItem/skipFormationItem/updateFormationItemStatus rejection for the same
    // rule enforced server-side) — skip isn't a write the server will accept for this action kind.
    if (item.action !== 'status_only') {
      items.push(
        { separator: true },
        {
          label: 'Skip with reason',
          icon: 'fa-light fa-forward',
          // `skipFormationItem` only accepts `not_started` as a source (`assertPlainTransitionAllowed`
          // target `skipped` in formation.service.ts) — mirrors the drawer's Skip button gating
          // (formation-item-drawer.component.html).
          disabled: !this.canSkip() || item.status !== 'not_started',
          command: () => this.skipRequested.emit(item),
        }
      );
    }
    return items;
  }

  private emitStatusChange(status: Extract<FormationItem['status'], 'not_started' | 'in_progress'>): void {
    this.statusChanged.emit({ item: this.item(), status });
  }
}
