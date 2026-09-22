// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, effect, ElementRef, inject, input, model, output, PLATFORM_ID, signal, Signal, viewChild, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { FormationService } from '@services/formation.service';
import type {
  FormationActionHrefTargets,
  FormationDrawerData,
  FormationItem,
  FormationItemDrawerFormValue,
  FormationItemStatus,
  FormationItemWriteResult,
  FormationPeopleResponse,
  TagSeverity,
  UserSearchOption,
} from '@lfx-one/shared/interfaces';
import {
  createEmptyFormationDrawerData,
  createUnavailableFormationPeopleResponse,
  FORMATION_ACTIVITY_RELATIVE_TIME_WINDOW_MS,
  FORMATION_ASSIGNEE_DIRECTORY_PLACEHOLDER,
  FORMATION_ASSIGNEE_EMPTY_MESSAGE,
  FORMATION_ASSIGNEE_LOADING_PLACEHOLDER,
  FORMATION_ASSIGNEE_PLACEHOLDER,
  FORMATION_GATING_ICON_TOOLTIP,
  FORMATION_ITEM_AUDIENCE_LABELS,
  FORMATION_ITEM_AUDIENCE_TOOLTIPS,
  FORMATION_ITEM_STATUS_GLYPHS,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
  FORMATION_ITEM_STATUS_TILE_CLASSES,
  USER_SEARCH_EMPTY_MESSAGE,
} from '@lfx-one/shared/constants';
import {
  avatarInitials,
  findFormationPersonByUsername,
  formatFormationOwnerTeam,
  formatRelativeTime,
  formatUserLabel,
  formationItemHasAction,
  getFormationActivityDisplay,
  isFormationItemExternal,
  isValidUrl,
  resolveFormationActionHref,
  splitDisplayName,
  toAssigneeSearchOption,
  toLocalDateOnlyString,
  tryParseLocalDateString,
} from '@lfx-one/shared/utils';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, finalize, map, merge, Observable, of, skip, startWith, Subject, switchMap, take, tap } from 'rxjs';

import { FormationSubItemListComponent } from '../formation-sub-item-list/formation-sub-item-list.component';

