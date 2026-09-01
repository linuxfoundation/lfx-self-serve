// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, input, model, output, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { FormationService } from '@services/formation.service';
import type { FormationDrawerData, FormationItem, FormationItemLink } from '@lfx-one/shared/interfaces';
import { createEmptyFormationDrawerData } from '@lfx-one/shared/constants';
import { isValidUrl } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, finalize, map, merge, of, skip, Subject, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-formation-item-drawer',
  imports: [DrawerModule, ReactiveFormsModule, ButtonComponent, TagComponent, TextareaComponent, InputTextComponent, CalendarComponent, DatePipe],
  templateUrl: './formation-item-drawer.component.html',
  styleUrl: './formation-item-drawer.component.scss',
})
export class FormationItemDrawerComponent {
  private readonly formationService = inject(FormationService);
  private readonly messageService = inject(MessageService);

  public readonly itemUid = input<string | null>(null);
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
    ownerUsername: new FormControl<string>(''),
    dueDate: new FormControl<Date | null>(null),
  });

  public readonly visible = model<boolean>(false);

  private readonly reload$ = new Subject<void>();

  protected readonly loading: WritableSignal<boolean> = signal(false);
  protected readonly loadFailed: WritableSignal<boolean> = signal(false);
  /**
   * Which item uid Mark complete/Save is currently writing, not just whether *something* is writing
   * — this drawer component instance is reused across every item it ever opens, so a plain boolean
   * would still read true for a newly-opened item B while a *previous* item A's write is still
   * settling, and (worse) A's `finalize` clearing a shared boolean would wrongly clear B's own
   * still-in-flight write. `completing`/`savingDetails` below derive from these against the
   * currently-open item, so switching items automatically (not via an explicit reset) scopes each
   * flag to the write it actually belongs to.
   */
  protected readonly completingUid: WritableSignal<string | null> = signal(null);
  protected readonly savingDetailsUid: WritableSignal<string | null> = signal(null);
  /**
   * Separate per-action signals, each driving only its own button's `[loading]` — a single shared
   * flag would spin the Save button while Mark complete is in flight (and vice versa), a spinner on
   * a button the user never pressed. Both are still checked in each handler's guard, not just their
   * own, since the two write the same item and must not run concurrently.
   */
  protected readonly completing: Signal<boolean> = computed(() => this.completingUid() !== null && this.completingUid() === this.item()?.uid);
  protected readonly savingDetails: Signal<boolean> = computed(() => this.savingDetailsUid() !== null && this.savingDetailsUid() === this.item()?.uid);
  /**
   * Every write this drawer can trigger against the open item — Mark complete, Save, and (via
   * `mutationInFlight`) the section-owned Skip/row-action mutation. All three write the same item,
   * so any one of them in flight must block the other two, not just its own button.
   */
  protected readonly busy: Signal<boolean> = computed(() => this.completing() || this.savingDetails() || this.mutationInFlight());
  protected readonly drawerData: Signal<FormationDrawerData> = this.initDrawerData();
  protected readonly item = computed(() => this.drawerData().item);
  protected readonly history = computed(() => this.drawerData().history);
  /** `link.href` is API-sourced — never trust it into `[href]` unvalidated; drop anything that isn't http(s). */
  protected readonly safeLinks: Signal<FormationItemLink[]> = computed(() => (this.item()?.links ?? []).filter((link) => isValidUrl(link.href)));

  protected onClose(): void {
    this.visible.set(false);
  }

  protected onMarkComplete(): void {
    const item = this.item();
    if (!item || this.busy()) return;
    this.completingUid.set(item.uid);
    this.writeStarted.emit(item.uid);

    this.formationService
      .completeFormationItem(item.uid)
      .pipe(
        take(1),
        finalize(() => {
          // Only clear if this write is still the one `completingUid` is tracking — if the drawer
          // switched away and back (or another Mark complete somehow started for this same uid
          // again), an unconditional clear here could drop a different write's own flag.
          if (this.completingUid() === item.uid) this.completingUid.set(null);
          this.writeEnded.emit(item.uid);
        })
      )
      .subscribe({
        next: (updated) => {
          this.itemChanged.emit(updated);
          this.messageService.add({ severity: 'success', summary: 'Marked done', detail: `"${updated.title}" is done.` });
        },
        error: (error: unknown) => {
          console.error('[FormationItemDrawer] Mark complete failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not mark this item done.' });
        },
      });
  }

  protected onSkip(): void {
    const item = this.item();
    if (!item || this.busy()) return;
    this.skipRequested.emit(item);
  }

  protected onSaveDetails(): void {
    const item = this.item();
    if (!item || this.busy()) return;
    this.savingDetailsUid.set(item.uid);
    this.writeStarted.emit(item.uid);

    this.formationService
      .updateFormationItem(item.uid, {
        notes: this.editForm.value.notes ?? '',
        owner_username: this.editForm.value.ownerUsername ?? '',
        due_date: this.editForm.value.dueDate ? this.editForm.value.dueDate.toISOString() : null,
      })
      .pipe(
        take(1),
        finalize(() => {
          if (this.savingDetailsUid() === item.uid) this.savingDetailsUid.set(null);
          this.writeEnded.emit(item.uid);
        })
      )
      .subscribe({
        next: (updated) => {
          this.itemUpdated.emit(updated);
          // Re-fetch so `item()`/`history()` in this still-open drawer reflect the save (the new
          // history entry included) instead of showing pre-save data until the drawer is reopened —
          // but only if the drawer is still showing the item this save was actually for; otherwise
          // the reload would fetch (and overwrite the form of) whatever item the user has since
          // switched to, using this stale save's response as the trigger.
          if (this.itemUid() === item.uid) this.reload$.next();
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Item details updated.' });
        },
        error: (error: unknown) => {
          console.error('[FormationItemDrawer] Save details failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not save item details.' });
        },
      });
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
          const uid = this.itemUid();
          if (!this.visible() || !uid) {
            lastData = createEmptyFormationDrawerData();
            return of(lastData);
          }

          if (trigger === 'open') {
            this.loadFailed.set(false);
            this.loading.set(true);
          }

          return this.formationService.getFormationItem(uid).pipe(
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
      dueDate: item.due_date ? new Date(item.due_date) : null,
    });
  }
}
