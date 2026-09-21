// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import type { FormationItem, FormationItemStatus, FormationRowReasonedStatusChange, FormationRowStatusChange } from '@lfx-one/shared/interfaces';
import {
  FORMATION_CHECKLIST_GRID_CLASSES,
  FORMATION_GATED_ROW_ACTIONS,
  FORMATION_GATING_ICON_TOOLTIP,
  FORMATION_ITEM_AUDIENCE_TOOLTIPS,
  FORMATION_ITEM_SEGMENT_COLORS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
  FORMATION_LINK_ROW_ACTIONS,
  FORMATION_STATUS_MENU_ITEM_DISPLAY,
} from '@lfx-one/shared/constants';
import {
  deriveFormationReadinessSummary,
  formatFormationOwnerTeam,
  formatFormationSubItemsDoneLabel,
  formationItemHasAction,
  isFormationItemExternal,
  isRelativeInAppPath,
  isValidUrl,
  tryParseLocalDateString,
} from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';

import { FormationSubItemListComponent } from '../formation-sub-item-list/formation-sub-item-list.component';

@Component({
  selector: 'lfx-formation-checklist-row',
  imports: [
    TagComponent,
    ButtonComponent,
    MenuComponent,
    NgClass,
    NgTemplateOutlet,
    PersonAvatarComponent,
    DatePipe,
    TooltipModule,
    FormationSubItemListComponent,
  ],
  templateUrl: './formation-checklist-row.component.html',
  styleUrl: './formation-checklist-row.component.scss',
})
export class FormationChecklistRowComponent {
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

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
  /**
   * GH-2694: whether the caller holds `project.writer` on this checklist's project — resolved
   * per-caller by the BFF (`FormationChecklistResponse.can_write`, fail-closed) and passed down by
   * the section. Every mutation this row can offer (status menu, gated quick action, overflow
   * Assign/Set due date/Skip) rides a writer-gated upstream route, so for a non-writer they are
   * suppressed the same way `readOnly` suppresses them — offering an enabled control that can only
   * 403 is the affordance defect this flag exists to remove (mirrors the drawer's own
   * `statusActionsDisabled`). "View details"/links stay: read access is not in question. Defaults
   * `true` for hosts that don't bind it.
   */
  public readonly canWrite = input<boolean>(true);
  /**
   * GH-2705: whether the caller may move statuses — {@link canWrite} plus `team:formation`
   * membership, the full pair the gateway's `set_item_status` rule ANDs
   * (`FormationChecklistResponse.can_set_status`, fail-closed). Gates the status menu, the gated
   * quick action, and the overflow Skip entry, all of which ride `POST .../status`; Assign/Set due
   * date stay on {@link canWrite} — their `/assignment` route checks `writer_guard` alone. Defaults
   * `false` (fail closed), unlike `canWrite`'s legacy `true`.
   */
  public readonly canSetStatus = input<boolean>(false);

  public readonly openDrawer = output<FormationItem>();
  /** Fired for the `provisionable`/`request` action kinds only — `manual` opens the drawer instead; the orchestrator owns the actual service call. */
  public readonly actionTriggered = output<FormationItem>();
  /** Status-menu transitions that need no reason (`in_progress`/`done`) — the two real graph targets upstream never requires a `reason` for. */
  public readonly statusChanged = output<FormationRowStatusChange>();
  /** Status-menu "Mark blocked…" / "Skip with reason" / "Back to not started" — each opens `ReasonPromptDialogComponent` first; upstream requires a `reason` for all three. */
  public readonly reasonedStatusRequested = output<FormationRowReasonedStatusChange>();

  /**
   * Start of the viewer's current LOCAL calendar day; `null` on the server. Keeps the due-date
   * urgency band deterministic through SSR/hydration (server always renders neutral) and re-ticks
   * at each local midnight so a long-lived tab can't show a stale band (PR #2692 review). Set only
   * from the constructor's browser branch and `tickLocalDay`.
   */
  private readonly localDayStart = signal<Date | null>(null);
  private midnightTimer: ReturnType<typeof setTimeout> | undefined;