@Component({
  selector: 'lfx-formation-item-drawer',
  imports: [
    DrawerModule,
    SkeletonModule,
    ReactiveFormsModule,
    RouterLink,
    NgClass,
    ButtonComponent,
    TagComponent,
    PersonAvatarComponent,
    TextareaComponent,
    UserSearchComponent,
    CalendarComponent,
    DatePipe,
    FormationSubItemListComponent,
  ],
  templateUrl: './formation-item-drawer.component.html',
  styleUrl: './formation-item-drawer.component.scss',
})
export class FormationItemDrawerComponent {
  private readonly formationService = inject(FormationService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly visible = model<boolean>(false);

  /** Together address the item being shown — the drawer reads via these on open, but every mutation below routes off the loaded `item()`'s own `project_uid`/`template_item_key` (GH-2267 Phase 2). */
  public readonly itemProjectUid = input<string | null>(null);
  public readonly itemKey = input<string | null>(null);
  /**
   * The parent project's slug, which addresses the people read (`GET /api/projects/:slug/formation/people`)
   * behind the assignee picker (#2594). Optional so a host that omits it simply keeps the directory
   * search: the picker only scopes to the formation's people once a slug is supplied.
   */
  public readonly projectSlug = input<string | null>(null);
  /**
   * True while the section has *any* mutation in flight for this item — a row action
   * (provisionable/request), a submitted skip, or this drawer's own Mark complete/Save (echoed back
   * via `writeStarted`/`writeEnded`, below). Drives `busy()`'s `[disabled]` gate on every button here;
   * `[loading]` stays per-action (`completing`/`savingDetails`/`skipInFlight`) so a spinner never
   * appears on a button the user didn't press.
   */
  public readonly mutationInFlight = input<boolean>(false);
  /** True specifically while a skip the user submitted from this drawer is in flight — scoped narrower than `mutationInFlight` so a row action elsewhere doesn't spin this button. */
  public readonly skipInFlight = input<boolean>(false);
  /**
   * Whether the caller has real project write access (`project.writer`, the gateway's
   * `writer_guard`), independent of the item's own `available_actions`-derived affordance signals
   * (GH-2576, formerly `can_complete`; copilot review: those signals are item-scoped and advisory,
   * not a real write-access check). Since GH-2705 the Mark complete/Skip gate is
   * {@link canSetStatus} (this plus `team:formation` membership — the full `POST .../status`
   * pair); this flag alone no longer gates {@link statusActionsDisabled}, and never {@link busy} —
   * Save's note-only leg doesn't need it: the PATCH item route is gated on read access
   * (`auditor_guard`) upstream, per the GH-2576 guard-tier audit, so a caller with
   * `canWrite() === false` can still save a note. Assignee/due-date edits DO need it — the
   * POST .../assignment route is writer-gated —
   * so when false those two controls are read-only/disabled ({@link assignmentReadOnly}) and
   * `onSaveDetails` ignores any stray difference rather than submitting a deterministic 403 which,
   * for a combined edit, would otherwise report failure after the note leg had already persisted
   * (Copilot review, PR #2613). The one host, `formation-checklist-section`, binds it (GH-2694)
   * from the checklist response's per-caller `can_write` — the `true` default only covers a host
   * that omits the input, and is NOT a statement that any current host does.
   */
  public readonly canWrite = input<boolean>(true);
  /**
   * GH-2705: whether the caller may move statuses — {@link canWrite} plus the `team:formation`
   * membership the gateway's `set_item_status` rule additionally checks, resolved fail-closed by
   * the BFF (`FormationChecklistResponse.can_set_status` / `MyFormationItemRow.can_set_status`)
   * and bound by both hosts. Replaces `canWrite` in {@link statusActionsDisabled}'s gate (Mark
   * complete/Skip — both ride `POST .../status`); `canWrite` keeps gating the assignment fields,
   * whose `/assignment` route checks `writer_guard` alone. Defaults `false` (fail closed) — a
   * host that omits it renders the status controls disabled, never a write that can only 403.
   */
  public readonly canSetStatus = input<boolean>(false);
  /**
   * True when the drawer is opened from an assignee-only flow, where GH-1956 decision 3 forbids the
   * assignee from setting item status at all ("No 'Mark done'", with status changes left to the
   * formation team). Hides Mark complete/Accept/Skip entirely rather than merely disabling them,
   * unlike `canWrite` above which still shows the controls (disabled, with an explanatory message)
   * since that's a real-access question rather than a flow restriction. Defaults `false` so
   * `formation-checklist-section`, which doesn't pass this input, is unaffected (copilot review,
   * PR #2309). No host binds it since #2732 retired the in-dashboard Me-lens drawer — the
   * pending-action row now navigates to the checklist instead.
   */
  public readonly assigneeOnly = input<boolean>(false);
  /**
   * GH-2328: true when the parent formation's upstream `lifecycle` isn't `'live'`. Folded into
   * `busy()` below so it disables Mark complete/Accept/Skip/Save exactly like an in-flight write or
   * missing `canWrite` would; the template additionally hides those controls outright (and marks the
   * notes/assignee/due-date fields read-only) rather than merely disabling them, since there is
   * nothing here for the viewer to retry — the section's own banner above already names the reason.
   */
  public readonly readOnly = input<boolean>(false);

  /** Fired for a status-changing action (Mark complete) — the section refreshes the row list, and closes the drawer if it's still showing this item. */
  public readonly itemChanged = output<FormationItem>();
  /** Fired for a metadata-only save (notes/assignee/due-date) — the section refreshes the row list but leaves the drawer open. */
  public readonly itemUpdated = output<FormationItem>();
  public readonly skipRequested = output<FormationItem>();
  /**
   * Fired synchronously around Mark complete/Save's own service call (start, then finalize) so the
   * section can register this drawer's write in the same `submittingItemUids` map that guards row
   * actions and skip — without this, a row action fired while the drawer was mid-write (or vice
   * versa) would race against it undetected, since the section otherwise has no visibility into the
   * drawer's own `completing`/`savingDetails` signals. Each event carries the item uid the write was
   * *for*, captured at the moment the call started — reading the section's current `drawerItemUid()`
   * instead would clear (or register) the wrong entry if the drawer switches to a different item
   * before this write's response comes back (nothing today blocks closing the drawer mid-write).
   */
  public readonly writeStarted = output<string>();
  public readonly writeEnded = output<string>();

  protected readonly editForm = new FormGroup({
    notes: new FormControl<string>(''),
    ownerUsername: new FormControl<string | null>(''),
    dueDate: new FormControl<Date | null>(null),
  });

  private readonly reload$ = new Subject<void>();
  /** Try again on a failed open fetch (#2801) — tagged `'open'` in {@link initDrawerData} so the whole open transition re-runs, not just a refresh. */
  private readonly retry$ = new Subject<void>();

  /**
   * The assignee search box — queried so {@link onSaveDetails} can ask it (via
   * `consumeDiscardedText`) whether the blur that preceded the Save click just threw away
   * typed-but-unselected text (GH-2694). Renders inside the p-drawer body, so it only exists while
   * the drawer is open — exactly the times Save is clickable.
   */
  private readonly assigneeSearch = viewChild(UserSearchComponent);
  /**
   * The drawer title — the `aria-labelledby` target and where focus lands on open (#2801, the cheap
   * half of #2620). It lives in the `#header` template, which PrimeNG embeds into the portaled
   * panel, so a template ref (not a host DOM query) is the only way to reach it.
   */
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');
  /** The element that opened the drawer, captured on show so close can hand focus back — see {@link restoreFocus}. */
  private previouslyFocusedElement: HTMLElement | null = null;

  protected readonly loading: WritableSignal<boolean> = signal(false);
  protected readonly loadFailed: WritableSignal<boolean> = signal(false);
  /** True while the people read behind the assignee picker is in flight — see {@link people}. */
  protected readonly peopleLoading: WritableSignal<boolean> = signal(false);
  /**
   * Item uids Mark complete/Save is currently writing — a set, not a single slot, since this drawer
   * component instance is reused across every item it ever opens and two of its own writes (e.g.
   * Mark complete on A, then Mark complete on a different item B before A's response lands) can be
   * in flight at once. A single `string | null` slot would let starting B's write immediately
   * overwrite A's uid, silently losing A's own tracking (and its `[loading]` spinner, if A's drawer
   * were reopened) while A's write is still genuinely in flight — even though the slot's own
   * uid-guarded `finalize` correctly avoided clearing B's tracking once A's write resolved. `completing`
   * /`savingDetails` below derive from these against the currently-open item, so switching items
   * automatically (not via an explicit reset) scopes each flag to the write it actually belongs to.
   */
  protected readonly completingUids: WritableSignal<ReadonlySet<string>> = signal(new Set());
  protected readonly savingDetailsUids: WritableSignal<ReadonlySet<string>> = signal(new Set());
  /**
   * A write's own response already carries the item's new post-write `version` (the BFF mirrors it
   * into both the response body and the `ETag` header) — set synchronously the moment a write
   * response comes back, so `item()` reflects it immediately rather than only once the async
   * `reload$` refetch (below) eventually lands. Without this, a second write fired before that
   * refetch completes reads `item()`'s stale pre-write version, resends it as `If-Match`, and 412s
   * even though the first write already succeeded (Cursor Bugbot, PR #2613) — the reload is an
   * eventual-consistency nicety (refreshes `history()` too), not what unblocks the next write.
   * Applied only while the drawer still shows the written item (see
   * {@link applyOptimisticItemIfStillShowing}): this drawer instance is reused across items, so a
   * write started on item A can resolve after the user has opened item B — applying that response
   * unconditionally would flip `item()` back to A while the form still holds B's values, and the
   * next Save would write B's notes/assignee/due date onto A (Cursor Bugbot, PR #2613). Cleared on
   * a fresh 'open' (a different item entirely) and once the next real fetch lands (the server truth
   * then supersedes it regardless of trigger) — see {@link initDrawerData}.
   */
  protected readonly optimisticItem: WritableSignal<FormationItem | null> = signal(null);
  /**
   * Separate per-action signals, each driving only its own button's `[loading]` — a single shared
   * flag would spin the Save button while Mark complete is in flight (and vice versa), a spinner on
   * a button the user never pressed. Both are still checked in each handler's guard, not just their
   * own, since the two write the same item and must not run concurrently.
   */
  protected readonly completing: Signal<boolean> = computed(() => {
    const uid = this.item()?.uid;
    return uid !== undefined && this.completingUids().has(uid);
  });
  protected readonly savingDetails: Signal<boolean> = computed(() => {
    const uid = this.item()?.uid;
    return uid !== undefined && this.savingDetailsUids().has(uid);
  });
  /**
   * Every write this drawer can trigger against the open item — Mark complete, Save, and (via
   * `mutationInFlight`) the section-owned Skip/row-action mutation. All three write the same item,
   * so any one of them in flight must block the other two, not just its own button. Deliberately
   * excludes `canWrite` — see {@link statusActionsDisabled} for the write-access gate, which only
   * applies to Mark complete/Skip, not Save's note-only leg (GH-2613 review).
   */
  protected readonly busy: Signal<boolean> = computed(() => this.completing() || this.savingDetails() || this.mutationInFlight() || this.readOnly());
  /** Mark complete/Skip both ride `POST .../status`, whose gateway rule ANDs `writer_guard` with `team:formation` membership — gated on `canSetStatus` (the full pair, GH-2705); Save is gated by {@link busy} alone. */
  protected readonly statusActionsDisabled: Signal<boolean> = computed(() => this.busy() || !this.canSetStatus());
  /**
   * True when at least one status control renders for the current item — Mark complete only for
   * `in_progress`, Skip only for gating `not_started` (see the template's own conditions). The
   * standing explanation must never outlive the buttons it explains: without this, a blocked or
   * non-gating not_started item showed a lone sentence about controls that aren't on screen
   * (GH-2705 review — the writer-outside-the-team population made that the common case).
   */
  protected readonly statusControlsRendered: Signal<boolean> = computed(() => {
    const item = this.item();
    if (!item) return false;
    return item.status === 'in_progress' || (item.is_gating && item.status === 'not_started');
  });
  /**
   * Gates the assignee/due-date fields — both ride the writer-gated POST .../assignment route (see
   * `canWrite`'s doc comment), so an auditor-only caller gets them read-only/disabled even though the
   * notes field and Save itself stay available for the auditor-gated note leg. Folds in `readOnly()`,
   * which marks every field read-only for its own reason (GH-2328).
   */
  protected readonly assignmentReadOnly: Signal<boolean> = computed(() => this.readOnly() || !this.canWrite());
  /**
   * The people on this formation — the project's settings-role holders, read on each open when the
   * host supplied a `projectSlug` (#2594). Upstream only accepts a grant holder as an assignee
   * (`assignee_not_on_project`), so this is the assignee picker's candidate list; the same read
   * names the committed assignee (see {@link assigneeDisplayValue}) instead of a bare username.
   * It never errors: a refused settings read (global-grant staff, 403) degrades to `unavailable`,
   * and the picker then falls back to the directory search it used before this scoping.
   */
  protected readonly people: Signal<FormationPeopleResponse> = this.initPeople();
  /** `null` while the people list is not loaded — lfx-user-search then searches its `searchType` corpus instead. */
  protected readonly assigneeCandidates: Signal<readonly UserSearchOption[] | null> = computed(() => {
    const response = this.people();
    return response.state === 'loaded' ? response.people.map(toAssigneeSearchOption) : null;
  });
  /** Says which population the box searches — the formation's people once loaded, the directory while the list is unavailable. */
  protected readonly assigneePlaceholder: Signal<string> = computed(() => {
    if (this.peopleLoading()) {
      return FORMATION_ASSIGNEE_LOADING_PLACEHOLDER;
    }
    if (this.assigneeCandidates() !== null) {
      return FORMATION_ASSIGNEE_PLACEHOLDER;
    }
    return FORMATION_ASSIGNEE_DIRECTORY_PLACEHOLDER;
  });
  /** In local mode the empty state names the remedy (invite first); the directory fallback keeps the component's default copy. */
  protected readonly assigneeEmptyMessage: Signal<string> = computed(() =>
    this.assigneeCandidates() !== null ? FORMATION_ASSIGNEE_EMPTY_MESSAGE : USER_SEARCH_EMPTY_MESSAGE
  );
  /** The picker also waits for the people read, so a fast typist cannot search the wrong corpus before the list lands. */
  protected readonly assigneeReadOnly: Signal<boolean> = computed(() => this.assignmentReadOnly() || this.peopleLoading());
  protected readonly drawerData: Signal<FormationDrawerData> = this.initDrawerData();
  protected readonly item = computed(() => this.optimisticItem() ?? this.drawerData().item);
  protected readonly history = computed(() => this.drawerData().history);
  /** Distinguishes the History panel's honest empty/failed states (GH-2372) — see `FormationActivityHistoryState`'s doc comment. */
  protected readonly historyState = computed(() => this.drawerData().history_state);
  /**
   * Precomputed per-entry summary/detail/initials/relative time so the template never calls a
   * function per change-detection cycle — same reason `committee-overview.component.ts` precomputes
   * `formatRelativeTime` instead of calling it from the template. The relative time is computed once
   * per load, not ticking; the `<time>` element's `title` carries the exact timestamp (#2801).
   */
  protected readonly historyEntries = computed(() =>
    this.history().map((entry) => {
      const [firstName, lastName] = splitDisplayName(entry.actor.name);
      const createdAt = new Date(entry.created_at);
      const isRecent = Date.now() - createdAt.getTime() < FORMATION_ACTIVITY_RELATIVE_TIME_WINDOW_MS;
      return {
        entry,
        ...getFormationActivityDisplay(entry),
        // `FormationUser` carries no avatar URL — initials on a per-username color are the whole avatar.
        initials: avatarInitials(firstName, lastName, entry.actor.name || entry.actor.username),
        // `null` past the window — the template falls back to a short absolute date.
        relativeTime: isRecent ? formatRelativeTime(createdAt) : null,
      };
    })
  );
  /** `evidence_link` is API-sourced — never trust it into `[href]` unvalidated; drops anything that isn't http(s). */
  protected readonly safeEvidenceLink: Signal<string | null> = computed(() => {
    const link = this.item()?.evidence_link;
    return link && isValidUrl(link) ? link : null;
  });
  /**
   * GH-2576: derived from `available_actions` (replacing the deleted `can_complete` boolean) —
   * advisory, not a caller-permission check (see `formationItemHasAction`'s doc comment). Mirrors
   * `FormationChecklistRowComponent`'s equivalent signals. No more "Accept" relabeling here — the
   * two-step submit-then-accept model (and its `awaiting_acceptance` status) is gone; "Mark complete"
   * is the only label this drawer ever shows.
   */
  protected readonly canMarkDone = computed(() => {
    const currentItem = this.item();
    return !!currentItem && formationItemHasAction(currentItem, 'mark_done');
  });
  protected readonly canSkip = computed(() => {
    const currentItem = this.item();
    return !!currentItem && formationItemHasAction(currentItem, 'skip');
  });
  /** Header meta line (#2774) — humanized owner team, curated map with `formatTag` fallback for off-enum upstream values (same resolver as the row). */
  protected readonly ownerTeamLabel = computed(() => {
    const team = this.item()?.owner_team;
    return team ? formatFormationOwnerTeam(team) : null;
  });
  /** Header meta line (#2774) — the audience spelled out in full; the row shows only a globe for the external-involving audiences. `null` for a missing/unrecognized upstream value. */
  protected readonly audienceLabel = computed(() => {
    const audience = this.item()?.audience;
    return audience ? FORMATION_ITEM_AUDIENCE_LABELS[audience] : null;
  });
  protected readonly audienceIsExternal = computed(() => isFormationItemExternal(this.item()?.audience));
  /** The gating chip's tooltip (#2801) — the row's asterisk explanation, spelled out here as a chip. */
  protected readonly gatingTooltip = FORMATION_GATING_ICON_TOOLTIP;
  /** The audience chip's globe and tooltip for the external-involving audiences (#2774); nothing for `internal`. */
  protected readonly audienceIcon: Signal<string | undefined> = computed(() => (this.audienceIsExternal() ? 'fa-light fa-globe text-gray-400' : undefined));
  protected readonly audienceTooltip: Signal<string | undefined> = computed(() => {
    const audience = this.item()?.audience;
    return isFormationItemExternal(audience) ? FORMATION_ITEM_AUDIENCE_TOOLTIPS[audience] : undefined;
  });
  /**
   * The header's status, narrowed fail-closed (#2801 review): `FormationItem.status` is a wire
   * cast the mapper passes through unvalidated, so a value the frontend doesn't know yet (the
   * retired `awaiting_acceptance` was one) would otherwise index the maps below to `undefined` and
   * throw inside the header template, blanking the whole drawer. Falls back to `not_started` for
   * the glyph/tile/severity — the same guard `lfx-formation-sub-item-list` uses — through
   * `Object.hasOwn`, not a bare index, so an inherited prototype key can't resolve to a function.
   * `null` while no item is loaded.
   */
  private readonly resolvedStatus: Signal<FormationItemStatus | null> = computed(() => {
    const status = this.item()?.status;
    if (!status) return null;
    return Object.hasOwn(FORMATION_ITEM_STATUS_GLYPHS, status) ? status : 'not_started';
  });
  /**
   * Header status chip and tile (#2801) — the same label/severity vocabulary as the checklist row's
   * chip. An off-taxonomy status renders its raw value as the chip label (the sub-item list's
   * off-taxonomy-renders-verbatim rule) over the not-started glyph and tint.
   */
  protected readonly statusLabel: Signal<string> = computed(() => {
    const raw = this.item()?.status;
    const status = this.resolvedStatus();
    if (!raw || !status) return '';
    return raw === status ? FORMATION_ITEM_STATUS_LABELS[status] : raw;
  });
  protected readonly statusSeverity: Signal<TagSeverity> = computed(() => FORMATION_ITEM_STATUS_SEVERITY[this.resolvedStatus() ?? 'not_started']);
  protected readonly statusGlyph = computed(() => FORMATION_ITEM_STATUS_GLYPHS[this.resolvedStatus() ?? 'not_started']);
  protected readonly statusTileClass: Signal<string> = computed(() => FORMATION_ITEM_STATUS_TILE_CLASSES[this.resolvedStatus() ?? 'not_started']);
  /**
   * Whether the action bar (Mark complete / Skip… plus its one-line explanation) renders at all.
   * status_only items are updated by external tooling only — client-only affordance since GH-2576
   * Phase 2 (see formation-checklist-row.component.ts's buildStatusMenuItems doc comment for why
   * there's no server-side check to fall back on). assigneeOnly (GH-1956 decision 3): the Me-lens
   * assignee never sets status, so the controls are hidden entirely rather than disabled — those
   * rows have no "Mark done" at all. {@link statusControlsRendered} supplies the item-status half.
   */
  protected readonly actionBarRendered: Signal<boolean> = computed(() => {
    const item = this.item();
    return !!item && !this.assigneeOnly() && !this.readOnly() && item.action !== 'status_only' && this.statusControlsRendered();
  });
  /**
   * The item's own destination for `link` items (#2801) — the same resolution as the row's "Open"
   * button (`resolveFormationActionHref`), so the drawer can never bind an href the row would
   * refuse. `provisionable`/`request` rows have a side-effecting action, not a destination, and stay
   * row-only; `status_only`/`manual` have nothing to open.
   */
  protected readonly actionLinks: Signal<FormationActionHrefTargets> = computed(() => {
    const item = this.item();
    return item?.action === 'link' ? resolveFormationActionHref(item.action_href) : { external: null, internal: null };
  });
  protected readonly hasLinks: Signal<boolean> = computed(() => {
    const links = this.actionLinks();
    return this.safeEvidenceLink() !== null || links.external !== null || links.internal !== null;
  });
  /**
   * PrimeNG passthrough (#2801): the root announces as a modal dialog named by the title — the cheap
   * half of #2620; `p-drawer`'s default is an unnamed `complementary` landmark despite the mask —
   * and the footer collapses whenever it has nothing to show (read-only, or no item to save). The
   * `#footer` template itself stays statically declared (PrimeNG resolves it through a ContentChild
   * query), so hiding is a class, not an `@if` around the template.
   */
  protected readonly drawerPt = computed(() => ({
    root: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'formation-item-drawer-title',
      // Tells assistive tech an update is coming while the open fetch is in flight — the title
      // announces "Loading item details" until then. Always present with an explicit value: the
      // passthrough binding updates a key's value in place but never removes a key that vanishes
      // from the object, so a conditional spread would leave `aria-busy="true"` on for the
      // drawer's whole life (#2803 review).
      'aria-busy': this.loading() ? 'true' : 'false',
    },
    footer: { class: this.readOnly() || !this.item() ? 'hidden' : 'border-t border-gray-200' },
  }));
  /**
   * The `ownerUsername` control mirrored into a signal. `editForm` is a plain instance field here
   * (not a signal input like meeting-details' `form()`), so this reads the control's own
   * valueChanges directly rather than needing a `toObservable(this.form)` wrapper.
   */
  private readonly ownerUsernameValue: Signal<string> = this.initOwnerUsernameValue();
  /**
   * The whole form mirrored into a signal via `getRawValue()` (#2801) — a disabled control drops
   * out of `form.value`, so the due date would otherwise read as cleared while
   * `assignmentReadOnly()` holds.
   */
  private readonly formValue: Signal<FormationItemDrawerFormValue> = this.initFormValue();
  /**
   * The committed assignee label bound into lfx-user-search's `[displayValue]`. The name and email
   * come from the people list when it knows the username; otherwise (people unavailable, or an
   * owner who no longer holds a grant) the item's own `owner.name` — the BFF enriches it from the
   * user profile (#2742), leaving the username only as a placeholder when no profile answered — and
   * the bare username last.
   */
  protected readonly assigneeDisplayValue: Signal<string> = computed(() => {
    const username = this.ownerUsernameValue();
    const person = findFormationPersonByUsername(this.people().people, username);
    if (person) {
      // A settings entry without a name falls back to its email as the name — never render that twice.
      return formatUserLabel(person.name === person.email ? null : person.name, person.email);
    }

    const owner = this.item()?.owner;
    if (owner && owner.username === username && owner.name && owner.name !== username) {
      return owner.name;
    }
    return username;
  });
  /**
   * Drives the footer's "Unsaved changes" indicator only (#2801) — Save itself stays always-enabled
   * because {@link onSaveDetails} must still run its GH-2694 typed-but-unselected assignee guard on
   * a form that looks unchanged. Mirrors that method's own diff rules: notes always count;
   * assignee/due-date differences count only when `canWrite()` (they are ignored at save time
   * otherwise) — that gate is what keeps a disabled due-date control (disabled whenever
   * `assignmentReadOnly()`) from reading as "cleared" in every state where the footer renders.
   * Reading the form through `getRawValue()` is defense in depth for the one state the gate does
   * not cover, `readOnly() && canWrite()`, where the footer is hidden but this signal still
   * computes. A successful save clears it synchronously through {@link optimisticItem}, before the
   * reload lands.
   */
  protected readonly hasUnsavedChanges: Signal<boolean> = computed(() => {
    const item = this.item();
    if (!item) return false;
    const form = this.formValue();
    if ((form.notes ?? '') !== (item.notes ?? '')) return true;
    if (!this.canWrite()) return false;
    if ((form.ownerUsername ?? '') !== (item.owner?.username ?? '')) return true;
    const dueDate = form.dueDate ? toLocalDateOnlyString(form.dueDate) : '';
    return dueDate !== (item.due_date ?? '');
  });

