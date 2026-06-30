// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter, firstValueFrom } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { Announcement, InitiativeDetail } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';

@Component({
  selector: 'lfx-settings-announcements-tab',
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialogModule, ButtonComponent, InputTextComponent, RichEditorComponent],
  providers: [ConfirmationService],
  templateUrl: './settings-announcements-tab.component.html',
})
export class SettingsAnnouncementsTabComponent {
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly showAddForm = signal(false);

  protected readonly addForm = new FormGroup({
    title: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    description: new FormControl('', [Validators.required]),
  });

  protected readonly editForm = new FormGroup({
    title: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    description: new FormControl('', [Validators.required]),
  });

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => this.loadAnnouncements());
  }

  protected startAdd(): void {
    this.showAddForm.set(true);
    this.editingId.set(null);
    this.addForm.reset();
  }

  protected cancelAdd(): void {
    this.showAddForm.set(false);
    this.addForm.reset();
  }

  protected startEdit(a: Announcement): void {
    this.editingId.set(a.id);
    this.showAddForm.set(false);
    this.editForm.reset({ title: a.title, description: a.description });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editForm.reset();
  }

  protected async onAdd(): Promise<void> {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    try {
      const { title, description } = this.addForm.value as { title: string; description: string };
      const created = await firstValueFrom(this.crowdfundingService.createAnnouncement(this.initiative().id, { title, description }));
      this.announcements.update((list) => [created, ...list]);
      this.showAddForm.set(false);
      this.addForm.reset();
      this.messageService.add({ severity: 'success', summary: 'Added', detail: 'Announcement added.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to add announcement. Please try again.' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async onEdit(a: Announcement): Promise<void> {
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    try {
      const { title, description } = this.editForm.value as { title: string; description: string };
      const updated = await firstValueFrom(this.crowdfundingService.updateAnnouncement(this.initiative().id, a.id, { title, description }));
      this.announcements.update((list) => list.map((item) => (item.id === a.id ? { ...item, ...updated } : item)));
      this.editingId.set(null);
      this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Announcement updated.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update announcement. Please try again.' });
    } finally {
      this.saving.set(false);
    }
  }

  protected onDelete(a: Announcement): void {
    this.confirmationService.confirm({
      key: 'settings-announcements',
      header: 'Delete announcement?',
      message: `"${a.title}" will be permanently deleted.`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => void this.runDelete(a),
    });
  }

  private async runDelete(a: Announcement): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(this.crowdfundingService.deleteAnnouncement(this.initiative().id, a.id));
      this.announcements.update((list) => list.filter((item) => item.id !== a.id));
      if (this.editingId() === a.id) this.editingId.set(null);
      this.messageService.add({ severity: 'success', summary: 'Deleted', detail: 'Announcement deleted.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete announcement. Please try again.' });
    } finally {
      this.saving.set(false);
    }
  }

  private async loadAnnouncements(): Promise<void> {
    this.loading.set(true);
    this.showAddForm.set(false);
    this.editingId.set(null);
    try {
      const result = await firstValueFrom(this.crowdfundingService.getAnnouncements(this.initiative().id));
      this.announcements.set(result.data);
    } finally {
      this.loading.set(false);
    }
  }
}