  /** Drives `aria-expanded` on the status-chip trigger — set purely via `<lfx-menu>`'s `onShow`/`onHide`, never in the click handler. */
  protected readonly statusMenuOpen = signal<boolean>(false);
  /** Drives `aria-expanded` on the overflow trigger — set purely via `<lfx-menu>`'s `onShow`/`onHide`, never in the click handler. */
  protected readonly overflowMenuOpen = signal<boolean>(false);
  /** Whether the sub-item panel under the row is open (#2774). Collapsed by default so SSR and the browser render the same DOM. */
  protected readonly subItemsExpanded = signal<boolean>(false);

  /** `#gatedAction`/`#linkOrDetailsAction` template contexts, keyed by action kind — typed at the definition site (see `FORMATION_GATED_ROW_ACTIONS`/`FORMATION_LINK_ROW_ACTIONS`), not inline in the template where `*ngTemplateOutlet` context is untyped. */
  protected readonly gatedActions = FORMATION_GATED_ROW_ACTIONS;
  protected readonly linkActions = FORMATION_LINK_ROW_ACTIONS;
  /** Row grid templates per panel-width tier (shared with the section header's captions, #2774) and the mini bar's per-status colors — exposed directly so the template does plain lookups. */
  protected readonly gridClasses = FORMATION_CHECKLIST_GRID_CLASSES;
  protected readonly segmentColorClass = FORMATION_ITEM_SEGMENT_COLORS;

  /** The gating asterisk's tooltip AND accessible name — one shared constant so the two can't drift (#2689). */
  protected readonly gatingIconTooltip = FORMATION_GATING_ICON_TOOLTIP;

  protected readonly statusLabel = computed(() => FORMATION_ITEM_STATUS_LABELS[this.item().status]);
  protected readonly statusSeverity = computed(() => FORMATION_ITEM_STATUS_SEVERITY[this.item().status]);
  /**
   * The globe icon's tooltip AND accessible name (#2774) — `null` hides the icon: `internal` shows
   * nothing on the row by design, and so does an unrecognized/missing `checklist_type` (see
   * `FormationItem.audience`). The drawer spells the audience out in full instead.
   */
  protected readonly audienceTooltip = computed(() => {
    const audience = this.item().audience;
    return isFormationItemExternal(audience) ? FORMATION_ITEM_AUDIENCE_TOOLTIPS[audience] : null;
  });
  /** Humanized owner-team chip label (#2689) — curated map with `formatTag` fallback for off-enum upstream values. */
  protected readonly ownerTeamLabel = computed(() => {
    const team = this.item().owner_team;
    return team ? formatFormationOwnerTeam(team) : null;
  });
  /**
   * Due-date urgency color (#2689 learnings review). `due_date` is a DATE-ONLY string, so the poll
   * pipes are the wrong tool here: `DueDateLabelPipe` does `new Date('YYYY-MM-DD')` (UTC midnight)
   * and, with no timezone argument, falls back to the legacy LA timezone — shifting the calendar
   * day for most viewers so the red/amber band fired a day early and never on the actual due date.
   * Parse at LOCAL midnight (`tryParseLocalDateString`) and band on local calendar-day distance:
   * due today → red, due tomorrow → amber, anything else — including past-due — neutral gray
   * (past-due neutrality is deliberate parity with how votes/surveys render an elapsed date).
   * Banded against {@link localDayStart}, so SSR renders neutral deterministically and the band
   * follows the viewer's clock across local midnight (PR #2692 review).
   */
  protected readonly dueDateColorClass = computed(() => {
    const dayStart = this.localDayStart();
    const due = tryParseLocalDateString(this.item().due_date);
    if (!dayStart || !due) {
      return 'text-gray-500';
    }
    const diffDays = Math.round((due.getTime() - dayStart.getTime()) / 86_400_000);
    if (diffDays === 0) {
      return 'text-red-600';
    }
    if (diffDays === 1) {
      return 'text-amber-600';
    }
    return 'text-gray-500';
  });
  /**
   * GH-2576: derived from `available_actions` (replacing the deleted `can_complete` boolean) —
   * item-state gating, advisory rather than a caller-permission check (see `formationItemHasAction`'s
   * doc comment: `available_actions` describes the item, not the caller). The caller half is
   * `canSetStatus` (GH-2705), intersected wherever these flags drive a control; the real access
   * decision remains the gateway's.
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
  protected readonly isActionable = computed(() => !this.readOnly() && this.canSetStatus() && this.item().status === 'in_progress');
  /** `status_only` items are updated by external tooling only — the chip must not offer a menu the server will reject (see `buildStatusMenuItems`). GH-2328: a non-live formation offers no status menu either; GH-2705: nor does a caller without the full status-write standing. */
  protected readonly isStatusEditable = computed(() => !this.readOnly() && this.canSetStatus() && this.item().action !== 'status_only');
  /** GH-1958 acceptance criteria: surface an "Assigned to you" chip when the viewer is this item's owner. */
  protected readonly isAssignedToViewer = computed(() => {
    const owner = this.item().owner;
    const viewerUsername = this.userService.viewerUsername();
    return !!owner && !!viewerUsername && owner.username === viewerUsername;
  });
  /** Per-status tally of the item's sub-items (#2774), `null` when it has none — drives the disclosure trigger, its mini bar, and whether either renders. */
  protected readonly subItemsSummary = computed(() => {
    const subItems = this.item().sub_items;
    return subItems.length > 0 ? deriveFormationReadinessSummary(subItems) : null;
  });
  protected readonly subItemsLabel = computed(() => {
    const summary = this.subItemsSummary();
    return summary ? `${summary.counts.done} of ${summary.totalItems} sub-items` : '';
  });
  /** The mini bar's accessible name — shared wording with `lfx-formation-sub-item-list`'s bar (`formatFormationSubItemsDoneLabel`). */
  protected readonly subItemsBarLabel = computed(() => {
    const summary = this.subItemsSummary();
    return summary ? formatFormationSubItemsDoneLabel(summary) : '';
  });
  /** Same indexed-track shape as the readiness strip — statuses repeat, so a stable per-position id is the track key. */
  protected readonly subItemSegments = computed(() => (this.subItemsSummary()?.segments ?? []).map((status, index) => ({ id: index, status })));
  /** `aria-controls` target for the disclosure trigger; only rendered (and only referenced) while expanded. */
  protected readonly subItemsPanelId = computed(() => `formation-checklist-row-sub-items-panel-${this.item().uid}`);
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