  public constructor() {
    // `[formControlName]` re-asserts the FormControl's own `disabled` state via `setDisabledState`
    // after every template input binds (Angular reactive-forms behaviour), which silently overrides a
    // plain `[disabled]` binding on the same element — so the due-date field must be disabled through
    // the FormControl itself, not the template. The notes field sidesteps this with `[readonly]` (a
    // plain attribute, not a forms-directive input), and the assignee field does the same by passing
    // `[readonly]` straight through to lfx-user-search — kept focusable and announced by assistive
    // tech (unlike `disabled`), matching notes rather than due-date. The due-date control disables on
    // `assignmentReadOnly()` (not just `readOnly()`): an auditor-only caller (canWrite false) may not
    // change it either — see `canWrite`'s doc comment.
    effect(() => {
      const dueDate = this.editForm.get('dueDate');
      if (this.assignmentReadOnly()) {
        dueDate?.disable({ emitEvent: false });
      } else {
        dueDate?.enable({ emitEvent: false });
      }
    });
    // Hand focus back on EVERY close path (#2801). PrimeNG only emits `onHide` from its own
    // hide(emit=true) (Escape/mask); this drawer's custom close button and the section's
    // post-Mark-complete close both set `visible` programmatically, which runs hide(false) and
    // never emits — so key off the model itself. A subscription rather than an `effect()`, per the
    // frontend checklist §5. Idempotent: the captured element is nulled after the first restore,
    // and the initial `false` finds nothing to restore.
    toObservable(this.visible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => this.restoreFocus());
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  /** Try again on the load-error card — re-runs the open transition (see {@link retry$}). */
  protected onRetry(): void {
    this.retry$.next();
  }

  /**
   * `p-drawer` never moves focus into the panel on open — it only traps Tab/Shift+Tab once focus is
   * already inside (`pFocusTrap` on its container). Captures the triggering element first so
   * {@link restoreFocus} can hand focus back on close, then lands on the title: it is the
   * `aria-labelledby` target, so a screen reader announces the dialog by the item's name (#2620).
   * Same shape as group-seat-holders-drawer's onDrawerShow.
   */
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();
  }

