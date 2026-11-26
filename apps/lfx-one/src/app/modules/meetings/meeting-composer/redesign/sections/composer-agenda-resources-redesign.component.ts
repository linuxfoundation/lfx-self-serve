// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, signal, type Signal, TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import { httpsUrlValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { touchedInvalidSignal } from '@shared/utils/form-control-signals.util';

import { ComposerAgendaResourcesComponent } from '../../sections/composer-agenda-resources.component';
import { ComposerAgendaFieldRedesignComponent } from './composer-agenda-field-redesign.component';

/**
 * Agenda & resources section of the redesigned meeting composer.
 * @description Extends the drawer's section so file validation, pending uploads, saved-file deletion with undo and link removal
 * stay shared. Adds a drop zone and opens Add link in a uikit modal, so it stacks above the composer modal.
 */
@Component({
  selector: 'lfx-composer-agenda-resources-redesign',
  imports: [ReactiveFormsModule, FileSizePipe, UiButtonComponent, UiInputComponent, UiModalComponent, ComposerAgendaFieldRedesignComponent],
  templateUrl: './composer-agenda-resources-redesign.component.html',
})
export class ComposerAgendaResourcesRedesignComponent extends ComposerAgendaResourcesComponent {
  private readonly modalService = inject(UiModalService);

  protected readonly linkForm = new FormGroup({
    title: new FormControl('', [Validators.required, trimmedRequired()]),
    url: new FormControl('', [Validators.required, httpsUrlValidator()]),
  });

  protected readonly maxFileSizeMb = MAX_FILE_SIZE_MB;
  protected readonly dragOver = signal(false);
  private readonly linkFormRef = signal(this.linkForm);
  protected readonly linkTitleInvalid: Signal<boolean> = touchedInvalidSignal(this.linkFormRef, 'title');
  protected readonly linkUrlInvalid: Signal<boolean> = touchedInvalidSignal(this.linkFormRef, 'url');
  private readonly linkStatus = toSignal(this.linkForm.statusChanges, { initialValue: this.linkForm.status });
  protected readonly linkValid: Signal<boolean> = computed(() => this.linkStatus() === 'VALID');

  private readonly addLinkTemplate = viewChild.required<TemplateRef<unknown>>('addLinkModal');

  protected override onAddLink(): void {
    this.linkForm.reset({ title: '', url: '' });
    this.modalService.open(this.addLinkTemplate(), { autoFocus: 'first-tabbable' });
  }

  protected submitLink(ref: DialogRef): void {
    if (this.linkForm.invalid) {
      this.linkForm.markAllAsTouched();
      return;
    }

    (this.form().get('important_links') as FormArray).push(
      new FormGroup({
        id: new FormControl(crypto.randomUUID()),
        title: new FormControl((this.linkForm.value.title ?? '').trim()),
        url: new FormControl((this.linkForm.value.url ?? '').trim()),
        uid: new FormControl<string | null>(null),
      })
    );
    this.form().get('important_links')?.markAsDirty();
    ref.close();
  }

  protected onFilesPicked(input: HTMLInputElement): void {
    this.onFileSelect({ files: input.files ?? undefined });
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.onFileSelect({ files: event.dataTransfer?.files });
  }
}
