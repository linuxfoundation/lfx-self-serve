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
  public readonly visible = model<boolean>(false);

  /** Fired for a status-changing action (Mark complete) — the section closes the drawer and refreshes the row list. */
  public readonly itemChanged = output<FormationItem>();
  /** Fired for a metadata-only save (notes/assignee/due-date) — the section refreshes the row list but leaves the drawer open. */
  public readonly itemUpdated = output<FormationItem>();
  public readonly skipRequested = output<FormationItem>();

  protected readonly editForm = new FormGroup({
    notes: new FormControl<string>(''),
    ownerUsername: new FormControl<string>(''),
    dueDate: new FormControl<Date | null>(null),
  });

  private readonly reload$ = new Subject<void>();

  protected readonly loading: WritableSignal<boolean> = signal(false);
  protected readonly loadFailed: WritableSignal<boolean> = signal(false);
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
    if (!item) return;

    this.formationService
      .completeFormationItem(item.uid)
      .pipe(take(1))
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
    if (item) this.skipRequested.emit(item);
  }

  protected onSaveDetails(): void {
    const item = this.item();
    if (!item) return;

    this.formationService
      .updateFormationItem(item.uid, {
        notes: this.editForm.value.notes ?? '',
        owner_username: this.editForm.value.ownerUsername ?? '',
        due_date: this.editForm.value.dueDate ? this.editForm.value.dueDate.toISOString() : null,
      })
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.itemUpdated.emit(updated);
          // Re-fetch so `item()`/`history()` in this still-open drawer reflect the save (the new
          // history entry included) instead of showing pre-save data until the drawer is reopened.
          this.reload$.next();
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