  protected onMarkComplete(): void {
    const item = this.item();
    // The template only renders this button for `in_progress` — guard here too since this method is
    // also reachable from tests/future callers that bypass the template's gating. Caller standing is
    // the statusActionsDisabled gate's canSetStatus half (GH-2705) — the BFF's fail-closed mirror of
    // the gateway's `writer_guard` + `member` on `team:formation` pair, which remains the enforcer.
    if (!item || this.statusActionsDisabled() || item.status !== 'in_progress') return;
    this.beginWrite(this.completingUids, item.uid);
    this.writeStarted.emit(item.uid);

    this.formationService
      .updateFormationItemStatus(item.project_uid, item.template_item_key, String(item.version), { status: 'done' })
      .pipe(
        take(1),
        finalize(() => {
          this.endWrite(this.completingUids, item.uid);
          this.writeEnded.emit(item.uid);
        })
      )
      .subscribe({
        next: ({ item: updated }) => {
          this.applyOptimisticItemIfStillShowing(updated);
          this.itemChanged.emit(updated);
          this.messageService.add({ severity: 'success', summary: 'Marked done', detail: `"${updated.title}" is done.` });
        },
        error: (error: unknown) => {
          console.error('[FormationItemDrawer] Mark complete failed', error);
          // GH-2328: a formation that turned `completed`/`frozen` between load and submit refuses the
          // write with `409 CHECKLIST_READ_ONLY` naming the reason — extractErrorMessage reads the
          // server's own `error` text (see `ConflictError`'s `toResponse`) instead of a generic fallback.
          // A caller whose `can_set_status` went stale gets the BFF's FORMATION_TEAM_REQUIRED
          // message the same way (GH-2705); only a stale local copy (412) still falls back to the
          // generic string.
          this.messageService.add({ severity: 'error', summary: 'Error', detail: extractErrorMessage(error, 'Could not mark this item done.') });
        },
      });
  }

