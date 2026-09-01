// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, input, model, output, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { FormationService } from '@services/formation.service';
import type { FormationActivity, FormationItem } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, of, skip, switchMap, take, tap } from 'rxjs';

interface DrawerData {
  item: FormationItem | null;
  history: FormationActivity[];
}

const EMPTY_DATA: DrawerData = { item: null, history: [] };

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

  public readonly itemChanged = output<FormationItem>();
  public readonly skipRequested = output<FormationItem>();

  protected readonly loading: Signal<boolean> = computed(() => this.drawerData() === EMPTY_DATA && this.visible());
  protected readonly drawerData: Signal<DrawerData> = this.initDrawerData();
  protected readonly item = computed(() => this.drawerData().item);
  protected readonly history = computed(() => this.drawerData().history);

  protected readonly editForm = new FormGroup({
    notes: new FormControl<string>(''),
    ownerUsername: new FormControl<string>(''),
    dueDate: new FormControl<Date | null>(null),
  });

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
        error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not mark this item done.' }),
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
          this.itemChanged.emit(updated);
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Item details updated.' });
        },
        error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not save item details.' }),
      });
  }

  private initDrawerData(): Signal<DrawerData> {
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((isVisible) => {
          const uid = this.itemUid();
          if (!isVisible || !uid) {
            return of(EMPTY_DATA);
          }

          return this.formationService.getFormationItem(uid).pipe(
            tap((data) => this.syncForm(data.item)),
            catchError(() => of(EMPTY_DATA))
          );
        })
      ),
      { initialValue: EMPTY_DATA }
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
