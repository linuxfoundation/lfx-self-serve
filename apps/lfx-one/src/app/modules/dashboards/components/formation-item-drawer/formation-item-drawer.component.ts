// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, effect, ElementRef, inject, input, model, output, PLATFORM_ID, signal, Signal, viewChild, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { FormationService } from '@services/formation.service';
import type { FormationDrawerData, FormationItem, FormationItemWriteResult } from '@lfx-one/shared/interfaces';
import { createEmptyFormationDrawerData, FORMATION_ITEM_STATUS_LABELS, FORMATION_ITEM_STATUS_SEVERITY } from '@lfx-one/shared/constants';
import { formationItemHasAction, getFormationActivityDisplay, isValidUrl, toLocalDateOnlyString, tryParseLocalDateString } from '@lfx-one/shared/utils';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, filter, finalize, map, merge, Observable, of, skip, startWith, Subject, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-formation-item-drawer',
  imports: [DrawerModule, ReactiveFormsModule, ButtonComponent, TagComponent, TextareaComponent, UserSearchComponent, CalendarComponent, DatePipe],
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
   * (Copilot review, PR #2613). Both hosts now bind it (GH-2694): `formation-checklist-section`
   * from the checklist response's per-caller `can_write`, and `dashboard-formation-item-drawer-host`
   * from the Me-lens row's own `can_write` — the `true` default only covers a host that omits the
   * input, and is NOT a statement that any current host does.
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
   * True when the drawer was opened from the Me-lens Pending Actions flow, where GH-1956 decision 3
   * forbids the assignee from setting item status at all ("No 'Mark done'" — claim/block/open only,
   * with status changes left to the formation team). Hides Mark complete/Accept/Skip entirely rather
   * than merely disabling them, unlike `canWrite` above which still shows the controls (disabled, with
   * an explanatory message) since that's a real-access question rather than a flow restriction.
   * Defaults `false` so `formation-checklist-section`'s existing usage, which doesn't pass this input,
   * is unaffected (copilot review, PR #2309).
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

  /**
   * The assignee search box — queried so {@link onSaveDetails} can ask it (via
   * `consumeDiscardedText`) whether the blur that preceded the Save click just threw away
   * typed-but-unselected text (GH-2694). Renders inside the p-drawer body, so it only exists while
   * the drawer is open — exactly the times Save is clickable.
   */
  private readonly assigneeSearch = viewChild(UserSearchComponent);
  // The drawer's real panel is PrimeNG-managed and moved to document.body (appendTo: 'body'), so
  // it isn't reachable as a child of this component's own host element — this is a template ref
  // into our own #titleRef heading (which PrimeNG embeds into that panel), not a DOM query.
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');
  private previouslyFocusedElement: HTMLElement | null = null;

  protected readonly loading: WritableSignal<boolean> = signal(false);
  protected readonly loadFailed: WritableSignal<boolean> = signal(false);
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
  protected readonly drawerData: Signal<FormationDrawerData> = this.initDrawerData();
  protected readonly item = computed(() => this.optimisticItem() ?? this.drawerData().item);
  protected readonly history = computed(() => this.drawerData().history);
  /**
   * GH-2620: the drawer's `aria-labelledby` points at this heading — it must never render empty.
   * `item()` is `null` for the entire loading window (and forever, on `loadFailed()`), and
   * `onDrawerShow()` moves focus onto this heading as soon as the panel opens, well before the
   * fetch resolves — an empty fallback would announce a nameless dialog with a blank heading,
   * the exact defect this ticket set out to fix.
   */
  protected readonly drawerHeading: Signal<string> = computed(() => this.item()?.title ?? (this.loadFailed() ? 'Unable to load item' : 'Loading item…'));
  /** Distinguishes the History panel's honest empty/failed states (GH-2372) — see `FormationActivityHistoryState`'s doc comment. */
  protected readonly historyState = computed(() => this.drawerData().history_state);
  /**
   * Precomputed per-entry summary/detail so the template never calls a function per
   * change-detection cycle — same reason `committee-overview.component.ts` precomputes
   * `formatRelativeTime` instead of calling it from the template.
   */
  protected readonly historyEntries = computed(() => this.history().map((entry) => ({ entry, ...getFormationActivityDisplay(entry) })));
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
  /** Sub-item rows for the template, with status pre-resolved to its chip label/severity — same maps the parent item's own status chip uses. Templates may only read signals/pipes, not call methods. */
  protected readonly subItemRows = computed(() =>
    (this.item()?.sub_items ?? []).map((subItem) => ({
      ...subItem,
      statusLabel: FORMATION_ITEM_STATUS_LABELS[subItem.status],
      statusSeverity: FORMATION_ITEM_STATUS_SEVERITY[subItem.status],
    }))
  );
  /**
   * The committed assignee label bound into lfx-user-search's `[displayValue]` — `FormationUser`
   * has no separate name/email to compose (name === username today — see the mapper at
   * `formation-mapper.helper.ts`'s `owner: raw.assignee ? { username: raw.assignee, name:
   * raw.assignee } : null`), so the label is just the current control value. `editForm` is a plain
   * instance field here (not a signal input like meeting-details' `form()`), so this reads the
   * control's own valueChanges directly rather than needing a `toObservable(this.form)` wrapper.
   */
  protected readonly assigneeDisplayValue: Signal<string> = this.initAssigneeDisplayValue();

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

    // Restores focus to whatever opened the drawer whenever `visible` goes false — reacting to
    // the signal itself (via toObservable, not effect() — frontend-checklist.md §5 disfavors
    // effect() outside logging/debugging), not PrimeNG's `(onHide)` output, deliberately. Traced
    // against primeng@20.4.0's Drawer source: `onHide` only fires when something calls Drawer's
    // own `close()` (its built-in close button, the Escape document-listener, or a dismissible
    // mask-click) — `onAnimationEnd`'s `'void'` branch, which runs for every other way `visible`
    // becomes false, always calls `hide(false)`, which explicitly suppresses that emit. This
    // drawer's own close button is hand-rolled ([showCloseIcon]="false", onClose() below just
    // sets `visible` false directly) — exactly the path `(onHide)` misses, and the most common
    // way this drawer closes. Watching `visible()` catches that path, Escape, mask-click, and
    // any host-driven close (e.g. dashboard-formation-item-drawer-host's Mark-complete/Skip
    // success handlers) uniformly, with no extra wiring. Opening is still handled by
    // onDrawerShow() below via PrimeNG's (onShow), not here — that one needs the drawer's real
    // DOM to exist first (for titleRef to resolve), which this subscription isn't guaranteed to
    // have on the same tick `visible` flips true.
    toObservable(this.visible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        if (!isPlatformBrowser(this.platformId)) return;
        if (this.previouslyFocusedElement?.isConnected) {
          this.previouslyFocusedElement.focus();
        }
        this.previouslyFocusedElement = null;
      });
  }

  // PrimeNG's p-drawer doesn't move focus into the panel on open — it only traps Tab/Shift+Tab
  // once focus is already inside (pFocusTrap, applied unconditionally on its container).
  // Captures the triggering element before moving focus in, so the subscription above can
  // restore it. Focuses the title, not the close button or a bare container: it's already this drawer's
  // `aria-labelledby` target, so landing here announces the item title immediately, giving a
  // screen-reader user context before anything else — including before the first form field
  // (Notes), which would otherwise drop them mid-form with no idea which item they're editing.
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();
  }

  protected onClose(): void {
    this.visible.set(false);
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
   * lfx-user-search's `requireLfAccount` guard rejects a no-account pick before touching
   * `ownerUsername` at all — so unlike an earlier version of this handler, there is nothing to
   * restore here (a prior in-progress pick, or the item's original owner, is simply left as-is).
   * This is purely user feedback, telling them why the pick didn't take.
   */
  protected onAssigneeRejected(): void {
    // `hasLfAccount`'s own doc comment (search.utils.ts) is explicit: a blank username means "no
    // LFID reconciled in this index yet", not a definitive "this person has no account anywhere"
    // claim — so the message describes the record, not the person's identity.
    this.messageService.add({
      severity: 'warn',
      summary: 'Cannot assign',
      detail: 'That search result has no resolvable LF username, so it cannot be assigned. Please choose someone else.',
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
          // GH-2328: see the matching comment in onMarkComplete's error handler — this drawer host
          // (dashboard-formation-item-drawer-host) doesn't have its own `readOnly` input, so a
          // completed/frozen formation's Save still renders; naming the server's real reason (via
          // `saveLegErrorDetail`'s extractErrorMessage fallback) covers that gap rather than plumbing
          // lifecycle through FormationItemDetail.
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

  private initAssigneeDisplayValue(): Signal<string> {
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

    return toSignal(
      merge(openTrigger$, reloadTrigger$).pipe(
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
}