  protected onSkip(): void {
    const item = this.item();
    // This button's own scope predates GH-2576 Phase 2 and keeps its original not_started-only
    // source (see formation-item-drawer.component.html's doc comment on this button for why it
    // stays narrower than the row overflow menu's "Skip with reason") — the template only renders
    // this button for that status, but guard here too for the same reason as `onMarkComplete`.
    if (!item || this.statusActionsDisabled() || item.status !== 'not_started') return;
    this.skipRequested.emit(item);
  }

  /**
   * lfx-user-search refuses a pick before touching `ownerUsername` at all — so unlike an earlier
   * version of this handler, there is nothing to restore here (a prior in-progress pick, or the
   * item's original owner, is simply left as-is). This is purely user feedback, telling them why
   * the pick didn't take: a local candidate refused as `disabled` carries its own reason (a pending
   * invitee's note, #2594); a directory result refused by `requireLfAccount` gets the
   * record-focused wording.
   */
  protected onAssigneeRejected(user: UserSearchOption): void {
    // `hasLfAccount`'s own doc comment (search.utils.ts) is explicit: a blank username means "no
    // LFID reconciled in this index yet", not a definitive "this person has no account anywhere"
    // claim — so the message describes the record, not the person's identity.
    this.messageService.add({
      severity: 'warn',
      summary: 'Cannot assign',
      detail: user.note ?? 'That search result has no resolvable LF username, so it cannot be assigned. Please choose someone else.',
    });
  }