  constructor() {
    // PR #2692 review: the urgency band must be deterministic through SSR/hydration, so only the
    // browser ever learns the real local day — the server leaves localDayStart null (neutral band)
    // and the browser corrects it after hydration, then keeps it current across local midnights.
    if (isPlatformBrowser(this.platformId)) {
      this.tickLocalDay();
      this.destroyRef.onDestroy(() => clearTimeout(this.midnightTimer));
    }
  }

  protected onOpenDrawer(): void {
    this.openDrawer.emit(this.item());
  }

  protected onAction(): void {
    this.actionTriggered.emit(this.item());
  }

  protected toggleSubItems(): void {
    this.subItemsExpanded.update((open) => !open);
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
   * `available_actions` — upstream's own per-item, per-status answer — is authoritative for which
   * transitions this menu offers: every known target is listed from every source status and gated on
   * its own flag, not restricted by a hand-maintained source-status graph, which would drift from
   * upstream's `status.go` and hide valid transitions (v0.1.4 advertises e.g. `not_started →
   * done/blocked`, `blocked → done/not_started`, `done → not_started` — none reachable under the old
   * hard-coded graph; Copilot review, PR #2613). The one exclusion is the current status's own
   * target: upstream never advertises a self-transition, so that entry's flag would always be absent
   * — permanently-disabled noise. A target whose flag IS absent stays listed but disabled, defending
   * the case `available_actions` comes back `[]` (malformed/non-mutable lifecycle).
   *
   * `in_progress`/`done` targets carry no reason and fire `statusChanged` directly; `blocked`/
   * `not_started` targets always require one upstream (`requires_reason: true` on
   * `mark_blocked`/`back_to_not_started`) and route through `reasonedStatusRequested` instead, which
   * opens the reason dialog. `skipped` is offered from the overflow menu, not here, matching the
   * pre-GH-2576 layout.
   *
   * Caller standing is gated on `canSetStatus` (GH-2705): the BFF's fail-closed mirror of the
   * gateway's full POST .../status pair (writer_guard + `member` on `team:formation`), which
   * closed the GH-2576-era gap where the writer half alone was predictable and a writer outside
   * the formation team was offered a menu whose every write 403'd. The per-status flags
   * themselves gate on item STATE only.
   */
  private buildStatusMenuItems(): MenuItem[] {
    const item = this.item();
    // GH-2328: a non-live formation offers no status transitions at all — every transition below
    // would 409 (checklist_read_only) at the server. GH-2705: nor does a caller without the full
    // status-write standing — every transition would 403 at the gateway's set_item_status rule.
    if (this.readOnly() || !this.canSetStatus()) return [];
    // status_only items are updated by external tooling only. GH-2576 Phase 2 removed the BFF-side
    // status_only rejection along with the pre-read it required (no write path re-reads the item to
    // manufacture its own version, and this check has no upstream equivalent to fall back on either —
    // design.go's write routes carry no status_only/platform-managed concept at all). This is now a
    // client-only affordance, not a server-enforced rule: a caller bypassing this UI could still POST
    // a manual status change to a status_only item. Flagged, not silently dropped — see the PR
    // description.
    if (item.action === 'status_only') return [];

    const entries: { status: Exclude<FormationItemStatus, 'skipped'>; available: boolean }[] = [
      { status: 'in_progress', available: this.canMarkInProgress() },
      { status: 'done', available: this.canMarkDone() },
      { status: 'blocked', available: this.canMarkBlocked() },
      { status: 'not_started', available: this.canBackToNotStarted() },
    ];
    return entries
      .filter((entry) => entry.status !== item.status)
      .map((entry) => ({
        label: FORMATION_STATUS_MENU_ITEM_DISPLAY[entry.status].label,
        icon: FORMATION_STATUS_MENU_ITEM_DISPLAY[entry.status].icon,
        disabled: !entry.available,
        command: () => this.emitStatusTarget(item, entry.status),
      }));
  }

  private buildOverflowMenuItems(): MenuItem[] {
    const item = this.item();
    // GH-2328: Assign/Set due date/Skip are all mutations — none are offered on a non-live
    // formation. GH-2694: nor to a non-writer caller — Skip 403s at writer_guard, and Assign/Set
    // due date would only open the drawer onto fields `assignmentReadOnly` disables. The drawer
    // itself (with its editable-for-auditors notes field) stays reachable via the row/View details.
    if (this.readOnly() || !this.canWrite()) return [];
    const items: MenuItem[] = [
      { label: 'Assign', icon: 'fa-light fa-user', command: () => this.openDrawer.emit(item) },
      { label: 'Set due date', icon: 'fa-light fa-calendar', command: () => this.openDrawer.emit(item) },
    ];
    // status_only items are updated by external tooling only — client-only affordance since GH-2576
    // Phase 2 (see buildStatusMenuItems's doc comment above for why there's no server-side check).
    // Gated on canSkip() (available_actions, item-state) rather than a hand-maintained transition
    // table, matching the status menu above. Skip is a status write, so it additionally needs the
    // full canSetStatus standing (GH-2705) — a writer without team membership keeps Assign/Set due
    // date (their /assignment route checks writer_guard alone) but is not offered Skip.
    if (item.action !== 'status_only' && this.canSetStatus()) {
      items.push(
        { separator: true },
        {
          label: FORMATION_STATUS_MENU_ITEM_DISPLAY.skipped.label,
          icon: FORMATION_STATUS_MENU_ITEM_DISPLAY.skipped.icon,
          disabled: !this.canSkip(),
          command: () => this.reasonedStatusRequested.emit({ item, status: 'skipped' }),
        }
      );
    }
    return items;
  }

  /**
   * Sets {@link localDayStart} to today's LOCAL midnight and schedules the next update for just
   * past the coming midnight (+1s slack against timer/clock edge). Browser-only — only the
   * constructor's `isPlatformBrowser` branch calls it; the DestroyRef hook registered there clears
   * the pending timer.
   */
  private tickLocalDay(): void {
    const now = new Date();
    this.localDayStart.set(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    this.midnightTimer = setTimeout(() => this.tickLocalDay(), nextMidnight.getTime() - now.getTime() + 1_000);
  }

  /**
   * Routes a status-menu pick by upstream's reason requirement (see {@link buildStatusMenuItems}):
   * `blocked`/`not_started` open the reason dialog via `reasonedStatusRequested`; `in_progress`/`done`
   * fire `statusChanged` directly.
   */
  private emitStatusTarget(item: FormationItem, status: Exclude<FormationItemStatus, 'skipped'>): void {
    if (status === 'blocked' || status === 'not_started') {
      this.reasonedStatusRequested.emit({ item, status });
      return;
    }
    this.statusChanged.emit({ item, status });
  }
}
