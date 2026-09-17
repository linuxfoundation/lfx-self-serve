// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, effect, inject, input, model, output, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { FormationService } from '@services/formation.service';
import type { FormationDrawerData, FormationItem } from '@lfx-one/shared/interfaces';
import { createEmptyFormationDrawerData, FORMATION_ITEM_STATUS_LABELS, FORMATION_ITEM_STATUS_SEVERITY } from '@lfx-one/shared/constants';
import { formationItemHasAction, getFormationActivityDisplay, isValidUrl, toLocalDateOnlyString, tryParseLocalDateString } from '@lfx-one/shared/utils';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, finalize, map, merge, of, skip, startWith, Subject, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-formation-item-drawer',
  imports: [DrawerModule, ReactiveFormsModule, ButtonComponent, TagComponent, TextareaComponent, UserSearchComponent, CalendarComponent, DatePipe],
  templateUrl: './formation-item-drawer.component.html',
  styleUrl: './formation-item-drawer.component.scss',
})
export class FormationItemDrawerComponent {
  private readonly formationService = inject(FormationService);
  private readonly messageService = inject(MessageService);

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
   * Whether the caller has real project write access — Mark complete and Skip both hard-require
   * `project.writer` upstream via the gateway's `writer_guard` on `POST .../status` (a gating item
   * additionally requires `member` on `team:formation`, which this component has no client-visible
   * signal for — see `formation-checklist-row.component.ts`'s `buildStatusMenuItems` doc comment),
   * independent of the item's own `available_actions`-derived affordance signals (GH-2576, formerly
   * `can_complete`; copilot review: those signals are item-scoped and advisory, not a real
   * write-access check, so an auditor-only assignee would otherwise see enabled buttons that always
   * 403). Gates {@link statusActionsDisabled} (Mark complete/Skip), not {@link busy} — Save's
   * note-only leg doesn't need this: the PATCH item route is gated on read access (`auditor_guard`)
   * upstream, per the GH-2576 guard-tier audit, so a caller with `canWrite() === false` can still
   * save a note. An assignee/due-date change within the same save still needs write access; a caller
   * lacking it gets that leg's own 403, surfaced as an error toast, consistent with how Mark
   * complete/Skip already handle an access shortfall the gateway alone can catch. Defaults `true` so
   * `formation-checklist-section`'s existing usage, which doesn't pass this input, is unaffected.
   */
  public readonly canWrite = input<boolean>(true);
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
  /** Mark complete/Skip both hard-require project write access upstream (see `canWrite`'s doc comment) — Save is gated by {@link busy} alone. */
  protected readonly statusActionsDisabled: Signal<boolean> = computed(() => this.busy() || !this.canWrite());
  protected readonly drawerData: Signal<FormationDrawerData> = this.initDrawerData();
  protected readonly item = computed(() => this.drawerData().item);
  protected readonly history = computed(() => this.drawerData().history);
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
    // `[readonly]="readOnly()"` straight through to lfx-user-search — kept focusable and announced by
    // assistive tech (unlike `disabled`), matching notes rather than due-date.
    effect(() => {
      const dueDate = this.editForm.get('dueDate');
      if (this.readOnly()) {
        dueDate?.disable({ emitEvent: false });
      } else {
        dueDate?.enable({ emitEvent: false });
      }
    });
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected onMarkComplete(): void {
    const item = this.item();
    // The template only renders this button for `in_progress` — guard here too since this method is
    // also reachable from tests/future callers that bypass the template's gating. Whether the caller
    // may actually close this item is enforced upstream by the API gateway (`writer_guard` + `member`
    // on `team:formation`, GH-2576) — this component has no way to check that itself.
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
          this.itemChanged.emit(updated);
          this.messageService.add({ severity: 'success', summary: 'Marked done', detail: `"${updated.title}" is done.` });
        },
        error: (error: unknown) => {
          console.error('[FormationItemDrawer] Mark complete failed', error);
          // GH-2328: a formation that turned `completed`/`frozen` between load and submit refuses the
          // write with `409 CHECKLIST_READ_ONLY` naming the reason — extractErrorMessage reads the
          // server's own `error` text (see `ConflictError`'s `toResponse`) instead of a generic fallback.
          // A stale local copy (412) or a caller not on team:formation (403) both fall back to the
          // same generic message today — no formation-specific reason→copy mapping exists yet.
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
   * POST .../assignment, GH-2576) — this one Save button still issues both when both changed, kept
   * as a single combined control rather than two (per the phase's minimal-wiring scope) rather than
   * duplicating the diffing UI would need to offer two independent Save actions. When both changed,
   * the note write runs first and its response's `version` becomes the `If-Match` for the assignment
   * write — sending both with the item's original version would race (the second to reach upstream
   * would 412, since the first already advanced it).
   */
  protected onSaveDetails(): void {
    const item = this.item();
    if (!item || this.busy()) return;

    const nextNotes = this.editForm.value.notes ?? '';
    const nextOwnerUsername = this.editForm.value.ownerUsername ?? '';
    const nextDueDate = this.editForm.value.dueDate ? toLocalDateOnlyString(this.editForm.value.dueDate) : '';
    const notesChanged = nextNotes !== (item.notes ?? '');
    const ownerChanged = nextOwnerUsername !== (item.owner?.username ?? '');
    const dueDateChanged = nextDueDate !== (item.due_date ?? '');

    if (!notesChanged && !ownerChanged && !dueDateChanged) return;

    this.beginWrite(this.savingDetailsUids, item.uid);
    this.writeStarted.emit(item.uid);

    const noteWrite$ = notesChanged
      ? this.formationService.updateFormationItem(item.project_uid, item.template_item_key, String(item.version), { note: nextNotes })
      : of({ item, etag: null });
    const assignmentPatch = { ...(ownerChanged && { assignee: nextOwnerUsername }), ...(dueDateChanged && { due_date: nextDueDate }) };

    noteWrite$
      .pipe(
        switchMap(({ item: afterNoteWrite }) =>
          ownerChanged || dueDateChanged
            ? this.formationService
                .updateFormationItemAssignment(item.project_uid, item.template_item_key, String(afterNoteWrite.version), assignmentPatch)
                .pipe(
                  catchError((error: unknown) => {
                    // The note write above already succeeded and advanced the item's version upstream —
                    // reload so a retry resends only the assignment leg with a current `If-Match`, instead
                    // of also resending the note (which already landed) against its now-stale version and
                    // getting a spurious 412 (GH-2613 review). Only the note leg can have advanced the
                    // version here; a no-op noteWrite$ (notesChanged false) never changed it, so nothing
                    // needs reloading in that case.
                    if (notesChanged) this.reloadIfStillShowing(item);
                    throw error;
                  })
                )
            : of({ item: afterNoteWrite, etag: null })
        ),
        take(1),
        finalize(() => {
          this.endWrite(this.savingDetailsUids, item.uid);
          this.writeEnded.emit(item.uid);
        })
      )
      .subscribe({
        next: ({ item: updated }) => {
          this.itemUpdated.emit(updated);
          // Re-fetch so `item()`/`history()` in this still-open drawer reflect the save (the new
          // history entry included) instead of showing pre-save data until the drawer is reopened.
          this.reloadIfStillShowing(item);
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Item details updated.' });
        },
        error: (error: unknown) => {
          console.error('[FormationItemDrawer] Save details failed', error);
          // GH-2328: see the matching comment in onMarkComplete's error handler — this drawer host
          // (dashboard-formation-item-drawer-host) doesn't have its own `readOnly` input, so a
          // completed/frozen formation's Save still renders; naming the server's real reason here is
          // the fallback for that gap rather than plumbing lifecycle through FormationItemDetail. A
          // partial failure (note saved, assignment 412'd) is reported as one generic error — the
          // reload triggered above (when the note leg actually ran) already refreshes this drawer's
          // local state so a retry only resends the assignment leg, not the already-persisted note.
          this.messageService.add({ severity: 'error', summary: 'Error', detail: extractErrorMessage(error, 'Could not save item details.') });
        },
      });
  }

  /**
   * Shared by the success path and the partial-failure path in {@link onSaveDetails} — only reloads
   * if the drawer is still showing the item this save was actually for; otherwise the reload would
   * fetch (and overwrite the form of) whatever item the user has since switched to, using this stale
   * save's response as the trigger.
   */
  private reloadIfStillShowing(item: FormationItem): void {
    if (this.itemProjectUid() === item.project_uid && this.itemKey() === item.template_item_key) this.reload$.next();
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
          }

          return this.formationService.getFormationItem(projectUid, itemKey).pipe(
            tap((data) => {
              this.syncForm(data.item);
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