  /**
   * Upstream's contract split notes off from assignee/due-date into two routes (PATCH item vs
   * POST .../assignment, GH-2576) — this one Save button issues each changed field as its own
   * sequential, version-chained write (each response's `version` becomes the next leg's `If-Match`;
   * sending them with the item's original version would race, the later one 412ing because the
   * earlier already advanced it). The assignee and due date are deliberately SEPARATE assignment
   * writes even though they share a route, with the due date first (GH-2694): upstream rejects a
   * combined body wholesale when the assignee is refused (`assignee_not_on_project` — e.g. a picker
   * result who holds no grant on the project, the #2594 corpus gap), which used to silently discard
   * the due date sent beside it. The assignee leg runs last because it is the one leg with a known
   * business-rule refusal, so its failure now costs nothing else; a failed leg is reported by name
   * (with everything that did land named too) instead of the old single generic error.
   */
  protected onSaveDetails(): void {
    const item = this.item();
    if (!item || this.busy()) return;

    const nextNotes = this.editForm.value.notes ?? '';
    const nextOwnerUsername = this.editForm.value.ownerUsername ?? '';
    const nextDueDate = this.editForm.value.dueDate ? toLocalDateOnlyString(this.editForm.value.dueDate) : '';
    const notesChanged = nextNotes !== (item.notes ?? '');
    // Assignee/due-date changes ride the writer-gated POST .../assignment route — an auditor-only
    // caller (canWrite false) may only save the note leg (Copilot review, PR #2613): their controls
    // are disabled via `assignmentReadOnly()`, and any stray difference is ignored here rather than
    // sent to a deterministic 403 that would report failure after the note leg already persisted.
    // This gate is also what stops a disabled due-date FormControl from synthesizing a change — a
    // disabled control drops out of `form.value`, so a set due date would otherwise read as '' and
    // look "cleared".
    const ownerChanged = this.canWrite() && nextOwnerUsername !== (item.owner?.username ?? '');
    const dueDateChanged = this.canWrite() && nextDueDate !== (item.due_date ?? '');

    // GH-2694, the observed production repro: an assignee typed into the search box but never
    // picked from its results never commits to `ownerUsername`, and lfx-user-search's snap-back —
    // fired by the blur that precedes this button's own click — has already wiped it from the
    // screen by the time this method runs. Saving past it recreates the observed bug: a "Saved"
    // that silently dropped the assignee. Checked here at save time rather than toasted at blur
    // time because blur equally precedes a dropdown pick's own click, so a blur-time notice would
    // false-fire on every successful mouse selection (GH-2694 review). Consuming clears the
    // record, so a deliberate second Save proceeds with everything that actually committed.
    if (!this.assignmentReadOnly()) {
      const discardedAssigneeText = this.assigneeSearch()?.consumeDiscardedText() ?? null;
      if (discardedAssigneeText !== null) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Assignee not selected',
          detail:
            `"${discardedAssigneeText}" was typed but not selected from the search results, so it cannot be assigned. ` +
            'Pick a person from the suggestions and save again — or just save again to keep your other changes.',
        });
        return;
      }
    }

    const legs: { label: 'note' | 'due date' | 'assignee'; write: (ifMatch: string) => Observable<FormationItemWriteResult> }[] = [];
    if (notesChanged) {
      legs.push({
        label: 'note',
        write: (ifMatch) => this.formationService.updateFormationItem(item.project_uid, item.template_item_key, ifMatch, { note: nextNotes }),
      });
    }
    if (dueDateChanged) {
      legs.push({
        label: 'due date',
        write: (ifMatch) => this.formationService.updateFormationItemAssignment(item.project_uid, item.template_item_key, ifMatch, { due_date: nextDueDate }),
      });
    }
    if (ownerChanged) {
      legs.push({
        label: 'assignee',
        write: (ifMatch) =>
          this.formationService.updateFormationItemAssignment(item.project_uid, item.template_item_key, ifMatch, { assignee: nextOwnerUsername }),
      });
    }
    if (legs.length === 0) {
      // GH-2694: the old silent return here was the other half of the observed bug — a Save that
      // sends nothing and says nothing is indistinguishable from one that worked, until the drawer
      // is reopened and the fields read empty. (Uncommitted picker text lands here: it never reaches
      // the form, so every diff above is false.)
      this.messageService.add({ severity: 'info', summary: 'Nothing to save', detail: 'No changes to save.' });
      return;
    }

    this.beginWrite(this.savingDetailsUids, item.uid);
    this.writeStarted.emit(item.uid);

    // Per-save closure state, written as the chain below runs: which legs landed (their responses
    // advanced the item's version upstream), and which leg the chain died on. Read only by the
    // subscribe handlers of this same save.
    const savedLabels: string[] = [];
    let lastSavedItem: FormationItem | null = null;
    let failedLabel = '';
    let failedIndex = -1;

    let chain$: Observable<FormationItemWriteResult> = of({ item, etag: null, item_state: 'complete' });
    for (const [index, leg] of legs.entries()) {
      chain$ = chain$.pipe(
        switchMap((previous) =>
          leg.write(String(previous.item.version)).pipe(
            tap((result) => {
              savedLabels.push(leg.label);
              lastSavedItem = result.item;
            }),
            catchError((error: unknown) => {
              // Deliberately NO tolerance for upstream's `no_fields_to_update` here: on these
              // routes the refusal is raised on field PRESENCE (item_mutator.go /
              // item_assignment.go check `p.X == nil`, never value equality), and every leg
              // above always puts its field in the body — so that reason on this chain means
              // the body was lost in transit, a genuine failure. Absorbing it as a no-op would
              // report a green "Saved" for a write that never landed, the exact GH-2694 defect
              // class. It surfaces via saveLegErrorDetail's server-authored message instead
              // (GH-2705; the body-loss anomaly itself is tracked separately).
              failedLabel = leg.label;
              failedIndex = index;
              throw error;
            })
          )
        )
      );
    }

    chain$
      .pipe(
        take(1),
        finalize(() => {
          this.endWrite(this.savingDetailsUids, item.uid);
          this.writeEnded.emit(item.uid);
        })
      )
      .subscribe({
        next: ({ item: updated }) => {
          // Consumed synchronously (not just via the reload below) so a second Save fired right after
          // this one — before the reload's GET has landed — reads the new version off `item()`
          // immediately instead of resending this write's now-stale one (Cursor Bugbot, PR #2613).
          this.applyOptimisticItemIfStillShowing(updated);
          this.itemUpdated.emit(updated);
          // Re-fetch so `item()`/`history()` in this still-open drawer reflect the save (the new
          // history entry included) instead of showing pre-save data until the drawer is reopened.
          this.reloadIfStillShowing(item);
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Item details updated.' });
        },
        error: (error: unknown) => {
          console.error('[FormationItemDrawer] Save details failed', error);
          const saved = lastSavedItem;
          if (saved) {
            // Every leg before the failed one already persisted and advanced the item's version
            // upstream — consume the last success synchronously (not just via the reload, which is
            // async and can't be waited on before a retry) so an immediate retry diffs against the
            // post-write item and resends ONLY the failed leg with the current `If-Match`, instead of
            // re-sending already-landed legs against their now-stale versions and 412ing (Cursor
            // Bugbot, PR #2613). `itemUpdated` fires too: the section's rows surface the assignee and
            // due date (GH-2692), so a partially-landed save must refresh them just like a full one.
            this.applyOptimisticItemIfStillShowing(saved);
            this.itemUpdated.emit(saved);
            this.reloadIfStillShowing(item);
          }
          // GH-2328: see the matching comment in onMarkComplete's error handler — a host that
          // doesn't bind `readOnly` still renders a completed/frozen formation's Save; naming the
          // server's real reason (via `saveLegErrorDetail`'s extractErrorMessage fallback) covers
          // that gap rather than plumbing lifecycle through FormationItemDetail.
          const specific = this.saveLegErrorDetail(error, failedLabel, nextOwnerUsername);
          // A failing MIDDLE leg terminates the chain, so legs behind it were never sent — say so
          // (GH-2694 review): naming only the landed and failed legs would silently drop e.g. an
          // assignee edit pending behind a failed due date, the very defect class this save exists
          // to remove. The form still holds those values, so "save again" resends exactly them.
          const unattempted = failedIndex >= 0 ? legs.slice(failedIndex + 1).map((leg) => leg.label) : [];
          const unattemptedNote =
            unattempted.length > 0 ? ` The ${unattempted.join(' and ')} ${unattempted.length > 1 ? 'were' : 'was'} not attempted — save again to retry.` : '';
          if (savedLabels.length > 0) {
            this.messageService.add({
              severity: 'warn',
              summary: 'Partially saved',
              detail: `The ${savedLabels.join(' and ')} saved, but the ${failedLabel} did not: ${specific}${unattemptedNote}`,
            });
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: `${specific}${unattemptedNote}` });
          }
        },
      });
  }

  /**
   * The still-showing check shared by every late write-resolution side effect — this drawer instance
   * is reused across every item it opens, so a write started on item A can resolve after the user has
   * since opened item B. Anything that mutates what the drawer currently shows (or refetches it) off
   * a write's response must first confirm the drawer hasn't moved on from the written item.
   */
  private isStillShowing(item: FormationItem): boolean {
    return this.itemProjectUid() === item.project_uid && this.itemKey() === item.template_item_key;
  }

  /**
   * Shared by the success path and the partial-failure path in {@link onSaveDetails} — only reloads
   * if the drawer is still showing the item this save was actually for; otherwise the reload would
   * fetch (and overwrite the form of) whatever item the user has since switched to, using this stale
   * save's response as the trigger.
   */
  private reloadIfStillShowing(item: FormationItem): void {
    if (this.isStillShowing(item)) this.reload$.next();
  }

  /**
   * The {@link optimisticItem} counterpart of {@link reloadIfStillShowing}'s guard — a write response
   * applied after the drawer has switched to a different item would flip `item()` back to the written
   * one while the form still holds the newly opened item's values, and the next Save would then write
   * those values onto the wrong item (Cursor Bugbot, PR #2613). The synchronous version-consume the
   * signal exists for (see its doc comment) is only meaningful while the written item is the one on
   * screen anyway.
   */
  private applyOptimisticItemIfStillShowing(item: FormationItem): void {
    if (this.isStillShowing(item)) this.optimisticItem.set(item);
  }

  /**
   * Names a failed save leg's reason in user terms (GH-2694). Switches on the BFF error body's
   * `code` — {@link https://github.com/linuxfoundation/lfx-self-serve/issues/2694 GH-2694}'s
   * `mapFormationWriteError` uppercases upstream's machine-readable `reason` into it (per the
   * service's rendering contract, wording lives here in the frontend, keyed on the stable
   * identifier) — and on a 403 for the writer-gated assignment legs, which upstream's guard refuses
   * for a caller without `project.writer`. Anything unrecognized falls through to
   * `extractErrorMessage`, which surfaces the server's own message rather than a fixed string.
   */
  private saveLegErrorDetail(error: unknown, failedLabel: string, attemptedAssignee: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 403 && failedLabel !== 'note') {
        return 'You need write access on this project to change the assignee or due date.';
      }
      const body: unknown = error.error;
      const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
      if (code === 'ASSIGNEE_NOT_ON_PROJECT') {
        return `"${attemptedAssignee}" doesn't hold a role on this project yet, so they can't be assigned. Add them to the project first.`;
      }
    }
    return extractErrorMessage(error, 'Could not save item details.');
  }

  private initOwnerUsernameValue(): Signal<string> {
    const ownerUsernameControl = this.editForm.controls.ownerUsername;
    return toSignal(
      ownerUsernameControl.valueChanges.pipe(
        startWith(ownerUsernameControl.value),
        map((value) => value ?? '')
      ),
      {
        initialValue: ownerUsernameControl.value ?? '',
      }
    );
  }

  private initFormValue(): Signal<FormationItemDrawerFormValue> {
    // `syncForm`'s `setValue` emits (default `emitEvent`), so the mirror re-syncs on every open; the
    // constructor's `disable/enable({ emitEvent: false })` deliberately does not, which is fine —
    // `getRawValue()` is read fresh on every emission and `hasUnsavedChanges`'s `canWrite()` gate
    // covers the disabled case.
    return toSignal(
      this.editForm.valueChanges.pipe(
        startWith(null),
        map(() => this.editForm.getRawValue())
      ),
      { initialValue: this.editForm.getRawValue() }
    );
  }

  private initPeople(): Signal<FormationPeopleResponse> {
    // Read on every open (this drawer instance is reused across items and the list can change
    // between opens — an invite from the People panel, say). The service memoises the read per
    // slug and the invite flow invalidates it, so reopening replays the sidebar card's own answer
    // rather than re-running the BFF's checklist gate, settings read and per-person metadata
    // fan-out. Read for readers too, not only writers: it is what lets a committed assignee render
    // as a name rather than a username. `getFormationPeople` never errors — it degrades to the
    // unavailable shape itself — so clearing `peopleLoading` on next is complete.
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap(() => {
          const slug = this.projectSlug();
          if (!this.visible() || !slug) {
            this.peopleLoading.set(false);
            return of(createUnavailableFormationPeopleResponse());
          }

          this.peopleLoading.set(true);
          return this.formationService.getFormationPeople(slug).pipe(tap(() => this.peopleLoading.set(false)));
        })
      ),
      { initialValue: createUnavailableFormationPeopleResponse() }
    );
  }

  private initDrawerData(): Signal<FormationDrawerData> {
    // Tagged so a post-save `reload$` refetch (item still open, already showing real data) doesn't
    // drive the same `loading`/`loadFailed` signals as the open-transition fetch — those flip the
    // template to a full-body spinner/error state, which would blank a drawer the user just
    // successfully saved into. `lastData` lets a reload failure keep showing the pre-reload item
    // instead of falling back to empty.
    let lastData: FormationDrawerData = createEmptyFormationDrawerData();
    const openTrigger$ = toObservable(this.visible).pipe(
      skip(1),
      map(() => 'open' as const)
    );
    const reloadTrigger$ = this.reload$.pipe(map(() => 'reload' as const));
    // A failed open fetch's Try again (#2801) — tagged 'open', not 'reload', so it re-runs the full
    // open transition: loadFailed cleared, the skeleton shown, optimistic state dropped, and the
    // form re-synced from the fresh item (a 'reload' tag would skip all four).
    const retryTrigger$ = this.retry$.pipe(map(() => 'open' as const));

    return toSignal(
      merge(openTrigger$, reloadTrigger$, retryTrigger$).pipe(
        switchMap((trigger) => {
          const projectUid = this.itemProjectUid();
          const itemKey = this.itemKey();
          if (!this.visible() || !projectUid || !itemKey) {
            lastData = createEmptyFormationDrawerData();
            return of(lastData);
          }

          if (trigger === 'open') {
            this.loadFailed.set(false);
            this.loading.set(true);
            // A different item may be opening (this drawer instance is reused) — an optimistic value
            // from whatever item was previously shown must not leak into it.
            this.optimisticItem.set(null);
          }

          return this.formationService.getFormationItem(projectUid, itemKey).pipe(
            tap((data) => {
              // Only re-sync the form on the initial open, not on a post-save `reload$` refetch — a
              // successful save's reload would just be re-syncing the form to what the user already
              // typed (harmless but pointless), while a *partial*-failure reload (Save's assignment
              // leg 412ed after the note leg already persisted, see `onSaveDetails`) must NOT clobber
              // the assignee/due-date edit still sitting unsaved in the form with the server's
              // pre-write values — that would silently drop the very edit the reload exists to let
              // the user retry (Cursor Bugbot, PR #2613).
              if (trigger === 'open') this.syncForm(data.item);
              // The real fetch is now the authoritative source regardless of trigger — any optimistic
              // value a write set (above) has served its purpose (unblocking an immediate retry) and
              // must not keep shadowing `item()` past this point.
              this.optimisticItem.set(null);
              lastData = data;
            }),
            catchError((error: unknown) => {
              console.error('[FormationItemDrawer] Failed to load formation item', error);
              if (trigger === 'open') {
                lastData = createEmptyFormationDrawerData();
                this.loadFailed.set(true);
                return of(lastData);
              }
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not refresh this item.' });
              return of(lastData);
            }),
            finalize(() => {
              if (trigger === 'open') this.loading.set(false);
            })
          );
        })
      ),
      { initialValue: createEmptyFormationDrawerData() }
    );
  }

  private syncForm(item: FormationItem): void {
    this.editForm.setValue({
      notes: item.notes ?? '',
      ownerUsername: item.owner?.username ?? '',
      // `item.due_date` is a bare `YYYY-MM-DD` — `new Date(...)` would parse it as UTC midnight,
      // rendering the previous day in the picker for any viewer west of UTC, and `toLocalDateOnlyString`
      // above would then faithfully save that wrong day back. `tryParseLocalDateString` reads it as a
      // local calendar day so the load->save round-trip is symmetric, and returns null instead of
      // throwing on a malformed value, so a bad date empties the picker rather than failing the load.
      dueDate: tryParseLocalDateString(item.due_date),
    });
  }

  /** Shared by completingUids/savingDetailsUids — mirrors the section's own beginSubmitting/endSubmitting pair. */
  private beginWrite(tracker: WritableSignal<ReadonlySet<string>>, uid: string): void {
    tracker.update((uids) => new Set(uids).add(uid));
  }

  private endWrite(tracker: WritableSignal<ReadonlySet<string>>, uid: string): void {
    tracker.update((uids) => {
      const next = new Set(uids);
      next.delete(uid);
      return next;
    });
  }

  /** The close-side half of {@link onDrawerShow} — see the constructor's `visible` subscription for why this is not wired to `(onHide)`. */
  private restoreFocus(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.previouslyFocusedElement?.isConnected) {
      this.previouslyFocusedElement.focus();
    }
    this.previouslyFocusedElement = null;
  }
}
